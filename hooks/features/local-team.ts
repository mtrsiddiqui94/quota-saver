// The local team: a fast model for short questions, a strong one for the rest
// and as a second opinion. Every reply is judged; one that is unusable (wrong
// script, a loop, nothing) goes to the other model, and only when neither
// gives a usable answer does the question go to Claude.

import type { EngineInterface } from 'claude-code'

import { record } from '../core/activity'
import { saveSettings, state } from '../core/state'
import type { Options } from '../core/state'
import { judgeReply } from '../lib/judge'
import type { Verdict } from '../lib/judge'
import { askLocal, listLocalModelSizes } from '../lib/local'

// Past this many characters a question is not "short": the strong model takes it first.
const SHORT = 120

export type TeamAnswer =
  | { isAnswered: true; text: string; model: string; secs: number; isLanguageMatch: boolean }
  | { isAnswered: false; reason: string }

/** Who answers first and who gives the second opinion. */
export function teamOrder(question: string, strong: string, fast: string | undefined): string[] {
  if (!fast || fast === strong) return [strong]
  return question.length <= SHORT ? [fast, strong] : [strong, fast]
}

async function timed($: EngineInterface, opts: Options, model: string, question: string) {
  const startedAt = await $.clock.now()
  const reply = await askLocal($, opts.ollamaUrl, model, question)
  const secs = Math.round(((await $.clock.now()) - startedAt) / 100) / 10
  return { reply, secs }
}

export async function answerLocally($: EngineInterface, opts: Options, question: string): Promise<TeamAnswer> {
  const { cfg } = state
  const order = teamOrder(question, cfg.localModel, cfg.fastModel)
  let fallback: TeamAnswer | undefined
  const reasons: string[] = []

  for (const [i, model] of order.entries()) {
    const { reply, secs } = await timed($, opts, model, question)
    if (!reply.isAnswered) {
      reasons.push(`${model}: ${reply.reason}`)
      await record($, 'error', `${model} failed (${reply.reason})${i + 1 < order.length ? ` → asking ${order[i + 1]}` : ''}`)
      continue
    }
    const verdict: Verdict = judgeReply(question, reply.text)
    if (!verdict.isUsable) {
      reasons.push(`${model}: ${verdict.reason}`)
      await record($, 'error', `${model} answered in ${secs}s but ${verdict.reason}${i + 1 < order.length ? ` → asking ${order[i + 1]}` : ''}`)
      continue
    }
    const answer: TeamAnswer = { isAnswered: true, text: reply.text, model, secs, isLanguageMatch: verdict.isLanguageMatch }
    if (verdict.isLanguageMatch || i + 1 === order.length) return fallback && !verdict.isLanguageMatch ? fallback : answer
    // Usable but in the other language: keep it, and see whether the next model matches.
    fallback = answer
    await record($, 'local', `${model} answered in ${secs}s in another language → asking ${order[i + 1]} for a better match`)
  }
  return fallback ?? { isAnswered: false, reason: reasons.join('; ') || 'no local model answered' }
}

// The probes /local pick runs on each model: a plain fact, Roman Urdu, and a technical comparison.
const PROBES = [
  'What is an API? Answer in 2 lines.',
  'docker kya hai? 2 lines mein batao',
  'git merge aur rebase mein kya farq hai? mukhtasar batao',
]

// Above this average a model is too slow to be worth answering locally.
const TOO_SLOW_SECS = 25

export type ModelScore = { model: string; size: number; secs: number; usable: number; matched: number }

/** Picks the team from measured scores: fast = quickest that answered every probe; strong = best answers, then the larger. */
export function pickTeam(scores: readonly ModelScore[]): { fast?: string; strong?: string } {
  const good = scores.filter(s => s.usable === PROBES.length && s.secs <= TOO_SLOW_SECS)
  if (good.length === 0) return {}
  const strong = [...good].sort((a, b) => b.matched - a.matched || b.size - a.size || a.secs - b.secs)[0]
  const fast = [...good].sort((a, b) => a.secs - b.secs || b.matched - a.matched)[0]
  return { strong: strong?.model, fast: fast && strong && fast.model !== strong.model && fast.secs < strong.secs * 0.7 ? fast.model : undefined }
}

/** /local pick: measures every installed model on this machine and sets the team. */
export async function runPick($: EngineInterface, opts: Options): Promise<string> {
  const models = await listLocalModelSizes($, opts.ollamaUrl)
  if (!models || models.length === 0) return 'No local models installed. Run /local on first.'

  const scores: ModelScore[] = []
  for (const m of models) {
    $.ui.status(`quota-saver: testing ${m.name}…`)
    await record($, 'setup', `testing ${m.name} on ${PROBES.length} questions`)
    // Load it once so the first probe does not pay the loading time.
    await askLocal($, opts.ollamaUrl, m.name, 'hi', undefined, 1)
    let total = 0
    let usable = 0
    let matched = 0
    for (const probe of PROBES) {
      const { reply, secs } = await timed($, opts, m.name, probe)
      total += secs
      if (!reply.isAnswered) continue
      const v = judgeReply(probe, reply.text)
      if (v.isUsable) usable += 1
      if (v.isUsable && v.isLanguageMatch) matched += 1
    }
    scores.push({ model: m.name, size: m.size, secs: Math.round((total / PROBES.length) * 10) / 10, usable, matched })
  }
  $.ui.status(undefined)

  const team = pickTeam(scores)
  const table = scores
    .sort((a, b) => a.secs - b.secs)
    .map(s => `  ${s.model.padEnd(18)} ${`${s.secs}s`.padStart(6)} avg   ${s.usable}/${PROBES.length} usable   ${s.matched}/${PROBES.length} right language   ${(s.size / 1e9).toFixed(1)} GB`)
  if (!team.strong) {
    return ['Local models on this machine:', '', ...table, '', `None answered every test well enough (or each took over ${TOO_SLOW_SECS}s). The team was not changed.`].join('\n')
  }
  state.cfg.localModel = team.strong
  state.cfg.fastModel = team.fast
  state.cfg.isModelChosen = true
  await saveSettings($)
  await record($, 'setup', `team picked: strong ${team.strong}${team.fast ? `, fast ${team.fast}` : ''}`)
  return [
    'Local models on this machine:',
    '',
    ...table,
    '',
    `Team: strong = ${team.strong}${team.fast ? `, fast = ${team.fast} (short questions)` : ' (answers everything; no model was clearly faster)'}`,
    'Every local answer is checked; a bad one goes to the other model, then to Claude.',
  ].join('\n')
}
