// The switches and the personal dictionary: /quota-saver, /local, /yaad, /bhool.

import type { EngineInterface, On } from 'claude-code'

import { listLocalModels } from '../lib/local'
import { parseEntry } from '../lib/memory'
import type { Dictionary } from '../lib/memory'
import { formatK, tokens } from '../lib/trim'
import { lifetime, saveSettings, state, STORE } from '../core/state'
import type { Options } from '../core/state'
import { ensureLocal, hasModel } from './local-setup'
import type { SetupOutcome } from './local-setup'
import { refreshStatus } from './meter'

const LOCAL_OUTCOME: Record<SetupOutcome, (model: string, how: string, url: string) => string> = {
  ready: (model, how) => `Local model chalu (${model}). ${how}`,
  started: (model, how) =>
    `Local model setup shuru: Ollama aur "${model}" khud tayyar ho rahe hain (status line par progress). Pehli dafa kuch minute lagenge; tayyar hote hi local mode khud chalu ho jaayega.\n${how}`,
  running: () => 'Local setup pehle se chal raha hai; status line dekhein.',
  declined: () => 'Theek hai, kuch install nahi kiya. Jab chahein /local on dobara likhein.',
  unreachable: (_model, _how, url) => `Ollama ${url} par nahi mila. ollamaUrl setting check karein.`,
}

export const COMMANDS = [
  { name: 'quota-saver', description: 'Token bachat ka hisaab; /quota-saver on ya off se poora plugin chalu/band', argumentHint: '[on | off]' },
  { name: 'local', description: 'Local model (Ollama): /local on, /local auto, /local off, /local model <naam>', argumentHint: '[on | auto | off | model <naam>]' },
  { name: 'yaad', description: 'Apni dictionary: /yaad dp = staging pe deploy karo. Phir sirf "dp" ya "#dp" likhein', argumentHint: '[naam = matlab]' },
  { name: 'bhool', description: 'Dictionary se shortcut ya local jawab cache mitao', argumentHint: '[naam | cache]' },
  { name: 'naya-kaam', description: 'Session ka 12-line khulasa bana kar context saaf karo (sasta /compact + /clear)', argumentHint: '[agla kaam, optional]' },
  { name: 'wapas', description: 'Pichhle session ka khulasa wapas lao: poori history ke bajaye sirf 12 lines' },
] as const

async function getDictionary($: EngineInterface): Promise<Dictionary> {
  return ((await $.store.get(STORE.dictionary)) ?? {}) as Dictionary
}

