// U-sync phase 1, task 1: broadcasts that arrive inside one 150 ms window
// become ONE state update, and every existing `syncChannel.channel === X`
// page effect still sees its channel.
//
// Discriminating: on the pre-change code app/syncUpdates.ts does not exist
// (every import below fails), and AppContext still debounces per channel --
// one setSyncChannel per channel, i.e. ~17 app-wide renders per reconnect.
// The render test is the one that separates the right design from the
// plausible wrong one: a coalesced object exposing only its FIRST channel
// as `syncChannel.channel` passes the one-update test but fails this one,
// because a page waiting for 'customers' never sees it.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import React, { useContext, useEffect } from 'react'
import { installMinimalDom, createTestRoot } from './reactHookHarness.ts'
import {
  SyncContext,
  SyncProvider,
  createSyncCoalescer,
  legacyStepReducer,
  mergeSyncUpdates,
  syncHas,
  type SyncEntry,
  type SyncUpdate,
} from '../src/app/syncUpdates.ts'
import { dispatchSyncUpdates } from '../src/api/syncRuntime.ts'

let failed = 0
async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const httpSource = read('../src/api/http.ts')
const webApiSource = read('../src/web-api.ts')
const appContextSource = read('../src/AppContext.tsx')

// The real reconnect list, read from http.ts so this test follows it.
function reconnectChannels(): string[] {
  const block = /const RECONNECT_REFRESH_CHANNELS = \[([\s\S]*?)\n\]/.exec(httpSource)
  assert.ok(block, 'RECONNECT_REFRESH_CHANNELS not found in api/http.ts')
  const channels = [...block[1].matchAll(/^\s*'([^']+)',/gm)].map((match) => match[1])
  assert.ok(channels.length >= 15, `expected the ~17-channel reconnect list, got ${channels.length}`)
  return channels
}

type FakeClock = { now: number; timers: Array<{ at: number; fn: () => void; id: number }>; nextId: number }
function fakeCoalescer(onFlush: (update: SyncUpdate) => void, clock: FakeClock = { now: 1000, timers: [], nextId: 1 }) {
  const coalescer = createSyncCoalescer({
    windowMs: 150,
    onFlush,
    now: () => clock.now,
    setTimer: (fn, ms) => { const id = clock.nextId++; clock.timers.push({ at: clock.now + ms, fn, id }); return id },
    clearTimer: (id) => { clock.timers = clock.timers.filter((timer) => timer.id !== id) },
  })
  const advance = (ms: number) => {
    clock.now += ms
    const due = clock.timers.filter((timer) => timer.at <= clock.now)
    clock.timers = clock.timers.filter((timer) => timer.at > clock.now)
    due.forEach((timer) => timer.fn())
  }
  return { coalescer, advance, clock }
}
const entry = (channel: string, reason: string | null = null, source: string | null = null): SyncEntry => ({ channel, reason, source })

await runTest('a reconnect burst (every channel in one loop) becomes exactly one update carrying every channel', () => {
  const channels = reconnectChannels()
  const flushed: SyncUpdate[] = []
  const { coalescer, advance } = fakeCoalescer((update) => flushed.push(update))
  channels.forEach((channel) => coalescer.push(entry(channel)))
  advance(149)
  assert.equal(flushed.length, 0, 'nothing flushes before the window closes')
  advance(1)
  assert.equal(flushed.length, 1, 'one state update for the whole burst, not one per channel')
  assert.deepEqual([...flushed[0].channels], [...new Set(channels)])
  assert.equal(flushed[0].channel, channels[0], 'compat shim: `channel` is the first channel')
})

