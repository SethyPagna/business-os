// Free vs Paid Workers plan: ONE place that decides which set of
// plan-sensitive numbers a deployment runs with.
//
// WHY THIS EXISTS
//
// This codebase ships as two deployable configurations of the SAME source:
// wrangler.toml (Paid, current production) and wrangler.free.toml (Free --
// see that file's header for the four config diffs and why they are the
// only ones). The two configs differ in wrangler-level settings ([limits],
// queue consumer batch sizes) that application code can neither see nor
// change -- but a dozen in-app constants (import chunk sizes, single-pass
// unit ceilings, backup asset caps, image-delete caps, retention batch
// sizes) were SIZED against one plan's CPU/subrequest budget and silently
// assumed it. Deploying the Paid-sized numbers onto a Free account does
// not merely run slower, it throws mid-request ("Exceeded CPU Limit" /
// "Too many subrequests"). Each constant's own definition site carries its
// own history; this module is the one place that decides which number is
// in effect, so those sites read `getPlanLimits(env).xxx` instead of a
// bare literal.
//
// RUNTIME-DEPENDENCY-FREE ON PURPOSE
//
// The only import below is `import type { Env }` -- erased at compile time.
// That keeps this module loadable by the pure-test harnesses (which
// hand-roll their own module loaders) without dragging db.ts, Hono, or any
// Workers binding behind it, and guarantees that reading a plan limit can
// never itself perform I/O.
//
// WHY THE DEFAULT IS 'paid', AND WHY THE TIER IS NEVER INFERRED
//
// resolvePlanTier reads env.PLAN_TIER and NOTHING ELSE. It deliberately
// does not infer the tier from which bindings happen to be present: a
// missing IMPORT_QUEUE binding means "this deployment has no queue", which
// is a fact about the binding, not about the account's plan (a Paid
// deployment can lose a binding; Queues are available on Free). Inferring
// would make a single missing binding silently shrink every unrelated
// ceiling. Likewise an UNSET PLAN_TIER resolves to 'paid', not 'free':
// defaulting the other way would shrink production's chunk sizes the next
// time an isolate cold-started after this module shipped, with no config
// change and no deploy -- exactly the silent behavioural change the
// project's Golden Rules forbid.
//
// WHY THE TIER IS READ ONCE PER ISOLATE
//
// env.PLAN_TIER comes from wrangler [vars], not from user data, so it
// cannot change for the lifetime of a deployed Worker. Caching it in a
// module-level variable costs one string compare on the first request per
// isolate and nothing afterwards, and -- unlike a per-request value -- has
// no staleness risk precisely because it is a deploy-time constant.

import type { Env } from '../index'

export type PlanTier = 'free' | 'paid'

/**
 * Every plan-sensitive number in the app, resolved for one deployment.
 *
 * Rule for adding a field: it must have a READER at a call site in this
 * commit. A documented-but-unread limit is a number that drifts silently.
 */
