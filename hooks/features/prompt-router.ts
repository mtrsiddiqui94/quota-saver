// The local side of every prompt, before anything goes online:
//   1. shortcuts from the personal dictionary expand;
//   2. a question answered before is answered from the local cache (0 tokens);
//   3. a question that needs no project context goes to the local model, if on;
//   4. otherwise the lean guide for its kind of task rides along.
// A leading ! skips 2 and 3 and sends the prompt to Claude as is.

import type { Args, EngineInterface, On } from 'claude-code'

import { detectIntent, GUIDE } from '../lib/intent'
import { askLocal, routeLocal } from '../lib/local'
import { ANSWER_MAX, cacheKey, expand, lookup, remember } from '../lib/memory'
import type { AnswerCache, Dictionary } from '../lib/memory'
import { count, state, STORE } from '../core/state'
import type { Options } from '../core/state'

// A turn that may have changed files or the system is never replayed from cache.
const MUTATING = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash', 'PowerShell'])

function age(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000))
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
}

export function installPromptRouter(on: On, opts: Options) {
  on('prompt.submit', async ($, e, next) => {
    const { cfg, turn } = state
    turn.key = undefined
    turn.hasSideEffects = false
    if (!cfg.isEnabled || e.command || e.isMeta) return next(e)

    const dict = ((await $.store.get(STORE.dictionary)) ?? {}) as Dictionary
    const isFresh = e.text.trimStart().startsWith('!')
    const text = expand(isFresh ? e.text.trimStart().slice(1) : e.text, dict)

    if (opts.localCache && !e.attachments?.length) {
      const key = cacheKey(await $.session.cwd(), text)
      const now = await $.clock.now()
      const hit = isFresh ? undefined : lookup(((await $.store.get(STORE.answers)) ?? {}) as AnswerCache, key, now)
      if (hit) {
        await count($, { cacheHits: 1 })
        return {
          drop: `[quota-saver: saved answer, 0 tokens, from ${age(now - hit.at)} ago. Start with ! for a fresh answer]\n\n${hit.answer}`,
        }
      }
      turn.key = key
    }

    const localPrompt = isFresh ? undefined : routeLocal(text, cfg.local)
    if (localPrompt !== undefined) {
      $.ui.status(`quota-saver: local model (${cfg.localModel}) is thinking…`)
      const reply = await askLocal($, opts.ollamaUrl, cfg.localModel, localPrompt)
      $.ui.status(undefined)
      if (reply.isAnswered) {
        await count($, { localAnswers: 1 })
        return {
          drop: `[quota-saver: local model ${cfg.localModel}, 0 Claude tokens. Start with ! to ask Claude instead]\n\n${reply.text}`,
        }
      }
      $.ui.toast(`Local model failed: ${reply.reason}. Asking Claude instead.`)
    }

    const sent = localPrompt ?? text
    const intent = opts.autoIntent ? detectIntent(sent) : undefined
    const context = intent ? [...(e.context ?? []), GUIDE[intent]] : e.context
    return next({ ...e, text: sent, ...(context ? { context } : {}) })
  }).catch(($, e, next) => next(e))

  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined && MUTATING.has(String(e.tool))) state.turn.hasSideEffects = true
    return next(e)
  }).catch(($, e, next) => next(e))
}

/** At the end of a main-loop turn: keeps its answer when it is safe to replay. */
export async function rememberAnswer($: EngineInterface, e: Args<'turn.complete'>) {
  const { key, hasSideEffects } = state.turn
  state.turn.key = undefined
  const isReplayable =
    state.cfg.isEnabled && key !== undefined && e.reason === 'answer' && !hasSideEffects &&
    e.answer.length > 0 && e.answer.length <= ANSWER_MAX
  if (!isReplayable) return
  const cache = ((await $.store.get(STORE.answers)) ?? {}) as AnswerCache
  await $.store.set(STORE.answers, remember(cache, key, e.answer, await $.clock.now()))
}
