# Business OS checkpoint

Created: 2026-09-01 (continuation of the 11:02 +07 checkpoint)
Branch: main

## What changed in this pass

- Fixed all 4 pre-existing backend test failures (root-caused, not worked
  around): a missing harness require-override for lib/businessDateWindow.ts
  in test-review-gate-pure.cjs; a stale assertion string in
  test-route-permissions-pure.cjs (source already said "stock integrity",
  test still expected "misplaced stock"); and a `tsc` invoked via
  `npx tsc` in test-stock-ledger-pure.cjs / test-stock-revert-pure.cjs
  resolving to a fresh TypeScript instead of the local devDependency
  (root cause: node_modules/.bin/tsc losing its executable bit on
  zip-transfer -- the same corruption noted below -- which makes `npx`
  fall through to fetching latest TypeScript from the registry instead of
  the project-pinned version).
  **CORRECTION (2026-09-01, later pass):** the `--ignoreConfig` flag added
  here does not exist in any TypeScript version and was never a real fix --
  it happened to go unnoticed until a `tsc` version that hard-errors on
  unknown options (TS5023) was resolved, which then broke the automation
  outright. The actual fix is (1) remove `--ignoreConfig` entirely and
  (2) restore the executable bit on node_modules/.bin/tsc (a plain
  `npm install` in cloudflare/ also fixes it) so `npx tsc` resolves the
  local, project-pinned TypeScript. Verified end-to-end against the real
  repo: test-stock-ledger-pure.cjs (21/21) and test-stock-revert-pure.cjs
  (8/8) both pass cleanly with no --ignoreConfig and no TS5112. See
  progress.md for the full diagnosis.
- Verified, file by file, the two update packages (update_code.zip,
  business-os-update-20260901.zip) against this checkoint's main tree.
  43+ files were byte-identical; several files (compat.ts, routes/
  inventory.ts, Inventory.tsx, Products.tsx, StockAdjustModal.tsx,
  SalesDailyReport.tsx, test-image-normalize-pure.cjs, and 4 frontend test
  files) were confirmed main-newer by reading the real source, not assumed
  -- kept main's versions.
- Merged in the account-security / password-manager feature (users.ts,
  auth.ts, Users.tsx, UserProfileModal.tsx, Login.tsx, passwordManager.ts,
  plus their tests) from the update package. Per explicit user decision,
  removed all primary-admin protection: admins can now manage any other
  admin account, including the seeded primary admin (no account is
  special-cased). Updated the two tests that encoded the old protected-
  primary-admin policy to match.
- Wired frontend/tests/passwordManagement.test.ts into package.json's
  test:utils chain.
- Fixed a real, pre-existing stale test (performanceLoadingUx.test.ts still
  asserted the old single-request CSV export shape; the real export flow
  already paginates via a snapshot/cursor contract, covered separately by
  activeDataCompleteness.test.ts) -- confirmed against source, not guessed.
- Fixed a line-based regex in actionStability.test.ts that false-negatived
  on a legitimately-guarded multi-line ternary call site (widened to look
  back up to 8 lines for the guarding runUserMutation/runRoleMutation call).
- node_modules had zip-transfer corruption (0-byte files, e.g. node-
  releases' release-schedule.json, plus non-executable .bin/* binaries).
  Fixed with a clean `npm install` in frontend/ (cloudflare/'s node_modules
  was already intact -- confirmed via a full 147/147 backend test pass and
  a zero-byte scan that only found legitimately-empty type-only files).

## Verification state (this pass, in this sandbox)

- Backend (cloudflare/): 147/147 pure-logic tests pass, `tsc --noEmit` clean.
- Frontend: `tsc --noEmit` clean, full `npm run test:utils` chain
  (typecheck + verify:public-runtime + check:source + ~150 test files,
  858 individual PASS lines) all green, REAL `vite build` succeeded
  (`✓ built in ~25s`, dist/ produced, no errors).

## Deliberately NOT done in this pass

- The two live bugs reported by the user (branch Transfer button/function,
  "2Medium" search miss) were not yet investigated -- next up.
- No production deploy, no D1 migration apply, no wrangler calls.
- .git metadata, node_modules, build outputs, and local caches are excluded
  from this archive (see the original CHECKPOINT.md this one continues from
  for the full exclusion list, restore, and deploy instructions).
