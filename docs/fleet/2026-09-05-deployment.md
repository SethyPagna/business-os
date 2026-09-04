# September 5 deployment evidence

## Authorization and scope

User explicitly requested “Continue, deploy, according to goal, progress.md” on
2026-09-05. Released reviewed shift/report/sale-detail work from the deployed
lineage, not divergent dirty main. No historical sale, payment, debt or stock
repair was performed. The user's cash example remains a test fixture, not a
live cash entry. Mobile inline navigation remains a separate in-progress slice.

## Stage 1 provenance

- Source commit: `c89755aaaaffde7bf9893297c39a6923fcd65dd2`.
- Clean release worktree: `business-os-v1-release-20260905`, branch
  `codex/release-2026-09-05`; preserved the shared dirty checkout.
- Worker version: `8e5aa14c-23c5-422f-ae5d-fb2b458fe374`, 100% traffic,
  deployment created `2026-09-04T23:12:55.579Z` (September 5 Bangkok time).
- Worker runtime revision `c89755aaaaff`, source hash `ad99cea3d8c7a2c6`,
  built at `2026-09-04T23:12:32.771Z`.
- Frontend revision `c89755aaaaff`, asset source hash `43d62d9fab8954a9`,
  built at `2026-09-04T23:09:09.915Z`. Frontend and Worker hashes cover different
  inputs; matching revisions, not matching hashes, establish release parity.
- Deployed through the repository provenance-stamping deploy wrapper with
  `--keep-vars`; no secret sync, configuration rewrite or domain change.
- Prior version: `798d9e19-76d0-4909-8db3-6a7a4ad43ad7`, runtime revision
  `c7ef726438f0-dirty`, source hash `b2df6743f3562b75`.

## Schema and recovery

Applied only the two pending primary D1 migrations, in order:
`0118_shift_policy_and_amendments.sql`, `0119_shift_restore_guard.sql`.
Import D1 had no pending migrations. No archived repair SQL or migration 0117
was replayed.

Immediately preceding D1 Time Travel bookmark:
`000012b8-00000000-000050dc-d0449c6a8d87c4af50892cb5b4554e3b`.
This is recovery evidence, not authorization to restore: restoring the entire
database would discard later legitimate business writes and requires a fresh
impact review and explicit authorization.

Pre/post comparison: both existing shift rows retained every original field
exactly, including open state; new defaults were per-account and revision zero.
Verified account/shop unique indexes, amendment index, immutable update/delete
triggers, and settings `shift_scope_mode=per_account`, `shift_admin_exempt=true`.
Independent architect verified a populated local upgrade, fresh migration chain,
LF-only trigger SQL, backup coverage, and uniqueness constraints before apply.

Rollback caution: the schema is additive but old code is not a safe operating
target after shop-wide shifts/amendments exist. Prefer a forward fix. Do not
drop amendment records, restore the old uniqueness index, or replay old
settlement SQL. No rollback or database restore was executed.

## Verification and limits

- Prior integrated certification: 198 frontend test files, 200 backend suites,
  both typechecks, i18n, and production build passed.
- Fresh clean-release frontend build and Worker dry-run passed; known existing
  circular/large-chunk warnings remain.
- Live runtime endpoint and frontend build metadata both confirm the revision
  above; `/health` returns `ok`.
- Unauthenticated `/api/shifts/current` and the sales/returns/expenses business
  summary report endpoints return 401. This confirms auth protection, not
  authenticated business-flow correctness.
- Telegram bot secret exists and destination is configured. Missing explicit
  automation setting uses the existing enabled-by-default policy; status
  notifications are enabled. No live close or test message was sent.
- Credential-hygiene finding: an existing malformed secret **name** contains a
  token-like value. Do not copy it into documentation. Owner should rotate the
  affected credential and authorize cleanup; no secret was altered here.
- Full authenticated live shift/report/role matrix and real Telegram delivery
  receipt are not certified by these public checks. Historical payment/status
  semantics still require an owner ruling before any bulk data mutation.
