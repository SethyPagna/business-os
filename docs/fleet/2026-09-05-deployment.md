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

## Stage 2 — inline mobile navigation, released

- Source `9d13ca94ed4eed033a3de61d81ab57aa8d98d1c6`; same clean release
  worktree and provenance-stamping wrapper, `--keep-vars`.
- Worker version `cadfb107-3e58-4784-9fa2-2c115540e2cf`, 100% traffic,
  deployment created `2026-09-04T23:59:45.120Z`.
- Runtime revision `9d13ca94ed4e`, source hash `142f047c8f086ca8`, built at
  `2026-09-04T23:59:21.985Z`.
- Frontend revision `9d13ca94ed4e`, hash `394247e78e6833ca`, built at
  `2026-09-04T23:58:07.026Z`.
- Live runtime/assets parity and health rechecked; the four protected endpoints
  above still return 401 without authentication. No additional migration,
  secret change, business-data mutation or Telegram send.

The default compact navigation expands groups inline; each leaf opens its body
directly, without the old extra hub menu/history layer. Back opens the section
menu; the header replaces branding with section title and retains utility
controls. Legacy mobile tabs remain an immediate preference. All six hosts
(including Review & Logs) retain permission gates and desktop surfaces.

Worker commits `6546c401` and `41b2a186` integrated as `c57d2599` and `3512a22d`.
Independent review caught dirty-Back history duplication, root hash title/body
disagreement, hidden-header persistence, and a bare-root default-hub mismatch.
All were fixed and rechecked. Main also fixed the behavioral test's CRLF-only
source extraction failure instead of treating the worker's LF pass as sufficient.
Final independent clearance: team-state result
`8e34c592-9339-4971-88d9-ed2f236b3535`.

Final combined 198-file frontend chain passed (including typecheck, public
runtime parity and syntax); i18n resolves 4,864 keys in 507 source files;
clean-release build and exact-revision Worker dry-run passed. Backend code is
unchanged from stage 1's previously certified 200-suite version.

Playwright drove the committed real provider, Sidebar, section hook and
switcher using `frontend/output/playwright/mobile-navigation.html` with a
synthetic user, API and page bodies. Verified group expansion without URL
navigation, direct Reports leaf/title parity, header Back/menu, immediate old
tabs preference, English/Khmer controls, 320px/375px document width equality,
and real asynchronous dirty Back → Stay / Discard → Forward. History length
stayed 9 before and after Discard; Forward returned to Reports with the draft
cleared. Initial preview-only dependency-cache conflicts were resolved before
these checks; no production session or business operation was simulated as live.
Screenshots remain under the fixture's `.playwright-cli` artifact directory.

Limits remain: this is not a full authenticated production screen/role matrix,
nor verification of actual Telegram receipt. The historical reconciliation and
bulk-Done incident are separately documented and were not repaired by deploying.
