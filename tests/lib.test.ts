import { expect, test } from 'claude-code/testing'

import { detectIntent } from '../hooks/lib/intent'
import { cacheKey, expand, lookup, normalize, parseEntry, remember } from '../hooks/lib/memory'
import { hasModel } from '../hooks/features/local-setup'
import { compareTurn } from '../hooks/features/compare'
import { pickTeam, teamOrder } from '../hooks/features/local-team'
import { judgeReply, stripThinking } from '../hooks/lib/judge'
import { junkReason } from '../hooks/lib/junk'
import { routeLocal } from '../hooks/lib/local'
import { language, replaceWords, userWords } from '../hooks/lib/prompt'
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

test('typed words are found inside editor blocks', async () => {
  const t = '<browser_instruction>tools...</browser_instruction>\nfix the bug<system-reminder>x</system-reminder>'
  expect(userWords(t)).toBe('fix the bug')
  expect(userWords('plain prompt')).toBe('plain prompt')
  expect(replaceWords(t, 'fix the bug', 'fix the login bug')).toBe('<browser_instruction>tools...</browser_instruction>\nfix the login bug<system-reminder>x</system-reminder>')
  expect(replaceWords('dp', 'dp', 'deploy')).toBe('deploy')
})

test('reply language is told apart', async () => {
  expect(language('main aik android game banana chahta hun ideas do')).toBe('Roman Urdu')
  expect(language('give me ideas for an android game')).toBe('English')
})

test('the judge rejects wrong script, loops and empty replies', async () => {
  expect(judgeReply('docker kya hai?', 'Docker یک پروژه است که سیستم').isUsable).toBe(false)
  expect(judgeReply('what is x?', 'ok').isUsable).toBe(false)
  const loop = Array.from({ length: 4 }, () => 'This is the same line again and again').join('\n')
  expect(judgeReply('what is x?', loop).isUsable).toBe(false)
  const good = judgeReply('docker kya hai?', 'Docker aik tool hai jo apps ko containers mein chalata hai.')
  expect(good).toEqual({ isUsable: true, isLanguageMatch: true })
  expect(judgeReply('docker kya hai?', 'Docker is a tool that runs apps in containers.').isLanguageMatch).toBe(false)
  expect(stripThinking('<think>hmm</think>Answer')).toBe('Answer')
})

test('the team order puts the fast model first only for short questions', async () => {
  expect(teamOrder('docker kya hai?', 'qwen3:4b', 'qwen3:1.7b')).toEqual(['qwen3:1.7b', 'qwen3:4b'])
  expect(teamOrder('x'.repeat(200), 'qwen3:4b', 'qwen3:1.7b')).toEqual(['qwen3:4b', 'qwen3:1.7b'])
  expect(teamOrder('q', 'qwen3:4b', undefined)).toEqual(['qwen3:4b'])
})

test('pickTeam: strong = best answers then larger; fast only when clearly faster', async () => {
  const team = pickTeam([
    { model: 'a:1b', size: 1e9, secs: 2, usable: 3, matched: 2 },
    { model: 'b:4b', size: 3e9, secs: 6, usable: 3, matched: 3 },
    { model: 'c:9b', size: 6e9, secs: 40, usable: 3, matched: 3 },
    { model: 'd:2b', size: 2e9, secs: 3, usable: 2, matched: 2 },
  ])
  expect(team).toEqual({ strong: 'b:4b', fast: 'a:1b' })
  expect(pickTeam([])).toEqual({})
})
