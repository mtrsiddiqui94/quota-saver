// Quota Saver: spends fewer tokens where they are actually spent (tool output,
// file reads, history) and answers what it can on this machine.

import type { Register } from 'claude-code'

import { loadSettings, parseOptions } from './core/state'
import { COMMANDS, installCommands } from './features/commands'
import { installHandoff } from './features/handoff'
import { autostartLocal } from './features/local-setup'
import { refreshStatus } from './features/meter'
import { installOutputDiet } from './features/output-diet'
import { installPromptRouter, rememberAnswer } from './features/prompt-router'
import { installReadGuard } from './features/read-guard'
import { EXPLORER, installRules } from './features/rules'

export const register: Register = (on, options) => {
  const opts = parseOptions(options)

  on('session.start', async ($, e, next) => {
    await loadSettings($)
    for (const spec of COMMANDS) await $.command.register(spec)
    await $.agent.register(EXPLORER).catch(() => undefined)
    await autostartLocal($, opts).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) {
      await rememberAnswer($, e).catch(() => undefined)
      await refreshStatus($).catch(() => undefined)
    }
    return done
  })

  installRules(on)
  installPromptRouter(on, opts)
  installReadGuard(on, opts)
  installOutputDiet(on, opts)
  installHandoff(on)
  installCommands(on, opts)
}
