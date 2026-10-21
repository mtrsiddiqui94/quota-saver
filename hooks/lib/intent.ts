// Recognises what a prompt asks for, in English or Roman Urdu, so the lean
// instruction for that kind of task rides along without a slash command.

export type Intent = 'fix' | 'explain' | 'test' | 'review' | 'build'

const PATTERNS: ReadonlyArray<[Intent, RegExp]> = [
  ['review', /\b(review|jaanch\w*|janch\w*|check (my|meri|mere) (changes|code|diff)|(diff|code) dekh\w*)/i],
  ['test', /\b(run (the )?tests?|tests? (chal\w*|run kar\w*)|test kar\w*|npm test|pytest)\b/i],
  ['fix', /\b(fix\w*|bug\w*|errors?|issue|crash\w*|broken|not working|th[ei]+k kar\w*|sahi kar\w*|masla|kaam nahi|chal nahi|nahi chal\w*|ghalat|galat)\b/i],
  ['explain', /\b(explain\w*|what (does|is)|how (does|do)|why (does|is)|samjh\w*|samaj\w*|bata\w*|kya (hai|karta|karti|hota)|kaise (kaam|chal)|kyun|kyon)\b/i],
  ['build', /\b(add|create|build|implement|make a|bana\w*|naya|nayi|feature|likh\w*)\b/i],
]

export function detectIntent(text: string): Intent | undefined {
  if (text.length > 2000) return undefined
  for (const [intent, pattern] of PATTERNS) {
    if (pattern.test(text)) return intent
  }
  return undefined
}

export const GUIDE: Record<Intent, string> = {
  fix: 'quota-saver (task: fix): locate the cause with targeted search, read only the relevant line ranges, make the smallest correct Edit, verify with the narrowest check (pipe output through tail). Final reply at most 5 lines: cause, fix (file:line), how verified.',
  explain: 'quota-saver (task: explain): find only what is needed (search first, line ranges; delegate broad searches to quota-saver:explorer). Change no files. Reply at most 10 lines with file:line references, no preamble.',
  test: 'quota-saver (task: tests): detect the test command from project files, run it so only failures and the summary come back (quiet flags or tail -40). Reply at most 6 lines: counts, and each failure as name, file:line, likely cause. Fix nothing unless asked.',
  review: 'quota-saver (task: review): start from git diff --stat, read the diff per file, skip lockfiles and generated files. Report only real bugs, security issues and missing edge cases: at most 8 items, each file:line, problem, fix.',
  build: 'quota-saver (task: build): follow the closest existing pattern found by targeted search, implement with small Edits, verify with the narrowest check. If the request is ambiguous in a way that changes the design, ask one short question first. Final reply at most 6 lines.',
}
