// End-to-end: the plugin loaded by the engine, every feature driven through
// the same events a session raises, with the world beneath it mocked.

import type { Args, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { cacheKey } from '../hooks/lib/memory'

const CWD = '/work/app'

// The engine fills origin, wait and presentation in a session; a test names the rest.
const submit = ($: Engine, text: string) => $.prompt.submit({ text } as Args<'prompt.submit'>)
const run = ($: Engine, command: string, args = '') => $.command.run({ command, args } as Args<'command.run'>)

type World = {
  store?: Record<string, unknown>
  files?: Record<string, { size: number; mtimeMs: number }>
  /** The Ollama server: answers by URL; absent, nothing listens. */
  ollama?: (url: string, body: string) => { status: number; text: string }
  /** Host commands: answers by argv; absent or undefined, the command cannot start. */
  host?: (argv: readonly string[]) => { exitCode: number; stdout?: string } | undefined
  /** What the person picks in a question dialog. */
  answer?: string
  /** What $.session.usage reports: rate limits, and a context breakdown when asked for one. */
  usage?: { rateLimits?: { kind: string; percentUsed: number; resetsAt?: string }[]; breakdown?: unknown }
}

/** An Ollama that has `models` pulled and answers chat with `reply` (or fails with `chatStatus`). */
function ollamaServer(models: string[], reply = 'Docker ek container tool hai.', chatStatus = 200) {
  return (url: string) =>
    url.endsWith('/api/tags')
      ? { status: 200, text: JSON.stringify({ models: models.map(name => ({ name })) }) }
      : chatStatus === 200
        ? { status: 200, text: JSON.stringify({ message: { content: reply } }) }
        : { status: chatStatus, text: '' }
}

/** The engine beneath the plugin: store, clock, cwd, files, usage, network. */
function world(on: On, w: World = {}) {
  mock.store(on, w.store ?? {})
  const clock = mock.clock(on, { now: 1_000_000 })
  const seen = { prompts: [] as { text: string; context?: readonly string[] }[], reads: 0, fetches: [] as string[], commands: [] as string[], asked: 0 }

  mock.env(on, { HOME: '/home/u' })
  on('process.run', ($, e) => {
    seen.commands.push(e.argv.join(' '))
    const r = w.host?.(e.argv)
    return r ? { value: { exitCode: r.exitCode, stdout: r.stdout ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } } : { deny: 'ENOENT' }
  })
  // $.ui.ask is the AskUserQuestion dialog: answer it as the person would.
  on('tool.call', { tool: 'AskUserQuestion' }, ($, e) => {
    seen.asked += 1
    if (w.answer === undefined) return { deny: 'dismissed' }
    const question = e.questions[0]?.question ?? ''
    return { result: { questions: e.questions, answers: { [question]: w.answer } } as never }
  })

  on('session.cwd', () => ({ value: CWD }))
  on('session.usage', ($, e) => ({
    value: {
      startedAt: 0,
      context: { window: 200000, tokens: 50000, percent: 25, ...(e.breakdown && w.usage?.breakdown ? { breakdown: w.usage.breakdown } : {}) },
      rateLimits: w.usage?.rateLimits ?? [],
    } as never,
  }))
  on('fs.stat', ($, e) => {
    const f = w.files?.[e.path]
    if (!f) return { deny: 'ENOENT' }
    return { value: { kind: 'file' as const, size: f.size, mtimeMs: f.mtimeMs, isLink: false } }
  })
  on('http.fetch', ($, e) => {
    seen.fetches.push(e.url)
    if (!w.ollama) return { deny: 'ECONNREFUSED' }
    const r = w.ollama(e.url, String(e.init?.body ?? ''))
    return { value: { status: r.status, ok: r.status < 400, headers: {}, text: r.text } }
  })
  on('prompt.submit', ($, e) => {
    seen.prompts.push({ text: e.text, context: e.context })
    return { text: e.text }
  })
  on('tool.call', { tool: 'Read' }, () => {
    seen.reads += 1
    return { result: { type: 'text', file: { filePath: '', content: 'x', numLines: 1, startLine: 1, totalLines: 1 } } }
  })
  return { clock, seen }
}

describe('prompt router', () => {
  test('a dictionary shortcut expands before the prompt goes on', async ($, on) => {
    const { seen } = world(on, { store: { dictionary: { dp: 'staging pe deploy karo' } } })
    await submit($, 'dp')
    await submit($, 'pehle #dp phir batao')
    expect(seen.prompts.map(p => p.text)).toEqual(['staging pe deploy karo', 'pehle staging pe deploy karo phir batao'])
  })

  test('a cached answer is served locally, spelling variants included', async ($, on) => {
    const key = cacheKey(CWD, 'auth kaise kaam karta hai')
    const { seen } = world(on, { store: { answers: { [key]: { answer: 'JWT se.', at: 999_000 } } } })
    const res = await submit($, 'Auth kaise kaam karta ha?')
    expect(res.drop).toContain('JWT se.')
    expect(res.drop).toContain('0 tokens')
    expect(seen.prompts.length).toBe(0)
  })

  test('a leading ! skips the cache and reaches Claude without the !', async ($, on) => {
    const key = cacheKey(CWD, 'auth kaise kaam karta hai')
    const { seen } = world(on, { store: { answers: { [key]: { answer: 'JWT se.', at: 999_000 } } } })
    const res = await submit($, '!auth kaise kaam karta hai')
    expect(res.drop).toBeUndefined()
    expect(seen.prompts[0]?.text).toBe('auth kaise kaam karta hai')
  })

  test('an expired cached answer is not served', async ($, on) => {
    const key = cacheKey(CWD, 'auth kaise kaam karta hai')
    const { seen } = world(on, { store: { answers: { [key]: { answer: 'old', at: 1_000_000 - 4 * 24 * 3600 * 1000 } } } })
    const res = await submit($, 'auth kaise kaam karta hai')
    expect(res.drop).toBeUndefined()
    expect(seen.prompts.length).toBe(1)
  })

  test('the task guide rides along as hidden context', async ($, on) => {
    const { seen } = world(on)
    await submit($, 'login pe error aa raha hai theek karo')
    expect(seen.prompts[0]?.text).toBe('login pe error aa raha hai theek karo')
    expect(seen.prompts[0]?.context?.join(' ')).toContain('task: fix')
  })

  test('autoIntent off sends no guide', { options: { autoIntent: false } }, async ($, on) => {
    const { seen } = world(on)
    await submit($, 'login pe error aa raha hai theek karo')
    expect(seen.prompts[0]?.context ?? []).toEqual([])
  })
})

describe('local model', () => {
  const ollama = ollamaServer(['qwen2.5:1.5b'])

  test('off by default: a ~ prompt never leaves for Ollama', async ($, on) => {
    const { seen } = world(on, { ollama })
    await submit($, '~docker kya hai')
    expect(seen.fetches.length).toBe(0)
    expect(seen.prompts.length).toBe(1)
  })

  test('/local on with Ollama ready switches on, and a ~ prompt is answered locally', async ($, on) => {
    const { seen } = world(on, { ollama })
    const res = await run($, 'local', 'on')
    expect(res.text).toContain('Local model is on')
    const answer = await submit($, '~docker kya hai')
    expect(answer.drop).toContain('Docker ek container tool hai.')
    expect(seen.fetches).toContain('http://localhost:11434/api/chat')
    expect(seen.prompts.length).toBe(0)
  })

  test('auto: a general question goes local, a project question stays on Claude', async ($, on) => {
    const { seen } = world(on, { ollama })
    await run($, 'local', 'auto')
    const general = await submit($, 'docker kya hai?')
    expect(general.drop).toContain('Docker')
    await submit($, 'ye function kya karta hai?')
    expect(seen.prompts.map(p => p.text)).toEqual(['ye function kya karta hai?'])
  })

  test('a local model error falls back to Claude with the ~ removed', async ($, on) => {
    const { seen } = world(on, { ollama: ollamaServer(['qwen2.5:1.5b'], '', 500) })
    await run($, 'local', 'on')
    const res = await submit($, '~docker kya hai')
    expect(res.drop).toBeUndefined()
    expect(seen.prompts[0]?.text).toBe('docker kya hai')
  })

  test('/local on with no Ollama asks first, and installs nothing on a no', async ($, on) => {
    const { seen } = world(on, { answer: 'Not now' })
    const res = await run($, 'local', 'on')
    expect(seen.asked).toBe(1)
    expect(res.text).toContain('nothing was installed')
    expect(seen.commands.some(c => c.includes('install'))).toBe(false)
    await submit($, '~docker kya hai')
    expect(seen.fetches.filter(u => u.endsWith('/api/chat')).length).toBe(0)
  })

  test('/local on with no Ollama starts the setup on a yes', async ($, on) => {
    const { seen } = world(on, { answer: 'Yes, set it all up', host: argv => (argv[0] === 'uname' ? { exitCode: 0, stdout: 'Darwin' } : undefined) })
    const res = await run($, 'local', 'on')
    expect(res.text).toContain('setup started')
  })

  test('Ollama installed but stopped: no question is asked', async ($, on) => {
    const { seen } = world(on, {
      answer: 'No',
      host: argv => (argv[0] === 'uname' ? { exitCode: 0, stdout: 'Darwin' } : argv[1] === '--version' && argv[0] === '/usr/local/bin/ollama' ? { exitCode: 0, stdout: 'ollama 0.12' } : undefined),
    })
    const res = await run($, 'local', 'on')
    expect(seen.asked).toBe(0)
    expect(res.text).toContain('setup started')
  })

  test('/local without Ollama explains that /local on does everything', async ($, on) => {
    world(on)
    const res = await run($, 'local', '')
    expect(res.text).toContain('Ollama is not running')
    expect(res.text).toContain('/local on')
  })
})

describe('read guard', () => {
  test('a huge whole-file read is refused once, then allowed', async ($, on) => {
    const { seen } = world(on, { files: { '/work/app/big.json': { size: 500 * 1024, mtimeMs: 1 } } })
    const first = await $.tool.call({ tool: 'Read', file_path: '/work/app/big.json' })
    expect(first.deny).toContain('KB')
    const second = await $.tool.call({ tool: 'Read', file_path: '/work/app/big.json' })
    expect(second.deny).toBeUndefined()
    expect(seen.reads).toBe(1)
  })

  test('a ranged read of a huge file goes straight through', async ($, on) => {
    const { seen } = world(on, { files: { '/work/app/big.json': { size: 500 * 1024, mtimeMs: 1 } } })
    await $.tool.call({ tool: 'Read', file_path: '/work/app/big.json', offset: 10, limit: 40 })
    expect(seen.reads).toBe(1)
  })

  test('re-reading an unchanged file is refused; a changed one is read', async ($, on) => {
    const files = { '/work/app/a.ts': { size: 100, mtimeMs: 1 } }
    const { seen } = world(on, { files })
    await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
    const again = await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
    expect(again.deny).toContain('already read')
    files['/work/app/a.ts'] = { size: 120, mtimeMs: 2 }
    await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
    expect(seen.reads).toBe(2)
  })

  test('dedupeReads off reads every time', { options: { dedupeReads: false } }, async ($, on) => {
    const { seen } = world(on, { files: { '/work/app/a.ts': { size: 100, mtimeMs: 1 } } })
    await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
    await $.tool.call({ tool: 'Read', file_path: '/work/app/a.ts' })
    expect(seen.reads).toBe(2)
  })
})

describe('switches and dictionary commands', () => {
  test('/quota-saver off makes every hook pass through, /quota-saver on brings it back', async ($, on) => {
    const { seen } = world(on, {
      store: { dictionary: { dp: 'deploy karo' } },
      files: { '/work/app/big.json': { size: 500 * 1024, mtimeMs: 1 } },
    })
    await run($, 'quota-saver', 'off')
    await submit($, 'dp')
    await $.tool.call({ tool: 'Read', file_path: '/work/app/big.json' })
    expect(seen.prompts[0]?.text).toBe('dp')
    expect(seen.reads).toBe(1)

    await run($, 'quota-saver', 'on')
    await submit($, 'dp')
    expect(seen.prompts[1]?.text).toBe('deploy karo')
  })

  test('/shortcut saves, lists and /forget forgets', async ($, on) => {
    const { seen } = world(on)
    const saved = await run($, 'shortcut', 'tc = tests chalao aur failures batao')
    expect(saved.text).toContain('Saved:')
    const list = await run($, 'shortcut', '')
    expect(list.text).toContain('tc = tests chalao aur failures batao')
    await submit($, 'tc')
    expect(seen.prompts[0]?.text).toBe('tests chalao aur failures batao')

    await run($, 'forget', 'tc')
    await submit($, 'tc')
    expect(seen.prompts[1]?.text).toBe('tc')
  })

  test('/shortcut refuses a malformed entry', async ($, on) => {
    world(on)
    const res = await run($, 'shortcut', 'no equals sign')
    expect(res.text).toContain('Format')
  })

  test('/quota-saver shows the report', async ($, on) => {
    world(on)
    const res = await run($, 'quota-saver', '')
    expect(res.text).toContain('Quota Saver: token savings')
    expect(res.text).toContain('Context: 25%')
  })

  test('/last-task with nothing saved says so', async ($, on) => {
    world(on)
    const res = await run($, 'last-task', '')
    expect(res.text).toContain('No saved summary')
  })
})

const LONG_LOG = Array.from({ length: 3000 }, (_, i) => (i === 1500 ? 'FAIL src/auth.test.ts: expected 200' : `PASS case ${i}`)).join('\n')

function toolResultRow(tool: string, text: string) {
  return {
    message: { type: 'user' as const, role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'tu1', content: text }] },
    door: 'tool-result' as const,
    origin: { kind: 'tool' as const, tool },
    uuid: 'row-1',
  }
}

