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
// BOTH configs now pin the var explicitly -- wrangler.toml sets
// PLAN_TIER = "paid" and wrangler.free.toml sets "free" -- so the default
// only ever applies to a deployment that forgot to, to `wrangler dev`
// against a hand-rolled env, and to the pure-test harnesses. Defaulting an
// UNSET var to 'free' would silently shrink production's chunk sizes and
// caps the next time an isolate cold-starts, with no config change and no
// deploy -- exactly the kind of silent behavioural change the project's
// Golden Rules forbid. Defaulting to 'paid' preserves today's behaviour
// for every deployment that does not explicitly opt into 'free'.
// (Earlier revisions of this header said wrangler.toml "does not currently
// set PLAN_TIER at all"; it does, at its [vars] block -- corrected here so
// the two files cannot be read as disagreeing.)
//
// PLATFORM LIMITS EVERY NUMBER BELOW RESPECTS (verified Sept 2 2026 against
// Cloudflare's own docs, cited per field):
//   - Workers CPU time per request: Free 10 ms, Paid 5 min max / 30 s
//     default, raised here to the 5-minute maximum by wrangler.toml's
//     [limits] cpu_ms = 300000. https://developers.cloudflare.com/workers/platform/limits/#cpu-time
//   - Subrequests per invocation: Free 50 external / 1,000 to Cloudflare
//     services; Paid 10,000 by default (raisable to 10M), pinned
//     explicitly in wrangler.toml's [limits] subrequests.
//     https://developers.cloudflare.com/workers/platform/limits/#subrequests
//   - D1: 100 bound parameters per statement and a 100 KB statement length
//     (both are workerd's own sqlite3_limit() values --
//     SQLITE_LIMIT_VARIABLE_NUMBER = 100, SQLITE_LIMIT_SQL_LENGTH = 100000
//     in src/workerd/util/sqlite.c++ -- and are therefore PLAN-INDEPENDENT;
//     they are recorded here as facts, not as a tier difference).
//   - D1 daily row read/write ceilings: Free hard-enforced since Sept 1
//     2026 (queries ERROR until 00:00 UTC); Paid is a monthly included
//     allowance, not a daily wall.
//     https://developers.cloudflare.com/d1/platform/pricing/
//   - Workers KV: Free 1,000 writes/day (hard); Paid 1 million writes per
//     MONTH included, then $5.00/million -- a billing threshold, not a wall.
//     https://developers.cloudflare.com/workers/platform/pricing/
//   - R2: 1 million Class A operations per month free, on BOTH plans (R2's
//     free tier is its own, independent of the Workers plan).
//     https://developers.cloudflare.com/r2/pricing/

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

  // importEngine.ts MATERIALIZE_ROWS_PER_CHUNK. How many CSV rows one
  // materialize window parses + INSERT OR REPLACEs per queue invocation.
  // Cheaper per row than an analyze/apply chunk (no classify, no image
  // match, no branch resolution), which is why it is a separate number.
  // Paid 600 is the current constant; that constant's own comment records
  // the Free-era figure directly -- "This was held at 100 for the old
  // Workers Free 10ms CPU limit" -- so Free 100 is documented history, not
  // an estimate. Platform limit respected: Workers CPU time per invocation
  // (Free 10 ms / Paid 300,000 ms via [limits] cpu_ms).
  materializeRowsPerChunk: number

  // importEngine.ts D1_IMPORT_BATCH_CHUNK_SIZE -- STATEMENTS per db.batch()
  // call, not rows (a products row is 1-3 statements). db.batch() is ONE
  // atomic SQLite transaction, so an unbounded batch hits D1's own
  // per-transaction CPU budget ("D1_ERROR: D1 DB exceeded its CPU time
  // limit and was reset"). Paid 300 is the current constant and the figure
  // the 11,896-row import was measured against. Free 100 keeps a batch's
  // build cost (real synchronous JS in the Worker: 300 prepared statements
  // with their bound params) inside Free's 10 ms per-invocation CPU
  // budget. Platform limits respected: D1's per-transaction CPU budget
  // (plan-independent) AND the Worker CPU budget that builds the batch.
  d1BatchChunkStatements: number

  // importEngine.ts STOCK_ACTION_CLASSIFY_WINDOW / STOCK_ACTION_DISPATCH_READ
  // -- direct-mode continuation (M4) window sizes: how many rows one
  // invocation classifies, and how many previously-classified units it
  // reads back to dispatch. Paid 480 / 400 are M4's own proven values,
  // deliberately NOT raised by the A4 subrequest re-base (they are sized by
  // continuation-state blob growth and per-window write batching, not by
  // the platform limits that changed) -- so Paid keeps them exactly.
  // Free 120 / 100 is the same 0.25 ratio the analyze/apply chunk uses
  // between the two tiers, for the same reason: the per-window classify and
  // dispatch work is synchronous JS against a 10 ms budget instead of a
  // 300,000 ms one. Platform limit respected: Workers CPU time.
  stockActionClassifyWindow: number
  stockActionDispatchRead: number

  // importEngine.ts STOCK_ACTION_ADD_CONCURRENCY and
  // HISTORICAL_SALES_IMPORT_CONCURRENCY -- how many independent, idempotently
  // sealed writes are dispatched CONCURRENTLY inside one invocation. Each
  // in-flight write is one subrequest to D1, so the ceiling is the
  // subrequest budget, not CPU: Paid has 10,000 per invocation (pinned in
  // wrangler.toml's [limits]), Free has 1,000 to Cloudflare services and
  // only 50 external. Paid 12 is the current constant, unchanged. Free 4
  // keeps a window's concurrent fan-out well inside Free's much tighter
  // budget while still beating one-at-a-time round trips.
  stockActionAddConcurrency: number
  historicalSalesImportConcurrency: number

  // backup.ts TABLE_PAGE_SIZE -- rows read per page while streaming a table
  // into the backup document (never a whole table; the peak-memory bound).
  // Paid 500 is the current constant. Free 200 keeps both the D1 rows-read
  // draw per invocation and the JSON serialisation work per page smaller,
  // against Free's hard 5,000,000 rows-read/day ceiling and 10 ms CPU.
  backupTablePageSize: number

  // backup.ts's restore path CHUNK -- INSERT statements per db.batch() while
  // restoring rows table by table. Same D1-transaction-CPU reasoning as
  // d1BatchChunkStatements above; Paid 80 is the current value (deliberately
  // small already, since a restore row can be very wide), Free 40 halves it.
  backupRestoreRowsPerBatch: number

  // routes/importJobs.ts MAX_IMAGES_PER_REQUEST -- images accepted in ONE
  // multipart upload request. Every image is at least one R2 put, i.e. one
  // subrequest, plus its D1 bookkeeping. Paid 200 is the current constant
  // and ~2% of the 10,000-subrequest budget. Free 40 stays inside Free's
  // 1,000-subrequest-to-Cloudflare-services budget with room for the rest
  // of the request's D1 work. Platform limit respected: subrequests per
  // invocation.
  maxImagesPerImportRequest: number

  // quotaGuard.ts's LIMITS table. Before this became tier-aware, the FREE
  // ceilings below were hard-coded and applied on Paid too -- so a Paid
  // deployment started backing off image work at 700 KV writes/day (70% of
  // Free's 1,000) even though Paid includes a million writes a MONTH. That
  // is the single clearest case of Paid not using its headroom.
  //   kvWritesPerDay: Free 1,000/day is a hard wall (further writes fail).
  //     Paid includes 1,000,000/month, then $5.00/million -- there is no
  //     daily wall, so the Paid figure here is that monthly allowance
  //     divided by 30 and used as a per-day budget, the same convention
  //     d1DailyRows*Ceiling already uses. Crossing it costs money, not
  //     correctness, which is why the guard still exists on Paid.
  //   r2ClassAPerMonth: R2's free tier is 1,000,000 Class A ops/month on
  //     BOTH plans (R2 bills independently of the Workers plan), so this is
  //     deliberately EQUAL on the two tiers rather than raised.
  //   imagesTransformsPerMonth / cloudinaryTransformsPerMonth: Cloudflare
  //     Images and Cloudinary are separate subscriptions, not part of the
  //     Workers plan -- also deliberately equal on both tiers.
  kvWritesPerDay: number
  r2ClassAPerMonth: number
  imagesTransformsPerMonth: number
  cloudinaryTransformsPerMonth: number

  // Platform facts, reported by GET /api/system/plan so the admin readout
  // states the real ceiling instead of the app half-knowing it. Nothing
  // branches on these.
  //   cpuMsPerInvocation: Free 10 ms (fixed); Paid = wrangler.toml's
  //     [limits] cpu_ms = 300000 (the 5-minute maximum; the Paid default
  //     without that key is 30,000).
  //   subrequestsPerInvocation: Free 1,000 to Cloudflare services (50
  //     external); Paid = wrangler.toml's [limits] subrequests = 10,000.
  cpuMsPerInvocation: number
  subrequestsPerInvocation: number

  // PLAN-INDEPENDENT D1/SQLite facts, identical on both tiers -- recorded
  // here so the one plan readout is complete and so a future edit cannot
  // quietly model them as a tier difference. d1MaxBoundParams mirrors
  // lib/sqlBinding.ts's D1_MAX_BOUND_PARAMS, which stays the authority for
  // chunking IN lists (test-plan-tier-matrix-pure.cjs pins the two
  // together). Both come from workerd's own sqlite3_limit() calls:
  // SQLITE_LIMIT_VARIABLE_NUMBER = 100, SQLITE_LIMIT_SQL_LENGTH = 100000.
  d1MaxBoundParams: number
  d1MaxSqlLengthBytes: number

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
  materializeRowsPerChunk: 600,
  d1BatchChunkStatements: 300,
  stockActionClassifyWindow: 480,
  stockActionDispatchRead: 400,
  stockActionAddConcurrency: 12,
  historicalSalesImportConcurrency: 12,
  backupTablePageSize: 500,
  backupRestoreRowsPerBatch: 80,
  maxImagesPerImportRequest: 200,
  // 1,000,000 KV writes included per month on Paid, ÷ 30 for a per-day
  // budget (same convention as the D1 figures below). Not a wall: past it
  // Cloudflare bills $5.00/million rather than failing writes.
  kvWritesPerDay: 33_333,
  // R2's own free tier, identical on both Workers plans.
  r2ClassAPerMonth: 1_000_000,
  // Separate subscriptions, not part of the Workers plan -- equal on both.
  imagesTransformsPerMonth: 5_000,
  cloudinaryTransformsPerMonth: 25_000,
  // wrangler.toml [limits] cpu_ms = 300000 / subrequests = 10_000.
  cpuMsPerInvocation: 300_000,
  subrequestsPerInvocation: 10_000,
  // Plan-independent workerd sqlite3_limit() values.
  d1MaxBoundParams: 100,
  d1MaxSqlLengthBytes: 100_000,
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
  materializeRowsPerChunk: 100,
  d1BatchChunkStatements: 100,
  stockActionClassifyWindow: 120,
  stockActionDispatchRead: 100,
  stockActionAddConcurrency: 4,
  historicalSalesImportConcurrency: 4,
  backupTablePageSize: 200,
  backupRestoreRowsPerBatch: 40,
  maxImagesPerImportRequest: 40,
  // Free's hard daily wall: further KV writes FAIL once it is reached.
  kvWritesPerDay: 1_000,
  // Deliberately EQUAL to Paid -- R2 and the two image services bill
  // independently of the Workers plan (see the type's comments).
  r2ClassAPerMonth: 1_000_000,
  imagesTransformsPerMonth: 5_000,
  cloudinaryTransformsPerMonth: 25_000,
  // Free's fixed CPU ceiling, and its subrequest budget to Cloudflare
  // services (external fetches are capped far lower still, at 50).
  cpuMsPerInvocation: 10,
  subrequestsPerInvocation: 1_000,
  // Plan-independent -- identical to Paid on purpose.
  d1MaxBoundParams: 100,
  d1MaxSqlLengthBytes: 100_000,
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