export type PlanLimits = {
  tier: PlanTier

  // ---- Import engine -----------------------------------------------------

  // importEngine.ts ROWS_PER_IMPORT_CHUNK. Rows (or, for sales imports,
  // order_reference GROUPS) that runImportAnalyze/runImportApply classify
  // and write per queue invocation. Paid 600 is the current exported
  // constant (raised 150 -> 600 once [limits] cpu_ms = 300000 was restored
  // on Paid). Free 150 is that same constant's PRE-raise value -- the
  // figure the Free plan's 10 ms-per-invocation CPU budget was originally
  // measured against, per the constant's own comment.
  rowsPerImportChunk: number

  // routes/importJobs.ts POST /import-jobs/:id/preflight classifies a
  // bounded sample SYNCHRONOUSLY inside one HTTP request -- there is no
  // queue continuation available, a browser is waiting. Paid 500 is the
  // value importEngine.ts's PREFLIGHT_MAX_ROWS held (that export had this
  // route as its only reader and moved here). Free 125 is a CONSERVATIVE
  // ESTIMATE, not a historical figure (this constant's comment never
  // records a Free-era value): scaled by the same 150/600 = 0.25 ratio the
  // chunk size was, since preflight does the same per-row classify work as
  // one analyze chunk. The route reports the cap it actually used, so a
  // wrong estimate shows up as an honest "partial" readout rather than a
  // silent truncation.
  preflightMaxRows: number

  // importEngine.ts STOCK_ACTION_MAX_UNITS / STOCK_ACTION_MAX_ROWS.
  // Single-pass ceilings for a RECONCILE stock-action import (its deltas
  // compare every row against ONE live-stock snapshot, so it cannot be
  // windowed across invocations) and the in-memory dispatch window. Paid
  // 480 units / 1920 rows are the current exported constants. Free 60/480
  // is the documented pre-A4 history, chained from two places: wrangler
  // .toml's A4 subrequest re-base table ("STOCK_ACTION_MAX_UNITS 60 ->
  // 240 ... MAX_ROWS 480 -> 1920") and STOCK_ACTION_MAX_UNITS's own
  // comment ("raised from 240 to roughly halve ... dispatch time").
  // 60 units x ~12 subrequests each = ~720, inside Free's 50 EXTERNAL /
  // 1,000 Cloudflare-service subrequest budget.
  stockActionMaxUnits: number
  stockActionMaxRows: number

  // importEngine.ts STOCK_ACTION_ADD_CONCURRENCY / HISTORICAL_SALES_IMPORT
  // _CONCURRENCY. How many independent, idempotently-sealed writes are
  // dispatched at once so a continuation is not dominated by one D1
  // round-trip at a time. Paid 12 is the current exported value. Free 6
  // halves the simultaneous subrequest pressure against Free's much
  // smaller per-invocation budget; both are retry-safe at any concurrency
  // (the seals make redelivery exact), so this is a pressure knob, not a
  // correctness one.
  stockActionAddConcurrency: number
  historicalSalesImportConcurrency: number

  // ---- Bulk delete -------------------------------------------------------

  // bulkDeleteEngine.ts BULK_DELETE_CHUNK_SIZE -- ids per db.batch() call.
  // Paid 500 is the current value. Free 125 is the same 0.25 ratio as the
  // import chunk; runD1BatchInChunks' adaptive halve-and-retry covers a
  // chunk that still overshoots on either plan.
  bulkDeleteChunkSize: number

  // ---- Backup ------------------------------------------------------------

  // backup.ts MAX_ASSET_BYTES_PER_BACKUP (misnamed at its definition site:
  // it is an ASSET COUNT per run, not a byte count). Each asset costs an
  // R2 get() + put() = 2 subrequests. Paid 100 (~200 subrequests) is the
  // current exported constant. Free 20 (~40 subrequests) is documented
  // directly on that constant -- "this was 20 under the Free plan's older
  // model" -- and is what fits Free's 50 external-subrequest ceiling.
  maxAssetsPerBackup: number

  // Whether the 6-hourly CRON may create a full D1 backup.
  //
  // Paid true (today's behaviour, unchanged). Free FALSE: a cron trigger on
  // Free gets the same fixed 10 ms CPU budget as any other invocation, and
  // createCloudflareBackup serialises the whole operational database into
  // one JSON manifest -- unbounded work that cannot be chunked across
  // invocations the way the import phases can. It is also the FIRST of the
  // scheduled steps, so on Free it would burn the tick and starve the
  // retention sweeps behind it (the exact self-reinforcing spiral that took
  // production D1 to ~661 MB -- see index.ts's scheduled() comment). On
  // Free the operator takes backups manually instead, where the browser is
  // waiting and a failure is visible. Retention still runs on every tick on
  // both plans; only CREATING a scheduled backup is refused.
  scheduledBackupEnabled: boolean

  // ---- Data reset --------------------------------------------------------

  // system.ts MAX_IMAGE_DELETES_PER_RESET -- R2 deletes fired SEQUENTIALLY,
  // one subrequest each, inside the reset request.
  //
  // Paid 500: the current value, with today's behaviour unchanged (delete
  // the first 500, report the remainder as still in storage).
  //
  // Free 40, NOT the 200 the pre-A4 Free deployment used. 200 sequential
  // R2 deletes is not a thing a Free invocation can do at all: Free allows
  // 50 EXTERNAL subrequests per invocation, so a 200-delete loop dies
  // partway through with the D1 half already committed. 40 leaves room for
  // the reset's own D1 work inside that ceiling. And because a Free reset
  // cannot silently leave a large image set behind, routes/system.ts
  // REFUSES an includeImages reset whose image set exceeds this cap rather
  // than truncating it -- see that route's PLAN_FREE_RESET_IMAGES_REFUSAL.
  maxImageDeletesPerReset: number

  // ---- Retention sweeps (scheduled) --------------------------------------

  // importRetention.ts IMPORT_RETENTION_MAX_JOBS_PER_TIER -- jobs pruned
  // per tier per 6-hourly tick. Paid 20 is the current value. Free 5 keeps
  // one tick's D1/R2 work inside the 10 ms cron budget; the sweep simply
  // continues on later ticks until it reaches steady state, which is
  // already how it is designed to drain a backlog.
  importRetentionMaxJobsPerTier: number

  // ephemeralRetention.ts DELETE_BATCH -- rows per bounded DELETE ... IN
  // (SELECT ... LIMIT n) statement. Paid 5000 is the current value. Free
  // 1000 keeps a single statement well inside both the 10 ms budget and
  // Free's 100,000 rows-written-per-day D1 ceiling (a full-size sweep at
  // 5000/statement can spend a noticeable slice of that daily budget on
  // log pruning alone).
  ephemeralDeleteBatch: number

  // ---- Admin diagnostics -------------------------------------------------

  // routes/runtime.ts GET /catalog-integrity scans every active product
  // across six text fields with no LIMIT. Paid 50000 comfortably covers the
  // whole live catalog (low thousands) inside the 5-minute budget. Free
  // 2000 is a conservative estimate of what the 10 ms budget can scan and
  // score; over it the route REFUSES with an explicit code rather than
  // returning a partial integrity report, because a catalog-integrity
  // answer that silently skipped rows is worse than no answer.
  catalogIntegrityMaxProducts: number

  // ---- Documented platform facts (no behavioural reader) -----------------
  //
  // These four are REPORTED, not enforced: the tier readout on
  // /api/runtime/version, /api/auth/bootstrap and the integration doctor
  // surfaces them so an operator can see which wall this deployment is
  // standing next to. They are facts about the platform, verified against
  // developers.cloudflare.com on 2026-09-14, not knobs.

  // D1 rows read / written per day. Free's two are HARD: since Sept 1 2026
  // queries ERROR once either is exceeded, until 00:00 UTC. Paid has no
  // daily wall at all -- its included allowance is monthly (25B reads /
  // 50M writes) and overage is billed, not blocked -- so the Paid figures
  // here are that monthly allowance divided by 30, purely so the readout
  // compares like with like. Do not treat the Paid numbers as a cliff.
  d1DailyRowsRead: number
  d1DailyRowsWritten: number

  // Maximum size of ONE D1 database. Free 500 MB, Paid 10 GB. Load-bearing
  // for the free/paid choice: production's operational DB was last measured
  // at ~92 MB, but import staging alone peaked at ~431 MB before it was
  // split into the business-os-import database -- i.e. a Free deployment
  // would have been within ~14% of the wall on the staging DB alone.
  d1MaxDatabaseBytes: number

  // D1 queries per Worker invocation.
  //
  // ASSUMPTION, stated because it is the most load-bearing unknown in this
  // whole split: Cloudflare's own docs disagree with themselves here (the
  // D1 limits page and the Workers platform page give 50 and 1000 for the
  // Free plan). This module assumes the CONSERVATIVE 50 for Free, because
  // sizing against 1000 and being wrong means production requests failing,
  // while sizing against 50 and being wrong means only that a Free
  // deployment is more chunked than it strictly had to be. Every Free
  // figure above is chosen to keep a single invocation's query count well
  // under 50. Settling this needs a throwaway Worker on an actual FREE
  // account plus `wrangler tail` -- a deploy, and therefore an owner
  // decision. Until then: 50.
  d1QueriesPerInvocation: number
}

