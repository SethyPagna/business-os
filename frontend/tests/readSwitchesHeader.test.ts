import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SIGNAL_TTL_MS, __resetServerSignalsForTests, isServerSwitchOn, parseBudgetHeader, parseSwitchesHeader, recordServerSignals,
  serverBudget, serverBuild, serverDataEpoch, serverSwitchEpoch,
} from '../src/api/serverSignals.ts'

const headers = (values: Record<string, string>) => ({ get: (name: string) => values[name] ?? values[name.toLowerCase()] ?? null })
const T0 = 1_000_000

test('no header ever seen: every switch is off, exactly the client that never heard of switches', () => {
  __resetServerSignalsForTests()
  assert.equal(isServerSwitchOn('probe', T0), false)
  assert.equal(serverSwitchEpoch(T0), null)
  assert.equal(serverBudget(T0), null)
  recordServerSignals(headers({}), T0)
  assert.equal(isServerSwitchOn('probe', T0), false)
})

test('a switch is on only while a header that says so is fresh; a flip is honoured by the very next response', () => {
  __resetServerSignalsForTests()
  recordServerSignals(headers({ 'X-BOS-Switches': 'e=7;probe=1' }), T0)
  assert.equal(isServerSwitchOn('probe', T0 + 1), true)
  assert.equal(isServerSwitchOn('other', T0 + 1), false, 'an unnamed switch is off')
  recordServerSignals(headers({ 'X-BOS-Switches': 'e=8;probe=0' }), T0 + 2_000)
  assert.equal(isServerSwitchOn('probe', T0 + 2_001), false, 'turned off mid-session: the next request sees it')
  recordServerSignals(headers({ 'X-BOS-Switches': 'e=9;probe=1' }), T0 + 3_000)
  assert.equal(isServerSwitchOn('probe', T0 + 3_001), true)
})

test('a lagging isolate cannot turn a switch back on: a lower epoch is ignored while the newer state is fresh', () => {
  __resetServerSignalsForTests()
  recordServerSignals(headers({ 'X-BOS-Switches': 'e=8;probe=0' }), T0)
  recordServerSignals(headers({ 'X-BOS-Switches': 'e=7;probe=1' }), T0 + 1_000)
  assert.equal(isServerSwitchOn('probe', T0 + 1_001), false)
  assert.equal(serverSwitchEpoch(T0 + 1_001), 8)
  recordServerSignals(headers({ 'X-BOS-Switches': 'e=7;probe=1' }), T0 + SIGNAL_TTL_MS + 5_000)
  assert.equal(isServerSwitchOn('probe', T0 + SIGNAL_TTL_MS + 5_001), true, 'once the newer state is stale, whatever the server says now is believed')
})

test('a header that is not refreshed expires: silence means off', () => {
  __resetServerSignalsForTests()
  recordServerSignals(headers({ 'X-BOS-Switches': 'e=7;probe=1' }), T0)
  assert.equal(isServerSwitchOn('probe', T0 + SIGNAL_TTL_MS - 1), true)
  assert.equal(isServerSwitchOn('probe', T0 + SIGNAL_TTL_MS), false)
  assert.equal(serverSwitchEpoch(T0 + SIGNAL_TTL_MS), null)
})

test('a malformed header is off and does not disturb the last good one', () => {
  __resetServerSignalsForTests()
  for (const bad of ['', 'garbage', 'probe=1', 'e=x;probe=1', 'e=7;probe=2', 'e=7;probe=ON', 'e=7;PROBE=1', 'e=7;probe=1;', 'e=-1;probe=1', 'e=7;probe=1;;x', `e=7;${'a=1;'.repeat(200)}`, 'e=7.5;probe=1']) {
    __resetServerSignalsForTests()
    recordServerSignals(headers({ 'X-BOS-Switches': bad }), T0)
    assert.equal(isServerSwitchOn('probe', T0 + 1), false, JSON.stringify(bad))
  }
  __resetServerSignalsForTests()
  recordServerSignals(headers({ 'X-BOS-Switches': 'e=7;probe=1' }), T0)
  recordServerSignals(headers({ 'X-BOS-Switches': 'junk' }), T0 + 100)
  assert.equal(isServerSwitchOn('probe', T0 + 200), true)
  assert.deepEqual(parseSwitchesHeader('e=3;a=1;b=0'), { epoch: 3, on: new Set(['a']) })
  assert.equal(parseSwitchesHeader(null), null)
})

test('the budget header: zone, percent and reset are read; anything else is null', () => {
  __resetServerSignalsForTests()
  recordServerSignals(headers({ 'X-BOS-Budget': 'z=amber;p=72;r=2026-11-03T00:00:00Z' }), T0)
  assert.deepEqual(serverBudget(T0 + 1), { zone: 'amber', percent: 72, resetsAt: '2026-11-03T00:00:00Z' })
  assert.equal(serverBudget(T0 + SIGNAL_TTL_MS), null)
  assert.deepEqual(parseBudgetHeader('z=green'), { zone: 'green', percent: null, resetsAt: null })
  for (const bad of ['', 'z=purple', 'p=40', 'z=red;z=black', 'z=red;p=999;r=x', 'z=', 'amber']) {
    const parsed = parseBudgetHeader(bad)
    assert.ok(parsed === null || (parsed.percent === null && parsed.resetsAt === null), JSON.stringify(bad))
  }
  assert.equal(parseBudgetHeader('z=purple;p=1'), null)
})

