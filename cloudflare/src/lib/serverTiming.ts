// Per-request Server-Timing collector (K1 edge cache core).
//
// WHY
//
// "Is it slow because of D1, KV, the cache, or our own code?" had no answer
// from the outside: every /api response looked the same to DevTools. This
// module collects the handful of facts that answer it and writes them into one
// standard `Server-Timing` header, which every browser's Network panel already
// renders as a waterfall:
//
//   Server-Timing: cache;desc=HIT, kv;dur=1.2, d1;dur=8.0;desc="stmts=3 rows=41", app;dur=14.0, colo;desc=SIN
//
// WHAT IS NEVER IN IT
//
// No identity, no money, no query text: the header is visible to anyone who
// can make the request, including the anonymous storefront. The same rule
// covers the Analytics Engine sample below (see lib/analytics.ts's header).
//
// HOW OTHER MODULES REPORT INTO IT
//
// The collector hangs off the Request object in a WeakMap, so it lives exactly
// as long as the request and can never leak into another request sharing the
// isolate (a module-level "current request" variable would, because Workers
// interleave concurrent requests at every await). Anything holding the Request
// calls `serverTimingOf(request)` and gets the collector or null.
//
// lib/db.ts (owned by lane C3 L0) is the intended caller of `addD1`. getDb(env)
// has no Request today, so the wiring there is: accept an optional collector
// (or the Request) and call `addD1({ durMs, statements, rows })` once per
// prepare/batch round trip. Until that lands the d1 entry is simply absent --
// an absent metric is honest, a `d1;dur=0` would claim D1 was free.
//
// Workers only advance the clock across I/O, so durations are coarse by
// design; they are still exactly the I/O waits this header exists to show.

import type { Env } from '../index'
import { recordCacheObservation } from './analytics'

export type ServerTimingCacheStatus = 'HIT' | 'MISS' | 'BYPASS' | 'STALE' | 'NOT_MODIFIED'

export type ServerTimingSnapshot = {
  cacheStatus: ServerTimingCacheStatus | null
  kvMs: number
  kvCalls: number
  d1Ms: number
  d1Statements: number
  d1Rows: number
  d1Calls: number
  appMs: number | null
  colo: string | null
  bytes: number | null
  routeClass: string | null
}

export class ServerTimingCollector {
  readonly startedAt: number
  cacheStatus: ServerTimingCacheStatus | null = null
  kvMs = 0
  kvCalls = 0
  d1Ms = 0
  d1Statements = 0
  d1Rows = 0
  d1Calls = 0
  colo: string | null = null
  bytes: number | null = null
  routeClass: string | null = null
  private readonly clock: () => number

  constructor(clock: () => number = () => Date.now()) {
    this.clock = clock
    this.startedAt = clock()
  }

  now(): number {
    return this.clock()
  }

  /** The edge-cache outcome of this request. The last writer wins. */
  setCache(status: ServerTimingCacheStatus, bytes?: number | null): void {
    this.cacheStatus = status
    if (bytes != null && Number.isFinite(bytes)) this.bytes = Math.max(0, Math.round(bytes))
  }

  addKv(durMs: number): void {
    this.kvCalls += 1
    this.kvMs += finiteNonNegative(durMs)
  }

  /**
   * One D1 round trip. `statements` is 1 for a prepare().run/get/all and the
   * item count for a batch; `rows` is rows READ (meta.rows_read when D1
   * reports it, else the result length).
   */
  addD1(sample: { durMs: number; statements?: number; rows?: number }): void {
    this.d1Calls += 1
    this.d1Ms += finiteNonNegative(sample.durMs)
    this.d1Statements += Math.round(finiteNonNegative(sample.statements ?? 1))
    this.d1Rows += Math.round(finiteNonNegative(sample.rows ?? 0))
  }

  /** Times an async step into the kv bucket and passes its result through. */
  async timeKv<T>(step: () => Promise<T>): Promise<T> {
    const started = this.clock()
    try {
      return await step()
    } finally {
      this.addKv(this.clock() - started)
    }
  }

  snapshot(appMs: number | null = null): ServerTimingSnapshot {
    return {
      cacheStatus: this.cacheStatus,
      kvMs: this.kvMs,
      kvCalls: this.kvCalls,
      d1Ms: this.d1Ms,
      d1Statements: this.d1Statements,
      d1Rows: this.d1Rows,
      d1Calls: this.d1Calls,
      appMs,
      colo: this.colo,
      bytes: this.bytes,
      routeClass: this.routeClass,
    }
  }
}

function finiteNonNegative(value: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0
}

