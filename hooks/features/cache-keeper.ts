// Cache keeper: the prompt cache expires after a quiet spell (one hour on a
// Claude subscription within plan usage, five minutes otherwise, per Claude
// Code's docs), and the next message then re-sends the whole context at full
// price. Shortly before that, say so while a decision is still cheap.

import type { EngineInterface, Timer } from 'claude-code'

import { k, record } from '../core/activity'
import { state } from '../core/state'

// Below this, an expired cache costs too little to interrupt anyone.
const WORTH_KEEPING = 20_000

const keeper: { timer?: Timer; lastTurnAt: number; ttlMin: number } = { lastTurnAt: 0, ttlMin: 60 }

/** The main conversation's cache lifetime in minutes, as Claude Code picks it. */
export async function cacheTtlMinutes($: EngineInterface, isSubscription: boolean): Promise<number> {
  if ((await $.env.get('FORCE_PROMPT_CACHING_5M')) === '1') return 5
  const chosen = await $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL')
  if (chosen === '5m') return 5
  if (chosen === '1h' || (await $.env.get('ENABLE_PROMPT_CACHING_1H')) === '1') return 60
  return isSubscription ? 60 : 5
}

/** After a main-loop turn: arm the warning for just before the cache expires. */
export async function armCacheWarning($: EngineInterface) {
  keeper.timer?.cancel()
  keeper.timer = undefined
  const context = state.lastTurn?.contextTokens ?? 0
  const { rateLimits } = await $.session.usage()
  keeper.ttlMin = await cacheTtlMinutes($, rateLimits.length > 0)
  keeper.lastTurnAt = await $.clock.now()
  if (!state.cfg.isEnabled || context < WORTH_KEEPING) return
  const leadMin = keeper.ttlMin >= 30 ? 5 : 2
  keeper.timer = $.clock.after((keeper.ttlMin - leadMin) * 60_000, () => {
    void (async () => {
      await record($, 'info', `cache cools in ~${leadMin} min: ~${k(context)} tokens would then be re-sent at full price`)
      $.ui.toast(
        `Prompt cache expires in ~${leadMin} min. Still on this task? Send your next message now. New task? /new-task first: it carries 12 lines instead of ~${k(context)} tokens.`,
      )
    })()
  })
}

/** When a prompt is sent: stop the warning, and note if the cache had already expired. */
export async function noteCacheOnSubmit($: EngineInterface) {
  keeper.timer?.cancel()
  keeper.timer = undefined
  const context = state.lastTurn?.contextTokens ?? 0
  if (keeper.lastTurnAt === 0 || context < WORTH_KEEPING) return
  const idleMin = Math.round(((await $.clock.now()) - keeper.lastTurnAt) / 60_000)
  if (idleMin >= keeper.ttlMin) {
    await record($, 'info', `cache had expired (idle ${idleMin} min, lifetime ${keeper.ttlMin} min): this message re-sends ~${k(context)} tokens uncached`)
  }
}
