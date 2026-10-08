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
// LAYERS: an isolate memo (shares one computation across concurrent requests
// in the same isolate, e.g. /dashboard/startup from several tabs) and the
// Workers Cache API (shares it across isolates in a colo). Neither is a
// correctness dependency: no Cache API, or an error from it, just computes.

import type { Env } from '../index'
import { getDb } from './db'
import { productHasStockSql } from './productStockGuard'
import { getVersionWithFallback } from './cache'
import { getFamilyStockOverview, type FamilyStockAlertPage, type FamilyStockStats } from './familyStockStats'
import { loadLowStockConfig, type LowStockConfig } from './lowStockSettings'
import { getPlanLimits } from './planTier'

export const DASHBOARD_STOCK_PREVIEW_SIZE = 10

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

export async function computeDashboardStockOverview(env: Env, lowStock: LowStockConfig): Promise<DashboardStockOverview> {
  const db = getDb(env)
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
  }
}

// Bump when the cached shape changes, so an old entry can never be read back
// as the new shape.
const OVERVIEW_CACHE_SCHEMA = 'dso2'

export function dashboardStockOverviewKey(parts: {
  productsVersion: string
  stockVersion: string
  lowStock: LowStockConfig
  utcDate: string
}): string {
  const low = `${parts.lowStock.enabled ? 1 : 0}:${parts.lowStock.mode}:${parts.lowStock.threshold}`
  return [OVERVIEW_CACHE_SCHEMA, parts.utcDate, `p=${parts.productsVersion}`, `s=${parts.stockVersion}`, `l=${low}`, `n=${DASHBOARD_STOCK_PREVIEW_SIZE}`].join('|')
}

type Memo = { key: string; expiresAt: number; promise: Promise<DashboardStockOverview> }
let memo: Memo | null = null

export type DashboardStockOverviewContext = {
  // Origin the Cache API key is built on (the request's own origin: the
  // Cache API only stores keys on the zone serving the request).
  requestUrl: string
  waitUntil(promise: Promise<unknown>): void
  now?: () => number
  // Injected by tests; defaults to the Workers Cache API when present.
  cache?: Pick<Cache, 'match' | 'put'> | null
}

function defaultCache(): Pick<Cache, 'match' | 'put'> | null {
  try {
    const store = (globalThis as unknown as { caches?: { default?: Cache } }).caches
    return store?.default ?? null
  } catch {
    return null
  }
}

export async function loadDashboardStockOverview(env: Env, ctx: DashboardStockOverviewContext): Promise<DashboardStockOverview> {
  const now = (ctx.now ?? Date.now)()
  const ttlSeconds = getPlanLimits(env).dashboardStockOverviewCacheSeconds
  const lowStockPromise = loadLowStockConfig(env)
  let versions: [string, string]
  try {
    versions = await Promise.all([getVersionWithFallback(env, 'products'), getVersionWithFallback(env, 'stock')])
  } catch {
    // Without the versions there is no safe key: compute, and cache nothing.
    return computeDashboardStockOverview(env, await lowStockPromise)
  }
  const lowStock = await lowStockPromise
  const [productsVersion, stockVersion] = versions
  const key = dashboardStockOverviewKey({ productsVersion, stockVersion, lowStock, utcDate: new Date(now).toISOString().slice(0, 10) })

  const current = memo
  if (current && current.key === key && now < current.expiresAt) return current.promise

  const entry: Memo = { key, expiresAt: now + ttlSeconds * 1000, promise: Promise.resolve(null as unknown as DashboardStockOverview) }
  entry.promise = (async () => {
    const cache = ctx.cache === undefined ? defaultCache() : ctx.cache
    let cacheRequest: Request | null = null
    if (cache) {
      try {
        const url = new URL('/__internal-cache/dashboard-stock-overview', ctx.requestUrl)
        url.searchParams.set('k', key)
        cacheRequest = new Request(url.toString(), { method: 'GET' })
        const hit = await cache.match(cacheRequest)
        if (hit) return await hit.json<DashboardStockOverview>()
      } catch {
        // A cache fault is never a request fault: compute instead.
      }
    }
    const value = await computeDashboardStockOverview(env, lowStock)
    if (cache && cacheRequest) {
      try {
        const response = new Response(JSON.stringify(value), {
          headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSeconds}` },
        })
        ctx.waitUntil(cache.put(cacheRequest, response).catch(() => {}))
      } catch {
        // ignore: the answer is already computed
      }
    }
    return value
  })()
  // A failed computation must not be served to the next caller.
  entry.promise.catch(() => { if (memo === entry) memo = null })
  memo = entry
  return entry.promise
}
