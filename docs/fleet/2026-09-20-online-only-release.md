# Online-only and account safety checkpoint — September 20

## Deployed provenance

- Source revision: `6a31689fb67c`.
- Worker version: `3f5ad76d-5be1-468b-876d-6151239c61d9`.
- Deployment metadata hash: `96a4726c682f6c0d`; timestamp `2026-09-20T02:32:06.014Z`.
- Paid configuration retained. No downgrade performed.
- GitHub main and codex/supplier-settlement-20260918 pushed to this revision.
- Live signed-in dashboard and POS rendered, including payment selector. Public About page rendered. No test sale, stock operation or logout was submitted in production.
- Live verification tab accepted the available app update and rendered again. Direct build-manifest navigation returned the app shell, not independent JSON version proof; deployment identity is Wrangler provenance.

## Migration

Owner-approved0184_product_cost_entry_previous.sql applied through D1 migration ledger exactly once before Worker deployment.
Preflight: column absent; existing entries1, maxID1. Postflight: column present once, existing ID<=1 count1 and previous_cost_usd NULL, migration ledger entry present.
No historical cost backfill, customer change or stock/data repair was performed.
Rollback retains the additive column/history; roll back Worker code only if needed.

## Included

- Browser business writes online-only: no new offline sale/generic queue admission and no automatic foreground/service-worker mutation replay. Cached reads and retained drafts are not removed.
- Existing sale recovery requires original authenticated actor/organization/authority, explicit reviewed snapshot and exact acknowledgement. Cross-account, ownerless and generic encrypted/file records remain retained rather than reassigned or silently deleted.
- Review actions bind only displayed rows;26/40-record regressions protect unseen/new/changed/in-flight rows.
- Server sale creation validates ownership before duplicate lookup. Older clients receive a preserve/update/review refusal; do not recreate unknown-outcome sales.
- Durable unresolved-signout fence, guarded recovery, late-response protection and fail-closed storage handling. Authorized admin private receipt reads remain separate from queued-write ownership.
- Product Edit cost overrides with old/new history; incoming stock contributes distinct positive costs to the mean. Price-specific lots and import parity preserve historical lot economics. Internal four-decimal policy retained.
- Expenses timed ranges match entry timestamps; full days retain booked dates. List/totals/pagination/export share scope.
- Inline queue fallback roots independently own completion and failure. Normal Cloudflare Queue processing remains enabled; online-only refers to disconnected browser writes, not server jobs.

## Verification

- Final frontend499/499 test files pass, no skips; frontend and Worker typechecks pass; i18n pass;269built chunks, zero cycles; public preload contains no admin/file/import code.
- Worker broad sweep476scripts:460passed,16failed. Fixture/contract repairs retained business assertions; focused reruns pass all16. The native orphan test terminated silently once during the combined rerun, then passed standalone in126seconds:218relations/181tables, including deliberate-orphan controls. This is qualified aggregate evidence, not a single clean full-sweep run.
- New signout native test and admin17checks/session-cookie race tests pass.
- Inline queue20pure checks and7actual local workerd D1/R2 cases pass; old code fails concurrency controls.
- Final9/9 actual-browser cases pass across desktop Chromium, Android Chromium and iOS WebKit, active service workers, real local server503logout fault. Candidate6a31689f built/served hash d406fe62e838f8fe before deployment metadata stamping. Tests use synthetic local backend and emulated mobile, not physical devices.
- Paid and Free dry-run bundles pass. Neither proves production Free CPU, query, storage or daily quotas fit.

## Not complete

Transfer whole-handler query budgets and durable resumable tracking; remaining date hosts; broader permission/UI/audit cleanup; historical ambiguous data provenance; physical continuous-roll printing; private archive/folder consolidation; Free workload/authentication/backup capacity; deferred public security and P9 features remain open in linked ledgers.
Same-origin database replacement with reused actor/org IDs remains an identity-epoch limitation. Runtime tests are bounded, not a promise of zero future errors.
The user reaffirmed admin-first then public completion. Do not mark the overall goal complete.
