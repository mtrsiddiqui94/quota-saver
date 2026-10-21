// Learns the Roman Urdu words a person uses that the built-in list misses.
// A word counts as Urdu once it has turned up in a few Roman Urdu prompts and
// hardly ever in English ones; common English and coding words are never learned.

import { isKnownUrdu, language } from './prompt'

export type WordStats = Record<string, { u: number; e: number }>

const MIN_SEEN = 3
const MAX_WORDS = 1500

const ENGLISH = new Set(
  ('a an the and or but if so to of in on at by for with from as is are was were be been it its this that these those ' +
    'i me my we our you your he she they them his her not no yes do does did done can could will would should may ' +
    'all any some new old one two get got set use used run make made add fix test build push pull update delete ' +
    'remove create show open close start stop save load file files code app page home login logout user users ' +
    'button form list table data api server client error errors bug issue plugin model token tokens word words ' +
    'git npm node react vite next css html js ts json src main dev prod please thanks ok okay now then also just ' +
    'more less same other into out up down over here there what when where why how which who')
    .split(' '),
)

const candidates = (text: string) =>
  [...new Set(text.toLowerCase().split(/\s+/))].filter(
    (w) => /^[a-z]{1,14}$/.test(w) && !ENGLISH.has(w) && !isKnownUrdu(w),
  )

/** Counts the prompt's words under its language; returns the words that just became Urdu. */
export function learnWords(stats: WordStats, text: string): { stats: WordStats; added: string[] } {
  const label = language(text)
  if (label === 'mixed') return { stats, added: [] }
  const before = learnedWords(stats)
  const next: WordStats = { ...stats }
  for (const w of candidates(text)) {
    const s = next[w] ?? { u: 0, e: 0 }
    next[w] = label === 'Roman Urdu' ? { u: s.u + 1, e: s.e } : { u: s.u, e: s.e + 1 }
  }
  const keys = Object.keys(next)
  if (keys.length > MAX_WORDS) {
    const seen = (w: string) => (next[w]?.u ?? 0) + (next[w]?.e ?? 0)
    keys.sort((a, b) => seen(a) - seen(b))
    for (const w of keys.slice(0, keys.length - MAX_WORDS)) delete next[w]
  }
  const added = [...learnedWords(next)].filter((w) => !before.has(w))
  return { stats: next, added }
}

/** The words seen often enough in Roman Urdu, and rarely enough in English, to count as Urdu. */
export function learnedWords(stats: WordStats): Set<string> {
  return new Set(
    Object.entries(stats)
      .filter(([, s]) => s.u >= MIN_SEEN && s.u >= 3 * s.e)
      .map(([w]) => w),
  )
}
