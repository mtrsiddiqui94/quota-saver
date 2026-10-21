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

export type CachedAnswer = { answer: string; at: number }
export type AnswerCache = Record<string, CachedAnswer>

export const CACHE_TTL_MS = 3 * 24 * 60 * 60 * 1000
export const CACHE_MAX = 150
export const ANSWER_MAX = 3500

export function cacheKey(cwd: string, text: string): string {
  return `${cwd}\n${normalize(text)}`
}

/** Adds an answer, dropping expired entries and the oldest past the cap. */
export function remember(cache: AnswerCache, key: string, answer: string, now: number): AnswerCache {
  const kept = Object.entries(cache).filter(([, v]) => now - v.at < CACHE_TTL_MS)
  kept.push([key, { answer, at: now }])
  kept.sort((a, b) => a[1].at - b[1].at)
  return Object.fromEntries(kept.slice(-CACHE_MAX))
}

export function lookup(cache: AnswerCache, key: string, now: number): CachedAnswer | undefined {
  const hit = cache[key]
  return hit && now - hit.at < CACHE_TTL_MS ? hit : undefined
}
