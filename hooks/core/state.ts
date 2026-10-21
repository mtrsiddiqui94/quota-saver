// What the features share: the parsed options, the per-process state, and the
// values kept in the plugin's store across sessions.

import type { EngineInterface, PluginOptions } from 'claude-code'

import { DEFAULT_SETTINGS } from '../lib/local'
import type { Settings } from '../lib/local'

export const STORE = {
  lifetime: 'lifetime',
  handoff: 'handoff',
  dictionary: 'dictionary',
  answers: 'answers',
  settings: 'settings',
  daily: 'daily',
  projectNotes: 'projectNotes',
  words: 'words',
} as const

export type Options = {
  maxOutputChars: number
  maxReadBytes: number
  dedupeReads: boolean
  autoIntent: boolean
  localCache: boolean
  ollamaUrl: string
  setupLocalModel: 'yes' | 'ask' | 'no'
  guardJunk: boolean
  modelAdvisor: boolean
  semanticCache: boolean
}

export function parseOptions(options: PluginOptions): Options {
  return {
    maxOutputChars: Math.max(1000, Number(options.maxOutputChars ?? 6000)),
    maxReadBytes: Math.max(8, Number(options.maxReadKB ?? 80)) * 1024,
    dedupeReads: options.dedupeReads !== false,
    autoIntent: options.autoIntent !== false,
    localCache: options.localCache !== false,
    ollamaUrl: String(options.ollamaUrl ?? 'http://localhost:11434'),
    guardJunk: options.guardJunk !== false,
    modelAdvisor: options.modelAdvisor !== false,
    semanticCache: options.semanticCache !== false,
    setupLocalModel: options.setupLocalModel === 'yes' || options.setupLocalModel === 'no' ? options.setupLocalModel : 'ask',
  }
}

export type Stats = {
  savedChars: number
  trims: number
  blockedReads: number
  cacheHits: number
  localAnswers: number
  /** Tokens Claude actually processed (API-reported, input and output). */
  usedTokens: number
  /** Estimated tokens the same work would have taken without the plugin. */
  baselineTokens: number
}

const ZERO: Stats = { savedChars: 0, trims: 0, blockedReads: 0, cacheHits: 0, localAnswers: 0, usedTokens: 0, baselineTokens: 0 }

// Per-process state. A hot reload starts it over, which only resets counters.
export const state = {
  cfg: { ...DEFAULT_SETTINGS } as Settings,
  session: { ...ZERO } as Stats,
  /** Read key -> mtime when it was read, for the current context window. */
  seen: new Map<string, number>(),
  /** Reads refused once; an identical retry goes through. */
  refused: new Set<string>(),
  /** The highest context warning shown in this context window. */
  warnedAt: 0,
  /** A handoff note waiting for the next /clear, and the one in force now. */
  handoff: {} as { pending?: string; active?: string },
  /** The main loop's model, as the last system prompt was composed for it. */
  currentModel: undefined as string | undefined,
  /** Model advice already given in this context window, by suggested model. */
  advised: new Set<string>(),
  /** Whether this context window's fixed cost was audited yet. */
  isAudited: false,
  /** The main loop's model on its last turn, and the context it carried then. */
  lastTurn: undefined as { model: string; contextTokens: number } | undefined,
  /** Quota readings per window (`<kind>:<resetsAt>`), for the burn rate. */
  burn: new Map<string, { at: number; pct: number }[]>(),
  /** Near the quota limit with a local model on: general questions go local by themselves (as /local auto). */
  isQuotaMode: false,
  /** Quota alarms already raised, as `<window>:<level>`, so each sounds once per reset. */
  quotaWarned: new Set<string>(),
  /** The answer-cache key of the running turn, and whether it changed anything. */
  turn: { hasSideEffects: false, toolCalls: 0, keptOutAtStart: 0 } as {
    key?: string
    /** The typed question and its embedding, kept with the answer for similar-question hits. */
    question?: string
    vec?: number[]
    hasSideEffects: boolean
    /** Main-loop tool calls this turn: each is followed by one more request. */
    toolCalls: number
    keptOutAtStart: number
  },
  /** Tokens kept out of the live context (shortened output, refused reads): absent from every request from then on. */
  keptOut: 0,
  /** Refused reads by key, with the tokens they kept out, until a retry lets them in. */
  pendingBlocked: new Map<string, number>(),
}

/** Forgets what belongs to one context window (after /clear or compaction). */
export function resetContext() {
  state.seen.clear()
  state.refused.clear()
  state.warnedAt = 0
  state.isAudited = false
  state.advised.clear()
  state.lastTurn = undefined
  state.keptOut = 0
  state.pendingBlocked.clear()
}

export type Daily = Record<string, Stats>

/** The local calendar day of a timestamp, as YYYY-MM-DD. */
export function dayOf(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const DAYS_KEPT = 60

export async function count($: EngineInterface, delta: Partial<Stats>) {
  const add = (into: Stats) => {
    for (const [k, v] of Object.entries(delta) as [keyof Stats, number][]) into[k] += v
  }
  add(state.session)
  const old = { ...ZERO, ...(((await $.store.get(STORE.lifetime)) ?? {}) as Partial<Stats>) }
  add(old)
  await $.store.set(STORE.lifetime, old)

  const today = dayOf(await $.clock.now())
  const daily = ((await $.store.get(STORE.daily)) ?? {}) as Daily
  const day = { ...ZERO, ...daily[today] }
  add(day)
  const kept = Object.fromEntries(Object.entries({ ...daily, [today]: day }).sort(([a], [b]) => a.localeCompare(b)).slice(-DAYS_KEPT))
  await $.store.set(STORE.daily, kept)
}

export async function daily($: EngineInterface): Promise<Daily> {
  return ((await $.store.get(STORE.daily)) ?? {}) as Daily
}

export const EMPTY_STATS: Stats = ZERO

export async function lifetime($: EngineInterface): Promise<Stats> {
  return { ...ZERO, ...(((await $.store.get(STORE.lifetime)) ?? {}) as Partial<Stats>) }
}

const loaded = { isDone: false }

/** Loads the settings once, on first use: session.start may not have run (a reload, a test). */
export async function ensureLoaded($: EngineInterface) {
  if (!loaded.isDone) await loadSettings($)
}

export async function loadSettings($: EngineInterface) {
  loaded.isDone = true
  const saved = ((await $.store.get(STORE.settings)) ?? {}) as Partial<Settings>
  Object.assign(state.cfg, DEFAULT_SETTINGS, saved)
  // A model nobody picked is the default of the version that saved it: use today's default instead.
  if (!saved.isModelChosen) state.cfg.localModel = DEFAULT_SETTINGS.localModel
}

export async function saveSettings($: EngineInterface) {
  await $.store.set(STORE.settings, state.cfg)
}