const collectors = new WeakMap<Request, ServerTimingCollector>()

export function attachServerTiming(request: Request, collector: ServerTimingCollector = new ServerTimingCollector()): ServerTimingCollector {
  collectors.set(request, collector)
  return collector
}

export function serverTimingOf(request: Request | null | undefined): ServerTimingCollector | null {
  if (!request) return null
  return collectors.get(request) ?? null
}

// RFC 8941 token characters; anything else is emitted as a quoted-string.
const TOKEN_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/

function formatDesc(value: string): string {
  const clean = String(value).replace(/[\r\n]/g, ' ').slice(0, 120)
  if (TOKEN_RE.test(clean)) return clean
  return `"${clean.replace(/["\\]/g, (ch) => `\\${ch}`)}"`
}

function formatDur(ms: number): string {
  const rounded = Math.round(finiteNonNegative(ms) * 10) / 10
  return String(rounded)
}

/**
 * The header value. Metrics with no observation are omitted rather than
 * reported as zero; the order is fixed so the header is diffable.
 */
export function formatServerTiming(snapshot: ServerTimingSnapshot): string {
  const parts: string[] = []
  if (snapshot.cacheStatus) parts.push(`cache;desc=${formatDesc(snapshot.cacheStatus)}`)
  if (snapshot.kvCalls > 0) parts.push(`kv;dur=${formatDur(snapshot.kvMs)}`)
  if (snapshot.d1Calls > 0) {
    parts.push(`d1;dur=${formatDur(snapshot.d1Ms)};desc=${formatDesc(`stmts=${snapshot.d1Statements} rows=${snapshot.d1Rows}`)}`)
  }
  if (snapshot.appMs != null) parts.push(`app;dur=${formatDur(snapshot.appMs)}`)
  if (snapshot.colo) parts.push(`colo;desc=${formatDesc(snapshot.colo)}`)
  return parts.join(', ')
}

export const CACHE_SAMPLE_RATE = 0.1

type TimingContext = {
  req: { raw: Request; path: string }
  env: Env
  res: Response
  executionCtx?: unknown
}

export type ServerTimingMiddlewareOptions = {
  clock?: () => number
  random?: () => number
  sampleRate?: number
  /** Supplied by httpCache.ts; kept injectable so this module has no route knowledge. */
  classify?: (method: string, path: string) => string
}

function requestColo(request: Request): string | null {
  const cf = (request as Request & { cf?: { colo?: unknown } }).cf
  const colo = cf && typeof cf.colo === 'string' ? cf.colo.trim() : ''
  return /^[A-Z]{3,4}$/.test(colo) ? colo : null
}

/**
 * Hono-compatible middleware. Register it on '/api/*' ABOVE every other /api
 * middleware so `app` covers the whole request, including early returns.
 */
export function createServerTimingMiddleware(options: ServerTimingMiddlewareOptions = {}) {
  const random = options.random ?? Math.random
  const sampleRate = options.sampleRate ?? CACHE_SAMPLE_RATE
  return async (c: TimingContext, next: () => Promise<void>): Promise<void> => {
    const collector = attachServerTiming(c.req.raw, new ServerTimingCollector(options.clock))
    collector.colo = requestColo(c.req.raw)
    collector.routeClass = options.classify ? options.classify(c.req.raw.method, c.req.path) : null
    await next()
    const appMs = collector.now() - collector.startedAt
    const value = formatServerTiming(collector.snapshot(appMs))
    if (value) setHeaderSafely(c, 'Server-Timing', value)
    // Only requests that went through the edge cache are sampled: that is the
    // population whose hit ratio and latency the sample exists to measure.
    if (collector.cacheStatus && random() < sampleRate) {
      recordCacheObservation(c.env, {
        routeClass: collector.routeClass || 'unclassified',
        status: collector.cacheStatus,
        colo: collector.colo || 'unknown',
        durMs: appMs,
        bytes: collector.bytes ?? 0,
      })
    }
  }
}

/**
 * Sets a header on c.res even when its Headers are immutable (a Response
 * passed through from fetch()/R2/assets). Never throws: a timing header must
 * not be the reason a response fails.
 */
export function setHeaderSafely(c: { res: Response }, name: string, value: string): void {
  try {
    c.res.headers.set(name, value)
    return
  } catch {
    // Immutable headers: rebuild the response around the same body.
  }
  try {
    const rebuilt = new Response(c.res.body, c.res)
    rebuilt.headers.set(name, value)
    c.res = rebuilt
  } catch {
    // A 101 or otherwise unconstructable response: leave it exactly as is.
  }
}