export function installCommands(on: On, opts: Options) {
  on('command.run', { command: 'quota-saver' }, async ($, e) => {
    const { cfg, session } = state
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      cfg.isEnabled = arg === 'on'
      await saveSettings($)
      await refreshStatus($).catch(() => undefined)
      return { text: cfg.isEnabled ? 'Quota Saver chalu: token bachat on.' : 'Quota Saver band: sab kuch normal Claude jaisa. Wapas chalu: /quota-saver on' }
    }

    const life = await lifetime($)
    const { context, rateLimits, cost } = await $.session.usage()
    const label = (kind: string) => (kind === 'five_hour' ? '5 ghante' : kind === 'seven_day' ? '7 din' : kind)
    const limits = rateLimits.map(r => `${label(r.kind)}: ${r.percentUsed}%`)
    const lines = [
      'Quota Saver: token bachat',
      '',
      `Halat: ${cfg.isEnabled ? 'chalu' : 'BAND (/quota-saver on)'} · local model: ${cfg.local}${cfg.local === 'off' ? '' : ` (${cfg.localModel})`}`,
      '',
      `Is session mein: ~${formatK(tokens(session.savedChars))} tokens bache (${session.trims} outputs chhote kiye, ${session.blockedReads} faltu reads roke, ${session.cacheHits} cache jawab, ${session.localAnswers} local model jawab)`,
      `Ab tak kul:      ~${formatK(tokens(life.savedChars))} tokens bache (${life.trims} outputs, ${life.blockedReads} reads, ${life.cacheHits} cache, ${life.localAnswers} local model)`,
      '',
      `Context: ${context.percent !== undefined ? `${context.percent}% of ${formatK(context.window)}` : 'abhi koi reading nahi'}`,
      ...(limits.length ? [`Quota:   ${limits.join(' · ')}`] : []),
      ...(cost ? [`Kharcha: $${cost.usd.toFixed(2)}`] : []),
      '',
      'Yaad rakhne ki zaroorat nahi: aam tarah likhein, plugin khud samajh leta hai.',
      'Kaam badla? /naya-kaam · Kal wapas aaye? /wapas · Shortcut? /yaad · Local model? /local',
      'Band/chalu: /quota-saver off · /quota-saver on',
    ]
    return { text: lines.join('\n') }
  }).catch(() => ({ text: 'quota-saver: ye command abhi nahi chal saka. Dobara koshish karein.' }))

  on('command.run', { command: 'local' }, async ($, e) => {
    const { cfg } = state
    const [word = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = word.toLowerCase()
    if (arg === 'off') {
      cfg.local = 'off'
      await saveSettings($)
      await refreshStatus($).catch(() => undefined)
      return { text: 'Local model band. Sab kuch Claude se.' }
    }
    if (arg === 'on' || arg === 'auto') {
      const how =
        arg === 'on'
          ? 'Jo prompt ~ se shuru ho (misal: ~docker kya hai) wo aapki machine par chalega, 0 Claude tokens.'
          : '~ wale prompts ke ilawa aam sawal (jin mein project ya file ka zikr na ho) bhi khud local model par jaayenge.'
      const outcome = await ensureLocal($, opts, arg)
      await refreshStatus($).catch(() => undefined)
      return { text: LOCAL_OUTCOME[outcome](cfg.localModel, how, opts.ollamaUrl) }
    }
    if (arg === 'model') {
      const name = rest.join(' ').trim()
      if (!name) return { text: 'Format: /local model qwen2.5:1.5b' }
      cfg.localModel = name
      await saveSettings($)
      if (cfg.local === 'off') return { text: `Local model ab: ${name}. Chalu karne ke liye: /local on` }
      const outcome = await ensureLocal($, opts, cfg.local)
      return { text: LOCAL_OUTCOME[outcome](name, `Local model ab: ${name}.`, opts.ollamaUrl) }
    }

    const models = await listLocalModels($, opts.ollamaUrl)
    const header = `Local mode: ${cfg.local} · model: ${cfg.localModel}`
    if (models === undefined) {
      return { text: `${header}\nOllama abhi nahi chal raha.\n\n/local on likhein: plugin khud Ollama install karega, model download karega aur chalu kar dega.` }
    }
    return {
      text: `${header}\nOllama chal raha hai. Models: ${models.join(', ') || 'koi nahi'}${hasModel(models, cfg.localModel) ? '' : `\n"${cfg.localModel}" abhi download nahi hua: /local on se khud ho jaayega.`}\n\n/local on · /local auto · /local off · /local model <naam>`,
    }
  }).catch(() => ({ text: 'quota-saver: ye command abhi nahi chal saka. Dobara koshish karein.' }))

  on('command.run', { command: 'yaad' }, async ($, e) => {
    const dict = await getDictionary($)
    const args = e.args.trim()
    if (args === '') {
      const names = Object.keys(dict).sort()
      return {
        text: names.length
          ? `Aapki dictionary (${names.length}):\n${names.map(n => `  ${n} = ${dict[n]}`).join('\n')}\n\nUse: sirf naam likhein, ya jumle mein #naam.`
          : 'Dictionary khaali hai. Misal: /yaad dp = staging pe deploy karo, pehle tests chalao',
      }
    }
    const entry = parseEntry(args)
    if (!entry) return { text: 'Format: /yaad naam = poora matlab   (naam mein sirf letters, numbers, - ya _)' }
    await $.store.set(STORE.dictionary, { ...dict, [entry.key]: entry.value })
    return { text: `Yaad kar liya: "${entry.key}" ya "#${entry.key}" likhne par → ${entry.value}` }
  }).catch(() => ({ text: 'quota-saver: ye command abhi nahi chal saka. Dobara koshish karein.' }))

  on('command.run', { command: 'bhool' }, async ($, e) => {
    const name = e.args.trim().toLowerCase().replace(/^#/, '')
    if (name === 'cache') {
      await $.store.delete(STORE.answers)
      return { text: 'Local jawab cache saaf kar diya.' }
    }
    const dict = await getDictionary($)
    if (!(name in dict)) return { text: `"${name}" dictionary mein nahi hai. /yaad se list dekhein.` }
    const { [name]: _gone, ...rest } = dict
    await $.store.set(STORE.dictionary, rest)
    return { text: `"${name}" bhool gaya.` }
  }).catch(() => ({ text: 'quota-saver: ye command abhi nahi chal saka. Dobara koshish karein.' }))
}
