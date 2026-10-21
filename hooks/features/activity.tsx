// /activity: watch what the plugin does on each prompt, only while you want
// to. `/activity on` starts recording and opens a terminal window that follows
// the log live (plus a pane where the surface draws one); `/activity off`
// stops it. Nothing is recorded otherwise.

import { atom, read } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { ActivityEntry, ActivityKind } from '../../types'
import { clock, formatEntry, logTarget, record, watch } from '../core/activity'

// The same value core/activity.ts writes; read here for the pane.
const activity = atom({ plugin: 'quota-saver', key: 'activity' } as const, [] as ActivityEntry[])

const PANE = 'quota-saver-activity'

const COLOR: Record<ActivityKind, string | undefined> = {
  prompt: 'claude',
  saved: 'success',
  blocked: 'warning',
  local: 'suggestion',
  claude: undefined,
  turn: 'subtle',
  setup: 'suggestion',
  info: 'subtle',
  error: 'error',
}

const ok = async (p: Promise<{ exitCode: number }>) => p.then(r => r.exitCode === 0, () => false)

/** Opens a terminal window that follows the log. Resolves whether one opened. */
async function openTerminal($: EngineInterface): Promise<boolean> {
  const { path, isWindows } = await logTarget($)
  if (isWindows) {
    const ps = `$host.UI.RawUI.WindowTitle='Quota Saver activity'; Get-Content -Wait -Tail 50 -LiteralPath '${path}'`
    return ok($.process.run(['cmd', '/c', 'start', 'Quota Saver activity', 'powershell', '-NoExit', '-Command', ps]))
  }
  const uname = await $.process.run(['uname', '-s']).then(r => r.stdout.trim(), () => '')
  if (uname === 'Darwin') {
    // A .command file opens in Terminal with no extra permission prompt.
    const script = path.replace(/\.log$/, '.command')
    await $.fs.write(script, `#!/bin/sh\nprintf '\\033]0;Quota Saver activity\\007'\nclear\necho "Quota Saver activity (close this window any time; /activity off stops recording)"\necho\ntail -n 50 -f "${path}"\n`)
    await $.process.run(['chmod', '+x', script])
    return ok($.process.run(['open', '-a', 'Terminal', script]))
  }
  for (const argv of [
    ['x-terminal-emulator', '-e', 'tail', '-n', '50', '-f', path],
    ['gnome-terminal', '--', 'tail', '-n', '50', '-f', path],
    ['konsole', '-e', 'tail', '-n', '50', '-f', path],
    ['xterm', '-e', 'tail', '-n', '50', '-f', path],
  ]) {
    if (await ok($.process.run(argv))) return true
  }
  return false
}

async function textView($: EngineInterface, count: number): Promise<string> {
  const list = (await read($, activity)) ?? []
  const lines = list.slice(-count).map(formatEntry)
  return [
    `Quota Saver activity (${watch.isOn ? 'recording' : 'off: /activity on to start'})`,
    '',
    ...(lines.length ? lines : ['Nothing recorded yet.']),
  ].join('\n')
}

export function installActivity(on: On) {
  on('command.run', { command: 'activity' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const { follow } = await logTarget($)

    if (arg === 'off') {
      await record($, 'info', 'recording stopped (/activity off)')
      watch.isOn = false
      return { text: 'Activity recording is off. You can close the activity window.' }
    }
    if (arg === 'text') return { text: await textView($, 40) }

    // on, or no argument
    watch.isOn = true
    await record($, 'info', 'recording started: each prompt you send shows here, step by step')
    const isWindowOpen = await openTerminal($)
    const pane = await $.ui.open({ id: PANE, title: 'Quota Saver activity' }).catch(() => ({ isPlaced: false as const }))
    return {
      text: [
        'Activity recording is on.',
        isWindowOpen
          ? 'A terminal window opened that shows each step live.'
          : `Could not open a terminal window. Run this in any terminal (VS Code: Ctrl+\`): ${follow}`,
        ...(pane.isPlaced ? ['The activity pane is open here too.'] : []),
        '',
        'Stop with /activity off. A list here any time: /activity text',
      ].join('\n'),
    }
  }).catch(() => ({ text: 'quota-saver: this command failed. Please try again.' }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = (await read($, activity)) ?? []
    const room = Math.max(3, (e.viewport?.rows ?? 24) - 3)
    const width = Math.max(30, (e.props.bodyColumns ?? 80) - 1)
    return (
      <Box flexDirection="column">
        {list.length === 0 && <Text dimColor>Nothing yet. Send a prompt and watch this pane.</Text>}
        {list.slice(-room).map(entry => (
          <Text color={COLOR[entry.kind]}>{`${clock(entry.at)} ${entry.kind.padEnd(7)} ${entry.text}`.slice(0, width)}</Text>
        ))}
      </Box>
    )
  })
}
