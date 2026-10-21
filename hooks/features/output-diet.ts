// Cuts long logs, command output and fetched pages to their useful part before
// they enter the conversation, where they would be re-sent on every later turn.
//
// In order: a command run with QS_RAW=1 is left whole; command-aware filters
// drop what carries nothing (passing tests, progress bars, install chatter,
// repeated lines); what is still long keeps its head, its error lines and its
// tail. A change is made only when it saves at least 30%. The original is kept
// in a private local file, named in the result, so Claude can read a line
// range of it instead of running the command again.

import type { EngineInterface, On } from 'claude-code'

import { record } from '../core/activity'
import { count, state } from '../core/state'
import type { Options } from '../core/state'
import { filterOutput } from '../lib/filters'
import { formatK, isTrimmable, tokens, trimOutput } from '../lib/trim'

/** A change smaller than this share of the output is not worth making. */
const MIN_SAVING = 0.3
/** Below this many characters an output is left as it is. */
const MIN_CHARS = 2_000
/** Days the archived originals are kept. */
const KEEP_DAYS = 3

// The Bash command behind each tool call, so its output can be filtered for its kind.
const commands = new Map<string, string>()
const rawIds = new Set<string>()

export type Shrunk = { text: string; how: string[] }

/** The shortened output, or undefined when it is better left whole. */
export function shrink(command: string, text: string, maxChars: number): Shrunk | undefined {
  if (text.length < MIN_CHARS) return undefined
  let out = text
  const how: string[] = []
  const filtered = filterOutput(command, out)
  if (filtered) {
    out = filtered.text
    how.push(`${filtered.dropped} ${filtered.kind === 'test' ? 'passing-test and noise' : 'noise'} lines dropped`)
  }
  if (out.length > maxChars) {
    out = trimOutput(out, maxChars).text
    how.push('head, error lines and tail kept')
  }
  return text.length - out.length >= text.length * MIN_SAVING ? { text: out, how } : undefined
}

async function rawDir($: EngineInterface): Promise<{ dir: string; isWindows: boolean } | undefined> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const home = isWindows ? await $.env.get('USERPROFILE') : await $.env.get('HOME')
  if (!home) return undefined
  return { dir: isWindows ? `${home}\\.quota-saver\\raw` : `${home}/.quota-saver/raw`, isWindows }
}

const made = { isDone: false }

/** Keeps the original in an owner-only folder; resolves its path, or undefined if it could not be written. */
async function archive($: EngineInterface, id: string, text: string): Promise<string | undefined> {
  try {
    const target = await rawDir($)
    if (!target) return undefined
    if (!made.isDone) {
      const r = target.isWindows
        ? await $.process.run(['powershell', '-NoProfile', '-Command', 'New-Item -ItemType Directory -Force -Path $args[0] | Out-Null', target.dir])
        : await $.process.run(['mkdir', '-p', '-m', '700', target.dir])
      if (r.exitCode !== 0) return undefined
      made.isDone = true
    }
    const path = `${target.dir}${target.isWindows ? '\\' : '/'}${id.replace(/[^\w-]/g, '_')}.txt`
    await $.fs.write(path, text)
    return path
  } catch {
    return undefined
  }
}

/** Removes archived originals older than KEEP_DAYS. */
export async function pruneArchive($: EngineInterface) {
  const target = await rawDir($)
  if (!target) return
  if (target.isWindows) {
    await $.process.run([
      'powershell', '-NoProfile', '-Command',
      `Get-ChildItem -LiteralPath $args[0] -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-${KEEP_DAYS}) } | Remove-Item -Force`,
      target.dir,
    ])
  } else {
    await $.process.run(['find', target.dir, '-type', 'f', '-mtime', `+${KEEP_DAYS}`, '-delete'])
  }
}

export function installOutputDiet(on: On, opts: Options) {
  on('tool.call', { tool: 'Bash' }, ($, e, next) => {
    if (e.tool_use_id) {
      commands.set(e.tool_use_id, e.command)
      if (/(^|[\s;&|(])QS_RAW=1\s/.test(e.command)) rawIds.add(e.tool_use_id)
      if (commands.size > 500) commands.delete(commands.keys().next().value ?? '')
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    if (!state.cfg.isEnabled || e.origin.kind !== 'tool' || !isTrimmable(e.origin.tool)) return next(e)

    let before = 0
    let after = 0
    const notes: string[] = []
    const content = []
    for (const block of e.message.content) {
      if (block.type !== 'tool_result') {
        content.push(block)
        continue
      }
      const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : ''
      if (rawIds.has(id)) {
        rawIds.delete(id)
        await record($, 'info', `${e.origin.tool} output left whole (QS_RAW=1)`)
        content.push(block)
        continue
      }
      const command = commands.get(id) ?? ''
      const one = async (text: string): Promise<string> => {
        const s = shrink(command, text, opts.maxOutputChars)
        if (!s) return text
        before += text.length
        after += s.text.length
        notes.push(...s.how)
        const path = id ? await archive($, id, text) : undefined
        const where = path
          ? `full output (${text.split('\n').length} lines) saved to ${path}: read a line range there instead of running the command again`
          : 'run the command again with QS_RAW=1 in front for the full output'
        return `${s.text}\n[quota-saver: ${where}]`
      }
      const inner = block.content
      if (typeof inner === 'string') {
        content.push({ ...block, content: await one(inner) })
      } else if (Array.isArray(inner)) {
        const parts = []
        for (const part of inner) {
          const p = part as { type?: string; text?: unknown }
          parts.push(p.type === 'text' && typeof p.text === 'string' ? { ...p, text: await one(p.text) } : part)
        }
        content.push({ ...block, content: parts })
      } else {
        content.push(block)
      }
    }

    const saved = before - after
    if (saved <= 0) return next(e)
    await count($, { savedChars: saved, trims: 1 })
    state.keptOut += tokens(saved)
    await record(
      $,
      'saved',
      `shortened ${e.origin.tool} output, saved about ${formatK(tokens(saved))} tokens (${[...new Set(notes)].join(', ')}; full text kept on disk)`,
    )
    return next({ ...e, message: { ...e.message, content } })
  }).catch(($, e, next) => next(e))
}
