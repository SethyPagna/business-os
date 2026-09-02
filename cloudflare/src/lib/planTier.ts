// Free vs Paid Workers plan, read from env.PLAN_TIER ONCE per isolate.
//
// WHY THIS EXISTS
//
// This codebase runs as two deployable configurations of the SAME code:
// wrangler.toml (Paid, current production) and wrangler.free.toml (Free --
// see that file's header for the full platform-ceiling reasoning). The two
// configs differ in wrangler-level settings ([limits], queue consumer
// batch sizes) that this module cannot see or change -- but several
// in-app constants (import chunk sizes, single-pass unit ceilings, backup
// asset-copy caps, image-delete caps) were SIZED against one plan's CPU/
// subrequest budget and silently assumed it. Deploying the Paid-sized
// numbers to a Free account does not just run slower, it throws mid-request
// ("Exceeded CPU Limit") -- see each constant's own comment at its
// definition site (importEngine.ts, backup.ts, system.ts) for the specific
// history. This module is the one place that decides which set of numbers
// is in effect, so those sites read `getPlanLimits(env).xxx` instead of a
// bare literal.
//
// WHY "READ ONCE"
//
// env.PLAN_TIER never changes for the lifetime of a deployed Worker -- it
// is set in wrangler.toml [vars], not user data -- so re-reading it on
// every request would be pure waste. Caching it in a module-level variable
// costs one string compare on the first request per isolate and zero on
// every request after. This is safe specifically BECAUSE PLAN_TIER is a
// deploy-time constant: unlike a per-request value, there is no
// staleness risk to caching it for the isolate's whole lifetime.
//
// WHY THE DEFAULT IS 'paid'
//
// wrangler.toml (production) does not currently set PLAN_TIER at all --
// only the new wrangler.free.toml does. Defaulting an UNSET var to 'free'
// would silently shrink production's chunk sizes and caps the next time an
// isolate cold-starts after this module ships, with no config change and
// no deploy -- exactly the kind of silent behavioural change the project's
// Golden Rules forbid. Defaulting to 'paid' preserves today's behaviour
// for every deployment that does not explicitly opt into 'free'.

import type { Env } from '../index'

export type PlanTier = 'free' | 'paid'

export type PlanLimits = {
  tier: PlanTier

  // importEngine.ts ROWS_PER_IMPORT_CHUNK. How many rows (or, for sales,
  // order_reference GROUPS) runImportAnalyze/runImportApply classify+write
  // per queue invocation. Paid 600 is the current exported constant
  // (A4, session 05: raised 150 -> 600 once cpu_ms=300000 was restored).
  // Free 150 is that same constant's PRE-raise value -- the number the
  // Workers Free plan's 10ms-per-invocation CPU budget was originally
  // measured against, per that constant's own comment.
  rowsPerImportChunk: number

  // importEngine.ts PREFLIGHT_MAX_ROWS. POST /:id/preflight classifies a
  // bounded sample SYNCHRONOUSLY inside one HTTP request (no queue
  // continuation available -- a browser is waiting). Paid 500 is the
  // current exported constant. Free has no recorded prior value for this
  // one (unlike rowsPerImportChunk/stockActionMaxUnits, its comment never
  // mentions being lowered for the Free plan), so this is a CONSERVATIVE
  // ESTIMATE, not a historical figure: scaled by the same ratio the
  // chunk size was (150/600 = 0.25) since preflight does the same
  // per-row classify work as one analyze chunk. Revisit if `wrangler tail`
  // on a Free deployment shows preflight itself hitting the CPU ceiling.
  preflightMaxRows: number

  // importEngine.ts STOCK_ACTION_MAX_UNITS / STOCK_ACTION_MAX_ROWS. Single-
  // pass ceilings for one unified stock-action import (reconcile mode, and
  // the in-memory dispatch window). Paid 480 units / 1920 rows are the
  // current exported constants. Free values are the documented PRE-raise
  // history from two places: wrangler.toml's top-of-file A4 subrequest
  // re-base table ("STOCK_ACTION_MAX_UNITS 60 -> 240 ... MAX_ROWS 480 ->
  // 1920") and the STOCK_ACTION_MAX_UNITS definition site's own comment
  // ("raised from 240 to roughly halve ... dispatch time"). Chaining both:
  // the ORIGINAL Free-era value was 60 units / 480 rows (60 x 8-line
  // receipt ceiling), raised once to 240/1920, then again to 480/1920 once
  // the account moved to Paid. NOTE (found during this audit, not fixed
  // here): STOCK_ACTION_MAX_ROWS's own comment still reads "240 maximum
  // groups x the writer's 8-line receipt ceiling" even though
  // STOCK_ACTION_MAX_UNITS is 480 today -- the two were raised in
  // different passes and the row comment was not updated on the second
  // one. Flagged for a follow-up, not changed here (out of this section's
  // scope, and 1920 is still a safe Paid-side ceiling either way).
  stockActionMaxUnits: number
  stockActionMaxRows: number

  // backup.ts MAX_ASSET_BYTES_PER_BACKUP (misnamed -- it is an ASSET COUNT
  // per run, not a byte count; see its own definition-site comment). Paid
  // 100 is the current exported constant. Free 20 is documented directly
  // on that constant: "this was 20 under the Free plan's older model".
  maxAssetsPerBackup: number

  // system.ts MAX_IMAGE_DELETES_PER_RESET. R2 deletes fired sequentially
  // during a data-reset request. Paid 500 is the current value; that
  // constant's own comment documents the prior Free-era figure directly:
  // "A4 (session 05): 200 -> 500 under the Feb-2026 Paid limits".
  maxImageDeletesPerReset: number

  // Informational only -- mirrors wrangler.toml/wrangler.free.toml's
  // [[queues.consumers]] max_batch_size for the business-os-import queue.
  // Cloudflare enforces the real batching at the platform level from
  // whichever wrangler config was deployed; nothing in application code
  // reads this to change behaviour. Exposed so the admin Server page can
  // show one true tier readout instead of the app half-reflecting its
  // config and half not.
  importQueueMaxBatchSize: number

  // Whether a long, quota-heavy AI or image processing pass may run to
  // completion in one operator-triggered request/session rather than only
  // ever in small scheduled slices. Both plans already run the recurring
  // image-audit sweep and reprocess batches in small, self-continuing
  // steps sized well inside Free's per-invocation budget (see
  // imageAudit.ts's SWEEP_BATCH/REPROCESS_BATCH) -- that part needs no
  // gating on either tier. This flag exists for any FUTURE manual "run it
  // all now" admin action that would otherwise try to do unbounded work in
  // one request; UI for such an action should check this and show the
  // "Not available on the Free plan" notice pattern instead of the action
  // itself when it reads false.
  longAiImagePassesEnabled: boolean

  // D1 free-plan daily ceilings (hard-enforced since Sept 1 2026: queries
  // ERROR once exceeded, until 00:00 UTC). NOT tracked live -- see
  // quotaGuard.ts's "why D1 itself is not counted" section for why no
  // count-in-D1 or count-in-KV scheme is safe here, and what the admin
  // Server page shows instead (the ceiling + a static caution, not a
  // fabricated live number).
  d1DailyRowsReadCeiling: number
  d1DailyRowsWrittenCeiling: number
}

