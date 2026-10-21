// One-command local model: `/local on` finds or installs Ollama, starts its
// server, downloads the model, and switches local mode on, on macOS, Windows
// and Linux, asking once before installing anything.

import type { EngineInterface } from 'claude-code'

import { listLocalModels } from '../lib/local'
import { saveSettings, state } from '../core/state'
import type { Options } from '../core/state'

export type Platform = 'mac' | 'windows' | 'linux'

type Run = { exitCode: number; stdout: string }

async function run($: EngineInterface, argv: string[], timeoutMs = 30_000): Promise<Run | undefined> {
  try {
    const r = await $.process.run(argv, { timeoutMs })
    return { exitCode: r.exitCode, stdout: r.stdout }
  } catch {
    return undefined // could not start: not installed or not on PATH
  }
}

/** What the running setup is doing: read by /local, and said in the transcript as it goes. */
export const setup = { isRunning: false, step: '', pct: undefined as number | undefined, startedAt: 0 }

/** A step of the setup: one line in the conversation, and the status line. */
function say($: EngineInterface, step: string, pct?: number) {
  setup.step = step
  setup.pct = pct
  $.ui.status(`quota-saver: ${step}${pct === undefined ? '' : ` ${pct}%`}`)
  $.ui.log(`quota-saver: ${step}${pct === undefined ? '' : ` ${pct}%`}`)
}

/** Runs a command and hands each line of its output to `onLine`; resolves its exit code, or undefined if it could not start. */
async function runStreaming(
  $: EngineInterface,
  argv: string[],
  onLine: (line: string) => void,
  env?: Record<string, string>,
): Promise<number | undefined> {
  try {
    const it = $.process.spawn({ argv, ...(env ? { env } : {}) })[Symbol.asyncIterator]()
    let rest = ''
    for (;;) {
      const r = await it.next()
      if (r.done) {
        if (rest) onLine(rest)
        return r.value?.code ?? undefined
      }
      const lines = (rest + r.value.text).split(/\r?\n|\r/)
      rest = lines.pop() ?? ''
      for (const line of lines) if (line.trim()) onLine(line)
    }
  } catch {
    return undefined
  }
}

export async function detectPlatform($: EngineInterface): Promise<Platform> {
  if ((await $.env.get('OS')) === 'Windows_NT') return 'windows'
  const uname = await run($, ['uname', '-s'])
  return uname?.stdout.trim() === 'Darwin' ? 'mac' : 'linux'
}

async function home($: EngineInterface, platform: Platform): Promise<string> {
  return (platform === 'windows' ? await $.env.get('USERPROFILE') : await $.env.get('HOME')) ?? ''
}

/** Where Ollama's binary can be, in the order to try: PATH first, then each platform's install places. */
export async function ollamaCandidates($: EngineInterface, platform: Platform): Promise<string[]> {
  const h = await home($, platform)
  if (platform === 'windows') {
    const local = (await $.env.get('LOCALAPPDATA')) ?? `${h}\\AppData\\Local`
    return ['ollama', `${local}\\Programs\\Ollama\\ollama.exe`]
  }
  if (platform === 'mac') {
    return [
      'ollama',
      '/opt/homebrew/bin/ollama',
      '/usr/local/bin/ollama',
      '/Applications/Ollama.app/Contents/Resources/ollama',
      `${h}/Applications/Ollama.app/Contents/Resources/ollama`,
    ]
  }
  return ['ollama', '/usr/local/bin/ollama', '/usr/bin/ollama', `${h}/.local/bin/ollama`]
}

export async function findOllama($: EngineInterface, platform: Platform): Promise<string | undefined> {
  for (const bin of await ollamaCandidates($, platform)) {
    const r = await run($, [bin, '--version'])
    if (r && r.exitCode === 0) return bin
  }
  return undefined
}

