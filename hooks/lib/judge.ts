// Small local models fail in recognisable ways: an empty or one-word reply,
// a reply in the wrong script (Persian or Chinese to a Roman Urdu question),
// or a loop of the same words. This tells a usable reply from those.

import { language } from './prompt'

export type Verdict = {
  isUsable: boolean
  /** The reply is in the asker's language (Roman Urdu asked, Roman Urdu answered). */
  isLanguageMatch: boolean
  reason?: string
}

const LETTER = /\p{L}/gu
const LATIN = /\p{Script=Latin}/gu

function latinShare(text: string): number {
  const letters = (text.match(LETTER) ?? []).length
  return letters === 0 ? 1 : (text.match(LATIN) ?? []).length / letters
}

function isLooping(text: string): boolean {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 8)
  const seen = new Map<string, number>()
  for (const l of lines) seen.set(l, (seen.get(l) ?? 0) + 1)
  if ([...seen.values()].some(n => n >= 3)) return true
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length < 24) return false
  const grams = new Map<string, number>()
  for (let i = 0; i + 4 <= words.length; i++) {
    const g = words.slice(i, i + 4).join(' ')
    grams.set(g, (grams.get(g) ?? 0) + 1)
  }
  return [...grams.values()].some(n => n >= 5)
}

export function judgeReply(question: string, reply: string): Verdict {
  const text = reply.trim()
  if (text.length < 12) return { isUsable: false, isLanguageMatch: false, reason: 'too short' }
  if (latinShare(question) > 0.9 && latinShare(text) < 0.85) {
    return { isUsable: false, isLanguageMatch: false, reason: 'answered in the wrong script' }
  }
  if (isLooping(text)) return { isUsable: false, isLanguageMatch: false, reason: 'repeats itself' }
  const asked = language(question)
  const answered = language(text)
  const isLanguageMatch = asked === 'English' ? answered === 'English' : answered !== 'English'
  return { isUsable: true, isLanguageMatch }
}

/** Removes a reasoning model's <think> block, if it sent one anyway. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
}