const PAID_LIMITS: PlanLimits = {
  tier: 'paid',
  rowsPerImportChunk: 600,
  preflightMaxRows: 500,
  stockActionMaxUnits: 480,
  stockActionMaxRows: 1920,
  stockActionAddConcurrency: 12,
  historicalSalesImportConcurrency: 12,
  bulkDeleteChunkSize: 500,
  maxAssetsPerBackup: 100,
  scheduledBackupEnabled: true,
  maxImageDeletesPerReset: 500,
  importRetentionMaxJobsPerTier: 20,
  ephemeralDeleteBatch: 5000,
  catalogIntegrityMaxProducts: 50_000,
  d1DailyRowsRead: 833_000_000,
  d1DailyRowsWritten: 1_666_000,
  d1MaxDatabaseBytes: 10 * 1024 * 1024 * 1024,
  d1QueriesPerInvocation: 1000,
}

const FREE_LIMITS: PlanLimits = {
  tier: 'free',
  rowsPerImportChunk: 150,
  preflightMaxRows: 125,
  stockActionMaxUnits: 60,
  stockActionMaxRows: 480,
  stockActionAddConcurrency: 6,
  historicalSalesImportConcurrency: 6,
  bulkDeleteChunkSize: 125,
  maxAssetsPerBackup: 20,
  scheduledBackupEnabled: false,
  maxImageDeletesPerReset: 40,
  importRetentionMaxJobsPerTier: 5,
  ephemeralDeleteBatch: 1000,
  catalogIntegrityMaxProducts: 2000,
  d1DailyRowsRead: 5_000_000,
  d1DailyRowsWritten: 100_000,
  d1MaxDatabaseBytes: 500 * 1024 * 1024,
  d1QueriesPerInvocation: 50,
}

