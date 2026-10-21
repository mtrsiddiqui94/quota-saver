// Lean working rules, a carried-over handoff note, and the cheap explorer agent.

import type { On } from 'claude-code'

import { state } from '../core/state'

// Short on purpose: this text itself rides on every request.
const RULES = `# Token economy (quota-saver plugin)
The user pays per token and has a limited quota. Work lean:
- The user may write in Roman Urdu, English or a mix. Understand it directly; reply in the same style.
- Keep replies short: the answer or result first, no recap of what you did, no restating the question.
- Search before reading: use Grep/Glob or \`grep -n\` to find the lines, then Read with offset/limit. Never read a whole large file to find one thing.
- Do not re-read a file already in context unless it changed. Do not re-run a command just to see its output again.
- Pipe noisy commands (tests, builds, installs) through \`tail\`/\`grep\` and prefer quiet flags.
- For broad codebase exploration, delegate to the \`quota-saver:explorer\` agent (cheap model) and use its summary.
- Make changes with Edit (small diffs), not full-file rewrites.`

export const EXPLORER = {
  name: 'explorer',
  description:
    'Cheap read-only explorer: finds files, functions and usages in the codebase and returns a compact summary. Use for broad searches instead of reading many files yourself.',
  prompt: `You are a fast, read-only code explorer. Find what the caller asked for and report it compactly.
- Use search (grep/glob) first, read only the relevant line ranges.
- Never edit or write files.
- Answer in at most 15 lines: file paths with line numbers and one-line notes. No preamble.`,
  model: 'haiku',
}

export function installRules(on: On) {
  // Appended after the engine's sections, so its cached prefix stays untouched.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!state.cfg.isEnabled) return composed
    const sections = [...composed.sections, { id: 'quota-saver:rules', text: RULES, scope: 'session' as const }]
    if (state.handoff.active) {
      sections.push({
        id: 'quota-saver:handoff',
        text: `# Handoff from the previous context (quota-saver)\nContinue from this note; do not re-explore what it already says.\n${state.handoff.active}`,
        scope: 'session' as const,
      })
    }
    return { sections }
  })
}
