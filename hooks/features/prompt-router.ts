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
import { k, record } from '../core/activity'
import { count, state, STORE } from '../core/state'
import type { Options } from '../core/state'

// A turn that may have changed files or the system is never replayed from cache.
const MUTATING = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit', 'Bash', 'PowerShell'])

// What a short answer adds on top of the context it is sent with.
const ANSWER_TOKENS = 400

/** A prompt answered without Claude: it would have cost one request over the whole context. */
async function countFreeAnswer($: EngineInterface) {
  const { context } = await $.session.usage()
  const baseline = (context.tokens ?? state.lastTurn?.contextTokens ?? 0) + ANSWER_TOKENS
  await count($, { baselineTokens: baseline })
  await record($, 'saved', `used 0 tokens · without Quota Saver ≈ ${k(baseline)} (one request over the current context)`)
}

function age(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000))
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
}

export function installPromptRouter(on: On, opts: Options) {
  on('prompt.submit', async ($, e, next) => {
    const { cfg, turn } = state
    turn.key = undefined
    turn.hasSideEffects = false
    turn.toolCalls = 0
    turn.keptOutAtStart = state.keptOut
    if (!cfg.isEnabled || e.command || e.isMeta) return next(e)

    const dict = ((await $.store.get(STORE.dictionary)) ?? {}) as Dictionary
    const isFresh = e.text.trimStart().startsWith('!')
    const original = isFresh ? e.text.trimStart().slice(1) : e.text
    const text = expand(original, dict)
    await record($, 'prompt', `"${e.text.slice(0, 80)}"${isFresh ? ' (! = fresh, skip cache and local model)' : ''}`)
    if (text !== original) await record($, 'saved', `shortcut expanded locally → "${text.slice(0, 80)}"`)

    if (opts.localCache && !e.attachments?.length) {
      const key = cacheKey(await $.session.cwd(), text)
      const now = await $.clock.now()
      const hit = isFresh ? undefined : lookup(((await $.store.get(STORE.answers)) ?? {}) as AnswerCache, key, now)
      if (hit) {
        await countFreeAnswer($)
        await count($, { cacheHits: 1 })
        await record($, 'saved', `answered from the local cache (${age(now - hit.at)} old): 0 tokens, Claude not called`)
        return {
          drop: `[quota-saver: saved answer, 0 tokens, from ${age(now - hit.at)} ago. Start with ! for a fresh answer]\n\n${hit.answer}`,
        }
      }
      turn.key = key
    }

    const localPrompt = isFresh ? undefined : routeLocal(text, cfg.local)
    if (localPrompt !== undefined) {
      $.ui.status(`quota-saver: local model (${cfg.localModel}) is thinking…`)
      await record($, 'local', `no project context needed → asking local model ${cfg.localModel}`)
      const startedAt = await $.clock.now()
      const reply = await askLocal($, opts.ollamaUrl, cfg.localModel, localPrompt)
      const secs = Math.round(((await $.clock.now()) - startedAt) / 100) / 10
      $.ui.status(undefined)
      if (reply.isAnswered) {
        await countFreeAnswer($)
        await count($, { localAnswers: 1 })
        await record($, 'saved', `local model answered in ${secs}s: 0 Claude tokens`)
        return {
          drop: `[quota-saver: local model ${cfg.localModel}, 0 Claude tokens. Start with ! to ask Claude instead]\n\n${reply.text}`,
        }
      }
      $.ui.toast(`Local model failed: ${reply.reason}. Asking Claude instead.`)
      await record($, 'error', `local model failed (${reply.reason}) → falling back to Claude`)
    }

    const sent = localPrompt ?? text
    const intent = opts.autoIntent ? detectIntent(sent) : undefined
    const context = intent ? [...(e.context ?? []), GUIDE[intent]] : e.context
    if (intent) await record($, 'info', `task looks like "${intent}" → lean ${intent} guide attached (shorter work and reply)`)
    await record($, 'claude', 'sent to Claude')
    return next({ ...e, text: sent, ...(context ? { context } : {}) })
  }).catch(($, e, next) => next(e))

  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined) state.turn.toolCalls += 1
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
