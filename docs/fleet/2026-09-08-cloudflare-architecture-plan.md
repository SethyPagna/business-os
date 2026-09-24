# Cloudflare architecture plan — business-os on Workers Free and Workers Paid, both maximized

**Status: PLAN ONLY. Nothing in this document is implemented, prepared, or deployed.**
Date: 2026-09-08. Written by the Claude session that owns this file; it is the only file that session
created. Inputs: three owner-supplied reference documents ("Pure Cloudflare architecture map",
"Scaling distributed architectures under constraints", "Free vs Paid Cloudflare Workers plan"), the
live Cloudflare GraphQL analytics for account `743e5b72…` and D1 `49795be9…` (Sep 1–8 2026), six
read-only exploration reports over `cloudflare/src` and `frontend/src`, the superseded plan-tier
commits `75092337`, `40518293`, `dafe83e6`, and the Cloudflare documentation as of Sept 2026.

Owner's brief: *"see what can be improved and better done … more efficient, great and organized
structures and data, efficient data uses, checking, surfing, moving … two versions to run paid vs
free … runbat for free and paid … the thing is maximizing both plans for both versions."*

---

## 0. How to read this document

- §1 is the whole plan in one page. §2–§3 are the evidence. §4 judges the three reference documents
  against this system. §5 is the target architecture that both tiers share. §6 ranks the work.
  §7 and §8 are the Free and Paid variants. §9 is configuration, scripts and the `run\*.bat` files.
  §10–§12 are tests, rollout and constraints. Appendices hold SQL sketches, the budget-meter design
  and evidence provenance.
- Numbers marked **≈** are derived (GraphQL rows-per-call × calls, or per-day = 3-day window ÷ 3).
  They are good to one significant figure and exist to rank work, not to be quoted as facts. Phase 0
  installs the meter that replaces them with measured values.
- Item ids (`R1`, `W3`, `J2`, `G5`, `F1` …) are stable references used across sections: R = reads,
  W = writes, J = jobs/background, G = guards and smarts, F = frontend transport.
- Every recommendation respects the recorded decisions in §12. Where a reference-document idea is
  rejected, §4 says why.
- **Part II (§13–§19)** is the whole-system atlas: storage (§13), Worker platform (§14), request
  surface (§15), frontend (§16), cross-cutting domains, tooling and tests (§17), lineage and ownership
  (§18), and the match of every finding to a plan item and to both tiers (§19). §6.1 lists the items
  the atlas added; §19.4 lists what it corrected in Part I.

---

## 1. Executive summary

**Where we are.** Production runs on Workers Paid at a flat US$5/month. Traffic is small (12–17k
requests/day), but the read shape is expensive: D1 reads **≈285 million rows/day** on an ordinary
day and **882 million** on an import day, from a 164 MB database. That is inside Paid's included
25 billion rows/month (≈8.5 B used), so it costs nothing today — and it is **55× over the Workers
Free wall** of 5 million rows/day, which since 1 Sept 2026 is hard-enforced account-wide (queries
error until 00:00 UTC). CPU is the second Free blocker: p50 is 2.8 ms but p90 is 23–38 ms and p99
68–171 ms against Free's 10 ms per invocation. Requests, KV, DO, R2 and Queues all fit Free already.

**The shape of the plan.** One architecture, two configurations.

1. **Read-shape discipline (§5.4).** Fourteen query shapes account for ≈154 M of the 285 M
   rows/day. Each has a structural fix — a maintained counter, a rollup table, a partial index, a
   keyset cursor, a single-pass CTE, a snapshot object served from R2/Cache API, or "never on the
   request path". Target after the plan: **≤3 M rows/day** on an ordinary day, with imports
   admission-controlled against the remaining budget.
2. **Write consolidation (§5.5).** A sale becomes one atomic `db.batch` (today it is four sequential
   D1 calls); receipt numbers get a UNIQUE index and a per-branch sequencer; the transfer leg stops
   clamping oversells to zero; stock-in posts N lines per request instead of N requests; side effects
   (Telegram, Drive, email, broadcast) leave the request path through a queue.
3. **Budgeted background work (§5.6).** Backups go keyset + incremental (today: OFFSET paging over
   55 tables every 6 h ≈ 26 M rows/day on its own, and `shift_sessions` is not backed up). A job
   runner in a SQLite Durable Object slices imports, backups, retention, exports and rollup
   verification, with cron only pinging it (Free cron CPU is 10 ms).
4. **Guards and smarts (§5.7).** A budget meter that counts every pool the tier caps (D1 rows read
   and written, requests, KV writes, queue ops, subrequests), publishes a zone
   (normal → economy → critical → frozen) with defined behaviours per zone, and degrades the app
   before Cloudflare errors it. Circuit breakers on externals, kill switches, import admission
   control, a read-shape lint and `EXPLAIN QUERY PLAN` tests, a deploy guard that refuses a config
   that cannot run on the target plan.
5. **Frontend as a cache, not a poller (§5.9).** An idle admin tab on the production line costs
   ≈124 requests/hour, 96 % of it a 30 s health probe that also pays the Worker's cold-start
   invariants (§16.5, R18); on `main` it is ≈257–407/hour because a 5-minute 11-request offline
   snapshot and a 12 s import poll are still live there. Every list refetches on every WebSocket
   event and nothing sends an ETag. Target ≈15/hour and 0 D1 rows on both lines.

**Free variant, maximized (§7).** Uses every free pool as a first-class resource: Workers (100k
req/day), D1 (5 M reads / 100k writes per day, account-wide), Durable Objects with SQLite (their
**own** 100k requests and 5 M rows-read / 100k rows-written per day — a second pool — plus the
30 s-per-request CPU ceiling as an escape hatch, subject to the canary in gate F0), KV (100k reads /
1k writes per day), Queues (10k ops/day since Feb 2026, 24 h retention), Cache API and static assets
(unlimited on both plans), R2 (10 GB, 1 M class-A / 10 M class-B per month), Images (5k/month),
the Rate Limiting binding, and D1 Time Travel. Config: `wrangler.free.toml` (no `[limits]`,
Free-sized queue batches, `PLAN_TIER = "free"`), a `PLAN_LIMITS` table revived from the superseded
Sept 3 design **without** its colliding migration, daily incremental backups, imports throttled to
the write budget with automatic resume after the 00:00 UTC reset, and a health signal that flips the
POS into its existing offline outbox if the wall is ever hit.

**Paid variant, maximized (§8).** Keeps `[limits] cpu_ms = 300000` and 10k subrequests, uses
Queues with 4–14-day retention for durable side effects, Workflows for imports and backups, read
replication (Sessions API) for portal readers, up to 250 crons for one-job-per-cron scheduling,
Workers Logs at full sampling, and the same rollups — on Paid they buy latency (dashboard ≈24
statements → ≈4) and headroom, not money. At today's and the projected scale, Paid stays a flat
US$5/month.

**Run scripts (§9.4).** `run\deploy-paid.bat`, `run\deploy-free.bat`, `run\verify-paid.bat`,
`run\verify-free.bat`, `run\dev-paid.bat`, `run\dev-free.bat`, `run\plan-status.bat` — thin
wrappers over the existing PowerShell pipeline with a `-PlanTier` parameter, mirroring the style of
`run\full-automation.bat` and `run\verify-local.bat`.

**What this plan deliberately does not do.** No `tenant_id`, no JWT replacing the opaque sessions,
no probabilistic sketches, no in-memory cash drawer in a Durable Object, no Logpush, no separate PII
Worker, no moving `audit_logs` out of the main database (its same-transaction guarantee is worth
more than the isolation). §4 gives the reasoning for each.

---

## 2. Where the system is today (measured 1–8 Sept 2026)

### 2.1 Traffic, compute, storage

| Metric | Value |
| --- | --- |
| Worker requests / day | 12k–17k (peak 16,837 on Sep 7) |
| Worker CPU p50 / p90 / p99 | 2.8 ms / 23–38 ms / 68–171 ms |
| D1 `business-os` queries / 24 h | 66,942 reads · 3,500 writes |
| D1 rows read / 24 h | **285,030,184** (daily range 118 M–277 M; 882 M on Aug 31) |
| D1 rows written / 24 h | 13,291 (9k on quiet days; up to 1.5 M on import/backup days) |
| D1 size / tables / region / replication | 164 MB · 157 tables · APAC · read replication **off** |
| D1 `business-os-import` | 49 kB, ≈8 reads/day |
| KV `CACHE` (7 days) | 36,661 reads · 1,318 writes (≈5.2k / ≈190 per day) |
| Durable Objects | 1.3k–3.9k requests/day · 32–199 errors/day |
| R2 `business-os-assets` (7 days) | 16k GetObject (3.7 GB) · 5k PutObject (1.3 GB) · 26 multipart completes (2.1 GB) |
| Queues (7 days) | ≈340 messages |
| Cron | `0 */6 * * *` (backup) |

Read this table as: **requests are tiny, rows read are enormous, CPU has a heavy tail.** Nothing else
is near a ceiling on either plan.

### 2.2 Where 285 million rows/day go

Top query shapes from `d1QueriesAdaptiveGroups` over a 3-day window (per-day = ÷3), joined to the
code by the read-paths report. "Fix" points at the §5 item that removes the cost.

| # | Query shape (where) | Rows read / 3 d | Calls | ≈ rows per call | ≈ per day | Root cause | Fix |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Product search/list `WITH matched AS …` variants (`lib/familyPagination.ts::buildCtes`, called from `routes/products.ts`, `inventory.ts`, `portal.ts` and `branches.ts`) | ≈150 M | ≈4,000 | 37k | **50 M** | The family CTE is materialized **two to three times** per page (COUNT, ranked page, and `family_members` when a search term is set), joins `products parent`, then `expandSearchResultsToNameSiblings` scans on `lower(trim(name))` which no index covers; `/bootstrap` adds six facet `GROUP BY`s and bypasses the `/search` cache | R1, R2 |
| 2 | Sales-list records count: **six correlated subqueries per row** (`lib/saleRecords.ts::buildSaleRecordsCountSql` — amendments, `audit_logs` minus three suppressions including a `julianday()` self-join, bulk members, returns, return audit rows, return bulk receipts), one statement per 100 ids on every page (production line; `main` has none of it — §15.7) | 86.7 M | 133 | 650k | **≈29 M** | `audit_logs` has **no index at all**, and the suppressions cannot use one; each sales page probes the whole table twice per row | R3 |
| 3 | Backup paging `SELECT * FROM "<t>" ORDER BY rowid LIMIT ? OFFSET ?` (`lib/backup.ts:441`, page 500) | ≈78 M (`branch_batch_stock` 29.5 M, `product_batches` 18 M, `sale_items` 14.8 M, `branch_stock` 6.8 M, `inventory_movements` 5.4 M, `sales` 3.6 M) | 12 runs | — | **26 M** | OFFSET paging is O(N²/page): each page re-reads every earlier row | J1 |
| 4 | `SELECT EXISTS(… products NOT IN branch_stock …)` and siblings in `lib/coreDataInvariants.ts` | 35 M | 4,277 | 8.2k | **11.7 M** | Runs on every isolate cold start (≈1,400/day × 8 statements) | R4 |
| 5 | `product_batches` credit-due JOIN | 31.6 M | 878 | 36k | **10.5 M** | No partial index on the due-date predicate | R5 |
| 6 | `getTrackedProductIds` `SELECT DISTINCT product_id FROM product_batches` | 22 M | 319 | 69k | **7.3 M** | Derived on every call instead of stored | R6 |
| 7 | `products LEFT JOIN branch_stock` aggregate | 20 M | 413 | 48k | **6.7 M** | Aggregates per call what `products.stock_quantity` / rollups can carry | R7 |
| 8 | Lookup `GROUP BY unit / category / brand` (`routes/products.ts:334-350`) | ≈18 M | ≈1,200 | 15k | **6 M** | Facet scans per request, uncached | R2 |
| 9 | Sales stats aggregate | 9 M | 320 | 28k | **3 M** | No daily rollup | R8 |
| 10 | Expiry scan | 8 M | 984 | 8k | **2.7 M** | No partial index on `expiry_date` | R5 |
| 11 | `SELECT COUNT(*) FROM inventory_movements` | 7.4 M | 320 | 23k | **2.5 M** | Count only used for paging | R9 |
| 12 | Loyalty per-customer `IN (…)` over sales/returns/submissions (contacts list, notifications) | 3.2 M | ≈7,000 | — | **1 M** | Points recomputed in JS from raw rows per page | R10 |
| 13 | Full `SELECT key, value FROM settings` | small | 2,322 | ≈150 | ≈0.3 M | Read ad hoc by each consumer (audit, Telegram, Drive, rename cascade, retention), never cached and never versioned | R11 |
| 14 | `import_jobs` reaper `UPDATE`s | 0 rows written | 15,206 | 0 | — | Two UPDATEs per poll that affect nothing | J4 |

Listed shapes ≈ 154 M/day; the remainder is the long tail below. Shapes the read-paths report found
that do not surface as single GraphQL rows but matter as much:

- **Inventory financial join** (`routes/inventory.ts:735-767`): `/inventory/stats` and `/summary`
  LEFT-JOIN two derived tables that aggregate the **entire** `sale_items`+`sales` and
  `return_items`+`returns` history, per call, uncached. Fix R12.
- **Dashboard** (`routes/compat.ts:219-441`): ≈24 statements per load, uncached; a byte-identical
  duplicate of the sales aggregate (`compat.ts:247-251`); `productInRangeClause` runs a correlated
  `sale_items→sales` probe per product row in five queries; `CUSTOMER_REFUND_JOIN`
  (`lib/salesAnalytics.ts:181-186`) aggregates the whole `returns` table **seven times** per load.
  Fix R8.
- **Audit page** (`compat.ts:537-581`): COUNT + ORDER BY `created_at DESC` + three unbounded
  `SELECT DISTINCT` vocabulary scans, on the one table with no index. Fix R3.
- **Stock ledger** (`lib/stockLedgerQuery.ts:173-182`): per returned row, a `COUNT(DISTINCT …)` and
  a suffix `SUM(...) WHERE created_at > m.created_at` over `inventory_movements`, up to 1,000 rows a
  page, plus separate COUNT and summary statements. Fix R12.
- **Contact duplicate sweep** (`lib/contactDuplicates.ts:274`): the whole table into the Worker.
  **Contact points** (`routes/contacts.ts:324-395`): every sale/return/submission/adjustment row for
  the page's customers, summed in JS. Fix R10.
- **Portal AI chat** (`routes/portal.ts:805-816`): 500 product rows + images + ≈8 statements +
  a D1-backed rate-limit read/write per message. Fix R1 (snapshot) + G2/§5.8 (rate-limit binding).
- **Short-word search fallback** (`lib/searchMatch.ts:1112-1134`): a `LIKE '%x%' LIMIT 500` scan
  for any word under three characters; its own header records the live incident *"D1 DB exceeded its
  CPU time limit and was reset"*. Fix R1/F5.

### 2.3 Reads per screen (today)

| Screen | D1 statements | Rows read |
| --- | --- | --- |
| Dashboard (`/dashboard/startup`, 7-day default, uncached) | ≈24 | 5 × products-in-range (correlated EXISTS) + 7 × all returns + ≈10 × sales-in-range + 2 × sale_items-in-range |
| Sales list page (100 rows, 20 s cache) | ≈4 | 100 sales + items + refunds (chunked `IN`, not N+1) — plus the six-subquery records count (#2) |
| Products list page (20 families, 20 s cache) | 8–12 | 2 × the filtered product set + page enrichment |
| POS search keystroke (`/search`) | 8–12 on miss, 1 KV on hit | same as above; + `LIMIT 500` LIKE scan if any word < 3 chars |
| POS first load (`/bootstrap`, uncached) | 15–19 | above + 6 full-catalog facet GROUP BYs |
| Inventory stats | 2 | whole `sale_items`+`sales` and `return_items`+`returns` history + all products |
| Portal catalog page (miss / 30 s hit) | ≈12 / 0 | 2 × visible products + branch_stock + initials GROUP BY / 0 |
| Auth bootstrap | 2 | session join + whole `settings` |

Every authenticated request also pays one indexed `user_sessions ⋈ users ⋈ roles` read
(`lib/auth.ts:197`) and a `waitUntil` touch UPDATE at most every 5 min.

### 2.4 Writes, KV, DO, R2, Queues

- **Writes** are small on ordinary days (13k rows) and dominated by imports and backups otherwise.
  Ten triggers fire on every `products` row change (FTS ×3 tables × 3 events + `name_key`), so one
  product write ≈ 10+ rows written — the multiplier matters for Free's 100k/day.
- **KV** holds version counters (`bumpVersion`), read ≈5k/day and written ≈190/day. The binding
  Free limit is 1,000 writes/day, so any design that adds a KV write per request or per sale is
  out of bounds.
- **DO** (`BroadcastHub`, `SyncUploadSession`) sees 1.3k–3.9k requests/day with 32–199 errors/day
  — the error rate needs its own look (§12 open questions) but is not a quota concern.
- **R2** traffic is backups (multipart) and image reads; well inside the free allowance on both plans.
- **Queues** (`business-os-import` with DLQ, `media`, `backup-assets`) carry ≈50 messages/day.

### 2.5 What an idle browser tab does

From the frontend-transport report:

- `/health` every 30 s (`frontend/src/api/http.ts:958`, `HEALTH_CHECK_INTERVAL_MS`), not paused
  when the tab is hidden, routed to the Worker (`run_worker_first` includes `/health`), and mounted after the cold-start invariants middleware, so it pays the eight SELECTs on every cold isolate (§14.2, R18).
- Offline snapshot every 5 min on `main`: **11 requests**, including the whole catalog and 5,000
  `inventory_movements`; the release line runs the same eleven reads only when the offline outbox is non-empty or on foreground recovery (§16.8).
- ≈124 requests/hour/tab idle on the production line (96 % of it the health probe); ≈257/hour on
  `main` for the first three minutes and ≈407/hour once its import-job poll mounts (§16.5). Five
  production tabs over a 10-hour day ≈ 6k requests, almost all of them the probe — still most of
  the day's traffic, and each cold one costs eight SELECTs.
- WebSocket listeners refetch entire lists on any event; no ETag / `If-None-Match` anywhere;
  storefront search is neither debounced nor cancelled; the cart is client-side and checkout is one
  POST with `client_request_id` (good); two IndexedDB queues.

### 2.6 Structural findings that are not quota problems

- **Sale creation is four sequential D1 calls, not one transaction.** A failure between them can
  leave a header without its stock effects. There is **no broadcast** from sales or returns.
- **Receipt numbers have no UNIQUE constraint**; a same-second race is "accepted".
  `conflictControl` is check-then-write. The real oversell guard is `CHECK (quantity >= 0)`; the
  transfer leg in `routes/branches.ts` still uses a clamped `MAX(0, quantity - ?)` decrement, which
  silently absorbs an oversell instead of failing it.
- **A 50-line stock-in = 50 HTTP requests, 50 audit rows, 50 Telegram sends.** On Free that is also
  50 external subrequests against a cap of 50 per invocation if it were ever batched naively.
- **Backups** full-scan 55 tables every 6 h with OFFSET paging; `shift_sessions` is not in
  `BACKUP_TABLES`; the allowlist is not checked against `sqlite_master`, so new tables are silently
  unprotected. Time Travel (point-in-time recovery, both plans) is not documented as the first-line
  restore.
- **Retention**: append-only tables (`audit_logs` ≈650k rows by the #2 arithmetic,
  `ai_response_logs`, `quota_usage`, import artefacts) have no retention policy.
- **Cold start** runs eight invariant queries (≈8k rows) before serving.
- **Schema/migrations (lineage-sensitive, re-verified 2026-09-08; full table in §18.1)**: production
  is commit **560bfbcb**, the tip of `origin/codex/release-stability-20260907`, deployed 2026-09-07
  with migrations through **0134** (0113 absent by number). `main`'s committed tree stops at 0105
  (an untracked 0106 sits in the working tree); it lacks 0107–0134 and the Worker code that goes with
  them, so every lane this plan spawns forks from the release line. `codex/takeover-20260907` and
  `codex/f40-reconcile-preview-20260908` already hold a **0135**, so this plan's migrations take the
  next free number after a fresh sweep of every ref plus the production `d1_migrations` chain (0136
  at the time of writing), reserved through the fleet ledger before any lane writes one. The live
  build's commit could not be read for this revision (`/api/runtime/version` sits behind Cloudflare's
  managed challenge for non-browser clients); the deployed commit is taken from the recorded
  provenance, as the rules require.

---

## 3. Plan limits that bind (verified against Cloudflare docs, Sept 2026)

| Pool | Workers Free | Workers Paid | Binds today? |
| --- | --- | --- | --- |
| Worker requests | 100,000 / day (error 1027; each route chooses fail-open or fail-closed) | 10 M / month included, then $0.30 / M | No — 17k/day |
| CPU per HTTP request | **10 ms** | 30 s default; up to 5 min with `[limits] cpu_ms` | **Yes** — p90 23–38 ms |
| CPU per cron invocation | **10 ms** | 30 s (< 1 h interval) / 15 min (≥ 1 h interval) | **Yes** — the backup cron |
| Subrequests per invocation | 50 external / 1,000 Cloudflare-service | 10,000 (wrangler.toml pins `subrequests = 10_000`) | Free: yes for per-line Telegram fan-out |
| Cron triggers | 5 | 250 | No — 1 in use |
| Static asset requests | Free and unlimited | Free and unlimited | — |
| `[limits]` block in wrangler config | **Rejected** (error 100328) | Allowed | **Yes** — must be absent on Free |
| D1 rows read | **5 M / day, account-wide, hard since 1 Sept 2026** (errors until 00:00 UTC) | 25 B / month included, then $0.001 / M | **Yes — 55×** |
| D1 rows written | **100k / day, account-wide, hard** | 50 M / month included, then $1 / M | Ordinary days no (13k); import days **yes** (1.5 M) |
| D1 storage | 5 GB total | 5 GB included, then $0.75 / GB-month | No — 0.16 GB |
| D1 read replication (Sessions API) | Free | Free (same rows billing) | Off today |
| D1 Time Travel | Available (retention shorter than Paid; recollection 7 d vs 30 d — verify) | Available | Not used as documented restore |
| Durable Objects | SQLite-backed only; 100k requests / day; 13,000 GB-s / day; storage **own** 5 M rows read / 100k rows written per day; 5 GB | 1 M requests / month included then $0.15 / M; 400k GB-s included; storage billed like D1 | No — 3.9k/day |
| DO CPU per request | Docs describe DOs as having "similar memory and CPU limits" to Workers; the per-plan figure was **not** stated in the pages retrieved — **gate F0 canary** | 30 s default | — |
| KV | 100k reads · **1k writes** · 1k deletes · 1k lists per day; 1 GB | 10 M reads · 1 M writes per month included | No — 190 writes/day, but a design constraint |
| Queues | 10,000 operations / day; **24 h retention** (available on Free since 4 Feb 2026) | 1 M ops / month included then $0.40 / M; 4-day retention default, 14 max | No |
| Workflows | 3,000 steps / day; 10 ms CPU per step | 30 s / 5 min CPU per step | Unused |
| Cache API | Available, uncapped per request | Same | — |
| Workers Logs | 200k events / day | 20 M events / month included | `head_sampling_rate = 1` today |
| R2 | 10 GB · 1 M class A · 10 M class B per month (same on both) | Same | No |
| Images transformations | 5k / month (separate product, same on both) | Same | No |
| Rate Limiting binding | Available | Available | Unused (portal AI rate limit is D1-backed) |
| Cloudflare Access (Zero Trust) | Free up to 50 users | Same | Unused |

Two consequences drive the Free design: **the D1 quotas are account-wide**, so a second or third D1
database adds isolation and size headroom but **no** extra rows; and **the DO storage quotas are a
separate pool**, so a SQLite Durable Object is the one place that adds read/write budget on Free.

---

## 4. The three reference documents, judged against this system

Verdict scale: **Already done** (exists in the codebase), **Applies** (adopt as written),
**Adapt** (adopt with a change the system needs), **Reject** (wrong for a single-organization POS
on this stack), **Later** (right idea, not this program).

### 4.1 "Pure Cloudflare architecture map"

