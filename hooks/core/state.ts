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
    setupLocalModel: options.setupLocalModel === 'yes' || options.setupLocalModel === 'no' ? options.setupLocalModel : 'ask',
  }
}

export type Stats = {
  savedChars: number
  trims: number
  blockedReads: number
  cacheHits: number
  localAnswers: number
}

const ZERO: Stats = { savedChars: 0, trims: 0, blockedReads: 0, cacheHits: 0, localAnswers: 0 }

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
  /** Whether this context window's fixed cost was audited yet. */
  isAudited: false,
  /** The main loop's model on its last turn, and the context it carried then. */
  lastTurn: undefined as { model: string; contextTokens: number } | undefined,
  /** Quota alarms already raised, as `<window>:<level>`, so each sounds once per reset. */
  quotaWarned: new Set<string>(),
  /** The answer-cache key of the running turn, and whether it changed anything. */
  turn: { hasSideEffects: false } as { key?: string; hasSideEffects: boolean },
}

/** Forgets what belongs to one context window (after /clear or compaction). */
export function resetContext() {
  state.seen.clear()
  state.refused.clear()
  state.warnedAt = 0
  state.isAudited = false
  state.lastTurn = undefined
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

export async function loadSettings($: EngineInterface) {
  Object.assign(state.cfg, DEFAULT_SETTINGS, ((await $.store.get(STORE.settings)) ?? {}) as Partial<Settings>)
}

export async function saveSettings($: EngineInterface) {
  await $.store.set(STORE.settings, state.cfg)
}
