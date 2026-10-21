import { expect, test } from 'claude-code/testing'

import { detectIntent } from '../hooks/lib/intent'
import { cacheKey, cosine, expand, lookup, nearest, normalize, parseEntry, remember } from '../hooks/lib/memory'
import { hasModel, teamFromInstalled } from '../hooks/features/local-setup'
import { compareTurn } from '../hooks/features/compare'
import { pickTeam, teamOrder } from '../hooks/features/local-team'
import { judgeReply, stripThinking } from '../hooks/lib/judge'
import { collapseRepeats, commandKind, filterOutput } from '../hooks/lib/filters'
import { humanMinutes, minutesToFull } from '../hooks/lib/burn'
import { junkReason } from '../hooks/lib/junk'
import { formatOutline, outline } from '../hooks/lib/outline'
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
  expect(compareTurn(usage, 0, 10_000, 3)).toEqual({ used: 41_500, baseline: 61_500, saved: 20_000, requests: 4, fullPrice: 1_500, cheap: 40_000 })
  expect(compareTurn(usage, 0, 0, 0)).toEqual({ used: 41_500, baseline: 41_500, saved: 0, requests: 1, fullPrice: 1_500, cheap: 40_000 })
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
  expect(teamOrder('docker kya hai? batao', 'qwen3:4b', 'qwen3:1.7b', 'gemma3:4b')).toEqual(['gemma3:4b', 'qwen3:4b'])
  expect(teamOrder('what is docker?', 'qwen3:4b', 'qwen3:1.7b', 'gemma3:4b')).toEqual(['qwen3:1.7b', 'qwen3:4b'])
})

test('pickTeam: strong = best answers then larger; fast only when clearly faster', async () => {
  const team = pickTeam([
    { model: 'a:1b', size: 1e9, secs: 2, usable: 3, matched: 2 },
    { model: 'b:4b', size: 3e9, secs: 6, usable: 3, matched: 3 },
    { model: 'c:9b', size: 6e9, secs: 40, usable: 3, matched: 3 },
    { model: 'd:2b', size: 2e9, secs: 3, usable: 2, matched: 2 },
  ])
  expect(team).toEqual({ strong: 'b:4b', fast: 'a:1b', urdu: undefined })
  const withUrdu = pickTeam([
    { model: 'b:4b', size: 3e9, secs: 6, usable: 3, matched: 2, urduMatched: 0 },
    { model: 'g:4b', size: 3e9, secs: 7, usable: 3, matched: 2, urduMatched: 2 },
  ])
  expect(withUrdu.urdu).toBe('g:4b')
  expect(pickTeam([])).toEqual({})
})

test('commands are told apart by kind', async () => {
  expect(commandKind('npx vitest run')).toBe('test')
  expect(commandKind('cd app && npm test -- auth')).toBe('test')
  expect(commandKind('pnpm install')).toBe('install')
  expect(commandKind('pip install -r requirements.txt')).toBe('install')
  expect(commandKind('npm run build')).toBe('build')
  expect(commandKind('ls -la')).toBe('other')
})

test('filters drop noise and passing tests, never errors', async () => {
  const install = ['npm warn deprecated x', 'reify:lodash: timing reifyNode', 'added 812 packages in 21s', 'npm ERR! code ERESOLVE'].join('\n')
  const f = filterOutput('npm install', install)
  expect(f?.text).toContain('npm ERR! code ERESOLVE')
  expect(f?.text).toContain('added 812 packages')
  expect(f?.text).not.toContain('reify:')
  const t = filterOutput('pytest', ['test_a.py::test_one PASSED', 'test_b.py::test_two FAILED', 'AssertionError: 1 != 2'].join('\n'))
  expect(t?.text).toBe('test_b.py::test_two FAILED\nAssertionError: 1 != 2')
  expect(collapseRepeats(['a', 'a', 'a', 'b'])).toEqual(['a  [×3]', 'b'])
  expect(filterOutput('ls', 'one\ntwo')).toBeUndefined()
})

const TS_FILE = [
  "import x from 'y'",
  'export function login(user: User) {',
  '  if (user) {',
  '  }',
  '}',
  'export class AuthService {',
  '  constructor(private db: Db) {',
  '  }',
  '  async verify(token: string): Promise<boolean> {',
  '    return true',
  '  }',
  '}',
  'export const hash = async (s: string) => s',
  'export interface User { id: string }',
].join('\n')

