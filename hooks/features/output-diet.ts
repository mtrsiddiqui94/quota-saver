// Cuts long logs, command output and fetched pages to their useful part before
// they enter the conversation, where they would be re-sent on every later turn.

import type { On } from 'claude-code'

import { formatK, isTrimmable, tokens, trimOutput } from '../lib/trim'
import { record } from '../core/activity'
import { count, state } from '../core/state'
import type { Options } from '../core/state'

export function installOutputDiet(on: On, opts: Options) {
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    if (!state.cfg.isEnabled || e.origin.kind !== 'tool' || !isTrimmable(e.origin.tool)) return next(e)

    let saved = 0
    let before = 0
    const shorten = (text: string) => {
      const t = trimOutput(text, opts.maxOutputChars)
      before += text.length
      saved += t.savedChars
      return t.text
    }
    const content = e.message.content.map(block => {
      if (block.type !== 'tool_result') return block
      const inner = block.content
      if (typeof inner === 'string') return { ...block, content: shorten(inner) }
      if (!Array.isArray(inner)) return block
      return {
        ...block,
        content: inner.map(part => {
          const p = part as { type?: string; text?: unknown }
          return p.type === 'text' && typeof p.text === 'string' ? { ...p, text: shorten(p.text) } : part
        }),
      }
    })

    if (saved === 0) return next(e)
    await count($, { savedChars: saved, trims: 1 })
    await record(
      $,
      'saved',
      `${e.origin.tool} output ${formatK(before)} → ${formatK(before - saved)} chars (≈ ${formatK(tokens(saved))} tokens saved, errors and last lines kept)`,
    )
    return next({ ...e, message: { ...e.message, content } })
  }).catch(($, e, next) => next(e))
}
