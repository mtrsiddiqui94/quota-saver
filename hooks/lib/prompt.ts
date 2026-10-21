// A submitted prompt can carry blocks the host adds around what the person
// typed (an editor's <browser_instruction>, <ide_selection>, a
// <system-reminder>, ...). These helpers find the person's own words, so the
// plugin judges, caches and shows those, while Claude still gets everything.

const BLOCK = /<([a-zA-Z][\w-]*)(\s[^>]*)?>[\s\S]*?<\/\1>/g

/** The person's own words: the prompt with every host-added tag block removed. */
export function userWords(text: string): string {
  return text.replace(BLOCK, ' ').replace(/\s+/g, ' ').trim()
}

/** Replaces the person's words inside the full prompt, leaving host blocks where they were. */
export function replaceWords(text: string, words: string, replacement: string): string {
  if (words === replacement) return text
  if (text.trim() === words) return replacement
  const at = text.lastIndexOf(words)
  return at < 0 ? text : text.slice(0, at) + replacement + text.slice(at + words.length)
}

const ROMAN_URDU = /\b(hai|hain|ha|kya|kia|kaise|kese|karo|kar|karna|mein|main|ma|aur|nahi|ni|batao|bata|chahiye|chahta|chaya|hun|ho|ye|wo|ka|ki|ke|ko|se|par|pe|aik|ek|bhi|sab|kuch|abhi|jab|tab|agar|ager)\b/gi

/** A rough label for the reply language Claude will pick. */
export function language(text: string): 'Roman Urdu' | 'English' | 'mixed' {
  const words = text.split(/\s+/).filter(Boolean).length || 1
  const urdu = (text.match(ROMAN_URDU) ?? []).length
  const share = urdu / words
  return share >= 0.3 ? 'Roman Urdu' : share > 0.1 ? 'mixed' : 'English'
}
