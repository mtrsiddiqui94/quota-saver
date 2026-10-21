// What every request carries before the conversation even starts: MCP tool
// schemas, memory files (CLAUDE.md), skills and agents. Measured locally
// (the "summary" breakdown sends no request), so the audit itself is free.

import type { EngineInterface } from 'claude-code'

import { k, record } from '../core/activity'
import { state } from '../core/state'

// Past these, a fixed part of every request is worth trimming.
const MCP_HEAVY = 8_000
const SERVER_HEAVY = 3_000
const MEMORY_HEAVY = 5_000
const FILE_HEAVY = 2_500

export type Audit = { lines: string[]; tips: string[]; fixedTokens: number }

export async function audit($: EngineInterface): Promise<Audit | undefined> {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const b = context.breakdown
  if (!b) return undefined

  const byServer = new Map<string, number>()
  for (const tool of b.mcpTools) {
    if (tool.isLoaded) byServer.set(tool.serverName, (byServer.get(tool.serverName) ?? 0) + tool.tokens)
  }
  const mcpTotal = [...byServer.values()].reduce((a, n) => a + n, 0)
  const memoryTotal = b.memoryFiles.reduce((a, f) => a + f.tokens, 0)
  const skills = b.skills?.tokens ?? 0
  const agents = b.agents.reduce((a, x) => a + x.tokens, 0)
  const fixedTokens = mcpTotal + memoryTotal + skills + agents

  const lines = [
    `Context now: ${k(b.totalTokens)} of ${k(b.rawMaxTokens)} tokens (${b.percentage}%) · ${b.model}`,
    '',
    'Sent with every request:',
    `  MCP tool schemas   ${k(mcpTotal).padStart(7)}  (${byServer.size} server${byServer.size === 1 ? '' : 's'} with loaded tools)`,
    ...[...byServer.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6).map(([s, n]) => `    ${s.padEnd(22)} ${k(n).padStart(7)}`),
    `  Memory files       ${k(memoryTotal).padStart(7)}  (CLAUDE.md and friends)`,
    ...b.memoryFiles.slice().sort((x, y) => y.tokens - x.tokens).slice(0, 4).map(f => `    ${shorten(f.path, 22).padEnd(22)} ${k(f.tokens).padStart(7)}`),
    `  Skills listing     ${k(skills).padStart(7)}`,
    `  Agents listing     ${k(agents).padStart(7)}`,
    `  Total fixed cost   ${k(fixedTokens).padStart(7)}  per request`,
  ]

  const tips: string[] = []
  for (const [server, n] of byServer) {
    if (n >= SERVER_HEAVY) tips.push(`MCP server "${server}" adds ${k(n)} tokens to every request. Disable it in /mcp when you are not using it.`)
  }
  if (mcpTotal >= MCP_HEAVY && tips.length === 0) tips.push(`MCP tools add ${k(mcpTotal)} tokens to every request. Disable servers you are not using in /mcp.`)
  for (const f of b.memoryFiles) {
    if (f.tokens >= FILE_HEAVY) tips.push(`${shorten(f.path, 50)} is ${k(f.tokens)} tokens and rides on every request. Keep only rules and commands in it; move long docs to files Claude reads when needed.`)
  }
  if (memoryTotal >= MEMORY_HEAVY && !tips.some(t => t.includes('rides on every request'))) {
    tips.push(`Memory files total ${k(memoryTotal)} tokens. Trim CLAUDE.md to the essentials.`)
  }
  if (b.percentage >= 60) tips.push(`Context is ${b.percentage}% full: /new-task carries a 12-line summary instead of all of it.`)
  return { lines, tips, fixedTokens }
}

function shorten(path: string, max: number): string {
  return path.length <= max ? path : `…${path.slice(-(max - 1))}`
}

/** Once per context window, after its first turn: say so if the fixed cost is heavy. */
export async function auditOnce($: EngineInterface) {
  if (state.isAudited) return
  state.isAudited = true
  const result = await audit($)
  if (!result || result.tips.length === 0) return
  await record($, 'info', `audit: ${k(result.fixedTokens)} tokens ride on every request; ${result.tips.length} way(s) to cut it (/quota-saver audit)`)
  $.ui.toast(`Every request carries ${k(result.fixedTokens)} fixed tokens. /quota-saver audit shows how to cut it.`)
}

export function formatAudit(result: Audit | undefined): string {
  if (!result) return 'No breakdown yet: send a prompt first, then run /quota-saver audit again.'
  return [
    'Quota Saver audit',
    '',
    ...result.lines,
    '',
    ...(result.tips.length ? ['Ways to save:', ...result.tips.map(t => `  • ${t}`)] : ['Nothing heavy found. The fixed cost per request is fine.']),
  ].join('\n')
}
