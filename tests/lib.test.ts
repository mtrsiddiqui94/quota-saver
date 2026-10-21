import { expect, test } from 'claude-code/testing'

import { detectIntent } from '../hooks/lib/intent'
import { cacheKey, expand, lookup, normalize, parseEntry, remember } from '../hooks/lib/memory'
import { hasModel } from '../hooks/features/local-setup'
import { compareTurn } from '../hooks/features/compare'
import { junkReason } from '../hooks/lib/junk'
import { routeLocal } from '../hooks/lib/local'
import { trimOutput } from '../hooks/lib/trim'

test('long output keeps head, tail and error lines', async () => {
  const lines = Array.from({ length: 2000 }, (_, i) => (i === 900 ? 'Error: boom at x.ts:9' : `ok line ${i}`))
  const t = trimOutput(lines.join('\n'), 6000)
  expect(t.savedChars).toBeGreaterThan(10000)
  expect(t.text).toContain('ok line 0')
  expect(t.text).toContain('ok line 1999')
  expect(t.text).toContain('Error: boom at x.ts:9')
})

test('short output is left alone', async () => {
  expect(trimOutput('hello', 6000)).toEqual({ text: 'hello', savedChars: 0 })
})

test('roman spellings fold together', async () => {
  expect(normalize('Kia ye theek ha?')).toBe(normalize('kya ye thik hai'))
  expect(cacheKey('/p', 'auth kaise kaam karta ha')).toBe(cacheKey('/p', 'Auth kaise kaam karta hai!'))
})

test('dictionary entries parse and expand', async () => {
  expect(parseEntry('dp = staging pe deploy karo')).toEqual({ key: 'dp', value: 'staging pe deploy karo' })
  expect(parseEntry('no equals')).toBeUndefined()
  const dict = { dp: 'staging pe deploy karo' }
  expect(expand('dp', dict)).toBe('staging pe deploy karo')
  expect(expand('pehle #dp phir batao', dict)).toBe('pehle staging pe deploy karo phir batao')
  expect(expand('#nahi-hai', dict)).toBe('#nahi-hai')
})

test('answer cache expires', async () => {
  const cache = remember({}, 'k', 'jawab', 1000)
  expect(lookup(cache, 'k', 2000)?.answer).toBe('jawab')
  expect(lookup(cache, 'k', 1000 + 4 * 24 * 3600 * 1000)).toBeUndefined()
})

test('intent detection in english and roman urdu', async () => {
  expect(detectIntent('login pe error aa raha hai theek karo')).toBe('fix')
  expect(detectIntent('ye function kya karta hai samjhao')).toBe('explain')
  expect(detectIntent('tests chalao')).toBe('test')
  expect(detectIntent('meri changes review karo')).toBe('review')
  expect(detectIntent('users page pe search box banao')).toBe('build')
  expect(detectIntent('shukriya')).toBeUndefined()
})

test('local routing respects the switch and keeps project questions on Claude', async () => {
  expect(routeLocal('~docker kya hai', 'off')).toBeUndefined()
  expect(routeLocal('~docker kya hai', 'on')).toBe('docker kya hai')
  expect(routeLocal('docker kya hai?', 'on')).toBeUndefined()
  expect(routeLocal('docker kya hai?', 'auto')).toBe('docker kya hai?')
  expect(routeLocal('what is a closure in javascript?', 'auto')).toBe('what is a closure in javascript?')
  expect(routeLocal('ye function kya karta hai?', 'auto')).toBeUndefined()
  expect(routeLocal('auth.ts mein kya hai?', 'auto')).toBeUndefined()
  expect(routeLocal('login ka error theek karo', 'auto')).toBeUndefined()
})

test('model names match with or without a tag', async () => {
  expect(hasModel(['qwen2.5:3b'], 'qwen2.5:3b')).toBe(true)
  expect(hasModel(['llama3.2:latest'], 'llama3.2')).toBe(true)
  expect(hasModel(['qwen2.5:1.5b'], 'qwen2.5:3b')).toBe(false)
})

test('junk paths are told apart from source', async () => {
  expect(junkReason('/p/node_modules/x/index.js')).toBe('dependency or build folder')
  expect(junkReason('C:\\p\\dist\\main.js')).toBe('dependency or build folder')
  expect(junkReason('/p/yarn.lock')).toBe('lock file')
  expect(junkReason('/p/static/app.min.js')).toBe('minified or generated file')
  expect(junkReason('/p/src/build.ts')).toBeUndefined()
  expect(junkReason('/p/src/distance.ts')).toBeUndefined()
  expect(junkReason('/p/src/index.ts')).toBeUndefined()
})

test('turn comparison multiplies what was kept out by the requests made', async () => {
  const usage = { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, model: 'm' }
  expect(compareTurn(usage, 0, 10_000, 3)).toEqual({ used: 41_500, baseline: 61_500, saved: 20_000, requests: 4 })
  expect(compareTurn(usage, 0, 0, 0)).toEqual({ used: 41_500, baseline: 41_500, saved: 0, requests: 1 })
})
