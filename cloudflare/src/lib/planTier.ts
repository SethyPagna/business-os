// Free vs Paid Workers plan: ONE place that decides which set of
// plan-sensitive numbers a deployment runs with.
//
// WHY THIS EXISTS
//
// This codebase ships as two deployable configurations of the SAME source:
// wrangler.toml (Paid, current production) and wrangler.free.toml (Free --
// see that file's header for the three config diffs and why they are the
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

  // ---- Payment-method rename ---------------------------------------------

  // routes/settings.ts loadPaymentMethodCandidates -- sales read per D1 call
  // by GET /payment-methods/impact and by the linked POST /payment-methods/
  // replace (id, payment_method, payment_details only; keyset on sales.id, so
  // a page edge can never split a sale). The scan is one call per page, so on
  // Free the page is what keeps ~16k sales under the 50 calls per invocation:
  // 200 a page took 80 calls, 5000 takes 4 and (with ~20 calls around the
  // scan) stays under 50 until ~150k sales. Paid 200 is today's page, kept so the Paid path reads exactly what
  // it read before (Paid has 1000 calls). Unlike the ceilings above, Free's
  // number is the LARGER one: a bigger page is fewer calls, and calls are
  // what Free rations; test-plan-tier-pure.cjs lists such fields by name.
  paymentMethodScanPageSize: number

  // ---- Backup ------------------------------------------------------------

  // backup.ts MAX_ASSET_BYTES_PER_BACKUP (misnamed at its definition site:
  // it is an ASSET COUNT per run, not a byte count). Each asset costs an
  // R2 get() + put() = 2 subrequests. Paid 100 (~200 subrequests) is the
  // current exported constant. Free 20 (~40 subrequests) is documented
  // directly on that constant -- "this was 20 under the Free plan's older
  // model" -- and is what fits Free's 50 external-subrequest ceiling.
  maxAssetsPerBackup: number

  // Whether the scheduled CRON may create a full D1 backup.
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

  // The scheduled backup runs once per Cambodia business date (UTC+7), at the
  // first heavy-cron tick whose local hour is at or after this one (the shop has
  // closed). 21 puts it on the 22:17 tick of the 3-hourly heavy trigger. Open
  // shifts never delay it. Same value on both tiers; Free still refuses to
  // create one (scheduledBackupEnabled).
  scheduledBackupAfterHourLocal: number

  // How many finalized SCHEDULED (daily) backups retention keeps: 7 = a week of
  // history (owner 13 Nov 2026). Manual backups keep their own newest
  // CLOUDFLARE_BACKUP_KEEP; the two pools never evict each other.
  scheduledBackupKeep: number

  // How many times the scheduled backup is TAKEN per business night (close hour to the next close hour) when attempts keep
  // failing: a failed or killed set is retried on the next heavy tick, each try is a full D1 read, so after this many the night
  // is given up and the image audit gets the ticks. Same on both tiers; the next night starts fresh.
  scheduledBackupMaxAttemptsPerDay: number

  // Gzip the backup manifest (the whole database as JSON) while it streams into R2: several-fold smaller, so the kept backups
  // fit R2's free storage. Compression is native zlib CPU, which Paid's cpu_ms covers and Free's 10 ms does not: Paid only.
  // Restore, validate and the Drive stage read plain and gzip manifests alike.
  backupManifestGzip: boolean

  // A backup-pool object uploaded less than this many hours ago is never deleted by the pool sweep: it may be the copy an
  // in-flight backup (or a continuation) just made of a re-uploaded image, not yet named by any sidecar. Same on both tiers.
  backupPoolGraceHours: number

  // Drive skips a newest backup whose manifest lists older image versions than it copied, and holds the newest current one.
  // When that current set is older than this many hours, the stale one is mirrored instead (the database matters more than
  // a few image versions). Same on both tiers.
  driveStaleMirrorHours: number

  // While tonight's set is still copying in the queue, the backup step only POLLS it. After a poll the next heavy tick goes to the
  // image audit unless this many minutes have passed, so a copy that never finishes (up to 24 h) polls about every other tick
  // instead of starving the audit. 240 = more than one 3 h heavy tick, less than two.
  scheduledBackupCopyPollGapMinutes: number

  // The bell tells an admin "Nightly backup missing" once the backup step has had no complete visit for this many hours. A healthy
  // night finishes within a few hours of the 22:17 try (the copy poll can land up to ~6 h later), so 30 = a full night missed plus slack,
  // never a flap. Read from the cron record, never from R2. Same on both tiers; Free never takes a scheduled backup, so never shows it.
  scheduledBackupStaleHours: number

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
  // per tier per scheduled visit. Paid 20 is the current value. Free 5 keeps
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

  stockInLinesPerRequest: number

  // The same cap when call_counting is ON (lib/callCounting.ts): the largest N whose lines all complete inside the 50-call invocation WITH the
  // tail reserve (receipt, result, audit, cache and Telegram, each allowing one retry: 16 calls). Measured on the Free config, call_counting ON
  // (scripts/read-budget, an N-line fast stock-in on a cold isolate): 1 line is 17-18 calls, 2 lines 29, and a 3rd line (~6 calls of reads, ~12 to
  // finish) would end at 41 real calls but fails the reserve (29 + 12 + 16 > 50), so it is deferred after its reads. A cap above 2 therefore only
  // spends reads on a line that is deferred anyway. Paid never counts calls and keeps stockInLinesPerRequest.
  stockInLinesPerRequestByCalls: number

  // lib/callCounting.ts: whether the call_counting read switch is consulted at all. Free true: its 50-call invocation limit is the one a
  // statement count can wrongly trip, so admission may charge a db.batch() as one call once the owner turns the switch ON. Paid false: its
  // 1000-call limit never binds a batch, so no request pays the switch read and admission keeps counting statements.
  callCountingSwitchApplies: boolean

  // lib/inventoryCheckApprovals.ts: how long an Inventory Check approval that has been claimed (stock may already have moved for it) can sit without
  // progress before ANOTHER approver may take it over and finish it. A claimer who is deactivated or has lost the right can always be replaced at once;
  // this window is for a claimer who is merely gone. It is a lease, so like the other lifetimes Free is the LONGER one: a Free request applies one line and a
  // slow phone is normal there. Paid 5 min, Free 15 min.
  inventoryCheckApprovalTakeoverSeconds: number

  // ---- Read-cost lifetimes (G39 efficiency) -------------------------------
  //
  // These are LIFETIMES, so unlike every ceiling above, Free's number is the
  // LARGER one: a longer lifetime means fewer D1 rows read, and Free's
  // 5,000,000 rows/day is a hard wall. scripts/test-plan-tier-pure.cjs keeps
  // an explicit list of such fields and checks they run the other way.

  // lib/coreDataInvariants.ts ensureCoreDataInvariantsForBuild: how long one
  // isolate's full stock-coverage scan (~16-25k rows) stays valid for the
  // same deployed build before another isolate re-runs it. Products created
  // after the scan are still checked on every cold isolate (by id watermark),
  // so this only bounds how long coverage lost some OTHER way (a re-activated
  // product, a deleted branch_stock row, a restore) can go unhealed.
  // 24 h on both tiers (Paid was 6 h until 11 Nov): a run reads ~23k rows, so the longer lifetime saves ~70k rows a day on Paid.
  coreInvariantsReverifySeconds: number

  // lib/auth.ts requireAuth: how stale user_sessions.last_seen_at may be before a request writes it again (one row write per touch).
  // Nothing decides on it (expiry slides on expires_at); it feeds the Devices page and the freshest-session fallback for records written
  // outside a request. Same on both tiers.
  sessionTouchIntervalSeconds: number

  // lib/deviceTrust.ts maxApprovedDevicesPerUser(env): how many APPROVED devices one account may hold (the owner's rule, 5 since 12 Nov 2026).
  // A security policy rather than a plan size, so it is the same on both tiers; it lives here so the number is tuned in one place.
  maxApprovedDevicesPerUser: number

  // lib/dashboardStockOverview.ts: lifetime of the shared Dashboard stock /
  // expiry overview. Freshness comes from the 'products' + 'stock' cache
  // versions in its key (every sale and stock write bumps one), so this is
  // only the ceiling for a writer that does not bump and for the expiry
  // window's clock. Paid 30 s (the order of the 20 s product-search cache),
  // Free 300 s.
  dashboardStockOverviewCacheSeconds: number

  // lib/dashboardStockOverview.ts, read switch `dash_overview_5m` ON: the longest the Dashboard stock overview is ever served after it was
  // computed (the owner's "up to 5 minutes old, with the time it was calculated"). It is also the length of the time bucket in the key, so a
  // sale does not recompute it: only a product or inventory write (they bump the 'products' version), a low-stock setting, a deploy, a restore
  // or this window moving does. Paid 300 s, Free 300 s: a freshness promise to the owner, not a plan-sized saving.
  dashboardOverviewMaxAgeSeconds: number

  // lib/readSwitches.ts: how long one isolate remembers the one system_flags read that carries the in-app read switches AND the
  // data epoch (X-BOS-Switches, X-BOS-Epoch, every cache key). A kill switch or a restore's new epoch reaches every isolate within
  // one window, so this is also the longest a flip or an epoch rotation takes to be seen, and what a restore waits before it
  // releases maintenance (dataEpoch.ts). Paid 5 s (freshness is cheap there), Free 15 s (one statement per isolate per window is
  // the whole cost, and Free's read wall is hard). The client's own windows (frontend api/dataEpoch.ts ECHO_WINDOW_MS, api/
  // serverSignals.ts SIGNAL_TTL_MS) are sized from the Free value; scripts/test-plan-tier-pure.cjs pins that they still cover it.
  readSwitchMemoSeconds: number

  // lib/salesDailyTotals.ts + lib/salesDailyCron.ts (read switch `sales_daily`): the stored daily sales totals. One recompute visit claims at most
  // salesDailyRecomputeDaysPerRun dirty past days (one claim batch, one kernel read for them all, one commit batch: the calls do not grow with the
  // days, the rows read do). The nightly reconcile re-derives the last salesDailyReconcileRecentDays days and a rotating slice of
  // salesDailyReconcileOlderDaysPerRun older days from the raw records and compares; it runs at most once per salesDailyReconcileMinIntervalSeconds.
  // salesDailyAlertListedDays is how many differing days one owner alert names. salesDailyRebuildMaxDays bounds one POST /api/system/sales-daily/rebuild
  // range (each day it marks is a row written). Free keeps the slices small: its Worker has 10 ms of CPU and the kernel runs in the isolate.
  salesDailyRecomputeDaysPerRun: number
  salesDailyReconcileRecentDays: number
  salesDailyReconcileOlderDaysPerRun: number
  salesDailyReconcileMinIntervalSeconds: number
  salesDailyAlertListedDays: number
  salesDailyRebuildMaxDays: number
  // The longest stored payload one day may carry (UTF-8 bytes). A day over it is stored with refusal sales_daily_payload_too_large and read raw. D1 holds 2 MB a row;
  // Free's smaller number also bounds the JSON.parse a Free reader pays per day within its 10 ms of CPU.
  salesDailyMaxPayloadBytes: number
  // The BUDGET of one cron visit of either step (lib/salesDailyCron.ts), sized from scripts/sales-daily-cpu-floor.cjs (14 Nov 2026, laptop Node, 31 exact money keys per
  // sale, common-denominator summation: 0.0125 ms per sale, 3.75 ms for a 300-sale day; the kernel's own per-add gcd cost 70 ms the same day). A Worker has no CPU clock
  // (Date.now only moves at I/O), so a visit charges an ESTIMATE per unit of work, one business day, and stops BEFORE the next day would pass a budget:
  // salesDailyStepCpuBudgetMs of the isolate's CPU (Free 7 of its 10 ms), salesDailyStepWallBudgetMs of wall time, and the D1 queries left under d1QueriesPerInvocation
  // after salesDailyQueryReserve. A day's estimate is salesDailyCpuMsPerDayFixed + salesDailyCpuMsPerSourceRow x the rows it read (twice the measured per-sale cost, one sale
  // per row, to leave room for the per-sale facts, the JSON and the encode that the floor does not time) and salesDailyKernelQueriesPerDay + the step's own statements.
  // The first day of a visit always runs (progress); a day too heavy for the plan on its own is the known limit, named in the report.
  // A shadow run (the stored path computed beside the raw one and compared) needs spare reads and CPU: Paid only, never on Free (owner: shadow on Paid before 30 Nov).
  salesDailyShadowAllowed: boolean
  salesDailyStepCpuBudgetMs: number
  salesDailyStepWallBudgetMs: number
  salesDailyCpuMsPerSourceRow: number
  salesDailyCpuMsPerDayFixed: number
  salesDailyKernelQueriesPerDay: number
  salesDailyQueryReserve: number

  // lib/buildShare.ts: how a request that finds costly shared work already being done by another request waits for it instead of doing
  // it again (storefront builds, the Dashboard overview, the core-data check, the stock-session column probe). The first request sets a
  // "building since <time>" marker (a plain value); the others poll for its FINISHED result with their own timer and never await
  // anything the first request created: workerd ties a promise to its request, so awaiting another request's can hang for good (the
  // 6.0.1048 review, B1). The wait and the staleness window save D1 reads (a longer wait means fewer duplicate builds), so Free's number is
  // the LARGER one; the poll step is larger on Free too, because a Free invocation has 10 ms of CPU and fewer wake-ups spend less of it.
  //   buildSharePollMs   the step between looks at the result memo. Paid 50, Free 100.
  //   buildShareWaitMs   the longest one request waits; also how long a finished result stays in the buildShare memo (the longest any
  //                      waiter waits). Paid 1,000, Free 2,000.
  //   buildShareStaleMs  the age at which a marker is taken for a dead builder (cancelled, killed) and ignored. Paid 3,000, Free 5,000.
  //                      A cold-search slot (routes/portal.ts, the per-isolate cap on searches that run their own build) counts as lost
  //                      at the same age: its release sits in a `finally` that a request whose context ended never reaches, and a build
  //                      older than this is the one a waiter has already stopped trusting.
  //   buildShareMemoMaxEntries  how many finished bodies the buildShare memo holds at once (the oldest go first). The memo is only read
  //                      by a request waiting on a builder, for at most buildShareWaitMs, but it holds whole storefront bodies, so its
  //                      size is bounded by count, not by time alone. An evicted body costs its waiter one rebuild. Unlike the three
  //                      durations this is a ceiling, so Free is the SMALLER one: Paid 32, Free 16.
  buildSharePollMs: number
  buildShareWaitMs: number
  buildShareStaleMs: number
  buildShareMemoMaxEntries: number

  // ---- Expenses page reads (E1-F; behind the read switch `expense_reads`) ----
  //
  // routes/feesCatalog.ts: the most rows ONE page of the Expenses export may carry when the export pages by cursor. A page reads up to this many rows from
  // the expense list and as many from the sale courier-cost list, then merges them. The offset path keeps its own cap of 500 and the export client asks for
  // 500, so a smaller Free page would turn an export of 500 rows or fewer (a month's, today's one request) into two pages that each pay the cursor's fixed
  // cost: Free is therefore the same 500 as Paid (E1-F review N2).
  expenseExportPageRows: number

  // ---- Stock Changes ledger paging (behind the read switch `ledger_keyset`) ----
  //
  // routes/products.ts GET /stock-ledger: the most rows ONE page may carry when the ledger pages by cursor. The Stock Changes export walks pages of this size
  // (the interactive list asks for 25), and each page is one D1 call plus a correlated before/after walk per row, so Free takes the smaller page. With the
  // switch off the route keeps the 1,000-row cap it always had.
  stockLedgerExportPageRows: number

  // routes/fees.ts GET /report: the most expense rows the single grouped pass may read (a window has at most this many groups, one per day, type and label
  // spelling). The pass reads the expense table once instead of four times and hands the groups to the Worker to fold; a window with more rows than this is
  // answered by the four statements instead, which return a few hundred rows however large the window is. The cap is on ROWS, not groups, so a window over it
  // costs only the first `cap + 1` rows of the scan before it is turned away, not the whole table. Free is bounded by CPU: folding is linear in the groups
  // and the Free invocation has 10 ms in total (D1 decode of the groups and the JSON response come on top). foldFeeGroups timed in node v24: at 1,500
  // groups 1.73-2.55 ms warm (90th percentile up to 4.5 ms) but 6.2-11.8 ms for the FIRST call in a fresh module; at 10,000 groups 4.7-5.3 ms warm and
  // 14-25 ms cold. A cold Free isolate may therefore exceed 10 ms even at 1,500, so turning `expense_reads` ON for a Free deployment WAITS for a CPU
  // measurement on real Workers (the switch stays OFF until then; Paid has no such limit). Paid keeps the generous bound (more than the whole expense table
  // today: the seed has 8,695 rows, production about 8,700).
  expenseReportFoldMaxRows: number

  // routes/fees.ts GET /report: whether the grouped pass is tried at all for a window that is not bounded on both ends (no dates, or a start without an end
  // or the reverse). Such a window is most or all of the table, and on Free that is over the row cap on any shop old enough to have a report worth reading,
  // so the attempt (cap + 1 rows read, 2 reads each) is a pure cost before the four statements run anyway: Free skips it and the all-time report reads
  // exactly what 6.0.1053 reads. A window with both ends can still be over the cap and pays the attempt once. Paid tries every window (it folds the table).
  expenseReportFoldUnboundedWindows: boolean

  // ---- Received dates in the Products list (INV-A S3; token-gated, additive) ----
  //
  // routes/products.ts GET /search with include=lots: the most received dates (lots) ONE row carries. The answer lists a row's active lots that have a branch
  // row, first-in-first-out, and sets `lots_more: true` on a row that has more; the rest load through GET /api/batches as before. The cap bounds the payload
  // bytes and the per-row work on the tier that rations both (Free 20, Paid 50); the statement still reads every active lot of the page's rows (a lot costs its own
  // row plus one per branch it sits in), because ordering in SQL would be counted as rows read again.
  productListLotsPerRow: number

  // ---- The wired Inventory Check read path (INV-A S4a; behind the read switch `ic_wired`) ----
  //
  // routes/inventoryChecks.ts GET /overlay: the most product ids ONE overlay request reads count entries, pending marks and last movements for (a window is
  // a page plus the prefetch pages after it). Above it the request is refused 400, so the statements stay bounded by a number the client was told.
  inventoryOverlayMaxRows: number

  // lib/inventoryCheckSessions.ts createInventoryCheckLotSubmission (INV-B S5; behind the read switch `ic_lot_counts`): the most received-date lines ONE count submission
  // carries across all its products (a branch-total line counts as one). Above it the submission is refused 400, so its insert statements stay bounded by a number the client was
  // told. A ceiling like the ones above: Paid carries 4 times what Free does.
  inventoryCheckLotLinesPerSubmission: number
  // The most received dates ONE product carries in a count (a product with more is not counted date by date). Paid carries twice what Free does.
  inventoryCheckLotLinesPerProduct: number

  // lib/inventoryCheckOverlay.ts: the most movement rows read per product to find its last recorded stock change. The newest day's rows are read in index order
  // (created_at mixes 'YYYY-MM-DD HH:MM:SS' and ISO 'T...Z', so the text order alone puts ISO 09:00 above 14:00) and the latest by julianday among these wins.
  inventoryLastChangeMaxRows: number

  // lib/inventoryCheckList.ts: the most ids a check-state filter (Issues, Counted, Pending, Not checked) may carry into the Products kernel as ONE json_each
  // parameter. A branch whose checked set is larger is refused 503 inventory_check_filter_too_large rather than read in part.
  inventoryCheckFilterMaxIds: number

  // ---- The shared ranked scope of the Products list (INV-A S7; behind the read switch `catalog_ranked_scope`) ----
  //
  // lib/rankedScope.ts: how long a cached ranking (the ordered family keys of a window of pages, and the family total) may be served. The entry is also keyed on the products,
  // stock, promotions and Inventory Check versions and ends at the next promotion boundary, so this only bounds what no version moves: Free keeps a ranking for an hour (reads are
  // what Free rations), Paid for a minute. Replaces the 20 s literal the page payload cache used.
  productListCacheSeconds: number

  // GET /api/products/possible-duplicates: how long the cluster membership (which products look the same) may be served. The entry is keyed on the products version, which every product
  // create/edit/merge/delete/import/undo and every dismissal advances; what a cluster shows (stock, cost, price) is read live on every hit, so this only bounds what no version moves. Paid keeps
  // the 300 s the route always had; Free keeps it an hour, because a miss reads every active product.
  possibleDuplicatesCacheSeconds: number

  // The prefetch window of a paged list that reads the shared ranking (the Inventory Check list tells its client): the current page and the pages ahead it may fetch, so a window of
  // pages costs the rows of those pages (the ranking is shared) and no ranking. Free 3 (a page and 2 ahead); Paid 4 (Paid is not rationed).
  catalogListWindowPages: number

  // routes/notifications.ts: how long the bell's heavy sections (inventory, expiry, supplier credit) may be served from the cache, ignoring the data versions. The owner (11 Nov) accepts a bell up to
  // 5 minutes old with an "as of" time, so a sale or a product edit on another device no longer forces a recompute (the inventory pass reads every active product); the actor's own write asks
  // for a fresh answer (?fresh=1). Free keeps it the 5 minutes the owner allowed (reads are what Free rations), Paid 45 s (the lifetime the version-keyed entry had). Never above 300 on either tier.
  notificationSectionCacheSeconds: number

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

  // D1 CALLS one invocation may make (a db.batch() is ONE call, whatever its
  // statement count). Guards compare a call counter against this number.
  //
  // Free 50, Paid 1000. Settled 27 Oct 2026 from the D1-specific page,
  // developers.cloudflare.com/d1/platform/limits (updated 24 Oct 2026):
  // "Queries per Worker invocation ... 1000 (Workers Paid) / 50 (Free)", and
  // "a db.batch() call counts as a single query against it, not one query per
  // statement ... a batch containing 2,000 statements executes in a single
  // Worker invocation, while issuing 2,000 individual queries in one
  // invocation fails with 'Too many API requests by single Worker
  // invocation'". The Workers limits page lists 1,000 subrequests to internal
  // services on Free, but it does not override this D1 row, so Free stays 50.
  //
  // Two consequences for callers: (1) count calls, not the statements inside a
  // batch (requestMetrics.ts invocation.attemptedCalls, lib/callCounting.ts); a
  // 60-statement batch is legal on Free, 51 separate queries are not. Admission
  // still counts statements until the call_counting switch is ON.
  // (2) Free's real ceiling is 10 ms of CPU, which a Worker cannot measure from
  // inside (Date.now() and performance.now() only advance after I/O), so
  // CPU-heavy routes have to be bounded by rows, bytes or page size.
  d1QueriesPerInvocation: number

  // ---- Storefront AI assistant (G38 P0) ----------------------------------

  // routes/portal.ts POST /ai/chat daily budget: chats per business day
  // (UTC+7) for the whole storefront, and per visitor network. Each chat is
  // one paid call to the AI provider, so an anonymous script must not turn
  // the shop's provider bill into a number of its choosing. Free runs the
  // assistant on a 10 ms CPU budget, so it gets the smaller allowance.
  // PORTAL_AI_DAILY_MAX / PORTAL_AI_VISITOR_DAILY_MAX in [vars] override
  // both tiers (routes/portal.ts portalAiDailyBudget).
  portalAiDailyMax: number
  portalAiVisitorDailyMax: number
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
  paymentMethodScanPageSize: 200,
  maxAssetsPerBackup: 100,
  scheduledBackupEnabled: true,
  scheduledBackupAfterHourLocal: 21,
  scheduledBackupKeep: 7,
  scheduledBackupMaxAttemptsPerDay: 2,
  backupManifestGzip: true,
  backupPoolGraceHours: 24,
  driveStaleMirrorHours: 24,
  scheduledBackupCopyPollGapMinutes: 240,
  scheduledBackupStaleHours: 30,
  maxImageDeletesPerReset: 500,
  importRetentionMaxJobsPerTier: 20,
  ephemeralDeleteBatch: 5000,
  catalogIntegrityMaxProducts: 50_000,
  stockInLinesPerRequest: 24,
  stockInLinesPerRequestByCalls: 24,
  callCountingSwitchApplies: false,
  inventoryCheckApprovalTakeoverSeconds: 5 * 60,
  coreInvariantsReverifySeconds: 24 * 60 * 60,
  sessionTouchIntervalSeconds: 15 * 60,
  maxApprovedDevicesPerUser: 5,
  dashboardStockOverviewCacheSeconds: 30,
  dashboardOverviewMaxAgeSeconds: 300,
  readSwitchMemoSeconds: 5,
  salesDailyRecomputeDaysPerRun: 30,
  salesDailyReconcileRecentDays: 7,
  salesDailyReconcileOlderDaysPerRun: 30,
  salesDailyReconcileMinIntervalSeconds: 20 * 60 * 60,
  salesDailyAlertListedDays: 3,
  salesDailyRebuildMaxDays: 4000,
  salesDailyMaxPayloadBytes: 1_000_000,
  salesDailyShadowAllowed: true,
  salesDailyStepCpuBudgetMs: 5000,
  salesDailyStepWallBudgetMs: 60_000,
  salesDailyCpuMsPerSourceRow: 0.025,
  salesDailyCpuMsPerDayFixed: 0.3,
  salesDailyKernelQueriesPerDay: 10,
  salesDailyQueryReserve: 6,
  buildSharePollMs: 50,
  buildShareWaitMs: 1000,
  buildShareStaleMs: 3000,
  buildShareMemoMaxEntries: 32,
  expenseExportPageRows: 500,
  stockLedgerExportPageRows: 1000,
  expenseReportFoldMaxRows: 50_000,
  expenseReportFoldUnboundedWindows: true,
  productListLotsPerRow: 50,
  inventoryOverlayMaxRows: 300,
  inventoryCheckLotLinesPerSubmission: 240,
  inventoryCheckLotLinesPerProduct: 100,
  inventoryLastChangeMaxRows: 8,
  inventoryCheckFilterMaxIds: 10_000,
  productListCacheSeconds: 60,
  possibleDuplicatesCacheSeconds: 300,
  catalogListWindowPages: 4,
  notificationSectionCacheSeconds: 45,
  d1DailyRowsRead: 833_000_000,
  d1DailyRowsWritten: 1_666_000,
  d1MaxDatabaseBytes: 10 * 1024 * 1024 * 1024,
  d1QueriesPerInvocation: 1000,
  portalAiDailyMax: 300,
  portalAiVisitorDailyMax: 30,
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
  paymentMethodScanPageSize: 5000,
  maxAssetsPerBackup: 20,
  scheduledBackupEnabled: false,
  scheduledBackupAfterHourLocal: 21,
  scheduledBackupKeep: 7,
  scheduledBackupMaxAttemptsPerDay: 2,
  backupManifestGzip: false,
  backupPoolGraceHours: 24,
  driveStaleMirrorHours: 24,
  scheduledBackupCopyPollGapMinutes: 240,
  scheduledBackupStaleHours: 30,
  maxImageDeletesPerReset: 40,
  importRetentionMaxJobsPerTier: 5,
  ephemeralDeleteBatch: 1000,
  catalogIntegrityMaxProducts: 2000,
  stockInLinesPerRequest: 1,
  stockInLinesPerRequestByCalls: 2,
  callCountingSwitchApplies: true,
  inventoryCheckApprovalTakeoverSeconds: 15 * 60,
  coreInvariantsReverifySeconds: 24 * 60 * 60,
  sessionTouchIntervalSeconds: 15 * 60,
  maxApprovedDevicesPerUser: 5,
  dashboardStockOverviewCacheSeconds: 300,
  dashboardOverviewMaxAgeSeconds: 300,
  readSwitchMemoSeconds: 15,
  salesDailyRecomputeDaysPerRun: 3,
  salesDailyReconcileRecentDays: 7,
  salesDailyReconcileOlderDaysPerRun: 3,
  salesDailyReconcileMinIntervalSeconds: 20 * 60 * 60,
  salesDailyAlertListedDays: 3,
  salesDailyRebuildMaxDays: 1000,
  salesDailyMaxPayloadBytes: 500_000,
  salesDailyShadowAllowed: false,
  salesDailyStepCpuBudgetMs: 7,
  salesDailyStepWallBudgetMs: 20_000,
  salesDailyCpuMsPerSourceRow: 0.025,
  salesDailyCpuMsPerDayFixed: 0.3,
  salesDailyKernelQueriesPerDay: 10,
  salesDailyQueryReserve: 6,
  buildSharePollMs: 100,
  buildShareWaitMs: 2000,
  buildShareStaleMs: 5000,
  buildShareMemoMaxEntries: 16,
  expenseExportPageRows: 500,
  stockLedgerExportPageRows: 500,
  expenseReportFoldMaxRows: 1_500,
  expenseReportFoldUnboundedWindows: false,
  productListLotsPerRow: 20,
  inventoryOverlayMaxRows: 150,
  inventoryCheckLotLinesPerSubmission: 60,
  inventoryCheckLotLinesPerProduct: 50,
  inventoryLastChangeMaxRows: 4,
  inventoryCheckFilterMaxIds: 2_000,
  productListCacheSeconds: 3_600,
  possibleDuplicatesCacheSeconds: 3_600,
  catalogListWindowPages: 3,
  notificationSectionCacheSeconds: 300,
  d1DailyRowsRead: 5_000_000,
  d1DailyRowsWritten: 100_000,
  d1MaxDatabaseBytes: 500 * 1024 * 1024,
  d1QueriesPerInvocation: 50,
  portalAiDailyMax: 100,
  portalAiVisitorDailyMax: 10,
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
 * The sentence appended to a refusal that only exists because this
 * deployment is on the free plan. Empty on paid, so a paid deployment's
 * messages are byte-identical to what they were before the tier split.
 *
 * The Worker has no translation layer (there is no request locale on a queue
 * invocation at all), so every refusal built with this stays English on the
 * wire and carries a stable `code` beside it. The frontend resolves that code
 * against lang/en.json + lang/km.json -- the keys are named exactly after the
 * codes, so `t(code, englishFallback)` needs no mapping table.
 */
export function freePlanRefusalSuffix(env: Env): string {
  return resolvePlanTier(env) === 'free'
    ? ' This deployment runs on the Cloudflare free plan, where that ceiling is lower than on the paid plan.'
    : ''
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
