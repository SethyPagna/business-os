import { cacheKeyRequest, type CacheIdentity } from './cacheKey'
import type { D1Compat } from './db'

// The shared ranked scope of the Products list (INV-A S7, behind the read switch catalog_ranked_scope).
//
// A ranking depends on the SCOPE (filters, search, sort, the restriction an Inventory check-state adds), never on the page or the page size. One cached entry holds the ordered family
// keys of the WHOLE scope and the family total; every page of every page size, on both pages that read the scope, reads only its own rows by key (familyPagination.pageFamiliesByKeys),
// live, so no row, price or stock is ever cached here and a "hit" needs no refresh. A page step or a jump to a deep page ranks nothing; the first read of a scope ranks once.
//
// The key is the cache layer's own (lib/cacheKey.ts: layer, build, organisation, data epoch, scope, canonical params, versions): the canonical request WITHOUT its page and page size,
// under the products (and stock) version, the promotions version and the Inventory Check version when a check-state set restricts the scope. It is actor-neutral: the ranking never
// reads who asks. Anything that cannot be read (a version, the epoch) means there is no safe key: the ranking is computed and nothing is stored.
//
// Promotion order is time-dependent without any write (a discount window opens at 09:00): the entry stores the next EDGE, the earliest future start or end among the active
// promotion rules and the products' own discount windows, and is not served at or after it. Only results are cached: never a promise, so nothing is shared between requests.

export type RankedWindow = { keys: string[]; total: number; /** UTC 'YYYY-MM-DD HH:MM:SS' of the next promotion boundary, or null when none lies ahead. */ edgeAt: string | null }

export type RankedScope = {
  ctx: { waitUntil(promise: Promise<unknown>): void }
  /** The canonical request of the list; its page and page size are removed to make the key. */
  request: Request
  /** The version vector the entry is valid for, or an unsafe token when one could not be read (then nothing is cached). */
  versions: string
  identity: CacheIdentity
  ttlSeconds: number
}

const utcText = (date: Date): string => date.toISOString().replace('T', ' ').slice(0, 19)
const utcDate = (text: string): number => Date.parse(`${text.replace(' ', 'T')}Z`)

/** The earliest promotion boundary after `now`: the products' own discount windows and the active rules' windows. A bounded read: one pass over discount-enabled products and the rules table. */
export async function nextPromotionEdge(db: D1Compat, now: Date = new Date()): Promise<string | null> {
  const params = { edgeNow: utcText(now) }
  const [products, rules] = await Promise.all([
    db.prepare(`SELECT MIN(CASE WHEN datetime(discount_starts_at) > datetime(@edgeNow) THEN datetime(discount_starts_at) END) AS starts,
        MIN(CASE WHEN datetime(discount_ends_at) > datetime(@edgeNow) THEN datetime(discount_ends_at) END) AS ends
      FROM products WHERE discount_enabled = 1`).get<{ starts: string | null; ends: string | null }>(params),
    db.prepare(`SELECT MIN(CASE WHEN datetime(starts_at) > datetime(@edgeNow) THEN datetime(starts_at) END) AS starts,
        MIN(CASE WHEN datetime(ends_at) > datetime(@edgeNow) THEN datetime(ends_at) END) AS ends
      FROM promotion_rules WHERE is_active = 1`).get<{ starts: string | null; ends: string | null }>(params),
  ])
  const edges = [products?.starts, products?.ends, rules?.starts, rules?.ends].filter((edge): edge is string => typeof edge === 'string' && edge.length > 0)
  return edges.length ? edges.sort()[0] : null
}

const usable = (value: unknown, now: number): value is RankedWindow => {
  const entry = value as RankedWindow | null
  if (!entry || !Array.isArray(entry.keys) || typeof entry.total !== 'number') return false
  return entry.edgeAt === null || (typeof entry.edgeAt === 'string' && now < utcDate(entry.edgeAt))
}

export async function readRankedScope(scope: RankedScope, produce: () => Promise<RankedWindow>, now: () => number = Date.now): Promise<RankedWindow> {
  const url = new URL(scope.request.url)
  url.searchParams.delete('page')
  url.searchParams.delete('pageSize')
  url.searchParams.set('rk_scope', '1')
  const key = await cacheKeyRequest(url.toString(), scope.versions, scope.identity)
  if (key) {
    const hit = await caches.default.match(key)
    if (hit) {
      const value = await hit.json<unknown>()
      if (usable(value, now())) return value
    }
  }
  const window = await produce()
  if (key) {
    const untilEdge = window.edgeAt === null ? Infinity : Math.floor((utcDate(window.edgeAt) - now()) / 1000)
    const ttl = Math.min(scope.ttlSeconds, untilEdge)
    if (ttl > 0) scope.ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(window), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } })))
  }
  return window
}
