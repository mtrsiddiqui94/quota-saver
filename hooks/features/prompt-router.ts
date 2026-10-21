// The local side of every prompt, before anything goes online:
//   1. shortcuts from the personal dictionary expand;
//   2. a question answered before is answered from the local cache (0 tokens);
//   3. a question that needs no project context goes to the local model, if on;
//   4. otherwise the lean guide for its kind of task rides along.
// A leading ! skips 2 and 3 and sends the prompt to Claude as is.

import type { Args, EngineInterface, On } from 'claude-code'

import { detectIntent, GUIDE, GUIDE_SUMMARY } from '../lib/intent'
import { language, replaceWords, useLearned, userWords } from '../lib/prompt'
import { learnedWords, learnWords } from '../lib/learn'
import type { WordStats } from '../lib/learn'
import { tokens } from '../lib/trim'
import { embed, routeLocal } from '../lib/local'
import { EMBED_MODEL } from './local-setup'
import { answerLocally, teamOrder } from './local-team'
import { noteCacheOnSubmit } from './cache-keeper'
import { adviseModel } from './model-advisor'
import { ANSWER_MAX, cacheKey, expand, lookup, nearest, remember } from '../lib/memory'
import type { AnswerCache, Dictionary } from '../lib/memory'
import { k, record } from '../core/activity'
import { count, ensureLoaded, state, STORE } from '../core/state'
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
  await record($, 'saved', `this message cost 0 tokens · without Quota Saver it would cost about ${k(baseline)}`)
}

/** Updates the person's learned Roman Urdu words from this prompt and puts them to use. */
async function learnLanguage($: EngineInterface, words: string): Promise<string[]> {
  const old = ((await $.store.get(STORE.words)) ?? {}) as WordStats
  const { stats, added } = learnWords(old, words)
  await $.store.set(STORE.words, stats)
  useLearned(learnedWords(stats))
  return added
}

function age(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60000))
  return minutes < 60 ? `${minutes} min` : `${Math.round(minutes / 60)} h`
}

