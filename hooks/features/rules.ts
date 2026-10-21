// Lean working rules, a carried-over handoff note, and the cheap explorer agent.

import type { On } from 'claude-code'

import { record, watch } from '../core/activity'
import { state } from '../core/state'
import { tokens } from '../lib/trim'

const noted = { isDone: false }

// Short on purpose: this text itself rides on every request.
const RULES = `# Token economy (quota-saver plugin)
The user pays per token and has a limited quota. Work lean:
- The user may write in Roman Urdu, English or a mix. Understand it directly; reply in the same style.
- Keep replies short: the answer or result first, no recap of what you did, no restating the question.
- Search before reading: use mcp__quota-saver__outline (a file's functions and classes with line numbers), Grep/Glob or \`grep -n\` to find the lines, then Read with offset/limit. Never read a whole large file to find one thing.
- Do not re-read a file already in context unless it changed. Do not re-run a command just to see its output again.
- Pipe noisy commands (tests, builds, installs) through \`tail\`/\`grep\` and prefer quiet flags.
- For broad codebase exploration, delegate to the \`quota-saver:explorer\` agent (cheap model) and use its summary.
- Make changes with Edit (small diffs), not full-file rewrites.
- No openers or praise ("Great question", "Sure!"), no closing offers of extra work. Stop when the task is done.
- When an output was shortened, its full text is in the file named at its end: read a line range there instead of re-running the command.`

// Reply styles, inspired by caveman: fewer output tokens, which cost the most per token.
const STYLES: Record<'off' | 'lite' | 'full', string | undefined> = {
  off: undefined,
  lite: '# Reply style (quota-saver: lite)\nShort, plain sentences. No filler, hedging or restating. Lists over paragraphs.',
  full: '# Reply style (quota-saver: full)\nTelegraphic: fragments are fine, drop articles and filler, one idea per line. Keep code, paths, numbers, commands and error text exact. Full sentences only for warnings that could cause data loss.',
}

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
    state.currentModel = e.model
    if (!state.cfg.isEnabled) return composed
    if (watch.isOn && !noted.isDone) {
      noted.isDone = true
      await record($, 'info', `told Claude to keep answers short and read files carefully (+${tokens(RULES.length)} tokens, once per session)`)
    }
    const sections = [...composed.sections, { id: 'quota-saver:rules', text: RULES, scope: 'session' as const }]
    const style = STYLES[state.cfg.style ?? 'off']
    if (style) sections.push({ id: 'quota-saver:style', text: style, scope: 'session' as const })
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