describe('output diet', () => {
  test('a long Bash log is cut to head, tail and the failure line', async ($, on) => {
    world(on)
    const rows = mock.session(on)
    await $.session.append(toolResultRow('Bash', LONG_LOG))
    const stored = JSON.stringify(rows.appended())
    expect(stored).toContain('FAIL src/auth.test.ts: expected 200')
    expect(stored).toContain('PASS case 0')
    expect(stored).toContain('PASS case 2999')
    expect(stored).not.toContain('PASS case 1400')
    expect(stored.length).toBeLessThan(LONG_LOG.length / 3)
  })

  test('a Read result is never cut (Claude edits from it)', async ($, on) => {
    world(on)
    const rows = mock.session(on)
    await $.session.append(toolResultRow('Read', LONG_LOG))
    expect(JSON.stringify(rows.appended())).toContain('PASS case 1400')
  })

  test('maxOutputChars is honoured', { options: { maxOutputChars: 200000 } }, async ($, on) => {
    world(on)
    const rows = mock.session(on)
    await $.session.append(toolResultRow('Bash', LONG_LOG))
    expect(JSON.stringify(rows.appended())).toContain('PASS case 1400')
  })
})

function turnEnd(answer: string) {
  return { answer, durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' as const }
}

describe('answer cache', () => {
  test('a read-only answer is kept and served for the same question', async ($, on) => {
    const { seen } = world(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'auth kaise kaam karta hai')
    await $.turn.complete(turnEnd('JWT tokens se.'))
    const res = await submit($, 'Auth kaise kaam karta ha?')
    expect(res.drop).toContain('JWT tokens se.')
    expect(seen.prompts.length).toBe(1)
  })

  test('a turn that edited files is not kept', async ($, on) => {
    const { seen } = world(on)
    on('turn.complete', () => ({ text: '' }))
    on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }))
    await submit($, 'auth theek karo')
    await $.tool.call({ tool: 'Edit', file_path: '/work/app/a.ts', old_string: 'a', new_string: 'b' })
    await $.turn.complete(turnEnd('Theek kar diya.'))
    const res = await submit($, 'auth theek karo')
    expect(res.drop).toBeUndefined()
    expect(seen.prompts.length).toBe(2)
  })

  test('localCache off keeps nothing', { options: { localCache: false } }, async ($, on) => {
    const { seen } = world(on)
    on('turn.complete', () => ({ text: '' }))
    await submit($, 'auth kaise kaam karta hai')
    await $.turn.complete(turnEnd('JWT tokens se.'))
    await submit($, 'auth kaise kaam karta hai')
    expect(seen.prompts.length).toBe(2)
  })
})

