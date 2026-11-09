// The Dashboard's stock/expiry overview, computed once and shared
// (G39 efficiency item 1).
//
// WHAT IT IS: the catalog-wide, range-independent half of /api/dashboard and
// /api/dashboard/startup -- family stock stats, the low / out-of-stock preview
// lists, and the expiring list + count. None of it depends on the selected
// date range or branch (compat.ts dashboardSummary explains why the stock
// cards are the deliberate exception to range scoping), so every user, range
// and branch shares one answer.
//
// COST BEFORE: 5 full-catalog family CTE passes (stats, and COUNT + items for
// each alert list) plus 2 full active-catalog expiry scans per load, and
// /dashboard/startup and every sync-triggered reload paid it again.
// COST NOW, on a miss: ONE family pass (getFamilyStockOverview) plus two
// expiry statements that retain migration 0228's partial index for active products.
// Inactive products with stock are included as invariant violations. On a hit:
// zero D1 rows (two cache-version reads, KV first).
//
// FRESHNESS: the key folds in the 'products' and 'stock' cache versions --
// the same versions every catalog/stock writer already bumps (I2-1 contract,
// routes/products.ts productSearchCacheVersion) -- so a sale, adjustment,
// receive, transfer, import or product edit makes the cached answer
// unreachable at once. The low-stock config is part of the key (it is read
// anyway, and changing it changes every number). The UTC date is part of the
// key because the expiry window is computed from SQLite's 'now'. The TTL is
// only the ceiling for a writer that forgets to bump: plan-tiered, longer on
// Free (planTier.ts dashboardStockOverviewCacheSeconds).
//
// AS OF: the overview carries `asOf`, the UTC ISO time its figures were computed. It is stamped once, when they are computed, and every
// copy keeps it: a memo or Cache API hit returns the stored value untouched, so the Dashboard can say "as of 14:05" and mean it.
//
// FIVE MINUTES (read switch `dash_overview_5m`, default off; owner 27 Oct / 1 Nov: the overview "may be up to 5 minutes old, with the time
// it was calculated"). ON, a sale (it bumps 'stock' and 'sales', not 'products') no longer recomputes it: the key drops the 'stock' version and
// instead carries the deployment, organisation, data epoch, the branch scope and cost grant of the asker, the low-stock config, the 'products'
// version and a business-time bucket as long as planTier.ts dashboardOverviewMaxAgeSeconds (300 s). A product edit or an inventory
// adjustment, stock-in or transfer (they bump 'products') still ends it at once.
// An entry is never served more than that window after `asOf`, whatever the key or the cache headers say. OFF keeps the reads, the key and
// the lifetimes described above; the only difference in its body is the `asOf` field.
//
// LAYERS: an isolate memo (shares a FINISHED answer with later requests in the same isolate; a computation still running is shared as a
// promise only inside its own request, and with other requests through a "building since" marker and a bounded wait for the finished
// value, lib/buildShare.ts) and the Workers Cache API (shares it across isolates in a colo). Neither is a correctness dependency: no Cache
// API, or an error from it, just computes.

import type { Env } from '../index'
import { getDb } from './db'
import { productHasStockSql } from './productStockGuard'
import { getVersionWithFallback } from './cache'
import { deploymentId, isUnsafeVersion } from './cacheKey'
import { BUSINESS_UTC_OFFSET_MINUTES } from './businessDateWindow'
import { readDataEpoch, readSwitch } from './readSwitches'
import { getFamilyStockOverview, type FamilyStockAlertPage, type FamilyStockStats } from './familyStockStats'
import { loadLowStockConfig, type LowStockConfig } from './lowStockSettings'
import { getPlanLimits } from './planTier'

export const DASHBOARD_STOCK_PREVIEW_SIZE = 10
export const DASHBOARD_OVERVIEW_SWITCH = 'dash_overview_5m'

export interface DashboardExpiringRow {
  id: number
  name: string | null
  category: string | null
  unit: string | null
  expiry_date: string | null
  days_until_expiry: number | null
}

export interface DashboardStockOverview {
  inventory: FamilyStockStats
  low: FamilyStockAlertPage
  out: FamilyStockAlertPage
  expiring: DashboardExpiringRow[]
  expiringCount: number
  /** UTC ISO time the figures above were computed; a cached copy keeps its own. */
  asOf: string
}

