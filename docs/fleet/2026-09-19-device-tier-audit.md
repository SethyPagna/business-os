# Multi-account, branch and plan-tier audit — 19 September 2026

## Status and scope

Read-only source audit of `53253782` (runtime source `45a0831b`) in
`bos-supplier-settlement-20260918`. No production data changes, downgrade,
deployment or runtime fixes. Last recorded live revision remains `de8c72fa9514`;
candidate deployment is not confirmed. This report extends the maintainability
audit, not an assertion that all business workflows are certified.

**A no-impact switch to Free cannot currently be certified.** Both configurations
bundle successfully, but capacity and feature parity are separate requirements.

## Findings

### D1 — High: offline sales can cross account ownership

`frontend/src/api/saleWriteTransport.ts:132` queues sales without original actor
ownership; :286 reads all sales:create rows and :319 replays using the current
session. `AppContext.tsx:1851` preserves offline work at logout. Independently,
`frontend/src/public-runtime/service-worker.ts:544` drains the same queue, using
current cookies (:398). Backend `routes/sync.ts:163` forwards the current cookie;
`routes/sales.ts:1138` attributes cashier to the current actor.

An A-created retained sale can therefore be submitted as B after account switch,
if B has create permission. The ordinary retry path is reachable; disabling
authenticated mirror persistence does not disable this queue. Source-confirmed,
not yet reproduced with two real browser accounts. Do not clear queued business
work as a workaround. Bind immutable actor ownership at admission and enforce it
in foreground, service worker and server; quarantine ownerless legacy entries.
Test A offline → logout → B login → reconnect, including competing replay actors.

### D2 — High on shared devices: unresolved logout looks locally successful

`AppContext.tsx:1842–1844` swallows logout request failure and clears local user
state; `cloudflare/src/routes/auth.ts:340–344` revokes session/clears cookie only
when the server receives logout. A failed request can leave an active HttpOnly
cookie and permit old-account bootstrap. Source-confirmed, fault-browser test
pending. Add a durable unresolved-signout fence and accurate recovery state;
do not silently re-admit writes or destroy pending sales.

### D3 — High in missing-queue mode: independent inline work can be dropped

`cloudflare/src/lib/queueDispatch.ts` shares a module-global pending list and
draining flag. A second independent caller returns inline before execution;
failure of the first drain clears the entire pending list in finally.

Reproduced against the actual transpiled module by
`outputs/device-tier-audit-20260919/queue-concurrent-probe.cjs`: A held, B accepted,
A failed, C dispatched; observed execution A,C, never B. This proves lost
in-memory dispatch, not permanent loss of persisted D1 job state. Both normal
configs bind Queues, so this is a degraded-mode finding. Use request/job-scoped
continuations and caller-specific completion; never clear another job's work.
Inline loops also do not reset Worker CPU budgets.

### D4 — High: transfer chunks budget products, not actual D1 work

`frontend/src/components/branches/TransferModal.tsx:49,1106` and
`cloudflare/src/routes/branches.ts:540,583` use 200-product chunks.
`cloudflare/src/lib/transferOperation.ts:216` rejects only above 5,000 statements.
Planner-derived statement count is 17 + 2×products + allocated lots + new clones,
before surrounding auth/planning/notification queries: 200 products without lots
already yield 417; with three allocated lots each, 1,017 before clones.

D1 allows 50 queries per invocation on Free and 1,000 on Paid. This is a derived
capacity risk, not a remote load-test result. Budget actual lot/query cost with
headroom and durable continuation, preserving each atomic stock operation.
Source: https://developers.cloudflare.com/d1/platform/limits/

### D5 — Medium: transfer-all is a resumable sequence, not whole-branch atomic

Earlier confirmed chunks remain committed if a later chunk fails or conflicts
with a sale. The original snapshot does not include later incoming stock.
The complete catalog is loaded before filtering (`TransferModal.tsx:659–671`,
`routes/branches.ts:870–892`), creating size/latency pressure. Expose snapshot and
partial-progress semantics, paginate stock-bearing products and test concurrent
sale/restock/retry. One request supports one chosen lot per product, not arbitrary
multiple same-product lot selections.