describe('rules and handoff', () => {
  const compose = { model: 'claude-sonnet-5-5', promptModel: 'claude-sonnet-5-5', surfaces: [], tools: [], outputStyle: null, traits: [] }

  test('the lean rules are appended to the system prompt, and dropped when off', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'engine', scope: 'shared' as const }] }))
    const onRes = await $.prompt.compose(compose)
    expect(onRes.sections.map(s => s.id)).toEqual(['intro', 'quota-saver:rules'])
    await run($, 'quota-saver', 'off')
    const offRes = await $.prompt.compose(compose)
    expect(offRes.sections.map(s => s.id)).toEqual(['intro'])
  })

  test('/new-task summarises, clears, and the note rides into the next context', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [] }))
    on('session.messages', () => ({ value: [{ role: 'user', text: 'login bana rahe hain', toolUses: [] }] }))
    on('model.complete', () => ({
      value: { isAnswered: true, text: 'GOAL: login page\nNEXT: tests', usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
    }))
    on('command.run', { command: 'clear' }, () => ({ text: '' }))
    on('session.end', () => ({ sessionId: 's2' }))

    const res = await run($, 'new-task', '')
    expect(res.text).toContain('GOAL: login page')
    // what the engine does on /clear
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    const composed = await $.prompt.compose(compose)
    const handoff = composed.sections.find(s => s.id === 'quota-saver:handoff')
    expect(handoff?.text).toContain('NEXT: tests')

    const back = await run($, 'last-task', '')
    expect(back.text).toContain('GOAL: login page')
  })
})

