// The switches and the personal dictionary: /quota-saver, /local, /shortcut, /forget.

import type { EngineInterface, Hook, On } from 'claude-code'

import { listLocalModels } from '../lib/local'
import { parseEntry } from '../lib/memory'
import type { Dictionary } from '../lib/memory'
import { humanMinutes, minutesToFull } from '../lib/burn'
import { formatK, tokens } from '../lib/trim'
import { record } from '../core/activity'
import { daily, dayOf, EMPTY_STATS, ensureLoaded, lifetime, saveSettings, state, STORE } from '../core/state'
import type { Stats } from '../core/state'
import { audit, formatAudit } from './audit'
import type { Options } from '../core/state'
import { ensureLocal, hasModel, setup } from './local-setup'
import { runPick } from './local-team'
import type { SetupOutcome } from './local-setup'
import { refreshStatus } from './meter'

const LOCAL_OUTCOME: Record<SetupOutcome, (model: string, how: string, url: string) => string> = {
  ready: (model, how) => `Local model is on (${model}). ${how}`,
  started: (model, how) =>
    `Local model setup started: getting Ollama and "${model}" ready. Progress shows in the chat; the first time takes a few minutes. Local mode turns on by itself when ready.\n${how}`,
  running: () => 'Local setup is already running. Type /local to see where it is.',
  declined: () => 'OK, nothing was installed. Type /local on whenever you want it.',
  unreachable: (_model, _how, url) => `No Ollama at ${url}. Check the ollamaUrl setting.`,
}

/** What a command answers when its hook fails, in place of failing silently. */
const FAIL = { text: 'quota-saver: this command failed. Please try again.' }

export const COMMANDS = [
  { name: 'quota-saver', description: 'Token savings report; /quota-saver on or off switches the whole plugin', argumentHint: '[on | off | audit | week | month | style lite|full|off]' },
  { name: 'local', description: 'Local model (Ollama): /local on, auto, off, pick (test and set the team), model <name>', argumentHint: '[on | auto | off | pick | model <name>]' },
  { name: 'shortcut', description: 'Your shortcuts: /shortcut dp = deploy to staging. Then type just "dp" or "#dp"', argumentHint: '[name = meaning]' },
  { name: 'forget', description: 'Forget a shortcut, or clear the saved-answer cache', argumentHint: '[name | cache]' },
  { name: 'new-task', description: 'Summarise the session in 12 lines and clear the context (a cheap /compact + /clear)', argumentHint: '[next task, optional]' },
  { name: 'activity', description: 'Watch what Quota Saver does on each prompt: /activity on opens a live terminal, /activity off stops', argumentHint: '[on | off | text]' },
  { name: 'last-task', description: 'Bring back the last session summary: 12 lines instead of the whole history' },
] as const

function compareLines(session: Stats, life: Stats): string[] {
  const line = (label: string, s: Stats) => {
    if (s.baselineTokens === 0) return undefined
    const saved = s.baselineTokens - s.usedTokens
    const pct = Math.round((saved / s.baselineTokens) * 100)
    return `${label} Claude used ${formatK(s.usedTokens)} tokens · without Quota Saver ≈ ${formatK(s.baselineTokens)} · saved ≈ ${formatK(saved)} (${pct}%)`
  }
  return [line('Tokens, this session:', session), line('Tokens, all time:    ', life)].filter((x): x is string => x !== undefined)
}

async function getDictionary($: EngineInterface): Promise<Dictionary> {
  return ((await $.store.get(STORE.dictionary)) ?? {}) as Dictionary
}

// The options of the current load, for the command hooks below.
const ctx = { opts: undefined as unknown as Options }

