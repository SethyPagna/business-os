# Barcode cleanup and stock-history follow-up

Base eef73fc1 (previous receipt/POS/contact candidate, not deployed). Dirty main preserved in separate worktree. Owner asks status, latest customer-source review, direct leading-zero barcode merges with links/economics intact, compact stock detail, recorded action cost, and stronger regression gates.

## Status and scope

- Suppliers: compact all-width cards/details implemented and locally verified in parent candidate; not deployed. Actual supplier records are not name-merged.
- Gender: current production audit confirms5023 unspecified;3869 conservative candidates from original customer export. Latest-data/migration follow-up checked97 files/137 sheets/tables and found customer references but no gender field. No expansion and no customer writes. Original private matching artifacts remain ignored under prior live worktree output/customer-gender-review-20260912.
- Receipt: physical XP-K200L/browser-PDF long receipt still unresolved. Continuous80mm output must not shrink or split. Test-window blank was clarified by owner, not a proven app outage.
- Prior scoped-stock0157 candidate remains separate and undeployed; do not infer its approval from this barcode request.

## Live read-only product census

Source report: prior live worktree output/product-leading-zero-census-20260912.md. All successful remote queries reported changed_db=false/rows_written=0.

8081 active ordinary products.1535 exact-name leading-zero groups before manual exclusions;1508 route-visible groups.1488 provisional clean pair groups after19 linked triples and one pair4209/9075 with pre-existing six-unit product-cache discrepancy.27 manual-overlap groups are excluded separately. Candidate branch and active-lot totals2762. Current product.merge ledger213 histories/audits:212 applied,1 reversed, zero pending fingerprints;174 is only the persisted bulk-plan subset.

No product writes yet. Existing bulk route also includes exact-raw duplicates, so cannot execute a leading-zero-only allowlist. New scoped preview/apply safety under implementation; preserve all existing permissions, graph/atomic/undo/budget gates and quarantine cross-name canonical collisions. No direct SQL merge or trigger bypass. Economics requested: unweighted average of distinct positive costs, maximum selling/wholesale prices. Existing cleanup kernel matches; import/selected-conflict economics still have older outlier policy and remain a separate gap.

## Implemented locally

-35d492ee includes previously skipped CJS tests and truthful bail counts. Author complete chain386/386.
-d60ff3cf compact stock detail: barcode beneath title, two-column facts, units beside quantities, costs from movement only; irrelevant current-lot payment/session metadata hidden for adjustments. Receipt sessions are receiving-workflow metadata, not ordinary adjustment facts. Missing cost is Not recorded; recorded zero remains zero.
-4ba50bac wires actual emitted-chunk validation into every frontend build. Injected-cycle failure and npm failure propagation tests pass. This static gate cannot prevent every runtime blank screen.
-1f6d804b adjustment/revert snapshot candidate NOT certified. Independent mounted-route reproduction changes lotcost4 to99 after stock mutation; remove2 records198 instead8 because cost lookup is too late. Helper also accepts Infinity/overcoverage. Author fixing; do not release until independently retested.

## Remaining verification and boundaries

Forward transfer/import/dated-count/writeoff cost snapshot gaps are identified but not repaired in the bounded adjustment/revert slice. Never backfill old zeros with today's product price. Revert must copy original recorded snapshot, not current catalog. Pending independent review, integrated package gates, authoritative scoped preview, recovery evidence, production merge application/postflight and deployment. No completion claim for all earlier tasks.

## Subsequent integration through16cb7ee6

Transfers1170b3eb now store per-allocation/untracked cost provenance for exact retry/undo/redo; new destination lots preserve source USD cost, legacy unknown staysNULL. Lot schema has no KHR cost column; KHR uses plan-time source product snapshot without inventing FX.

Adjustment race fixes b1eaac6c/e1e94528 capture cost and exact FIFO allocations before mutation; productBatches applies only frozen IDs with atomic availability assertions. Shared helper rejects finite arithmetic overflow as well as nonfinite inputs and overcoverage. Independent reviewer reran overflow,21 adjustment checks,15 transactional transfer-cost scenarios,20 replay and8 revert checks successfully. Existing whole adjustment/revert multi-call orchestration is not certified globally atomic.

Import/writeoff4c57d470 and correction16cb7ee6 bind analyzed product/branch/type/delta/magnitude, require missing legacy snapshots to be reanalyzed, validate totals/finite arithmetic, and avoid extrapolating known-lot costs over unknown quantities. Independent previous-failure probes and focused suites pass. Bulk-delete pre-existing cross-chunk atomicity/CAS limitations remain; this certifies plan-time cost recording, not globally atomic deletion. Dated-count plan has no valuation and remains unmodified; deprecated move-row cost gap remains open.

Frontend388/388 files, typecheck/i18n/build and automatic emitted253-chunk zero-cycle gate pass before scoped-cleanup UI changes. Full backend sweep launched at16cb7ee6; result pending.

Scoped merge3bcaee87 is still blocked by independent review: preview graph/economics/canonical collision authority was not bound to the atomic fold. Author correcting before release and adding successful/concurrent native tests. No production merge can run on this first candidate.

Owner has signed into the Codex in-app browser; tab6 /products#hub:products:duplicates visibly shows1535 leading-zero groups. No Apply clicked. Tab retained for reviewed execution after deployment/backup/guards. Logged-in dashboard briefly displayed stale-refresh warning; not a blank screen, not repaired in this slice.

Economics parity audit confirmed separate existing import/selected-conflict drift (2,200 becomes200 rather than101; iterative4,5,6 yields5.25 rather than5). New scoped cleanup uses correct cluster kernel; do not claim global import economics fixed. Broader contributor-accumulator change is documented, not implemented.