const PAID_LIMITS: PlanLimits = {
  tier: 'paid',
  rowsPerImportChunk: 600,
  preflightMaxRows: 500,
  stockActionMaxUnits: 480,
  stockActionMaxRows: 1920,
  maxAssetsPerBackup: 100,
  maxImageDeletesPerReset: 500,
  importQueueMaxBatchSize: 5,
  longAiImagePassesEnabled: true,
  // Paid D1: 25B reads / 50M writes INCLUDED PER MONTH (not a daily figure
  // the platform enforces) -- there is no Paid daily ceiling to hit at this
  // app's scale, so this is an "effectively unlimited relative to daily
  // usage" figure (monthly ÷ 30) for a single like-for-like admin readout,
  // not a real platform-enforced daily wall the way the Free numbers are.
  d1DailyRowsReadCeiling: 833_000_000,
  d1DailyRowsWrittenCeiling: 1_666_000,
}

const FREE_LIMITS: PlanLimits = {
  tier: 'free',
  rowsPerImportChunk: 150,
  preflightMaxRows: 125,
  stockActionMaxUnits: 60,
  stockActionMaxRows: 480,
  maxAssetsPerBackup: 20,
  maxImageDeletesPerReset: 200,
  importQueueMaxBatchSize: 1,
  longAiImagePassesEnabled: false,
  d1DailyRowsReadCeiling: 5_000_000,
  d1DailyRowsWrittenCeiling: 100_000,
}

// Isolate-local cache -- see the module header for why re-reading
// env.PLAN_TIER per request would be pure waste and why caching it for the
// isolate's lifetime is safe.
let cachedTier: PlanTier | null = null

export function getPlanTier(env: Env): PlanTier {
  if (cachedTier) return cachedTier
  const raw = String((env as unknown as { PLAN_TIER?: string }).PLAN_TIER || '').trim().toLowerCase()
  cachedTier = raw === 'free' ? 'free' : 'paid'
  return cachedTier
}

export function getPlanLimits(env: Env): PlanLimits {
  return getPlanTier(env) === 'free' ? FREE_LIMITS : PAID_LIMITS
}

// Exported so a pure test (scripts/test-plan-tier-pure.cjs) can pin both
// tiers' full numbers without re-deriving them, and so a future call site
// can read a specific tier's limits without a fake Env (e.g. a dry-run
// report script). NOT for use by request-handling code -- that must always
// go through getPlanLimits(env) so it respects the actual deployment.
export const PLAN_LIMITS_BY_TIER: Record<PlanTier, PlanLimits> = {
  paid: PAID_LIMITS,
  free: FREE_LIMITS,
}

// Test-only escape hatch: the isolate cache above is deliberately module-
// level (no env-keyed map) since a real Worker isolate only ever serves one
// deployment's env.PLAN_TIER for its whole lifetime. A test process that
// wants to exercise both tiers in one run needs to clear it between cases.
export function __resetPlanTierCacheForTests(): void {
  cachedTier = null
}