| Reference idea | Verdict | Reasoning and what the plan does instead |
| --- | --- | --- |
| Workers as stateless routers over D1 / KV / R2 / DO / Queues | **Already done** | This is the current shape. The plan makes the *tiering* explicit per table (§5.2) so every read knows which pool serves it. |
| D1 for contacts, transactions, organizations | **Already done** | Two D1 databases (`business-os`, `business-os-import`), 157 tables, append-only migrations. |
| `tenant_id` on every table, never query without it | **Reject** | Single organization (`ORGANIZATION_SLUG = "leangbeauty"`). A tenant column on 157 tables adds a predicate and an index column to every query for zero isolation benefit and a large rows-written cost on Free. If a second business ever arrives, the D1 answer is **database-per-tenant** (a second D1 + a second Worker environment), which needs no schema change now. |
| Separate D1 per large tenant | **Adapt** | Same instinct, different axis: the plan's multi-D1 split is by *coupling*, not tenant (§5.2). Only tables that never JOIN or batch with the atomic cluster may move, per the recorded multi-D1 direction. |
| Wrangler-managed schema migrations | **Already done** | Append-only; LF-only trigger SQL; pre/post assertions on data migrations. |
| KV as an application schema registry | **Reject** | Schemas are TypeScript types and migrations. A KV registry adds a read on cold paths and spends Free's 1,000 writes/day on something git already versions. KV keeps exactly one job here: version counters, and even those move behind a Durable Object with KV as write-behind (§7.1). |
| Data lineage via Logpush | **Later / Paid-only** | Logpush for Workers is not on Free. Lineage is `audit_logs` (same-transaction), retained with an R2 archive (J3). Workers Logs on both plans covers request lineage. |
| Durable Objects for active shifts, cash drawer balances, table mappings | **Adapt** | Shifts are a D1 row with the intentional daily prompt; cash registration is report-only by owner rule. A DO holding drawer balances would create a second ledger, and the two-ledger problem already exists once (branch stock vs batch stock). DOs are used for what they are uniquely good at: real-time fan-out (exists), **receipt sequencing per branch** (W2), **job coordination and budget counters** (J2, G1). |
| Offline sync endpoint accepting batched JSON | **Already done** | `/api/sync/outbox` with `client_request_id` idempotency. Improve with per-device sequence numbers and single-batch replay per sale (W8). |
| Reports via Queues, CSV/PDF into R2, pre-signed URLs | **Adapt** | Reports are JSON today and CSV is produced client-side; only the import-errors CSV is built server-side, in memory. Heavy exports (day report > 1,000 rows, full sales export) become **jobs** streaming to R2 through a `TransformStream`; the UI polls the job row and downloads through a one-time token the Worker validates (no S3 keys needed for pre-signed URLs). On Free the job runs in DO alarm slices (J2). |
| Zero Trust (Access) in front of staff/admin dashboards | **Later, optional** | The app has its own sessions and Google login; Access would double the login and interferes with the PWA service worker, WebSocket upgrade and offline mode. Worth it as defence in depth for operator-only paths (`/api/system/*`, `/api/backups/*`, `/api/import-jobs/*`) as a separate Access application, never on POS paths. Free up to 50 users on both plans. |
| PII masking in logs (Workers AI or regex) | **Applies** | Regex masking at the log sinks (Sentry envelope, `console.*` in queue/import code, Telegram bodies, audit payload previews): phones, membership numbers, emails, tokens. Cheap, tier-independent (§5.8). No Workers AI needed. |
| Strong vs eventual consistency mapping | **Applies** | Sales, stock, loyalty, credit = D1 transactions (`db.batch`). Settings, lists, catalogs = versioned caches. Presence/realtime = DO. |
| Tier lifecycle KV, DO, D1, R2 | **Applies** as a checklist | §5.2 assigns every data family a truth store, a serving layer and a cold store. |
| Unified audit trail in the same transaction | **Already done, made universal** | Audit rows are written in the same batch on most paths; W1 makes it universal for sales and W10 makes audit rows compact (one per business event). |
| Worker-level "distributed joins" (D1 row + KV JSON) | **Adapt, narrowly** | Right for settings, branches, promotion rules and roles (small, versioned, memory-cached). Wrong for product rows: the catalog is a snapshot object (R1), not a KV JSON per product. |
| Edge rate limiting on POS upload endpoints | **Applies** | The Rate Limiting binding (both plans) on `/api/auth/login`, `/api/portal/ai/chat`, `/api/sync/outbox`, `/api/import-jobs/*`; replaces the D1-backed portal AI limiter (saves a write per message). |
| `TransformStream` for large CSV/PDF | **Applies** | Export jobs and backup writer (J1). |
| Isolated PII Worker | **Reject** | One Worker; a module boundary (`lib/contactsPii.ts`) plus sink masking achieves the same review surface without a second deploy. |

### 4.2 "Scaling under resource constraints"

| Technique | Verdict | Where it lands |
| --- | --- | --- |
| Streaming / O(1) memory, single pass | **Applies** | Backups (J1), exports, imports: cursor + slice, never "load the table". Already partly true for imports (`ROWS_PER_IMPORT_CHUNK`). |
| HyperLogLog / Count-Min Sketch | **Reject** | Cardinalities are tens of thousands and the numbers are financial. Exact rollups maintained in the write batch are cheaper *and* correct; a 1 % error on revenue is a bug, not a feature. |
| Run-length encoding, bit-packing, columnar blocks | **Not applicable** | SQLite is a row store. The equivalent levers are **covering indexes** and **narrow SELECT lists** (never `SELECT *` on hot paths; backups excepted). |
| External merge sort | **Not needed** | D1 sorts through indexes; exports page by keyset order on an index. |
| Vectorized execution (fixed-size arrays) | **Analogue applies** | `db.batch` of ≤ 100-parameter statements and chunked `IN` lists (`lib/sqlBinding.ts`). Slice sizes come from `PLAN_LIMITS`. |
| Lazy evaluation / column pruning | **Applies** | List endpoints return only the columns the row renders; detail on demand (`ProductDetailSheet` already does this). |
| Chunked streaming / iterator pattern | **Applies** | Backup and export writers as async generators piped into R2 multipart uploads. |

### 4.3 "Free vs Paid Cloudflare Workers plan"

The verified table in §3 supersedes any figure in that document. Specific corrections and additions
the plan relies on:

- D1 Free limits are **account-wide** and **hard** since 1 Sept 2026, not soft or per-database.
- Queues **are** available on Free (since 4 Feb 2026), with 10,000 operations/day and 24 h retention;
  a message that sits unconsumed for 24 h is gone, so the queue can only be a *trigger*, never the
  source of truth for a job (J2).
- Durable Objects on Free are SQLite-backed only (already true of both classes here) and carry their
  own storage quotas: the second pool.
- Static asset requests are free and unlimited on both plans; the Paid CPU default is 30 s and 5 min
  requires `[limits]`; Free cron CPU is 10 ms (the cron handler must only enqueue); KV's binding Free
  limit is writes (1,000/day), not reads.
- The `[limits]` block makes `wrangler deploy` fail outright on Free (error 100328): a config
  difference, not a code difference.

---

## 5. Target architecture (both tiers share it)

### 5.1 Principles

- **P1. Rows read are the currency.** Every hot read has a budget in rows per call that does not
  grow with catalog or history size. Anything proportional to a table's size runs in a job, not a
  request.
- **P2. Truth in D1, derived in rollups, served from versioned caches.** Rollups are maintained in
  the same `db.batch` as the write that changes them (never by cron), and a verifier job recomputes
  and diffs them so drift is detected, not assumed away.
- **P3. One business event = one batch.** Sale, return, stock-in, transfer, adjustment: header +
  lines + stock + ledger + audit + rollup deltas commit atomically or not at all. Side effects are
  enqueued after commit.
- **P4. Background work is budgeted and resumable.** Every job has a durable row, a cursor, a slice
  size from `PLAN_LIMITS`, and a budget check before each slice. Cron and queues only trigger.
- **P5. The browser is a cache, not a poller.** Versions, ETags and WebSocket patches; an idle tab
  costs ≈0 D1 rows.
- **P6. Same code on both tiers.** Only `PLAN_LIMITS` values and the wrangler config differ. No
  `if (tier === 'free')` in business logic; sizes and toggles come from one table read once per
  isolate.
- **P7. Degrade before the platform does.** The budget meter's zones have defined behaviours and
  the admin can see the zone; the POS keeps selling in every zone (offline outbox in the worst).
- **P8. Identity is preserved.** Batch/lot and branch identity end to end; exactly two canonical
  branches; the one canonical revenue definition; rollups carry the same keys as the ledgers.

### 5.2 Storage topology: what lives where

| Data family | Truth | Served from | Cold / archive | Notes |
| --- | --- | --- | --- | --- |
| Atomic cluster A: products, batches, `branch_stock`, `branch_batch_stock`, lot allocations, `inventory_movements`, sales, sale_items, returns, customers, loyalty, credit | D1 `business-os` | Rollup tables in the same DB (R8, R10, R12); catalog + stock snapshot objects in R2 through Cache API (R1); list payloads through Cache API keyed by version; version counters in isolate memory, then DO, then KV write-behind | R2 backups (J1); Time Travel | Never split across databases: every business write batches across these tables. |
| Settings, branches, promotion rules, roles, permissions | D1 | Isolate memory, TTL 30 s, version-checked (R11) | none | Full `settings` read only on version change. |
| Sessions (`user_sessions`) | D1 | Isolate memory positive cache 60 s keyed by token hash; invalidated by a `sessions` version bump on logout / role change | none | Saves the per-request join on the hottest path; opaque tokens stay (revocable, one indexed read). |
| Audit (`audit_logs`) | D1 `business-os` (same transaction as the event) | Indexed (R3) | R2 monthly NDJSON archive after 12 months (J3) | **Stays in the main DB**: same-batch atomicity is the point of an audit trail. |
| Telemetry: `quota_usage`, `ai_response_logs`, request metrics, meter history | D1, proposed `business-os-telemetry` (optional binding, falls back to `DB`) | none | R2 archive (J3) | Never JOINed with cluster A; safe to move; on Free it adds isolation, not budget. |
| Portal AI configs, portal rate-limit rows | D1, same optional telemetry/portal DB | Snapshot object for the AI catalog (R1) | none | Rate limiting itself moves to the binding. |
| Import staging | D1 `business-os-import` (exists) | none | R2 source files | Unchanged. |
| Images, backups, exports, snapshots | R2 `business-os-assets` | Images binding; Cache API for snapshots | Google Drive mirror | Snapshot keys are content-addressed by version (`snapshots/catalog/<v>.json.gz`). |
| Realtime | DO `BroadcastHub` (exists) | none | none | Gains `{topic, version, patch}` messages (W6). |
| Coordination: receipt sequencing, job runner, budget counters, kill-switch cache | New SQLite DOs (`SaleSequencer` per branch, `JobCoordinator`, `BudgetMeter`) | none | Job rows mirrored to D1 `job_runs` for visibility | DO storage is the second pool on Free (§7.3). |

**Multi-D1 rule** (recorded direction): additional databases are for tables that never JOIN or batch
with cluster A. Free quotas are account-wide, so the split buys isolation, independent Time Travel
and size headroom, not rows. Any new binding is optional in `Env` with a `DB` fallback so the same
code runs with one database or three.

### 5.3 Request lifecycle and the guard chain

Order matters: cheap and platform-level first, D1 last.

1. **Static assets**: served by the platform, free and unlimited, never touch the Worker
   (`run_worker_first` stays limited to `/api/*`, `/uploads/*`, `/health`, `/ws`).
2. **Route table + kill switches**: `ops:flags` read at most once per minute per isolate
   (KV read, or DO-published); a switched-off feature returns 503 with a translated notice before
   any work (G3).
3. **Rate Limiting binding** per route class (login, portal AI, outbox, imports): no D1 involved.
4. **Session resolve**: memory cache, then D1 (one indexed read on miss).
5. **Permission check** from the session's merged permission JSON (exists).
6. **Budget zone check**: zone cached in isolate memory from the meter DO's broadcast; per-route
   policy says what each zone allows (G1).
7. **External-service quota guard** (`quotaGuard`, exists) for Telegram/Images/Cloudinary/Drive.
8. **Handler** through a metered D1 wrapper collecting `meta.rows_read`, `rows_written`, `duration`
   per statement, tagged with the route class.
9. **Response** with `ETag` (version-derived) and `X-BOS-Version-*` headers so the client can bump
   its own versions on writes.
10. **`waitUntil`**: meter flush (batched, at most one DO call per 30 s per isolate), side-effect
    enqueue, session touch (at least 5 min apart), broadcast.

### 5.4 Read architecture

**R1. Catalog and stock snapshot objects.** Two immutable objects, rebuilt on version change
(debounced 10 s, built by the job runner, not on the request path): `catalog` (identity, names,
barcodes, prices, images, units, flags; changes rarely) and `stock` (quantities per product ×
branch × batch; changes per sale). Written to R2 as gzip JSON keyed by version and served by
`GET /api/products/snapshot?kind=catalog&v=…` through the Cache API with immutable caching and
`ETag = version`. The POS searches **client-side** against the catalog it already holds for offline
use; the server `/search` remains for admin filters and for clients without a snapshot. The portal AI
chat reads the same object instead of 500 product rows per message. The stock object is patched
live through WebSocket deltas (W6) and refetched only on version gaps. Cost: one full catalog read
per catalog change instead of ≈37k rows per keystroke.

**R2. Single-pass family pagination and rollup facets.** In `lib/familyPagination.ts` the CTE runs
once with `COUNT(*) OVER ()` (the pattern `stock-in-sessions` already uses at
`routes/products.ts`, stock-in-sessions handler), keyset cursor on `(name_key, id)`, and precomputed `family_key` /
`family_rank` columns maintained on product write so the `products parent` self-join disappears.
`expandSearchResultsToNameSiblings` matches on the indexed `name_key` instead of `lower(trim(name))`.
Unit/category/brand facets come from a `catalog_facets` rollup (maintained in the product write
batch) served through the Cache API keyed on the products version; `/bootstrap` goes through the same
cache wrapper as `/search`. Short-word searches (under 3 chars) are answered from the client-side
prefix index (F5), never by `LIKE '%x%'`.

**R3. Maintained sales records count and audit indexes.** `sales.records_count INTEGER NOT NULL
DEFAULT 0`, incremented inside the same `db.batch()` by every writer that already bumps
`sale_write_revisions` (status, bulk status, bulk update, amendments, add-items, settlement, the
undo appliers) and by the return writers, backfilled once from **all six** sources the production
list counts today — `lib/saleRecords.ts::buildSaleRecordsCountSql`, copied verbatim into the
migration, never re-derived (Appendix A, §15.7). The list then reads one column instead of running
six correlated subqueries per row, two of them `audit_logs` scans with a `julianday()` self-join.
Indexes `audit_logs (entity, entity_id, id)`, `audit_logs (created_at, id)` and
`audit_logs (action, created_at)` (the last serves the notifications poll); the audit page's
vocabularies (`DISTINCT action / entity`) come from a small `audit_vocab` rollup or the Cache API,
never a table scan.

**R4. Invariants once per deploy.** `coreDataInvariants` runs at most once per Worker version:
a marker `invariants:<version>` (KV, 1 read per cold start, 1 write per deploy; or the meter DO)
short-circuits the eight statements. A `POST /api/system/invariants/run` admin action re-runs them
on demand. Cold start does no other D1 work.

**R5. Partial indexes for the scans.** `product_batches (expiry_date) WHERE quantity > 0 AND
expiry_date IS NOT NULL`; the credit-due predicate (`sales (credit_due_date) WHERE <credit status>`,
exact column names confirmed at implementation time from the query text in the GraphQL sample);
`returns (customer_id)`; `customers (phone)` raw column for the lookalike path. Each index costs one
extra row written per affected write, acceptable everywhere except the products FTS triggers, which
already exist.

**R6. `products.is_batch_tracked`.** A flag maintained when batches are created/deleted (in the
same batch), with index `(is_batch_tracked) WHERE is_batch_tracked = 1`, replacing `SELECT DISTINCT
product_id FROM product_batches` on every call.

**R7. Stock aggregates from maintained columns.** `products.stock_quantity` and `branch_stock`
already carry per-product and per-branch totals; list queries read them instead of aggregating
`branch_stock` per call. Family-level stock statistics (`lib/familyStockStats.ts`) become a
`family_stock_rollup` maintained by stock writes and verified nightly (J5).

**R8. `sales_daily_rollup`.** Keyed `(business_date, branch_id, cashier_id)` in the +7 h business
day, columns for count, gross, net, tax, delivery, refunds, cost, credit count/amount, using the one
canonical revenue definition (net sales excluding tax and delivery, refunds subtracted, credit sales
counted). Maintained in the sale / return / cancel batch; dashboards and period series read the
rollup for closed days plus one live aggregate for today. `CUSTOMER_REFUND_JOIN` gets the date and
branch predicates pushed inside the subquery, or a maintained `sales.refund_total`. The duplicate
`allSales` statement (`compat.ts::dashboardSummary`; it is date-scoped, so the values are provably identical) is deleted. `productInRangeClause` is computed once as a
CTE of in-range product ids and reused by the five queries. `/dashboard/startup` goes through
`cachedJsonResponse` keyed on the sales + products versions.

**R9. Paging without `COUNT(*)`.** `has_more` via `LIMIT n+1` or `COUNT(*) OVER ()` on the bounded
page; total counts only from rollups. `SELECT COUNT(*) FROM inventory_movements` disappears.

**R10. `customer_points_rollup`.** `(customer_id, earned, redeemed, adjusted, balance, updated_at)`
maintained in the sale / return / submission / adjustment batch; historical sales imported with the
no-loyalty flag never touch it. Contacts list, notifications loyalty section and the portal read the
rollup. The duplicate-contact sweep pages by keyset and runs as a job, not a request.

**R11. Isolate memory for small reference data.** Settings, branches, promotion rules, roles:
loaded once per isolate, refreshed when the version changes, TTL 30 s as a safety net.

**R12. Product sales rollup and ledger running balance.** `product_sales_rollup (product_id,
sold_qty, sold_net, sold_cost, returned_qty, returned_net, updated_at)` replaces the whole-history
join in `buildInventoryFinancialJoinSql`. `inventory_movements.balance_after` is written at insert
time (per product × branch × batch, so batch identity is kept) and the stock ledger stops running a
suffix `SUM` per row; the ledger's count/summary come from the page window and rollups.

**ETag / 304 on every list GET.** The response ETag is derived from the relevant version counters;
`If-None-Match` is checked from isolate memory before any D1 statement. A 304 costs zero rows.

### 5.5 Write architecture

**W1. Single-batch sale.** The Worker mints the sale id (or accepts the client id for offline
replays), obtains the receipt stamp from the branch's `SaleSequencer` (W2), and commits **one**
`db.batch`: INSERT sale; INSERT items; UPDATE stock (the `CHECK (quantity >= 0)` constraint is the
guard, so an oversell aborts the whole batch); INSERT lot allocations and movements with
`balance_after`; INSERT one audit row; UPSERT deltas into `sales_daily_rollup`,
`product_sales_rollup`, `customer_points_rollup`; UPDATE customer credit balance. `client_request_id`
UNIQUE remains the idempotency key. After commit, `waitUntil` enqueues the Telegram receipt and
publishes the broadcast patch. On failure nothing is persisted and the client keeps the form intact
(owner rule). Returns, cancellations and amendments follow the same shape with their inverse deltas.

**W2. Receipt uniqueness and sequencing.** `CREATE UNIQUE INDEX uq_sales_receipt_no ON sales
(receipt_no)` preceded by a migration pre-assertion that production has no duplicates (and a
documented repair if it does: the later of two same-second receipts moves to the next free second
with an audit row; the bare `YYYYMMDD-HHMMSS` format is unchanged). `SaleSequencer`, one SQLite DO
per branch, issues monotonic second stamps: if the requested second equals the last issued, it
returns last + 1 s. Cost ≈ 200 DO requests/day.

**W3. Compare-and-set, no clamping.** The transfer leg's `MAX(0, quantity - ?)` becomes
`quantity - ?` under the CHECK so an oversell fails loudly. Where the UI must say *which* line
failed, the decrement is `UPDATE … SET quantity = quantity - ? WHERE … AND quantity >= ?` and
`meta.changes = 0` aborts the batch with the line index. `conflictControl` becomes
`UPDATE … WHERE id = ? AND updated_at = ?` inside the batch, 409 on zero rows (W7).

**W4. Bulk stock-in.** `POST /api/inventory/stock-in/sessions/:id/lines:batch` takes up to
`PLAN_LIMITS.stockInLinesPerRequest` lines and commits one batch: N line inserts, N stock updates
with batch identity, N movements, **one** audit row carrying the lines as JSON, **one** Telegram
summary, **one** broadcast. The fast stock-in UI keeps its single add path (owner decision) and
flushes its pending lines in one call. Frontend validation of the line shape gets its backend twin
and a parity test (repository rule).

