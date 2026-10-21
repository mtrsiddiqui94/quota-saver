// One-command local model: `/local on` finds or installs Ollama, starts its
// server, downloads the model, and switches local mode on, on macOS, Windows
// and Linux, asking once before installing anything.

import type { EngineInterface } from 'claude-code'

import { record } from '../core/activity'
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
  void record($, 'setup', `${step}${pct === undefined ? '' : ` ${pct}%`}`)
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
    // The official app is prebuilt for Intel and Apple Silicon: a ~200 MB download, nothing to compile.
    const zip = `${h}/Downloads/Ollama-darwin.zip`
    say($, 'Downloading the Ollama app (about 200 MB)')
    if (ok(await run($, ['curl', '-fsSL', '-o', zip, 'https://ollama.com/download/Ollama-darwin.zip'], tenMinutes))) {
      const dest = ok(await run($, ['test', '-w', '/Applications'])) ? '/Applications' : `${h}/Applications`
      say($, `Unpacking Ollama into ${dest}`)
      if (ok(await run($, ['mkdir', '-p', dest])) && ok(await run($, ['unzip', '-q', '-o', zip, '-d', dest], tenMinutes))) {
        await run($, ['rm', '-f', zip])
        return true
      }
    }
    for (const brew of ['brew', '/opt/homebrew/bin/brew', '/usr/local/bin/brew']) {
      if (ok(await run($, [brew, '--version']))) {
        say($, 'Download failed; installing with Homebrew instead (slow on Intel Macs)')
        const code = await runStreaming(
          $,
          [brew, 'install', 'ollama'],
          line => {
            const step = /^==> (.+)/.exec(line)?.[1]
            if (step) say($, `brew: ${step.slice(0, 120)}`)
          },
          { HOMEBREW_NO_AUTO_UPDATE: '1', HOMEBREW_NO_INSTALL_CLEANUP: '1' },
        )
        return code === 0
      }
    }
    return false
  }

  if (platform === 'windows') {
    say($, 'Installing Ollama (winget)')
    const winget = ['winget', 'install', '--id', 'Ollama.Ollama', '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements']
    if (ok(await run($, winget, tenMinutes))) return true
    const setup = `${(await $.env.get('TEMP')) ?? h}\\OllamaSetup.exe`
    return (
      ok(await run($, ['curl.exe', '-fsSL', '-o', setup, 'https://ollama.com/download/OllamaSetup.exe'], tenMinutes)) &&
      ok(await run($, [setup, '/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES'], tenMinutes))
    )
  }

  say($, 'Installing Ollama (install script)')
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
  const app = /^(.*\/Ollama\.app)\//.exec(bin)?.[1]
  if (app) {
    await run($, ['open', '-g', app])
  } else void (async () => {
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
  say($, `Downloading model ${model}`, 0)
  const code = await runStreaming($, [bin, 'pull', model], line => {
    const pct = [...line.matchAll(/(\d{1,3})%/g)].map(m => Number(m[1])).at(-1)
    if (pct === undefined) return
    setup.pct = pct
    $.ui.status(`quota-saver: ${model} download ${pct}%`)
    // One line in the conversation every 10%, so progress shows on every surface.
    if (pct >= lastSaid + 10) {
      lastSaid = pct - (pct % 10)
      say($, `Downloading model ${model}`, pct)
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
/** Small models that run well on a CPU, best first: tried in turn when one fails to download. */
export const FALLBACK_MODELS = ['qwen3:1.7b', 'gemma4:e2b', 'qwen3.5:2b', 'qwen2.5:1.5b', 'llama3.2:3b', 'gemma3:1b']

// Ranked on an Intel CPU without a GPU (four questions: English, Roman Urdu, technical, code):
// gemma4:e2b 5.7s with every answer right; qwen3:1.7b 1.9s; qwen3.5:2b 8.0s; qwen3.5:4b 12.1s;
// gemma3:4b 12.6s; ministral-3:3b 10.3s with a wrong answer; qwen2.5 3b garbled Roman Urdu.
const STRONG_ORDER = ['gemma4:e2b', 'qwen3.5:4b', 'qwen3:4b', 'qwen3.5:2b', 'gemma3:4b', 'llama3.2:3b', 'qwen3:1.7b', 'qwen2.5:1.5b']
const FAST_ORDER = ['qwen3:1.7b', 'qwen3.5:0.8b', 'gemma3:1b', 'qwen2.5:1.5b']

/** The best strong and fast models among those installed; fast only when it is a different, quicker model. */
export function teamFromInstalled(models: readonly string[]): { strong?: string; fast?: string } {
  const strong = STRONG_ORDER.find(m => hasModel(models, m))
  const fast = FAST_ORDER.find(m => hasModel(models, m) && m !== strong)
  return { strong, fast: strong && fast && STRONG_ORDER.indexOf(fast) > STRONG_ORDER.indexOf(strong) ? fast : undefined }
}

/** The embedding model behind similar-question hits: 46 MB, fast on a CPU. */
export const EMBED_MODEL = 'all-minilm'

/** Fetches the embedding model in the background if it is missing; quiet, and harmless when it fails. */
export async function ensureEmbedModel($: EngineInterface, opts: Options) {
  const name = state.cfg.embedModel ?? EMBED_MODEL
  const models = await listLocalModels($, opts.ollamaUrl)
  if (!models || hasModel(models, name)) return
  const bin = await findOllama($, await detectPlatform($))
  if (bin) await pullModel($, bin, name)
}

export type SetupOutcome = 'ready' | 'started' | 'running' | 'declined' | 'unreachable'

export async function ensureLocal(
  $: EngineInterface,
  opts: Options,
  mode: 'on' | 'auto',
  isConsented = false,
): Promise<SetupOutcome> {
  const { cfg } = state
  const turnOn = async () => {
    cfg.local = mode
    await saveSettings($)
  }

  const models = await listLocalModels($, opts.ollamaUrl)
  if (models !== undefined && hasModel(models, cfg.localModel)) {
    await turnOn()
    if (opts.semanticCache) void ensureEmbedModel($, opts).catch(() => undefined)
    return 'ready'
  }
  // Nothing picked by hand and good models already installed: make the best of them the team, download nothing.
  if (models !== undefined && !cfg.isModelChosen) {
    const team = teamFromInstalled(models)
    if (team.strong) {
      cfg.localModel = team.strong
      cfg.fastModel = team.fast
      await turnOn()
      if (opts.semanticCache) void ensureEmbedModel($, opts).catch(() => undefined)
      return 'ready'
    }
  }
  const model = cfg.localModel
  if (setup.isRunning) return 'running'

  const platform = await detectPlatform($)
  let bin = await findOllama($, platform)
  const isLocalServer = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(opts.ollamaUrl)

  if (!bin && models === undefined) {
    if (!isLocalServer) return 'unreachable'
  }
  if (!bin && models === undefined && !isConsented) {
    const answer = await $.ui.ask(
      `The local model needs Ollama installed and the model "${model}" downloaded (about 1 GB, once). Set it up now?`,
      { options: ['Yes, set it all up', 'Not now'], header: 'Local model' },
    ).catch(() => 'Not now')
    if (!answer.startsWith('Yes')) return 'declined'
  }

  setup.isRunning = true
  setup.startedAt = await $.clock.now()
  void (async () => {
    try {
      if (!bin) {
        say($, 'Installing Ollama')
        const isInstalled = await installOllama($, platform)
        bin = isInstalled ? await findOllama($, platform) : undefined
        $.ui.status(undefined)
        if (!bin) {
          $.ui.toast('Could not install Ollama. Install it from ollama.com, then run /local on again.')
          return
        }
      }
      say($, 'Starting the Ollama server')
      if (!(await startServer($, bin, opts.ollamaUrl))) {
        $.ui.toast('The Ollama server did not start. Open the Ollama app once, then run /local on again.')
        return
      }
      const now = (await listLocalModels($, opts.ollamaUrl)) ?? []
      if (!hasModel(now, model)) {
        // Some tags fail to pull on some setups; try the next good small model before giving up.
        let got: string | undefined
        for (const candidate of [model, ...FALLBACK_MODELS.filter(m => m !== model)]) {
          if (candidate !== model) say($, `"${model}" could not be downloaded; trying ${candidate}`)
          if ((await pullModel($, bin, candidate)) && hasModel((await listLocalModels($, opts.ollamaUrl)) ?? [], candidate)) {
            got = candidate
            break
          }
        }
        if (!got) {
          $.ui.toast(`Could not download a local model. Check your internet connection, then run /local on again.`)
          return
        }
        cfg.localModel = got
      }
      await turnOn()
      if (opts.semanticCache) await ensureEmbedModel($, opts).catch(() => undefined)
      say($, 'Local model is ready!')
      $.ui.toast(`Local model is ready! ${mode === 'on' ? 'Prompts that start with ~' : 'General questions'} now run on your machine, 0 Claude tokens.`)
    } catch {
      $.ui.toast('Local setup stopped halfway. Run /local on again.')
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
          'Quota Saver: set up a free local model for general questions? It installs Ollama and downloads a ~1 GB model, once.',
          { options: ['Yes, set it all up', 'No'], header: 'Local model' },
        ).catch(() => 'No')
        if (answer.startsWith('Yes')) await ensureLocal($, opts, 'on', true)
      })()
      return
    }
  }
  if (state.cfg.local === 'off' || (await isServing($, opts.ollamaUrl))) return
  const bin = await findOllama($, await detectPlatform($))
  if (bin) void startServer($, bin, opts.ollamaUrl)
}
