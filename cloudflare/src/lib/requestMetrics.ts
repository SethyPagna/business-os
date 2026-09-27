// Per-request metrics: the A/B harness every later data-architecture decision
// is measured with (C3v2 plan item 1).
//
// WHAT IT MEASURES
//
// For each /api/* request: how many D1 round trips it made (a batch is one
// call; a retried statement is two), how many statements ran, the rows D1 says
// it read and wrote (meta.rows_read / meta.rows_written), D1's own execution
// time (meta.duration, summed), the wall-clock measured around each call
// (summed) -- wall minus meta.duration is the Worker<->D1 network round trip --
// the region that served the calls (meta.served_by_region; 'mixed' when they
// differ) and how many were served by the primary, whether the response came
// from the Cache API (hit | miss | bypass), and which feature flags the
// request consulted (none yet: nothing writes acc.flags until the C3v2 KV
// flag reader lands with its first consumer). No SQL text or bound value is
// ever read or kept.
//
// WHERE THE NUMBERS COME FROM
//
// lib/db.ts's D1Compat is the one place nearly every statement passes through,
// but it is constructed by getDb(env) at ~500 call sites that have no Hono
// context. So the accumulator is bound twice: on the Hono context (the
// middleware reads it back to build the response header) and in an
// AsyncLocalStorage scope (nodejs_compat is on in both wrangler configs), which
// is how D1Compat and cachedJsonResponse find it without a context argument.
//
// db.ts and cache.ts reach this module through a global Symbol.for hook rather
// than an import. Both files are loaded in isolation by dozens of pure tests
// whose loaders resolve relative imports from the scripts directory; a new
// import there would break every one of them, and a hook that is simply absent
// is a no-op. The key below must stay identical in all three files -- the pure
// test test-request-metrics-pure.cjs enforces it.
//
// NOT COUNTED: code that calls env.DB.prepare()/batch() directly instead of
// going through D1Compat (lib/maintenance.ts, lib/productWrites.ts,
// lib/backup.ts and a handful of route sites). Those statements are invisible
// here until they move onto D1Compat. The queue() consumers in index.ts run
// outside any scope and are not counted either. A /api/sync replay
// re-dispatches each op through app.request(), so every op is its own
// request and the outer sync request shows almost no D1 work.
//
// Server-Timing goes to signed-in staff only. Its row counts can differ on a
// route that reads a row before refusing, which hints whether the target
// exists; accepted, since status and timing already differ there.
//
// BACKGROUND WORK NEVER MIXES INTO A ROUTE
//
// runBackground(env, label, fn) runs fn under its own accumulator, recorded as
// kind 'bg' with that label (cron steps, the Telegram drain). Work a handler
// hands to waitUntil WITHOUT that wrapper still inherits the request's scope
// (AsyncLocalStorage follows the promise chain), so the request's accumulator
// is sealed the moment the response is finalised: anything that resolves
// after that point is counted in `late` and never added to the route's
// numbers. Work that finishes before the response is indistinguishable from
// the handler's own and is counted with it; call sites that want it separated
// must wrap it in runBackground.
//
// WHAT IS RECORDED TO ANALYTICS ENGINE, AND WHAT IS NOT
//
// Only: the route TEMPLATE as registered in code (e.g. /api/products/:id --
// never the raw path, never a query string), the method, the status, the
// cache state, the flag states consulted, and numbers. No ids, no names, no
// amounts, no user. See lib/analytics.ts for why that line matters here.
//
// Datapoint layout (index1 = 'req_metrics'):
//   blob1 kind ('api' | 'bg')   blob2 route template or background label
//   blob3 method ('BG' for bg)  blob4 status ('200' / 'ok' / 'error')
//   blob5 cache state           blob6 flags ('name=state;...', sorted)
//   double1 wall ms             double2 D1 ms (sum of meta.duration)
//   double3 rows_read           double4 rows_written
//   double5 statements          double6 sample weight (1 / sample rate)
//   blob7 D1 region ('' unknown, 'mixed' when calls differ)
//   double7 failed D1 calls     double8 late D1 calls (after seal)
//   double9 D1 calls            double10 D1 wall ms (sum around each call)
//   double11 D1 calls served by the primary
//
// Sampling: every miss and bypass, one hit in ten (weight 10), every
// background run. Aggregate with SUM(_sample_interval * double6).

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from 'hono'
import type { Env } from '../index'

export type CacheState = 'hit' | 'miss' | 'bypass'
export type FlagState = 'off' | 'shadow' | 'on'

export type RequestMetrics = {
  kind: 'api' | 'bg'
  label: string
  startedAt: number
  statements: number
  rowsRead: number
  rowsWritten: number
  d1Ms: number
  d1Calls: number
  d1WallMs: number
  d1Region: string
  d1Primary: number
  failed: number
  cacheHits: number
  cacheMisses: number
  flags: Record<string, FlagState>
  sealed: boolean
  late: number
}