describe('activity', () => {
  test('nothing is recorded until /activity on', async ($, on) => {
    world(on, { store: { dictionary: { dp: 'deploy to staging' } } })
    await submit($, 'dp')
    const list = await run($, 'activity', 'text')
    expect(list.text).toContain('Nothing recorded yet')
    expect(list.text).toContain('/activity on')
  })

  test('/activity on records each step of a prompt, /activity off stops', async ($, on) => {
    world(on, { store: { dictionary: { dp: 'deploy to staging and fix the error' } } })
    const res = await run($, 'activity', 'on')
    expect(res.text).toContain('Activity recording is on')
    // no terminal can open in the test world: the fallback command is given
    expect(res.text).toContain('tail -f /home/u/.quota-saver-activity.log')

    await submit($, 'dp')
    const list = await run($, 'activity', 'text')
    expect(list.text).toContain('"dp"')
    expect(list.text).toContain('shortcut expanded locally')
    expect(list.text).toContain('added a hidden "fix" guide')
    expect(list.text).toContain('sent to Claude')

    await run($, 'activity', 'off')
    await submit($, 'second prompt')
    const after = await run($, 'activity', 'text')
    expect(after.text).not.toContain('second prompt')
  })

  test('a blocked read and a cache hit show up as savings', async ($, on) => {
    const key = cacheKey(CWD, 'auth kaise kaam karta hai')
    world(on, {
      store: { answers: { [key]: { answer: 'JWT se.', at: 999_000 } } },
      files: { '/work/app/big.json': { size: 500 * 1024, mtimeMs: 1 } },
    })
    await run($, 'activity', 'on')
    await submit($, 'auth kaise kaam karta hai')
    await $.tool.call({ tool: 'Read', file_path: '/work/app/big.json' })
    const list = await run($, 'activity', 'text')
    expect(list.text).toContain('answered from the local cache')
    expect(list.text).toContain('whole read of big.json stopped')
  })
})

