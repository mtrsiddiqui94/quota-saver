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
} as const

export type Options = {
  maxOutputChars: number
  maxReadBytes: number
  dedupeReads: boolean
  autoIntent: boolean
  localCache: boolean
  ollamaUrl: string
  setupLocalModel: 'yes' | 'ask' | 'no'
}

export function parseOptions(options: PluginOptions): Options {
  return {
    maxOutputChars: Math.max(1000, Number(options.maxOutputChars ?? 6000)),
    maxReadBytes: Math.max(8, Number(options.maxReadKB ?? 80)) * 1024,
    dedupeReads: options.dedupeReads !== false,
    autoIntent: options.autoIntent !== false,
    localCache: options.localCache !== false,
    ollamaUrl: String(options.ollamaUrl ?? 'http://localhost:11434'),
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
  /** The answer-cache key of the running turn, and whether it changed anything. */
  turn: { hasSideEffects: false } as { key?: string; hasSideEffects: boolean },
}

/** Forgets what belongs to one context window (after /clear or compaction). */
export function resetContext() {
  state.seen.clear()
  state.refused.clear()
  state.warnedAt = 0
}

export async function count($: EngineInterface, delta: Partial<Stats>) {
  for (const [k, v] of Object.entries(delta) as [keyof Stats, number][]) state.session[k] += v
  const old = { ...ZERO, ...(((await $.store.get(STORE.lifetime)) ?? {}) as Partial<Stats>) }
  for (const [k, v] of Object.entries(delta) as [keyof Stats, number][]) old[k] += v
  await $.store.set(STORE.lifetime, old)
}

export async function lifetime($: EngineInterface): Promise<Stats> {
  return { ...ZERO, ...(((await $.store.get(STORE.lifetime)) ?? {}) as Partial<Stats>) }
}

export async function loadSettings($: EngineInterface) {
  Object.assign(state.cfg, DEFAULT_SETTINGS, ((await $.store.get(STORE.settings)) ?? {}) as Partial<Settings>)
}

export async function saveSettings($: EngineInterface) {
  await $.store.set(STORE.settings, state.cfg)
}