const reportCommand: Hook<'command.run'> = async ($, e) => {
  await ensureLoaded($)
  const { cfg, session } = state
  const arg = e.args.trim().toLowerCase()
  if (arg === 'on' || arg === 'off') {
    cfg.isEnabled = arg === 'on'
    await saveSettings($)
    await record($, 'info', `Quota Saver switched ${arg}`)
    await refreshStatus($).catch(() => undefined)
    return { text: cfg.isEnabled ? 'Quota Saver is on.' : 'Quota Saver is off: everything works as plain Claude. Turn it back on with /quota-saver on' }
  }

  if (arg === 'audit') return { text: formatAudit(await audit($)) }
  if (arg.startsWith('style')) {
    const level = arg.split(/\s+/)[1]
    if (level !== 'off' && level !== 'lite' && level !== 'full') {
      return { text: `Reply style: ${cfg.style ?? 'off'}. Set it with /quota-saver style lite (shorter), full (telegraphic, fewest output tokens) or off.` }
    }
    cfg.style = level
    await saveSettings($)
    await record($, 'info', `reply style set to ${level}`)
    return { text: `Reply style: ${level}. ${level === 'off' ? 'Normal lean replies.' : level === 'lite' ? 'Short, plain replies.' : 'Telegraphic replies; code, paths and errors stay exact.'}` }
  }
  if (arg === 'week' || arg === 'month') {
    const days = arg === 'week' ? 7 : 30
    const book = await daily($)
    const now = await $.clock.now()
    const rows: string[] = []
    let total = 0
    for (let i = days - 1; i >= 0; i--) {
      const day = dayOf(now - i * 86_400_000)
      const s = { ...EMPTY_STATS, ...book[day] }
      const saved = tokens(s.savedChars)
      total += saved
      rows.push(`  ${day}  ${formatK(saved).padStart(7)} tok  ${String(s.trims).padStart(3)} trims  ${String(s.blockedReads).padStart(3)} reads  ${String(s.cacheHits + s.localAnswers).padStart(3)} free answers`)
    }
    return { text: [`Quota Saver: last ${days} days`, '', ...rows, '', `  Total saved ≈ ${formatK(total)} tokens (output trimming; blocked reads and free answers come on top)`].join('\n') }
  }

  const life = await lifetime($)
  const { context, rateLimits, cost } = await $.session.usage()
  const label = (kind: string) => (kind === 'five_hour' ? '5-hour' : kind === 'seven_day' ? '7-day' : kind)
  const now = await $.clock.now()
  const limits = rateLimits.map(r => {
    const toFull = minutesToFull(state.burn.get(`${r.kind}:${r.resetsAt ?? ''}`) ?? [])
    const resetIn = r.resetsAt ? Math.max(0, Math.round((Date.parse(r.resetsAt) - now) / 60_000)) : undefined
    const pace = toFull !== undefined ? `, full in ~${humanMinutes(toFull)} at this pace` : ''
    const reset = resetIn !== undefined ? `, resets in ${humanMinutes(resetIn)}` : ''
    return `${label(r.kind)}: ${r.percentUsed}%${pace}${reset}`
  })
  const lines = [
    'Quota Saver: token savings',
    '',
    `Status: ${cfg.isEnabled ? 'on' : 'OFF (/quota-saver on)'} · local model: ${cfg.local}${cfg.local === 'off' ? '' : ` (${cfg.localModel})`}`,
    '',
    `This session: ~${formatK(tokens(session.savedChars))} tokens saved (${session.trims} outputs shortened, ${session.blockedReads} wasteful reads stopped, ${session.cacheHits} saved answers, ${session.localAnswers} local model answers)`,
    ...compareLines(session, life),
    `All time:     ~${formatK(tokens(life.savedChars))} tokens saved (${life.trims} outputs, ${life.blockedReads} reads, ${life.cacheHits} saved answers, ${life.localAnswers} local model)`,
    '',
    `Context: ${context.percent !== undefined ? `${context.percent}% of ${formatK(context.window)}` : 'no reading yet'}`,
    ...(limits.length ? [`Quota:   ${limits.join(' · ')}`] : []),
    ...(cost ? [`Cost:    $${cost.usd.toFixed(2)}`] : []),
    '',
    'Nothing to remember: write normally, the plugin works out the rest.',
    'New task? /new-task · Back tomorrow? /last-task · Shortcuts? /shortcut · Local model? /local',
    'Reports: /quota-saver week · /quota-saver audit (what every request carries) · /activity on (watch it live)',
    'Off/on: /quota-saver off · /quota-saver on',
  ]
  return { text: lines.join('\n') }
}

