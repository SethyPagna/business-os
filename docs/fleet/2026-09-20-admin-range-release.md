# Admin range and report checkpoint — September 20

## Deployment provenance

- Source: `e85a45e8616f`; GitHub main and `codex/supplier-settlement-20260918` pushed.
- Worker: `3b7e2af5-1b4e-4cd7-a122-ad63e9b90b18`, Paid configuration.
- Worker stamp: hash `e499218f8a524382`, built `2026-09-20T09:40:14.881Z`.
- Frontend: revision `e85a45e8616f`, hash `5cdbc931667943c1`, built `2026-09-20T09:33:43.195Z`.
- Stamped deploy script exited0. No migration, secret sync, or historical data rewrite.
- Prior rollback version: `3f5ad76d-5be1-468b-876d-6151239c61d9`.

## Included behavior

Dashboard and Returns preserve and enforce continuous timestamp ranges. Dashboard
stale responses are fenced. Reports no longer broaden partial clock bounds or
break All time after switching through date-only Shift Report. Shift reconciliation
is admin-only across current/history/close/replay; authorized operational counts
and nonblocking mismatched close remain. Shift Report loads a selected shift under
validated business-date filters instead of relying on the current admin shift.
Single-transfer Telegram metadata reuses the immutable committed planner allocation,
removing one redundant FIFO read without changing stock/cost/idempotency behavior.

Standalone export validation/transport and transfer-planning helpers are present
but not wired as completed features. Their existence is not a readiness claim.

## Verification actually performed

- First frontend chain:502pass/1red of503, obsolete inline-query assertion.
  Test-only73786165 executes actual timeout expressions with canonical timed
  queries; focused before-fail/after-pass. Clean rerun:503/503, zero skipped,
 410908ms, exit0 (session27331). Typecheck/runtime generation/syntax gates included.
- EN/KM5892 keys,646 source files; build269 chunks,zero cycles; actual public preload
  excludes admin/file/import code.992 unreferenced-key candidates are warnings,
  not deletion proof. Large language chunks remain optimization work.
- Worker typecheck and fresh275 Dashboard SQL/handler checks,11 actual transfer
  route checks and native Returns SQL/filter suite pass. Earlier same-runtime
  complete shift script family and focused report/shift/state suites pass.
- Browser21/21: desktop Chromium, Android Chromium, iOS WebKit. Runtime6bdacb07,
  hashf207b11068b4471e. Only two test files changed6bdacb07..e85a45e8; no runtime
  change. Tests cover overnight Dashboard/Returns UI requests, report switches,
  selected shift and synthetic admin/staff rendering, plus native-SW logout503/
  reload/retained-work/no-auto-write checks. Synthetic GETs are not backend proof;
  engines are not physical-device certification.
- Wrangler4.116.0 Paid and Free stamped dry runs exit0 at final source. This proves
  bundle/config validity, not production quotas/CPU/storage or safe downgrade.
- Live signed-in Dashboard populated, Reports and selected dated Shift Report
  rendered, Returns loaded, public About rendered; zero captured console errors.
  Admin DOM entry script `index-Kv0rdeEl.js` exactly matches built index.
  Direct command-line manifest read returned403; browser manifest navigation
  returned SPA, so neither is claimed as independent runtime JSON verification.
  Worker provenance comes from successful stamped Wrangler deployment.
- No real sale, payment, return, stock transfer or shift-close test write was made.

## Remaining requirements

Full goal is NOT complete. Complete one-year exports and list completeness beyond
500/1000 remain open; tracking migration authority pending. Resumable transfer
store9fa92424 is local-only, native atomicity proven but full-handler budgets,
backup/restore/reset/routes/UI and approval are unresolved. D1Compat retries entire
batches, so current standalone planner tests do not certify Free/Paid capacity.
Stock-in stale-detail fencing is next isolated work; remaining date hosts and
historical timestamp semantics need review. Physical printer/PWA/camera checks,
ambiguous historical data, broader permissions/security/public work and safe
one-folder consolidation remain in existing ledgers. Four-decimal financial rules
and approved cost semantics were not rewritten.
