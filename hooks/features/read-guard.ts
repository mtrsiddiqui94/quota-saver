// Stops whole reads of huge files and repeat reads of unchanged ones. Each
// refusal is soft: the same call made again goes through.

import type { On } from 'claude-code'

import { junkReason } from '../lib/junk'
import { formatK, isBinaryLike, tokens } from '../lib/trim'
import { record } from '../core/activity'
import { count, state } from '../core/state'
import type { Options } from '../core/state'

const WHOLE_READ_BYTES = 32 * 1024

export function installReadGuard(on: On, opts: Options) {
  on('tool.call', { tool: 'Read' }, async ($, e, next) => {
    if (!state.cfg.isEnabled) return next(e)

    const path = e.file_path
    const isRanged = e.offset !== undefined || e.limit !== undefined || e.pages !== undefined
    const key = `${path}|${e.offset ?? ''}|${e.limit ?? ''}|${e.pages ?? ''}`

    const stat = await $.fs.stat(path).catch(() => undefined)
    const mtime = stat?.kind === 'file' ? stat.mtimeMs : -1
    const size = stat?.kind === 'file' ? stat.size : 0

    if (!state.refused.has(key) && mtime >= 0) {
      // A range of a file already read whole is a repeat too. Only for files small
      // enough that the whole read could not have stopped at Read's 2000-line cap.
      const wholeKey = `${path}|||`
      const isPartOfWhole = isRanged && e.pages === undefined && size <= WHOLE_READ_BYTES && state.seen.get(wholeKey) === mtime
      const isRepeat = opts.dedupeReads && (state.seen.get(key) === mtime || isPartOfWhole)
      const isHuge = !isRanged && !e.allow_large && !isBinaryLike(path) && size > opts.maxReadBytes
      const junk = opts.guardJunk && !isRanged && size > 2048 ? junkReason(path) : undefined
      if (isRepeat || isHuge || junk) {
        state.refused.add(key)
        await count($, { blockedReads: 1 })
        if (!state.pendingBlocked.has(key)) {
          state.pendingBlocked.set(key, tokens(size))
          state.keptOut += tokens(size)
        }
        const name = path.split(/[\\/]/).pop() ?? path
        await record(
          $,
          'blocked',
          isRepeat
            ? `stopped Claude reading ${name} again (it already has it)`
            : junk
              ? `stopped Claude reading ${name} (${junk}, about ${formatK(tokens(size))} tokens)`
              : `stopped Claude reading all of ${name} (about ${formatK(tokens(size))} tokens) and asked it to search inside first`,
        )
        if (junk && !isRepeat) {
          return {
            deny: `quota-saver: ${path} is a ${junk} (~${formatK(tokens(size))} tokens) and is rarely worth reading. Read the source that produces it, or grep it for the one thing you need. If you really need it, call Read again with the same arguments and it will go through.`,
          }
        }
        return {
          deny: isRepeat
            ? `quota-saver: ${path} was already read in this conversation and has not changed since. Use what is already in context. If it truly is no longer visible to you, call Read again with the same arguments and it will go through.`
            : `quota-saver: ${path} is ${Math.round(size / 1024)} KB (~${formatK(tokens(size))} tokens). Call mcp__quota-saver__outline with this path to see its functions and classes with line numbers, or grep it, then Read with offset/limit. If you really need the whole file, call Read again with the same arguments.`,
        }
      }
    }

    const ran = await next(e)
    state.refused.delete(key)
    const kept = state.pendingBlocked.get(key)
    if (kept !== undefined && ran.deny === undefined) {
      // The retry went through: the file is in the context after all.
      state.keptOut = Math.max(0, state.keptOut - kept)
      state.pendingBlocked.delete(key)
    }
    if (ran.deny === undefined && !ran.isError && mtime >= 0) state.seen.set(key, mtime)
    return ran
  }).catch(($, e, next) => next(e))
}