export function installPromptRouter(on: On, opts: Options) {
  on('prompt.submit', async ($, e, next) => {
    await ensureLoaded($)
    if (state.cfg.isEnabled && !e.command && !e.isMeta) await noteCacheOnSubmit($).catch(() => undefined)
    const { cfg, turn } = state
    turn.key = undefined
    turn.question = undefined
    turn.vec = undefined
    turn.hasSideEffects = false
    turn.toolCalls = 0
    turn.keptOutAtStart = state.keptOut
    if (!cfg.isEnabled || e.command || e.isMeta) return next(e)

    // Judge, cache and show only what the person typed; editor blocks around it go to Claude untouched.
    const dict = ((await $.store.get(STORE.dictionary)) ?? {}) as Dictionary
    const rawWords = userWords(e.text)
    const isFresh = rawWords.startsWith('!')
    const typed = isFresh ? rawWords.slice(1).trim() : rawWords
    const words = expand(typed, dict)
    const hostTokens = tokens(Math.max(0, e.text.length - rawWords.length))
    const learned = await learnLanguage($, words)
    await record(
      $,
      'prompt',
      `"${words.slice(0, 100)}" (${language(words)}, about ${k(tokens(words.length))} tokens)` +
        (hostTokens > 50 ? ` + ${k(hostTokens)} tokens added by the editor` : '') +
        (isFresh ? ' · starts with ! so a fresh answer is fetched' : ''),
    )
    if (learned.length) await record($, 'info', `learned new Roman Urdu word${learned.length === 1 ? '' : 's'}: ${learned.join(', ')}`)
    if (words !== typed) await record($, 'saved', `your shortcut "${typed}" became "${words.slice(0, 80)}"`)

    if (opts.localCache && !e.attachments?.length) {
      const key = cacheKey(await $.session.cwd(), words)
      const now = await $.clock.now()
      const hit = isFresh ? undefined : lookup(((await $.store.get(STORE.answers)) ?? {}) as AnswerCache, key, now)
      if (hit) {
        await countFreeAnswer($)
        await count($, { cacheHits: 1 })
        await record($, 'saved', `same question was answered ${age(now - hit.at)} ago, so that saved answer was shown and Claude was not used`)
        return {
          drop: `[quota-saver: saved answer, 0 tokens, from ${age(now - hit.at)} ago. Start with ! for a fresh answer]\n\n${hit.answer}`,
        }
      }
      turn.key = key
      turn.question = words
      // Similar, not identical: a small local embedding model compares meanings.
      // A fresh (!) question skips the lookup but is still embedded, so its answer can serve later ones.
      if (cfg.local !== 'off' && opts.semanticCache) {
        const cwd = await $.session.cwd()
        const vec = await embed($, opts.ollamaUrl, cfg.embedModel ?? EMBED_MODEL, words)
        if (vec) turn.vec = vec
        if (vec && !isFresh) {
          const near = nearest(((await $.store.get(STORE.answers)) ?? {}) as AnswerCache, cwd, vec, now)
          if (near) {
            await countFreeAnswer($)
            await count($, { cacheHits: 1 })
            await record($, 'saved', `a very similar question (${Math.round(near.score * 100)}% alike) was answered ${age(now - near.hit.at)} ago, so that saved answer was shown and Claude was not used`)
            return {
              drop: `[quota-saver: saved answer to a similar question${near.hit.q ? `, "${near.hit.q.slice(0, 80)}"` : ''} (${Math.round(near.score * 100)}% alike), 0 tokens. Start with ! for a fresh answer]\n\n${near.hit.answer}`,
            }
          }
        }
      }
    }

    const mode = state.isQuotaMode && cfg.local === 'on' ? 'auto' : cfg.local
    if (mode !== cfg.local) await record($, 'info', 'quota almost finished, so general questions now go to the free local model')
    const localPrompt = isFresh ? undefined : routeLocal(words, mode)
    if (localPrompt !== undefined) {
      const first = teamOrder(localPrompt, cfg.localModel, cfg.fastModel, cfg.urduModel)[0]
      $.ui.status(`quota-saver: local model (${first}) is thinking…`)
      await record($, 'local', `general question, so the free local model (${first}) will try first`)
      const reply = await answerLocally($, opts, localPrompt)
      $.ui.status(undefined)
      if (reply.isAnswered) {
        await countFreeAnswer($)
        await count($, { localAnswers: 1 })
        await record($, 'saved', `free local model ${reply.model} answered in ${reply.secs}s, Claude not used (0 tokens)${reply.isLanguageMatch ? '' : ' (reply is in another language)'}`)
        return {
          drop: `[quota-saver: local model ${reply.model}, 0 Claude tokens. Start with ! to ask Claude instead]\n\n${reply.text}`,
        }
      }
      $.ui.toast(`No usable local answer (${reply.reason}). Asking Claude instead.`)
      await record($, 'error', `local model could not answer (${reply.reason}), so Claude will answer`)
    }

    const sentWords = localPrompt ?? words
    const text = replaceWords(e.text, rawWords, sentWords)
    const intent = opts.autoIntent ? detectIntent(sentWords) : undefined
    const context = intent ? [...(e.context ?? []), GUIDE[intent]] : e.context
    if (opts.modelAdvisor) await adviseModel($, intent, sentWords).catch(() => undefined)
    if (intent) {
      await record(
        $,
        'info',
        `looks like a "${intent}" task, so Claude got short tips for it (+${k(tokens(GUIDE[intent].length))} tokens): ${GUIDE_SUMMARY[intent]}`,
      )
    }
    await record($, 'claude', 'sent to Claude')
    return next({ ...e, text, ...(context ? { context } : {}) })
  }).catch(($, e, next) => next(e))

  on('tool.call', ($, e, next) => {
    if (e.agentId === undefined) state.turn.toolCalls += 1
    if (e.agentId === undefined && MUTATING.has(String(e.tool))) state.turn.hasSideEffects = true
    return next(e)
  }).catch(($, e, next) => next(e))
}

/** At the end of a main-loop turn: keeps its answer when it is safe to replay. */
export async function rememberAnswer($: EngineInterface, e: Args<'turn.complete'>) {
  const { key, hasSideEffects, question, vec } = state.turn
  state.turn.key = undefined
  state.turn.vec = undefined
  const isReplayable =
    state.cfg.isEnabled && key !== undefined && e.reason === 'answer' && !hasSideEffects &&
    e.answer.length > 0 && e.answer.length <= ANSWER_MAX
  if (!isReplayable) return
  const cache = ((await $.store.get(STORE.answers)) ?? {}) as AnswerCache
  await $.store.set(STORE.answers, remember(cache, key, e.answer, await $.clock.now(), { q: question, vec }))
}
