// Context and quota meter on the status line, with a nudge as the window fills.

import type { EngineInterface } from 'claude-code'

import { formatK, tokens } from '../lib/trim'
import { clock, record } from '../core/activity'
import { humanMinutes, minutesToFull } from '../lib/burn'
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

  state.isQuotaMode = state.cfg.local !== 'off' && rateLimits.some(r => r.percentUsed >= 90)
  const now = await $.clock.now()
  for (const r of rateLimits) {
    const key = `${r.kind}:${r.resetsAt ?? ''}`
    const samples = state.burn.get(key) ?? []
    if (samples.at(-1)?.pct !== r.percentUsed) samples.push({ at: now, pct: r.percentUsed })
    state.burn.set(key, samples.slice(-30))
  }
  for (const r of rateLimits) {
    const level = r.percentUsed >= 95 ? 95 : r.percentUsed >= 80 ? 80 : 0
    const key = `${r.kind}:${r.resetsAt ?? ''}:${level}`
    if (level === 0 || state.quotaWarned.has(key)) continue
    state.quotaWarned.add(key)
    const window = r.kind === 'five_hour' ? '5-hour' : r.kind === 'seven_day' ? 'weekly' : r.kind
    const resets = r.resetsAt ? ` It resets at ${clock(Date.parse(r.resetsAt))}.` : ''
    const toFull = minutesToFull(state.burn.get(`${r.kind}:${r.resetsAt ?? ''}`) ?? [])
    const pace = toFull !== undefined ? ` At this pace it is full in ~${humanMinutes(toFull)}.` : ''
    await record($, 'info', `${window} quota ${r.percentUsed}% used`)
    $.ui.toast(
      `${window} quota ${r.percentUsed}% used.${pace}${resets} For easy tasks: /model haiku, and /local auto for general questions.`,
    )
  }

  const pct = context.percent ?? 0
  const level = pct >= 85 ? 85 : pct >= 65 ? 65 : 0
  if (level > state.warnedAt) {
    state.warnedAt = level
    await record($, 'info', `context ${pct}% full: every message re-sends it; /new-task would clear it`)
    $.ui.toast(
      level >= 85
        ? `Context ${pct}% full. Every message now costs more: run /new-task.`
        : `Context ${pct}%. Switching tasks? /new-task clears it and saves tokens.`,
    )
  }
}
