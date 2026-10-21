// A tool the model calls instead of reading a whole file to find its way:
// quota-saver's outline gives the skeleton with line numbers, so the next Read
// can be a small range. Its schema rides in the tool list (about a hundred
// tokens), so the model sees it without a search.

import type { EngineInterface, On } from 'claude-code'

import { record } from '../core/activity'
import { count, state } from '../core/state'
import { junkReason } from '../lib/junk'
import { formatOutline, outline } from '../lib/outline'
import { formatK, tokens } from '../lib/trim'

export const OUTLINE_TOOL = 'mcp__quota-saver__outline'

export const OUTLINE_SPEC = {
  name: 'outline',
  description:
    'Outline of source files: functions, classes, types (or headings) with line numbers, for a fraction of the tokens of reading them. Use it before reading a large file or to find where something is defined, then Read only the line range you need. Give one or more paths (absolute, or relative to the project).',
  inputSchema: {
    type: 'object',
    properties: { paths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 10 } },
    required: ['paths'],
  },
  isDeferred: false as const,
}

async function absolute($: EngineInterface, path: string): Promise<string> {
  if (/^([/\\]|[a-zA-Z]:[\\/])/.test(path)) return path
  const cwd = await $.session.cwd()
  return `${cwd.replace(/[\\/]$/, '')}/${path.replace(/^\.\//, '')}`
}

async function outlineOne($: EngineInterface, path: string): Promise<{ text: string; saved: number }> {
  const full = await absolute($, path)
  const stat = await $.fs.stat(full).catch(() => undefined)
  if (!stat || stat.kind !== 'file') return { text: `${path}: not a file.`, saved: 0 }
  if (junkReason(full)) return { text: `${path}: ${junkReason(full)}, not outlined.`, saved: 0 }
  if (stat.size > 4 * 1024 * 1024) return { text: `${path}: over 4 MB, not outlined. Grep it instead.`, saved: 0 }
  const text = await $.fs.read(full)
  const result = formatOutline(path, outline(full, String(text)))
  return { text: result, saved: Math.max(0, String(text).length - result.length) }
}

export function installOutlineTool(on: On) {
  // A pattern, not the name: the tool's own name is typed only once the engine has loaded it.
  on('tool.call', { tool: /^mcp__quota-saver__outline$/ }, async ($, e, next) => {
    if (String(e.tool) !== OUTLINE_TOOL) return next(e)
    const input = e as unknown as { paths?: unknown }
    const paths = Array.isArray(input.paths) ? input.paths.filter((p): p is string => typeof p === 'string').slice(0, 10) : []
    if (paths.length === 0) return { deny: 'Give paths: an array of file paths.' }
    const parts: string[] = []
    let saved = 0
    for (const p of paths) {
      const one = await outlineOne($, p)
      parts.push(one.text)
      saved += one.saved
    }
    if (saved > 0 && state.cfg.isEnabled) {
      await count($, { savedChars: saved })
      await record($, 'saved', `outline of ${paths.length} file${paths.length === 1 ? '' : 's'} instead of reading ${paths.length === 1 ? 'it' : 'them'} whole: ≈ ${formatK(tokens(saved))} tokens saved`)
    }
    return { result: parts.join('\n\n') }
  }).catch(($, e, next) => (next.called || String(e.tool) !== OUTLINE_TOOL ? next(e) : { deny: 'quota-saver outline failed; use Read with a line range.' }))
}