const EXPIRY_DATE_WHERE_SQL = `expiry_date IS NOT NULL AND date(expiry_date) <= date('now', '+' || COALESCE(expiry_alert_days, 30) || ' day')`
export const DASHBOARD_EXPIRY_WHERE_SQL = `p.is_active = 1 AND ${EXPIRY_DATE_WHERE_SQL}`
const INACTIVE_EXPIRY_WHERE_SQL = `p.is_active IS NOT 1 AND ${productHasStockSql()} AND ${EXPIRY_DATE_WHERE_SQL}`

export function dashboardExpiringProductsSql(limit: number): string {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid expiry list limit')
  return `SELECT *, CAST(julianday(expiry_date) - julianday('now') AS INTEGER) AS days_until_expiry FROM (
    SELECT id, name, category, unit, expiry_date FROM products p WHERE ${DASHBOARD_EXPIRY_WHERE_SQL}
    UNION ALL
    SELECT id, name, category, unit, expiry_date FROM products p WHERE ${INACTIVE_EXPIRY_WHERE_SQL}
  ) ORDER BY date(expiry_date) ASC LIMIT ${limit}`
}

export async function computeDashboardStockOverview(env: Env, lowStock: LowStockConfig, now: () => number = Date.now): Promise<DashboardStockOverview> {
  const db = getDb(env)
  // Stamped before the reads: the figures are no newer than this, so "as of" never claims a moment later than the data.
  const asOf = new Date(now()).toISOString()
  const [overview, expiring, expiringCount] = await Promise.all([
    getFamilyStockOverview({ db, lowStock, previewSize: DASHBOARD_STOCK_PREVIEW_SIZE }),
    db.prepare(dashboardExpiringProductsSql(DASHBOARD_STOCK_PREVIEW_SIZE)).all<DashboardExpiringRow>(),
    db.prepare(`
      SELECT (SELECT COUNT(*) FROM products p WHERE ${DASHBOARD_EXPIRY_WHERE_SQL})
        + (SELECT COUNT(*) FROM products p WHERE ${INACTIVE_EXPIRY_WHERE_SQL}) AS count
    `).get<{ count: number }>(),
  ])
  return {
    inventory: overview.stats,
    low: overview.low,
    out: overview.out,
    expiring: expiring || [],
    expiringCount: Number(expiringCount?.count || 0),
    asOf,
  }
}

// Bump when the cached shape changes, so an old entry can never be read back
// as the new shape. dso3: `asOf` joined the body.
const OVERVIEW_CACHE_SCHEMA = 'dso3'
// The switched key lives under its own schema: an entry made one way is never read back the other way.
const OVERVIEW_5M_CACHE_SCHEMA = 'dso3-5m'

const lowStockToken = (lowStock: LowStockConfig): string => `${lowStock.enabled ? 1 : 0}:${lowStock.mode}:${lowStock.threshold}`

export function dashboardStockOverviewKey(parts: {
  productsVersion: string
  stockVersion: string
  lowStock: LowStockConfig
  utcDate: string
  // The Worker deployment and the database's data epoch (lib/cacheKey.ts): a deploy, a rollback or a restore never reads an older body.
  build?: string
  epoch?: string
}): string {
  return [OVERVIEW_CACHE_SCHEMA, parts.utcDate, `p=${parts.productsVersion}`, `s=${parts.stockVersion}`, `l=${lowStockToken(parts.lowStock)}`, `n=${DASHBOARD_STOCK_PREVIEW_SIZE}`,
    `b=${parts.build ?? ''}`, `e=${parts.epoch ?? ''}`].join('|')
}

/**
 * The key with the read switch ON. No 'stock' version: a stock-only write does not end an entry, the window does. `bucket` is the business-time
 * bucket index (businessBucket); the UTC date stays because the expiry window reads SQLite's 'now', and a window that does not divide a day
 * would otherwise let one bucket span midnight.
 */
