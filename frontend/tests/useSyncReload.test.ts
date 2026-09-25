// U-sync phase 1, task 2: useSyncReload(channels, handler, { isActive }).
//
// The bug it exists for (I7 audit #1): page effects keyed on
// [syncChannel, load] re-ran for the LAST broadcast whenever `load` changed
// identity -- on every search, filter or page change -- so one old event made
// every later search load twice. The "legacy pattern" test below reproduces
// that on the same fixture, so the fixture is shown to separate the two
// designs rather than passing both.
//
// Red on the old code: src/hooks/useSyncReload.ts does not exist there.
import assert from 'node:assert/strict'
import React, { StrictMode, useContext, useEffect } from 'react'
import { installMinimalDom, createTestRoot } from './reactHookHarness.ts'
import { SyncContext, FALLBACK_SYNC_CONTEXT, type SyncUpdate } from '../src/app/syncUpdates.ts'
import { useSyncReload } from '../src/hooks/useSyncReload.ts'

let failed = 0
async function runTest(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

installMinimalDom()

function update(channels: string[], ts: number): SyncUpdate {
  return {
    channels: new Set(channels),
    entries: channels.map((channel) => ({ channel, reason: null, source: null })),
    channel: channels[0],
    reason: null,
    source: null,
    ts,
  }
}

type PageProps = { channels: string[]; handler: (update: SyncUpdate) => void; isActive?: boolean }
function HookPage({ channels, handler, isActive = true }: PageProps) {
  useSyncReload(channels, handler, { isActive })
  return null
}

// The pre-hook page pattern (Products.tsx:2245, Sales.tsx:926, ...).
function LegacyPatternPage({ handler }: { handler: () => void }) {
  const sync = useContext(SyncContext)
  const syncChannel = sync?.syncUpdate
  useEffect(() => {
    if (syncChannel?.channel !== 'products') return
    handler()
  }, [handler, syncChannel?.channel, syncChannel?.ts])
  return null
}

function mount() {
  const root = createTestRoot()
  const render = (syncUpdate: SyncUpdate | null, child: React.ReactElement, strict = false) => {
    const tree = React.createElement(SyncContext.Provider, { value: { ...FALLBACK_SYNC_CONTEXT, syncUpdate } }, child)
    return root.render(strict ? React.createElement(StrictMode, null, tree) : tree)
  }
  return { render, unmount: root.unmount }
}

await runTest('a window carrying a watched channel calls the handler once, with the whole window', async () => {
  const calls: SyncUpdate[] = []
  const { render, unmount } = mount()
  const handler = (u: SyncUpdate) => { calls.push(u) }
  await render(null, React.createElement(HookPage, { channels: ['customers'], handler }))
  const burst = update(['settings', 'customers', 'products'], 100)
  await render(burst, React.createElement(HookPage, { channels: ['customers'], handler }))
  assert.equal(calls.length, 1, 'a non-first channel of the window still triggers the reload')
  assert.equal(calls[0], burst)
  await render(update(['suppliers'], 101), React.createElement(HookPage, { channels: ['customers'], handler }))
  assert.equal(calls.length, 1, 'an unwatched channel does nothing')
  await unmount()
})

await runTest('an old event plus a changed handler (and a fresh channels array) causes NO call', async () => {
  let calls = 0
  const { render, unmount } = mount()
  const event = update(['products'], 200)
  await render(null, React.createElement(HookPage, { channels: ['products'], handler: () => { calls += 1 } }))
  await render(event, React.createElement(HookPage, { channels: ['products'], handler: () => { calls += 1 } }))
  assert.equal(calls, 1)
  // A search/filter/page change: `load` gets a new identity, the event is the same.
  for (let i = 0; i < 3; i += 1) {
    await render(event, React.createElement(HookPage, { channels: ['products'], handler: () => { calls += 1 } }))
  }
  assert.equal(calls, 1, 'the old event must not re-fire when the handler identity changes')
  await unmount()
})

await runTest('positive control: the legacy [syncChannel, load] effect DOES re-fire on the same fixture', async () => {
  let calls = 0
  const { render, unmount } = mount()
  const event = update(['products'], 300)
  await render(event, React.createElement(LegacyPatternPage, { handler: () => { calls += 1 } }))
  await render(event, React.createElement(LegacyPatternPage, { handler: () => { calls += 1 } }))
  await render(event, React.createElement(LegacyPatternPage, { handler: () => { calls += 1 } }))
  assert.equal(calls, 3, 'the fixture reproduces the double-load the hook removes')
  await unmount()
})

await runTest('a window from before the page mounted is not replayed', async () => {
  let calls = 0
  const { render, unmount } = mount()
  await render(update(['products'], 400), React.createElement(HookPage, { channels: ['products'], handler: () => { calls += 1 } }))
  assert.equal(calls, 0)
  await unmount()
})

await runTest('windows that arrive while inactive are handled once, merged, when the page becomes active', async () => {
  const calls: SyncUpdate[] = []
  const { render, unmount } = mount()
  const handler = (u: SyncUpdate) => { calls.push(u) }
  const page = (isActive: boolean) => React.createElement(HookPage, { channels: ['products', 'customers'], handler, isActive })
  await render(null, page(false))
  await render(update(['products'], 500), page(false))
  await render(update(['files'], 501), page(false))
  await render(update(['customers'], 502), page(false))
  assert.equal(calls.length, 0, 'nothing runs while the page is hidden')
  await render(update(['customers'], 502), page(true))
  assert.equal(calls.length, 1, 'one reload on activation, not one per missed window')
  assert.deepEqual([...calls[0].channels].sort(), ['customers', 'products'], 'the earlier missed window is not lost to the later one')
  await render(update(['customers'], 502), page(false))
  await render(update(['customers'], 502), page(true))
  assert.equal(calls.length, 1, 'toggling active again does not replay a handled window')
  await unmount()
})

await runTest('StrictMode (double-run effects) still calls the handler exactly once', async () => {
  let calls = 0
  const { render, unmount } = mount()
  const handler = () => { calls += 1 }
  await render(null, React.createElement(HookPage, { channels: ['sales'], handler }), true)
  await render(update(['sales'], 600), React.createElement(HookPage, { channels: ['sales'], handler }), true)
  assert.equal(calls, 1)
  await unmount()
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('All useSyncReload tests passed')