describe('junk guard', () => {
  test('a dependency file is refused once with the reason, then allowed', async ($, on) => {
    const { seen } = world(on, { files: { '/work/app/node_modules/react/index.js': { size: 40_000, mtimeMs: 1 } } })
    const first = await $.tool.call({ tool: 'Read', file_path: '/work/app/node_modules/react/index.js' })
    expect(first.deny).toContain('dependency or build folder')
    await $.tool.call({ tool: 'Read', file_path: '/work/app/node_modules/react/index.js' })
    expect(seen.reads).toBe(1)
  })

  test('lock files and minified bundles are refused; small ones and line ranges pass', async ($, on) => {
    const { seen } = world(on, {
      files: {
        '/work/app/package-lock.json': { size: 900_000, mtimeMs: 1 },
        '/work/app/public/app.min.js': { size: 60_000, mtimeMs: 1 },
        '/work/app/dist/tiny.js': { size: 500, mtimeMs: 1 },
      },
    })
    expect((await $.tool.call({ tool: 'Read', file_path: '/work/app/package-lock.json' })).deny).toContain('lock file')
    expect((await $.tool.call({ tool: 'Read', file_path: '/work/app/public/app.min.js' })).deny).toContain('minified')
    await $.tool.call({ tool: 'Read', file_path: '/work/app/dist/tiny.js' })
    await $.tool.call({ tool: 'Read', file_path: '/work/app/public/app.min.js', offset: 1, limit: 20 })
    expect(seen.reads).toBe(2)
  })

  test('guardJunk off lets them through', { options: { guardJunk: false } }, async ($, on) => {
    const { seen } = world(on, { files: { '/work/app/node_modules/react/index.js': { size: 40_000, mtimeMs: 1 } } })
    await $.tool.call({ tool: 'Read', file_path: '/work/app/node_modules/react/index.js' })
    expect(seen.reads).toBe(1)
  })
})

const BREAKDOWN = {
  categories: [],
  totalTokens: 60_000,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'model',
  percentage: 30,
  gridRows: [],
  model: 'claude-sonnet-5-5',
  memoryFiles: [{ path: '/work/app/CLAUDE.md', type: 'Project', tokens: 6_200 }],
  mcpTools: [
    { name: 'mcp__github__a', serverName: 'github', tokens: 2_500, isLoaded: true },
    { name: 'mcp__github__b', serverName: 'github', tokens: 2_000, isLoaded: true },
    { name: 'mcp__jira__x', serverName: 'jira', tokens: 9_000, isLoaded: false },
  ],
  agents: [],
  isAutoCompactEnabled: true,
  apiUsage: null,
}

describe('audit and reports', () => {
  test('/quota-saver audit names the heavy MCP server and CLAUDE.md, ignoring unloaded tools', async ($, on) => {
    world(on, { usage: { breakdown: BREAKDOWN } })
    const res = await run($, 'quota-saver', 'audit')
    expect(res.text).toContain('MCP server "github" adds 4.5k tokens')
    expect(res.text).not.toContain('jira')
    expect(res.text).toContain('CLAUDE.md is 6.2k tokens')
    expect(res.text).toContain('Total fixed cost')
  })

  test('/quota-saver week shows what was saved today', async ($, on) => {
    world(on)
    await $.session.append(toolResultRow('Bash', LONG_LOG))
    const res = await run($, 'quota-saver', 'week')
    expect(res.text).toContain('last 7 days')
    expect(res.text).toMatch(/1970-01-01\s+\d/)
    expect(res.text).toContain('1 trims')
  })
})

