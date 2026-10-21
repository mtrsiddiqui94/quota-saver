// What the plugin did, as it did it: kept for the /activity pane and appended
// to a log file that a terminal can follow live.

import { atom, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { ActivityEntry, ActivityKind } from '../../types'

const activity = atom({ plugin: 'quota-saver', key: 'activity' } as const, [] as ActivityEntry[])

const KEEP = 300

/** Off by default and per session: nothing is recorded until /activity on. */
export const watch = { isOn: false }

/** Where the log file lives, and the command that follows it in a terminal. */
export async function logTarget($: EngineInterface): Promise<{ path: string; follow: string; isWindows: boolean }> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const home = (isWindows ? await $.env.get('USERPROFILE') : await $.env.get('HOME')) ?? ''
  const path = isWindows ? `${home}\\.quota-saver-activity.log` : `${home}/.quota-saver-activity.log`
  const follow = isWindows ? `Get-Content -Wait "${path}"` : `tail -f ${path}`
  return { path, follow, isWindows }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function clock(at: number): string {
  const d = new Date(at)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Plain words for each kind of step, as the log window shows them. */
const LABEL: Partial<Record<ActivityKind, string>> = {
  prompt: 'YOU',
  saved: 'SAVED',
  blocked: 'STOPPED',
  local: 'LOCAL',
  claude: 'CLAUDE',
  turn: 'RESULT',
  setup: 'SETUP',
  info: 'NOTE',
  error: 'ERROR',
}

export function formatEntry(e: ActivityEntry): string {
  return `${clock(e.at)}  ${(LABEL[e.kind] ?? e.kind.toUpperCase()).padEnd(7)}  ${e.text}`
}

/** Records one step. Never throws: the log must not break the feature it describes. */
export async function record($: EngineInterface, kind: ActivityKind, text: string) {
  if (!watch.isOn) return
  try {
    const entry: ActivityEntry = { at: await $.clock.now(), kind, text: text.replace(/\s+/g, ' ').slice(0, 300) }
    await update($, activity, list => [...(list ?? []), entry].slice(-KEEP))
    const { path, isWindows } = await logTarget($)
    const line = formatEntry(entry)
    if (isWindows) {
      await $.process.run(['powershell', '-NoProfile', '-Command', 'Add-Content -LiteralPath $args[0] -Value $args[1]', path, line])
    } else {
      await $.process.run(['sh', '-c', 'printf "%s\\n" "$2" >> "$1"', 'sh', path, line])
    }
  } catch {
    // the pane and the file are a view; the work goes on without them
  }
}

/** Compact token counts for a line: 12345 -> "12.3k". */
export function k(n: number | undefined): string {
  const v = n ?? 0
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
}
