// Stops whole reads of huge files and repeat reads of unchanged ones. Each
// refusal is soft: the same call made again goes through.

import type { On } from 'claude-code'

import { junkReason } from '../lib/junk'
import { formatK, isBinaryLike, tokens } from '../lib/trim'
import { record } from '../core/activity'
import { count, state } from '../core/state'
import type { Options } from '../core/state'

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
      const isRepeat = opts.dedupeReads && state.seen.get(key) === mtime
      const isHuge = !isRanged && !e.allow_large && !isBinaryLike(path) && size > opts.maxReadBytes
      const junk = opts.guardJunk && !isRanged && size > 2048 ? junkReason(path) : undefined
      if (isRepeat || isHuge || junk) {
        state.refused.add(key)
        await count($, { blockedReads: 1 })
        const name = path.split(/[\\/]/).pop() ?? path
        await record(
          $,
          'blocked',
          isRepeat
            ? `re-read of unchanged ${name} stopped (already in context)`
            : junk
              ? `read of ${name} stopped: ${junk}, ${Math.round(size / 1024)} KB ≈ ${formatK(tokens(size))} tokens`
              : `whole read of ${name} stopped: ${Math.round(size / 1024)} KB ≈ ${formatK(tokens(size))} tokens; asked to search first`,
        )
        if (junk && !isRepeat) {
          return {
            deny: `quota-saver: ${path} is a ${junk} (~${formatK(tokens(size))} tokens) and is rarely worth reading. Read the source that produces it, or grep it for the one thing you need. If you really need it, call Read again with the same arguments and it will go through.`,
          }
        }
        return {
          deny: isRepeat
            ? `quota-saver: ${path} was already read in this conversation and has not changed since. Use what is already in context. If it truly is no longer visible to you, call Read again with the same arguments and it will go through.`
            : `quota-saver: ${path} is ${Math.round(size / 1024)} KB (~${formatK(tokens(size))} tokens). Find the relevant lines first (Grep or \`grep -n\`), then Read with offset/limit. If you really need the whole file, call Read again with the same arguments.`,
        }
      }
    }

    const ran = await next(e)
    state.refused.delete(key)
    if (ran.deny === undefined && !ran.isError && mtime >= 0) state.seen.set(key, mtime)
    return ran
  }).catch(($, e, next) => next(e))
}
