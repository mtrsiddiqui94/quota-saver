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

const ROMAN_URDU = /\b(hai|hain|ha|kya|kia|kaise|kese|karo|kar|karna|mein|main|ma|aur|nahi|ni|batao|bata|chahiye|chahta|chaya|hun|ho|ye|wo|ka|ki|ke|ko|se|par|pe|aik|ek|bhi|sab|kuch|abhi|jab|tab|agar|ager|k|q|baad|jis\w*|jo|jae|jaye|jaey|jao|ja|bna\w*|bana\w*|kro|kr|krna|krdo|kardo|kard\w*|krd\w*|dena|ab|phir|fir|isko|usko|mujhe|muje|hum|tum|ap|aap|wala|wali|wale|raha|rahi|rha|rhi|ra|lag|lagta|lagti|sath|saath|tak|sahi|theek|thik|bht|bohat|bahut|kyun|kyu|kun|dekho|dikh\w*|chal\w*|samjhao|samjha\w*|hy|kab|kahan|kidhar|idhar|udhar|yahan|wahan|apna|apni|apne|mera|meri|mere|tera|teri|hamara|unka|inka|sakta|sakti|sakte|skta|chahye|chaiye|chahie|zara|zaroor|bilkul|acha|achha|ghalat|galat|masla|kaam|cheez\w*|wajah|waja|lekin|magar|yaa|phr|dobara|doobara|pehle|pehly|abi|sirf|bas|zyada|ziada|thora|thoda|bohot|bhot|kitna|kitne|kitni|kaun|kon|kis|kisi|koi|hoga|hogi|hoge|hota|hoti|hote|tha|thi|rahe|rhe|gaya|gayi|gya|gyi|gae|diya|dia|dya|liya|lia|kiya|karen|karein|kren|krein|dekh|dekhna|bolo|likho|hatao|nikalo|lagao|lagado|dalo|daalo|rakho|aya|aaya|ayi|aayi|aen|ayen|na|yeh|woh|yehi|wohi)\b/gi

const ROMAN_URDU_WORD = new RegExp(`^${ROMAN_URDU.source.replace(/\\b/g, '')}$`, 'i')

/** True when the built-in list already knows the word as Roman Urdu. */
export const isKnownUrdu = (word: string) => ROMAN_URDU_WORD.test(word)

// Words this person has been seen using in Roman Urdu prompts (see lib/learn.ts).
let learned: ReadonlySet<string> = new Set()
export function useLearned(words: ReadonlySet<string>) {
  learned = words
}

/** A rough label for the reply language Claude will pick. */
export function language(text: string): 'Roman Urdu' | 'English' | 'mixed' {
  const tokens = text.split(/\s+/).filter(Boolean)
  const words = tokens.length || 1
  const extra = learned.size ? tokens.filter((t) => learned.has(t.toLowerCase()) && !isKnownUrdu(t)).length : 0
  const urdu = (text.match(ROMAN_URDU) ?? []).length + extra
  const share = urdu / words
  return share >= 0.3 ? 'Roman Urdu' : share > 0.1 ? 'mixed' : 'English'
}
