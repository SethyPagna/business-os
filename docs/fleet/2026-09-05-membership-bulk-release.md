# Membership, bulk history and safety release — September 5

## Scope

Owner authorized implementation and deployment. Work continues on deployed
lineage in isolated workers; unrelated dirty main/integration files are preserved.

- Setting `loyalty_points_enabled` is the default earning choice for every new
  POS order. Explicit per-order booleans override it in either direction and are
  persisted server-side. Existing redemption eligibility remains unchanged.
- POS resolves membership through authenticated, POS-scoped customer lookup;
  failures cannot reuse an old balance. New IDs use eight cryptographically
  random uppercase alphanumeric characters; existing IDs are preserved.
- Bulk status uses one bounded request/transaction, one durable history item,
  exact no-op counts and whole-group undo/redo. It is online-only, up to 25 sales,
  with revision/stock guards, request IDs and explicit original-request retry.
  Complex selections have additional line/allocation/history limits and fail
  before partial work. This is not an unlimited bulk mutation endpoint.
- Fixed single-status damaged-stock race; damaged updates/movements now share
  the guarded transaction. Preserved ordinary stock and skip-stock behavior.
- Atomic rate/reset quotas, retained quota history, bounded selected request
  bodies, canonical public cache keys and indexed membership lookup reduce
  known abuse/lookup costs. This is not blanket anti-crawling certification.
- Backups include finance and durable replay records in dependency order;
  append-only amendments permit authorized maintenance restore only.

## Verification

Independent reviewers exercised request authorization, actual Hono handlers,
SQLite concurrency, stale/late failure rollback, durable replay, stock parity,
backup roundtrip and legacy restore. Findings were returned to file owners and
fixed, not silently waived. Full frontend test chain and all 200 individual test
files passed; frontend build, language parity, Worker typecheck and 208 backend
suites passed (one bounded-query source-contract fix rechecked separately).
The added legacy-restore suite and independent reproduction pass: audit rows
remain 5→5 when an older backup is refused, before any database write. Complete
61-table foreign-key-enabled streaming restore and restored undo/redo pass.
Final full backend sweep: **209/209 passed**, with no remaining failed suite.

Existing build warnings about circular/manual chunks remain. The full authenticated
production role/page matrix and actual Telegram delivery receipt are not certified.
Previously deployed shift/report/inline-mobile improvements are retained. The
release-build sign-in screen has no document/body overflow at 320px in EN/KM.
Its local API failures are expected: the preview has no backend attached; this
is only a render check, not authenticated flow certification.

## Historical data

The one-time settlement is already applied and separately verified. See
`2026-09-05-settlement-result.md` for exact totals, source scope, live concurrency,
audit evidence and guarded recovery. No future-payment completion rule was added.

## Deployment

Released clean source `0ffc4bfcc4fdd50a77122aa49ffc2dd85d9a3cae` from
`business-os-v1-release-20260905`, not dirty main. Worker
`be276770-359d-4002-9d26-560fa5656d33` is at **100% traffic**, control-plane
deployment timestamp `2026-09-05T05:32:08.456Z`. Previous version was
`cadfb107-3e58-4784-9fa2-2c115540e2cf`.

- Worker build revision `0ffc4bfcc4fd`, hash `517a58773b87d97e`, built
  `2026-09-05T05:30:03.016Z`.
- Uploaded frontend metadata: revision `0ffc4bfcc4fd`, hash `f2406deafad8f544`,
  built `2026-09-05T05:27:57.354Z`.
- Fresh clean release build/typecheck and provenance-stamped dry run passed.
  Deployed through the repository wrapper with `--keep-vars`; no secret sync,
  WAF configuration, domain change, or credential rotation was performed.
- Applied only pending schema migrations 0120, 0121, 0122. No pending primary
  migrations remain. SQL files were confirmed LF-only in the release checkout.
- Pre-migration Time Travel bookmark:
  `000012d5-00000000-000050dd-67c16a8dc096e3b8fc234d09ee093f04`.
- Pre/post controls identical: sales 15,063; total USD 1,893,911.801; recorded
  paid USD 1,992,412.8168; product stock 23,073; branch stock 23,036; batch stock
  23,064; amendments 7; movements 23,160 with max ID 46,282. These are existing
  database controls, not a claim that all legacy financial/stock totals agree.

Live verification limitation: both current hosts returned Cloudflare's HTML
browser-verification challenge (403) to version/build/health probes. A normal
browser also reached that challenge. Therefore live-response frontend/Worker
parity and authenticated endpoint results were **not** certified. The deployment
and 100% traffic are independently confirmed by Wrangler's deployment listing.
No challenge bypass or security-control change was attempted.

Recovery: prefer a forward fix. Retain additive replay tables, snapshots and
revision counters if rolling back code; never drop replay data or restore a
database bookmark over later shop activity without a fresh impact review.
