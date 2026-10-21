// Local model through Ollama: questions that need no project context are
// answered on this machine, so they cost no Claude quota.

import type { EngineInterface } from 'claude-code'

import { detectIntent } from './intent'

export type LocalMode = 'off' | 'on' | 'auto'

export type Settings = {
  /** The whole plugin; off, every hook passes straight through. */
  isEnabled: boolean
  /** off: never local. on: prompts starting with ~ go local. auto: also simple general questions. */
  local: LocalMode
  localModel: string
  /** Whether the first-run choice about the local model has been acted on. */
  isOnboarded: boolean
}

export const DEFAULT_SETTINGS: Settings = { isEnabled: true, local: 'off', localModel: 'qwen2.5:1.5b', isOnboarded: false }

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

const SYSTEM = 'You are a concise assistant. The user may write in Roman Urdu or English; reply in the same language and style, in at most 12 lines.'

export type LocalReply = { isAnswered: true; text: string } | { isAnswered: false; reason: string }

export async function askLocal($: EngineInterface, url: string, model: string, prompt: string, system = SYSTEM): Promise<LocalReply> {
  try {
    const res = await $.http.fetch(`${url.replace(/\/$/, '')}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
        options: { num_predict: 500, temperature: 0.3 },
      }),
    })
    if (!res.ok) {
      return { isAnswered: false, reason: res.status === 404 ? `model "${model}" not found: ollama pull ${model}` : `Ollama answered ${res.status}` }
    }
    const body = JSON.parse(res.text) as { message?: { content?: string } }
    const text = body.message?.content?.trim()
    return text ? { isAnswered: true, text } : { isAnswered: false, reason: 'empty answer' }
  } catch {
    return { isAnswered: false, reason: 'Ollama is not running (ollama serve)' }
  }
}

export async function listLocalModels($: EngineInterface, url: string): Promise<string[] | undefined> {
  try {
    const res = await $.http.fetch(`${url.replace(/\/$/, '')}/api/tags`)
    if (!res.ok) return undefined
    const body = JSON.parse(res.text) as { models?: { name?: string }[] }
    return (body.models ?? []).map(m => m.name ?? '').filter(Boolean)
  } catch {
    return undefined
  }
}