const localCommand: Hook<'command.run'> = async ($, e) => {
  await ensureLoaded($)
  const { cfg } = state
  const [word = '', ...rest] = e.args.trim().split(/\s+/)
  const arg = word.toLowerCase()
  if (arg === 'off') {
    cfg.local = 'off'
    await saveSettings($)
    await refreshStatus($).catch(() => undefined)
    return { text: 'Local model is off. Everything goes to Claude.' }
  }
  if (arg === 'on' || arg === 'auto') {
    const how =
      arg === 'on'
        ? 'Prompts that start with ~ (for example: ~what is docker) run on your machine, 0 Claude tokens.'
        : 'Besides ~ prompts, general questions (ones that do not mention your project or files) go to the local model by themselves.'
    const outcome = await ensureLocal($, ctx.opts, arg)
    await refreshStatus($).catch(() => undefined)
    return { text: LOCAL_OUTCOME[outcome](cfg.localModel, how, ctx.opts.ollamaUrl) }
  }
  if (arg === 'pick') return { text: await runPick($, ctx.opts) }
  if (arg === 'model') {
    const name = rest.join(' ').trim()
    if (!name) return { text: 'Format: /local model qwen3:4b' }
    cfg.localModel = name
    cfg.fastModel = undefined
    cfg.urduModel = undefined
    cfg.isModelChosen = true
    await saveSettings($)
    if (cfg.local === 'off') return { text: `Local model is now ${name}. Turn it on with /local on` }
    const outcome = await ensureLocal($, ctx.opts, cfg.local)
    return { text: LOCAL_OUTCOME[outcome](name, `Local model is now ${name}.`, ctx.opts.ollamaUrl) }
  }

  if (setup.isRunning) {
    const minutes = Math.max(0, Math.round(((await $.clock.now()) - setup.startedAt) / 60000))
    return {
      text: `Local setup is running (for ${minutes} min).\nNow: ${setup.step}${setup.pct === undefined ? '' : ` ${setup.pct}%`}\n\nLocal mode turns on by itself when it is ready. Type /local again to check.`,
    }
  }

  const models = await listLocalModels($, ctx.opts.ollamaUrl)
  const header = `Local mode: ${cfg.local} · team: strong ${cfg.localModel}${cfg.fastModel ? `, fast ${cfg.fastModel}` : ''}${cfg.urduModel ? `, Roman Urdu ${cfg.urduModel}` : ''}`
  if (models === undefined) {
    return { text: `${header}\nOllama is not running.\n\nType /local on: the plugin installs Ollama, downloads the model and turns it on for you.` }
  }
  return {
    text: `${header}\nOllama is running. Models: ${models.join(', ') || 'none'}${hasModel(models, cfg.localModel) ? '' : `\n"${cfg.localModel}" is not downloaded yet: /local on downloads it.`}\n\n/local on · /local auto · /local off · /local model <naam>`,
  }
}

const shortcutCommand: Hook<'command.run'> = async ($, e) => {
  const dict = await getDictionary($)
  const args = e.args.trim()
  if (args === '') {
    const names = Object.keys(dict).sort()
    return {
      text: names.length
        ? `Your shortcuts (${names.length}):\n${names.map(n => `  ${n} = ${dict[n]}`).join('\n')}\n\nUse: type just the name, or #name inside a sentence.`
        : 'No shortcuts yet. Example: /shortcut dp = deploy to staging, run the tests first',
    }
  }
  const entry = parseEntry(args)
  if (!entry) return { text: 'Format: /shortcut name = full meaning   (the name takes letters, numbers, - and _ only)' }
  await $.store.set(STORE.dictionary, { ...dict, [entry.key]: entry.value })
  return { text: `Saved: typing "${entry.key}" or "#${entry.key}" now means → ${entry.value}` }
}

const forgetCommand: Hook<'command.run'> = async ($, e) => {
  const name = e.args.trim().toLowerCase().replace(/^#/, '')
  if (name === 'cache') {
    await $.store.delete(STORE.answers)
    return { text: 'Saved-answer cache cleared.' }
  }
  const dict = await getDictionary($)
  if (!(name in dict)) return { text: `"${name}" is not a shortcut. Type /shortcut to see the list.` }
  const { [name]: _gone, ...rest } = dict
  await $.store.set(STORE.dictionary, rest)
  return { text: `Forgot "${name}".` }
}

export function installCommands(on: On, opts: Options) {
  ctx.opts = opts
  on('command.run', { command: 'quota-saver' }, reportCommand).catch(() => FAIL)
  on('command.run', { command: 'quota-saver:status' }, reportCommand).catch(() => FAIL)

  on('command.run', { command: 'local' }, localCommand).catch(() => FAIL)
  on('command.run', { command: 'quota-saver:local' }, localCommand).catch(() => FAIL)

  on('command.run', { command: 'shortcut' }, shortcutCommand).catch(() => FAIL)
  on('command.run', { command: 'quota-saver:shortcut' }, shortcutCommand).catch(() => FAIL)

  on('command.run', { command: 'forget' }, forgetCommand).catch(() => FAIL)
  on('command.run', { command: 'quota-saver:forget' }, forgetCommand).catch(() => FAIL)
}
