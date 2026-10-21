// One line on what the last session cost and saved, shown when the next one
// starts: at exit there is no one left to read it.

import type { EngineInterface } from 'claude-code'

import { formatK } from '../lib/trim'
import { EMPTY_STATS, state, STORE } from '../core/state'
import type { Stats } from '../core/state'

type Report = { used: number; baseline: number; fullPrice: number }

// What the process had counted when the previous session ended: /clear starts
// a new session in the same process, and its counters keep running.
const ended = { at: { ...EMPTY_STATS } as Stats }

export function sessionReport(now: Stats, before: Stats): Report | undefined {
  const used = now.usedTokens - before.usedTokens
  if (used <= 0) return undefined
  return { used, baseline: now.baselineTokens - before.baselineTokens, fullPrice: now.fullPriceTokens - before.fullPriceTokens }
}

export function reportLine(r: Report): string {
  const saved = Math.max(0, r.baseline - r.used)
  const pct = r.baseline > 0 ? Math.round((saved / r.baseline) * 100) : 0
  return `Quota Saver, last session: Claude used ${formatK(r.used)} tokens (${formatK(r.fullPrice)} at full price) · saved ≈ ${formatK(saved)} (${pct}%)`
}

/** At session start: the last session's line, once. */
export async function mentionLastSession($: EngineInterface) {
  const r = (await $.store.get(STORE.lastSession)) as Report | undefined
  if (!r) return
  await $.store.delete(STORE.lastSession)
  if (state.cfg.isEnabled) $.ui.toast(reportLine(r))
}

/** At session end (called from the one session.end hook): keeps this session's line for the next start. */
export async function saveLastSession($: EngineInterface) {
  const r = sessionReport(state.session, ended.at)
  ended.at = { ...state.session }
  if (r) await $.store.set(STORE.lastSession, r)
}