**W5. Side effects through a queue.** A `SIDE_EFFECTS` queue (or the media queue's pattern):
Telegram sends, Drive mirror, Resend email, image post-processing. The consumer does the external
`fetch` with retry and the circuit breaker (G2). On Free the 24 h retention is acceptable for
notifications; on Paid the retention is 4 days (14 for the DLQ).

**W6. Broadcast patches.** `BroadcastHub` messages become `{topic, version, patch}` for sales,
returns, stock, products, settings. The client applies a patch when `version = local + 1`, else
refetches with `If-None-Match`.

**W7. Optimistic concurrency inside the batch.** See W3.

**W8. Ordered offline replay.** `/api/sync/outbox` accepts `(device_id, seq)`; the server stores the
last applied `seq` per device and holds out-of-order items; each replayed sale is one W1 batch.

**W9. Write-amplification awareness.** Ten triggers fire per `products` row change; `PLAN_LIMITS`
carries the multiplier so import admission control (G6) estimates rows written correctly.

**W10. Compact audit.** One audit row per business event with a JSON detail payload, never one
per line. Detail views expand the payload; the sales list reads `records_count`, not audit rows.

### 5.6 Background work: jobs, backups, retention

**J1. Backups: keyset, incremental, streamed, complete.** Per table `WHERE rowid > ? ORDER BY rowid
LIMIT ?` (O(N) instead of O(N²/page)); incremental runs export only rows past the last high-water
mark for append-only tables (sales, sale_items, movements, audit) and rows with `updated_at` past it
for mutable tables, with a weekly full export; the writer is an async generator piped into the R2
multipart upload. The table allowlist is checked against `sqlite_master` at run time and the backup
**fails** if a non-allowlisted table exists (so `shift_sessions` and any future table cannot be
silently unprotected). Documentation names **Time Travel** as the first-line restore on both plans
and the app backup as the portable export + Drive mirror. Cadence: Paid every 6 h as today; Free
daily incremental + weekly full, run as DO alarm slices.

**J2. Job runner.** `JobCoordinator` (SQLite DO) owns a `jobs` table (kind, cursor, slice size,
status, budget consumed) mirrored to D1 `job_runs` for the admin page. Alarms drive slices; each
slice checks the budget zone first and re-schedules itself; cron only pings the DO, so the cron
invocation stays far under Free's 10 ms. Kinds: backup, retention, snapshot build, rollup verify,
export, import resume, image audit sweep (already sliced in `imageAudit.ts`). On Paid the same job
table can be driven by Workflows for durable multi-step imports and backups (§8.1).

**J3. Retention.** Proposed defaults (owner to confirm, §12): `audit_logs` older than 12 months go
to an R2 NDJSON archive and are then deleted; `ai_response_logs` 90 days; `quota_usage` 60 days;
import artefacts 30 days; `action_history` bounded per scope. All through the job runner in budgeted
slices, with counts logged and the archive object verified before the delete.

**J4. Reaper fix.** The `import_jobs` reaper's two UPDATEs run ≈5,000 times/day and change nothing;
run them only when the coordinator knows a job is active (or after an indexed SELECT of candidate
ids).

**J5. Rollup verifier.** Nightly recompute of the daily, product and customer rollups for the last
N days from the ledgers, diffed against the maintained tables; a mismatch raises a Telegram admin
alert and is logged with the differing keys. This is what makes maintained counters trustworthy.

**J6. Alerts from indexes, once.** Expiry and low-stock alerts computed once daily from the partial
indexes (R5) into a small `alerts_current` table read by the dashboard, not recomputed per load.

### 5.7 Guards and smarts

**G1. Budget meter.** A `meteredD1(env.DB, routeClass)` wrapper accumulates `meta.rows_read`,
`rows_written`, statement count and duration per route class in isolate memory and flushes to the
`BudgetMeter` DO every 30 s (or at 1,000 rows). The DO keeps UTC-day counters in its SQLite storage
(the DO pool, not D1 or KV) for every capped pool: D1 rows read/written, Worker requests, KV writes,
queue operations, DO requests. Ceilings come from `PLAN_LIMITS`; on Paid the "ceiling" is the
included monthly quota pro-rated per day so the same zones mean the same thing. The DO publishes the
zone over `BroadcastHub` and `GET /api/system/plan`; isolates cache it in memory.

| Zone | Threshold (of ceiling) | Behaviour |
| --- | --- | --- |
| normal | under 60 % | Everything on. |
| economy | 60–80 % | Imports, backups, exports and rollup verification pause; snapshot rebuild interval doubles; dashboard served from cache with a `stale` flag; admin banner. |
| critical | 80–95 % | Only POS sale / return / stock-in / login / sync outbox proceed; lists served from cache only (stale if needed); everything else 503 + `Retry-After` and a translated notice. |
| frozen | 95 % and above | POS writes still proceed (they read few rows); all other D1 work refused until the reset; `/health` reports `degraded: d1-quota` so the frontend flips to the offline outbox proactively. |

Both the UTC quota day and the +7 h business day are shown on the readout, because the reset is at
07:00 Phnom Penh time.

**G2. Circuit breakers.** Telegram, Resend, Drive, AI providers, Cloudinary: failure counts in
isolate memory + the meter DO; open for 5 minutes after N consecutive failures; half-open probe;
extends the existing `quotaGuard`.

**G3. Kill switches.** `FLAG_IMPORTS`, `FLAG_BACKUPS`, `FLAG_PORTAL_AI`, `FLAG_SNAPSHOT_BUILD`,
`FLAG_BROADCAST`, `FLAG_SIDE_EFFECTS`: read from `ops:flags` (KV) at most once a minute per
isolate, toggled from the admin Server page (permission-gated), every flip audited. Env vars can
force a flag off at deploy time.

**G4. Per-invocation guards.** An in-process external-subrequest counter (Free: 50) that refuses a
51st with a clear error instead of a platform 1042; slice sizes calibrated so a Free slice completes
in ≈6 ms of CPU (CPU is not observable in-process; slices are sized by work units and calibrated by
tests); snapshot responses streamed from R2, never `JSON.stringify`'d per request.

**G5. Read-shape lint and plan tests.** A pure test parses `cloudflare/src` for `SELECT *` outside
an allowlist, `OFFSET` in loops, `SELECT DISTINCT` without `LIMIT`, and correlated subqueries in
list SQL; a second test applies the migrations to a scratch `better-sqlite3` database, seeds
representative volumes, and asserts `EXPLAIN QUERY PLAN` shows no `SCAN` on the large tables for the
top 30 statements (`test-query-plans-pure.cjs`).

**G6. Import admission control.** Before an import starts, estimate rows read and rows written
(rows × trigger multiplier × index count) and compare with the remaining daily budget. On Free,
either run within budget, or schedule the remainder after 00:00 UTC (the coordinator resumes it),
and tell the operator the schedule in the import UI. On Paid, warn only.

**G7. Cold-start budget.** Only the invariants marker read (R4); settings and roles warm lazily.

**G8. Deploy guard.** `deploy-*.bat` runs `wrangler deploy --dry-run --config <tier config>` first,
checks the config's `PLAN_TIER` matches the requested tier, checks the Free config carries no
`[limits]` and at most 5 crons, and after the health check prints `/api/system/plan` so the operator
sees the tier the Worker believes it is on.

### 5.8 Security hardening taken from the reference documents

- **Rate Limiting binding** on login, portal AI chat, sync outbox and import endpoints (both plans;
  no D1 rows).
- **PII masking** at every log sink (Sentry envelope, console in queue/import code, Telegram bodies,
  audit previews): phone, membership number, email, tokens, card-like digit runs.
- **Access (optional, later)** for operator-only paths as a separate Access application; never on
  POS or portal paths; evaluate service-worker and WebSocket interaction first.
- **Secrets** unchanged: `.dev.vars` through the `sync-secrets.cjs` allowlist; nothing new is
  plaintext.
- **Portal** stays free of admin data and chrome (owner rule); the AI catalog object is built from
  the public projection only.

### 5.9 Frontend transport contract

- **F1. Health polling:** ≈96 % of an idle production tab's requests (§16.8); 30 s becomes 5 min; paused while `document.hidden`; an open WebSocket
  counts as healthy. The server advertises the interval in `/api/system/plan` so Free and Paid can
  differ without a frontend release.
- **F2. Offline snapshot:** rebuilt on `catalog` / `stock` version change (WebSocket) with an
  hourly fallback, only while visible, from the R2 snapshot object with `If-None-Match` (304 when
  unchanged). The 5,000-movement snapshot is kept only if an offline feature actually reads it
  (§12 open question); otherwise it becomes on-demand.
- **F3. ETags everywhere:** every list GET sends `If-None-Match`; every write response carries the
  new versions so the client bumps locally.
- **F4. Patches, not refetches:** WebSocket events carry patches (W6); refetch only on version gaps.
- **F5. Search hygiene:** 250 ms debounce, `AbortController` cancellation, short words answered by
  the client-side prefix index, server minimum two characters.
- **F6. No client keepalives;** session touch stays server-side at 5 min or more (verify the portal
  session has the same throttle).
- **F7. One replay driver** over the two IndexedDB queues with per-device sequence numbers (W8).
- **F8. Cart stays client-side;** checkout stays one POST.

Expected idle cost after F1–F5: ≈15 requests/hour/tab (from ≈124 on the production line and ≈257–407 on `main`, §16.5; R18 takes the probe off the cold path and F9 pins the import poll) and 0 D1 rows.

---

## 6. Work items, ranked

Ranked by rows read saved per day, then by correctness weight. "Tier" says where the item matters:
**Both** (tier-independent), **Free-critical** (Free cannot run without it), **Paid-value** (mainly
latency/headroom on Paid). Effort: S (≤ 1 day for one implementation owner), M (2–4 days), L (a
week or more). Every item lands with its pure test (§10) and, where a surface is touched, both
language packs.

| Rank | Id | Item | Saves (≈/day) | Effort | Risk | Tier | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | R1 | Catalog + stock snapshot objects; POS searches client-side; portal AI reads the object | 50 M rows; most search CPU | L | M (two snapshot kinds must stay consistent; version gaps) | Free-critical, Paid-value | J2 (builder), W6 |
| 2 | R3 | `sales.records_count` (six sources, §15.7) + `audit_logs` indexes + vocab rollup | ≈29 M rows | S | L | Both | next free migration (§11) |
| 3 | J1 | Keyset + incremental + streamed backups; allowlist vs `sqlite_master`; `shift_sessions` covered; Time Travel documented | 26 M rows; cron CPU | M | M (restore path must be re-verified) | Free-critical | J2 on Free |
| 4 | R4 | Invariants once per deploy (marker) | 11.7 M rows; cold-start latency | S | L | Both | none |
| 5 | R5 | Partial indexes: expiry, credit-due, `returns(customer_id)`, `customers(phone)` | 13 M rows | S | L | Both | migration |
| 6 | R6 | `products.is_batch_tracked` | 7.3 M rows | S | L | Both | migration + backfill |
| 7 | R7 | Stock aggregates from maintained columns; `family_stock_rollup` | 6.7 M rows | M | M (rollup drift; J5 covers) | Both | J5 |
| 8 | R2 | Single-pass family CTE, keyset cursor, `family_key`, `catalog_facets` rollup, `/bootstrap` cached | 6 M rows (facets) + halves the remaining search cost | M | M | Both | R1 reduces the call count first |
| 9 | R8 | `sales_daily_rollup`; dashboard cached; refund join scoped; duplicate statement deleted; in-range CTE | 3 M + dashboard long tail | M | M (canonical revenue definition must be encoded once) | Both | J5 |
| 10 | R12 | `product_sales_rollup`; `inventory_movements.balance_after` | inventory stats long tail (whole-history joins) | M | M | Both | J5 |
| 11 | R9 | Paging without COUNT(*) | 2.5 M rows | S | L | Both | none |
| 12 | R10 | `customer_points_rollup`; duplicate sweep as a job | 1 M rows; notifications long tail | M | M (historical-sales no-loyalty flag) | Both | J5 |
| 13 | F1, F2, F5 | Health poll 5 min + hidden pause; snapshot on version change; search debounce/cancel | ≈10k requests; CPU tail; long-tail rows | S | L | Free-critical | R1 for F2 |
| 14 | ETag | ETag / 304 on list GETs; version headers on writes | long-tail rows; CPU | M | L | Both | version authority (§7.1) |
| 15 | W1 | Single-batch sale | correctness (no header without stock effects) | M | M (touches the most important path; behind a flag with A/B replay tests) | Both | W2 |
| 16 | W2 | Receipt UNIQUE + `SaleSequencer` | correctness | S | M (pre-assertion on production data) | Both | migration |
| 17 | W3, W7 | CAS decrement, no clamping; conflict control inside the batch | correctness | S | M | Both | none |
| 18 | W4 | Bulk stock-in endpoint + parity test | 50× fewer requests/audit rows/Telegram sends on stock-in | M | M | Free-critical (subrequests) | W5 |
| 19 | G1 | Budget meter + zones + `/api/system/plan` + admin readout | enabler for every Free gate | M | L | Free-critical, Paid-value | PLAN_LIMITS |
| 20 | J2 | Job runner DO + `job_runs` + cron ping | enabler for J1, J3, J5, R1 on Free | M | M | Free-critical | none |
| 21 | W5, W6 | Side-effects queue; broadcast patches from sales/returns/stock | subrequests off the request path; F4 | M | M | Both | J2 not required |
| 22 | R11 | Isolate memory for settings/branches/rules/roles | 0.3 M rows | S | L | Both | version authority |
| 23 | J4 | Reaper only when jobs are active | 10k wasted statements | S | L | Both | none |
| 24 | J3 | Retention with R2 archive | storage headroom; smaller scans | M | M (deletes; verify archive first) | Both | J2 |
| 25 | J5 | Rollup verifier | trust in 7, 9, 10, 12 | S | L | Both | rollups |
| 26 | G5 | Read-shape lint + `EXPLAIN QUERY PLAN` test | prevents regression | S | L | Both | none |
| 27 | G6 | Import admission control | Free write-wall protection | S | L | Free-critical | G1 |
| 28 | G2, G3, G4 | Breakers, kill switches, subrequest counter | resilience | S | L | Both | none |
| 29 | §5.8 | Rate Limiting binding; PII masking | writes off D1; hygiene | S | L | Both | none |
| 30 | G8, §9 | Tier plumbing: `planTier.ts`, `wrangler.free.toml`, scripts, bats, deploy guard | enabler | M | L | Free-critical | none |
| 31 | J6 | Alerts once daily | dashboard long tail | S | L | Both | R5 |
| 32 | W8, F7 | Ordered offline replay | correctness offline | M | M | Both | W1 |
| 33 | §5.2 | Optional telemetry D1 | isolation | S | L | Paid-value | none |

Expected trajectory of rows read per day, cumulative: after ranks 2–6 ≈ 120 M; after 1 and 8 ≈
20 M; after 7, 9–12, 14, 22 ≈ 3 M. These are the phase gates in §11.

### 6.1 Items added by the system atlas (Part II)

The atlas in §13–§18 adds the items below. They keep their own numbering so that Part I's ranks stay
stable as references; by rows saved, R14 belongs between ranks 7 and 8 above, F9/F10 beside rank 13,
and W13/W11 are the first two items that matter for Free's write and KV walls rather than its read
wall. §19 maps each to the atlas finding it comes from and to both tiers. Phase 0's meter (G1)
re-ranks everything on measured values before Phase 2 starts.

| Rank | Id | Item | Saves (≈/day) | Effort | Risk | Tier | Depends on |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 34 | R18 | `/health` and `/ws` mounted outside the invariants middleware (`app.use('/api/*', ensureCoreDataInvariantsOnce)`), `/health` answered without touching D1 | every cold-isolate health probe stops paying eight SELECTs and the `NOT IN` scan — ≈15,400 probes/day at eight tills, the most frequent request in the system (§16.5) | S | L | Free-critical (10 ms CPU), Paid-value | none |
| 35 | R14 | Inventory summary bounded and paged: batched `branch_stock` read instead of the per-row `json_group_array`, window-bounded sale/return aggregates, page | the heaviest query per call (O(products × history) → O(page)); measured in Phase 0 | M | M (response shape must stay identical for the Inventory page) | Free-critical, Paid-value | feeds R12 |
| 36 | W13 | Revision-trigger rewrite: drop and recreate the 60 counters of 0120/0124/0125 with the restore-mode probe replaced by an integer read from a one-row table, the stock revision triggers scoped to stock-session rows, and one revision family per return row | ≈half the rows written per sale (26 base rows fire 26 upserts + 26 probes today; returns write two families) | M | M (trigger SQL LF-only; parity test on a five-line sale and a return) | Free-critical (100k writes/day), Paid-value | next free migration |
| 37 | F9 | Import-job poll stays event-driven: the release line already polls only while the tracker is mounted with active jobs; a test pins it so `main`'s 12 s idle loop never returns through a merge | guards ≈3,600 requests/day per open tab against regression | S | L | Free-critical | none |
| 38 | F10 | Focus and broadcast storms: `since` cursor on reconnect instead of the 22-channel fan-out; `cache:updated` no longer masquerades as `sync:update`; a matching `users`/`roles` broadcast patches the session instead of re-bootstrapping (fan-out measured on `main`; re-measure on the release line before sizing) | 11 + N requests per tab focus; whole-app refetch on permission edits | M | M | Free-critical | J7 |
| 39 | W11 | Version-counter consolidation: one namespace map, bump only namespaces with a reader, D1 fallback surfaced in the meter | ≈11/15 of today's KV writes; the silent D1 fallback becomes visible | S | L | Free-critical (1,000 KV writes/day), Paid-value | G1 |
| 40 | R13 | Missing hot indexes (`import_jobs`, `sales`, `inventory_movements`, `product_batches`, `shift_sessions`, `sale_items`) and the three redundant ones dropped | the 2-hour notifications scan and every audit page (with R3); branch-scoped sales lists | S | L (write cost per index is deliberate) | Both | next free migration |
| 41 | R15 | Expression indexes for `lower(trim(name))` and `localDateExpr(created_at)`; report groupings served from them | the contacts, fees and returns report groupings stop scanning | S | L | Both | migration |
| 42 | R17 | Notifications summary split per widget and cached; audit list facets per cache version, has-more instead of COUNT(*) | notifications and audit long tail | M | L | Both | R3, R10 |
| 43 | R16 | `NOT IN (SELECT …)` → `NOT EXISTS … LIMIT 1` in `coreDataInvariants` and `importRetention` | one `branch_stock` materialisation per cold start; the staging sweep | S | L | Both | none |
| 44 | W12 | Stock-write library: one path for A, B and M ledgers with the A↔B invariant, `lib/branchScope.ts`, transfers that move lot rows; the nine A-only writers routed through it, including the org-bootstrap backfill in `coreDataInvariants.ts` that today creates `branch_stock` rows with no lot (§17.4) | correctness (the "28 here, 0 there" fork) | L | H (touches every stock writer; behind a flag with replay parity tests) | Both | W1, W3; N45's owner |
| 45 | G9 | Compat default-deny auth with an explicit public allowlist; `requirePermission`/`requireTier` factories; a "no route without a guard" test; the review/view tier key sets generated into both packages from one source so the hand-kept copies cannot drift again (§17.1) | closes the bug class that exposed `/api/transfers` | S | M (enumerate the genuinely public compat paths first) | Both | none |
| 46 | W14 | `USER_NAME_SNAPSHOTS` extended to the 0116–0133 tables so a username rename reaches every history surface | correctness | S | L | Both | none |
| 47 | W15 | `customer_receivables.sale_id` added and backfilled by the composite key, with a control-set assertion | correctness (no silent sales↔receivables split) | S | M (backfill on production data) | Both | migration |
| 48 | W16 | Merge-aware rollups: on a product merge the rollup rows are reparented to the survivor | correctness of R7/R10/R12 after merges | S | L | Both | N50–N54 |
| 49 | J7 | BroadcastHub hardening: coalescing window, `reportError`, per-tab `since` cursor | fewer DO requests (Free's 100k/day DO wall) and no reconnect refetch storms | M | M | Both | none |
| 50 | J8 | `SyncUploadSession` alarm cleanup for abandoned uploads | DO storage hygiene | S | L | Both | none |
| 51 | F11 | Patch after mutation, entity by entity (sales, then products): apply the server row instead of wiping the cache group | the largest interactive request source on a busy day | M–L | M–H | Both | none |
| 52 | F14 | Idempotency-aware write dedupe key | removes "two writes became one" surprises | S | L | Both | none |
| 53 | F12 | List virtualisation for products, movements, contacts, sales; default page sizes lowered (`pageSize: 10000` → paged) | client memory and latency; rows read on the two heaviest reads | M | L–M | Paid-value, Both once page sizes drop | none |
| 54 | F13 | Portal bundle split (second Rollup input, own service-worker scope) | customer first paint; admin deploys stop evicting the storefront shell | M | M | Paid-value | none |
| 55 | G10 | Zombie retirement (`customTables.ts` — already gone on the release line, so the rule is that no merge from `main` resurrects it — KV read-through, `analytics.ts`, video stub, `loyalty_points_reset_log`, redundant indexes) and `.gitattributes` line endings, at a checkpoint | audit trustworthiness; −≈400 LOC | S | L (peers' dirty files) | Both | checkpoint |
| 56 | G12 | `importEngine.ts` decomposition along the five stock pipelines, after W12 | structural | L | M | Both | W12 |
| 57 | R19 | Shift figures materialised at close (rollup columns on `shift_sessions`, written in the close batch); only the open shift is reconciled live, so `GET /api/shifts/` stops running `shiftReconciliation` per listed shift | one aggregate pass per list instead of O(N) over sales, returns and fees | S | L | Both | none |
| 58 | R20 | Reports search through FTS5 or a maintained `search_key` column instead of `instr(lower(a \|\| ' ' \|\| b …))`; the snapshot `MAX(id)` taken once per session, not with the full predicate on every first page | the full-table scan every report search performs today | M | L | Both | R15 |
| 59 | W17 | Merge re-parenting completeness: `return_items`, `return_item_batch_allocations`, `stock_transfers`, `stock_row_moves` and the RFID tables repointed to the survivor inside the same fold batch and captured in `MergeReversal` for undo; a side-by-side audit of every `customer_id` table for the customer merge | correctness — the owner's rule that a resolution moves every linked record (§17.3) | S | L | Both | W16 |
| 60 | J9 | `undo_snapshots` retention beside `action_history` (same 180-day window, by `created_at`) | unbounded growth of tens-of-KB reversal rows that outlive their owner (§17.2) | S | L | Both | none |
| 61 | G11 | One chained `test:pure` command for the Worker harness; pure tests for the two Durable Object classes, the queue consumer and DLQ path, the cron runner and the server-side undo appliers; regression pins for the 6 September revenue rule and the event-driven import tracker | the sweep stops being a shell loop; the highest-blast-radius paths get named tests (§17.8) | M | L | Both | none |
| 62 | G13 | One deploy stamp (commit, dirty flag, tier) substituted at build time and returned identically by `/health` and `/api/runtime/version` | deploy provenance without a D1 read; the `-dirty` triage gets a live signal on both endpoints (§17.7) | S | L | Both | R18 |

---

## 7. The Free variant, maximized

The Free variant is not a crippled fallback. It is the same system, sized so that every free pool is
used up to a safe fraction of its ceiling, with the Durable Object pool deliberately used as the
second budget and the CPU escape hatch.

### 7.1 Budget plan per pool

| Pool | Free ceiling | Today | Target after plan | How |
| --- | --- | --- | --- | --- |
| Worker requests | 100k / day | 17k | ≤ 8k (p95 day) | F1, F2, W4; static assets never count |
| CPU per request | 10 ms | p90 23–38 ms | p99 ≤ 8 ms on request paths | R1 (no per-request catalog serialization), snapshots streamed from R2, W1 (fewer round trips), bcrypt and heavy work in DO or slices (§7.3); the docs' "built-in flexibility for infrequent overruns" is not designed against, only tolerated for logins |
| D1 rows read | 5 M / day, account-wide | 118–285 M (882 M import day) | ≤ 3 M ordinary day; imports admitted against the remainder | §5.4 items; G6 |
| D1 rows written | 100k / day | 13k (1.5 M import day) | ≤ 60k ordinary day; imports scheduled across UTC days | G6, W10 (one audit row per event), W9 multiplier |
| DO requests | 100k / day | 3.9k | ≤ 20k | meter flushes (≤ 1 per isolate per 30 s), sequencer (≈200), job slices, broadcast |
| DO storage rows | 5 M read / 100k written per day (own pool) | ≈0 | meter counters, job state, optional catalog mirror (§7.3) | second pool |
| DO compute | 13,000 GB-s / day | small | small | hibernating hub is not billed |
| KV | 100k reads / **1k writes** per day | 5.2k / 190 | ≤ 10k / ≤ 400 | version authority moves to the `BroadcastHub` DO with KV **write-behind** debounced to ≤ 1 write per key per 60 s; a lost debounce only delays cache invalidation by ≤ 60 s because WebSocket versions still propagate and Cache API TTLs are short; flags read once per minute per isolate |
| Queues | 10,000 ops / day; 24 h retention | ≈150 ops | ≤ 2k ops (≈600 side-effect messages × 3 ops) | W5; jobs keep state in the DO, queue only triggers |
| Cron | 5 triggers; 10 ms CPU each | 1 | 2 (`*/15 * * * *` job-runner ping; `30 17 * * *` = 00:30 Phnom Penh daily backup ping) | J2; cron does nothing but ping |
| Subrequests | 50 external / 1,000 internal per invocation | per-line Telegram fan-out | ≤ 3 external per request path | W4, W5; G4 counter |
| Cache API, static assets | unlimited | used for search/portal | used for every versioned GET and both snapshots | R1, R2, R8, ETag |
| R2 | 10 GB; 1 M class A; 10 M class B per month | ≈0.7 GB puts/week | + one snapshot object per catalog/stock version (debounced) | R1, J1 incremental backups shrink puts |
| Images | 5k transforms / month | in use | unchanged | quotaGuard exists |
| Workers Logs | 200k events / day | sampling 1 | sampling 1 is fine at ≤ 8k requests if console noise is capped; Free config sets `head_sampling_rate = 0.5` as a margin | config |
| Time Travel | available | not documented | first-line restore | J1 docs |

**Rows-read arithmetic for the ordinary day** (targets, to be confirmed by the Phase 0 meter):
sessions ≈ 8k requests × 1 row (memory cache hits cost 0) ≈ 10k; POS sales ≈ 200 × ≈ 60 rows
(items, stock, lots, rollup upserts read their own rows) ≈ 12k; admin lists at 20 s / 60 s cache
with keyset pages ≈ 1,000 page loads × ≈ 300 rows ≈ 0.3 M; search on cache miss ≈ 500 × ≈ 800
rows (FTS-narrowed single CTE) ≈ 0.4 M; dashboard from rollups ≈ 300 loads × ≈ 200 ≈ 60k; portal
bootstrap misses ≈ 200 × 1,000 ≈ 0.2 M; jobs (snapshot rebuilds on change, daily incremental backup,
verifier window, retention slice) ≈ 1 M; long tail ≈ 0.5 M. **Total ≈ 2.5 M**, half the ceiling.
Import days are handled by admission control, not by hoping.

### 7.2 What differs from Paid

Only configuration and the `PLAN_LIMITS` row. Proposed Free values (Paid in parentheses; the first
block reuses the superseded Sept 3 table where its numbers still match the code):

| `PLAN_LIMITS` field | Free | Paid | Consumer |
| --- | --- | --- | --- |
| `rowsPerImportChunk` | 150 | 600 | `importEngine.ts:259` |
| `preflightMaxRows` | 125 | 500 | `importEngine.ts:267` |
| `stockActionMaxUnits` / `stockActionMaxRows` | 60 / 480 | 480 / 1920 (code today; `wrangler.toml`'s A4 ledger comment says 240 — reconcile at implementation) | `importEngine.ts:4175-4176` |
| `maxAssetsPerBackup` | 20 | 100 | `backup.ts:36` |
| `maxImageDeletesPerReset` | 200 | 500 | `system.ts:38` |
| `backupTablePageSize` | 200 | 500 | `backup.ts:441` (keyset after J1) |
| `backupCadence` | daily incremental + weekly full | every 6 h full (or incremental, operator choice) | J1 |
| `stockInLinesPerRequest` (new) | 25 | 200 | W4 |
| `telegramSendsPerRequest` (new) | 1 | 1 | W4/W5 (same on both: summaries, not fan-out) |
| `jobSliceRows` (new) | 200 | 2,000 | J2 |
| `snapshotRebuildMinIntervalSec` (new) | 300 | 60 | R1 |
| `listCacheTtlSec` / `dashboardCacheTtlSec` (new) | 60 / 120 | 20 / 20 | Cache API wrappers |
| `healthPollMs` / `snapshotIntervalMs` (new, advertised to the frontend) | 300,000 / 3,600,000 | 120,000 / 900,000 | F1, F2 |
| `importAdmissionControl` (new) | enforce | warn | G6 |
| `kvWriteDebounceSec` (new) | 60 | 10 | version write-behind |
| `meterFlushSec` (new) | 30 | 10 | G1 |
| `externalSubrequestsPerInvocation` (new) | 50 | 10,000 | G4 |
| `cpuMsPerInvocation` / `subrequestsPerInvocation` (readout only) | 10 / 50 | 300,000 / 10,000 | `/api/system/plan` |
| `d1DailyRowsReadCeiling` / `d1DailyRowsWrittenCeiling` | 5,000,000 / 100,000 | 833,000,000 / 1,666,000 (monthly ÷ 30, for one readout) | G1 zones |
| `kvWritesPerDay` | 1,000 | 33,333 | G1 |
| `queueOpsPerDay` (new) | 10,000 | 33,333 | G1 |
| `workerRequestsPerDay` (new) | 100,000 | 333,333 | G1 |
| `doRequestsPerDay` (new) | 100,000 | 33,333 | G1 |
| `longAiImagePassesEnabled` | false | true | future manual "run all now" actions |

Config differences are listed in §9.1. Nothing else differs: same bindings, same DOs, same routes,
same migrations, same frontend build.

### 7.3 Second-pool tactics: Durable Objects with SQLite

- **Meter and job state live in DO storage**, so counting the budget never spends the budget.
- **Password verification** (`bcryptjs` in `routes/auth.ts`, `routes/users.ts`, `portalAccounts.ts`)
  runs through a stateless `AuthVerifier` DO call when the tier's CPU ceiling is below the hash
  cost; the same code path on Paid calls the function inline. Logins are a handful per day; if gate
  F0 shows the DO shares the 10 ms cap, the fallback is the documented tolerance for infrequent
  overruns plus a lower cost factor for new hashes, which is a security trade-off to put to the
  owner, not to make silently.
- **Imports, backups, exports and the snapshot builder** run as alarm-driven slices inside the
  `JobCoordinator`, each slice sized by `jobSliceRows`; the D1 rows they read still count against
  D1, but their CPU and their state do not touch the Worker request budget.
- **Optional catalog mirror**: a `CatalogIndex` DO holding a SQLite copy of the public catalog with
  its own FTS index would move server-side search rows from the D1 pool to the DO pool entirely.
  It is optional because R1 (client-side search over the snapshot) removes most of the need; adopt it
  only if the Phase 2 measurement shows server search still above ≈0.5 M rows/day. FTS5 availability
  inside DO SQLite must be verified first; the fallback is an in-memory index rebuilt from the
  snapshot object on DO wake.

### 7.4 Free readiness gates (all must be green before any switch)

| Gate | Proof |
| --- | --- |
| F0 | DO CPU canary: on a Free-plan test account, a DO that spends 200 ms CPU per request either succeeds (escape hatch confirmed) or fails (plan falls back to ≤ 8 ms slices everywhere and the bcrypt trade-off goes to the owner). |
| F1 | Meter live for 7 consecutive days: D1 rows read p95 day ≤ 3 M and rows written ≤ 60k on non-import days; GraphQL agrees with the meter within 5 %. |
| F2 | Workers analytics CPU p99 ≤ 8 ms over 7 days on request paths (`cpuTimeP99`), with the heavy paths moved to jobs. |
| F3 | Requests p95 day ≤ 40k. |
| F4 | `wrangler deploy --dry-run --config wrangler.free.toml` green; `test-free-config-pure.cjs` green (no `[limits]`, `PLAN_TIER = "free"`, ≤ 5 crons, consumer batch sizes ≤ the Free table). |
| F5 | Every pure test in §10 green in both packages on committed HEAD in an isolated worktree. |
| F6 | Rehearsal: the Free config deployed to a **second** Cloudflare account (Free) against a Time-Travel/export copy of production, exercised for one business day by the POS flow, the daily backup and one small import; nothing errors and the meter stays under 60 %. (Creating that account and copying data are user actions.) |

### 7.5 What happens at the wall

If, despite the gates, the account exceeds 5 M rows read: D1 returns the documented error
(`exceeded D1's free tier daily row read limit`) on queries until 00:00 UTC (07:00 Phnom Penh).
Design for it explicitly: `/health` reports `degraded: d1-quota` (from the meter's frozen zone or
from the first such error observed), the frontend switches the POS to its existing offline outbox
(sales queue locally, replay after reset), lists serve from Cache API with a `stale` badge, and the
admin sees the countdown to the reset. Nothing is lost; the day's sales replay in order (W8). The
same signal exists for the request wall (error 1027) and the write wall.

---

## 8. The Paid variant, maximized

### 8.1 What Paid buys and how the plan uses it

| Capability | Use in the plan |
| --- | --- |
| `[limits] cpu_ms = 300000` (5 min) and `subrequests = 10_000` | Kept. Operator-triggered long actions (a full backup now, a re-verification, a large export) may run to completion in one request, still sliced internally so a failure resumes rather than restarts. |
| Queues: 1 M ops/month included, 4-day retention default, 14 max, consumer concurrency | `SIDE_EFFECTS` and DLQ keep messages for days; `message_retention_period` raised to 14 days on the DLQ so an outage never loses a notification; consumers may run concurrently. |
| Workflows (30 s / 5 min CPU per step, durable retries) | Imports and backups as Workflows over the same `job_runs` table: each chunk a step, automatic retry, no alarm bookkeeping. The DO runner remains for Free and as the fallback. |
| D1 read replication (Sessions API, free) | `withSession('first-primary')` on admin/POS (atomic cluster reads must not lag), `first-unconstrained` on portal reads (catalog lag of seconds is fine). Primary is APAC, which is where the business is; replicas help portal readers elsewhere. Enable after measuring: replication does not change rows billing. |
| 250 cron triggers, 30 s / 15 min CPU | One cron per job: backup every 6 h, job-runner ping every 5 min, retention nightly, rollup verifier nightly, alerts daily, snapshot sanity hourly. Cron handlers still do nothing but ping, so the same code runs on Free. |
| Durable Objects: 1 M requests/month included | Meter flush every 10 s; sequencer; job runner; broadcast patches with no request-count anxiety. |
| Workers Logs: 20 M events/month | `head_sampling_rate = 1`, structured logs with the route class and rows read per request, so the meter and the logs agree. |
| Analytics Engine | Meter history as data points (route class, rows, duration) for the admin's usage charts and for the GraphQL cross-check. |
| Smart Placement (`placement = { mode = "smart" }`) | Free on both plans; with D1 in APAC and users in Cambodia it should be neutral to positive; enable in both configs behind a measurement (p50 latency before/after), remove if it regresses. |
| Larger `PLAN_LIMITS` | Import chunks 600, stock-in lines 200, job slices 2,000, caches 20 s, snapshot rebuild 60 s. |

### 8.2 Cost model

| Item | Now | After plan |
| --- | --- | --- |
| Workers Paid base | US$5 / month | US$5 |
| Worker requests | ≈0.5 M / month (10 M included) | ≈0.25 M |
| D1 rows read | ≈8.5 B / month (25 B included); an import-heavy month could reach ≈26 B (≈US$1 overage) | ≈0.1 B |
| D1 rows written | ≈0.4 M ordinary + import days (50 M included) | same or lower (one audit row per event) |
| D1 storage | 0.16 GB (5 GB included) | slightly higher (rollups, indexes), then lower (retention) |
| DO, KV, Queues, R2, Images | inside included / free allowances | same |
| **Total** | **US$5 / month** | **US$5 / month** |

On Paid the plan does not save money at this scale. It buys: dashboard ≈24 statements → ≈4 and
p99 request CPU from ≈170 ms toward ≈10 ms; import days that no longer approach 1 B rows; a sale that
is one transaction; unique receipts; backups that cover every table and finish in O(N); and the
ability to move to Free, or to a second Free account for a second business, without a rewrite.

---

## 9. Configuration, scripts and `run\*.bat`

### 9.1 The two wrangler configs

`cloudflare/wrangler.toml` stays the Paid config and the default (`wrangler deploy` with no
`--config` always reads it, so the Free config is never picked up by accident).
`cloudflare/wrangler.free.toml` is the Paid file with exactly these differences and nothing else
(the superseded Sept 3 file already had this shape; it is re-based, not re-invented):

| Section | `wrangler.toml` (Paid) | `wrangler.free.toml` (Free) |
| --- | --- | --- |
| `[limits]` | `cpu_ms = 300000`, `subrequests = 10_000` | **absent** (error 100328 otherwise) |
| `[vars] PLAN_TIER` | `"paid"` | `"free"` |
| `[triggers] crons` | up to 6 (backup 6 h, runner 5 min, retention, verifier, alerts, snapshot sanity) | 2 (runner ping every 15 min, daily backup ping) |
| `[[queues.consumers]] max_batch_size` | import 5, dlq 10, media 5, backup-assets 1 | import 2, dlq 3, media 2, backup-assets 1 (consumers process batches sequentially, so a batch sized for a 5-minute budget repacks several chunks into one 10 ms window) |
| `[[queues.consumers]] message_retention_period` (DLQ) | 14 days | platform 24 h (not configurable) |
| `[observability] head_sampling_rate` | 1 | 0.5 |
| `[placement]` | `mode = "smart"` (measure) | same |
| Everything else: name, routes, assets, D1 ×2, R2, Images, Analytics Engine, KV, queue producers, both DO bindings and `new_sqlite_classes` migrations, other vars | identical | identical |

A pure test (`test-free-config-pure.cjs`) parses both files and asserts the table above holds, so a
future edit to one file cannot silently drift from the other.

### 9.2 `PLAN_TIER` and `PLAN_LIMITS` (revived without the collision)

The Sept 3 design (`cloudflare/src/lib/planTier.ts` at `75092337` / `40518293` / `dafe83e6`) is
sound: `PLAN_TIER` read once per isolate, default `'paid'`, one `PlanLimits` table, a
`getPlanLimits(env)` accessor, `GET /api/system/plan` readout, and `test-plan-tier-matrix-pure.cjs`
pinning the table to `lib/sqlBinding.ts`. It was excluded from production only because its lineage
also carried `0106_barcode_aliases.sql`, which collides with production's applied
`0106_return_replacement_sales.sql`.

Revival procedure (implementation lane, not this document):

1. `git show <sha> --stat` for the three commits; take **only** `cloudflare/src/lib/planTier.ts`,
   `cloudflare/scripts/test-plan-tier-matrix-pure.cjs` and `cloudflare/wrangler.free.toml` with
   `git checkout <sha> -- <those paths>`; never `cherry-pick` the commits and never touch
   `cloudflare/migrations/` from that lineage.
2. Re-base the numbers to the code as it is today (§7.2 table; reconcile `stockActionMaxUnits`
   480 vs the A4 ledger's 240).
3. Wire the consumers (`importEngine.ts`, `backup.ts`, `system.ts`, new W4/J2/G1 code) to
   `getPlanLimits(env)`; the module-level constants become the Paid defaults only.
4. Add the new fields from §7.2 and the readout on the admin Server page with both language packs.

### 9.3 `cloudflare/package.json` scripts (additions)

```json
"deploy:paid":     "node scripts/with-wrangler-auth.cjs wrangler deploy --config wrangler.toml",
"deploy:free":     "node scripts/with-wrangler-auth.cjs wrangler deploy --config wrangler.free.toml",
"deploy:dry:paid": "node scripts/with-wrangler-auth.cjs wrangler deploy --dry-run --config wrangler.toml",
"deploy:dry:free": "node scripts/with-wrangler-auth.cjs wrangler deploy --dry-run --config wrangler.free.toml",
"dev:paid":        "node scripts/with-wrangler-auth.cjs wrangler dev --local --config wrangler.toml",
"dev:free":        "node scripts/with-wrangler-auth.cjs wrangler dev --local --config wrangler.free.toml",
"verify:tier":     "node scripts/check-tier-config.cjs",
"plan:status":     "node scripts/plan-status.cjs"
```

`deploy` (no suffix) keeps its current meaning (Paid) so nothing existing changes.
`check-tier-config.cjs` takes `--tier paid|free`, parses the matching TOML and enforces §9.1;
`plan-status.cjs` reads the token from the gitignored `.wrangler-auth.local`, queries the same
GraphQL datasets the evidence in §2 came from (Workers invocations, D1 rows, KV, DO, Queues) for
today (UTC) and prints usage against the requested tier's ceilings plus the zone. It prints no
secrets.

### 9.4 `run\*.bat` (proposed contents)

All scripts mirror `run\verify-local.bat`: resolve `ROOT`, call the PowerShell implementation with
`-NoProfile -ExecutionPolicy Bypass`, honour `BUSINESS_OS_NO_PAUSE`, exit with the step's code.
The PowerShell scripts gain one parameter each:
`[ValidateSet('paid','free')] [string]$PlanTier = 'paid'`.

`ops\scripts\powershell\full-automation.ps1` changes: step "verify" runs `npm run verify:tier --
--tier $PlanTier`; a new step "dry-run deploy" runs `npm run deploy:dry:$PlanTier`; the deploy step
runs `npm run deploy:$PlanTier`; after the health check a new step fetches `/api/system/plan` and
fails if the reported tier differs from `$PlanTier` (G8). Everything else (install, typecheck,
build, remote migrations for both databases, secrets sync, health poll) is unchanged. Deploys remain
**production actions gated by explicit user authorization**, run from committed HEAD in an isolated
worktree per the recorded deploy procedure.

`run\deploy-paid.bat`

```bat
@echo off
chcp 65001 >nul 2>&1
setlocal
REM Full release pipeline for the Workers PAID configuration (wrangler.toml):
REM verify:tier paid -> install -> typecheck -> tests -> build -> remote migrations
REM (both D1s) -> secrets sync -> dry-run deploy -> deploy -> health -> plan readout.
REM Production action: run only with explicit authorization, from committed HEAD.
if defined BUSINESS_OS_REPO_ROOT (set "ROOT=%BUSINESS_OS_REPO_ROOT%") else (for %%I in ("%~dp0..") do set "ROOT=%%~fI")
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "BUSINESS_OS_PLAN_TIER=paid"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\full-automation.ps1" -PlanTier paid %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (echo [DONE] PAID deploy finished and the Worker reports tier=paid.) else (echo [ERROR] PAID deploy failed. Review the step above.)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
```

`run\deploy-free.bat` is identical with `free` in place of `paid` and this extra guard before the
PowerShell call, because a Free deploy onto a Paid account is harmless but a Paid deploy onto a Free
account fails, and the reverse switch has a required order (§9.5):

```bat
echo This deploys wrangler.free.toml (no [limits], PLAN_TIER=free).
echo If the Cloudflare account is still on Workers Paid this is safe; if it is on Free,
echo make sure the queues were drained and the readiness gates in the plan are green.
```

`run\verify-paid.bat` / `run\verify-free.bat`

```bat
@echo off
chcp 65001 >nul 2>&1
setlocal
REM Local-only verification for one plan tier: verify:tier -> install -> typecheck both
REM packages -> pure tests -> frontend build -> dry-run deploy with that tier's config.
REM Never touches D1, secrets or deploy.
if defined BUSINESS_OS_REPO_ROOT (set "ROOT=%BUSINESS_OS_REPO_ROOT%") else (for %%I in ("%~dp0..") do set "ROOT=%%~fI")
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%\ops\scripts\powershell\verify-local.ps1" -PlanTier free %*
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if "%EXIT_CODE%"=="0" (echo [DONE] FREE verify finished - nothing was deployed.) else (echo [ERROR] FREE verify failed. Review the step above.)
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
```

`run\dev-paid.bat` / `run\dev-free.bat`

```bat
@echo off
chcp 65001 >nul 2>&1
setlocal
REM Start the Worker locally with the FREE config (wrangler dev --local, port 8787) and the
REM frontend dev server (Vite 5173, proxies /api to the Worker). Two windows; close both to stop.
if defined BUSINESS_OS_REPO_ROOT (set "ROOT=%BUSINESS_OS_REPO_ROOT%") else (for %%I in ("%~dp0..") do set "ROOT=%%~fI")
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
start "business-os worker (free)" cmd /k "cd /d "%ROOT%\cloudflare" && npm run dev:free"
start "business-os frontend" cmd /k "cd /d "%ROOT%\frontend" && npm run dev"
echo Worker: http://localhost:8787   Frontend: http://localhost:5173   (tier: free)
exit /b 0
```

`run\plan-status.bat`

```bat
@echo off
chcp 65001 >nul 2>&1
setlocal
REM Prints today's usage (UTC) against the Free and Paid ceilings from Cloudflare analytics,
REM plus the zone the budget meter would report. Read-only; needs cloudflare\.wrangler-auth.local.
if defined BUSINESS_OS_REPO_ROOT (set "ROOT=%BUSINESS_OS_REPO_ROOT%") else (for %%I in ("%~dp0..") do set "ROOT=%%~fI")
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
pushd "%ROOT%\cloudflare"
node scripts\plan-status.cjs %*
set "EXIT_CODE=%ERRORLEVEL%"
popd
if not "%BUSINESS_OS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
```

`run\README.md` gains one paragraph per script; `.claude/launch.json` gains a `worker-dev-free`
entry (port 8787, `npm run dev:free`) so a browser preview can target either config.

### 9.5 Switching tiers safely

**Paid to Free** (order matters):

1. Gates F0–F6 green; the meter has shown two consecutive weeks under 60 % of the Free ceilings
   while still on Paid (the meter uses the Free ceilings for its readout when asked).
2. Finish or pause running jobs; drain `business-os-import-dlq` and `business-os-backup-assets`
   (Free retention is 24 h; anything older is lost at the switch).
3. `run\deploy-free.bat` **while the account is still Paid** (the Free config runs fine on Paid).
4. Downgrade the account plan in the Cloudflare dashboard (user action). The deployed script now
   has no `[limits]`, so nothing rejects.
5. Watch `run\plan-status.bat` and the admin readout for 48 h; the first UTC reset is at 07:00
   Phnom Penh.

**Free to Paid:** upgrade the plan in the dashboard first (user action), then `run\deploy-paid.bat`
(the `[limits]` block needs Paid at deploy time). Both directions keep the SQLite Durable Object
classes and all bindings; no migration runs for a tier switch.

---

## 10. Tests and verification

New pure tests under `cloudflare/scripts/` (each runnable alone with `node`, and added to the
sweep):

| Test | Proves |
| --- | --- |
| `test-plan-tier-matrix-pure.cjs` (revived) | Both tier rows complete; Free ≤ Paid on every sizing field; `d1MaxBoundParams` pinned to `sqlBinding.ts`. |
| `test-free-config-pure.cjs` | §9.1 differences hold between the two TOML files and nothing else differs. |
| `test-budget-meter-zones-pure.cjs` | Zone thresholds, UTC day rollover, pro-rated Paid ceilings, per-route zone policy. |
| `test-sale-single-batch-pure.cjs` | The statement list for a sale (and return, cancel, amendment) contains header, items, stock, lots, movements with `balance_after`, one audit row and every rollup delta; deltas sum to zero across a sale + its full return; a CHECK failure yields no partial list. Discriminating inputs: a same-second pair of sales, an oversell by one unit, a credit sale. |
| `test-receipt-sequencer-pure.cjs` | Monotonic stamps, same-second bump, format unchanged, per-branch isolation. |
| `test-rollup-verifier-pure.cjs` | Recompute equals maintained on fixtures; injected drift is reported with keys. |
| `test-keyset-backup-pure.cjs` | Cursor progression covers every row exactly once; allowlist vs `sqlite_master` fails on an unknown table; incremental + weekly full reconstruct the same set. |
| `test-query-plans-pure.cjs` | `EXPLAIN QUERY PLAN` for the top 30 statements shows no `SCAN` on the large tables after the migrations are applied to a seeded scratch DB. |
| `test-read-shape-lint-pure.cjs` | No `SELECT *` outside the allowlist, no `OFFSET` in loops, no unbounded `DISTINCT`, no correlated subquery in list SQL. |
| `test-etag-304-pure.cjs` | ETag derivation from versions; `If-None-Match` short-circuits before D1. |
| `test-import-admission-pure.cjs` | Rows-written estimate with the trigger multiplier; schedule-after-reset decision on Free; warn-only on Paid. |
| `test-stock-in-batch-parity-pure.cjs` | Frontend line validation and backend validation agree on the same fixtures (repository rule). |
| `test-pii-mask-pure.cjs` | Phones, membership numbers, emails, tokens masked; Khmer names untouched. |
| `test-transfer-no-clamp-pure.cjs` | The transfer leg fails on oversell instead of clamping. |

Frontend tests (`frontend/tests/*.test.ts`, registered in the `test:utils` chain): health poll
gating by visibility and server-advertised interval; snapshot scheduler on version change; ETag
handling; WebSocket patch application and gap refetch; search debounce/cancel; offline replay
ordering.

Live gates (read-only): the `plan-status.cjs` GraphQL before/after per phase; Workers CPU
percentiles; DO error count (which should fall once broadcast patches replace refetch storms; if it
does not, the 32–199 errors/day get their own investigation).

Both package gates on committed HEAD in an isolated worktree before any deploy, as recorded:

```bash
cd frontend && npm run test:utils && npm run verify:i18n && npm run build
cd cloudflare && npx tsc --noEmit && cd scripts && for f in test-*.cjs; do node "$f" >/dev/null 2>&1 || echo "RED $f"; done
```

---

## 11. Phased rollout with measurable gates

Each phase ends with three consecutive days of GraphQL rows-read under the phase target, both
package gates green on the committed tip, no p99 latency regression, and a deployed checkpoint
(checkpoint cadence rule: in-flight lanes merged and green, then deploy; new items never delay it).

| Phase | Scope | Gate (rows read / day) |
| --- | --- | --- |
| 0. Measure | G1 meter + `/api/system/plan` + admin readout; G5 lint and plan tests; `plan-status.cjs` committed; no behaviour change | Meter agrees with GraphQL within 5 % |
| 1. Biggest scans | R3, R4, J1 keyset (still 6 h), R5, R6, R7, J4, J6 | ≤ 120 M |
| 2. Catalog and lists | R1 snapshots (needs a minimal J2 builder), R2, ETag/304, F1, F2, F5, R11 | ≤ 20 M |
| 3. Rollups | R8, R10, R12, J5 verifier, R9 | ≤ 5 M |
| 4. Write consolidation | W1, W2, W3/W7, W4, W5, W6, W10, W8/F7 (behind flags; A/B replay tests against production-shaped fixtures) | correctness gates; rows unchanged or lower |
| 5. Jobs | J2 full runner, J3 retention, incremental backups, exports to R2, G2/G3/G4 | ≤ 3 M with jobs included |
| 6. Tier plumbing | `planTier.ts` revival, `wrangler.free.toml`, scripts, bats, G6, G8, §5.8 items | `verify-free` and `verify-paid` green |
| 7. Free rehearsal | Gates F0–F6 | switch runbook (§9.5), user-gated |

Migration numbering: the number is never chosen from one tree. Before a lane writes a migration it
sweeps every ref (`git for-each-ref` over remotes and heads, highest `NNNN_` per ref) and reads the
production `d1_migrations` chain, then takes the next free number and reserves it in the fleet
ledger. On 2026-09-08 the sweep found 0134 carried on the release lineages and 0135 already taken
on `codex/f40-reconcile-preview-20260908`, so the first number this plan can use is **0136**; the
placeholder in Appendix A stands for that procedure, not for a reservation.
Trigger SQL in every migration stays LF-only, and every data migration ships with its pre/post assertions and recovery note.

Lane ownership follows the repository rules: one implementation owner per file set, isolated
worktrees, path-scoped commits, peers messaged before any file is touched. Suggested lanes: (a)
indexes + counters (R3–R7, migrations), (b) catalog/lists (R1, R2, ETag, F-items; frontend +
`products.ts`), (c) rollups + verifier (R8, R10, R12, J5; `compat.ts`, `salesAnalytics.ts`,
`inventory.ts`, `contacts.ts`), (d) writes (W-items; `sales.ts`, `returns.ts`, `branches.ts`,
`inventory.ts`), (e) jobs and backups (J-items; `backup.ts`, `queue.ts`, new DOs), (f) tier plumbing
and scripts (§9; `planTier.ts`, TOML, `package.json`, `run\`, `ops\scripts\powershell\`).

---

## 12. Constraints respected, non-goals, open questions

**Recorded decisions this plan keeps intact**

- Exactly two canonical branches (`shop` sells, `warehouse` never sells); batch/lot and branch
  identity end to end; the single canonical revenue definition (credit sales count); negative
  revenue or profit is always a bug; the daily shift prompt is intentional; cash registration is
  report-only; the warehouse option is shown greyed in sale-side pickers.
- Prepared is not live; `main` is never assumed deployed; deploys, remote migrations, secret sync
  and remote D1 writes are production actions requiring explicit authorization, from committed HEAD
  in an isolated worktree; migrations are append-only with LF-only triggers.
- The superseded Sept 3 line is mined for `planTier.ts` and `wrangler.free.toml` only; its
  `0106_barcode_aliases.sql` is never re-merged.
- Multi-D1 only for tables outside the atomic cluster, as optional bindings with `DB` fallback.
- Frontend validation always has backend enforcement and a parity test; every new surface ships in
  both language packs and in the permission editor.
- Never `git add -A`; path-scoped commits; peers messaged first.

**Non-goals (and why)**

- `tenant_id`, JWTs, KV schema registry, probabilistic sketches, DO cash drawer, Logpush, a separate
  PII Worker: §4.
- Moving `audit_logs` out of the main database: it would break same-transaction auditing.
- A DO as the single writer for stock: the CHECK constraint plus single-batch writes already give
  atomic oversell protection at 200 sales/day; a coordinator would add a hop and a new failure mode
  without a business need. Revisit only if measured contention appears.
- Rewriting the service worker: the two IndexedDB queues stay; they get one replay driver.

**Open questions for the owner** (the plan proceeds under the stated assumption until answered)

1. Is the Free variant intended for **this** production account, or for a second account (staging,
   or a second business)? Assumption: both must be possible; gate F6 uses a second account.
2. Retention periods (J3): audit 12 months, AI logs 90 days, quota usage 60 days, import artefacts
   30 days? Assumption: those values.
3. Does any offline feature read the 5,000-movement snapshot? Assumption: no; it becomes on-demand.
4. Cloudflare Access in front of operator-only paths: wanted? Assumption: later, optional.
5. If gate F0 shows the DO shares Free's 10 ms CPU cap, is a lower bcrypt cost factor acceptable for
   Free, or do logins on Free rely on the platform's tolerance for infrequent overruns? Assumption:
   decision deferred to the gate.
6. The 32–199 DO errors/day: investigate now or after Phase 4 reduces refetch storms? Assumption:
   after, unless Phase 0 logging shows a data-affecting error.

---

# Part II. System atlas — every layer, every relation, matched to the plan

Part I (§1–§12) was written from six targeted exploration reports and the live analytics. Part II is
the whole-system atlas the owner asked for on 2026-09-08: seven read-only agents inventoried every file
and folder under `cloudflare/` and `frontend/`, the migration chain, the tooling and tests, the recorded
decisions, and the delta between `main` and the deployed commit. §13–§18 record what exists and how it
relates; §19 matches every finding to a plan item and says what it means on Free and on Paid. Symbols
are cited rather than line numbers because the two lineages (§18) drift; any line number that survives
must be re-read on the branch a lane actually forks from.

One caveat governs every section: the `cloudflare/src` and `frontend/src` inventories were taken on the
`main` working tree, while production runs the codex release line, which carries the sale-amendment,
shift-session, bulk-operation and mutation-receipt code that `main` lacks (migrations 0115–0134). §15.7
and §16.8 carry the production delta; where a §13–§16 statement is known to differ on that line it is
marked **[prod: …]**.

## 13. Storage: schema, relations, ledgers, indexes, triggers, cuts

### 13.1 Inventory

| Object | Count | Notes |
| --- | --- | --- |
| Migration files on the production line | 134 (0001–0134; 0113 absent by number) | `main`'s committed tree stops at 0105; its working tree holds an untracked `0106_return_replacement_sales.sql` belonging to an in-flight lane; 0135 is taken on an unmerged lane (§18.2) |
| Effective tables | 115 | including 9 FTS5 virtual tables; with 36 FTS shadow tables and 4 D1 internals the `sqlite_master` count is ≈157 |
| Indexes | 159 | 3 provably redundant (§13.4); `audit_logs` and `import_jobs` have none at all |
| Triggers | 106 | 60 are revision counters from 0120/0124/0125; the rest are FTS5 maintenance and name-snapshot helpers |
| Views | 0 | every "view" is a CTE inside a route or lib module |
| Foreign keys | 19 declared, 183 implicit `*_id` columns | D1 does not enforce `PRAGMA foreign_keys`, so the 19 declarations are documentation; integrity is code-enforced in `lib/dataIntegrity.ts` and `lib/coreDataInvariants.ts` |
| Unreferenced tables | 1 | `loyalty_points_reset_log` has no reader or writer on either lineage |
| Databases bound | 2 | `DB` (everything) and `IMPORT_DB` (`import_job_rows`, `import_job_source_rows` only), the latter optional with a transparent `DB` fallback |

### 13.2 Domain clusters and their relations

The 115 tables fall into nine clusters. The arrows are the implicit `*_id` relations the code joins on;
the **atomic cluster** is the set a single sale or return writes inside one `db.batch()`.

```
identity   organizations ── organization_groups ; users ── roles ; user_sessions → users ; devices → users
catalog    products ⟲ products.parent_id (family self-join) ; categories, units, lookups ; 9 FTS5 shadows
stock      branch_stock(product_id, branch_id)                                   ledger A
           product_batches(product_id) → branch_batch_stock(batch_id, branch_id)  ledger B (lots)
           inventory_movements(product_id, batch_id, branch_id)                   the movement ledger
           transfers ; stock_session_* (0124)                                     [there is no `stock_movements` table]
sales      sales(branch_id, customer_id, user_id) → sale_items(product_id, batch_id)
           sale_amendments, sale_write_revisions, sale_bulk_*, sale_mutation_* (0115–0127, production line only)
           customer_receivables(customer_id, invoice_no)                          — carries no sale_id
returns    returns(sale_id, customer_id) → return_items(product_id, batch_id) ; return_write_revisions, return_bulk_*
contacts   customers, suppliers, delivery_contacts, supplier_invoices, loyalty_point_adjustments
shift      shift_sessions(branch_id, business_date), shift_session_amendments (0116–0123, 0132; production line only)
portal     portal accounts, carts, wishlists, submissions, consent (0130–0131) ; reads products + branch_stock
ops        audit_logs, settings, system_flags, cache_versions, pending_actions, import_jobs, backups, quota usage
```

**Atomic cluster** (one database, one batch): products, branch_stock, product_batches,
branch_batch_stock, inventory_movements, sales, sale_items, returns, return_items, customers,
customer_receivables, audit_logs (the audit row is written in the same batch as the business row), and
on the production line the revision and mutation tables the triggers write. The FTS5 tables shadow
products and contacts through triggers and are in the same database by construction. Everything outside
this set is a candidate for a second database (§13.7); nothing inside it ever is. On the release line
four sentinel tables (`sale_bulk_guards`, `stock_session_guards`, `return_bulk_guards`,
`sale_mutation_guards`) sit inside the same batches as atomicity assertions — a `DELETE FROM …_guards`
closes each batch — and are deliberately excluded from backups.

**Loyalty is computed, not stored**: a customer's balance is derived from sales, returns and
`loyalty_point_adjustments` at read time (the notifications summary and the customer report re-derive it
per call), which is why R10's `customer_points_rollup` must respect the historical-sales-never-accrue
flag rather than summing blindly.

### 13.3 Three stock ledgers and who writes them

| Ledger | Table / column | Writer files | Readers that matter |
| --- | --- | --- | --- |
| P (denormalized total) | `products.stock_quantity` | every stock writer keeps it in step with A | product list, POS bootstrap, portal catalog |
| A (per branch) | `branch_stock` | 19 files | inventory, branches hub, dashboard stock tiles, `coreDataInvariants` |
| B (per lot per branch) | `branch_batch_stock` via `product_batches` | 10 files | POS product sheet, batch picker, returns restock, expiry alerts |
| M (movements) | `inventory_movements` | every writer that changes A or B is supposed to append here | stock ledger page, stock-in sessions, backups, the offline snapshot |

Facts the plan must respect:

- **Nine files write A without touching B** (`lib/saleTransitions.ts`, `lib/returnsStock.ts`,
  `lib/stockRevert.ts`, `routes/sales.ts`, `routes/branches.ts` among them). Transfers move A rows and
  movements but not lot rows. No code reconciles A against B; the invariants only check P against A.
  The non-negative CHECK from 0058 is per ledger, so A and B can each stay valid while disagreeing —
  which is exactly the "28 here, 0 there" symptom already seen in production.
- The **batch identity rule** (in the same lot, out the same lot, returned to the same lot) is therefore
  enforced by ten writers agreeing by convention. W1's single-batch sale and the proposed stock-write
  library (W12, §19) turn that convention into one code path with an A↔B invariant.
- `products.is_batch_tracked` (R6) removes the "join product_batches to find out whether lots apply"
  probe that every reader of B currently pays.

### 13.4 Indexes: what is missing, what is redundant, what an index cannot help

Missing on hot paths (beyond R3's `audit_logs` set and R5's partial indexes):

| Table | Proposed index | Why |
| --- | --- | --- |
| `audit_logs` | `(entity, entity_id, id)`, `(created_at, id)`, `(action, created_at)` | zero indexes today; the notifications poll (`routes/notifications.ts`) scans the whole table with `action = … AND created_at > -1 day` on every 2-hour tick per tab, and the compat audit list pays `COUNT(*)` plus two `DISTINCT` facet scans per page (§15.4). Already in R3; listed here because it is the largest append-only table |
| `import_jobs` | `(status, updated_at)` | the reaper's two unconditional UPDATEs (J4) and the tracker's `?limit=8` poll walk the table |
| `sales` | `(branch_id, sale_status, created_at, id)` | every branch-scoped list, stats strip and dashboard tile filters on these four |
| `inventory_movements` | `(product_id, batch_id, created_at)` | stock ledger page, stock-in session lines, `balance_after` (R12) |
| `product_batches` | `(variant, received_at, id)` | batch picker ordering and the expiry sweep |
| `shift_sessions` | `(branch_id, business_date)` | the daily shift prompt looks up today's session per branch on every POS open **[prod only]** |
| `sale_items` | `(created_at)` or a date-bearing composite | the inventory summary's whole-history aggregates, until R12 makes them unnecessary |

Redundant (drop in the same migration): `idx_loyalty_point_adjustments_customer` is a prefix of
`…_customer_created`; `idx_customers_membership_normalized` duplicates the unique
`lower(membership_number)` index; `_lot_ledger_reconcile_open_idx` targets a table dropped in 0081.

What no index can help: nine of the twenty heaviest query shapes (§15.4) filter or group on a function
of a column — `lower(trim(name))`, `upper(substr(trim(name),1,1))`, `localDateExpr(created_at)`,
`CAST(localHourExpr(created_at) AS INTEGER)`, `json_extract(details, …)`. SQLite can index an
expression, so the recurring ones (`lower(trim(name))` on products, customers, suppliers, fees;
`localDateExpr(created_at)` on sales and returns) get **expression indexes** (R15), and the
`json_extract` filter in the amendment count is replaced by a maintained column (R3) because no index
can serve it.

On Free every index is also a write: D1 counts each index entry maintained on an insert or update as a
row written, so the index set is chosen once (R13) and the redundant ones are dropped in the same
migration rather than left as free-tier ballast.

### 13.5 Triggers and write amplification

Of the 106 triggers, 60 are revision counters added by 0120 (24, sale bulk status), 0124 (24, stock
session operations) and 0125 (12, return bulk actions); 0129 and 0133 drop and recreate three of them,
so the live total stays 60. Each fires per affected row and is **gated by a per-row restore-mode
probe** — `WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND
json_extract(value, '$.mode') = 'restore')` — before it upserts a revision counter. Measured on the
release line's `POST /api/sales` (§15.7), a five-line sale writes 26 base rows (header, 5 items, 5
A-ledger upserts, 5 lot decrements, 5 `products` updates, 5 batch allocations) plus 5 movements, and
those 26 base rows fire **26 triggers → 26 revision upserts** (11 into `sale_write_revisions`, 15 into
`stock_session_revisions`) **and 26 probes**: ≈2× row-write amplification before FTS maintenance, with
returns firing two revision families per row. The triggers are LF-only SQL by rule and append-only in
the chain, so W13 is a new migration that drops and recreates them — never an edit of 0120/0124/0125 —
with (1) the probe narrowed to an integer read from a one-row `restore_mode` table, (2) the stock
revision triggers scoped to rows that belong to a stock session, since `stock_session_revisions` is
read only by `lib/stockSession.ts` and an ordinary sale's fifteen writes into it buy nothing outside a
session (to be confirmed by that lane before the scope change), and (3) one revision family per
return row.

Free arithmetic: the account-wide wall is 100,000 rows written per day. At today's ≈200 sales/day
the sales path alone is ≈10–12k rows written including index maintenance, stock-in sessions add a few
thousand, and a single 10,000-row import writes its rows three times (staging, business row, audit).
Daily trade fits comfortably; **one unthrottled import does not**, which is why G6 (import admission
control) is Free-critical and why W13 matters more on Free than on Paid.

### 13.6 Identity, money and snapshot columns

- `idx_sales_receipt_number` is **non-unique** (confirmed on the production line); `lib/receiptNumber.ts`
  mints `YYYYMMDD-HHMMSS` without a database guard and relies on the client request id to absorb the
  same-second race. W2 adds the UNIQUE constraint behind a pre-assertion on production data and the
  `SaleSequencer` DO for the same-second case.
- `customer_receivables` links to a sale by `(customer_id, invoice_no)` only; there is no `sale_id`.
  Every receivables repair so far has had to match on the composite key. W15 adds and backfills
  `sale_id` so the sales↔receivables split cannot recur silently.
- **101 of 105 money columns are `REAL`**; the three exchange rates (main, change money, loyalty) are
  unconstrained. A type migration across 101 columns is out of scope for this plan (it would touch every
  reader and the backups); the decision recorded in §19 is to round at the write kernel (`lib/saleTotals.ts`)
  and add CHECKs only on new columns, with the KHR 100-riel rounding rule enforced there.
- `USER_NAME_SNAPSHOTS` (14 tables) drives the username rename cascade but **misses** every table added
  since 0116: `shift_sessions.*`, `sale_amendments.user_name`, `audit_logs.user_name`,
  `sales.cancelled_by_name` / `stock_skipped_by_name`, `pending_actions.*`. A rename today leaves stale
  names on exactly the surfaces the history rule says must show the acting username (W14).
- Product identity: migration 0109 merged duplicate products in production but left their batches
  behind and its audit INSERT is `WHERE 0 = 1`, so the merges have no audit trail; the "22 products"
  figure is from session memory, not from the file (705 candidates, 2,045 batch rows in the script).
  0135 on the unmerged f40 lane adds the merge-plan lookup indexes. Every rollup keyed by `product_id`
  (R7, R10, R12) therefore needs merge-aware maintenance (W16): on a merge the rollup rows are
  reparented to the survivor, not recomputed from a history that may already have moved.

### 13.7 Multi-D1 cut map

The recorded rule (progress.md §"multi-D1", 2026-09-06) is that a table leaves the main database only if
it never joins or batches with the atomic cluster. Applying it to the 115 tables:

| Candidate | Joins the atomic cluster? | Verdict | Free effect | Paid effect |
| --- | --- | --- | --- | --- |
| `import_job_rows`, `import_job_source_rows` | no | **already cut** (`IMPORT_DB`) | none — rows read are counted account-wide | isolation; import days stop bloating the main backup |
| Rollup tables (R7, R8, R10, R12) | written by the job runner, read by dashboards; never in the sale batch | cut-eligible from birth: `ROLLUP_DB` optional binding with `DB` fallback | none | Time Travel scope and backup granularity; rebuildable, so lowest-risk cut |
| `audit_logs` | the audit row is written **inside** the sale batch | **stays** as the write target (§12 non-goal holds); on Paid a write-behind copy to `AUDIT_DB` via the side-effects queue (W5) can serve the list, facets and retention (J3) | none | read isolation for the largest table; retention deletes stop competing with trade |
| `user_sessions`, device trust, OTP challenges, rate-limit counters | one point read per request, never joined to business rows | cut-possible, **not recommended**: it is already a separate query, so the cut buys nothing on either tier and adds a second cold database to every request | none | none |
| Portal accounts, carts, wishlists, submissions, consent | read products/branch_stock for pricing; never in a sale batch | cut-possible later, behind the portal bundle split (F13) | none | isolation of the public surface; a public write storm cannot lock the trade database |
| `quota_usage`, `job_runs`, telemetry (§5.2) | no | cut-eligible (`TELEMETRY_DB`) | none | isolation; already listed as §6 rank 33 |
| Everything in §13.2's atomic cluster plus the FTS5 shadows | yes | **never** | — | — |

The tier nuance the reference documents miss: on Workers Free the 5 million rows-read and 100,000
rows-written walls are **per account**, so splitting databases moves rows between bindings without
lowering the bill. Multi-D1 is a Paid-value structure (isolation, backup scope, Time Travel, one
database's storage growth not threatening another's) and a Free non-event. §7 therefore keeps the Free
variant on one database plus `IMPORT_DB`, and §8 stages the rollup and audit copies as optional bindings.

### 13.8 Retention, backups and size

The production database was ≈164 MB at analysis time and once reached ≈661 MB before the scheduled
handler was split into isolated steps; `audit_logs` and the import tables are the growth. Backups
(`lib/backup.ts`) walk every table with `LIMIT 500 OFFSET n` — quadratic on the large tables — write to
R2 with multipart uploads, copy at most 100 assets per run, keep two finalized backups in R2 and ten on
Drive. Retention exists for audit logs, import artefacts and ephemera (`lib/importRetention.ts`,
`lib/ephemeralRetention.ts`) and is driven by settings keys read ad hoc. J1 (keyset, incremental,
streamed) and J3 (retention with an R2 archive first) are the plan's answer; §14.4 has the job shapes.

## 14. Worker platform: modules, bindings, background work, guards

### 14.1 Shape of `cloudflare/src`

| Layer | Count | Facts |
| --- | --- | --- |
| Entry | `index.ts` | Hono app; `fetch`, `queue`, `scheduled` exports; `GET /ws` proxies to the hub DO; `GET /uploads/*` serves R2 unauthenticated by design |
| Routes | 30 files, 29 mounted | 346 endpoint registrations, 26,017 LOC; `routes/customTables.ts` is imported by nothing (§15.5) |
| Lib | 98 modules | a DAG with zero cycles; fan-in from routes: `auth` 30, `audit` 27, `permissions` 27, `db` 26, `broadcastHub` 17, `cache` 15, `conflictControl` 13, `rateLimit` 7, `sqlBinding` 7, `businessDateWindow` 7, `productBatches` 6, `searchMatch` 6, `telegram` 6, `familyPagination` 4 |
| Largest module | `lib/importEngine.ts`, 5,799 lines | 18 lib→lib edges; owns five stock-action sub-pipelines (add, remove, set, transfer, count) beside CSV/ZIP/image import — the one module every stock rule change must be traced through |
| Durable Objects | 2 classes | `BroadcastHub` (one global instance, hibernatable WebSockets, no storage), `SyncUploadSession` (one per upload id) |
| Queues | 4 consumers, 3 producers | import (batch 5) + its dead-letter queue, media (batch 5), backup-assets (batch 1, no DLQ); the video-optimize path inside the media consumer is a fully stubbed no-op |
| Cron | `0 */6 * * *` | eight steps, each in its own `runStep` try/catch, skipped wholesale under maintenance |
| Other bindings | KV `CACHE`, R2 `ASSETS`, Analytics Engine, Images, Sentry DSN, Google OAuth/Drive, Telegram, encryption key | Analytics Engine has **zero** callers (`lib/analytics.ts` is imported by nothing); Cloudinary credentials are typed on `Env` but absent from `wrangler.toml` |

### 14.2 What a request costs before its handler runs

1. **Cold isolate only**: `ensureCoreDataInvariantsOnce` memoizes a promise; the fast path runs eight
   sequential SELECTs (organizations, groups, branches, three roles, the admin user, the `branch_stock`
   coverage probe). The coverage probe is `NOT IN (SELECT product_id FROM branch_stock)`, which SQLite
   must materialize in full before the outer `EXISTS` can stop, so the code comment's "short-circuits on
   the first row" is untrue (R16 rewrites it as `NOT EXISTS … LIMIT 1`). Warm isolates pay nothing; R4
   replaces the per-isolate run with a per-deploy marker. The middleware is mounted on `*` **before**
   `GET /health` and `GET /ws`, so the frontend's 30-second probe — the most frequent request in the
   system — is what pays the cold path (R18 moves it to `/api/*`).
2. **Maintenance gate**: one `system_flags` point read, write methods only, fails open if the table is
   missing.
3. **Session**: one three-table join (`user_sessions ⋈ users ⋈ roles`) keyed on the token hash; the row
   carries both permission JSON blobs, so permission checks are in-memory. Two deferred writes may follow
   through `waitUntil`: the 5-minute `last_seen_at` touch and the half-TTL `expires_at` slide.
4. **Settings are not loaded per request.** Each consumer reads its own keys ad hoc (`lib/audit.ts`,
   `lib/telegram.ts`, `lib/googleDrive.ts`, `lib/renameCascade.ts`, the two retention modules), so the
   Part I claim "settings are re-read per request" is corrected to "settings are re-read per consumer,
   uncached, with no version authority" — R11's isolate snapshot still applies, keyed by the settings
   version counter.
5. **No global CORS, rate limiter or request logger.** Rate limiting is per endpoint in seven files
   (auth, portal, files, products image upload, ai provider test, system reset) with two
   implementations: D1-backed `lib/rateLimit.ts` and an ad hoc KV counter inside `routes/system.ts`
   (different time units). Every other write endpoint is unthrottled — the Rate Limiting binding in
   §5.8 replaces both.

### 14.3 Caching and version counters

`lib/cache.ts` has two halves. The half in use is the Workers Cache API wrapper `cachedJsonResponse`
(key = request URL + injected `_v` version parameter) plus `bumpVersion(namespace)`, which increments a
KV counter `v2:<ns>`. The half with **zero callers** is a KV read-through (`getJson`, `setJson`,
`getOrSetJson`, `versionedKey`). Under KV write-quota pressure `bumpVersion` falls back **silently and
permanently** to a D1 `cache_versions` table — a fallback that turns every mutation into a D1 write and
that no dashboard reports.

The imbalance that matters on Free: on `main` **15 route files bump versions and 4 read through the
cache** (contacts, portal, products, sales); on the release line 24 files bump and the same four read
(≈14 call sites, now including `GET /api/sales`). Inventory, branches, batches, returns, lookups,
promotions, settings, users, files, importJobs, system and the release-only shift and report modules
pay a KV write per mutation for a cache that never serves a hit. On Free that is a direct draw on the 1,000 KV writes per day; on Paid it is noise. W11 makes the
namespace map explicit, bumps only namespaces with a reader, and makes the D1 fallback visible in the
budget meter (G1).

### 14.4 Background work

| Job | Trigger | Shape today | Plan item |
| --- | --- | --- | --- |
| Backup | cron step 1 + `POST /api/backups` via the backup queue | `LIMIT 500 OFFSET n` per table (quadratic), R2 multipart, ≤100 asset copies per run, keeps 2 in R2 / 10 on Drive | J1 keyset + incremental; J2 runner on Free |
| Drive sync | cron step 2 + `drive-sync/jobs` | settings-driven, polled by the Backup page every 2 s while running | J2 |
| Audit retention | cron step 3 | settings key read ad hoc; unindexed delete on the largest table | R3 index + J3 |
| Reap stalled imports | cron step 4 **and every `GET /api/import-jobs`** | on `main` two unconditional UPDATEs per call (≈10k wasted statements per day with the 12 s tracker); on the release line a read-only pre-check SELECT gates the UPDATEs, so one SELECT per list request | J4 skips the SELECT too when no job has been active |
| Import retention, orphan staging cleanup | cron steps 5–6 | `NOT IN (SELECT id FROM import_jobs)` over the staging tables — the same materialize-then-scan trap | R16, J3 |
| Ephemeral retention | cron step 7 | settings-driven deletes | J3 |
| Image audit | cron step 8 | R2 listing against `products.image_*` | unchanged |
| Import processing | import queue, batch 5 | `importEngine.ts`; DLQ on failure | G6 admission control on Free |
| Media processing | media queue, batch 5 | Images / Cloudinary pipeline; video path stubbed | G10 retires the stub |

The eight-step isolation exists because a failing backup once starved retention for weeks while the
database grew to ≈661 MB; the plan keeps the isolation and moves the steps under the job runner (J2) so
each has a `job_runs` row, a budget check before it starts and a resumable cursor.

### 14.5 Durable Objects and the WebSocket

`BroadcastHub` is one global instance: every mutation in 17 route files calls `broadcast(channel,
payload)` after its batch commits, and the hub fans the message to every connected tab of every user
with **no coalescing window, no per-tab cursor and no error reporting** — failures are `console.error`
and swallowed. The "32–199 DO errors/day" figure in Part I comes from the platform analytics; nothing in
`broadcastHub.ts` records or classifies them, so its cause is unverified from source (J7 adds coalescing,
`reportError`, and a `since` cursor so a reconnecting tab replays what it missed instead of refetching
22 channels, §16.5). `SyncUploadSession` stores 1 MB chunks up to 25 MB per upload with **no alarm**, so
an abandoned upload's chunks live until the object is evicted (J8 adds an alarm-driven cleanup). Both
classes are SQLite-backed, which is the only DO storage kind Workers Free allows — a fact §7.4 relies on.

### 14.6 Guards that already exist

`lib/quotaGuard.ts` is a working budget system for four pools — KV writes (1,000/day), R2 class-A
operations, Cloudflare Images (5,000/month), Cloudinary (25,000/month) — with `ok / warn70 / critical90
/ exhausted` zones and per-pool skip behaviour. It **excludes D1**, the pool that actually binds on Free.
G1's budget meter extends this module rather than replacing it: the same zones, D1 rows read/written and
requests added as pools, `PLAN_LIMITS_BY_TIER` from `planTier.ts` (§9) as the ceilings, and
`/api/system/plan` as the readout. `lib/maintenance.ts` (write gate), `lib/conflictControl.ts`
(expected-updated-at checks in 13 route files), `lib/reviewGate.ts` (review-tier interception) and
`lib/importLifecycleGate.ts` are the other guards the plan builds on; none is duplicated.

Roughly sixty hard-coded limits live across the modules (page-size clamps, `STOCK_ACTION_MAX_UNITS`,
`ROWS_PER_IMPORT_CHUNK`, upload sizes, retry counts) and about eight KV key patterns. G8's deploy guard
and the tier plumbing in §9 turn the tier-sensitive subset into `PLAN_LIMITS_BY_TIER` entries; the rest
stay where they are.

### 14.7 Structural debts (not quota items)

- `importEngine.ts` at 5,799 lines owning five stock pipelines is the largest single risk to the batch
  identity rule; the stock-write library (W12) is where those five pipelines converge, and the
  decomposition (G12) follows it rather than preceding it.
- Two route modules import other route modules (`contacts.ts → routes/portal.ts`, `sync.ts →
  routes/files.ts`) instead of a lib; harmless today, a cycle risk tomorrow.
- Line endings are mixed inside `routes/` (`backups.ts`, `fees.ts` are CRLF, most are LF), which
  silently blanks end-anchored source sweeps — including the permission and i18n audits the project
  runs by rule. A `.gitattributes` normalisation is a checkpoint-only change (G10).

## 15. Request surface: endpoints, query shapes, inconsistencies

### 15.1 Per-file inventory

`eps` endpoints · `wr` endpoints writing D1 · `batch` endpoints using `db.batch()` · `off` OFFSET-paged ·
`maxQ` most `.prepare()` calls in one handler. The full 346-row table (method, path, guard, tables,
paging, bindings) is in the atlas companion file; this is the summary the plan ranks from.

| Route file | Mount | eps | wr | batch | off | maxQ | Beyond D1 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| compat.ts | /api | 41 | 1 | 0 | 4 | 5 | R2, Drive, Google login |
| products.ts | /api/products | 36 | 8 | 6 | 2 | 17 | R2, KV, hub DO |
| inventory.ts | /api/inventory | 25 | 6 | 4 | 1 | 9 | KV, hub DO, Telegram |
| contacts.ts | /api | 24 | 4 | 2 | 6 | 10 | KV, hub DO |
| importJobs.ts | /api/import-jobs | 24 | 12 | 2 | 1 | 6 | IMPORT_DB, R2, KV, import queue, hub DO |
| portal.ts | /api/portal | 20 | 0 | 0 | 1 | 7 | R2, KV, hub DO (all public) |
| auth.ts | /api/auth | 19 | 7 | 0 | 0 | 6 | Google login, encryption key |
| users.ts | /api | 16 | 6 | 2 | 0 | 3 | R2, KV, hub DO |
| sales.ts | /api/sales | 11 | 3 | 3 | 2 | **19** | KV, Telegram |
| returns.ts | /api/returns | 11 | 5 | 4 | 0 | **27** | KV, hub DO, Telegram |
| fees.ts | /api/fees | 11 | 5 | 0 | 1 | 4 | hub DO, Telegram |
| branches.ts | /api/branches | 10 | 5 | 6 | 0 | 9 | KV, hub DO, Telegram |
| promotions.ts | /api/promotions | 10 | 4 | 1 | 0 | 4 | KV, hub DO |
| system.ts, devices.ts, batches.ts, files.ts | — | 8, 8, 7, 7 | 2, 1, 4, 1 | 4, 0, 1, 1 | 0, 0, 0, 1 | 4, 2, 4, 5 | system: IMPORT_DB, R2, KV, DO, Sentry |
| ai, actionHistory, lookups, notes, notifications, organizations, reviewQueue, runtime, settings, sync, telegram | — | 6, 5, 5, 5, 1, 3, 6, 3, 5, 4, 5 | — | — | — | — | notifications = one 675-line endpoint; sync = the upload DO only |
| **customTables.ts** | **not mounted** | 6 | 0 | 0 | 0 | 3 | dead (§15.5) |

Widest write paths: `returns.ts POST /` (27 prepares) and `sales.ts POST /` (19 prepares), both inside
`db.batch()`; 41 endpoints use `db.batch()` in total. Ten route files write `products` /
`branch_stock` / `inventory_movements` directly or through a lib — the fan-out that W12 collapses.

### 15.2 The endpoints that decide the D1 bill

| Endpoint | Handler | Guard | Rows touched per call | Plan |
| --- | --- | --- | --- | --- |
| `GET /api/products`, `/products/search` | `searchProductsPayload` → `lib/familyPagination.ts::paginateProductFamilies` | requireAuth | whole active catalog **2–3×** per page (§15.4 #1) | R1, R2 |
| `GET /api/inventory/summary` | `inventory.ts GET /summary`, `branchScopedItems` | requireAuth + inline tier | every active product × whole sales and returns history | R14 → R12 |
| `GET /api/dashboard` | `compat.ts::dashboardSummary` | `denyUnless('dashboard')` | 9 parallel aggregates, 2 byte-identical | R8 |
| `GET /api/analytics` | `compat.ts::dashboardAnalytics` | `denyUnless` | 3 GROUP BY scans keyed on a computed hour | R8, R15 |
| `GET /api/sales` | `sales.ts GET /` | `canReadSales` | OFFSET page + separate COUNT(*) **[prod: + the six-subquery records count per row, §15.7]** | R3, R9 |
| `GET /api/sales/export` | `sales.ts GET /export` | `canReadSales` | keyset, `limit+1` has-more — the only keyset pager in the Worker | model for R9 |
| `GET /api/returns` | `returns.ts GET /` | inline tier | bare `LIMIT` 500 (cap 1000), no cursor, no total — **silent truncation** | R9 |
| `GET /api/portal/catalog/products` | `portal.ts::buildPortalCatalog` | public | family CTE + brand facet; Cache API, but the key is the caller-chosen query string | R1, R2 |
| `GET /api/audit-logs` | compat audit list | requireAuth | COUNT(*) + page + 2 unbounded DISTINCT facets | R3, R17 |
| `GET /api/notifications/summary` | `notifications.ts` | requireAuth | audit scan + awaiting-payment/delivery scans + per-customer loyalty re-derivation | R10, R17 |
| `GET /api/import-jobs` | `importJobs.ts` | requireAuth | 2 reaper UPDATEs + list, polled every 12 s per tab | J4, F9 |
| `GET /api/users` | `users.ts` | requireAuth | every user row, no LIMIT | R9 |

### 15.3 Endpoint × table write matrix (condensed)

Files that write the stock cluster (`products`, `branch_stock`, `branch_batch_stock`,
`inventory_movements`): batches, branches, inventory, products, returns, sales, system, and — through
libs — contacts, files, importJobs. `audit_logs` is written from `lib/audit.ts` (27 importers) and read
by compat and notifications only. `settings` is written by settings, inventory, returns, sales, system
and read by portal, products, runtime, files. `users`/`user_sessions` are written by auth, devices, users.
The matrix is the argument for three libraries: one stock writer (W12), one audit writer with a fixed
row shape (W10), one settings reader with a version (R11).

### 15.4 The heaviest query shapes, condensed

| # | Where | Shape | Cheaper form | Item |
| --- | --- | --- | --- | --- |
| 1 | `lib/familyPagination.ts::buildCtes` | `WITH matched AS (whole filtered catalog)` materialized for `COUNT(*) FROM families`, again for the `ROW_NUMBER()` page, a third time as `family_members` when a search term is set; used by products, inventory, portal, branches | count cached per (filter set, version); keyset on `(family_name, family_root_id)`; single pass | R2 |
| 2 | `inventory.ts GET /summary` | `SELECT p.*` for all active products + correlated `json_group_array` over `branch_stock ⋈ branches` per row + two date-unbounded derived tables over `sale_items ⋈ sales` and `return_items ⋈ returns`, `ORDER BY lower(p.name)`, no LIMIT | one batched `branch_stock` read joined in the Worker; window-bounded aggregates; page | R14 |
| 3 | `compat.ts::dashboardSummary` | `todaySales` and `allSales` share the WHERE byte for byte; `all_total` always equals `today_total` (**`allSales` is date-scoped, not unbounded** — Part I's wording is corrected here) | delete the second statement | R8 |
| 4 | `lib/coreDataInvariants.ts::tryFastPath` | `NOT IN (SELECT product_id FROM branch_stock)` | `NOT EXISTS … LIMIT 1` | R16 |
| 5 | compat audit list | COUNT(*) + `DISTINCT LOWER(action)` + `DISTINCT LOWER(COALESCE(entity, table_name))` per page | facets per cache version; has-more probe | R17 |
| 6 | `notifications.ts GET /summary` | one endpoint, whole file; loyalty re-derived per customer | split per widget; `customer_points_rollup` | R10, R17 |
| 7 | `products.ts` alphabet facet, `portal.ts` brand facet | `upper(substr(trim(name),1,1))` + `COUNT(DISTINCT …)` GROUP BY | `catalog_facets` rollup | R2 |
| 8 | `contacts.ts` four report endpoints, `fees.ts` four label endpoints, `returns.ts GET /report` | `GROUP BY lower(trim(<name>))` + COUNT(*), no LIMIT, then OFFSET the rows | expression indexes; daily rollups | R15, R8 |
| 9 | `compat.ts::dashboardAnalytics` | GROUP BY `CAST(localHourExpr(created_at) AS INTEGER)` | `sales_daily_rollup` carries the hour bucket | R8 |
| 10 | `products.ts GET /:id/detail-report`, `lib/businessMetrics.ts::getStockMetrics` (**`main` only** — the module is gone on the release line, where `lib/familyStockStats.ts` carries the tiles) | COUNT + 2 LEFT JOINs over batches and lots, GROUP BY, no LIMIT | `family_stock_rollup` | R7 |
| 11 | `lib/importRetention.ts::cleanOrphanImportStaging` | `NOT IN (SELECT id FROM import_jobs)` over staging | `NOT EXISTS` | R16 |
| 12 | `products.ts GET /stock-in-session-lines` | `COUNT(DISTINCT CASE WHEN … NOT LIKE 'revert:%')` over movements ⋈ batches | `balance_after` + a revert flag column | R12 |
| 13 | `sales.ts GET /` | OFFSET + separate COUNT(*) | the sibling `/export` keyset | R9 |

Fifteen of the twenty ranked shapes have `ORDER BY` without `LIMIT`; nine apply a function to the column
they filter or group by. The read-shape lint (G5) encodes both as failing patterns, with an allowlist for
the deliberate exports.

### 15.5 Sibling inconsistencies the plan must not inherit

1. **Auth is applied four ways**: blanket `app.use('*', requireAuth)` (22 files); per-prefix loops
   (compat, lookups, users, contacts); per-handler `denyUnless` (23 sites in compat); genuinely public
   (auth, portal, organizations bootstrap/search, `runtime GET /version`, the Telegram webhook, which is
   registered before the auth line and verifies its secret header itself). Compat's per-prefix loop is
   a hand-maintained **13-entry array**; the file's own comment records that the guards were once
   written as `'/dashboard*'`, which Hono does not treat as a wildcard, so `GET /api/transfers` served
   stock-transfer rows to unauthenticated callers until a probe found it. Any new compat path outside
   the array is unguarded unless its handler calls `denyUnless`. **G9 inverts this to default-deny with
   an explicit public allowlist**, and the permission-coverage test in §10 gains a "no route without a
   guard" assertion.
2. **Three revenue predicates coexist.** `lib/salesAnalytics.ts` defines the canonical rule
   (`recognizedExpr` excludes cancelled and awaiting-payment with `NULLIF` normalisation; `netSaleExpr`
   is subtotal minus discounts, tax and delivery excluded) and analytics, inventory and products use it.
   `compat.ts::dashboardSummary`'s headline tiles instead `SUM(total_usd)` — **tax and delivery
   included, credit sales included, blank status treated differently** — so the dashboard disagrees
   with Reports by construction. Under the recorded revenue definition credit (unpaid) sales **do**
   count, so the fix is not "adopt `recognizedExpr` as is" but "one kernel, decided by the open N48
   accounting lane, called from every SUM". R8's rollup writer calls that kernel and never re-encodes
   the predicate; G5's lint fails any new `SUM(` over `sales` outside it.
3. **Three pagination strategies on `main`, five on the release line**: `sales.ts GET /` OFFSET +
   COUNT; `sales.ts GET /export` keyset with an authoritative `has_more` (plus `snapshot_max_id` on
   the release line); `reports.ts` with its own snapshot + cursor; `returns.ts GET /` a bare `LIMIT`
   that silently truncates above 1,000; products/inventory/portal the family-offset window. R9 makes
   the sales-export keyset + snapshot pattern the one strategy and gives returns and users a cursor.
4. **Time-of-day scoping is not shared**: seven files import `lib/businessDateWindow`, but only sales
   applies `appendLocalTimeRange`; the same date+time row narrows sales and not returns or fees. The
   one Start→End row rule (§12) needs `appendLocalTimeRange` on every list the row scopes.
5. **Branch scoping is ad hoc**: compat has a local `saleBranchClause`, branches and inventory hand-write
   `AND branch_id = @branchId` thirty-plus times, portal scopes by joining `branch_stock`. A
   `lib/branchScope.ts` helper is part of W12's file set.
6. **The read cache is bumped in 15 files and read in 4** (§14.3).
7. **Response envelopes**: 115 `{success: true}` sites, 7 `{items}`, 523 bare `{error}`, 215
   `success: false`, while `app.onError` always emits `{success: false, error}`. Normalising is a
   whole-surface change (frontend included); it is recorded as a non-goal for this plan and a candidate
   for the ETag lane, which already touches every list GET.
8. **Dead code that still passes every sweep**: `routes/customTables.ts` (290 lines, six guarded
   endpoints, imported by nothing — **already deleted on the release line**, so the risk is a merge
   from `main` resurrecting it), the KV read-through in `lib/cache.ts`, `lib/analytics.ts`, the
   video-optimize queue path, `loyalty_points_reset_log`. G10 retires them at a checkpoint after
   confirming no unmerged lane mounts them.
9. **Mixed line endings** inside `routes/` (§14.7).

### 15.6 Duplicated logic that becomes one lib

| Concept | Where it is repeated | Home |
| --- | --- | --- |
| "which sale counts" predicate (3 variants) | compat summary; sales stats and stats-strip; inventory summary | the N48 kernel in `lib/salesAnalytics.ts` |
| branch-scope fragment | compat, branches (~30 literals), inventory, portal, batches | `lib/branchScope.ts` (W12) |
| rate limiting | 6 files via `lib/rateLimit.ts`; `routes/system.ts` has its own | the Rate Limiting binding (§5.8) |
| inline permission middleware bodies | ai, batches, customTables, fees, inventory, returns, reviewQueue, telegram | `requirePermission(key)` / `requireTier(key)` factories in `lib/permissions.ts` (G9) |
| rename-impact endpoints | products, contacts, fees (×2), inventory, returns, settings | `lib/renameImpact.ts` beside the existing `lib/renameCascade.ts` (W14 touches the same file) |
| duplicate detection + dismiss/undismiss | products possible-duplicates/merge; contacts duplicates; customer link conflicts | generalised `lib/contactDuplicates.ts` — the Conflicts home the owner named |
| bulk-delete job trio | products and contacts each re-implement the HTTP trio over `lib/bulkDeleteEngine.ts` | one router factory |
| dashboard tiles vs `/api/sales/stats` vs `getStockMetrics` vs `familyStockStats` | four metric kernels | one metrics kernel fed by R7/R8/R12 rollups |

### 15.7 Production delta (release line vs `main`)

Read with `git show` and `git diff` against `origin/codex/release-stability-20260907` (560bfbcb); the
merge base with `main` is 9e19ac4a. **496 files differ** (+75,549 / −12,154): 195 exist only on the
release line, 8 only on `main`, 293 are modified. `cloudflare/wrangler.toml` is **byte-identical**, so
every production-only surface is code and migrations — no new binding, queue, cron, DO, variable or
`[limits]` change across 42 commits and 28 migrations.

| Bucket | Release-only | `main`-only | Modified |
| --- | --- | --- | --- |
| `cloudflare/migrations` | 28 (0106–0134) | 0 | 0 |
| `cloudflare/src/routes` | 2 (`reports.ts` 537 lines, `shifts.ts` 730 lines) | 1 (`customTables.ts`) | 23 |
| `cloudflare/src/lib` | 39 (`saleRecords`, `saleAmendments`, `saleBulkStatus`, `saleBulkUpdate`, `saleSettlementAction`, `saleLineAddition`, `saleCreationSnapshot`, `stockSession`, `returnBulkAction`, `shiftReconciliation`, `nativeSaleChange`, `paymentSettlement`, `paymentMethodRegistry`, `productSalesLedger`, `legacySubtotalRepair`, `financialPrecision`, `branchRoles` + `branchRoleGuards`, `requestBodyGuard`, `portalAbuseKey`, `portalImagePrivacy`, …) | 1 (`businessMetrics.ts`) | 43 |
| `frontend/src/api` | 4 (`reportsTransport`, `shiftTransport`, `branchRuleErrors`, `legacySubtotalRepairTransport`) | 1 (`customTablesTransport`) | 21 |
| `frontend/src/components` | 87 | 5 (`CustomTables.tsx`, `BranchStockAdjuster.tsx`, the three Sales report sections replaced by `routes/reports.ts`) | 168 |
| `frontend/src/utils` | 34 | 0 | 24 |

**Thirty release-only endpoints.** `routes/shifts.ts` (10: policy, current, list, history, open, close
×2, cancel, reopen, patch; `requireAuth` plus `hasAnyPermission(['pos','sales'])` and
`canManageShifts`/`canMutateShift`; five `db.batch()` sites; tables `shift_sessions`,
`shift_session_amendments`, `audit_logs`, and for figures `sales`, `returns`, `fees`).
`routes/reports.ts` (6: overview, periods, grouped, and three `business-summary/*` routes generated in
a loop; per-block `canReadSales`/`canReadReturns`/`canReadFees` with money masked for non-admin
users; **no `db.batch()`**, every statement awaited separately). Fourteen inside existing files:
sales `POST /bulk-status`, `POST /bulk-update` (0120), `POST /:id/amendments`, `GET /:id/amendments`,
`GET /:id/records`, `POST /:id/items` (0126), `GET /delivery-options`; returns `POST /bulk` (0125),
`GET /receipt-lookup`; inventory `POST /sessions` (0124); products stock-in-session reads and
`merge-preview`; actionHistory `/:id/details`; portal submission screenshots (0131); settings
payment-method backfill. Portal consent (0130/0131) is new columns on existing handlers, not new
endpoints.

**The sales-list "records count" — the plan's second-largest read, precisely.** It is
`lib/saleRecords.ts::buildSaleRecordsCountSql`, called from the `GET /api/sales` hydration closure for
every page: one statement per 100 sale ids (`D1_MAX_BOUND_PARAMS = 100`; page default 100, max 200),
carrying **six correlated scalar subqueries per row** — `sale_amendments`; `audit_logs` rows for the
sale minus three suppressions, the third of which is a **self-join on `audit_logs` with a
`julianday()` ±2-second predicate**; `sale_bulk_members`; customer returns without a create audit row;
return audit rows; and return bulk receipts walked with `json_each`. Six hundred subquery evaluations
per default page, none of them index-satisfiable in the `audit_logs` halves. The `audit_logs` half
counts status transitions, payment corrections, settlements, undo/redo and customer swaps for the
sale, minus the rows that are twins of an amendment, an add-items applier, or an explicit
correction/settlement row by the same user within two seconds. R3 therefore maintains
`sales.records_count` from the **same writers that already bump `sale_write_revisions`** (the 0120
trigger family and the amendment/bulk/return writers) and backfills it once from the verbatim
expression; the replacement is exact by construction because the expression is copied, not
re-derived (Appendix A).

**Main-tree findings re-checked on the release line.** Hold: the family CTE materialised in two
statements plus a third `family_members` CTE; inventory summary `SELECT p.*` with the correlated
`json_group_array` and no date bound; `allSales` identical to `todaySales`; dashboard `SUM(total_usd)`
beside `salesAnalytics` everywhere else; compat's 13-prefix array (its comment records the `/transfers`
leak); receipt numbers with no UNIQUE ("accepted" in the file); eight cold-start SELECTs **mounted
before `/health`**; settings read directly in 20 files; the single global `BroadcastHub` with no
coalescing; `quotaGuard` excluding D1 by design; all 60 revision triggers. Changed: `customTables.ts`
is **gone** on the release line (with its transport and page — `main` still carries it, so a merge must
not resurrect it); `lib/businessMetrics.ts` is gone; `cachedJsonResponse` now has ≈14 call sites in
four files including `GET /api/sales`, while `bumpVersion` has 24 caller files (the bump/read imbalance
grew); the import reaper gained a read-only pre-check so it costs one SELECT per list request instead
of two UPDATEs (J4 finishes the job); pagination is now **five** schemes (OFFSET on the sales list,
keyset + `snapshot_max_id` on the sales export, a second snapshot + cursor in `reports.ts`, the
window-ranked family OFFSET, and no paging at all on returns).

**Release-only guards and limits.** Four sentinel tables (`sale_bulk_guards`, `stock_session_guards`,
`return_bulk_guards`, `sale_mutation_guards`) assert batch atomicity — a `DELETE FROM …_guards`
closes each batch, and they are deliberately excluded from backups; append-only triggers on
`sale_amendments` and `shift_session_amendments`; nine shift reopen/cancel validation triggers (0123);
`sale_creation_snapshot_immutable` (0134); `lib/requestBodyGuard.ts`; `chunkForBinding` over
`D1_MAX_BOUND_PARAMS = 100` (the answer to the "too many SQL variables" production failure); the
restore escape hatch that suppresses all 60 revision triggers while `system_flags.maintenance` has
`$.mode = 'restore'`. Sales list `limit` default 100 / max 200 while two comments still say 500;
reports `pageSize` 250 / max 500; returns 500 / max 1000 with no cursor.

**The eighteen release-only tables all have readers.** Three are trigger-written only
(`sale_write_revisions`, `stock_session_revisions`, `return_write_revisions`) and read by the bulk,
settlement, repair and undo libraries; `stock_session_revisions` is read only by `lib/stockSession.ts`,
which is the open question behind W13 (whether the fifteen stock-revision writes an ordinary sale
performs buy anything outside a stock session). Fifteen of the eighteen are in `lib/backup.ts`; the
three sentinels are not.

**Write amplification, measured on the release line's `POST /api/sales`.** A five-line sale pushes 26
base rows (1 header, 5 items, 5 `branch_stock` upserts, 5 lot decrements, 5 `products` updates, 5
batch allocations) plus 5 movements; **26 trigger firings → 26 extra upserts** (11 into
`sale_write_revisions`, 15 into `stock_session_revisions`) **plus 26 restore-mode probes**. Returns
are worse: `return_revision_*` (0125) and `sale_revision_returns_*` (0120) both fire on `returns`,
`return_items` and their allocations, so one return row writes two revision families.

**New heavy shapes that exist only here.** `GET /api/shifts/` runs `shiftReconciliation` (sales +
returns + fees over the open→close window) **per listed shift** — O(N) aggregate passes (R19).
`reports.ts business-summary/*` searches with `instr(lower(a || ' ' || b || …), lower(@search)) > 0`
over four to six concatenated columns — a full scan by construction — and computes the
`snapshot MAX(id)` with the full predicate, then runs the predicate again for the page (R20). The
30-second health probe enters `app.use('*', ensureCoreDataInvariantsOnce)` before reaching the
one-line handler, so every cold isolate's eight SELECTs are paid by the most frequent request in the
system (R18).

## 16. Frontend: boot, state, transport, live updates, offline, build

### 16.1 Shape of `frontend/`

| Item | Count | Facts |
| --- | --- | --- |
| Source files under `src/` | 445 (452 with json/css/md) | one Vite entry, `index.html → src/index.tsx` |
| Roots | 2, chosen at module-eval time | `AdminRoot` or `PublicCatalogRoot` by `app/pathRouting.ts::isPublicCatalogPath`; both `React.lazy`, so one root chunk loads |
| Admin pages | 14 ids in `App.tsx::PAGE_IMPORTERS` | hubs absorbed former pages: sales = receipts + returns + fees; branches renders Inventory; review = queue + audit; settings = settings + users + backup; promotions absorbed loyalty |
| Transport functions | 278 across `src/api/*Transport.ts` | 194 distinct `/api/…` literals; the `window.api` facade in `web-api.ts` (1,513 lines) lazy-imports each transport module, so none is in the entry chunk |
| Portal transport | `api/portalPublicTransport.ts`, 17 methods | its own base URL, 10 s timeout, no cache, no `route()`, no mirror, no retry, no WebSocket, no `/health` timer |
| Local persistence | ≈30 `businessos_*` localStorage keys; Dexie `BusinessOS` v5 with 24 stores; a 6-hour `read_cache:` row layer | the Dexie schema must stay in step with `sw.js` |
| Tests | 162 files, 166 invocations in `test:utils` | `tests/testChainCoverage.test.ts` locks every file into the chain; the chain stops at the first red |
| Language packs | `en.json` 302 KB, `km.json` 576 KB, 4,464 top-level keys each | own Rollup chunks; a small inline `CORE_ENGLISH_PACK` covers first paint |

### 16.2 Boot

Nothing blocks first paint. `AppContext`'s startup effect resolves the sync URL (always
`window.location.origin` outside Vite dev), which in `web-api.ts` installs the session-recovery
listeners, schedules the WebSocket at 1.2 s, starts the 30 s `/health` timer with a 2.5 s first probe,
and arms the offline-maintenance loop (first run at 45 s, then every 5 minutes). The bootstrap payload
(`user, settings, organization, group, storage, system`) comes from three sources in order: an inline
`<script id="business-os-auth-bootstrap">` block the Worker may embed (**zero requests**), an early
promise started by an inline head script, or `GET /api/auth/bootstrap`. **A successful bootstrap seeds
settings, so `GET /api/settings` is not issued on boot** — it runs only with no stored session, on the
10 s watchdog, on an offline bootstrap, or from the `settings` sync channel. Part I's "settings refetched
on boot" is corrected accordingly; R11's version header still pays for itself on the sync-channel path.

Deferred mounts on the admin shell: chunk warm-up at 80 ms, storage cleanup at 2 s, QuickPreferences at
7 s (visible tabs), NotificationCenter and the pending-sync poll at 30 s (visible tabs; the poll reads
IndexedDB only), and **`BackgroundImportTracker` at 180 s on every visible authenticated tab** whether or
not an import has ever run.

The public catalog boots through the same entry with a stub context: `hasPermission` always false, no
sync context, light theme by default and never `prefers-color-scheme` (the storefront rule), a 20-minute
client cache in `PublicCatalogPage.tsx`. It shares only the entry HTML, the inline runtime guards and the
`vendor` chunk with the admin app — which is the case for splitting it into its own bundle (F13).

### 16.3 State and transport

`AppContext.tsx` (2,325 lines) holds fourteen `useState` slices; a narrow `SyncContext` keeps sync-status
consumers from re-rendering on settings changes. Two behaviours cost requests: a `users`/`roles`
broadcast whose payload id matches this session clears local business state and **re-runs the whole
bootstrap**, and `syncConnected` is polled with a `setInterval` (500 ms until connected, then 3 s) beside
the event it already receives.

`api/http.ts` (1,363 lines) is the entire admin transport:

- cookie auth with `credentials: 'include'`, a 12 s `AbortController` timeout, exactly **one** retry
  after 450 ms for connectivity errors only (no exponential backoff on HTTP; backoff exists on the
  WebSocket and the import poll);
- three cache layers — in-memory 20 s fresh / 45 s stale-while-revalidate, a write path that wipes the
  whole entity group (`cacheInvalidateWithDerived(channel.split(':')[0])`), and the 6-hour IndexedDB
  `read_cache:` copy;
- read dedupe by channel for ≥15 s; write dedupe by `(method, path, stable body)` where
  `stableStringifyForDedupe` **strips `client_request_id` and `idempotency_key`**, so two writes that
  differ only in their idempotency key collapse into one in-flight promise (F14);
- **no conditional requests of any kind** — a repo-wide search for `etag`, `if-none-match`,
  `if-modified-since`, `304` and `cache-control` finds no transport hit, so every stale revalidation and
  every cache miss downloads a full body (the ETag row in §6);
- `emitCacheRefresh` dispatches a synthetic `sync:update` beside `cache:updated`, so a background
  revalidation is indistinguishable from a server broadcast to every listening page — a re-render and
  refetch amplifier that F10 separates;
- call telemetry stays in memory (`getCallLog()`); nothing is sent to the server except crash reports.

`route(channel, serverFn, localFn?, options)` is the dispatcher every transport uses: fresh hit →
return; stale hit → return and revalidate; miss → in-flight reuse or a server request raced against the
Dexie mirror with a 350 ms server head start. Writes fail closed (`server_not_configured`,
`server_offline`) except the offline sale.

### 16.4 Every timer that reaches the network

| # | Where | Period | Endpoint | Hidden-tab behaviour |
| --- | --- | --- | --- | --- |
| 1 | `api/http.ts::startHealthCheck` | 30 s, first at 2.5 s | `GET /health` | **keeps running** |
| 2 | `web-api.ts::startOfflineMaintenanceLoop` | 5 min, first at 45 s | the 11-read snapshot (§16.5) on `main`; **on the release line the loop does network work only when the offline outbox is non-empty** (§16.8) | runs |
| 3 | `shared/BackgroundImportTracker.tsx` | 12 s idle, 3 s active, backoff to 60 s; mounted at 180 s on `main` | `GET /api/import-jobs?limit=8` | skips only when hidden **and** idle on `main`; **on the release line it polls only while mounted with active jobs** (§16.8) |
| 4 | `shared/NotificationCenter.tsx` | 2 h | `/api/import-jobs`, `/api/notifications/summary` | visible-gated mount |
| 5 | `web-api.ts::refreshServiceWorkerSoon` | 15 min | `GET /sw.js` | runs |
| 6 | `api/websocket.ts` ping | 25 s frame, 55 s pong deadline | `/ws` | refuses to connect or reconnect while hidden or offline; `min(60 s, 2 s × 1.8ⁿ)` ±20 %, 10 attempts, 60 s suppression after 3 abnormal closes — well behaved |
| 7–8 | Server page, Backup page, system jobs, contact import modal | 1–15 s | `/api/system/*`, `/api/backups`, `/api/import-jobs` | page-scoped |

Seven further timers (WS-status poll, pending-sync poll, clocks, POS bootstrap retry, catalog preview)
touch no network.

### 16.5 The idle request budget, re-derived on both lines

```
`main` working tree                                      release line (production, §16.8)
GET /health            3600 / 30       = 120 /h          GET /health @ 30 s, not visibility-gated = 120 /h
offline snapshot       11 × 3600 / 300 = 132 /h          offline maintenance: 0 /h with an empty outbox
GET /sw.js             3600 / 900      =   4 /h          GET /sw.js: 4 /h visible, 0 hidden
NotificationCenter     2 / 2 h         =   1 /h          NotificationCenter: 0.5 /h (one-shot re-alerts)
                       first 3 minutes   257 /h          ─────────────────────────────────────────────
GET /api/import-jobs   ≈ one per 24 s  = 150 /h          ≈124.5 /h visible, ≈120.5 /h hidden
                       steady state    ≈407 /h           + 144 WebSocket ping frames /h (DO, not HTTP)
```

Part I's ≈257 requests/hour was derived from `main`. On the release line the offline-maintenance loop
does network work only when the offline outbox holds something, the import tracker polls only while
it is mounted with active jobs, and the notification centre uses one-shot timers — the file's own
comment says the project "deliberately moved away from" idle intervals. What remains is the
**30-second health probe: ≈96 % of an idle production tab's requests, hidden tabs included**, and
each of those requests enters `app.use('*', ensureCoreDataInvariantsOnce)` before the one-line
handler, so a cold isolate's eight SELECTs are paid by the health probe. Eight tills with one tab
each, sixteen hours a day, is ≈15,400 `/health` requests per day — inside Free's 100k, but the wrong
shape for Free's 10 ms CPU budget (R18 moves the middleware to `/api/*`; F1 gates the probe on
visibility and lengthens it, since the WebSocket already proves liveness).

On `main` the snapshot (`api/offlineSnapshotTransport.ts::refreshOfflineDeviceSnapshot`) is eleven
**sequential full-list reads** — settings (cache invalidated first), categories, units, branches, the
whole product catalog, customers, suppliers, delivery contacts, all sales, all returns and
`inventory/movements?pageSize=5000` — gated on a stored session, `navigator.onLine` and server
health, not on visibility or on whether anything changed. The release line keeps the same eleven
reads but runs them on demand (outbox non-empty, forced on foreground recovery), so F2 ("rebuild only
on version change") is sized on the release line as the forced-on-focus and outbox-driven runs plus
the R1 snapshot object, not as a 5-minute loop.

Tab focus after ≥45 s hidden runs `recoverForegroundSession` on `main`: WebSocket resume, health
probe, a **forced** snapshot, then `dispatchSyncUpdates` over **22 channels**, so every mounted list
refetches at once. The fan-out was verified on `main` and must be re-measured on the release line
before F10 is sized (F10 replaces it with the hub's `since` cursor from J7).

Net effect on the F-items: F1 is the one Free-critical frontend item on production and is now
≈96 % of idle traffic; F2 keeps its Paid-value latency case and a smaller Free case; F9 becomes a
**regression pin** — a test that the tracker's 12-second idle loop from `main` (≈3,600 requests/day
per tab) never reaches the release line through a merge; F10 waits for measurement.

### 16.6 Pages → endpoints (the heaviest)

| Page | On mount | Payload class | After a write |
| --- | --- | --- | --- |
| Dashboard | `/api/dashboard/startup`, then `/api/dashboard` and `/api/analytics`, all keyed by start, end, granularity — **every range change is a new cache channel and a new request**; no local fallback | large | refetch on 9 sync channels |
| POS | `/api/products/bootstrap`, `/products/filters`, `/api/customers`, `/api/delivery-contacts`, `/api/batches?…` | bootstrap large; search server-paged (20, max 100) through one abort group | sale → invalidate `sales` + 4-channel fan-out |
| Products (65 files, 27.8k LOC, 44 endpoints) | `/api/products/search` or **`GET /api/products` = the whole ≈10,212-row catalog** | largest | refetch list |
| Inventory (inside Branches hub) | `/api/inventory/bootstrap`, `/stats`, `/movements` with **default `pageSize: 10000`, clamp 50,000** | largest | refetch list |
| Sales hub | `/api/sales`, `/sales/stats-strip`, `/api/branches`; reports on demand | large | refetch list |
| Contacts | per tab: `/api/customers`, `/suppliers`, `/delivery-contacts`; AR/AP reports on demand | large | refetch tab |
| Catalog editor | `/api/portal/bootstrap`, `/config`, `/api/promotions`; saving ≈60 `customer_portal_*` keys in one POST with a scoped `GET /api/settings/meta?keys=` | very large write | full settings reload |
| Portal (customer) | `/api/portal/config`, `/bootstrap`, `/catalog/meta`, `/catalog/products` | catalog large | cart/wishlist PUT, no refetch |

Cross-cutting: **no list virtualization anywhere** (no `react-window`, `react-virtuoso` or
`@tanstack/react-virtual` in `src/` or `package.json`); `shared/PaginationControls.tsx` (35 files, 81
references) is the only large-list strategy and several pages paginate an array they already fetched
whole. **Refetch-after-mutation dominates**: ≈279 sites re-run a `load…()` after a write against 4
deliberate channel fan-outs, and `route()`'s write path invalidates every query variant of the entity,
so one edited row refetches the full list (F11, the largest interactive request source on a busy day).

### 16.7 Offline design

Reads with a `localFn` work offline (products, lookups, branches, branch stock, contacts, sales, sale
items, returns, audit logs, movements, transfers, settings); dashboard, analytics, every report,
imports, backups, users and devices do not. Mirrors are written on 8–10 s idle delays. Writes fail
closed except the offline sale, which goes to Dexie `sync_queue` and replays in `_seq` order under a
60 s IndexedDB lease shared with the service worker's Background Sync handler. The encrypted general
outbox (`sync_outbox`) posts one batch to `POST /api/sync/outbox`; each operation carries
`client_request_id`, `operation_id`, `schema_version`, `base_updated_at`, `entity_table`, `entity_id`
and a SHA-256 `payload_digest`, results are matched by id, HTTP 423 / `system_busy` pauses for 60 s.
Offline file uploads use the chunked `SyncUploadSession` path (init → chunk → complete) with SHA-256 per
chunk and a manifest row at `chunk_index = -1`; resumed uploads skip synced chunks.

The service worker (`public-runtime/service-worker.ts`, ≈26 KB) precaches 16 shell URLs plus every
built asset from `business-os-precache.json`, prunes older shells, handles the outbox sync tag and the
skip-waiting message that the full-width "Restart now" bar uses. Two PWA manifests share one scope,
so an admin deploy evicts the customer's offline storefront shell — a second reason for F13.

W8/F7 (one replay driver with per-device sequence numbers) keep both queues and add ordering across
them; nothing in the offline design is rewritten.

### 16.8 Production delta (release line vs `main`)

The release line changes 254 frontend source files against `main` (87 components added, 5 removed,
168 modified; 34 utilities added; 4 transport modules added — `reportsTransport`, `shiftTransport`,
`branchRuleErrors`, `legacySubtotalRepairTransport` — and `customTablesTransport` removed). The two
fixes named in the fleet notes are small: **F45** (`api/websocket.ts`, +14 lines) makes a tab that hit
the 60-second reconnect suppression schedule one wake-up at the end of the pause instead of waiting
for the next focus event — more reconnect attempts in an outage, still bounded by the same backoff.
**F41** (`api/http.ts`) is not an interval change: it adds `retryTimedOutRead` and a `request_timeout`
error code so a caller with its own deadline can skip the second attempt, and two constants
(`HEALTH_PROBE_TIMEOUT_MS` 4 s, `HEALTH_PROBE_REUSE_MS` 8 s) that dedupe concurrent probes.
`HEALTH_CHECK_INTERVAL_MS` is 30 s on both lines, and `ensureHealthLifecycleListeners` registers only
an `offline` listener — no `visibilitychange`.

Recurring network loops on the release line: the health probe (30 s, not hidden-gated); the
service-worker update (15 min, skipped when hidden or offline, with a minimum gap on
`visibilitychange`); offline maintenance (5 min, network only with a non-empty outbox); the
notification centre's import-jobs read (2 h) with one-shot re-alert timers; the POS 45-second retry
only while a queued sale is pending; page-scoped timers on the Server, Backup, Reset, import tracker
and catalog pages while mounted. The pending-sync (20 s) and WebSocket-status (3 s) polls read local
state only. Conditional requests: **none on the JSON API on either line** — the only `ETag` is in
`lib/r2.ts` for assets; the four `Cache-Control` headers are all `no-store`; freshness is carried
server-side by `cachedJsonResponse`, whose version string is already the ETag the client never sees.

What this does to the frontend items: F1 is confirmed and grows in weight; F2's loop-based saving
does not exist on production (the on-demand runs remain); F9 is a regression pin; F10 needs a
release-line measurement; the ETag item stands unchanged; F11–F14 are lineage-independent.

### 16.9 Build

Vite 5.4, React 18.3, TypeScript 5.9, Tailwind 3.4. `manualChunks` is ≈330 lines of explicit rules
(vendor splits, one chunk per transport module, language packs, icons by name); a documented cycle
(`catalog-public → product-shared → app-shared → catalog-public`) is being unpicked. Build-time plugins
inline the runtime noise guard and theme bootstrap into the head, strip `crossorigin` for the LAN proxy,
emit the build and precache manifests, and defer render-blocking stylesheets. There is **no
`import.meta.env` anywhere**; three `define` globals carry the server URL, build hash and revision, and
runtime configuration comes from `window.location.origin` and the settings payload. The dev proxy sends
`/api`, `/uploads`, `/health` and `/ws` to the Worker on 8787. The `@fontsource/noto-sans-khmer` weights
are imported statically in `index.tsx`, so Khmer glyphs never flash; the 576 KB Khmer pack is its own
chunk and a transfer cost only.

## 17. Cross-cutting domains, tooling, tests, operations

Read on `main`'s working tree and re-checked by symbol on the release line (560bfbcb) wherever the
two differ; every "release line" statement below was taken from `git show`, never from a checkout.

### 17.1 Permissions, end to end

`cloudflare/src/lib/permissions.ts` is the source of truth. A permission value is `true`, absent, or
one of two middle tiers held as string literals: `'review'` (queue for approval) is valid for
`products, inventory, branches, returns, fees, contacts`; `'view'` (read-only) for `settings, sales,
promotions, review, audit_log`, where `audit_log`'s view tier is **own-scoped** — a viewer sees only
their own rows. `getMergedPermissions` spreads the role's JSON and lets the user's JSON override per
key; `hasPermission` is a strict `=== true`, so a tier string never reads as full access at a call
site that has not been migrated to `getPermissionTier`; `isAdminControlUser` short-circuits for the
`admin` username, the `admin` role code or `permissions.all`. Per-action overrides
(`{"products:delete": false}`) are deliberately one-way: an override can remove an action the tier
granted, never grant one it withheld. There is **no `users` key** — every route in `routes/users.ts`
gates on `isAdminControlUser`, so a toggle would be a control that does nothing (the recorded rule).

Enforcement is **per handler, not middleware**: 55 `hasPermission(` and 9 `isAdminControlUser(`
call sites in `routes/*.ts` on `main`, each resolving `c.get('user')` from the three-table session
join §14.2 describes (no in-Worker permission cache); `POST /api/sales` accepts either `pos` or
`sales`. The frontend mirror (`frontend/src/utils/permissions.ts`, `permissionDefinitions.ts` with
39 keys) is **hand-kept in sync** and has drifted once (`library` removed from one copy only). Gating
in components is ad hoc through `AppContext`'s `hasPermission` / `canAccessPage` / `can`. A role or
user edit reaches live sessions through the `users`/`roles` broadcast, which re-runs the bootstrap
fetch when the edited id is this session's — the fan-out F10 replaces with a session patch.

What the plan takes from this: G9's default-deny compat auth and `requirePermission`/`requireTier`
factories are additive to a model that is already precise; the missing piece is that the two tier
key sets are copied by hand, so G9 also generates them into both packages from one source (a test
compares the generated files). The release line ships `test-route-permissions-pure.cjs`, which is
the "no route without a guard" test's natural home.

### 17.2 Audit and undo

`audit_logs` has exactly **one writer**, `lib/audit.ts::audit(...)` — 133 call sites on `main`,
one row per call, `details` JSON-stringified, device name and timezone looked up from the caller's
most recent live session, errors swallowed so an audit failure never fails the request. Sale
creation writes **no audit row** on `main` (the file's two calls are both status updates); returns,
adjustments and imports write one row per action, not per unit. Retention defaults to 21 days,
enforced from the 6-hour cron throttled to once a day, deleting 5,000 rows per pass **by id** (the
release line adds `test-audit-retention-pure.cjs`). R3's `(created_at, id)` index is what that delete
needs; R3's counter has one more dependency the release line makes explicit: the sales-list records
count includes the audit rows written for a sale, so the writers of those rows are among the ones
that bump `sales.records_count`.

Undo is two mechanisms. The older client replay keeps `undo_payload`/`redo_payload` (capped ≈20 KB)
in `action_history` and replays from an in-memory closure that **dies on reload**. The newer
server-side appliers (`lib/undoAppliers.ts`, 711 lines) replay a registered `applier` in the Worker:
`branch.update`, `product.merge`, `product.merge.bulk` (reversals in application order, replayed in
reverse) and `supplier.backfill`; the merge reversal lives in `undo_snapshots` (0097) because it
exceeds the payload cap, and redo re-runs the production fold through `registerMergeFold` rather than
a second copy of the SQL. Every applier is permission-gated at record, map and operate time with the
forward action's own key. `action_history` ages out at 180 days (`lib/ephemeralRetention.ts`);
**`undo_snapshots` has no retention step on either line**, so a snapshot outlives its owner as
unreachable residue (J9).

### 17.3 Identity, conflicts and merges

Two active products are the same item iff same `name_key`, same cost price (USD and KHR) and same
barcode; selling and special price are mergeable, never identity (`lib/productIdentity.ts` →
`productDetailRule.ts`). The file records the bug that motivated this: the rule once compared the
legacy purchase-price columns, always 0, so different-cost rows passed as duplicates.
`findIdentityMatch` runs at transfer and add-stock time; `findDuplicateProductGroups` feeds the
auto-merge sweep and demotes ambiguous clusters to manual review; `findPossiblySameProductClusters`
feeds the Conflicts tab in three severities (`same_barcode`, `same_name`, `similar_name`) with
dismissals in `product_duplicate_dismissals` keyed by a control-character-delimited pair.

The fold (`foldDuplicateProductInto`, registered into the undo appliers) moves `branch_stock`,
pricing, images, batches and lot rows, and re-parents **only** `sale_items.product_id` and
`inventory_movements.product_id`. It does **not** re-parent `return_items.product_id` — the release
line rewrites `return_items.product_name` on rename and nothing else — nor
`return_item_batch_allocations`, `stock_transfers`, `stock_row_moves` or the three RFID tables. A
return against a product later merged away keeps the deactivated id and drops out of the survivor's
return history. The customer merge is wider (it re-parents `loyalty_point_adjustments` after an
earlier gap). The owner's rule is that a resolution moves every linked record, so W17 sweeps every
`product_id`- and `customer_id`-bearing table into the fold and its reversal.

### 17.4 Stock writers, seen from the write side

Seventeen modules write `branch_stock`, the lot ledger or `inventory_movements`. Every ordinary
writer — `saleTransitions`, `returnsStock`, `stockActionCommit`, `stockRevert`, `importEngine`,
`salesImportCommit`, `datedStockCountApply`, the merge reversal, and the branch, inventory, products,
returns and batches routes — builds one `{sql, params}[]` (A-ledger delta, lot delta through
`productBatches.ts` helpers, movement insert) and commits it as one `db.batch()`. Two writers touch
one ledger on purpose: `lib/dataIntegrity.ts` (the repair tool, whose job is to recompute
`branch_stock`) and `lib/coreDataInvariants.ts`, whose org-bootstrap backfill inserts a
`branch_stock` row for any product with none and **creates no lot** — non-zero branch stock, zero lot
stock, the "28 here, 0 there" fork §13.3 describes, at a fresh call site. W12 routes the backfill
through the stock-write library so it writes an opening lot, and R16 fixes its `NOT IN`.

### 17.5 Sales lifecycle facts the plan relies on

Six statuses (`lib/salesStatus.ts`): `completed, awaiting_payment, awaiting_delivery, cancelled,
partial_return, returned`. Stock is deducted for `completed` and `awaiting_delivery`. A sale
**imported** as `returned`/`partial_return` restocks directly; a live sale transitioning into those
statuses never restocks itself — the returns flow owns restock, so a real return is always a
`returns` row. `awaiting_payment` is the credit sale; `customer_receivables` (0094) is written from
the contacts route (W15 adds its `sale_id`).

The revenue kernel is `lib/salesAnalytics.ts`, and the two lines **disagree**: `main` still
implements the 1 September rule (credit excluded from revenue, surfaced as `pending_revenue_usd`);
the release line implements the 6 September rule — the `awaiting_payment` cohort is **inside**
revenue, COGS and profit, `collectedSaleExpr` isolates the collected subset, and
`test-credit-in-revenue-pure.cjs` pins it. The N48 kernel and the G5 lint are therefore built on the
release line's expressions, and a merge from `main` into any lane gets a regression pin on this file.
Refunds join through `CUSTOMER_REFUND_JOIN` and land in the **sale's** date bucket, which is what
keeps a window from showing negative revenue. Sale amendments, the creation snapshot and shift
sessions exist only on the release line (§18.1); their absence from `main` is lineage, not a defect.

### 17.6 Pipelines as edge lists

- **Import**: `routes/importJobs.ts` → `IMPORT_QUEUE` → `queue.ts::handleImportQueue` →
  `importEngine.runImportAnalyze/runImportApply` (staging rows in `IMPORT_DB`, commit into `DB`) →
  `importRetention.ts` (artifacts 24 h past terminal, summaries 7 days; `import_auto_merges` kept) →
  DLQ consumed separately. G6 admits jobs against the day's write budget before the queue sees them.
- **Backup**: cron → `lib/backup.ts` pages every table (J1 makes it keyset and incremental) → R2
  (keeps two) → `BACKUP_QUEUE` continues asset copies 100 objects per invocation from a KV cursor →
  Drive mirror; restore stages under a prefix that cannot evict a real backup and is gated by
  `backup_restore`, never plain `backup`.
- **Media**: upload → R2 → `MEDIA_QUEUE` → Images binding → `imageAudit.normalizeStoredImage`; no DLQ.
- **Notifications**: Telegram only (`lib/telegram.ts`; the release line's dated commands are
  `/report, /today, /summary, /sales, /fees, /shift, /shifts`); Resend is scoped to account-recovery
  email and no-ops without its keys.
- **Exchange rates**: a `settings` row read directly by seven modules — R11's isolate snapshot is
  what stops each of them reading it ad hoc.
- **Loyalty**: computed from sales (`loyalty_accrual = 0` on migrated rows, so history never
  accrues) plus the stored `loyalty_point_adjustments` ledger.

### 17.7 Tooling, deploy path, version stamps

`run/*.bat` are three thin wrappers over `ops/scripts/powershell/*.ps1`. `verify-local` removes
strays, installs both packages, typechecks, runs the pure suites and builds — it **never** calls
wrangler or touches any D1. `full-automation` has nine steps with `wrangler deploy` at step 8,
remote migrations for both databases at 5–6, secret sync from `.dev.vars` at 7 and a `/health` poll
at 9; its own comment says the health string cannot prove *which* version is live. `open-app` opens
the admin URL. The rest of `ops/scripts/` is `verify-i18n`, the pre-React runtime scripts builder,
the route-contract drift checker (`contract-diff/*.cjs`, backend routes against frontend calls),
dated one-off migration scripts, and a prior architecture audit. `.claude/launch.json` holds nine
configurations (two read-only production URLs, two Vite ports, two `wrangler dev -c` ports and three
lane worktrees) — the `-c` flag is already the seam Part I's `wrangler.<tier>.toml` uses.

Version stamps: on the release line `/api/runtime/version` substitutes the git revision and source
hash at deploy time (the signal the `-dirty` triage relies on), while `/health` still returns the
hard-coded `cloudflare-portal-bootstrap-20260728` — two endpoints, two truths. G13 makes the deploy
stamp (commit, dirty flag, tier) the single value both return, and R18 makes `/health` static so the
stamp costs no D1 read. `planTier.ts`, `wrangler.free.toml` and the `PLAN_LIMITS` table exist only in
six superseded commits on unmerged refs; Part I §9–§10 rebuilds them from the design, not the code,
with the `-Tier` parameter threaded through both PowerShell scripts (only `full-automation`'s steps
5–8 need care, since a wrong tier there deploys the wrong config to the wrong Worker and database
pair) and a per-tier smoke that asserts a Free deploy actually clamps to its ceilings.

### 17.8 Test estate

On `main`: 161 frontend test files (160 named in the `test:utils` chain, the 161st imported
transitively and guarded by `testChainCoverage.test.ts`) and 162 Worker scripts, none of which hit
the network or a real D1 (fetch stubbed; `better-sqlite3` as the local stand-in). The Worker side
has **no chained command** — the sweep is the shell loop in `CLAUDE.md`. On the release line the
estate is **309 frontend and 280 Worker files**, adding by name `test-route-permissions-pure`,
`test-product-merge-undo-pure`, `test-audit-retention-pure`, `test-import-retention-pure`,
`test-sales-analytics-*`, `test-sales-revenue-convergence-pure` and `test-credit-in-revenue-pure`.
What still has no named test on either line: the two Durable Object classes, the queue consumer and
DLQ path themselves, the cron runner, and the server-side appliers other than the merge. G11 adds
those, gives the Worker harness one chained `test:pure` command, and carries the two regression pins
this atlas produced (the 6 September revenue rule; the event-driven import tracker). Every plan item's
parity test (§10) lands in the same pure harness; the `EXPLAIN QUERY PLAN` tests need the
`better-sqlite3` stand-in that already exists there.

### 17.9 What §17 adds

W17 (merge re-parenting completeness), J9 (`undo_snapshots` retention), G11 (Worker harness and the
missing named tests), G13 (one build stamp) as new rows in §6.1; the org-bootstrap backfill folded
into W12; the generated tier key sets folded into G9; the R3 counter's audit-row dependency; the
regression pins for the revenue kernel and the import tracker.

## 18. Lineage, recorded decisions, ownership

### 18.1 Which code is live

| Line | Ref | Tip | Highest migration | Role |
| --- | --- | --- | --- | --- |
| **Production** | `origin/codex/release-stability-20260907` | **560bfbcb** (2026-09-07) | 0134 | deployed 2026-09-07 15:36 UTC as Worker version `03aa25a5-…`; provenance recorded at progress.md line 3 and in `docs/fleet/2026-09-07-owner-task-register.md` |
| Its ancestor | `origin/codex/business-os-reconcile` | 9ab9fd7a (2026-09-05) | 0127 | the line earlier fleet notes called production; superseded by release-stability |
| Takeover clone | `C:\Users\mrkl6\Downloads\bos-codex-takeover-20260907` | 501109d0 | 0134 | forks from release-stability at ea9f0d1b, before the F41/F44/F45 fixes |
| Takeover branch in this repo | `codex/takeover-20260907` | cef9382b (2026-09-08) | **0135** | carries `0135_product_merge_plan_lookup.sql` (also on `codex/f40-reconcile-preview-20260908`) |
| `main` | committed HEAD fd5716b3 | — | 0105 committed; an untracked 0106 in the working tree | 42 commits ahead / ≈500 behind release-stability; lacks 0107–0134 and their Worker code |
| Plan-tier source | `rc/coordinated-2026-09-02` and descendants | never merged | carries a colliding `0106_barcode_aliases.sql` | `planTier.ts`, `PLAN_LIMITS_BY_TIER`, `wrangler.free.toml` are mined from here (§9), never re-merged |

Consequences for this plan:

- **Branching point.** Every lane this plan spawns forks from `origin/codex/release-stability-20260907`
  (or its successor once the fleet moves the production pointer), not from `main`. A lane forked from
  `main` would carry migrations 0107–0134 as "new" and fail the append-only rule at the first deploy.
- **The live stamp could not be read** for this revision: `/health` and `/api/runtime/version` answer
  Cloudflare's managed challenge to non-browser clients. The deployed commit is therefore taken from the
  recorded provenance, which is the rule anyway (never infer that `main` is deployed).
- **Migration numbering.** 0134 is applied on the production chain, 0135 exists on two unmerged lanes,
  so the first number this plan can use is **0136**, taken only after a fresh sweep of every ref plus the
  production `d1_migrations` chain and reserved in the fleet ledger (§11).
- **`main`'s Worker tree is not what runs.** The route inventory in §15 counts 346 endpoints on `main`;
  the production line adds the sale-amendment, shift-session, bulk-status, stock-session, return-bulk,
  mutation-receipt and portal-consent surfaces (§15.7). Any citation of a query shape from `main` was
  re-found on the release line by symbol before it entered §6.

### 18.2 Decisions recorded in the ledger that shape the architecture

| Decision (source) | Effect on this plan |
| --- | --- |
| Multi-D1 only for tables that never join or batch with the operational cluster; `IMPORT_DB` is the model (progress.md, 2026-09-06) | §13.7 cut map; rollups and telemetry as optional bindings with `DB` fallback; audit stays as the write target |
| One canonical revenue definition — net sales, tax and delivery excluded, refunds subtracted, **credit sales count**; the N48 accounting-kernel lane is still open | R8's rollup writer calls the kernel and never re-encodes the predicate; the dashboard's `SUM(total_usd)` is retired through that lane, not around it |
| Product identity: same name + same details merge, only a different barcode makes a new child row; N50–N54 (merge FK reparenting) unresolved; 0109 applied with residue | W16 merge-aware rollup maintenance; the family CTE rewrite (R2) keys on `family_key`, which the identity lane owns |
| Batch and branch identity end to end; two canonical branches, `warehouse` never sells | W1 single-batch sale, W12 stock-write library with the A↔B invariant, `warehouse` greyed in sale-side pickers |
| Dates are day-first `dd/mm/yyyy` everywhere (reaffirmed 2026-09-06) | the fleet's `consistency-audit.md` still says `mm/dd/yyyy` and is **stale on that point**; this plan cites the owner's rule, not that file |
| Prepared is not live; deploys from committed HEAD in an isolated worktree with explicit authorization; migrations append-only, LF-only triggers, pre/post assertions | §11 rollout, G8 deploy guard, every Appendix A sketch marked illustrative |
| Every history surface shows branch, acting **username** and timestamp; a username rename cascades system-wide | W14 extends `USER_NAME_SNAPSHOTS` to the 0116–0133 tables |
| Users/roles management is admin-only and not a per-role toggle | no plan item touches the `users` permission key |
| The daily shift prompt is intentional; cash registration is report-only | `shift_sessions` index (R13) and backup coverage (J1) only; no behavioural change |
| Sessions stay under 300K context; talk to peers before touching any file; path-scoped commits | Part II was produced by seven bounded agents; INV-9's owner was messaged before any `cloudflare/src` path was named as a proposal target |

### 18.3 Open lanes that overlap the proposal targets

| Lane | Owner surface | Overlap with this plan | Rule |
| --- | --- | --- | --- |
| N48 accounting kernel | `lib/salesAnalytics.ts`, `compat.ts` dashboard tiles, reports | R8, G5's revenue lint, §15.5 item 2 | the kernel lands first; R8 consumes it |
| N50–N54 product identity and merge | `lib/productIdentity.ts`, `products.ts`, 0135 | R2 (`family_key`), W16, R6 | R2 waits for `family_key`'s owner to name the column |
| N45 stock correction | stock writers, `returnsStock.ts`, `undoAppliers.ts` (dirty in the working tree at the time of writing) | W1, W3, W12 | W12 is proposed to that lane's owner, not started beside it |
| F42 contacts | `contacts.ts`, duplicates tab | §15.6 duplicates generalisation | proposal only |
| Reports de-duplication | day/daily/customer/delivery reports | R8, R15 | proposal only |
| Imports | `importEngine.ts`, `importJobs.ts` | G6, J4, F9 | J4 and F9 are self-contained; G6 is proposed |
| INV-9 (inventory) | `routes/inventory.ts`, `familyStockStats` | R14, R12, R7 | messaged 2026-09-08 before this file named the paths |

Nothing in Part II is claimed. Every file named above is a **proposal target**; a lane starts only
after the ledger claim, the peer message and the branch-sweep in the fleet skill.

### 18.4 Memory-only claims, marked for re-verification

- "22 products merged by 0109 with stranded batches" — the number is not in the migration file (705
  candidates, 2,045 batch rows); re-verify against production `d1_migrations` and `products` before W16
  relies on it.
- "32–199 BroadcastHub errors/day" — from platform analytics; no source path records them (§14.5).
- "`IMPORT_DB` is bound in production" — the binding is optional with a `DB` fallback; the deployed
  `wrangler.toml` binds it, but only the Worker's live environment proves it. G1's readout reports
  which databases are actually bound.

## 19. The match: atlas findings → plan items → Free and Paid

### 19.1 Every finding, its item, and what it means on each tier

"Free" and "Paid" say what the finding costs or buys on that tier, so the two variants can be read
straight off this table. "Both" in the Free column means the item is correctness, not quota.

| Finding (atlas §) | Item | Free | Paid | Phase (§11) |
| --- | --- | --- | --- | --- |
| Family CTE materialised 2–3× per page for four route files (15.4 #1) | R1, R2 | the single largest rows-read source; must go | latency and CPU on the busiest read | 2 |
| Inventory summary: `p.*` × whole sales and returns history, no LIMIT (15.4 #2) | R14 → R12 | second largest per call; must go | latency on the Inventory page | 1 → 3 |
| `allSales` duplicates `todaySales` byte for byte; it is date-scoped (15.4 #3) | R8 | one scan per dashboard load | same | 3 (safe to take early) |
| Sales-list records count: six correlated subqueries per row, two of them `audit_logs` scans with a `julianday()` self-join (15.7) | R3 | ≈29 M rows/day today | latency on every sales page | 1 |
| Cold start: 8 SELECTs and a materialised `NOT IN` (14.2) | R4, R16 | Free's 10 ms CPU budget makes the cold path the likeliest overrun | cold-start latency | 1 |
| Settings read ad hoc per consumer, never versioned (14.2) | R11 (scope narrowed: not on the request path) | small | small | 2 |
| `audit_logs` has no index; notifications scan it every 2 h per tab; audit list runs COUNT + 2 DISTINCT facets (13.4, 15.4) | R3, R13, R17 | rows read | latency | 1, 3 |
| Six further hot indexes missing; three redundant (13.4) | R13 | rows read; index writes are deliberate | latency | 1 |
| Nine of the twenty heaviest shapes filter on a function of a column (13.4, 15.4) | R15, G5 | rows read on every report grouping | latency | 1–3 |
| Three pagination strategies; returns truncates silently at 1,000 (15.5 #3) | R9 | rows read on deep pages | correctness | 3 |
| Time-of-day scoping only on sales (15.5 #4) | R9's file set | Both | Both | 3 |
| Three revenue predicates; dashboard sums `total_usd` (15.5 #2) | N48 kernel → R8, G5 lint | Both | Both | 3 |
| Notifications summary is one 675-line endpoint re-deriving loyalty per customer (15.4 #6) | R10, R17 | rows read | latency | 3 |
| Three stock ledgers, nine A-only writers, no A↔B reconciliation, transfers skip lots (13.3) | W12 (+W1, W3) | Both | Both | 4 |
| Branch scoping hand-written 30+ times (15.5 #5) | W12 (`lib/branchScope.ts`) | Both | Both | 4 |
| 60 revision triggers with a per-row restore-mode probe on `system_flags`; a five-line sale's 26 base rows fire 26 revision upserts + 26 probes (13.5, 15.7) | W13 | **the** item for the 100k writes/day wall | write latency | 4 |
| One import writes each row three times (13.5) | G6 | Free-critical | none | 6 |
| Receipt number non-unique; same-second race accepted (13.6) | W2 | Both | Both | 4 |
| `customer_receivables` has no `sale_id` (13.6) | W15 | Both | Both | 4 |
| 101 of 105 money columns are `REAL` (13.6) | decision: no type migration; rounding in the write kernel; CHECKs on new columns only | — | — | — |
| `USER_NAME_SNAPSHOTS` misses every table since 0116 (13.6) | W14 | Both | Both | 1 |
| 0109 merges left residue and no audit trail; 0135 adds merge lookups on an unmerged lane (13.6) | W16 | Both | Both | 3 |
| 15 route files bump cache versions, 4 read through the cache; KV→D1 fallback is silent and permanent (14.3) | W11, G1 | **the** item for the 1,000 KV writes/day wall | noise | 2 |
| Reaper runs on every `GET /api/import-jobs`: two UPDATEs on `main`, one pre-check SELECT on the release line (14.4) | J4 | one statement per list request | same | 1 |
| Backups page with OFFSET; quadratic on the large tables (13.8) | J1 | ≈26 M rows/day | cron CPU | 1 |
| Eight-step cron with no budget check or resumable cursor (14.4) | J2 | Free-critical (jobs must fit the day's budget) | operability | 5 |
| BroadcastHub: one global instance, no coalescing, no cursor, errors swallowed (14.5) | J7, W6 | DO requests count against Free's 100k/day | reconnect storms | 2, 4 |
| `SyncUploadSession` never cleans up (14.5) | J8 | Both | Both | 5 |
| `quotaGuard.ts` budgets four pools and excludes D1 (14.6) | G1 extends it | Free-critical | Paid-value readout | 0 |
| Two rate limiters, most writes unthrottled (14.2) | §5.8 Rate Limiting binding | D1 writes off the counter | hygiene | 6 |
| ≈60 hard-coded limits (14.6) | G8, §9 `PLAN_LIMITS_BY_TIER` | Free-critical | — | 6 |
| Auth applied four ways; compat's 13-prefix array once exposed `/api/transfers` (15.5 #1) | G9 | Both — security first | Both | 0 |
| Dead code and mixed line endings (14.7, 15.5 #8–9) | G10 | Both | Both | checkpoint |
| `importEngine.ts` at 5,799 lines owns five stock pipelines (14.7) | G12 after W12 | structural | structural | after 4 |
| Offline snapshot: 11 full-list reads every 5 min per tab on `main`; on the release line only with a non-empty outbox or on foreground recovery (16.5, 16.8) | F2, R1 | the largest client-caused row volume; must go | Paid-value | 2 |
| Health poll every 30 s with no hidden-tab gate — ≈96 % of an idle production tab's requests (16.4, 16.8) | F1 | ≈2,900 requests/day/tab; the one Free-critical frontend item on production | — | 2 |
| Import-job poll every ≈24 s on every tab on `main`; event-driven on the release line (16.5, 16.8) | F9 (regression pin) | ≈3,600 requests/day/tab if merged back | — | 2 |
| Focus storm: forced snapshot + 22-channel fan-out; a matching `users`/`roles` broadcast re-bootstraps (16.5, 16.3; measured on `main`, re-measure on the release line) | F10 (needs J7) | requests and rows per focus | reconnect load | 2 |
| No conditional requests anywhere (16.3) | ETag row | rows and bytes on every revalidation | bytes and latency | 2 |
| ≈279 refetch-after-write sites; write path wipes the entity group (16.6) | F11 | interactive requests | same | 4+ |
| No list virtualisation; `pageSize: 10000` defaults (16.6) | F12 | rows read once page sizes drop | memory and latency | any |
| Portal shares the admin bundle and service-worker scope (16.2, 16.7) | F13 | — | first paint, edge cache, deploy isolation | any |
| Write dedupe strips the idempotency key (16.3) | F14 | Both | Both | 4 |
| Dashboard has no local fallback and every range is a new request (16.6) | R8 cached + ETag | rows read | latency | 3 |
| Production is 560bfbcb on the release line; `main` lacks 0107–0134 (18.1) | branching-point rule; 0136 | Both | Both | 0 |
| Multi-D1 gives no quota relief on Free (13.7) | §5.2 optional bindings | no effect | isolation, backup scope, Time Travel | 5+ |
| `/health` and `/ws` are mounted after `app.use('*', ensureCoreDataInvariantsOnce)`, so the 30 s probe pays the cold path (14.2, 16.5) | R18 | Free-critical: the most frequent request in the system must not run eight SELECTs on a cold isolate | latency | 0 |
| `GET /api/shifts/` runs `shiftReconciliation` per listed shift (15.7) | R19 | rows read per list, O(N) | latency | 3 |
| Reports search uses `instr(lower(a \|\| ' ' \|\| b …))` and computes the snapshot `MAX(id)` with the full predicate (15.7) | R20 | a full scan on every report search | latency | 3 |
| Five pagination schemes on the release line; two sales comments say 500 while the code caps 200 (15.7) | R9 | rows read on deep pages | correctness | 3 |
| The release line carries 30 endpoints, 18 tables and four sentinel guard tables that `main` lacks; `customTables.ts` and `businessMetrics.ts` are already gone there (15.7) | branching-point rule; G10 must not resurrect them | Both | Both | 0 |
| `wrangler.toml` byte-identical across `main`, the reconcile line and the release line (15.7) | none — every production-only surface is code | Both | Both | — |
| Product merge re-parents only `sale_items` and `inventory_movements`; `return_items` and four more `product_id` tables keep the deactivated id (17.3) | W17 | Both — correctness | Both | 3 |
| `undo_snapshots` has no retention; its owning `action_history` row ages out at 180 days (17.2) | J9 | table growth | same | 5 |
| Org-bootstrap `branch_stock` backfill creates rows with no lot — the two-ledger fork at a fresh call site (17.4) | W12 | Both | Both | 4 |
| `/health` returns a hard-coded 2026-07-28 string while `/api/runtime/version` carries the deploy stamp (17.7) | G13 (with R18) | — | provenance | 0 |
| Revenue kernel: `main` still implements the 1 September rule; the release line implements the 6 September rule (credit inside revenue) with a pinning test (17.5) | N48 and G5 built on the release line; regression pin in G11 | Both | Both | 0 |
| Worker tests are 280 independent scripts with no chained command; no named test for the DO classes, the queue consumer or the cron runner (17.8) | G11 | — | — | 1 |
| Permission tier key sets hand-copied between packages and drifted once (17.1) | G9 addendum | security | security | 0 |

### 19.2 The two variants, read from the atlas

| | Workers Free, maximised | Workers Paid, maximised |
| --- | --- | --- |
| Reads (5 M rows/day account-wide vs 25 B/month) | R1, R2, R14, R3, R13, R15, R4/R16, J1 are all mandatory; the snapshot objects and rollups carry the day; the target is ≈3 M rows/day with jobs included (§11) | the same items for latency; Paid keeps the headroom to run the whole-history aggregates once a day for the verifier (J5) instead of never |
| Writes (100 k rows/day vs 50 M/month) | W13 first, G6 before any import, W11 for KV; index count chosen once (R13) | W13 for latency; imports unthrottled up to the CPU limit |
| Requests (100 k/day vs unlimited) | F1 (≈96 % of an idle production tab), R18, F2, F10 and W4 keep five open tabs under ≈5 k/day, and F9 pins the release line's event-driven tracker; J7 keeps DO requests under the DO wall | F-items for battery and latency only |
| CPU (10 ms vs 30 s per request) | R4/R16/R18 cold path, no bcrypt above the gate F0 decides, snapshot builds moved to J2, exports streamed | `[limits] cpu_ms` retained; heavy exports and imports stay on the request path where the user waits for them |
| Background work | J2 runner with budget checks and cursors; every cron step resumable | the same runner, plus multi-database copies (audit read copy, telemetry) as optional bindings |
| Databases | one `DB` plus `IMPORT_DB` | `DB`, `IMPORT_DB`, optional `ROLLUP_DB`, `AUDIT_DB` copy, `TELEMETRY_DB` (§13.7) |
| Frontend | F12 lower page sizes matter for rows; F13 optional | F12, F13 for the customer's first paint and the storefront's own service-worker scope |
| Guards | G1 zones with hard stops at `exhausted`; G6, G8 refuse configs that cannot run | G1 zones as alerts; G8 refuses a Free config on a Paid account only when it would drop `[limits]` |
| Structure | G9, G10, W12, W14, W15, W16 identical on both — correctness does not have a tier | the same, plus G12 |

### 19.3 Where the new items slot into the phases

| Phase | Part II additions |
| --- | --- |
| 0. Measure | G9 (security first; no behaviour change for authenticated callers), R16, R18 (`/health` outside the invariants middleware), G13 (one deploy stamp), W11's meter readout |
| 1. Biggest scans | R13, R15, R14 (bounded aggregates), W14, J4 already there, G11 (chained Worker harness and the regression pins) |
| 2. Catalog and lists | F9 as a regression pin, F10 with J7 after a release-line measurement, W11, the ETag row |
| 3. Rollups | R17, W15, W16 (beside R7/R10/R12), R9's time-of-day parity, R19 (shift figures at close), R20 (reports search), W17 (merge re-parenting) |
| 4. Write consolidation | W12 (with the org-bootstrap backfill), W13, F14; F11 begins with sales |
| 5. Jobs | J8, J9, the audit read copy and `ROLLUP_DB` bindings on Paid |
| 6. Tier plumbing | F12 page sizes under `PLAN_LIMITS_BY_TIER`; F13 |
| Checkpoint-only | G10 (line endings and zombie retirement collide with peers' dirty files) ; G12 after W12 lands |

### 19.4 What the atlas corrected in Part I

- Production is **560bfbcb** on `origin/codex/release-stability-20260907` (migration 0134), not the
  reconcile line; `main`'s committed tree stops at 0105; lanes fork from the release line (§18.1).
- The family CTE lives in `lib/familyPagination.ts::buildCtes` and is materialised **two to three**
  times per page, for four route files, not twice in `routes/products.ts`.
- `compat.ts` `allSales` is date-scoped; the waste is a duplicate statement, not an unbounded scan.
- Settings are not read per request; they are read ad hoc per consumer and never versioned.
- The sales-list "amendment count" is a **records count with six correlated subqueries per row**
  (`lib/saleRecords.ts::buildSaleRecordsCountSql`): amendments, audit rows minus three suppressions
  including a `julianday()` self-join, bulk members, returns, return audit rows and return bulk
  receipts. `main` has none of it. R3 maintains `sales.records_count` from the writers that already
  bump `sale_write_revisions` and backfills from the verbatim expression.
- The idle-tab figure of ≈257 requests/hour was measured on `main`. On the production line an idle
  tab costs **≈124 requests/hour, 96 % of it the 30 s health probe**, because the offline-maintenance
  loop runs only with a non-empty outbox and the import tracker polls only while jobs are active.
  Five production tabs over a day are ≈6 k requests; the same five tabs on `main` would be ≈13–20 k.
  F9 is therefore a regression pin, and F1 plus R18 are the frontend-facing items that matter on Free.
- `GET /health` is mounted after `app.use('*', ensureCoreDataInvariantsOnce)`, so the most frequent
  request in the system pays the cold-start invariants; R18 moves the middleware to `/api/*`.
- The import reaper on the release line already has a read-only pre-check, so J4 shrinks from
  "remove two UPDATEs" to "skip the SELECT when nothing has been active".
- The revision-trigger cost is measured rather than estimated: 26 base rows per five-line sale fire
  26 revision upserts and 26 restore-mode probes; the gate is a `json_extract` on `system_flags`,
  and returns fire two revision families. W13's design follows from that (§13.5).
- `routes/customTables.ts` and `lib/businessMetrics.ts` are already gone on the release line; G10's
  job for them is to keep a merge from `main` from bringing them back.
- Pagination is five schemes on the release line, not three, and two comments in `routes/sales.ts`
  still say the list caps at 500 while the code caps at 200 (R9 fixes both).
- `cloudflare/wrangler.toml` is byte-identical between `main` and the release line: every
  production-only surface is code and migrations, so the tier plumbing in §9 starts from one config.
- Three of the cross-cutting atlas's "missing feature" findings are lineage, not defects: sale
  amendments, shift sessions and the Telegram `/report` command all exist on the release line and are
  absent only from `main`. The revenue kernel is the same story with a sharper edge — `main` still
  carries the 1 September rule, the release line the 6 September rule with a pinning test — so every
  revenue item in this plan is built on the release line's expressions (§17.5).
- The test estate on the release line is 309 frontend and 280 Worker files, not 161 and 162; the
  route-permission, merge-undo and retention tests the atlas reported missing already exist there.
- A successful bootstrap seeds settings, so boot issues no `GET /api/settings`.
- There is no `stock_movements` table; the movement ledger is `inventory_movements`.
- 0135 is taken on two unmerged lanes; the first free migration number is 0136 after a fresh sweep.

---

## Appendix A. SQL and schema sketches (illustrative, not final migrations)

```sql
-- R3: maintained sales-list records count + audit_logs indexes (next free migration number, see §11)
ALTER TABLE sales ADD COLUMN records_count INTEGER NOT NULL DEFAULT 0;
-- Backfill from ALL SIX sources the release line's list counts today
-- (lib/saleRecords.ts::buildSaleRecordsCountSql, described in §15.7). The lane copies that function's
-- expression into the migration verbatim -- never re-types it -- so the counter equals the live query
-- by construction:
--   sale_amendments rows for the sale
-- + audit_logs rows for the sale (status transitions, payment corrections, settlements, undo/redo,
--   customer swaps) minus the three suppressions: amendment twins, add-items applier rows, and explicit
--   correction/settlement rows by the same user within +-2 s (the julianday() self-join)
-- + sale_bulk_members rows
-- + customer returns for the sale that have no create audit row
-- + return audit rows for those returns
-- + return bulk receipts (the json_each walk)
UPDATE sales SET records_count = ( /* verbatim buildSaleRecordsCountSql body, @sale_id := sales.id */ 0 );
-- Maintenance: the writers that already bump sale_write_revisions (the 0120 family: status, bulk
-- status, bulk update, amendments, add-items, settlement, the undo appliers) and the return writers
-- (the 0125 family) increment sales.records_count inside the same db.batch(); no new trigger.
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity  ON audit_logs (entity, entity_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs (created_at, id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action  ON audit_logs (action, created_at);
-- pre-assertion : SELECT COUNT(*) FROM sales WHERE records_count <> (<verbatim expression>)  -> 0
-- post-assertion: EXPLAIN QUERY PLAN on GET /api/sales shows no SCAN of audit_logs and no correlated
--                 subquery; the list reads sales.records_count directly
-- recovery      : the column is additive; restoring the old expression in the list is a code revert

-- R5: partial indexes
CREATE INDEX IF NOT EXISTS idx_batches_expiry_live
  ON product_batches (expiry_date) WHERE quantity > 0 AND expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_returns_customer ON returns (customer_id);

-- R6
ALTER TABLE products ADD COLUMN is_batch_tracked INTEGER NOT NULL DEFAULT 0;
UPDATE products SET is_batch_tracked = 1
  WHERE id IN (SELECT DISTINCT product_id FROM product_batches);
CREATE INDEX IF NOT EXISTS idx_products_batch_tracked ON products (is_batch_tracked) WHERE is_batch_tracked = 1;

-- R8: daily sales rollup (business day = date(created_at, '+7 hours'))
CREATE TABLE IF NOT EXISTS sales_daily_rollup (
  business_date TEXT NOT NULL,
  branch_id     TEXT NOT NULL,
  cashier_id    TEXT NOT NULL,
  sales_count   INTEGER NOT NULL DEFAULT 0,
  gross_usd     REAL NOT NULL DEFAULT 0,
  net_usd       REAL NOT NULL DEFAULT 0,   -- canonical revenue: excludes tax + delivery, minus refunds
  tax_usd       REAL NOT NULL DEFAULT 0,
  delivery_usd  REAL NOT NULL DEFAULT 0,
  refund_usd    REAL NOT NULL DEFAULT 0,
  cost_usd      REAL NOT NULL DEFAULT 0,
  credit_count  INTEGER NOT NULL DEFAULT 0,
  credit_usd    REAL NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (business_date, branch_id, cashier_id)
);
-- inside the sale batch:
INSERT INTO sales_daily_rollup (business_date, branch_id, cashier_id, sales_count, gross_usd, net_usd, ...)
VALUES (?, ?, ?, 1, ?, ?, ...)
ON CONFLICT (business_date, branch_id, cashier_id) DO UPDATE SET
  sales_count = sales_count + 1, gross_usd = gross_usd + excluded.gross_usd, net_usd = net_usd + excluded.net_usd, ...;

-- R10 / R12 follow the same UPSERT-delta shape keyed by customer_id / product_id.

-- R12: running balance on the ledger (per product x branch x batch)
ALTER TABLE inventory_movements ADD COLUMN balance_after INTEGER;

-- W2: receipt uniqueness (pre-assertion first)
-- SELECT receipt_no, COUNT(*) FROM sales GROUP BY receipt_no HAVING COUNT(*) > 1;  -> must be empty
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_receipt_no ON sales (receipt_no);

-- J1: keyset backup page (per table)
SELECT * FROM "<table>" WHERE rowid > ? ORDER BY rowid LIMIT ?;   -- cursor = last rowid
```

## Appendix B. Budget meter design (sketch)

```ts
// lib/meter.ts
export function meteredD1(db: D1Database, routeClass: string): D1Database {
  // wraps prepare().all/first/run and batch(); after each result adds
  // meta.rows_read / rows_written / duration to an isolate-level accumulator
  // keyed by routeClass; never awaits anything extra on the request path.
}
export function scheduleMeterFlush(ctx: ExecutionContext, env: Env) {
  // waitUntil: if (accumulator.rows >= 1000 || now - lastFlush >= PLAN_LIMITS.meterFlushSec)
  //   env.BUDGET_METER.get(id).add(accumulator)  -- one DO call, then reset
}

// BudgetMeter DO (SQLite): table counters(utc_day, pool, route_class, value)
// add(): UPSERT deltas; recompute zone from PLAN_LIMITS ceilings;
//        if zone changed: broadcast {topic:'budget', zone, pools} via BROADCAST_HUB
// snapshot(): returns {utc_day, business_day, pools: {rows_read, rows_written, requests,
//             kv_writes, queue_ops, do_requests}, zone, reset_in_seconds}
// alarm(): at 00:00 UTC rolls the day and archives yesterday to D1 telemetry / Analytics Engine
```

Zone policy per route class lives in one table (`lib/zonePolicy.ts`) so a test can assert that POS
writes are allowed in every zone and that nothing but POS, login and outbox survives `critical`.

## Appendix C. Evidence provenance

- Cloudflare GraphQL Analytics (`workersInvocationsAdaptive`, `d1AnalyticsAdaptiveGroups`,
  `d1QueriesAdaptiveGroups` ordered by `sum_rowsRead_DESC` and `count_DESC`,
  `kvOperationsAdaptiveGroups`, `durableObjectsInvocationsAdaptiveGroups`,
  `r2OperationsAdaptiveGroups`, `queueMessageOperationsAdaptiveGroups`), queried 2026-09-08 for
  Sep 1–8 with a 3-day window for the query-level breakdown, using the token in the gitignored
  `cloudflare/.wrangler-auth.local`; the script prints no secrets and will be committed as
  `cloudflare/scripts/plan-status.cjs` in Phase 0.
- Cloudflare documentation (Workers limits and pricing, D1 pricing and the 2026-09-01 enforcement
  changelog, Durable Objects, Queues, KV, Workflows, R2 limits), retrieved 2026-09-08.
- Six read-only exploration reports over `cloudflare/src` and `frontend/src` (request lifecycle and
  guards; write paths and Durable Objects; schema, retention and backups; ops pipeline and recorded
  decisions; frontend transport; read paths and aggregations), 2026-09-08, read from the `main`
  working tree at HEAD fd5716b3 (dirty with in-flight peer edits) — the inputs to Part I.
- Seven atlas reports (the inputs to Part II), 2026-09-08: A1 Worker HTTP surface (346 endpoints,
  per-file and per-endpoint tables, ranked SQL); A2 Worker platform (98 lib modules, bindings, jobs,
  guards); A3 production delta (`main` against `origin/codex/release-stability-20260907`, read with
  `git show`, never a checkout); B schema (134 migrations, 115 tables, 159 indexes, 106 triggers,
  ledger writers); C frontend (445 files, 15 timers, 194 endpoint literals); D cross-cutting domains,
  tooling and tests; E recorded decisions and lineage. All read-only. The A1/A2/B/C/D inventories were
  taken on `main`'s working tree and re-based onto the production line where §15.7, §16.8 and §17 say so.
- **Lineage (2026-09-08)**: production is commit 560bfbcb, the tip of
  `origin/codex/release-stability-20260907` (migration 0134), deployed 2026-09-07 15:36 UTC as Worker
  version `03aa25a5-…`; provenance at progress.md line 3 and in
  `docs/fleet/2026-09-07-owner-task-register.md`. `origin/codex/business-os-reconcile` (9ab9fd7a,
  0127) is its ancestor; `main` (fd5716b3) is 42 ahead / ≈500 behind and its committed migrations
  stop at 0105. Every constant, config key and query shape this plan cites was re-found on the codex
  line by symbol (`familyPagination` COUNT, backup `TABLE_PAGE_SIZE`, `compat` `allSales`,
  `ROWS_PER_IMPORT_CHUNK`, `STOCK_ACTION_MAX_UNITS`, `stockLedgerQuery` SUM,
  `buildInventoryFinancialJoinSql`, `CUSTOMER_REFUND_JOIN`, the products `OVER` window,
  `buildShortWordFallbackClause`); `wrangler.toml` is identical between `main` and the reconcile line
  apart from comments and **byte-identical** between `main` and the release line (§15.7), so every
  production-only surface is code and migrations, never a binding or limit; `planTier.ts` and
  `wrangler.free.toml` are absent on both. Line numbers differ between the lines (the backup page
  constant sits at line 441 on `main` and 459 on the codex line), which is why this plan cites
  symbols; any `file:line` that survives must be re-read on the line a lane actually branches from.
- The three owner-supplied reference documents (`cloudflare, database, arrchitecture etc....txt`,
  `When scaling distributed architectu.txt`, `free vs paid cloudflare worker plan.txt`).
