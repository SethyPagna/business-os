// Free-tier quota guard.
//
// Every Cloudflare product this app uses has a free ceiling, and they are not
// equally generous. The failure mode that matters is not "we got billed" --
// there is no billing on the free plan -- it is that an exhausted quota makes
// writes SILENTLY FAIL, and a silent failure in a cache-invalidation path
// serves stale data to a shop that thinks it is looking at live stock.
//
// Measured ceilings (per Cloudflare's free plan):
//
//   KV     100,000 reads/day  |  1,000 writes/day  |  1 GB  |  1 write/sec/key
//   D1     5,000,000 rows read/day  |  100,000 rows written/day  |  5 GB
//   R2     1,000,000 class A (write/list)/mo  |  10,000,000 class B (read)/mo
//          |  10 GB  |  egress free
//
// KV writes are by far the tightest: 1,000/day is two orders of magnitude
// below D1's, and this app calls bumpVersion (a KV write) on essentially
// every product, sale, inventory and branch mutation from 31 call sites. A
// moderately busy shop can exhaust a day's KV write budget before lunch, and
// the per-key limit of one write per second is reached sooner still, since
// every product mutation writes the SAME key.
//
// So this module does three things:
//   1. counts usage against the ceiling, in D1 (which has budget to spare)
//   2. exposes a SAFE ZONE well below the limit, so degradation starts while
//      there is still headroom rather than at the cliff edge
//   3. tells the caller which zone it is in, so the caller can choose a
//      fallback instead of just failing
//
// It deliberately does not track D1 itself. Tracking D1 writes would require
// a D1 write per D1 write, which is self-defeating; D1's own ceiling is
// generous enough relative to this app's volume that the scarce resources are
// the ones worth policing.

import type { Env } from '../index'
import { getDb } from './db'

export type QuotaResource = 'kv_write' | 'r2_class_a'

export type QuotaZone =
  // Plenty of headroom -- proceed normally.
  | 'ok'
  // Past the safe zone. Non-essential work should start backing off.
  | 'warn'
  // Close to the ceiling. Only work that would cause incorrect behaviour if
  // skipped should still proceed.
  | 'critical'
  // At or past the ceiling. Nothing more may be spent this window.
  | 'exhausted'

type QuotaLimit = {
  /** Ceiling for the window. */
  limit: number
  /** 'day' resets at UTC midnight; 'month' on the 1st. */
  window: 'day' | 'month'
}

const LIMITS: Record<QuotaResource, QuotaLimit> = {
  kv_write: { limit: 1000, window: 'day' },
  r2_class_a: { limit: 1_000_000, window: 'month' },
}

// Deliberately conservative. The point of a safe zone is to change behaviour
// while there is still room to recover, not to confirm the wall after hitting
// it -- and usage is counted per isolate-batch, so the real figure can be
// slightly ahead of the recorded one.
const WARN_RATIO = 0.7
const CRITICAL_RATIO = 0.9

export function windowKeyFor(window: 'day' | 'month', now = new Date()): string {
  const iso = now.toISOString()
  return window === 'day' ? iso.slice(0, 10) : iso.slice(0, 7)
}

export function zoneFor(used: number, limit: number): QuotaZone {
  if (limit <= 0) return 'ok'
  const ratio = used / limit
  if (ratio >= 1) return 'exhausted'
  if (ratio >= CRITICAL_RATIO) return 'critical'
  if (ratio >= WARN_RATIO) return 'warn'
  return 'ok'
}

export type QuotaStatus = {
  resource: QuotaResource
  used: number
  limit: number
  remaining: number
  zone: QuotaZone
  /** False once the ceiling is reached -- the caller must take its fallback. */
  allowed: boolean
}

function buildStatus(resource: QuotaResource, used: number): QuotaStatus {
  const { limit } = LIMITS[resource]
  const zone = zoneFor(used, limit)
  return {
    resource,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    zone,
    allowed: zone !== 'exhausted',
  }
}

/**
 * Records `amount` units of `resource` and returns the resulting status.
 *
 * Counting is best-effort on purpose: if the counter itself fails, the answer
 * is "allowed", not "blocked". A guard that takes the app down when its own
 * bookkeeping breaks is worse than the quota it was protecting against --
 * the whole point is to degrade gracefully, and refusing everything because
 * a COUNT query failed is the opposite of that.
 */
export async function consumeQuota(env: Env, resource: QuotaResource, amount = 1): Promise<QuotaStatus> {
  const { window } = LIMITS[resource]
  const windowKey = windowKeyFor(window)
  try {
    const db = getDb(env)
    await db.prepare(`
      INSERT INTO quota_usage (resource, window_key, used, updated_at)
      VALUES (@resource, @windowKey, @amount, CURRENT_TIMESTAMP)
      ON CONFLICT(resource, window_key)
      DO UPDATE SET used = used + @amount, updated_at = CURRENT_TIMESTAMP
    `).run({ resource, windowKey, amount })
    const row = await db
      .prepare(`SELECT used FROM quota_usage WHERE resource = @resource AND window_key = @windowKey`)
      .get<{ used: number }>({ resource, windowKey })
    return buildStatus(resource, Number(row?.used || 0))
  } catch {
    return { ...buildStatus(resource, 0), zone: 'ok', allowed: true }
  }
}

/** Reads current usage without recording any. */
export async function readQuota(env: Env, resource: QuotaResource): Promise<QuotaStatus> {
  const { window } = LIMITS[resource]
  try {
    const db = getDb(env)
    const row = await db
      .prepare(`SELECT used FROM quota_usage WHERE resource = @resource AND window_key = @windowKey`)
      .get<{ used: number }>({ resource, windowKey: windowKeyFor(window) })
    return buildStatus(resource, Number(row?.used || 0))
  } catch {
    return buildStatus(resource, 0)
  }
}

/** Every tracked resource at once, for the admin health readout. */
export async function readAllQuotas(env: Env): Promise<QuotaStatus[]> {
  return Promise.all((Object.keys(LIMITS) as QuotaResource[]).map((resource) => readQuota(env, resource)))
}