export const REQUEST_METRICS_HOOK_KEY = 'business-os.request-metrics.v1'
export const METRICS_ANALYTICS_KIND = 'req_metrics'
export const HIT_SAMPLE_RATE = 0.1
const CONTEXT_KEY = 'requestMetrics'

export function createRequestMetrics(kind: 'api' | 'bg', label: string, now: number = Date.now()): RequestMetrics {
  return {
    kind, label, startedAt: now,
    statements: 0, rowsRead: 0, rowsWritten: 0, d1Ms: 0, d1Calls: 0, d1WallMs: 0, d1Region: '', d1Primary: 0, failed: 0,
    cacheHits: 0, cacheMisses: 0, flags: {}, sealed: false, late: 0,
  }
}

function finiteOrZero(value: unknown): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

function metaRecord(meta: unknown): Record<string, unknown> {
  return (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>
}

/** Region codes are short identifiers (e.g. APAC); anything else is 'other'. */
export function sanitizeRegion(region: unknown): string {
  if (typeof region !== 'string' || !region) return ''
  return /^[A-Za-z0-9_-]{1,16}$/.test(region) ? region : 'other'
}

/**
 * One D1 round trip: the wall-clock measured around it and the per-statement
 * metas it returned (a batch returns one per statement; null when it threw).
 * A sealed accumulator only counts `late`.
 */
export function addD1Call(acc: RequestMetrics, wallMs: number, metas: unknown[] | null): void {
  if (acc.sealed) { acc.late += 1; return }
  acc.d1Calls += 1
  acc.d1WallMs += finiteOrZero(wallMs)
  if (metas === null) { acc.failed += 1; return }
  for (const meta of metas) {
    const m = metaRecord(meta)
    acc.statements += 1
    acc.rowsRead += finiteOrZero(m.rows_read)
    acc.rowsWritten += finiteOrZero(m.rows_written)
    acc.d1Ms += finiteOrZero(m.duration)
  }
  // Every statement of one call is served by the same database instance.
  const first = metaRecord(metas[0])
  const region = sanitizeRegion(first.served_by_region)
  if (region) acc.d1Region = !acc.d1Region || acc.d1Region === region ? region : 'mixed'
  if (first.served_by_primary === true) acc.d1Primary += 1
}

export function addCacheOutcome(acc: RequestMetrics, outcome: 'hit' | 'miss'): void {
  if (acc.sealed) return
  if (outcome === 'hit') acc.cacheHits += 1
  else acc.cacheMisses += 1
}

/** Any miss makes the request a miss; otherwise any hit a hit; else bypass. */
export function cacheStateOf(acc: RequestMetrics): CacheState {
  if (acc.cacheMisses > 0) return 'miss'
  if (acc.cacheHits > 0) return 'hit'
  return 'bypass'
}

export function flagsLabel(flags: Record<string, FlagState>): string {
  return Object.keys(flags).sort().map((name) => `${name}=${flags[name]}`).join(';').slice(0, 200)
}

function formatMs(ms: number): string {
  return String(Math.round(ms * 10) / 10)
}

export function serverTimingHeader(acc: RequestMetrics): string {
  const rr = Math.round(acc.rowsRead)
  const rw = Math.round(acc.rowsWritten)
  // d1 = D1 execution time (meta.duration) with rows and statements; d1n = D1
  // calls; d1w = wall-clock around them; d1q = meta.duration again, named for
  // the council's d1w - d1q round-trip reading; d1r = serving region.
  const region = acc.d1Region ? `, d1r;desc="${acc.d1Region}"` : ''
  return `d1;dur=${formatMs(acc.d1Ms)};desc="rr=${rr} rw=${rw} q=${acc.statements}", d1n;desc="${acc.d1Calls}", d1w;dur=${formatMs(acc.d1WallMs)}, d1q;dur=${formatMs(acc.d1Ms)}${region}, cache;desc="${cacheStateOf(acc)}"`
}

export function sampleRate(state: CacheState): number {
  return state === 'hit' ? HIT_SAMPLE_RATE : 1
}

export function shouldSample(state: CacheState, random: number): boolean {
  return random < sampleRate(state)
}

/**
 * The route template as registered in code. Hono's routePath after next()
 * names the handler that produced the response. Anything that is not a
 * code-shaped path collapses to a constant, so a raw URL can never leak.
 */
export function sanitizeTemplate(template: unknown): string {
  const text = typeof template === 'string' ? template : ''
  if (!text.startsWith('/') || text.includes('?') || text.length > 120) return '(unmatched)'
  return text
}

export type MetricsDatapoint = {
  kind: 'api' | 'bg'
  template: string
  method: string
  status: string
  cache: CacheState
  flags: string
  wallMs: number
  weight: number
  acc: RequestMetrics
}

export function datapointLabels(point: MetricsDatapoint): string[] {
  return [point.kind, point.template, point.method, point.status, point.cache, point.flags, point.acc.d1Region]
}

export function datapointValues(point: MetricsDatapoint): number[] {
  const { acc } = point
  return [point.wallMs, acc.d1Ms, acc.rowsRead, acc.rowsWritten, acc.statements, point.weight, acc.failed, acc.late,
    acc.d1Calls, acc.d1WallMs, acc.d1Primary]
}

function writeDatapoint(env: Env | undefined, point: MetricsDatapoint): void {
  const dataset = env?.Business_OS_Analytics
  if (!dataset) return
  // Written directly rather than through lib/analytics.ts's recordAnalytics,
  // whose 10-double cap is below this layout's 11; same shape and guards.
  try {
    dataset.writeDataPoint({
      indexes: [METRICS_ANALYTICS_KIND],
      blobs: datapointLabels(point).map((label) => String(label ?? '').slice(0, 200)),
      doubles: datapointValues(point).map((value) => (Number.isFinite(Number(value)) ? Number(value) : 0)),
    })
  } catch {
    // Never let an observation fail the request it observes.
  }
}

const store = new AsyncLocalStorage<RequestMetrics>()

// The hook db.ts and cache.ts look up by Symbol.for(REQUEST_METRICS_HOOK_KEY).
// Every entry swallows its own errors: it runs inside a database call.
export type RequestMetricsHook = {
  d1Call(wallMs: number, metas: unknown[] | null): void
  cache(outcome: 'hit' | 'miss'): void
}

const hook: RequestMetricsHook = {
  d1Call(wallMs, metas) { try { const acc = store.getStore(); if (acc) addD1Call(acc, wallMs, metas) } catch { /* no-op */ } },
  cache(outcome) { try { const acc = store.getStore(); if (acc) addCacheOutcome(acc, outcome) } catch { /* no-op */ } },
}
;(globalThis as unknown as Record<symbol, RequestMetricsHook>)[Symbol.for(REQUEST_METRICS_HOOK_KEY)] = hook

/** Reads the accumulator a request middleware bound to this context. */
export function requestMetricsOf(c: Context): RequestMetrics | undefined {
  try { return (c as unknown as { get(key: string): unknown }).get(CONTEXT_KEY) as RequestMetrics | undefined } catch { return undefined }
}

type MetricsContext = {
  env: Env
  req: { method: string; routePath: string }
  res: Response
  get(key: string): unknown
  set(key: string, value: unknown): void
  header(name: string, value: string, options?: { append?: boolean }): void
}

export type RequestMetricsOptions = {
  random?: () => number
  now?: () => number
}

/**
 * The /api/* middleware. Adds no I/O to the request: the header is built from
 * numbers already in memory, and the Analytics Engine write is a synchronous,
 * fire-and-forget call wrapped so it cannot throw.
 */
export function createRequestMetricsMiddleware(options: RequestMetricsOptions = {}) {
  const random = options.random || Math.random
  const now = options.now || Date.now
  return async function requestMetricsMiddleware(rawContext: unknown, next: () => Promise<void>): Promise<void> {
    const c = rawContext as MetricsContext
    const acc = createRequestMetrics('api', '', now())
    try { c.set(CONTEXT_KEY, acc) } catch { /* the accumulator still works through the store */ }
    await store.run(acc, () => next())
    acc.sealed = true
    try {
      const state = cacheStateOf(acc)
      // Authenticated routes only: requireAuth is the one place `user` is set.
      // The public storefront API and anonymous calls carry no timing header.
      if (c.get('user')) c.header('Server-Timing', serverTimingHeader(acc), { append: true })
      if (shouldSample(state, random())) {
        writeDatapoint(c.env, {
          kind: 'api',
          template: sanitizeTemplate(c.req.routePath),
          method: String(c.req.method || '').toUpperCase().slice(0, 8),
          status: String(c.res?.status ?? 0),
          cache: state,
          flags: flagsLabel(acc.flags),
          wallMs: Math.max(0, now() - acc.startedAt),
          weight: 1 / sampleRate(state),
          acc,
        })
      }
    } catch {
      // Metrics are an observer. A read-only response header or a missing
      // binding must never change the response the route produced.
    }
  }
}

export const requestMetricsMiddleware = createRequestMetricsMiddleware()

/**
 * Runs background work (cron step, drain) under its own accumulator and
 * records it as kind 'bg' with `label`, whatever scope it was started from.
 * Rethrows fn's error unchanged; the datapoint records status 'error'.
 */
export async function runBackground<T>(env: Env | undefined, label: string, fn: () => Promise<T>, now: () => number = Date.now): Promise<T> {
  const acc = createRequestMetrics('bg', label, now())
  let status = 'ok'
  try {
    return await store.run(acc, fn)
  } catch (error) {
    status = 'error'
    throw error
  } finally {
    acc.sealed = true
    writeDatapoint(env, {
      kind: 'bg',
      template: `bg:${String(label).replace(/[^a-z0-9:_-]/gi, '_').slice(0, 80)}`,
      method: 'BG',
      status,
      cache: 'bypass',
      flags: flagsLabel(acc.flags),
      wallMs: Math.max(0, now() - acc.startedAt),
      weight: 1,
      acc,
    })
  }
}