describe('alarms', () => {
  const usage = (model: string, cached: number) => ({ input_tokens: 500, output_tokens: 100, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, model })

  test('a model switch on a big context is called out', async ($, on) => {
    world(on)
    on('turn.complete', () => ({ text: '' }))
    await run($, 'activity', 'on')
    await $.turn.complete({ ...turnEnd('a'), usage: usage('claude-opus-5-5', 40_000) })
    await $.turn.complete({ ...turnEnd('b'), usage: usage('claude-haiku-5-5', 0) })
    const list = await run($, 'activity', 'text')
    expect(list.text).toContain('model changed claude-opus-5-5 → claude-haiku-5-5')
    expect(list.text).toContain('turn done')
  })

  test('the same model never warns', async ($, on) => {
    world(on)
    on('turn.complete', () => ({ text: '' }))
    await run($, 'activity', 'on')
    await $.turn.complete({ ...turnEnd('a'), usage: usage('claude-opus-5-5', 40_000) })
    await $.turn.complete({ ...turnEnd('b'), usage: usage('claude-opus-5-5', 41_000) })
    expect((await run($, 'activity', 'text')).text).not.toContain('model changed')
  })

  test('quota at 85% raises one alarm per window', async ($, on) => {
    world(on, { usage: { rateLimits: [{ kind: 'five_hour', percentUsed: 85, resetsAt: '2026-10-21T12:00:00Z' }] } })
    on('turn.complete', () => ({ text: '' }))
    await run($, 'activity', 'on')
    await $.turn.complete(turnEnd('a'))
    await $.turn.complete(turnEnd('b'))
    const text = (await run($, 'activity', 'text')).text ?? ''
    expect(text.split('5-hour quota 85% used').length - 1).toBe(1)
  })
})

describe('model choice', () => {
  test('an old saved default does not trigger a new download when a good model is installed', async ($, on) => {
    const { seen } = world(on, {
      ollama: ollamaServer(['qwen2.5:1.5b']),
      store: { settings: { isEnabled: true, local: 'off', localModel: 'qwen2.5:3b', isOnboarded: true } },
    })
    const res = await run($, 'local', 'on')
    expect(res.text).toContain('Local model is on (qwen2.5:1.5b)')
    expect(seen.commands.some(c => c.includes('pull'))).toBe(false)
  })

  test('a model picked by hand is kept, even when another is installed', async ($, on) => {
    world(on, { ollama: ollamaServer(['qwen2.5:1.5b', 'llama3.2:3b']) })
    await run($, 'local', 'model llama3.2:3b')
    const res = await run($, 'local', 'on')
    expect(res.text).toContain('Local model is on (llama3.2:3b)')
  })
})

describe('used vs without the plugin', () => {
  const usage = { input_tokens: 1_000, output_tokens: 500, cache_read_input_tokens: 40_000, cache_creation_input_tokens: 0, model: 'claude-sonnet-5-5' }

  test('a shortened output is counted once per request of the turn', async ($, on) => {
    world(on)
    on('turn.complete', () => ({ text: '' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: {} as never }))
    await run($, 'activity', 'on')
    await submit($, 'tests chalao')
    await $.tool.call({ tool: 'Bash', command: 'npm test' })
    await $.session.append(toolResultRow('Bash', LONG_LOG))
    await $.tool.call({ tool: 'Bash', command: 'npm test -- auth' })
    await $.turn.complete({ ...turnEnd('done'), usage })
    const text = (await run($, 'activity', 'text')).text ?? ''
    expect(text).toMatch(/used 41\.5k tokens · without Quota Saver ≈ [\d.]+k · saved ≈ [\d.]+k \(\d+%\) over 3 requests/)
    const report = (await run($, 'quota-saver', '')).text ?? ''
    expect(report).toContain('Tokens, this session: Claude used 41.5k tokens · without Quota Saver ≈')
  })

  test('a refused read that is retried counts as nothing saved', async ($, on) => {
    world(on, { files: { '/work/app/big.json': { size: 500 * 1024, mtimeMs: 1 } } })
    on('turn.complete', () => ({ text: '' }))
    await run($, 'activity', 'on')
    await submit($, 'big json dekho')
    await $.tool.call({ tool: 'Read', file_path: '/work/app/big.json' })
    await $.tool.call({ tool: 'Read', file_path: '/work/app/big.json' })
    await $.turn.complete({ ...turnEnd('done'), usage })
    expect((await run($, 'activity', 'text')).text).toContain('without Quota Saver ≈ 41.5k · saved ≈ 0 (0%)')
  })

  test('a free answer shows 0 used against one request over the context', async ($, on) => {
    const key = cacheKey(CWD, 'auth kaise kaam karta hai')
    world(on, { store: { answers: { [key]: { answer: 'JWT se.', at: 999_000 } } } })
    await run($, 'activity', 'on')
    await submit($, 'auth kaise kaam karta hai')
    expect((await run($, 'activity', 'text')).text).toContain('used 0 tokens · without Quota Saver ≈ 50.4k')
  })
})

