// Analytics Engine -- the one cheap place to record an observation.
//
// Everything else in this stack has a budget that matters: D1 rows, KV's
// 1,000 writes/day, R2 operations. Analytics Engine is free with Workers and
// none of those. That makes it the right home for signals worth watching but
// far too frequent to persist anywhere else.
//
// WHAT IS RECORDED
//
// Operational facts only, at low volume: quota zone transitions, import job
// outcomes, backup retention passes. Things you want to look back on when
// something went wrong at 2am.
//
// WHAT IS DELIBERATELY NOT RECORDED
//
// Anything identifying a person, and anything commercially sensitive.
// No customer names, phone numbers, membership numbers or addresses; no
// per-sale amounts; no usernames; no IPs. Analytics Engine is queryable
// outside the app's own permission model, so a figure that lands here has
// effectively left the permission system behind. A coarse role or a job id
// is enough to answer "what happened"; who it happened to belongs in D1,
// behind the permissions that already govern it.
//
// The blob/double split below is the API's own shape: blobs are strings,
// doubles are numbers, and indexes are what you can group by cheaply.

import type { Env } from '../index'

export type AnalyticsEvent = {
  /** What happened, e.g. 'quota_zone' or 'import_job'. Becomes the index. */
  kind: string
  /** Short string facts. Never anything identifying a person. */
  labels?: (string | null | undefined)[]
  /** Numeric facts. Never money. */
  values?: number[]
}

/**
 * Records one data point.
 *
 * Never throws and never rejects: this is called from paths that are already
 * handling something (a quota running low, an import finishing), and an
 * observability call that can fail is a liability in exactly those places.
 * A missing binding -- a local run, or a deploy before the dataset exists --
 * is a silent no-op rather than an error, so nothing depends on it being
 * configured.
 */
export function recordAnalytics(env: Env, event: AnalyticsEvent): void {
  const dataset = env.Business_OS_Analytics
  if (!dataset) return
  try {
    dataset.writeDataPoint({
      indexes: [String(event.kind || 'unknown').slice(0, 96)],
      blobs: (event.labels || [])
        .slice(0, 10)
        .map((label) => String(label ?? '').slice(0, 200)),
      doubles: (event.values || []).slice(0, 10).map((value) => {
        const numeric = Number(value)
        return Number.isFinite(numeric) ? numeric : 0
      }),
    })
  } catch {
    // Intentionally silent -- see the docstring.
  }
}
