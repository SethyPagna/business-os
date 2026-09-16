# Regression pack — error classes fixed in the last four release programs

Scope: Precision v1 / storefront pager / return fixes (Sep 14), iOS PWA hardening +
Playwright + free/paid split (Sep 14), Program 3 (Sep 15), Program 4 (Sep 15) — the
top four entries of `progress.md` at the time this pack was built (base `d0bf812e`).

Run just this pack:

- Frontend: `cd frontend && npm run test:regression`
- Worker: `cd cloudflare && node scripts/run-regression-pack.cjs`

Both are curated, explicit file lists (not directory sweeps) — see the header comment
in each runner for why. Every listed file also runs inside the full `npm run
test:utils` chain (frontend) and the full `test-*.cjs` sweep (Worker); this pack exists
to name the specific classes seen before and let anyone re-run exactly those, fast.

## Table

| Defect class | Owner report / program | Fix commit(s) | Test file | How to run | Discriminating check performed |
|---|---|---|---|---|---|
| P4-1 "Failed to load tagged stock" (migration column referenced by code but not declared by any migration file) | Program 4, Sep 15 | 8ecb.. (0162/0163 applied) | `cloudflare/scripts/test-tagged-stock-migration-columns-pure.cjs` (**new**) | `node cloudflare/scripts/test-tagged-stock-migration-columns-pure.cjs` | Added `nonexistent_column_xyz` to the asserted column set → red (`... is not declared by any migration file`); removed it → green. Note: this pins the code/migration-file half only; the remote-apply-order half of the original bug is not observable from source and is covered operationally by the release-note "Production D1 writes" line, not by a Worker test. |
| P4-4 hot-endpoint sequential D1 round trips (8–18 per mutating action, no numeric ceiling existed) | Program 4 wave 1, Sep 15 | e18f46ed, ce8e4d4e, 66cffaed (fold to one round trip); wave 2 explicitly left `inventory.ts` /adjust, `contacts.ts` create, `returns.ts` reads open | `cloudflare/scripts/test-hot-endpoint-roundtrip-budget-pure.cjs` (**new**) | `node cloudflare/scripts/test-hot-endpoint-roundtrip-budget-pure.cjs` | Lowered the `POST /sales` ceiling from 15 to 5 (current count is 13) → red; restored → green. Current counts recorded in the file: sales 13, inventory/adjust 16, batches 2, returns 12, contacts 5. |
| P4-4 `audit()` is one D1 round trip, not three | Program 4 wave 1, Sep 15 | e18f46ed, ce8e4d4e (135 call sites) | `cloudflare/scripts/test-audit-single-roundtrip-pure.cjs` (existing) | `node cloudflare/scripts/test-audit-single-roundtrip-pure.cjs` | Ran as-is (green); not re-flipped against pre-fix source in this pass — spot-checked that the assertions read source text for the folded call shape, not a tautology. |
| P4-4 sticky headers drop `backdrop-blur` when background is already opaque | Program 4 wave 1, Sep 15 | listed in the frontend Program-4 commit set (a1850912..a2f61dca) | `frontend/tests/stickyHeaderBlurRemoval.test.ts` (existing) | `node frontend/tests/stickyHeaderBlurRemoval.test.ts` | Ran as-is (green); asserts each of 17 named files no longer contains `backdrop-blur` beside its sticky header class — a real content check, not a snapshot. |
| P4-4 precache eager/deferred split stays under its size budget (30 eager / 2.99 MB, 248 deferred / 4.98 MB) | Program 4 wave 1, Sep 15 | frontend Program-4 commit set | `frontend/tests/precacheEagerDeferredSplit.test.ts` (existing) | `node frontend/tests/precacheEagerDeferredSplit.test.ts` | Ran as-is (green). |
| P4-2 same-name supplier resolves to the existing record, never a second row (any writer) | Program 4, Sep 15 | aa3ab4b5, 2f94d4c4, 8c2d903c, 87a6ba18, 7db5f8fc | `frontend/tests/contactDuplicateDecision.test.ts` (existing) | `node frontend/tests/contactDuplicateDecision.test.ts` | Ran as-is (green). Traced the Worker side: `contacts.ts` POST is one shared handler for customers/suppliers/delivery contacts keyed off `config.table`, so the stock-change picker, the Add Supplier form and undo/redo all funnel through the same `checkContactDuplicateBlock` / `resolvedExisting` code path — there is only one writer to guard, which the migration `0164` postflight (14 losers deleted, 0 remaining) corroborates. |
| P3-3 removing damaged stock offers keep-as-tagged-row vs remove-entirely; a direct removal books a loss at cost | Program 3, Sep 15 | 4a5b71bc, 33bbe1d0, 0ad1f65b, a07b286e, 50c28a63, 6990639a, d279e340, 9d4eb1bd | `frontend/tests/stockConditionTag.test.ts` (existing) | `node frontend/tests/stockConditionTag.test.ts` | Ran as-is (green). |
| P3-1 stock-in edits/reverts mirror into the supplier record | Program 3, Sep 15 | d3f8f06c, e3bf6fbf, ac11bf99, 344d5d97, c0a16cce | `cloudflare/scripts/test-supplier-attribution-pure.cjs` (existing) | `node cloudflare/scripts/test-supplier-attribution-pure.cjs` | Ran as-is (green, 8 checks). |
| P3-11 stock removed entirely is a loss at cost; loss rows are valued and shown alongside every stats surface | Program 3, Sep 15 | 5e430b70, cb1ae016, 668d2e3d, 1303fcc4, b02119da, … | `cloudflare/scripts/test-removal-losses-pure.cjs` (existing) | `node cloudflare/scripts/test-removal-losses-pure.cjs` | Ran as-is (green). |
| No negative revenue/profit anywhere a stat is shown | standing rule, all programs | test-stats-non-negative-pure.cjs authorship predates this pass | `cloudflare/scripts/test-stats-non-negative-pure.cjs` (existing); frontend siblings `reportsHub.test.ts`, `branchProductsSurface.test.ts` | `node cloudflare/scripts/test-stats-non-negative-pure.cjs` / the two frontend files | Ran as-is (all green). |
| Two stock ledgers (`branch_stock` aggregate and the lot/batch ledger) stay reconciled | pre-existing class, referenced by multiple programs | test-lot-ledger-reconcile-pure.cjs authorship predates this pass | `cloudflare/scripts/test-lot-ledger-reconcile-pure.cjs` (existing) | `node cloudflare/scripts/test-lot-ledger-reconcile-pure.cjs` | Ran as-is (green). |
| Dates render day-first everywhere | standing rule, all programs | dateFormatDayFirst.test.ts authorship predates this pass | `frontend/tests/dateFormatDayFirst.test.ts` (existing) | `node frontend/tests/dateFormatDayFirst.test.ts` | Ran as-is (green). |
| P3-5 every add/remove/set stock line carries its own reason, revealed on click, on every writer | Program 3, Sep 15 | bd058a39, ec708088, 2326934f, 2a13a3b3, 88e92e7b, 74b8294b, 64faa4ad, 52aab714, dda24b7b, d1cd27fe, e7589030, e255028e | `frontend/tests/fastStockInReasons.test.ts` (existing) | `node frontend/tests/fastStockInReasons.test.ts` | Ran as-is (green). |
| Deploy stamp is never blank; a dirty tree is never stamped as a clean commit | 2026-09-03 incident (referenced by every program since) | (pre-existing fix, guarded continuously) | `cloudflare/scripts/test-build-provenance-pure.cjs` (existing) | `node cloudflare/scripts/test-build-provenance-pure.cjs` | Ran as-is (green, 9 checks: dev fallback, clean stamp, `-dirty` stamp, untracked-files exclusion, override, define-arg quoting, runtime wiring, typeof guards, deploy script routing). |
| Migration chain applies clean and stays internally consistent (159 files) | pre-existing class | test-migration-chain-fresh-pure.cjs authorship predates this pass | `cloudflare/scripts/test-migration-chain-fresh-pure.cjs` (existing) | `node cloudflare/scripts/test-migration-chain-fresh-pure.cjs` | Ran as-is (green, 8 checks against a from-scratch SQLite apply of all 159 migration files). |

