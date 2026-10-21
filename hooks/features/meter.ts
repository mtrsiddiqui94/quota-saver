// Context and quota meter on the status line, with a nudge as the window fills.

import type { EngineInterface } from 'claude-code'

import { formatK, tokens } from '../lib/trim'
import { state } from '../core/state'

export async function refreshStatus($: EngineInterface) {
  const { cfg, session } = state
  if (!cfg.isEnabled) {
    $.ui.status('quota-saver off')
    return
  }
  const { context, rateLimits } = await $.session.usage()
  const parts = [cfg.local === 'off' ? 'quota-saver' : `quota-saver+local${cfg.local === 'auto' ? ' auto' : ''}`]
  if (context.percent !== undefined) parts.push(`ctx ${context.percent}%`)
  const fiveHour = rateLimits.find(r => r.kind === 'five_hour')
  if (fiveHour) parts.push(`5h ${fiveHour.percentUsed}%`)
  const saved = tokens(session.savedChars)
  if (saved > 0) parts.push(`saved ~${formatK(saved)} tok`)
  $.ui.status(parts.join(' · '))

  const pct = context.percent ?? 0
  const level = pct >= 85 ? 85 : pct >= 65 ? 65 : 0
  if (level > state.warnedAt) {
    state.warnedAt = level
    $.ui.toast(
      level >= 85
        ? `Context ${pct}% full. Every message now costs more: run /naya-kaam.`
        : `Context ${pct}%. Switching tasks? /naya-kaam clears it and saves tokens.`,
    )
  }
}