### D6 — Product gap: branch deactivation is deliberately refused

Canonical active Shop/Warehouse is protected by route and atomic transfer guards.
Normal branch updates refuse deactivation; this is not a supported closure flow.
If required, design explicit drain/reconcile/close semantics with pending sales,
returns, lots, transfers and permissions checked. Do not remove guards as cleanup.

### D7 — High downgrade risk: Free changes behavior and capacity

`cloudflare/src/lib/planTier.ts:242,263` enables scheduled backups on Paid and
disables them on Free; `lib/backup.ts:1067` skips accordingly. Other Free limits
reduce import/action chunks and integrity coverage. Catalog integrity is capped
at 2,000 versus 50,000; image-reset behavior also differs. Unknown PLAN_TIER
defaults to Paid, so explicit configuration matters. Bundle success proves none
of these features fit current traffic or preserve identical behavior.

Current published limits: Workers Free has 100,000 requests/day and 10 ms CPU;
D1 Free has 500 MB per database, 5 million rows read/day and 100,000 written/day;
Queues Free has 10,000 operations/day and 24-hour retention; KV Free has 1,000
writes/day. Separate R2 usage/billing remains relevant. Sources:
https://developers.cloudflare.com/workers/platform/limits/
https://developers.cloudflare.com/d1/platform/pricing/
https://developers.cloudflare.com/queues/platform/pricing/
https://developers.cloudflare.com/kv/platform/limits/

Both configured Durable Object classes use SQLite, compatible with Free, but
other account-level legacy namespaces have not been audited. Never delete them
blindly to downgrade. https://developers.cloudflare.com/durable-objects/platform/pricing/

### D8 — High Free feasibility risk: authentication CPU is unmeasured at edge

`routes/auth.ts:224` uses bcryptjs.compareSync; hash work uses cost 10. A synthetic
local Node benchmark took approximately 107–112 ms wall / 109–140 ms CPU per
comparison. This is NOT a Cloudflare edge measurement, but requires explicit
Free-tier validation before claiming login works within 10 ms. Do not weaken
password hashing to fit a budget; evaluate a secure authentication architecture.

## What passed and what it proves

- Plan-tier command: 43 checks (12 plan, 9 drift, 11 queue, 11 surfaces), exit 0.
- Both Wrangler deploy --dry-run configurations: exit 0. Logs under
  `outputs/device-tier-audit-20260919/`; no deployment performed.
- Branch reviewer: 59 checks across transfer plan, replay, canonical branches,
  lot guards and frontend transfer actions, all passing. Includes 200-member undo
  and 201-product lost-response retry. Local fixtures, not live concurrent load.
- Account reviewer: actorSessionQuarantine, authCookieAdmission,
  legacyAccountStorageCleanup, admin-sessions (17 checks) and session-slide
  (14 checks), all passing. They do not cover the ownerless sale queue gap.
- The new concurrency probe reproduces D3 even while old queue tests pass.

Existing protections include actor/session read-cache fencing, stale-response
rejection, fresh server permission/session checks, atomic stock assertions,
selected-lot refusal rather than silent fallback, and idempotent exact replay.
Keep these during simplification.

## Implementation and acceptance order

1. Actor-owned offline queue and unresolved logout: test two accounts, tabs,
   devices, permission changes, network loss and foreground/SW replay contention.
2. Queue fallback concurrency and transfer query budgeting: actual-handler tests,
   both tiers, multi-lot products, failure after committed chunk and exact retries.
3. Measure current production read-only metrics: CPU p95/p99 and max, peak/daily
   requests, D1 size/rows/queries, queue backlog/retry age, KV and R2 usage.
   Historical database sizes and product counts are not current telemetry.
4. Demonstrate Free staging with realistic safe fixtures, including login, POS,
   all-stock transfers, imports, reports, backups and recovery. Document intended
   feature differences and decide backup replacement before any downgrade.
5. Only then perform an authorized tier change with rollback and monitoring.

No blanket assurance of zero errors or no-impact downgrade is supported yet.