describe('editor blocks around the prompt', () => {
  const WRAP = '<browser_instruction># Claude in Chrome\nYou have access to browser tools. '.padEnd(4000, 'x') + '</browser_instruction>'

  test('only the typed words are judged and shown; Claude still gets the whole prompt', async ($, on) => {
    const { seen } = world(on)
    await run($, 'activity', 'on')
    const full = `${WRAP}\nmain aik android game banana chahta hun ideas do`
    await submit($, full)
    expect(seen.prompts[0]?.text).toBe(full)
    expect(seen.prompts[0]?.context?.join(' ')).toContain('task: build')
    const text = (await run($, 'activity', 'text')).text ?? ''
    expect(text).toContain('"main aik android game banana chahta hun ideas do" · Roman Urdu')
    expect(text).toContain('tokens of editor instructions around it')
    expect(text).not.toContain('browser_instruction')
  })

  test('a shortcut inside a wrapped prompt expands and keeps the wrapper', async ($, on) => {
    const { seen } = world(on, { store: { dictionary: { dp: 'deploy to staging' } } })
    await submit($, `${WRAP}\ndp`)
    expect(seen.prompts[0]?.text).toBe(`${WRAP}\ndeploy to staging`)
  })

  test('the cache keys on the typed words, so a new wrapper still hits', async ($, on) => {
    const key = cacheKey(CWD, 'auth kaise kaam karta hai')
    const { seen } = world(on, { store: { answers: { [key]: { answer: 'JWT se.', at: 999_000 } } } })
    const res = await submit($, `${WRAP}\nauth kaise kaam karta hai`)
    expect(res.drop).toContain('JWT se.')
    expect(seen.prompts.length).toBe(0)
  })
})

describe('menu commands', () => {
  test('the file command runs the plugin command, with its arguments, and no model call', async ($, on) => {
    const { seen } = world(on)
    const saved = await run($, 'quota-saver:shortcut', 'tc = run the tests')
    expect(saved.text).toContain('Saved:')
    const report = await run($, 'quota-saver:status', '')
    expect(report.text).toContain('Quota Saver: token savings')
    expect(seen.prompts.length).toBe(0)
  })
})

describe('local team', () => {
  /** An Ollama whose answer depends on the model asked. */
  const team = (answers: Record<string, string | number>, seenBodies: string[] = []) => (url: string, body: string) => {
    if (url.endsWith('/api/tags')) return { status: 200, text: JSON.stringify({ models: Object.keys(answers).map(name => ({ name, size: 1e9 })) }) }
    seenBodies.push(body)
    const model = (JSON.parse(body) as { model: string }).model
    const a = answers[model]
    return typeof a === 'number' ? { status: a, text: '' } : { status: 200, text: JSON.stringify({ message: { content: a ?? '' } }) }
  }
  const settings = (fast: string | undefined, strong: string) => ({
    settings: { isEnabled: true, local: 'on', localModel: strong, fastModel: fast, isModelChosen: true, isOnboarded: true },
  })

  test('a wrong-script answer from the fast model goes to the strong one', async ($, on) => {
    const { seen } = world(on, {
      ollama: team({ 'qwen3:1.7b': 'Docker یک پروژه است که سیستم را ساده می‌کند', 'qwen3:4b': 'Docker aik tool hai jo apps ko containers mein chalata hai.' }),
      store: settings('qwen3:1.7b', 'qwen3:4b'),
    })
    await run($, 'local', 'on')
    await run($, 'activity', 'on')
    const res = await submit($, '~docker kya hai')
    expect(res.drop).toContain('[quota-saver: local model qwen3:4b')
    expect(res.drop).toContain('Docker aik tool hai')
    expect(seen.prompts.length).toBe(0)
    expect((await run($, 'activity', 'text')).text).toContain('qwen3:1.7b answered in')
  })

  test('when both models fail, the question goes to Claude', async ($, on) => {
    const { seen } = world(on, { ollama: team({ 'qwen3:1.7b': 'ok', 'qwen3:4b': 500 }), store: settings('qwen3:1.7b', 'qwen3:4b') })
    await run($, 'local', 'on')
    const res = await submit($, '~docker kya hai')
    expect(res.drop).toBeUndefined()
    expect(seen.prompts[0]?.text).toBe('docker kya hai')
  })

  test('reasoning is switched off, and a model that refuses the switch is asked again without it', async ($, on) => {
    const bodies: string[] = []
    let calls = 0
    world(on, {
      ollama: (url, body) => {
        if (url.endsWith('/api/tags')) return { status: 200, text: JSON.stringify({ models: [{ name: 'gemma3:4b', size: 3e9 }] }) }
        bodies.push(body)
        calls += 1
        if (calls === 1) return { status: 400, text: '{"error":"gemma3:4b does not support thinking"}' }
        return { status: 200, text: JSON.stringify({ message: { content: 'An API lets programs talk to each other.' } }) }
      },
      store: settings(undefined, 'gemma3:4b'),
    })
    await run($, 'local', 'on')
    const res = await submit($, '~what is an api?')
    expect(res.drop).toContain('An API lets programs talk')
    expect(JSON.parse(bodies[0] ?? '{}').think).toBe(false)
    expect(JSON.parse(bodies[1] ?? '{}').think).toBeUndefined()
  })

  test('/local pick measures each model and sets the team', async ($, on) => {
    world(on, {
      ollama: team({
        'qwen3:1.7b': 'An API is a way for programs to talk. Docker aik tool hai jo apps chalata hai, merge aur rebase mein farq hai.',
        'qwen3:4b': 'An API is a contract between programs. Docker aik tool hai jo containers mein apps chalata hai.',
        'bad:1b': 'Docker یک پروژه است',
      }),
    })
    const res = await run($, 'local', 'pick')
    expect(res.text).toContain('Local models on this machine')
    expect(res.text).toMatch(/Team: strong = qwen3:/)
    expect(res.text).toContain('bad:1b')
  })
})

