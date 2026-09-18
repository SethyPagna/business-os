# Codex resume — September 18, 2026

Base: `integrate/p10` / `80034a0843490f922d383df96128ef3864ad3dc3`.
Live runtime independently read: `354f12d5957e`, hash `a7014753496a30aa`.
The older `bos-precision-final-candidate-20260914` tree is stale. Do not redo its
pending list: barcode folding, amendment allocation and cost-record branches are
ancestors of the current release.

## Owner-authorized supplier settlement

Owner: “Four supplier invoices totaling $489 ... can do paid.”
Scope is a legacy balance correction, not a new cash expense/payment.

| Invoice ID | Supplier | Total | Previously paid | Outstanding |
| --- | --- | ---: | ---: | ---: |
| 315 | ចែ USA | 203 | 174 | 29 |
| 531 | ចែ USA | 177 | 165 | 12 |
| 612 | Dane japan | 1373 | 935 | 438 |
| 813 | naomi | 260 | 250 | 10 |

Fresh remote preflight: 1,596 supplier invoices; total $1,314,703.4626;
paid $1,314,214.4626; outstanding $489; zero audit rows for migration 0183.
Migration tail 0182. Pre-write Time Travel bookmark:
`0000172a-00000000-000050ea-ad7f6adfb92e888db097da3f075faeb4`.

Prepared migration 0183 checks exact IDs, supplier identity, source file/row,
invoice date, original total and previous paid/outstanding/status. Four audit
before/after records provide scoped recovery; no stock/cash records are created.
Local full-chain fixture passes: empty install, five stale-target refusals,
unrelated table counts and invoice preservation, exact $489 reduction, four
audits, idempotency and recovery. Migration registration guard passes.
Independent reviewer approved and reran the test at exit 0. Production migration
0183 **APPLIED** from checkpoint `ae75fbad`; 10 commands / 25.01 ms.
Fresh postflight: all four IDs Paid with zero outstanding; 1,596 invoices and
total $1,314,703.4626 unchanged; paid now $1,314,703.4626; outstanding $0.
Exactly four settlement audit rows; migration tail 0183; both helper tables absent.
No Worker deployment needed or performed: live code remains `354f12d5957e`.

Archival import caveat: `import-aug30-legacy-reports.mjs` upserts the original
source balances. Do not rerun that historical import without preserving this
owner-approved correction.

## Remaining runtime triage

Independent review and focused local tests found the original sales-list lineage
failure is handled (list 200, affected write 409). The generic “three Sentry
issues open” note conflicts with that deployed fix; fresh events are needed.
CPU-limit event has no recorded route/query attribution: no speculative fix.
Payment-method rename search normalization was tested in SQLite and native
Miniflare/workerd D1 with exact source SQL (6,634 characters, 18 bindings,
77 normalization replacements). Both fixtures passed identically, including
accent handling and monetary strings. A 110-level positive control correctly
failed at depth 100. This hypothesis is refuted; no speculative settings change.
Reproduction: `C:/Users/mrkl6/AppData/Local/Temp/bos-payment-depth-triage-20260918.cjs`.
Fresh event route/query/release is still needed for SQL-depth and CPU errors.

## Budget checkpoint — September 18, 09:25 local

### Later owner-authorized checkpoint release attempt — HELD, not deployed

Owner asked to deploy the checkpoint, conditional on working without blank pages.
Fresh exact-candidate gates at **e516a02cadcc**: frontend **477/477 pass, no skips**;
typecheck/preflight pass; i18n pass; production build pass (267 chunks, zero cycles,
37-chunk public preload closure). Worker typecheck pass. Full Worker sweep ended
**464 pass / 2 native crashes / 466**. The return-cancellation native test passed
on standalone rerun. Product-conflict native crashes with -1073740791 on BOTH
candidate and original baseline final-p9, so not established as this release's
regression; SQLite conflict/Undo/Redo test passes. Do not label full sweep green.
Clean stamped deployment dry run passed; no actual deploy was attempted.

Real built-app Playwright result:
- Desktop + Android Chromium: **17 passed, 11 skipped, 2 failed**.
- iPhone WebKit: **11 passed, 4 skipped**.
- Both failures: `storefront-boot.spec.ts:98`, offline reload returns an empty
  `#root` (15-second assertion), despite online startup passing. This blocks the
  owner's no-blank-page release condition. Root cause and baseline parity for
  this browser failure have NOT been established; do not assume a test-only race.
- Skipped blocked-storage admin / known runtime cases remain unverified.