// The tier ALREADY resolved for this isolate, for the handful of helpers
// that legitimately have no Env in hand.
//
// WHY THIS EXISTS, AND WHY IT IS NOT A BACK DOOR
//
// importEngine.ts's runD1BatchInChunks / runD1BatchGroupsInChunks take a
// D1Compat and a statement list, not an Env -- deliberately, since they are
// pure batching helpers called from ~20 sites across importEngine.ts AND
// bulkDeleteEngine.ts. Threading an Env through every one of those callers
// to size a chunk would be a far larger change than the sizing itself, and
// bulkDeleteEngine.ts is not this section's file to rewrite.
//
// Every path that reaches those helpers enters the Worker through a request
// or a queue message and resolves the tier FIRST (runImportAnalyze /
// runImportApply / the routes each call getPlanLimits(env) at the top), so
// by the time a batch is built the isolate cache is warm and this returns
// the real tier's numbers.
//
// The fallback when nothing has resolved a tier yet is PAID -- identical to
// the behaviour before any of this existed. So the worst case is a Free
// deployment briefly using a Paid-sized chunk, never a Paid deployment
// silently shrinking: the same asymmetry getPlanTier's own default is built
// on. Request-handling code that HAS an Env must still use getPlanLimits(env).
export function getCachedPlanLimits(): PlanLimits {
  return cachedTier === 'free' ? FREE_LIMITS : PAID_LIMITS
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

// One notice per limit that is SMALLER (or a capability that is off) on the
// running tier than it would be on Paid.
//
// DERIVED, never hand-written: the whole point of "Free degrades visibly"
// is that a person can see, in the admin app, every place the app is doing
// less work per pass than it would on Paid. A hand-maintained list would
// silently go stale the first time someone adds a limit to the table above
// and forgets the list -- which is exactly the failure this section exists
// to stop. So the notices are computed by diffing FREE_LIMITS against
// PAID_LIMITS field by field; adding a field to PlanLimits automatically
// adds its notice, and a field that is deliberately EQUAL on both tiers
// (r2ClassAPerMonth, the two image-transform budgets, the plan-independent
// D1/SQLite facts) produces no notice at all, which is the honest answer.
//
// `id` is a stable key, not display copy: the Worker holds no UI language
// (the admin app translates it in both packs, see
// frontend/src/utils/planTier.ts). `paid`/`free` carry the two values so
// the notice can state the real numbers without the client re-deriving
// them.
export type PlanNotice = {
  id: keyof PlanLimits
  kind: 'smaller' | 'disabled'
  free: number | boolean
  paid: number | boolean
}

export function getPlanNotices(tier: PlanTier): PlanNotice[] {
  // Paid IS the headroom baseline -- nothing to report against itself.
  if (tier !== 'free') return []
  const notices: PlanNotice[] = []
  for (const key of Object.keys(PAID_LIMITS) as Array<keyof PlanLimits>) {
    if (key === 'tier') continue
    const paid = PAID_LIMITS[key]
    const free = FREE_LIMITS[key]
    if (typeof paid === 'number' && typeof free === 'number') {
      if (free < paid) notices.push({ id: key, kind: 'smaller', free, paid })
      continue
    }
    if (typeof paid === 'boolean' && typeof free === 'boolean') {
      if (paid && !free) notices.push({ id: key, kind: 'disabled', free, paid })
    }
  }
  return notices
}

// Test-only escape hatch: the isolate cache above is deliberately module-
// level (no env-keyed map) since a real Worker isolate only ever serves one
// deployment's env.PLAN_TIER for its whole lifetime. A test process that
// wants to exercise both tiers in one run needs to clear it between cases.
export function __resetPlanTierCacheForTests(): void {
  cachedTier = null
}
