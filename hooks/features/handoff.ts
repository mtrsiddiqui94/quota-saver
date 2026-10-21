// /new-task and /last-task: carry a 12-line note across a /clear, or into the next
// session, in place of the whole history.

import type { EngineInterface, Hook, On } from 'claude-code'

import { record } from '../core/activity'
import { resetContext, state, STORE } from '../core/state'
import type { Options } from '../core/state'
import { judgeReply } from '../lib/judge'
import { saveLastSession } from './session-report'
import { askLocal } from '../lib/local'

const HANDOFF_SYSTEM = `You compress a coding session into a handoff note so a fresh session can continue with almost no context.
Write at most 12 short lines, plain text, in English:
GOAL: what the user is trying to achieve
DONE: what is finished (file paths)
STATE: current state, open problems, exact error if any
FILES: the few files that matter, with line hints
NEXT: the concrete next step
DECISIONS: choices the user made that must be kept
No preamble, nothing else.`

type Note = { note: string; at: number }
type ProjectNotes = Record<string, Note>

const NOTES_KEPT = 30

/** Saves the note for this project (and as the latest overall, for /last-task elsewhere). */
async function saveNote($: EngineInterface, note: string) {
  const at = await $.clock.now()
  const cwd = await $.session.cwd()
  const book = ((await $.store.get(STORE.projectNotes)) ?? {}) as ProjectNotes
  const kept = Object.entries({ ...book, [cwd]: { note, at } }).sort((a, b) => a[1].at - b[1].at).slice(-NOTES_KEPT)
  await $.store.set(STORE.projectNotes, Object.fromEntries(kept))
  await $.store.set(STORE.handoff, { note, at })
}

/** This project's note, else the latest one from anywhere. */
async function loadNote($: EngineInterface): Promise<(Note & { isThisProject: boolean }) | undefined> {
  const book = ((await $.store.get(STORE.projectNotes)) ?? {}) as ProjectNotes
  const own = book[await $.session.cwd()]
  if (own) return { ...own, isThisProject: true }
  const latest = (await $.store.get(STORE.handoff)) as Partial<Note> | undefined
  return latest?.note ? { note: latest.note, at: latest.at ?? 0, isThisProject: false } : undefined
}

const auto = { turns: 0, isRunning: false }
// Turns between automatic notes; only with a local model, so it never costs Claude tokens.
const AUTO_EVERY = 8

/** Every few turns, with a local model on, the local model writes this project's note in the background. */
export async function autoNote($: EngineInterface) {
  auto.turns += 1
  if (state.cfg.local === 'off' || !ctx.opts || auto.isRunning || auto.turns % AUTO_EVERY !== 0) return
  auto.isRunning = true
  void (async () => {
    try {
      const note = await makeHandoff($, '', false)
      if (note) {
        await saveNote($, note)
        await record($, 'saved', `project note refreshed by the local model (0 Claude tokens): /last-task loads it in a new chat`)
      }
    } finally {
      auto.isRunning = false
    }
  })()
}

/** At session start: if this project has a note, say so once (it is not loaded unasked: that would cost tokens). */
export async function mentionNote($: EngineInterface) {
  const book = ((await $.store.get(STORE.projectNotes)) ?? {}) as ProjectNotes
  const own = book[await $.session.cwd()]
  if (!own) return
  const days = Math.floor(((await $.clock.now()) - own.at) / 86_400_000)
  $.ui.toast(`Quota Saver: this project has a summary of your last task (${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}). /last-task loads its 12 lines instead of the old history.`)
}

async function makeHandoff($: EngineInterface, focus: string, allowHaiku = true): Promise<string | undefined> {
  const rows = await $.session.messages()
  const transcript = rows
    .slice(-80)
    .map(row => {
      const tools = row.toolUses.map(t => `[${t.tool} ${JSON.stringify(t.input ?? {}).slice(0, 160)}]`).join(' ')
      return `${row.role.toUpperCase()}: ${row.text.slice(0, 1500)} ${tools}`.trim()
    })
    .join('\n')
    .slice(-60000)
  if (transcript.length === 0) return undefined
  const task = focus ? `The user's next task: ${focus}\nKeep only what helps with it.\n\n` : ''

  // With local mode on, the strong local model writes it for free; Haiku is the fallback.
  if (state.cfg.local !== 'off' && ctx.opts) {
    const local = await askLocal($, ctx.opts.ollamaUrl, state.cfg.localModel, `${task}Session transcript:\n${transcript.slice(-12_000)}`, HANDOFF_SYSTEM, 400)
    if (local.isAnswered && judgeReply('summary', local.text).isUsable && /GOAL:/i.test(local.text)) {
      await record($, 'saved', `summary written by local ${state.cfg.localModel}: 0 Claude tokens`)
      return local.text.trim()
    }
    if (!allowHaiku) return undefined
    await record($, 'info', `local summary not usable → Haiku writes it`)
  }
  if (!allowHaiku) return undefined

  const reply = await $.model.complete({
    model: 'haiku',
    system: HANDOFF_SYSTEM,
    prompt: `${focus ? `The user's next task: ${focus}\nKeep only what helps with it.\n\n` : ''}Session transcript:\n${transcript}`,
    maxTokens: 600,
  })
  return reply.isAnswered ? reply.text.trim() : undefined
}

/** What a command answers when its hook fails, in place of failing silently. */
const FAIL = { text: 'quota-saver: this command failed. Please try again.' }

const newTaskCommand: Hook<'command.run'> = async ($, e) => {
  const note = await makeHandoff($, e.args.trim())
  if (!note) return { text: 'Could not write a summary (the session is empty or the model did not answer). Use /clear directly.' }

  await saveNote($, note)
  await record($, 'saved', `session summarised by Haiku into ${note.split('\n').length} lines; context cleared, summary carried forward`)
  state.handoff.pending = note
  const isCleared = await $.command.run({ command: 'clear' }).then(
    () => true,
    () => false,
  )
  return {
    text: isCleared
      ? `Context cleared. This summary carries into the new context:\n\n${note}`
      : `Summary ready:\n\n${note}\n\nNow type /clear: the summary carries into the new context by itself.`,
  }
}

const lastTaskCommand: Hook<'command.run'> = async $ => {
  const saved = await loadNote($)
  if (!saved) return { text: 'No saved summary. Run /new-task in a session first.' }
  state.handoff.active = saved.note
  const whose = saved.isThisProject ? "this project's last task" : 'the last task (another project: none saved for this one yet)'
  return { text: `Loaded the summary of ${whose}, instead of the whole history:\n\n${saved.note}` }
}

// The options of the current load, for the command hooks above.
const ctx = { opts: undefined as Options | undefined }

export function installHandoff(on: On, opts: Options) {
  ctx.opts = opts
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    resetContext()
    return done
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await saveLastSession($).catch(() => undefined)
    resetContext()
    state.handoff.active = e.reason === 'clear' ? state.handoff.pending : undefined
    state.handoff.pending = undefined
    return next(e)
  })

  on('command.run', { command: 'new-task' }, newTaskCommand).catch(() => FAIL)
  on('command.run', { command: 'quota-saver:new-task' }, newTaskCommand).catch(() => FAIL)

  on('command.run', { command: 'last-task' }, lastTaskCommand).catch(() => FAIL)
  on('command.run', { command: 'quota-saver:last-task' }, lastTaskCommand).catch(() => FAIL)
}