Evidence files under `outputs/open-task-gates-20260918/`: `worker-summary.json`,
`frontend-utils-final.log`, `frontend-build-final.log`, `native-return-recheck.log`,
`native-conflict-recheck.log`, `native-conflict-baseline.log`,
`browser-chromium.log`, `browser-webkit.log`, `deploy-clean-dryrun.log`.
The first browser attempts failed setup (missing local package/binaries), not app
assertions; those logs remain. Installed the matching Playwright browsers, then
reran. Candidate's existing frontend dependency junction now has an explicit
`@playwright/test` junction to the existing 1.63.0 installation in the old precision
worktree (dependency location ONLY; never use that stale source as release base).
To rerun use that package's `cli.js` with candidate `playwright.config.ts`,
E2E_PORT=4337, E2E_WORKERS=2. All fixtures use loopback, no production writes.

Next: diagnose/fix offline public startup or prove an invalid test fixture with
evidence; rerun failed browser cases plus affected gates. No source changes in
this release attempt. Live remains **354f12d5957e**, migration0183 already applied.
All verification commands above have completed; no test session remains running.

Owner reports only 3% weekly usage remaining. Scope expansion stopped; no new
runtime deployment. Continue from **8bf80ae4**, branch
`codex/supplier-settlement-20260918`, worktree
`C:/Users/mrkl6/Downloads/bos-supplier-settlement-20260918` (not the dirty shared tree).

Integrated, NOT deployed:
- Four searchable controls: stock-in invoice supplier, bulk category/unit, dated
  reconciliation product candidate. Independent review passed; browser/touch
  verification still required.
- Prospective atomic stock-in payment capture. Older drafts remain unknown;
  exact retries retain canonical payloads. Existing lots retain original terms,
  with a visible bilingual caveat. Separate Products Review flow does not save
  payment terms: ineffective controls are hidden and the limitation is explicit.
- Removed unused preload policy and replaced misleading source-string assertions
  with executable tests of the configured route-preload plugin. No active policy
  change. Independent review passed.

Verification: original frontend full run at f5301eb2: **474 passed / 3 red / 477**.
One real Khmer terminology mismatch and two old-markup test assumptions were fixed
in f7bdc71f and 8bf80ae4. Root reran all three failures plus payment and searchable
picker tests: **5/5 passed**. This is NOT a fresh full-suite pass. Worker typecheck
passed. Combined final build, browser gates, and fresh full frontend run remain.

Worker sweep is running in exec session **47044**, logging each script under
`outputs/open-task-gates-20260918/`; it writes `worker-summary.json` on completion.
At checkpoint 286 scripts had started. Two native exits **-1073740791** were
observed: `test-customer-return-cancel-sequence-native.cjs` and
`test-product-conflict-action-apply-native.cjs`. Preserve first-pass evidence;
compare baseline and candidate in isolation before any release decision. Do not
assume these are harmless contention. The first crash preceded the frontend gate.
Frontend i18n verification completed successfully: 5,887 keys, 637 source files,
all referenced keys resolve in both packs (988 unreferenced candidates warned).

Newly confirmed OPEN browser defects (not fixed):
- AppContext storage globals are evaluated before safeStorageGet's catch;
  authReady initialization can throw under blocked storage. RootErrorBoundary
  likely changes blank screen to error panel, not successful login. Existing
  admin-boot blocked-storage test is skipped. Clean prepared worktree
  `C:/Users/mrkl6/Downloads/bos-blocked-storage-auth-20260918` at f5301eb2;
  no implementation started, claim released. Guard acquisition and sibling auth
  clear/persist/delayed writes while preserving cookie auth; add throwing-getter
  tests and enable the browser case after proof.
- POS unscoped `pos_search` survives account switching; legacy `cart` fallback
  also needs explicit safe cleanup. Never blanket-remove pending financial data.
- Logout and stale_read_scope classification still need controlled delayed-read
  tests. Existing storage-isolation fixture seeds `items` instead of `cart`, and
  a >=0 polling assertion does not wait for late failures. Repair these fixtures
  before claiming the skipped account-switch scenarios pass.

Gender: captured audited restoration was 4,162 matched customers, 862 held, zero
mismatches, General unchanged. The later 872 ledger count has no fresh census in
the inspected evidence. Held reasons: 252 duplicate-name identity, 394 name-only,
88 unknown source gender, 11 uncorroborated, 110 unmatched source name, 1 conflict,
4 protected General, 2 different known phones. No additional safe restoration
established. Next step is fresh read-only identity census and comparison against
the old quarantine; do not overwrite old audit files or infer gender from names.
Source evidence is under `bos-account-cache-sale-flash-20260912/output/customer-gender-review-20260912`.

Other open scope: reviewed-plan-dependent lot-ledger backfill, fresh Sentry event
attribution, responsive/performance and physical-printer verification. No blanket
completion; no deployment permitted until remaining release gates are resolved.
