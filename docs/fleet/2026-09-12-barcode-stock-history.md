# Barcode cleanup and stock-history follow-up

Base eef73fc1 (previous receipt/POS/contact candidate, not deployed). Dirty main preserved in separate worktree. Owner asks status, latest customer-source review, direct leading-zero barcode merges with links/economics intact, compact stock detail, recorded action cost, and stronger regression gates.

## Status and scope

- Suppliers: compact all-width cards/details implemented and locally verified in parent candidate; not deployed. Actual supplier records are not name-merged.
- Gender: fresh read-only audit at12:19:53Z confirms5024 unspecified. Expanded original-source matching supports4162 (4130Female/32Male);862 quarantined, including4General profiles. Owner authorized all exceptGeneral; only verified identities may be restored, never gender inferred from names. Latest-data/migration follow-up checked97 files/137 sheets/tables and found customer references but no gender field. Normal contact import is unsafe for gender-only restoration (can alter blank address and lacks source-manifest binding/undo). Dedicated manifest-bound restoration is under separate implementation; no customer writes. Private evidence remains ignored under prior live worktree output/customer-gender-review-20260912.
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

## Release gate checkpoint through f538648f

Scoped backend38ea218d (source3a2bb5a8) supersedes the earlier manifest blocker: full graph/economics/lot metadata and stock are bound to preview and atomic per-pair assertions. Independent native counterexamples now reject price, outsider, historical-link and lot-cost changes without committing a pair. Thirteen affected backend conflict/merge/undo/preview suites and backend typecheck pass. Scope remains pairs only, not whole-manifest rollback; existing cached-stock discrepancy and triples are blocked.

UI6de948d7 (source78991cfd) supersedes the cross-account callback blocker. Opaque actor authority, request generation and controller identity fence all continuations including preview/load/error/finally. Independent actual-callback adversarial tests and isolated headless built React review/confirm passed. Test-only followups ebea12f0/f538648f preserve runtime. Frontend389/389, typecheck, i18n5752keys/604files and build253chunks/zero static cycles pass. Evidence output-leading-zero-review-6de948d7.md; browser fixture does not certify production catalog disappearance or physical devices.

Broad backend sweep executed360files,353first-pass successes. Seven failures were retained in logs; six pass recheck after precise fixture loader/source-contract corrections. Native remove intermittently exits nonzero with an empty log and remains under investigation, not waived or rerun-until-green. Deployment remains held pending this gate.

Production still70bc5cfa-1f61-401a-94e2-fcb707d867e4 at100% (read-only Wrangler deployment listing). No current candidate deployment or product/gender writes. Full D1 export refused FTS5 virtual tables; physical-table export and Time Travel recovery bookmark are being captured instead. Never claim that failed export is a backup. Recovery must prefer per-pair guarded undo; whole-database Time Travel would overwrite intervening business activity and requires separate deliberate authorization.

## LIVE release and restoration in progress — September12 13:27Z

Release109fb3c5bc84 pushed to codex/barcode-stock-history-20260912 and deployed as2081b326-4fbf-4e7b-b88f-8f10ee9f6e28. Worker hash edb7226bbd229a40; built13:19:36Z. Frontend tested runtime4a77bc5adf89/hash3f1f9208f4265d73, entryindex-DUZJua_-.js;109fb differs only in test. Live signed-in app reloaded and opened Dashboard/Customers. No migration or secret sync. CLI runtime-version read hit bot challenge; do not use that response as version evidence.

Backend gender67acbfb3 and UIaa725ebb/287133c7/4a77bc5a implement approved manifest4162rows/84chunks, server-only SHA allowlist, exact identity and global uniqueness guards, atomic gender-only writes/snapshot/history/audit, admin+FullContacts edit, actor-owned status, guarded undo/redo. Private manifest SHA2564cc42ea3d464a0cd42fe582ff8a62a00c5935805cee62f239185c5e6f90e9e8b. Independent real-Hono/SQLite full captured campaign preserves every other customer column and862quarantined records; seeded financial/loyalty data unchanged. Actual built synthetic UI84preview/apply pairs and StrictMode replay passed. Earlier missing import/StrictMode blockers were fixed before release.

