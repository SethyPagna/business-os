import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { startVisibleInterval, type VisibilityHost } from '../src/utils/visibilityPolling.ts'
import {
  IMPORT_JOBS_SHARED_LIMIT,
  importTrackerPollIntervalMs,
  isImportJobPush,
} from '../src/utils/importJobRefresh.ts'

// E4 (G39 item 7). BackgroundImportTracker read GET /api/import-jobs?limit=8
// every 12 s in every visible tab forever (~2.5 requests/min through the 20 s
// read cache), and its 3 s "active" cadence was answered from that cache. These
// tests count reads.

Object.assign(globalThis, {
  window: {
    location: { origin: 'https://fixture.test' },
    localStorage: { getItem: () => null, setItem: () => {} },
    sessionStorage: { getItem: () => null },
    setTimeout,
    clearTimeout,
    dispatchEvent: () => true,
    addEventListener: () => {},
  },
})
const http = await import('../src/api/http.ts')
http.setSyncServerUrl('https://fixture.test')

const ACTIVE_MS = 3000
const read = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

function fakeHost() {
  let clock = 0
  let hidden = false
  let nextId = 1
  const intervals = new Map<number, { fn: () => void; ms: number; next: number }>()
  const timeouts = new Map<number, { fn: () => void; due: number }>()
  const listeners = new Set<() => void>()
  const host: VisibilityHost = {
    isHidden: () => hidden,
    onVisibilityChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    setInterval: (fn, ms) => { const id = nextId++; intervals.set(id, { fn, ms, next: clock + ms }); return id },
    clearInterval: (id) => { intervals.delete(id) },
    setTimeout: (fn, ms) => { const id = nextId++; timeouts.set(id, { fn, due: clock + ms }); return id },
    clearTimeout: (id) => { timeouts.delete(id) },
    now: () => clock,
  }
  return {
    host,
    run(ms: number) {
      const end = clock + ms
      while (clock < end) {
        clock += 100
        for (const [id, t] of [...timeouts]) if (t.due <= clock) { timeouts.delete(id); t.fn() }
        for (const i of intervals.values()) while (i.next <= clock) { i.next += i.ms; i.fn() }
      }
    },
    setHidden(value: boolean) { hidden = value; listeners.forEach((l) => l()) },
  }
}

function readsOver(minutes: number, input: Parameters<typeof importTrackerPollIntervalMs>[0]): number {
  const env = fakeHost()
  let reads = 0
  const ms = importTrackerPollIntervalMs(input)
  const stop = ms == null ? () => {} : startVisibleInterval(() => { reads += 1 }, ms, { host: env.host })
  env.run(minutes * 60_000)
  stop()
  return reads
}

test('an idle tab arms no import-jobs timer at all', () => {
  assert.equal(importTrackerPollIntervalMs({ activeJobs: 0, recentStart: false, activeMs: ACTIVE_MS }), null)
  assert.equal(readsOver(60, { activeJobs: 0, recentStart: false, activeMs: ACTIVE_MS }), 0, 'an hour idle: zero polls (was 300 ticks at 12 s)')
  assert.equal(importTrackerPollIntervalMs({ activeJobs: 0, recentStart: false, backoffMs: 48_000, activeMs: ACTIVE_MS }), null, 'a failure backoff alone does not start polling')
})

test('an active job or a just-started import polls at the 3 s cadence', () => {
  assert.equal(importTrackerPollIntervalMs({ activeJobs: 1, recentStart: false, activeMs: ACTIVE_MS }), ACTIVE_MS)
  assert.equal(importTrackerPollIntervalMs({ activeJobs: 0, recentStart: true, activeMs: ACTIVE_MS }), ACTIVE_MS)
  assert.equal(readsOver(1, { activeJobs: 1, recentStart: false, activeMs: ACTIVE_MS }), 20)
})

test('a failing read still backs off while a job is active', () => {
  assert.equal(importTrackerPollIntervalMs({ activeJobs: 2, recentStart: false, backoffMs: 24_000, activeMs: ACTIVE_MS }), 24_000)
})

