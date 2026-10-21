// /naya-kaam and /wapas: carry a 12-line note across a /clear, or into the next
// session, in place of the whole history.

import type { EngineInterface, On } from 'claude-code'

import { record } from '../core/activity'
import { resetContext, state, STORE } from '../core/state'

const HANDOFF_SYSTEM = `You compress a coding session into a handoff note so a fresh session can continue with almost no context.
Write at most 12 short lines, plain text, in English:
GOAL: what the user is trying to achieve
DONE: what is finished (file paths)
STATE: current state, open problems, exact error if any
FILES: the few files that matter, with line hints
NEXT: the concrete next step
DECISIONS: choices the user made that must be kept
No preamble, nothing else.`

async function makeHandoff($: EngineInterface, focus: string): Promise<string | undefined> {
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

  const reply = await $.model.complete({
    model: 'haiku',
    system: HANDOFF_SYSTEM,
    prompt: `${focus ? `The user's next task: ${focus}\nKeep only what helps with it.\n\n` : ''}Session transcript:\n${transcript}`,
    maxTokens: 600,
  })
  return reply.isAnswered ? reply.text.trim() : undefined
}

export function installHandoff(on: On) {
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    resetContext()
    return done
  }).catch(($, e, next) => next(e))

  on('session.end', ($, e, next) => {
    resetContext()
    state.handoff.active = e.reason === 'clear' ? state.handoff.pending : undefined
    state.handoff.pending = undefined
    return next(e)
  })

  on('command.run', { command: 'naya-kaam' }, async ($, e) => {
    const note = await makeHandoff($, e.args.trim())
    if (!note) return { text: 'Could not write a summary (the session is empty or the model did not answer). Use /clear directly.' }

    await $.store.set(STORE.handoff, { note, at: await $.clock.now() })
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
  }).catch(() => ({ text: 'quota-saver: this command failed. Please try again.' }))

  on('command.run', { command: 'wapas' }, async $ => {
    const saved = (await $.store.get(STORE.handoff)) as { note?: string } | undefined
    if (!saved?.note) return { text: 'No saved summary. Run /naya-kaam in a session first.' }
    state.handoff.active = saved.note
    return { text: `Last summary loaded (instead of the whole history):\n\n${saved.note}` }
  }).catch(() => ({ text: 'quota-saver: this command failed. Please try again.' }))
}