await runTest('the resume dispatch (dispatchSyncUpdates) is one synchronous loop, so it lands in one window', () => {
  const events: Array<{ channel: string; reason: string }> = []
  const previousWindow = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = {
    dispatchEvent: (event: CustomEvent) => { events.push(event.detail) ; return true },
  }
  try {
    const flushed: SyncUpdate[] = []
    const { coalescer, advance } = fakeCoalescer((update) => flushed.push(update))
    dispatchSyncUpdates(['sales', 'products', 'inventory', 'dashboard'], 'visibility-resume')
    events.forEach((detail) => coalescer.push(entry(detail.channel, detail.reason)))
    advance(150)
    assert.equal(flushed.length, 1)
    assert.deepEqual([...flushed[0].channels], ['sales', 'products', 'inventory', 'dashboard'])
  } finally {
    ;(globalThis as { window?: unknown }).window = previousWindow
  }
  // Both dispatchers must stay synchronous loops: a stagger (setTimeout per
  // channel) would split one burst across windows again.
  assert.match(webApiSource, /dispatchSyncUpdates\(FOREGROUND_RESUME_SYNC_UPDATE_CHANNELS, reason\)/)
  const reconnect = /function dispatchGlobalDataRefresh\([\s\S]*?\n\}/.exec(httpSource)?.[0] || ''
  assert.match(reconnect, /forEach\(\(channel\) => \{\s*window\.dispatchEvent\(new CustomEvent\('sync:update'/)
  assert.doesNotMatch(reconnect, /setTimeout/)
})

await runTest('the window is fixed from its first event; a later event opens a new window with a larger ts', () => {
  const flushed: SyncUpdate[] = []
  const { coalescer, advance } = fakeCoalescer((update) => flushed.push(update))
  coalescer.push(entry('sales'))
  advance(100)
  coalescer.push(entry('returns'))
  advance(50)
  assert.equal(flushed.length, 1, 'a second event does not re-arm (postpone) the window')
  assert.deepEqual([...flushed[0].channels], ['sales', 'returns'])
  coalescer.push(entry('sales'))
  advance(150)
  assert.equal(flushed.length, 2)
  assert.ok(flushed[1].ts > flushed[0].ts)
})

await runTest('ts is strictly increasing even when two windows flush in the same millisecond', () => {
  const flushed: SyncUpdate[] = []
  const { coalescer, clock } = fakeCoalescer((update) => flushed.push(update))
  for (let i = 0; i < 3; i += 1) {
    coalescer.push(entry('products'))
    const timers = clock.timers
    clock.timers = []
    timers.forEach((timer) => timer.fn())
  }
  assert.equal(flushed.length, 3)
  assert.ok(flushed[0].ts < flushed[1].ts && flushed[1].ts < flushed[2].ts)
})

await runTest('one channel twice in a window is one entry; a cache-refresh never masks a real change', () => {
  const flushed: SyncUpdate[] = []
  const { coalescer, advance } = fakeCoalescer((update) => flushed.push(update))
  coalescer.push(entry('products', null, null))
  coalescer.push(entry('sales', 'cache-refresh', 'sales:list'))
  coalescer.push(entry('products', 'cache-refresh', 'products:list'))
  coalescer.push(entry('sales', 'offline-sale-synced'))
  advance(150)
  assert.deepEqual(flushed[0].entries, [entry('products', null, null), entry('sales', 'offline-sale-synced', null)])
})

await runTest('dispose drops an unflushed window', () => {
  const flushed: SyncUpdate[] = []
  const { coalescer, advance } = fakeCoalescer((update) => flushed.push(update))
  coalescer.push(entry('products'))
  coalescer.dispose()
  advance(500)
  assert.equal(flushed.length, 0)
})

await runTest('syncHas reads every channel of a coalesced update and the one channel of a legacy value', () => {
  const flushed: SyncUpdate[] = []
  const { coalescer, advance } = fakeCoalescer((update) => flushed.push(update))
  coalescer.push(entry('settings'))
  coalescer.push(entry('customers'))
  advance(150)
  assert.equal(syncHas(flushed[0], 'customers'), true, 'a non-first channel is visible through syncHas')
  assert.equal(syncHas(flushed[0], 'suppliers'), false)
  const legacyValue = { channel: 'customers', ts: 1 }
  assert.equal(syncHas(legacyValue, 'customers'), true)
  assert.equal(syncHas(null, 'customers'), false)
  const merged = mergeSyncUpdates(flushed[0], { ...flushed[0], channels: new Set(['files']), entries: [entry('files')], channel: 'files', ts: flushed[0].ts + 5 })
  assert.deepEqual([...merged.channels], ['settings', 'customers', 'files'])
  assert.equal(merged.ts, flushed[0].ts + 5)
})

await runTest('the legacy stepper queues each window once (StrictMode re-runs effects) and never drops a queued window', () => {
  const update = (channels: string[], ts: number): SyncUpdate => ({
    channels: new Set(channels), entries: channels.map((c) => entry(c)), channel: channels[0], reason: null, source: null, ts,
  })
  let state = legacyStepReducer({ shown: null, queue: [], lastQueuedTs: 0 }, { type: 'enqueue', update: update(['a', 'b'], 10) })
  state = legacyStepReducer(state, { type: 'enqueue', update: update(['a', 'b'], 10) })
  assert.equal(state.queue.length, 2, 'a repeated enqueue of the same window is ignored')
  state = legacyStepReducer(state, { type: 'advance' })
  state = legacyStepReducer(state, { type: 'enqueue', update: update(['c'], 11) })
  const shown: string[] = [state.shown?.channel || '']
  while (state.queue.length) {
    state = legacyStepReducer(state, { type: 'advance' })
    shown.push(state.shown?.channel || '')
  }
  assert.deepEqual(shown, ['a', 'b', 'c'])
})

await runTest('render: one window reaches a legacy `syncChannel.channel === X` effect for EVERY channel, and the coalesced value changes once', async () => {
  installMinimalDom()
  const legacySeen: string[] = []
  const coalescedSeen: number[] = []
  // The exact shape of the 17 existing page effects (e.g. CustomersTab:749).
  function LegacyPage() {
    const sync = useContext(SyncContext)
    const channel = sync?.syncChannel?.channel || ''
    const ts = sync?.syncChannel?.ts || 0
    useEffect(() => { if (channel) legacySeen.push(channel) }, [channel, ts])
    const updateTs = sync?.syncUpdate?.ts || 0
    useEffect(() => { if (updateTs) coalescedSeen.push(updateTs) }, [updateTs])
    return null
  }
  const root = createTestRoot()
  const render = (syncUpdate: SyncUpdate | null) => root.render(
    React.createElement(SyncProvider, { syncUpdate, syncConnected: true, syncServerUnreachable: false }, React.createElement(LegacyPage)),
  )
  await render(null)
  const channels = reconnectChannels()
  const flushed: SyncUpdate[] = []
  const { coalescer, advance } = fakeCoalescer((update) => flushed.push(update))
  channels.forEach((channel) => coalescer.push(entry(channel)))
  advance(150)
  await render(flushed[0])
  assert.deepEqual(legacySeen, [...new Set(channels)], 'every channel of the burst reached the legacy page effect, in order')
  assert.equal(coalescedSeen.length, 1, 'the coalesced value changed exactly once for the whole burst')
  // A second window that lands later is not lost either.
  coalescer.push(entry('customers'))
  advance(150)
  await render(flushed[1])
  assert.equal(legacySeen.at(-1), 'customers')
  assert.equal(coalescedSeen.length, 2)
  await root.unmount()
})

await runTest('AppContext feeds one coalescer; the per-channel debounce map is gone', () => {
  assert.match(appContextSource, /createSyncCoalescer\(\{\s*windowMs: SYNC\.EVENT_DEBOUNCE_MS,/)
  assert.match(appContextSource, /syncCoalescer\.push\(\{ channel, reason: detail\.reason \|\| null, source: detail\.source \|\| null \}\)/)
  assert.match(appContextSource, /if \(update\.channels\.has\('settings'\)\) loadSettings\(\)/)
  assert.match(appContextSource, /syncCoalescer\.dispose\(\)/)
  assert.doesNotMatch(appContextSource, /debounceRef\.current\[channel\]/, 'the old per-channel debounce must be gone')
  assert.doesNotMatch(appContextSource, /setSyncChannel\(/, 'no per-channel state update may remain')
  assert.match(appContextSource, /<SyncProvider syncUpdate=\{syncUpdate\}/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('All syncCoalescing tests passed')
