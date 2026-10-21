// Local model through Ollama: questions that need no project context are
// answered on this machine, so they cost no Claude quota.

import type { EngineInterface } from 'claude-code'

import { detectIntent } from './intent'
import { stripThinking } from './judge'

export type LocalMode = 'off' | 'on' | 'auto'

export type Settings = {
  /** The whole plugin; off, every hook passes straight through. */
  isEnabled: boolean
  /** off: never local. on: prompts starting with ~ go local. auto: also simple general questions. */
  local: LocalMode
  /** The strong model of the local team: harder questions, and the second opinion. */
  localModel: string
  /** The fast model of the local team, for short questions; unset, the strong model answers all. */
  fastModel?: string
  /** The team's Roman Urdu specialist: Roman Urdu questions go to it first. */
  urduModel?: string
  /** True once the person picked the model with /local model; until then the default (or what is installed) is used. */
  isModelChosen: boolean
  /** Whether the first-run choice about the local model has been acted on. */
  isOnboarded: boolean
}

export const DEFAULT_SETTINGS: Settings = { isEnabled: true, local: 'off', localModel: 'qwen2.5:1.5b', isModelChosen: false, isOnboarded: false }

const PROJECT_HINT = /[\\/]|\.\w{1,5}\b|`|\b(file|folder|repo|project|codebase|function|class|component|ye|yeh|isko|iska|mera|meri|mere|hamara)\b/i
const QUESTION = /\?|\b(what|why|how|when|which|kya|kyun|kyon|kaise|kab|kaun|kis|matlab|difference|farq)\b/i

/** Whether a prompt goes to the local model; returns the text to send, or undefined. */
export function routeLocal(text: string, mode: LocalMode): string | undefined {
  if (mode === 'off') return undefined
  const trimmed = text.trim()
  if (trimmed.startsWith('~')) return trimmed.slice(1).trim() || undefined
  if (mode !== 'auto' || trimmed.length > 300) return undefined
  const intent = detectIntent(trimmed)
  if (intent !== undefined && intent !== 'explain') return undefined
  return QUESTION.test(trimmed) && !PROJECT_HINT.test(trimmed) ? trimmed : undefined
}

const SYSTEM =
  'You are a concise, accurate assistant. Reply in the language and script the user wrote in: if they wrote Roman Urdu (Urdu in English letters, like "kya hai", "batao"), reply in Roman Urdu, never in Urdu or Persian script. If unsure of a fact, say so. At most 12 lines.'

export type LocalReply = { isAnswered: true; text: string } | { isAnswered: false; reason: string }

export async function askLocal(
  $: EngineInterface,
  url: string,
  model: string,
  prompt: string,
  system = SYSTEM,
  maxTokens = 500,
): Promise<LocalReply> {
  const send = (withThink: boolean) =>
    $.http.fetch(`${url.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        // Reasoning models (Qwen3 and later) think before answering unless told not to: 2-3x slower for a plain question.
        ...(withThink ? { think: false } : {}),
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        options: { num_predict: maxTokens, temperature: 0.3 },
      }),
    })
  try {
    let res = await send(true)
    // A model without a thinking mode may refuse the field: ask again without it.
    if (res.status === 400 && /think/i.test(res.text)) res = await send(false)
    if (!res.ok) {
      return { isAnswered: false, reason: res.status === 404 ? `model "${model}" not found: ollama pull ${model}` : `Ollama answered ${res.status}` }
    }
    const body = JSON.parse(res.text) as { message?: { content?: string } }
    const text = stripThinking(body.message?.content ?? '')
    return text ? { isAnswered: true, text } : { isAnswered: false, reason: 'empty answer' }
  } catch {
    return { isAnswered: false, reason: 'Ollama is not running (ollama serve)' }
  }
}

export async function listLocalModels($: EngineInterface, url: string): Promise<string[] | undefined> {
  return (await listLocalModelSizes($, url))?.map(m => m.name)
}

/** Installed models with their size on disk, in bytes. */
export async function listLocalModelSizes($: EngineInterface, url: string): Promise<{ name: string; size: number }[] | undefined> {
  try {
    const res = await $.http.fetch(`${url.replace(/\/$/, '')}/api/tags`)
    if (!res.ok) return undefined
    const body = JSON.parse(res.text) as { models?: { name?: string; size?: number }[] }
    return (body.models ?? []).filter(m => m.name).map(m => ({ name: m.name ?? '', size: m.size ?? 0 }))
  } catch {
    return undefined
  }
}
