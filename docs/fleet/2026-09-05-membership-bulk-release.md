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
Final 209-suite run and deployment are pending at this entry.

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

Independent bounded safety review is clear. Prepared migrations are schema-only
0120, 0121 and 0122; none has been applied remotely for this release yet.
Do not infer deployment from the branch tip or these preparation notes.
