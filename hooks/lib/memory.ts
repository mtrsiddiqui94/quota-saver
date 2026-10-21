// The local side: a personal dictionary of shortcuts and a cache of answers,
// both kept on this machine so a repeat costs no tokens.

// Roman Urdu is spelled many ways; fold the common variants so "kia ha" and
// "kya hai" are the same question.
const VARIANTS: Record<string, string> = {
  kia: 'kya', kiya: 'kya', ky: 'kya',
  ha: 'hai', hy: 'hai', he: 'hai', hay: 'hai',
  hn: 'hain', hen: 'hain',
  ma: 'main', me: 'main', mein: 'main', mai: 'main', mn: 'main',
  ni: 'nahi', nai: 'nahi', nhi: 'nahi', nahin: 'nahi', nahe: 'nahi',
  bht: 'bohat', bohot: 'bohat', bahut: 'bohat', bhot: 'bohat',
  kr: 'kar', krna: 'karna', kro: 'karo', krdo: 'kardo',
  ap: 'aap', apko: 'aapko',
  q: 'kyun', kyon: 'kyun', kiun: 'kyun',
  k: 'ke', ki: 'ki', ko: 'ko',
  tm: 'tum', tmhain: 'tumhe', tumhain: 'tumhe',
  acha: 'achha', accha: 'achha',
  thk: 'theek', thik: 'theek', theak: 'theek',
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(word => VARIANTS[word] ?? word)
    .join(' ')
}

export type Dictionary = Record<string, string>

/** Parses `/yaad name = meaning`; undefined when the args hold no `=`. */
export function parseEntry(args: string): { key: string; value: string } | undefined {
  const at = args.indexOf('=')
  if (at < 0) return undefined
  const key = args.slice(0, at).trim().toLowerCase().replace(/^#/, '')
  const value = args.slice(at + 1).trim()
  if (!/^[\p{L}\p{N}_-]{1,40}$/u.test(key) || value.length === 0) return undefined
  return { key, value }
}

/**
 * Expands shortcuts: a prompt that is exactly a shortcut becomes its meaning,
 * and `#name` anywhere in a prompt is replaced by its meaning.
 */
export function expand(text: string, dict: Dictionary): string {
  const whole = dict[text.trim().toLowerCase()]
  if (whole !== undefined) return whole
  return text.replace(/#([\p{L}\p{N}_-]{1,40})/gu, (match, name: string) => dict[name.toLowerCase()] ?? match)
}

export type CachedAnswer = {
  answer: string
  at: number
  /** The question as typed, shown on a similar-question hit. */
  q?: string
  /** The question's embedding, for similar-question lookups (rounded to 3 decimals). */
  vec?: number[]
}
export type AnswerCache = Record<string, CachedAnswer>

export const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const CACHE_MAX = 150
export const ANSWER_MAX = 3500

export function cacheKey(cwd: string, text: string): string {
  return `${cwd}\n${normalize(text)}`
}

/** Adds an answer, dropping expired entries and the oldest past the cap. */
export function remember(
  cache: AnswerCache,
  key: string,
  answer: string,
  now: number,
  extra: { q?: string; vec?: number[] } = {},
): AnswerCache {
  const kept = Object.entries(cache).filter(([, v]) => now - v.at < CACHE_TTL_MS)
  kept.push([key, { answer, at: now, ...(extra.q ? { q: extra.q } : {}), ...(extra.vec ? { vec: extra.vec.map(x => Math.round(x * 1000) / 1000) } : {}) }])
  kept.sort((a, b) => a[1].at - b[1].at)
  return Object.fromEntries(kept.slice(-CACHE_MAX))
}

export function lookup(cache: AnswerCache, key: string, now: number): CachedAnswer | undefined {
  const hit = cache[key]
  return hit && now - hit.at < CACHE_TTL_MS ? hit : undefined
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/** Similarity a cached question must reach to answer a new one (cosine; research puts the safe range at 0.8-0.97). */
export const SIMILAR = 0.92

/** The cached answer to the most similar earlier question in this project, if similar enough. */
export function nearest(
  cache: AnswerCache,
  cwd: string,
  vec: readonly number[],
  now: number,
  threshold = SIMILAR,
): { hit: CachedAnswer; score: number } | undefined {
  let best: { hit: CachedAnswer; score: number } | undefined
  for (const [key, v] of Object.entries(cache)) {
    if (!key.startsWith(`${cwd}\n`) || !v.vec || now - v.at >= CACHE_TTL_MS) continue
    const score = cosine(vec, v.vec)
    if (score >= threshold && (!best || score > best.score)) best = { hit: v, score }
  }
  return best
}
