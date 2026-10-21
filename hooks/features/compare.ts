// Per turn: what Claude actually used, set against what the same turn would
// have cost without the plugin. "Used" is the API's own count; "without" adds
// back the tokens the plugin kept out of the context, once per request the
// turn made, since every request re-sends the whole context.

import type { EngineInterface, TurnUsage } from 'claude-code'

import { k, record } from '../core/activity'
import { count, state } from '../core/state'

export type TurnCompare = { used: number; baseline: number; saved: number; requests: number }

export function compareTurn(usage: TurnUsage, keptOutAtStart: number, keptOutAtEnd: number, toolCalls: number): TurnCompare {
  const used = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens
  const requests = toolCalls + 1
  // What was kept out grows during the turn: average its start and end over the turn's requests.
  const saved = Math.round(((keptOutAtStart + keptOutAtEnd) / 2) * requests)
  return { used, baseline: used + saved, saved, requests }
}

export async function recordTurnCompare($: EngineInterface, usage: TurnUsage | undefined) {
  if (!usage) return
  const c = compareTurn(usage, state.turn.keptOutAtStart, state.keptOut, state.turn.toolCalls)
  await count($, { usedTokens: c.used, baselineTokens: c.baseline })
  const pct = c.baseline > 0 ? Math.round((c.saved / c.baseline) * 100) : 0
  await record(
    $,
    'turn',
    `used ${k(c.used)} tokens · without Quota Saver ≈ ${k(c.baseline)} · saved ≈ ${k(c.saved)} (${pct}%) over ${c.requests} request${c.requests === 1 ? '' : 's'}`,
  )
}
