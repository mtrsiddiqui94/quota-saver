// Switching model mid-conversation throws away the prompt cache: the whole
// context is re-sent at full price on the next turn. Say so, with the size.

import type { EngineInterface, TurnUsage } from 'claude-code'

import { k, record } from '../core/activity'
import { state } from '../core/state'

// Below this, a cache miss costs too little to mention.
const WORTH_MENTIONING = 15_000

export async function warnModelSwitch($: EngineInterface, usage: TurnUsage | undefined) {
  if (!usage) return
  const contextTokens = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  const last = state.lastTurn
  state.lastTurn = { model: usage.model, contextTokens }
  if (!last || last.model === usage.model || last.contextTokens < WORTH_MENTIONING) return
  await record($, 'info', `model changed ${last.model} → ${usage.model}: prompt cache restarted, ~${k(last.contextTokens)} tokens re-sent at full price`)
  $.ui.toast(
    `Model changed to ${usage.model}: its prompt cache starts empty, so ~${k(last.contextTokens)} tokens were sent at full price. Switch models at the start of a task (after /naya-kaam) to avoid this.`,
  )
}
