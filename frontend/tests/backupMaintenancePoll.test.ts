// Lane 6.0.879 finding 15: the REAL Backup page's maintenance banner reads the state on arrival and
// polls every 15 s only while maintenance is on. With it off (the usual state) no poll runs; a write
// refused with 503 (how a restore started on another device shows up) re-reads it at once.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHarness } from './mountedComponentHarness.ts'

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const user = { id: 1, username: 'admin', role_code: 'admin', role_permissions: { all: true } }
const harness = await createHarness({ observe: ['api/systemJobs.ts', 'utils/visibilityPolling.ts'] })
let failed = 0

// The harness window ignores listeners; this test needs window events to arrive.
const events = new EventTarget()
const win = window as unknown as Record<string, unknown>
const originalListeners = { add: win.addEventListener, remove: win.removeEventListener, dispatch: win.dispatchEvent }
win.addEventListener = events.addEventListener.bind(events)
win.removeEventListener = events.removeEventListener.bind(events)
win.dispatchEvent = events.dispatchEvent.bind(events)

const running = { maintenance: null as Record<string, unknown> | null }
let reads = 0
const polls: Array<{ tick: () => void; stopped: boolean }> = []

try {
  const surface = await harness.mount({
    component: 'components/utils-settings/Backup.tsx', props: {},
    app: { page: 'settings', t: (key: string) => en[key] || '', notify: () => {}, hasPermission: () => true, user },
    doubles: {
      'api/systemJobs.ts': {
        getBackupMaintenance: async () => { reads++; return { maintenance: running.maintenance } },
      },
      'utils/visibilityPolling.ts': {
        startVisibleInterval: (tick: () => void, intervalMs: number) => {
          assert.equal(intervalMs, 15000, 'only the maintenance banner polls on this page')
          const poll = { tick, stopped: false }
          polls.push(poll)
          return () => { poll.stopped = true }
        },
      },
    },
  })
  try {
    const activePolls = () => polls.filter((poll) => !poll.stopped)
    assert.equal(reads, 1, 'read once on arrival')
    assert.equal(activePolls().length, 0, 'maintenance off: no 15 s poll')

    window.dispatchEvent(new CustomEvent('sync:error', { detail: { status: 500 } }))
    await surface.settle()
    assert.equal(reads, 1, 'an ordinary failed write does not re-read')

    running.maintenance = { mode: 'restore', phase: 'restoring', table: 'sales', startedBy: 'owner' }
    window.dispatchEvent(new CustomEvent('sync:error', { detail: { status: 503 } }))
    await surface.settle()
    assert.equal(reads, 2, 'a write refused with 503 re-reads at once')
    assert.ok(surface.text().includes(en.restore_maintenance_running), 'and the banner shows the restore')
    assert.equal(activePolls().length, 1, 'maintenance on: the 15 s poll runs')

    activePolls()[0].tick(); await surface.settle()
    assert.equal(reads, 3)
    running.maintenance = null
    activePolls()[0].tick(); await surface.settle()
    assert.equal(reads, 4)
    assert.ok(!surface.text().includes(en.restore_maintenance_running), 'cleared elsewhere: the banner goes')
    assert.equal(activePolls().length, 0, 'and the poll stops')
    console.log('PASS Backup maintenance: read on arrival, poll only while on, 503 re-reads')
  } finally { await surface.unmount() }
} catch (error) {
  failed++
  console.error('FAIL Backup maintenance poll')
  console.error(error)
} finally {
  win.addEventListener = originalListeners.add
  win.removeEventListener = originalListeners.remove
  win.dispatchEvent = originalListeners.dispatch
  await harness.close()
}

if (failed) process.exit(1)