export function dashboardStockOverviewFiveMinuteKey(parts: {
  productsVersion: string
  lowStock: LowStockConfig
  bucket: number
  utcDate: string
  build: string
  epoch: string
  org: string
  // The branch the Dashboard was asked for ('' = all) and the asker's cost grant: the body is shared only between askers who may see the same thing.
  branchScope: string
  costGrant: string
}): string {
  return [OVERVIEW_5M_CACHE_SCHEMA, `b=${parts.build}`, `o=${parts.org}`, `e=${parts.epoch}`, `br=${parts.branchScope}`, `cg=${parts.costGrant}`,
    `l=${lowStockToken(parts.lowStock)}`, `n=${DASHBOARD_STOCK_PREVIEW_SIZE}`, `p=${parts.productsVersion}`, `d=${parts.utcDate}`, `t=${parts.bucket}`].join('|')
}

const BUSINESS_OFFSET_MS = BUSINESS_UTC_OFFSET_MINUTES * 60_000

/** Which window of business time `nowMs` falls in, and when that window ends (epoch ms). */
export function businessBucket(nowMs: number, windowMs: number): { bucket: number; endsAt: number } {
  const bucket = Math.floor((nowMs + BUSINESS_OFFSET_MS) / windowMs)
  return { bucket, endsAt: (bucket + 1) * windowMs - BUSINESS_OFFSET_MS }
}

// A promise belongs to the request that created it (workerd): awaiting another request's can hang for good once that request has
// answered or was cancelled, and a memo that held the pending promise froze the Dashboard for every later request (the 6.0.1048
// review, B1). So the isolate memo keeps the FINISHED value only, stamped with when its computation started, and a computation in
// flight is shared inside one request only (the callers that pass the same context). Between requests a marker and a bounded wait
// keep the saving (see loadDashboardStockOverview).
type Memo = { key: string; startedAt: number; expiresAt: number; value: DashboardStockOverview }
let memo: Memo | null = null
const inRequest = new WeakMap<object, { key: string; promise: Promise<DashboardStockOverview> }>()

// lib/buildShare.ts installs this hook (index.ts imports it); a test that loads this module alone has none. This file's imports are
// stubbed by hand in many tests, so the hook is read, not imported.
type BuildShareHook = { run<T>(env: Env, key: string, build: () => Promise<T>, peek?: () => T | undefined): Promise<T> }
const buildShareHook = (): BuildShareHook | undefined => (globalThis as unknown as Record<symbol, BuildShareHook | undefined>)[Symbol.for('business-os.build-share.v1')]

export type DashboardStockOverviewContext = {
  // Origin the Cache API key is built on (the request's own origin: the
  // Cache API only stores keys on the zone serving the request).
  requestUrl: string
  waitUntil(promise: Promise<unknown>): void
  now?: () => number
  // Injected by tests; defaults to the Workers Cache API when present.
  cache?: Pick<Cache, 'match' | 'put'> | null
  // Injected by tests; defaults to the database's data epoch (null = unreadable: compute, cache nothing).
  epoch?: string | null
  // Who is asking, for the key with read switch dash_overview_5m ON (compat.ts dashboardOverviewContext). Left out, there is no safe key for
  // that path: compute, cache nothing.
  org?: string
  branchScope?: string
  costGrant?: string
}

function defaultCache(): Pick<Cache, 'match' | 'put'> | null {
  try {
    const store = (globalThis as unknown as { caches?: { default?: Cache } }).caches
    return store?.default ?? null
  } catch {
    return null
  }
}

// What one load decided about its key before it looks anything up.
type Plan = {
  key: string
  // When a memoised value stops being served (epoch ms).
  expiresAt: number
  // The Cache API entry's max-age.
  cacheSeconds: number
  // Whether a stored value may still be served. OFF: always (the code before the switch). ON: only inside the max-age window after its `asOf`.
  usable(value: DashboardStockOverview, at: number): boolean
}

