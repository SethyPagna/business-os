// Plan-aware quota guard.
//
// (Named "free-tier" originally because the ceilings it enforced were the
// Free plan's, on both plans. The ceilings now come from planTier.ts, so a
// Paid deployment is measured against the Paid allowance -- see the
// LIMITS table below and PLAN_LIMITS_BY_TIER's kvWritesPerDay.)
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
//
// UPDATE (Section 8b, plan-tier work): D1's Free ceiling (5,000,000 rows
// read/day, 100,000 rows written/day) became HARD-ENFORCED on Sept 1 2026 --
// queries now ERROR once exceeded, until 00:00 UTC, instead of just costing
// money. That makes it worth a second look, but the "self-defeating" problem
// above still holds for a live D1-write-based counter, and the two
// alternatives considered and rejected were:
//   - Counting in KV instead of D1: KV's OWN ceiling (1,000 writes/day) is
//     the tightest resource this module protects; spending it on a counter
//     for a DIFFERENT resource's usage would make KV run out faster, not
//     free up D1.
//   - Aggregating rows_read/rows_written from D1 result `.meta` at a few
//     high-volume call sites into Analytics Engine (recordAnalytics, which
//     is genuinely free to write): writing is fine, but READING it back
//     requires Cloudflare's separate Analytics Engine SQL API (an API
//     token, not the binding this Worker holds) -- there is no way for the
//     Worker itself to read back what it wrote, so this would produce
//     numbers nobody inside the app could ever display.
// So D1 gets the same treatment as every other resource this module
// DELIBERATELY does not meter: planTier.ts documents the Free/Paid ceiling
// as static facts (d1DailyRowsReadCeiling/d1DailyRowsWrittenCeiling), and
// routes/compat.ts's GET /system/bootstrap surfaces that ceiling plus a
// plain-language caution to the admin Server page -- an honest "here is the
// wall and here is what to watch for" instead of a fabricated live count.

import type { Env } from '../index'
import { getDb } from './db'
import { getPlanLimits, type PlanLimits } from './planTier'
import { recordAnalytics } from './analytics'

export type QuotaResource = 'kv_write' | 'r2_class_a' | 'cf_images_transform' | 'cloudinary_transform'

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
  /** 'day' resets at UTC midnight; 'month' on the 1st. */
  window: 'day' | 'month'
  /**
   * Which PlanLimits field carries this resource's ceiling. The NUMBERS
   * live in planTier.ts (PLAN_LIMITS_BY_TIER) because they differ by plan;
   * this module keeps only the reset window, which is a property of the
   * product rather than the plan.
   */
  tierField: NumericQuotaField
}

type NumericQuotaField = 'kvWritesPerDay' | 'r2ClassAPerMonth' | 'imagesTransformsPerMonth' | 'cloudinaryTransformsPerMonth'

// The ceilings the entries below resolve to, and why each is what it is,
// are documented at their definition sites in planTier.ts. Free's numbers
// are exactly the ones this table used to hard-code; Paid raises kv_write
// (1,000,000 writes/month included, divided by 30 for a daily budget) and
// leaves the other three equal, because R2 and the two image services bill
// independently of the Workers plan.
const LIMITS: Record<QuotaResource, QuotaLimit> = {
  kv_write: { window: 'day', tierField: 'kvWritesPerDay' },
  r2_class_a: { window: 'month', tierField: 'r2ClassAPerMonth' },
  // Cloudflare Images free plan: 5,000 UNIQUE transformations/month, counted
  // per source+parameters. Exceeding it returns error 9422 and is never
  // charged, so this budget protects capability rather than money -- once
  // spent, no new size or format can be produced until the month rolls over.
  cf_images_transform: { window: 'month', tierField: 'imagesTransformsPerMonth' },
  // Cloudinary free plan: 25 credits/month, ~1,000 transformations per
  // credit. Tracked as transformations so the two providers are directly
  // comparable in the same units.
  cloudinary_transform: { window: 'month', tierField: 'cloudinaryTransformsPerMonth' },
}

