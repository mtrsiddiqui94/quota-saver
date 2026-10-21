// Per turn: what Claude actually used, set against what the same turn would
// have cost without the plugin. "Used" is the API's own count; "without" adds
// back the tokens the plugin kept out of the context, once per request the
// turn made, since every request re-sends the whole context.

import type { EngineInterface, TurnUsage } from 'claude-code'

import { k, record } from '../core/activity'
import { count, state } from '../core/state'

export type TurnCompare = { used: number; baseline: number; saved: number; requests: number; fullPrice: number; cheap: number }

export function compareTurn(usage: TurnUsage, keptOutAtStart: number, keptOutAtEnd: number, toolCalls: number): TurnCompare {
  const used = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
  const requests = toolCalls + 1
  // What was kept out grows during the turn: average its start and end over the turn's requests.
  const saved = Math.round(((keptOutAtStart + keptOutAtEnd) / 2) * requests)
  // Cache reads cost a fraction of the input rate; the rest is billed in full.
  const cheap = usage.cache_read_input_tokens
  return { used, baseline: used + saved, saved, requests, fullPrice: used - cheap, cheap }
}

export async function recordTurnCompare($: EngineInterface, usage: TurnUsage | undefined) {
  if (!usage) return
  const c = compareTurn(usage, state.turn.keptOutAtStart, state.keptOut, state.turn.toolCalls)
  await count($, { usedTokens: c.used, baselineTokens: c.baseline, fullPriceTokens: c.fullPrice })
  const pct = c.baseline > 0 ? Math.round((c.saved / c.baseline) * 100) : 0
  await record(
    $,
    'turn',
    `this message cost ${k(c.used)} tokens (${k(c.fullPrice)} full price, ${k(c.cheap)} at the cheap re-read price)` +
      (c.saved > 0
        ? ` · Quota Saver saved ${k(c.saved)} (${pct}%): without it, ${k(c.baseline)}`
        : ' · nothing to save this time: savings happen when Claude reads files or runs commands'),
  )
}