Frontend full390file run had389pass/one stale Customers Manage permission assertion;109fb updates that exact test, both it and restoration tests pass. Integrated typecheck/i18n/build254chunks zero cycles pass. Backend new native restoration, undo28 and financial-history permission tests pass. Prior native remove gate: identical candidate had3successful runs and1Windows FailFast0xC0000409/no assertion output; severe lowRAM222MB observed. Preserve this runner limitation, not an all-runs-green claim.

Backup physical export completed213070981bytes,131tables/366317INSERT statements; critical product/stock/sale/customer/history tables present. SHA256A846FB9A95264610E50ACC3A5EBACF7CDD3D4543A5184A52BCBAB5D59682B573. Virtual search tables excluded; no full restore drill. Recovery bookmark recorded privately. Output folder is ignored including backup SQL; signed download URL must not be published.

Live preflight5024blankgender,8081active ordinary products, branch-stock and branch-lot sums24592 each, eight targeted orphan classes zero. Root selected approved file in normal Customers Manage workflow and explicitly applied. At13:27Z400restored/eightreceipts/history654–661; operation stillrunning. No productmerge yet. Postflight verifier waits for completion; no final completion claim.

## Gender restoration complete; merge preview blocked — September12

The preceding in-progress status is superseded: production restoration completed4162 customers (4130Female,32Male),84/84 atomic chunks, action history654–737 and snapshots246–329. Independent read-only postflight found zero wrong restored genders, zero changes to captured non-gender identity fields, zero bad campaign receipts, and zero General changes.862 records remain unchanged, including4General and858 unresolved/ambiguous records. No gender was inferred from a name. Private postflight evidence is under cloudflare/output/cleanup-postflight/.

Periodic permission refresh interrupted the UI after79 chunks without weakening the write guard. Root reopened the campaign, checked79 receipts, reselected the approved manifest and explicitly applied only the remaining212 records. Fix7767af3c now provides a closable stale-session explanation; f9b7dff5 adds platform-independent regression coverage. Independent React StrictMode close/reopen/resume checks pass. Release f9b7dff59ad1 deployed as ff876b1e-30e5-47e5-a370-7b07936e5767, Worker hash58a0999fb9c77700, built2026-09-12T14:02:14.674Z. Integrated frontend typecheck/i18n/build pass (254chunks, zero static cycles). No migrations or secret sync.

Product merge preview opened in the signed-in Admin tab but failed with Request timed out after30s. No product merge has been applied. A read-only actual-helper probe identifies125 sequential D1 calls for25 pairs (up to150 with overlapping lots), shared by preview and apply. A bounded read-batching correction is being implemented with snapshot/digest parity and independent review required before retrying. Exact production stage timing remains unmeasured. Safe pair census is provisional, not an applied count.

Post-gender/pre-merge baseline:8081active ordinary products, branch_stock and branch_batch_stock totals24592 each; action_history max737, undo_snapshots max329. Supplier compact cards and POS quantity/address presets are included in this release, but this is not a completion claim for the full earlier issue backlog or physical receipt printing.

## Preview performance followup deployed; detail pagination pending

Release694830e4455c is live at100% (Worker73e424f3-4453-42b5-95c8-4d6e9bb53325; deploymentd42ecb00-656c-4554-aef6-66ac30a91d33; hash8ac9cb0ef529872e; built2026-09-12T14:52:29.272Z). Commits6e025d8e/bed484ba/694830e4 integrate first-click menu intent loading, full-graph read batching and five-pair server-generated manifests. Independent native browser gesture/keyboard/retry/unmount checks pass for both menus. Native SQLite graph/digest parity passes125→9 and150→11 calls for25pairs; five-pair cohorts execute5+5+2 with exact receipts, wider-digest refusal and untouched outsiders. Old valid25-pair manifest compatibility remains. Integrated frontend typecheck/i18n/build254chunks/zero cycles, native scoped/snapshot/graph tests and backend typecheck pass. No migration/secret sync.

Fresh app reopened after deployment; scoped preview details then made DOM inspection unresponsive (CDP timeout/native-pipe frame limit). No Apply was clicked. Root returned to Dashboard, which responded normally. Read-only code investigation found the preview renders every returned candidate and nested detail while the large underlying duplicates page remains mounted. CSS max-height does not bound rendered nodes. A bounded25-group detail paginator is being implemented without slicing the full validation/cohort data or changing the five-pair write loop. Exact live eligibility count still awaits usable preview. Product merges remain NOT APPLIED.
