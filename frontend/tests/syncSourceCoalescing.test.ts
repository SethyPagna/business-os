// Lane 6.0.899: a coalesced sync publish must not lose a remote change because the till's own
// sale (source 'pos-checkout', which the POS skips) landed in the same window. Runs AppContext's
// real sync:update handler against a fake clock and records the source each publish carries.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import {
  beginPermissionRefresh,
  createPermissionRefreshAccumulator,
  escalatePermissionRefresh,
  finishPermissionRefresh,
  FOREGROUND_RESUME_REASON,
  notePermissionRefreshIntent,
  permissionSnapshotKey,
} from '../src/utils/permissionRefreshAccumulator.ts'
import { isOwnSettingsWrite } from '../src/utils/settingsSave.ts'
import * as syncRuntime from '../src/api/syncRuntime.ts'

let failed = 0
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed++; console.error(`FAIL ${name}`); console.error(error) }
}

function fakeClock() {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { at: number; fn: () => unknown }>()
  return {
    now: () => now,
    setTimeout: (fn: () => unknown, delayMs = 0) => { timers.set(++nextId, { at: now + delayMs, fn }); return nextId },
    clearTimeout: (id: number) => { timers.delete(id) },
    async advance(ms: number) {
      const end = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0]); now = due[1].at
        await due[1].fn()
      }
      now = end
    },
  }
}

const appContext = fs.readFileSync(new URL('../src/AppContext.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
function handler(clock: ReturnType<typeof fakeClock>) {
  const syncSection = appContext.indexOf('  // Sync event listeners')
  const start = appContext.indexOf('    let disposed = false', syncSection)
  const end = appContext.indexOf('    const onStatus = (e: Event) => {', start)
  assert.ok(start >= 0 && end > start, 'AppContext handler extraction boundaries changed')
  const code = ts.transpileModule(`${appContext.slice(start, end)}\nglobalThis.onUpdate = onUpdate;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const published: Array<{ channel: string; source: string | null }> = []
  const context: Record<string, unknown> = {
    ...syncRuntime,
    eventDetail: (event: { detail: unknown }) => event.detail,
    permissionRefreshRef: { current: createPermissionRefreshAccumulator() },
    permissionRefreshTimerRef: { current: null },
    schedulePermissionRefreshRef: { current: () => {} },
    beginPermissionRefresh, escalatePermissionRefresh, finishPermissionRefresh, FOREGROUND_RESUME_REASON,
    isOwnSettingsWrite, notePermissionRefreshIntent, permissionSnapshotKey,
    clearTimeout: clock.clearTimeout,
    window: { setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout },
    SYNC: { EVENT_DEBOUNCE_MS: 150 },
    user: { id: 'me', role_id: 'cashier' },
    loadSettings: async () => {},
    setSyncChannel: (value: { channel: string; source: string | null }) => { published.push({ channel: value.channel, source: value.source }) },
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  const onUpdate = (context as { onUpdate: (event: { detail: unknown }) => void }).onUpdate
  return { published, fire: (detail: Record<string, unknown>) => onUpdate({ detail }) }
}

const remote = (channel: string) => ({ channel, payload: { action: 'create', id: 1 } })
const till = (channel: string) => ({ channel, source: 'pos-checkout' })

// The POS rule (components/pos/POS.tsx): skip only a publish whose source is its own checkout.
const posSkips = (source: string | null) => source === 'pos-checkout'

await test('own sale then a remote push in the window publishes a source the POS does not skip', async () => {
  const clock = fakeClock()
  const h = handler(clock)
  h.fire(till('inventory'))
  await clock.advance(50)
  h.fire(remote('inventory'))
  await clock.advance(3_000)
  assert.equal(h.published.length, 1, JSON.stringify(h.published))
  assert.equal(posSkips(h.published[0].source), false, JSON.stringify(h.published))
})

await test('a remote push then own sale in the window publishes a source the POS does not skip', async () => {
  const clock = fakeClock()
  const h = handler(clock)
  h.fire(remote('sales'))
  await clock.advance(300)
  h.fire(till('sales'))
  await clock.advance(3_000)
  assert.equal(h.published.length, 1, JSON.stringify(h.published))
  assert.equal(posSkips(h.published[0].source), false, JSON.stringify(h.published))
})

await test('control: the till\'s own sale alone keeps its source, so the POS still skips its echo', async () => {
  const clock = fakeClock()
  const h = handler(clock)
  h.fire(till('inventory'))
  h.fire(till('inventory'))
  await clock.advance(3_000)
  assert.deepEqual(h.published, [{ channel: 'inventory', source: 'pos-checkout' }], 'repeated same-source events still collapse to one')
})

await test('control: a remote burst still collapses to one publish with no source', async () => {
  const clock = fakeClock()
  const h = handler(clock)
  for (let i = 0; i < 5; i++) { h.fire(remote('sales')); await clock.advance(250) }
  await clock.advance(2_000)
  assert.deepEqual(h.published, [{ channel: 'sales', source: null }])
})

await test('sources merge per channel: another channel\'s own sale does not taint the remote one', async () => {
  const clock = fakeClock()
  const h = handler(clock)
  h.fire(till('inventory'))
  h.fire(remote('sales'))
  await clock.advance(3_000)
  assert.deepEqual(h.published.map((p) => [p.channel, p.source]).sort(), [['inventory', 'pos-checkout'], ['sales', null]])
})

if (failed) {
  console.error(`${failed} sync source coalescing test(s) failed`)
  process.exit(1)
}
console.log('sync source coalescing: ok')
