# Plan tiers — Free vs Paid, and where each number lives

One codebase, two deployable configurations. `cloudflare/wrangler.toml` is the
**Paid** deployment; `cloudflare/wrangler.free.toml` is the **Free** one. They
are otherwise the same file — same bindings, same routes, same database ids —
and a test enforces that (`cloudflare/scripts/test-plan-tier-matrix-pure.cjs`).

The Worker learns which it is from one variable, `PLAN_TIER`, read once per
isolate in `cloudflare/src/lib/planTier.ts`. Everything else follows from that
one read: `getPlanLimits(env)` returns the tier's row of `PLAN_LIMITS_BY_TIER`,
and every plan-sensitive constant in the codebase comes from that row.

**An unset `PLAN_TIER` defaults to `paid`, on purpose.** Defaulting to `free`
would look safer and is not: it would shrink every one of today's Paid-sized
ceilings on the next cold start, with no config change and no deploy, and the
only symptom would be imports quietly taking four times as many passes. Both
configs pin the variable explicitly, so the default only covers a hand-rolled
env or a test.

## The numbers

Every value below is in `PLAN_LIMITS_BY_TIER`. Nothing else in the codebase
holds a copy — that is enforced, per consumer, by the matrix test.

| Limit (`PlanLimits` field) | Free | Paid | The platform limit it respects |
| --- | ---: | ---: | --- |
| `rowsPerImportChunk` | 150 | 600 | Worker CPU per invocation (10 ms vs 300,000 ms) |
| `preflightMaxRows` | 125 | 500 | same, one preflight pass |
| `materializeRowsPerChunk` | 100 | 600 | same, CSV slice parsed per queue round trip |
| `d1BatchChunkStatements` | 100 | 300 | D1's per-batch CPU budget; the batch is one round trip |
| `stockActionMaxUnits` | 60 | 480 | subrequests per invocation (1,000 vs 10,000) |
| `stockActionMaxRows` | 480 | 1,920 | units × 8 lines |
| `stockActionClassifyWindow` | 120 | 480 | Worker CPU per invocation |
| `stockActionDispatchRead` | 100 | 400 | Worker CPU per invocation |
| `stockActionAddConcurrency` | 4 | 12 | subrequests per invocation |
| `historicalSalesImportConcurrency` | 4 | 12 | subrequests per invocation |
| `importQueueMaxBatchSize` | 1 | 5 | mirrors the queue consumer in each `.toml` |
| `maxImagesPerImportRequest` | 40 | 200 | one R2 PUT + one enqueue per image |
| `maxAssetsPerBackup` | 20 | 100 | ~2 subrequests per copied object |
| `backupTablePageSize` | 200 | 500 | Worker CPU + peak memory per page |
| `backupRestoreRowsPerBatch` | 40 | 80 | D1 per-batch CPU budget |
| `maxImageDeletesPerReset` | 200 | 500 | subrequests per invocation (~5% of Paid's) |
| `longAiImagePassesEnabled` | off | on | Worker CPU per invocation |
| `kvWritesPerDay` | 1,000 | 33,333 | KV: Free 1,000/day is a wall; Paid includes 1,000,000/month (÷30) |
| `cpuMsPerInvocation` | 10 | 300,000 | Workers CPU limit; Paid's value is pinned in `[limits]` |
| `subrequestsPerInvocation` | 1,000 | 10,000 | subrequests to Cloudflare services; Paid's is pinned in `[limits]` |
| `d1DailyRowsReadCeiling` | 5,000,000 | 833,000,000 | D1 daily rows read (Paid = 25,000,000,000/month ÷ 30) |
| `d1DailyRowsWrittenCeiling` | 100,000 | 1,666,000 | D1 daily rows written (Paid = 50,000,000/month ÷ 30) |
| `r2ClassAPerMonth` | 1,000,000 | 1,000,000 | **equal**: R2 bills independently of the Workers plan |
| `imagesTransformsPerMonth` | 5,000 | 5,000 | **equal**: Cloudflare Images is a separate subscription |
| `cloudinaryTransformsPerMonth` | 25,000 | 25,000 | **equal**: Cloudinary is a separate subscription |
| `d1MaxBoundParams` | 100 | 100 | **equal**: a D1/SQLite property, not a plan one |
| `d1MaxSqlLengthBytes` | 100,000 | 100,000 | **equal**: same |

The five **equal** rows are equal deliberately. They produce no "Free is
smaller" notice, because claiming them would be false.

## Which file sets what

| File | What it decides |
| --- | --- |
| `cloudflare/wrangler.toml` | Paid: `[vars] PLAN_TIER = "paid"`, `[limits] cpu_ms = 300000`, `subrequests = 10_000`, queue consumer `max_batch_size = 5` |
| `cloudflare/wrangler.free.toml` | Free: `[vars] PLAN_TIER = "free"`, **no `[limits]` block** (a Free deployment cannot raise `cpu_ms`), queue consumers lowered to `max_batch_size = 1` |
| `cloudflare/src/lib/planTier.ts` | every number in the table above, each with the platform limit it respects; `getPlanLimits(env)`, `getPlanNotices(tier)`, `getCachedPlanLimits()` |
| `cloudflare/src/routes/system.ts` | `GET /api/system/plan` → `{ tier, limits, notices[] }` |
| `frontend/src/utils/planTier.ts` | the client read plus one label key per limit (the Worker carries no display copy) |
| `frontend/src/components/utils-settings/PlanTierNotice.tsx` | the compact free-plan notice at the top of Settings → Backup |
| `frontend/src/lang/{en,km}.json` | the labels themselves, both packs |

Consumers that read the table, rather than keeping their own constant:
`lib/importEngine.ts`, `lib/backup.ts`, `lib/quotaGuard.ts`,
`routes/importJobs.ts`, `routes/system.ts`, `routes/compat.ts`.
`src/queue.ts` has no numeric batch constants — its batch sizes are the
`.toml` consumer settings.

`getCachedPlanLimits()` exists for exactly two helpers —
`runD1BatchInChunks` / `runD1BatchGroupsInChunks` — which take a `D1Compat`
and not an `Env`. Its fallback when nothing has resolved a tier yet is
**Paid**, identical to the behaviour before any of this existed, so the worst
case is a Free deployment briefly using a Paid-sized chunk, never a Paid
deployment silently shrinking. Anything holding an `Env` must use
`getPlanLimits(env)`.

## Running locally under each config

```sh
cd cloudflare

# Paid (the default config)
npm run dev                       # wrangler dev --local, port 8787

# Free
npx wrangler dev --local --config wrangler.free.toml --port 8788
```

Both read and write the same local D1 state unless you pass `--persist-to`.
**On a shared checkout, always pass it** — two sessions bootstrapping the same
`.wrangler/state` will corrupt each other's migrations:

```sh
npx wrangler dev --local --persist-to ../my-state --port 8797
npx wrangler dev --local --config wrangler.free.toml --persist-to ../my-state --port 8798
```

Check which tier is live:

```sh
curl -s http://127.0.0.1:8797/api/system/plan     # -> {"tier":"paid",...}
curl -s http://127.0.0.1:8798/api/system/plan     # -> {"tier":"free","notices":[...]}
```

(The route is behind `requireAuth`, so an unauthenticated curl answers 401 —
that response still proves the route is mounted; sign in to read the body.)

Build both configurations without deploying either:

```sh
npm run dry-run:paid              # -> dist-dry-run-paid/  (gitignored, never stage it)
npm run dry-run:free              # -> dist-dry-run-free/
```

Deploying Free is `npm run deploy:free`; Paid is `npm run deploy` /
`deploy:full`. Both are user-gated — see `DEPLOY.md`.

## Local D1 bootstrap on a fresh state

`npm run migrate:local` stops dead on a **completely empty** local state at
`migrations/0098_user_aliases.sql`:

```
X [ERROR] too many terms in compound SELECT: SQLITE_ERROR
```

That is not a defect in the migration. workerd — the runtime behind
`wrangler dev --local` and local D1 — hardens its SQLite connection with
`sqlite3_limit(db, SQLITE_LIMIT_COMPOUND_SELECT, 5)` in
`src/workerd/util/sqlite.c++`; the value was 3 until
[workerd#796](https://github.com/cloudflare/workerd/pull/796) raised it to 5,
after [workerd#795](https://github.com/cloudflare/workerd/issues/795). Stock
SQLite defaults that limit to 500, and remote D1 accepts the statement — which
is why production has 0098 applied and the migration's recorded content must
never be rewritten. No wrangler or miniflare flag lifts it; the value is
compiled into the runtime.

Use the bootstrap script, which applies the migrations and, when it hits that
ceiling, applies that one migration itself with the oversized compound
`SELECT` split into statements that insert exactly the same rows, records it
in `d1_migrations`, and resumes. It never writes to `migrations/`:

```sh
cd cloudflare
node scripts/bootstrap-local-d1.cjs --persist-to ../my-state
```

Flags: `--database <name>` (default: both `business-os` and
`business-os-import`), `--config wrangler.free.toml`, `--dry-run` to see what
would be split without writing, `--migrations-dir`.
`scripts/test-plan-local-bootstrap-pure.cjs` proves the split writes
row-for-row identical rows to the original, against real SQLite.

## What the tests hold in place

| Test | What breaks it |
| --- | --- |
| `cloudflare/scripts/test-plan-tier-pure.cjs` | the tier RESOLUTION changing — the env read, the isolate cache, the paid-by-default asymmetry |
| `cloudflare/scripts/test-plan-tier-matrix-pure.cjs` | any number in the table changing; `paid >= free` breaking; the notice list drifting from a fresh diff; the two `.toml` files differing anywhere but `[limits]`, `max_batch_size`, `PLAN_TIER`; quotaGuard keeping a ceiling of its own |
| `cloudflare/scripts/test-plan-local-bootstrap-pure.cjs` | the compound-SELECT split changing which rows it inserts |
| `frontend/tests/planTierNotice.test.ts` | a limit reaching the admin panel with no label, or a label missing from either pack, or a Khmer entry that is not Khmer |