// The running deployment's ceiling for one resource. Every caller below
// already holds an Env, so this resolves the real tier rather than the
// cached one.
function ceilingFor(env: Env, resource: QuotaResource): number {
  const limits: PlanLimits = getPlanLimits(env)
  return limits[LIMITS[resource].tierField]
}

// Deliberately conservative. The point of a safe zone is to change behaviour
// while there is still room to recover, not to confirm the wall after hitting
// it -- and usage is counted per isolate-batch, so the real figure can be
// slightly ahead of the recorded one.
const WARN_RATIO = 0.7
const CRITICAL_RATIO = 0.9

// Last zone reported per resource, isolate-local -- enough to collapse a
// storm of identical transitions without any shared state to coordinate.
const lastReportedZone = new Map<QuotaResource, QuotaZone>()

export function windowKeyFor(window: 'day' | 'month', now = new Date()): string {
  const iso = now.toISOString()
  return window === 'day' ? iso.slice(0, 10) : iso.slice(0, 7)
}

// Transformations held back from IMAGE work so video always has some.
//
// Video transcodes are far rarer than image ones but far more expensive to go
// without: an image that misses its optimisation pass is merely larger than
// ideal and gets picked up by the next sweep, whereas a video that cannot be
// processed is a feature that does not work. Left to compete freely, the
// 6-hourly image sweep would spend the whole month's allowance in its first
// day or two -- it has thousands of candidates and video has a handful.
//
// So image callers ask for the RESERVED zone, which treats the ceiling as
// (limit - reserve) and therefore reaches 'exhausted' early, leaving the
// remainder untouched for video.
const VIDEO_RESERVE: Partial<Record<QuotaResource, number>> = {
  cf_images_transform: 500,   // of 5,000
  cloudinary_transform: 2500, // of 25,000
}

/**
 * Zone as seen by a caller that must leave the video reserve alone.
 *
 * Same thresholds, applied against the reduced ceiling -- so an image sweep
 * backs off while the real quota still has room, and a video request later
 * that day still finds budget.
 *
 * The reserve is a fixed count, not a ratio, so on Paid (where kv_write has
 * a larger ceiling) it stays the same absolute cushion for video.
 */
export function reservedZoneFor(env: Env, resource: QuotaResource, used: number): QuotaZone {
  const limit = ceilingFor(env, resource)
  const reserve = VIDEO_RESERVE[resource] || 0
  return zoneFor(used, Math.max(1, limit - reserve))
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
  /** Zone for callers that must leave the video reserve untouched. */
  reservedZone: QuotaZone
  /** False once the ceiling is reached -- the caller must take its fallback. */
  allowed: boolean
}

function buildStatus(env: Env, resource: QuotaResource, used: number): QuotaStatus {
  const limit = ceilingFor(env, resource)
  const zone = zoneFor(used, limit)
  return {
    resource,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    zone,
    // What an image caller should read: the same thresholds against a
    // ceiling reduced by the video reserve, so image work stops early and
    // leaves the remainder for video.
    reservedZone: reservedZoneFor(env, resource, used),
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
    const status = buildStatus(env, resource, Number(row?.used || 0))
    // Only the moment a zone CHANGES, not every consumption. The point is to
    // be able to answer "when did we start running out" without writing a
    // data point on every mutation -- and Analytics Engine is the only store
    // here where recording it does not itself consume a scarce budget.
    if (status.zone !== 'ok' && status.zone !== lastReportedZone.get(resource)) {
      lastReportedZone.set(resource, status.zone)
      recordAnalytics(env, {
        kind: 'quota_zone',
        labels: [resource, status.zone, windowKey],
        values: [status.used, status.limit],
      })
    }
    return status
  } catch {
    return { ...buildStatus(env, resource, 0), zone: 'ok', allowed: true }
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
    return buildStatus(env, resource, Number(row?.used || 0))
  } catch {
    return buildStatus(env, resource, 0)
  }
}

/** Every tracked resource at once, for the admin health readout. */
export async function readAllQuotas(env: Env): Promise<QuotaStatus[]> {
  return Promise.all((Object.keys(LIMITS) as QuotaResource[]).map((resource) => readQuota(env, resource)))
}