test('the 3 s cadence reaches the server: bypassCache skips the 20 s read cache', async () => {
  http.cacheClearAll()
  let serverReads = 0
  const serverFn = async () => { serverReads += 1; return { jobs: [{ id: serverReads, status: 'analyzing' }] } }
  const channel = `importJobs:list:limit=${IMPORT_JOBS_SHARED_LIMIT}`
  await http.route(channel, serverFn, null, { raceLocalFallback: false })
  await http.route(channel, serverFn, null, { raceLocalFallback: false })
  assert.equal(serverReads, 1, 'control: a second plain read inside the TTL is served from cache')
  const fresh = await http.route(channel, serverFn, null, { raceLocalFallback: false, bypassCache: true })
  assert.equal(serverReads, 2, 'a fresh read goes to the server')
  assert.deepEqual(fresh, { jobs: [{ id: 2, status: 'analyzing' }] })
  const shared = await http.route(channel, serverFn, null, { raceLocalFallback: false })
  assert.equal(serverReads, 2, 'and refreshes the cache other readers share')
  assert.deepEqual(shared, fresh)
})

test('concurrent fresh and plain reads of the shared key are one request', async () => {
  http.cacheClearAll()
  let serverReads = 0
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const serverFn = async () => { serverReads += 1; await gate; return { jobs: [] } }
  const channel = `importJobs:list:limit=${IMPORT_JOBS_SHARED_LIMIT}`
  const a = http.route(channel, serverFn, null, { raceLocalFallback: false, bypassCache: true })
  const b = http.route(channel, serverFn, null, { raceLocalFallback: false })
  const c = http.route(channel, serverFn, null, { raceLocalFallback: false })
  release()
  await Promise.all([a, b, c])
  assert.equal(serverReads, 1)
})

test('only the Worker import push wakes an idle reader', () => {
  const event = (detail: unknown) => Object.assign(new Event('sync:update'), { detail }) as Event
  assert.equal(isImportJobPush(event({ channel: 'products', payload: { action: 'import', jobId: 7 } })), true)
  assert.equal(isImportJobPush(event({ channel: 'sales', payload: { action: 'update', id: 9 } })), false, 'a sale push is not an import')
  assert.equal(isImportJobPush(event({ channel: 'products', reason: 'import-completed', source: 'import-tracker' })), false, "the tracker's own completion refresh must not loop back")
  assert.equal(isImportJobPush(event({ channel: 'products', reason: 'foreground-resume' })), false)
})

test('tracker, bell and Dashboard read the same import-jobs key', () => {
  const tracker = read('src/components/shared/BackgroundImportTracker.tsx')
  const bell = read('src/components/shared/NotificationCenter.tsx')
  const dashboard = read('src/components/dashboard/Dashboard.tsx')
  assert.match(tracker, /api\.listImportJobs\?\.\(\{ limit: IMPORT_JOBS_SHARED_LIMIT \}, \{ fresh \}\)/)
  assert.match(tracker, /return startVisibleInterval\(\(\) => \{ void loadJobs\(\) \}, pollIntervalMs\)/)
  assert.doesNotMatch(tracker, /IMPORT_TRACKER_IDLE_POLL_MS : |activeJobs\.length \? IMPORT_TRACKER_ACTIVE_POLL_MS/, 'no idle cadence')
  assert.match(bell, /listImportJobsRequest\(\{ limit: IMPORT_JOBS_SHARED_LIMIT \}\)/)
  assert.doesNotMatch(dashboard, /listImportJobs\(\{ limit: 5 \}\)/)
  assert.equal((dashboard.match(/listImportJobs\(\{ limit: IMPORT_JOBS_SHARED_LIMIT \}\)/g) || []).length, 2)
  assert.doesNotMatch(dashboard, /IMPORT_RELATED_SYNC_CHANNELS/, 'a sale push must not re-read import jobs')
})
