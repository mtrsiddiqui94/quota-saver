// Quota Saver: spends fewer tokens where they are actually spent (tool output,
// file reads, history) and answers what it can on this machine.

import type { Register } from 'claude-code'

import { k, record } from './core/activity'
import { loadSettings, parseOptions, state } from './core/state'
import { COMMANDS, installCommands } from './features/commands'
import { installActivity } from './features/activity'
import { auditOnce } from './features/audit'
import { recordTurnCompare } from './features/compare'
import { warnModelSwitch } from './features/model-switch'
import { installHandoff } from './features/handoff'
import { autostartLocal } from './features/local-setup'
import { refreshStatus } from './features/meter'
import { installOutlineTool, OUTLINE_SPEC } from './features/outline-tool'
import { installOutputDiet, pruneArchive } from './features/output-diet'
import { installPromptRouter, rememberAnswer } from './features/prompt-router'
import { installReadGuard } from './features/read-guard'
import { EXPLORER, installRules } from './features/rules'

export const register: Register = (on, options) => {
  const opts = parseOptions(options)

  on('session.start', async ($, e, next) => {
    await loadSettings($)
    for (const spec of COMMANDS) await $.command.register(spec)
    await $.agent.register(EXPLORER).catch(() => undefined)
    await $.tool.register(OUTLINE_SPEC).catch(() => undefined)
    await autostartLocal($, opts).catch(() => undefined)
    await pruneArchive($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && state.cfg.isEnabled && e.usage) {
      const u = e.usage
      await record(
        $,
        'turn',
        `turn done (${e.reason}) · ${u.model} · in: ${k(u.input_tokens)} new + ${k(u.cache_creation_input_tokens)} written to cache + ${k(u.cache_read_input_tokens)} read from cache (cheap) · out: ${k(u.output_tokens)}`,
      )
      await recordTurnCompare($, u).catch(() => undefined)
    }
    if (e.agentId === undefined) {
      await rememberAnswer($, e).catch(() => undefined)
      await refreshStatus($).catch(() => undefined)
      if (state.cfg.isEnabled) {
        await warnModelSwitch($, e.usage).catch(() => undefined)
        await auditOnce($).catch(() => undefined)
      }
    }
    return done
  })

  installRules(on)
  installPromptRouter(on, opts)
  installReadGuard(on, opts)
  installOutputDiet(on, opts)
  installHandoff(on, opts)
  installCommands(on, opts)
  installActivity(on)
  installOutlineTool(on)
}