/** Installs Ollama with the platform's usual tool, falling back to the official download. */
export async function installOllama($: EngineInterface, platform: Platform): Promise<boolean> {
  const tenMinutes = 600_000
  const h = await home($, platform)
  const ok = (r: Run | undefined) => r !== undefined && r.exitCode === 0

  if (platform === 'mac') {
    for (const brew of ['brew', '/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
      if (ok(await run($, [brew, '--version']))) {
        say($, 'Homebrew se Ollama install ho raha hai')
        // Each "==> ..." line is a step of brew's (downloading, pouring a dependency, linking).
        const code = await runStreaming(
          $,
          [brew, 'install', 'ollama'],
          line => {
            const step = /^==> (.+)/.exec(line)?.[1]
            if (step) say($, `brew: ${step.slice(0, 120)}`)
          },
          { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' },
        )
        if (code === 0) return true
        break
      }
    }
    say($, 'Ollama app download ho raha hai')
    const zip = `${h}/Downloads/Ollama-darwin.zip`
    return (
      ok(await run($, ['mkdir', '-p', `${h}/Applications`])) &&
      ok(await run($, ['curl', '-fsSL', '-o', zip, 'https://ollama.com/download/Ollama-darwin.zip'], tenMinutes)) &&
      ok(await run($, ['unzip', '-q', '-o', zip, '-d', `${h}/Applications`], tenMinutes))
    )
  }

  if (platform === 'windows') {
    say($, 'Ollama install ho raha hai (winget)')
    const winget = ['winget', 'install', '--id', 'Ollama.Ollama', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements']
    if (ok(await run($, winget, tenMinutes))) return true
    const setup = `${(await $.env.get('TEMP')) ?? h}\\OllamaSetup.exe`
    return (
      ok(await run($, ['curl.exe', '-fsSL', '-o', setup, 'https://ollama.com/download/OllamaSetup.exe'], tenMinutes)) &&
      ok(await run($, [setup, '/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], tenMinutes))
    )
  }

  say($, 'Ollama install ho raha hai (install script)')
  if (ok(await run($, ['sh', '-c', 'curl -fsSL https://ollama.com/install.sh | sh'], tenMinutes))) return true
  // No root: unpack the official build into ~/.local instead.
  return (
    ok(await run($, ['mkdir', '-p', `${h}/.local`])) &&
    ok(await run($, ['sh', '-c', `curl -fsSL https://ollama.com/download/ollama-linux-amd64.tgz | tar -xz -C "${h}/.local"`], tenMinutes))
  )
}

async function isServing($: EngineInterface, url: string): Promise<boolean> {
  return (await listLocalModels($, url)) !== undefined
}

/** Starts `ollama serve` for the life of the session (it stops with the session) and waits for it. */
export async function startServer($: EngineInterface, bin: string, url: string): Promise<boolean> {
  if (await isServing($, url)) return true
  void (async () => {
    try {
      for await (const _ of $.process.spawn({ argv: [bin, 'serve'] })) {
        // drain the server's log; the loop ends with the server
      }
    } catch {
      // could not start; the wait below reports it
    }
  })()
  for (let i = 0; i < 30; i++) {
    await $.clock.sleep(1000)
    if (await isServing($, url)) return true
  }
  return false
}

/** Downloads the model, showing progress on the status line. */
export async function pullModel($: EngineInterface, bin: string, model: string): Promise<boolean> {
  let lastSaid = -10
  say($, `Model ${model} download shuru (lagbhag 2 GB)`, 0)
  const code = await runStreaming($, [bin, 'pull', model], line => {
    const pct = [...line.matchAll(/(\d{1,3})%/g)].map(m => Number(m[1])).at(-1)
    if (pct === undefined) return
    setup.pct = pct
    $.ui.status(`quota-saver: ${model} download ${pct}%`)
    // One line in the conversation every 10%, so progress shows on every surface.
    if (pct >= lastSaid + 10) {
      lastSaid = pct - (pct % 10)
      say($, `Model ${model} download`, pct)
    }
  })
  $.ui.status(undefined)
  return code === 0
}

export function hasModel(models: readonly string[], model: string): boolean {
  const want = model.includes(':') ? model : `${model}:latest`
  return models.some(m => m === model || m === want)
}


/**
 * Makes local mode ready and switches it to `mode`. Returns at once with what
 * it is doing; the long part (install, download) runs in the background and
 * reports with a toast.
 */
export type SetupOutcome = 'ready' | 'started' | 'running' | 'declined' | 'unreachable'

export async function ensureLocal(
  $: EngineInterface,
  opts: Options,
  mode: 'on' | 'auto',
  isConsented = false,
): Promise<SetupOutcome> {
  const { cfg } = state
  const model = cfg.localModel
  const turnOn = async () => {
    cfg.local = mode
    await saveSettings($)
  }

  const models = await listLocalModels($, opts.ollamaUrl)
  if (models !== undefined && hasModel(models, model)) {
    await turnOn()
    return 'ready'
  }
  if (setup.isRunning) return 'running'

  const platform = await detectPlatform($)
  let bin = await findOllama($, platform)
  const isLocalServer = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(opts.ollamaUrl)

  if (!bin && models === undefined) {
    if (!isLocalServer) return 'unreachable'
  }
  if (!bin && models === undefined && !isConsented) {
    const answer = await $.ui.ask(
      `Local model ke liye Ollama install karna hoga, aur model "${model}" download hoga (lagbhag 2 GB, ek dafa). Abhi karein?`,
      { options: ['Haan, sab khud kar do', 'Nahi, abhi nahi'], header: 'Local model' },
    ).catch(() => 'Nahi')
    if (!answer.startsWith('Haan')) return 'declined'
  }

  setup.isRunning = true
  setup.startedAt = await $.clock.now()
  void (async () => {
    try {
      if (!bin) {
        $.ui.status('quota-saver: Ollama install ho raha hai…')
        const isInstalled = await installOllama($, platform)
        bin = isInstalled ? await findOllama($, platform) : undefined
        $.ui.status(undefined)
        if (!bin) {
          $.ui.toast('Ollama install nahi ho saka. ollama.com se khud install kar ke /local on dobara chalayein.')
          return
        }
      }
      say($, 'Ollama server chalu ho raha hai')
      if (!(await startServer($, bin, opts.ollamaUrl))) {
        $.ui.toast('Ollama server chalu nahi hua. Ek dafa Ollama app khol kar /local on dobara chalayein.')
        return
      }
      const now = await listLocalModels($, opts.ollamaUrl)
      if (!now || !hasModel(now, model)) {
        if (!(await pullModel($, bin, model)) || !hasModel((await listLocalModels($, opts.ollamaUrl)) ?? [], model)) {
          $.ui.toast(`Model "${model}" download nahi ho saka. Internet check kar ke /local on dobara chalayein.`)
          return
        }
      }
      await turnOn()
      say($, 'Local model tayyar!')
      $.ui.toast(`Local model tayyar! ${mode === 'on' ? '~ se shuru hone wale prompts' : 'Aam sawal'} ab aapki machine par chalenge, 0 Claude tokens.`)
    } catch {
      $.ui.toast('Local setup beech mein ruk gaya. /local on dobara chalayein.')
    } finally {
      setup.isRunning = false
      $.ui.status(undefined)
    }
  })()
  return 'started'
}

/**
 * At session start. The first time, acts on the install-time choice
 * (`setupLocalModel`): `yes` sets local mode up with no further question, `ask`
 * asks once, `no` leaves it off. Later, keeps the server up while local mode is on.
 */
export async function autostartLocal($: EngineInterface, opts: Options) {
  if (!state.cfg.isOnboarded) {
    state.cfg.isOnboarded = true
    await saveSettings($)
    if (opts.setupLocalModel === 'yes') {
      void ensureLocal($, opts, 'on', true)
      return
    }
    if (opts.setupLocalModel === 'ask') {
      void (async () => {
        const answer = await $.ui.ask(
          'Quota Saver: aam sawal free (aapki machine par) chalane ke liye local model setup karein? Ollama aur ~2 GB model ek dafa download honge.',
          { options: ['Haan, sab khud kar do', 'Nahi'], header: 'Local model' },
        ).catch(() => 'Nahi')
        if (answer.startsWith('Haan')) await ensureLocal($, opts, 'on', true)
      })()
      return
    }
  }
  if (state.cfg.local === 'off' || (await isServing($, opts.ollamaUrl))) return
  const bin = await findOllama($, await detectPlatform($))
  if (bin) void startServer($, bin, opts.ollamaUrl)
}