export async function loadDashboardStockOverview(env: Env, ctx: DashboardStockOverviewContext): Promise<DashboardStockOverview> {
  const now = (ctx.now ?? Date.now)()
  const limits = getPlanLimits(env)
  const lowStockPromise = loadLowStockConfig(env)
  // One memoised read that also carries the data epoch read below, so a cold isolate pays one statement for both.
  const fiveMinutes = await readSwitch(env, DASHBOARD_OVERVIEW_SWITCH)
  let versions: string[]
  try {
    versions = await Promise.all((fiveMinutes ? ['products'] : ['products', 'stock']).map((namespace) => getVersionWithFallback(env, namespace)))
  } catch {
    // Without the versions there is no safe key: compute, and cache nothing.
    return computeDashboardStockOverview(env, await lowStockPromise, ctx.now)
  }
  const lowStock = await lowStockPromise
  const epoch = ctx.epoch === undefined ? await readDataEpoch(env) : ctx.epoch
  // No epoch or an unsafe version is no safe key: compute, and cache nothing (CACHE-LIFECYCLE R3).
  if (!epoch || versions.some(isUnsafeVersion)) return computeDashboardStockOverview(env, lowStock, ctx.now)
  const utcDate = new Date(now).toISOString().slice(0, 10)
  const deployment = deploymentId(env)

  let plan: Plan
  if (fiveMinutes) {
    const windowMs = limits.dashboardOverviewMaxAgeSeconds * 1000
    if (!(windowMs > 0) || ctx.org === undefined || ctx.branchScope === undefined || ctx.costGrant === undefined) return computeDashboardStockOverview(env, lowStock, ctx.now)
    const { bucket, endsAt } = businessBucket(now, windowMs)
    plan = {
      key: dashboardStockOverviewFiveMinuteKey({ productsVersion: versions[0], lowStock, bucket, utcDate, build: deployment, epoch, org: ctx.org, branchScope: ctx.branchScope, costGrant: ctx.costGrant }),
      // Never past the end of the bucket and never past the window: an entry made at the start of a bucket is the oldest one served.
      expiresAt: Math.min(now + windowMs, endsAt),
      cacheSeconds: Math.max(1, Math.ceil((Math.min(now + windowMs, endsAt) - now) / 1000)),
      usable: (value, at) => at - Date.parse(value.asOf) <= windowMs,
    }
  } else {
    const ttlSeconds = limits.dashboardStockOverviewCacheSeconds
    plan = {
      key: dashboardStockOverviewKey({ productsVersion: versions[0], stockVersion: versions[1], lowStock, utcDate, build: deployment, epoch }),
      expiresAt: now + ttlSeconds * 1000,
      cacheSeconds: ttlSeconds,
      usable: () => true,
    }
  }
  const { key } = plan
  const clock = ctx.now ?? Date.now

  const current = memo
  if (current && current.key === key && now < current.expiresAt && plan.usable(current.value, now)) return current.value
  const shared = inRequest.get(ctx)
  if (shared && shared.key === key) return shared.promise

  const compute = async () => {
    const cache = ctx.cache === undefined ? defaultCache() : ctx.cache
    let cacheRequest: Request | null = null
    if (cache) {
      try {
        const url = new URL('/__internal-cache/dashboard-stock-overview', ctx.requestUrl)
        url.searchParams.set('k', key)
        cacheRequest = new Request(url.toString(), { method: 'GET' })
        const hit = await cache.match(cacheRequest)
        if (hit) {
          const stored = await hit.json<DashboardStockOverview>()
          if (plan.usable(stored, clock())) return stored
        }
      } catch {
        // A cache fault is never a request fault: compute instead.
      }
    }
    const value = await computeDashboardStockOverview(env, lowStock, ctx.now)
    if (cache && cacheRequest) {
      try {
        const response = new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${plan.cacheSeconds}` },
        })
        ctx.waitUntil(cache.put(cacheRequest, response).catch(() => {}))
      } catch {
        // ignore: the answer is already computed
      }
    }
    return value
  }
  const build = async () => {
    const value = await compute()
    // Only a finished value is remembered (a failed computation never is), and an older start never replaces a newer one.
    if (!memo || memo.startedAt <= now) memo = { key, startedAt: now, expiresAt: plan.expiresAt, value }
    return value
  }
  // Across requests: the first request to start this key sets a "building since" marker (lib/buildShare.ts) and a request that finds it
  // fresh waits for the finished value in the memo with a timer of its own, for a bounded time, then computes for itself. No hook (a test
  // that loads this module alone): every request computes for itself.
  const settled = () => {
    const entry = memo
    const at = clock()
    return entry && entry.key === key && at < entry.expiresAt && plan.usable(entry.value, at) ? entry.value : undefined
  }
  const hook = buildShareHook()
  const promise = hook ? hook.run(env, `dashboard-overview:${key}`, build, settled) : build()
  inRequest.set(ctx, { key, promise })
  const forget = () => { if (inRequest.get(ctx)?.promise === promise) inRequest.delete(ctx) }
  promise.then(forget, forget)
  return promise
}