test('the build and data-epoch headers are kept when well formed and ignored otherwise', () => {
  __resetServerSignalsForTests()
  recordServerSignals(headers({ 'X-BOS-Build': 'abc123.def', 'X-BOS-Epoch': '0a1b2c3d' }), T0)
  assert.equal(serverBuild(), 'abc123.def')
  assert.equal(serverDataEpoch(), '0a1b2c3d')
  recordServerSignals(headers({ 'X-BOS-Build': 'has space', 'X-BOS-Epoch': 'ZZZZZZZZ' }), T0 + 1)
  assert.equal(serverBuild(), 'abc123.def')
  assert.equal(serverDataEpoch(), '0a1b2c3d')
})

test('a response object without usable headers never throws', () => {
  __resetServerSignalsForTests()
  for (const value of [null, undefined, {}, { get: 3 }] as unknown[]) assert.doesNotThrow(() => recordServerSignals(value as never, T0))
})

// The reader is fed by the real transport: every /api response, ok or refused, and nothing else.
async function withPage(answers: Array<{ status?: number; headers?: Record<string, string> }>, run: (sent: string[]) => Promise<void>): Promise<void> {
  const { __resetApiHealthForTests, __resetApiWriteDedupeForTests, cacheClearAll, setSyncServerUrl } = await import('../src/api/http.ts')
  const originalWindow = (globalThis as { window?: unknown }).window
  const originalFetch = globalThis.fetch
  const values = new Map<string, string>()
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v) }, removeItem: (k: string) => { values.delete(k) }, clear: () => values.clear(), key: () => null, length: 0 } as unknown as Storage
  ;(globalThis as { window?: unknown }).window = Object.assign(new EventTarget(), {
    location: { origin: 'https://sync.example.test', hostname: 'sync.example.test' }, localStorage: storage, sessionStorage: storage,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  })
  const sent: string[] = []
  let at = 0
  globalThis.fetch = (async (url: string) => {
    sent.push(String(url).replace('https://sync.example.test', ''))
    const answer = answers[Math.min(at++, answers.length - 1)]
    return new Response(JSON.stringify({ ok: true }), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json', ...answer.headers } })
  }) as typeof fetch
  __resetApiWriteDedupeForTests(); __resetApiHealthForTests(); cacheClearAll(); __resetServerSignalsForTests(); setSyncServerUrl('https://sync.example.test')
  try { await run(sent) } finally {
    globalThis.fetch = originalFetch
    ;(globalThis as { window?: unknown }).window = originalWindow
    __resetApiHealthForTests(); cacheClearAll(); __resetServerSignalsForTests(); setSyncServerUrl('')
  }
}

test('the transport feeds the reader from /api responses: a flip is honoured by the next response, silence leaves everything off', async () => {
  const { apiFetch } = await import('../src/api/http.ts')
  await withPage([
    {},
    { headers: { 'X-BOS-Switches': 'e=3;probe=1', 'X-BOS-Build': 'abc123', 'X-BOS-Epoch': '0a1b2c3d' } },
    { headers: { 'X-BOS-Switches': 'e=4;probe=0' } },
    { status: 503, headers: { 'X-BOS-Switches': 'e=5;probe=1' } },
  ], async (sent) => {
    await apiFetch('GET', '/api/branches', undefined, 2000)
    assert.equal(isServerSwitchOn('probe'), false, 'no header yet: off, as a client that never heard of switches')
    assert.equal(serverSwitchEpoch(), null)
    await apiFetch('GET', '/api/units', undefined, 2000)
    assert.equal(isServerSwitchOn('probe'), true)
    assert.equal(serverBuild(), 'abc123')
    assert.equal(serverDataEpoch(), '0a1b2c3d')
    await apiFetch('GET', '/api/categories', undefined, 2000)
    assert.equal(isServerSwitchOn('probe'), false, 'turned off mid-session: the very next response says so')
    await apiFetch('GET', '/api/settings', undefined, 2000).catch(() => {})
    assert.equal(isServerSwitchOn('probe'), true, 'a refused request still carries the header')
    assert.deepEqual(sent, ['/api/branches', '/api/units', '/api/categories', '/api/settings'], 'reading the headers sends nothing extra')
  })
})

test('a response outside /api is not a source of switches', async () => {
  const { apiFetch } = await import('../src/api/http.ts')
  await withPage([{ headers: { 'X-BOS-Switches': 'e=9;probe=1' } }], async () => {
    await apiFetch('GET', '/health', undefined, 2000)
    assert.equal(isServerSwitchOn('probe'), false)
  })
})