## New files added by this lane

- `cloudflare/scripts/test-hot-endpoint-roundtrip-budget-pure.cjs` — sequential-D1-round-trip
  ceiling per hot mutating endpoint (`POST /sales`, `POST /inventory/adjust`, `POST /batches`,
  `POST /returns`, `POST /contacts`). Static source count, brace-balanced extraction of each
  handler body, counts `await db.prepare(` / `await db.batch(`.
- `cloudflare/scripts/test-tagged-stock-migration-columns-pure.cjs` — every
  `damaged_stock_lots` column the tagged-stock writers reference (`condition_tag`, `source`,
  `unit_cost_usd`, …) must be declared by some migration file in the chain (CREATE TABLE or
  ALTER TABLE ADD COLUMN).
- `cloudflare/scripts/run-regression-pack.cjs` — runs the Worker half of the pack, isolated
  per file, prints `OK`/`RED` per file.
- `frontend/tests/runRegressionPack.mjs` — runs the frontend half of the pack the same way.
  (Not a `*.test.ts`/`*.test.cjs` file itself, so `tests/runTestChain.ts`'s auto-discovery does
  not pick it up as a test and double-count it.)
- `frontend/package.json` — added `"test:regression": "node tests/runRegressionPack.mjs"`.

## Classes named in the task brief that already had a pin (verified green, not duplicated)

`audit()` single round trip, sticky-header backdrop-blur removal, precache size budget, Khmer
pack completeness (`npm run verify:i18n`, not a single test file — see `verify:i18n` gate),
day-first dates, negative revenue/profit, loss rows valued, stock identity across the two
ledgers, the deploy `-dirty`/wrong-revision guard, and same-name supplier resolution from every
writer (traced to the single shared `contacts.ts` POST handler — see table row above).

## Expected reds found (real defects) — none

No new red was found while building this pack. The two new tests above are guards against a
*future* regression of the same shape, not evidence of a currently-live defect: both were run
against the current tip and are green; both were proven discriminating by a temporary local flip
(described in the table) that reverted red, then restored to green, with no code change staged.

## Scope note

This pass built and verified 2 new discriminating tests plus explicit regression-pack runners
covering the classes the task brief named as most likely to lack a pin. It did not attempt a
full commit-by-commit audit of every fix in Program 3/Program 4 (dozens of commits per program)
or a pre-fix-commit rerun of every *existing* pinned test — those were spot-verified green and,
for the two classes most central to the current programs (P4-2 same-name supplier, P3-3 tagged
damaged rows), traced against the actual source path rather than only re-run. A fuller sweep
(pre-fix reruns for every row in the table, plus the remaining Program 3/4 items not yet covered
by a named file — see `progress.md` "Not yet" for Program 4 wave 2) is future work, not claimed
done here.
