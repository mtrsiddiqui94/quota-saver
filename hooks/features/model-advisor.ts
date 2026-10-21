// Model advisor: the model is the biggest lever on quota. When a heavy model
// (Opus) is on and the task is light, say once which lighter model fits, and
// what switching mid-conversation would cost (the prompt cache restarts).

import type { EngineInterface } from 'claude-code'

import { k, record } from '../core/activity'
import { state } from '../core/state'
import type { Intent } from '../lib/intent'

// Past this, switching now re-sends a context worth mentioning.
const BIG_CONTEXT = 15_000

export type Advice = { to: 'haiku' | 'sonnet'; why: string }

/** Which lighter model fits a task, when the current one is heavier than it needs. */
export function advise(model: string | undefined, intent: Intent | undefined, words: string): Advice | undefined {
  if (!model || !/opus/i.test(model)) return undefined
  const isQuestion = /\?|\b(what|why|how|kya|kaise|kyun|matlab|farq|difference)\b/i.test(words)
  if (intent === 'explain' || (intent === undefined && isQuestion && words.length <= 300)) {
    return { to: 'haiku', why: 'questions and explanations' }
  }
  if (intent === 'test' || intent === 'review') return { to: 'sonnet', why: `${intent === 'test' ? 'running tests' : 'reviewing a diff'}` }
  return undefined
}

/** Says it once per context window and kind of advice. */
export async function adviseModel($: EngineInterface, intent: Intent | undefined, words: string) {
  const advice = advise(state.currentModel, intent, words)
  if (!advice || state.advised.has(advice.to)) return
  state.advised.add(advice.to)
  const context = state.lastTurn?.contextTokens ?? 0
  const cacheNote =
    context >= BIG_CONTEXT
      ? ` Switching now restarts the prompt cache (~${k(context)} tokens once at full price), so it pays off most at the start of a task (after /new-task).`
      : ''
  await record($, 'info', `model advisor: ${state.currentModel} is on; /model ${advice.to} handles ${advice.why} for much less quota`)
  $.ui.toast(`You are on ${state.currentModel}. For ${advice.why}, /model ${advice.to} uses much less of your quota.${cacheNote}`)
}