describe('model advisor', () => {
  const compose = (model: string) => ({ model, promptModel: model, surfaces: [], tools: [], outputStyle: null, traits: [] })

  test('on Opus, a plain question gets one Haiku suggestion per context', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [] }))
    await run($, 'activity', 'on')
    await $.prompt.compose(compose('claude-opus-5-5'))
    await submit($, 'what is a closure in javascript?')
    await submit($, 'what is hoisting?')
    const text = (await run($, 'activity', 'text')).text ?? ''
    expect(text.split('model advisor').length - 1).toBe(1)
    expect(text).toContain('/model haiku')
  })

  test('on Sonnet, nothing is suggested', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [] }))
    await run($, 'activity', 'on')
    await $.prompt.compose(compose('claude-sonnet-5-5'))
    await submit($, 'what is a closure?')
    expect((await run($, 'activity', 'text')).text).not.toContain('model advisor')
  })

  test('building on Opus is left alone; tests suggest Sonnet', async ($, on) => {
    world(on)
    on('prompt.compose', () => ({ sections: [] }))
    await run($, 'activity', 'on')
    await $.prompt.compose(compose('claude-opus-5-5'))
    await submit($, 'add a search box to the users page')
    expect((await run($, 'activity', 'text')).text).not.toContain('model advisor')
    await submit($, 'run the tests')
    expect((await run($, 'activity', 'text')).text).toContain('/model sonnet')
  })
})

const JEST = [
  ...Array.from({ length: 400 }, (_, i) => `  ✓ renders case ${i} (3 ms)`),
  '  ✕ submits the form (12 ms)',
  '    Expected: 200',
  '    Received: 500',
  'Tests: 1 failed, 400 passed, 401 total',
].join('\n')

describe('smarter output diet', () => {
  const okHost = (argv: readonly string[]) => (argv[0] === 'mkdir' || argv[0] === 'find' ? { exitCode: 0 } : undefined)

  test('a test run keeps the failure and drops the passing tests; the original is kept on disk', async ($, on) => {
    const written: string[] = []
    world(on, { host: okHost })
    on('fs.write', ($$, e) => {
      written.push(e.path)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Bash' }, () => ({ result: {} as never }))
    const rows = mock.session(on)
    await $.tool.call({ tool: 'Bash', command: 'npx jest', tool_use_id: 'tu1' })
    await $.session.append(toolResultRow('Bash', JEST))
    const stored = JSON.stringify(rows.appended())
    expect(stored).toContain('submits the form')
    expect(stored).toContain('Received: 500')
    expect(stored).toContain('Tests: 1 failed')
    expect(stored).not.toContain('renders case 7 ')
    expect(stored).toContain('saved to /home/u/.quota-saver/raw/tu1.txt')
    expect(written).toEqual(['/home/u/.quota-saver/raw/tu1.txt'])
  })

  test('QS_RAW=1 leaves the output whole', async ($, on) => {
    world(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: {} as never }))
    const rows = mock.session(on)
    await $.tool.call({ tool: 'Bash', command: 'QS_RAW=1 npx jest', tool_use_id: 'tu1' })
    await $.session.append(toolResultRow('Bash', JEST))
    expect(JSON.stringify(rows.appended())).toContain('renders case 7 ')
  })

  test('when the original cannot be saved, the note says how to get it', async ($, on) => {
    world(on)
    const rows = mock.session(on)
    await $.session.append(toolResultRow('Bash', LONG_LOG))
    expect(JSON.stringify(rows.appended())).toContain('QS_RAW=1 in front for the full output')
  })

  test('an output that would shrink by under 30% is left alone', async ($, on) => {
    world(on)
    const rows = mock.session(on)
    const text = Array.from({ length: 60 }, (_, i) => `row ${i}: ${'x'.repeat(60)}`).join('\n')
    await $.session.append(toolResultRow('Bash', text))
    expect(JSON.stringify(rows.appended())).not.toContain('quota-saver:')
  })

  test('near the quota limit with the local model on, general questions go local by themselves', async ($, on) => {
    const { seen } = world(on, {
      ollama: ollamaServer(['qwen2.5:1.5b']),
      usage: { rateLimits: [{ kind: 'five_hour', percentUsed: 93 }] },
    })
    on('turn.complete', () => ({ text: '' }))
    await run($, 'local', 'on')
    await $.turn.complete(turnEnd('a'))
    const res = await submit($, 'docker kya hai?')
    expect(res.drop).toContain('Docker ek container tool hai.')
    expect(seen.prompts.length).toBe(0)
  })
})