/**
 * Both tiers' complete tables.
 *
 * Exported so a pure test can pin every number without re-deriving it, and
 * so a report/dry-run script can read a specific tier without inventing a
 * fake Env. NOT for request-handling code -- that must go through
 * getPlanLimits(env) so it respects the deployment it is actually running
 * in.
 */
export const PLAN_LIMITS_BY_TIER: Record<PlanTier, PlanLimits> = {
  paid: PAID_LIMITS,
  free: FREE_LIMITS,
}

// Isolate-local cache; see the module header for why this is safe.
let cachedTier: PlanTier | null = null

/**
 * The tier this deployment is running as.
 *
 * Reads env.PLAN_TIER only. Anything that is not exactly 'free'
 * (case- and whitespace-insensitively) is 'paid', including unset,
 * empty, misspelled and garbage values -- see the module header.
 */
export function resolvePlanTier(env: Env): PlanTier {
  if (cachedTier) return cachedTier
  const raw = String((env as Env | null | undefined)?.PLAN_TIER ?? '').trim().toLowerCase()
  cachedTier = raw === 'free' ? 'free' : 'paid'
  return cachedTier
}

/** The limit table in effect for this deployment. */
export function getPlanLimits(env: Env): PlanLimits {
  return PLAN_LIMITS_BY_TIER[resolvePlanTier(env)]
}

/**
 * Test-only escape hatch.
 *
 * The cache above is deliberately a bare module-level variable (not an
 * env-keyed map) because a real isolate only ever serves one deployment's
 * PLAN_TIER for its whole life. A test process that exercises BOTH tiers in
 * one run has to clear it between cases.
 */
export function __resetPlanTierCacheForTests(): void {
  cachedTier = null
}