test('outline finds declarations with line numbers and skips control flow', async () => {
  const o = outline('/p/auth.ts', TS_FILE)
  expect(o.lines).toBe(14)
  const text = o.symbols.join('\n')
  expect(text).toContain('2  export function login(user: User)')
  expect(text).toContain('6  export class AuthService')
  expect(text).toContain('async verify(token: string): Promise<boolean>')
  expect(text).toContain('13  export const hash = async (s: string) => s')
  expect(text).toContain('14  export interface User')
  expect(text).not.toContain('if (user)')
})

test('outline works for Python and Markdown too', async () => {
  const py = outline('/p/app.py', 'import os\nclass Repo:\n    def save(self, x):\n        pass\nasync def main():\n    pass')
  expect(py.symbols.map(s => s.trim())).toEqual(['2  class Repo:', '3    def save(self, x):', '5  async def main():'])
  const md = outline('/p/README.md', '# Title\ntext\n## Install\nmore')
  expect(md.symbols.length).toBe(2)
  expect(formatOutline('a.txt', outline('a.txt', 'plain text'))).toContain('no declarations recognised')
})

test('burn rate projects time to full from the pace so far', async () => {
  expect(minutesToFull([{ at: 0, pct: 40 }, { at: 10 * 60_000, pct: 50 }])).toBe(50)
  expect(minutesToFull([{ at: 0, pct: 40 }])).toBeUndefined()
  expect(minutesToFull([{ at: 0, pct: 40 }, { at: 60_000, pct: 41 }])).toBeUndefined()
  expect(humanMinutes(135)).toBe('2 h 15 min')
})

test('nearest finds a similar cached question in the same project only', async () => {
  expect(Math.round(cosine([1, 0], [1, 0]) * 1000)).toBe(1000)
  expect(Math.round(cosine([1, 0], [0, 1]) * 1000)).toBe(0)
  let cache = remember({}, cacheKey('/p', 'docker kya hai'), 'A', 1000, { q: 'docker kya hai', vec: [1, 0, 0] })
  cache = remember(cache, cacheKey('/other', 'docker kya hai'), 'B', 1000, { vec: [1, 0, 0] })
  expect(nearest(cache, '/p', [0.99, 0.1, 0], 2000)?.hit.answer).toBe('A')
  expect(nearest(cache, '/p', [0, 1, 0], 2000)).toBeUndefined()
  expect(nearest(cache, '/q', [1, 0, 0], 2000)).toBeUndefined()
})

test('app builds: mobile and web build output and folders are recognised', async () => {
  expect(commandKind('cd ios && pod install')).toBe('install')
  expect(commandKind('./gradlew assembleDebug')).toBe('build')
  expect(commandKind('npx react-native run-android')).toBe('build')
  expect(commandKind('npx vite build')).toBe('build')
  const gradle = ['> Task :app:preBuild UP-TO-DATE', '> Task :app:compileDebugKotlin', 'e: MainActivity.kt:12 Unresolved reference: foo', '> Task :app:mergeDebugResources UP-TO-DATE', 'BUILD FAILED in 41s'].join('\n')
  const g = filterOutput('./gradlew assembleDebug', gradle)
  expect(g?.text).toContain('Unresolved reference: foo')
  expect(g?.text).toContain('BUILD FAILED')
  expect(g?.text).not.toContain('UP-TO-DATE')
  expect(junkReason('/app/.expo/web/cache/x.json')).toBe('dependency or build folder')
  expect(junkReason('/app/ios/Pods/React/x.h')).toBe('dependency or build folder')
  expect(junkReason('/app/src/screens/Home.tsx')).toBeUndefined()
})

test('a long prompt still gets its task type from its opening', async () => {
  const spec = 'Build a React Native todo app with offline sync. ' + 'Requirement detail. '.repeat(300)
  expect(detectIntent(spec)).toBe('build')
})

test('the team is made from what is installed, best first', async () => {
  expect(teamFromInstalled(['qwen3:1.7b', 'gemma4:e2b'])).toEqual({ strong: 'gemma4:e2b', fast: 'qwen3:1.7b' })
  expect(teamFromInstalled(['qwen3:1.7b'])).toEqual({ strong: 'qwen3:1.7b', fast: undefined })
  expect(teamFromInstalled(['all-minilm'])).toEqual({ strong: undefined, fast: undefined })
})
