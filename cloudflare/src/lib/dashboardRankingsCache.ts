// The Dashboard's three ranked lists ("view more": top customers, top products by revenue and by quantity), kept for a
// few seconds so opening one costs no snapshot read.
//
// WHY: a ranked list is built from the verified report snapshot (two passes over sales, lines, returns and return lines,
// 2,000 rows a page), which is 24 to 26 D1 statements at 4,200 sales against the 2 the SQL ranking used to cost. The
// Dashboard card has just read that same snapshot, so the card hands its rankings on: the analytics call stores the
// first DASHBOARD_RANKING_ROWS rows of each ranking, and opening a list within the TTL reads them back. The list is
// then the card's own rows, so the two cannot disagree. A list opened with nothing stored reads one snapshot, builds
// only the ranking it shows, and stores it.
//
// FRESHNESS: the key folds in the versions every sale, return, customer and product writer already bumps (the same four
// the Sales read cache uses), so a write makes the stored rows unreachable at once; the TTL is only the ceiling for a
// writer that forgets to bump. The rows are actor-neutral: product names are the sale lines' own and the caller applies
// the current ones, and the route applies the cost projection after the read, as for every other cached read.
// A cache that is missing or fails is never a request fault: the list is computed.

import type { Env } from '../index'
import { getVersionsWithFallback } from './cache'
import type { DashboardCustomerRow, DashboardProductRow, DashboardRankKind, SalesFilters } from './salesAnalytics'

export type RankingRow = DashboardCustomerRow | DashboardProductRow

export const DASHBOARD_RANKING_ROWS = 300
export const DASHBOARD_RANKING_CACHE_SECONDS = 20
const CACHE_SCHEMA = 'dashboard-rankings-v1'
const VERSION_NAMESPACES = ['sales', 'returns', 'customers', 'products'] as const

export type DashboardRankingsCacheContext = {
  // The request's own URL: the Cache API only stores keys on the zone serving the request.
  requestUrl: string
  waitUntil(promise: Promise<unknown>): void
  // Injected by tests; defaults to the Workers Cache API when present.
  cache?: Pick<Cache, 'match' | 'put'> | null
}

export type DashboardRankingsCache = {
  read(kind: DashboardRankKind): Promise<RankingRow[] | null>
  write(kind: DashboardRankKind, rows: RankingRow[]): void
}

function defaultCache(): Pick<Cache, 'match' | 'put'> | null {
  try {
    return (globalThis as unknown as { caches?: { default?: Cache } }).caches?.default ?? null
  } catch {
    return null
  }
}

/**
 * Opens the cache for one range and branch. Returns null (compute, store nothing) when there is no Cache API or the
 * versions cannot be read, because without them there is no safe key.
 */
export async function openDashboardRankingsCache(
  env: Env,
  ctx: DashboardRankingsCacheContext,
  filters: Pick<SalesFilters, 'startDate' | 'endDate' | 'branchId'> & { createdFrom?: string | null; createdTo?: string | null },
): Promise<DashboardRankingsCache | null> {
  const cache = ctx.cache === undefined ? defaultCache() : ctx.cache
  if (!cache) return null
  let versions: string[]
  try {
    versions = await getVersionsWithFallback(env, VERSION_NAMESPACES)
  } catch {
    return null
  }
  const keyFor = (kind: DashboardRankKind): Request => {
    const url = new URL('/__internal-cache/dashboard-ranking', ctx.requestUrl)
    const parts: Array<[string, unknown]> = [['schema', CACHE_SCHEMA], ['kind', kind], ['limit', DASHBOARD_RANKING_ROWS],
      ['startDate', filters.startDate], ['endDate', filters.endDate], ['createdFrom', filters.createdFrom], ['createdTo', filters.createdTo],
      ['branchId', filters.branchId], ...VERSION_NAMESPACES.map((namespace, index): [string, unknown] => [`v_${namespace}`, versions[index]])]
    for (const [name, value] of parts) url.searchParams.set(name, value == null ? '' : String(value))
    return new Request(url.toString(), { method: 'GET' })
  }
  return {
    async read(kind) {
      try {
        const hit = await cache.match(keyFor(kind))
        if (!hit) return null
        const body = await hit.json<{ rows?: unknown }>()
        return Array.isArray(body.rows) ? (body.rows as RankingRow[]) : null
      } catch {
        return null
      }
    },
    write(kind, rows) {
      try {
        const response = new Response(JSON.stringify({ rows }), {
          headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${DASHBOARD_RANKING_CACHE_SECONDS}` },
        })
        ctx.waitUntil(cache.put(keyFor(kind), response).catch(() => {}))
      } catch {
        // the rows are already computed
      }
    },
  }
}
