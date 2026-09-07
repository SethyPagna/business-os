# Owner task register — September 7, 2026

This is the current request register. `progress.md` links here. Append new owner
requests and corrections; do not replace earlier requests or silently drop them.
Root owns prioritization, integration, evidence, and deployment claims.

Last reconciled: 2026-09-07T17:20:41.064Z. Functional fixes precede UI polish.
Current production: **da5c8b02**, Worker **a49ba8c2-1192-4700-b626-564a72e54938**, 100% at **2026-09-07T20:27:13.051562Z**. Migration0135 preservation verified; Contacts/merge release deployed. Production merge still eight cases; live browser follow-through pending. Historical branch correction complete.

First functional release **821efc94ce7a** is serving 100% traffic as Worker
**498efadb-f833-471d-a8b7-b4326950bd26**, deployed 2026-09-07 09:54:13 UTC.
Public Git branch: codex/release-fixes-20260907. Migrations 0128–0132 and required
security configuration applied. Full 306 frontend files and 274 backend suites,
both typechecks, i18n, build, and frozen browser smoke passed before deployment.
Live assets match the release; Sales bootstrap timed out during network failures
and is still under investigation (F36). Do not call every live workflow certified.
Delivery addition F32 is now deployed as **c475e637d197**, Worker
**d5aeeb82-cb0d-4047-8abf-8e96ba17f602**, 100% at 11:10:18 UTC; migration 0133
preserved all nine prior amendment rows and revisions. Live Sales and Records
loaded after connection recovery. F36 has further retry-visibility fixes pending.
Historical metadata correction was attempted but failed on the remote batch transport.
All 4,333 target rows were independently verified unchanged and audit count zero.
The guarded payload is being compacted; no correction or duplicate merge has committed.

State definitions: **Local pass** means implemented with relevant local evidence,
not production completion. **Integrated** means source is composed but final
release checks remain. **Active** means assigned work remains. **Pending live**
means a prepared operation has not run. **Deferred UI** follows the owner's
explicit priority correction. **Needs facts** means evidence cannot be invented.
Every shipped row must eventually record its actual deployment version.

## Functional requests

| ID | Request and latest accepted detail | State / owner | Evidence or next action |
|---|---|---|---|
| F01 | Completed sale changed back to awaiting payment must allow authorized payment method, amount, item and delete/correction actions. | Deployed 02eecbe3; live follow-through active | Sales correction and scope tests; final release smoke. |
| F02 | Audit all historical sales with missing branch, Warehouse/multiple branches, or N/A driver. | Proven branch repair complete; ambiguous provenance remains / root | Census covered 15,096 sales and 36,340 lines. Proven null metadata repair prepared; ambiguous fulfillment/driver facts remain unresolved. |
| F03 | Enforce Shop-only sales; Warehouse stock must transfer first, including added lines, imports, replacements and generated sales. | Deployed 821efc94; recorded limitations retained | Backend enforcement and sibling parity tests integrated. |
| F04 | Stock-in session times out after 12 seconds. | Deployed 821efc94; recorded limitations retained | Session-specific 60-second transport, stable request identity, durable retry; no global timeout inflation. |
| F05 | Multiple products with multiple images each fail in one stock session, including encoded spaces/Khmer/percent filenames. | Deployed 821efc94; recorded limitations retained | Older build reproduced 409; identical retained 3-product/6-image request succeeded once on eb06b80b. Six asset GETs and product/gallery ownership passed. |
| F06 | Add/edit/create product images: upload, attach from Library, files, camera entry, and PWA draft lifecycle. | Deployed 821efc94; recorded limitations retained | Upload/Library associations and close/minimize/retry passed. Actual phone camera hardware was unavailable; do not claim a hardware test. |
| F07 | Library totals: physical storage, file quantities by type, correct usage and deletion protection. | Deployed 821efc94; recorded limitations retained | Physical counts unchanged by retry; covers and gallery usage correct. |
| F08 | Same barcode/leading zeros: scanner, search, same-session recognition and merge must use compatible identity. | Deployed 821efc94; recorded limitations retained | Guarded UPC/internal-code parity; do not strip meaningful arbitrary code zeros. |
| F09 | Merge cost uses distinct nonzero available costs; highest retail/wholesale prices; preserve stock/relations/audit/undo. | Implementation deployed 821efc94; production merge pending / identity, root | 1,600 synthetic folds in 64 requests; retry mean remains fixed, changed source refuses retry. |
| F10 | Run the production duplicate merge; one confirmation, bounded progress, faster saves. | Partial: 8 committed; stopped for F39/F40 / root | Preview 1,968 groups/1,987 candidates. Snapshot IDs52–59 and undoable action IDs318–325 verified after overloaded request. Do not reapply completed cases. |
| F11 | Detect duplicate barcode OR name added earlier in the same session, including queued/saved lines; otherwise green only after resolved lookup. | Deployed 821efc94; recorded limitations retained | Session identity and duplicate parity tests integrated; explicit quantity edit preserved. |
| F12 | Gross sales, discounts, refunds and revenue must agree across Dashboard chart, headline, Sales, Inventory and reports. | Deployed 821efc94; recorded limitations retained | Tested gross 200, total discount 15, net 185; raw item-discount basis corrected. |
| F13 | Credit is recognized in revenue and profit (N39); latest visible wording overridden by F44 Not Paid / ប្រាក់ជំពាក់. | Deployed 821efc94; recorded limitations retained | Credit/revenue parity and report tests integrated. |
| F14 | Shift registration is report-only and close always works (N37). | Deployed 821efc94; recorded limitations retained | Real route tests; blank and explicit zero are different; invalid values rejected without blocking legitimate close. |
| F15 | Shift report compares registered opening/end USD and KHR; unknown stays unknown (N38). | Deployed 821efc94; recorded limitations retained | Migration 0132 conservatively treats ambiguous legacy zero as unknown; report/Telegram tests passed. |
| F16 | Shift Report is its own selectable report view with export, not an extra block in overview. | Deployed 821efc94; recorded limitations retained | Final browser smoke includes selection/export. |
| F17 | Concise Telegram reports (N42). | Deployed 821efc94; recorded limitations retained | Bilingual composed payloads, day-first dates and concise report tests passed; no live messages sent. |
| F18 | Delivery accounting clearly explains customer charge, actual courier cost, store-paid portion and contribution without double deduction. | Deployed 821efc94; recorded limitations retained | Financial parity verified; negative contribution can represent store subsidy. |
| F19 | Expenses generated by sales show a sale link; branch is Shop; manual expenses need no sale ID. | Implementation deployed 821efc94; proven branch correction complete / root | Existing unlinked legacy fees lack proof of a sale relationship. Never invent links; proven branch metadata correction prepared. |
| F20 | Records line belongs INSIDE expanded sale details, not the collapsed row (latest correction to N41). | Deployed 821efc94; recorded limitations retained | Browser placement, single dialog and return-to-detail flow passed. |
| F21 | Records includes actor/time, status, products/quantity, payments, delivery fee and actual cost with readable before/after detail. | Records deployed 821efc94; future snapshots F33 deployed 02eecbe3 / sales | Structured detail/integrity tests pass. Unknown/pruned provenance is explicit; retained replay history survives both clear paths. Sales list D1 failure is F34. |
| F22 | Customer delivery fee and actual delivery cost are separately editable and recorded. | Deployed 821efc94; conversion F32 deployed c475e637 / sales | Fee changes customer total; actual cost does not. No-delivery conversion is F32. |
| F23 | Dashboard low/out lists load more at the bottom and reset on leaving. | Deployed 821efc94; recorded limitations retained | Desktop and 375px scroll 10→20 and leave/reenter reset passed. |
| F24 | Total stock alerts use Shop+Warehouse; branch pages/POS branch options use individual branch stock. | Deployed 821efc94; recorded limitations retained | Pure aggregate/branch tests; alert setting events refresh Dashboard, POS and Branches. |
| F25 | Permissions/roles fully scoped across add/edit/session/images, review, imports, bulk, offline and undo. | Deployed 821efc94; recorded limitations retained | Synchronous matrix through 96abe402 and Queue authority through 1aae81d3 independently certified, including races, cancellation and current-role checks. Combined first-release sweep passed. |
| F26 | Dismiss offline/update notifications with X without hiding failed saves or lying about connectivity. | Deployed 821efc94; recorded limitations retained | Dismissal helper and App integration complete; reconnect/error behavior retained. |
| F27 | Remove redundant eye next to Print in sales rows. | Deployed 821efc94; recorded limitations retained | Browser row access remains; Actions shows Print only. |
| F28 | Take over Claude lanes, commits, dirty/unverified work and progress sessions. | Deployed 821efc94; recorded limitations retained | Twenty-lane lineage and shared patch inventory preserved; original dirty worktrees untouched. |
| F29 | Remove duplicate delivery_actual_cost_usd field and rejected stopgap kind comment in Sales merge fallout. | Deployed 821efc94; recorded limitations retained | Source/type/parity gates cover composed Sales. |
| F30 | Finish earlier N18/N21/N23 and N28–N36/audit lanes without losing their fixes. | Deployed 821efc94; recorded limitations retained | Canonical ea9f0d1b base includes checkpoint 2 and earlier integrations; individual follow-up fixes retained. |
| F31 | GitHub commits describe individual fixes, not checkpoint/batch commits. | Public fix commits pushed through stability 560bfbcb / root | Separate public release history preserves messages/authors; eight internal reports excluded, required clean test fixture retained. Pushed release branch at 821efc94. |
| F32 | Sale originally without delivery allows later driver, customer fee and actual cost. | Deployed c475e637 / sales | Full backend 276 suites; all frontend 306 files covered; independent money/migration review and browser actual retry/driver/totals/Records passed. |
| F33 | Preserve original basket, payments, driver and actor for future sales. | Deployed 02eecbe3; live follow-through active | Four writers, migration 0134, backup and immutable Records independently pass; original basket/payment remain unchanged after later edits in browser. Backend 278/278 pass. |
| F34 | Sales list/detail Records SQL failed in real D1. | Deployed 821efc94 / sales | Frozen actual Worker list/detail now 200; count and compound ordering repaired. |
| F35 | Fast Stock minimize restored wrong host and consumed the chip. | Deployed 821efc94 / media | Exact user5 frozen browser restore passed; preserves draft and consumes only after modal mounts. |
| F36 | Sales read retry/deadline/cache cancellation and visible manual Retry after failure. | Deployed 02eecbe3; live follow-through active | Frozen 5ec39289 browser: one request aborted at 20s, visible Retry, one manual retry succeeds; late responses never overwrite data or navigation. |
| F37 | Duplicate preview times out on large catalogs because it queries stock/batches/cost per group. | Deployed 02eecbe3; live follow-through active | Independent real route 2,000 groups uses 43 reads instead of roughly 6,000; merge rules, prices and blockers preserved. |
| F38 | Immediately recording payment after changing Completed to Credit reports a false other-device conflict. | Deployed 02eecbe3; live follow-through active | 9d707f1d carries exact committed status version into payment review; real concurrent-write protection and typed tender values retained. |
| F39 | Live bulk merging remains about eight seconds per case and fails on database overload. | Bounded corrections deployed da5c8b02; production merge follow-through pending / root | Eight commits preceded an 87.3s request failure. Inspect serial D1 round trips and invocation limits; preserve atomic cases, undo and whole-cluster cost mean. |
| F40 | Bulk merge error falsely says data not saved after partial commits. | Deployed da5c8b02; production follow-through pending / root | Return/reconcile committed cases and undo IDs on failure; explicit resumable partial state, no blind retry. |

| F41 | Idle import polling writes to D1 and immediate retries amplify database overload. | Deployed 560bfbcb; independent PASS, backend 280/280 / sales | Skip no-op reaper writes when no stale jobs exist; preserve guarded stale recovery. Fail overload once instead of immediately retrying it. |

| F42 | Contacts duplicates: supplier creation in stock sessions, raw versus spaced customer phone numbers, obsolete membership IDs; inspect existing fixes before correction. | Canonical guards and atomic merge deployed da5c8b02; explicit candidate prompts and cleanup remain F47 / identity, media | Stock-in does not auto-create suppliers. Spaced/raw/+855 duplicate matching and import lookup-key freshness are inconsistent. Legacy membership IDs remain; no blind deletion or reassignment. |
| F43 | Contact phone entry automatically spaces digits as typed; formatted display and canonical matching must agree. | Deployed da5c8b02; independent PASS including mobile deletion and IME | Progressive spacing, prefixes, paste and caret covered in seven create/edit/quick-add fields. |
| F44 | Latest owner correction: visible Credit / ឥណទាន becomes Not Paid / ប្រាក់ជំពាក់ everywhere. | Deployed 560bfbcb; live EN/KM verified | Supersedes N39/F13 unpaid-state wording. Internal values/accounting unchanged; distinct Store Credit, supplier credit and overpayment concepts preserved. |
| F45 | Investigate failed admin WebSocket and reported content.js/VM listener/startTime errors. | Deployed 560bfbcb; independent PASS | Cooldown lacked wake-up and actual logout did not disconnect. Both corrected. content.js listener is extension noise; VM startTime ownership unproven. |
| F46 | Bulk conflict multi-select processes slowly one by one; present combined before/after review and efficient bounded execution. | Products Conflicts serial preview/dialog/request cause confirmed; combined-review plan active / sales | Distinguish conflict-resolution workflow from duplicate merge; keep atomicity, scope, audits and accurate partial progress. |

| F47 | Prevent and clearly prompt about existing customers, suppliers and delivery contacts across add/create/edit/quick-add/import/session surfaces; distinguish reuse from intentional creation. | Active scope audit / media | Reuse canonical backend guards; verify prompts and existing-record selection; shared phone is not identity proof. |
| F48 | Shift difference must show when supported across Telegram, reports and history; Closing cash / សាច់ប្រាក់បិទវេន; Not Paid / ប្រាក់ជំពាក់; use owner's supplied concise report arrangement. | Active root-cause audit / sales | Trace registered opening/closing versus expected cash, USD/KHR, explicit zero and unknown. Do not fabricate a difference when inputs are absent. |
| F49 | Attribute Protected Audience, Shared Storage and StorageType.persistent deprecation warnings and fix actual app use. | Active / responsive | Initial exact source scan found none; identify bundle/third-party/extension origin before changing or suppressing warnings. |
| F50 | Correct unassociated form labels (browser reports four resources). | Active source/DOM check / responsive | Associate actual inputs or use semantic headings/legends for group titles; exact four resources not yet identified. |

| F51 | Enforce owner-confirmed canonical Shop/Warehouse and product/branch/lot identity across every writer; retain daily prompt/report-only cash and Not Paid revenue. | Active fixes / accounting, identity, media | Audit found explicit lot product mismatch, non-atomic allocation persistence, POS Warehouse selector/stale lot, sales-import pre-rejection side effects and unknown-lot fallback; branch administration and export-breakdown gaps are also open. |
| F52 | Investigate negative revenue/profit and keep canonical calculations accurate. | Audit complete; accounting clarification retained | Canonical revenue is nonnegative and includes Not Paid. No formula defect found in focused audit. Real below-cost/expense losses may produce negative profit; never falsify by clamping. Inconsistent test wording remains a small follow-up. |

## Public portal and legal requests

| ID | Request | State / owner | Evidence or next action |
|---|---|---|---|
| P01 | Privacy, Terms and Cookie policies; footer policy button reachable at page bottom. | Deployed 821efc94; recorded limitations retained | Reader routes, footer, focus/history/title/scroll behavior verified. |
| P02 | Determine cookie consent needs; form consent and durable policy version/time/locale. | Deployed 821efc94; recorded limitations retained | Optional map/AI/share consent controls and server enforcement; migrations 0130/0131 required. No claim of universal legal compliance. |
| P03 | Minimize collected data; inspect analytics/third-party embeds. | Deployed 821efc94; recorded limitations retained | Initial public load has no third-party requests/embeds; map revocation unloads; raw session identifiers removed; HMAC secret needed at release. |
| P04 | Accessible public site: alt text, contrast, keyboard forms, clear buttons and small-screen heading. | Deployed 821efc94; recorded limitations retained | 375px heading one line/no overflow; modal focus/inert/scroll checks and UI fixes passed. |
| P05 | Remove fake reviews/unsupported claims and review image copyright. | Reviewed; rights facts unresolved / portal | No invented reviews/claims added. Existing image ownership/license cannot be proven from a file alone; keep this risk visible. |
| P06 | Add truthful business details; check applicable local law and flag risks. | Needs facts / root, owner | Trade name/address/phone verified. Registered legal identity, registration, email and target markets remain unconfirmed; Cambodia sources and conditional foreign-market risks documented privately. |
| P07 | Configuration security findings discovered during takeover. | Configuration repaired; bot token rotation pending / root | Dedicated portal HMAC absent; one malformed Telegram binding exposes credential text in its name. Dedicated HMAC configured and stray binding removed; bot token rotation remains necessary. No credential values belong in this register. |

## UI follow-up queue

| ID | Request | State |
|---|---|---|
| U01 | Improve small-screen main/subpage back navigation and remove the large empty bottom gap. | Deferred UI |
| U02 | Add icons to subpage navigation. | Deferred UI |
| U03 | Reports centered with safe edge gutters, larger readable text, consistent larger filter button. | Initial responsive fixes integrated; remaining polish deferred |
| U04 | Compact Shift button with stats/actions; move export beside section title or near small-screen page title without crowding notifications. | Partial integrated; remaining polish deferred |
| U05 | Merge Not paid heading/value into one highlighted row; green total/final profit. | Integrated; final visual confirmation pending |
| U06 | Receipt Item/Qty/Price/Total headings English by default, including mixed English/Khmer setting. | Integrated; receipt browser text checked |
| U07 | Add minus next to Close for edit/add/set/stock/session actions; Back/discard/minimize must cooperate with scoped drafts. | Core Product/Stock/Branch/Fee flows integrated; broad remaining modal rollout deferred |
| U08 | Compact Start/End dates; default entire days 00:00–23:59 without extra selector; align with stats/actions across Dashboard/Sales/Expenses/Returns/Branches. | Deferred UI |
| U09 | Compact rectangular payment-method control while changing awaiting-payment status. | Deferred UI; F01 functional editing remains priority |
| U10 | Date/time before IDs on receipts, sessions and analogous rows. | Partial day-first work integrated; remaining layout deferred |
| U11 | Compact report presets and This month on same row. | Deferred UI |
| U12 | Consistent button/stat heights following the Shift control. | Deferred UI |

| U13 | Expanded mobile Sales: Return/Print/Close one row, three status options one row, Cancel/Back alongside Update; Records at bottom; merge membership/attach controls. | Deferred UI; latest owner request recorded |
| U14 | Expanded sale header compact ID/status/actions with date/time below; evaluate double-click/long-press copy with accessible explicit alternative. | Deferred UI; latest owner request recorded |
| U15 | Collapsed mobile Sales: cashier and branch share receipt/time row, pipe separators, bold cashier. | Deferred UI; latest owner request recorded |

## Release and follow-through

1. Verified application release 02eecbe3 is deployed at 100%; migration 0134 preservation checks pass.
2. Check live Sales and duplicate preview, then perform requested supported duplicate merge with audit/undo.
3. Historical correction completed against the reviewed 65-column schema. Preserve immutable private manifest, audit proof and recovery limits; ambiguous fulfillment, driver and sale-link facts remain unresolved.
4. Continue deferred UI and resolve business/rights facts and Telegram rotation.

Detailed evidence: [takeover ledger](2026-09-07-codex-takeover.md), individual Git
commits, and private local `outputs/takeover-20260907/` reports. Local checks do not
stand in for deployment, and missing historical evidence is never fabricated.

## Stability release candidate and repair transport

- Public fix branch codex/release-stability-20260907 at 560bfbcbbc6730e9bba305bec6b70af752579ad9 contains only F41, F44 and F45, separate from F39/F40. GitHub pushed. Backend 280/280 passed; frontend 307/309 initially passed, two stale assertions corrected and focused rerun passed 3/3; both types, i18n, build and deploy dry-run passed. Initial attempt failed after asset upload; retry succeeded, independently confirmed as Worker03aa25a5 at100% at15:36:03UTC.
- F39/F40 independent review found post-commit finalizer errors, unknown first-request timeout handling, normal-budget confirmation regression, and whole-cluster workload-bound gaps. Corrections are integrated progressively; not yet certified or deployed. Complex multi-product clusters must be refused before any fold unless a reviewed whole-cluster plan fits the bound. Their eventual correction remains open.
- Three grouped historical execution attempts through the remote development proxy failed. Each full REST postcheck reports 44 pending, 0 applied, 0 audits, 0 violations across all 4,333 target rows. Private atomic file-import transport is being prepared with the same reviewed manifest and audit/full-row guards; no historical repair is claimed complete.

Historical import follow-through: fees-001 committed 99 Shop branch corrections. CLI exit 0 output framing caused a safe pause; independent postcheck-after-file-import.json confirms exact state and audits. No later group ran. Parsing correction and explicit resume remain; the completed group must be skipped.


## September 8 follow-through (17:15 UTC September 7)

- F39/F40: bounded merge and redo economics passed independent review. Browser proved 20 pairs complete under one confirmation and normal continuation, undo works, and close aborts preview. It also exposed an unknown-outcome reload cache bug; fix integrated as 3b48412c, independent review and browser rerun pending. Persisted whole-cluster preview economics remains active. No new production product merges beyond the original eight.
- F42: read-only production census found three shared canonical customer-phone groups, one same-name/phone candidate, two stale lookup keys, two duplicate supplier-name groups, and no normalized membership collision. These are candidates, not proof that people or businesses are identical. Existing contacts remain unchanged.
- F42 merge review found missing delivery expense references, non-atomic writes, incomplete membership lineage and frontend permission mismatch. Backend and permission fixes assigned separately. Existing membership IDs must be preserved; no destructive candidate cleanup until supported by evidence and safe execution.
- F43: seven phone input surfaces now have independently reviewed digit-preserving spacing, caret/paste, mobile beforeinput and IME handling. Membership display accurately marks assigned IDs read-only while preserving the legacy blank-ID path. Release gates remain.
- F46: Products Conflicts performs up to two requests and one dialog per selected pair. Decision: combined review for exact two-row pairs with per-pair stock decisions, bounded execution and truthful partial progress; runtime follows the current release freeze.
- Historical repair resume 2: eight fee groups applied (792 rows), 36 pending, nine exact audit records and zero full-row violations. Network failure stopped group nine; independent postcheck proved it pending before explicit resume 3.

## Historical correction completed — 2026-09-07 17:39 UTC

Guarded file-import resume 4 completed all remaining groups and the completion audit. Independent full REST postcheck-after-file-import-resume-4.json reports completed: 44 applied, 0 pending, 0 inconsistent; fees4255/sales22/sale_items56; 46 exact audit records; zero violations. Only proven branch metadata changed, with expected revision/audit effects. No stock quantities, financial amounts, driver assignments or legacy sale links were invented. Completed plans are terminal and the private operator refuses logical recovery after completion. Source manifest lineage02eecbe3; current application remains560bfbcb.

## Current remaining work — September 8 owner update

- **Ready for rollout:** Contacts canonical matching/import guards, seven phone-entry fields, membership preservation, atomic merge and permissions; bounded product merge execution/preview, accurate partial outcomes and redo economics. Independent reviews passed; migration0135 and deployment/live validation remain.
- **Production operations pending:** resume requested product duplicate merge after release; only eight cases have committed. Existing Contacts duplicates are reviewed candidates, not yet merged; distinct membership and weak supplier identity evidence remain blockers to destructive cleanup.
- **Active next slices:** F47 contact duplicate prompts; F48 shift difference/closing-cash report parity; F49 browser warning attribution; F50 form-label associations.
- **Planned, runtime not started:** F46 combined selected-conflict review and batching; larger/complex product cluster continuation; remaining modal minimize rollout and mobile UI U01–U15. Existing partial UI fixes remain recorded above.
- **Needs external facts/hardware:** actual phone camera test; ambiguous historical driver/sale-link provenance; supplier/customer identity evidence; registered business details/markets; image ownership; Telegram bot token rotation.
- **Completed data correction:** all proven historical Shop branch metadata targets, independently checked. No amounts or unknown relationships were invented.
- **Release policy:** continue verified incremental deployments as functional slices clear checks; keep each fix in its own descriptive commit. No periodic automation was created; this is the ongoing release workflow.

## Latest release and remaining work — September 8

- Deployedda5c8b02 at100%, Workera49ba8c2-1192-4700-b626-564a72e54938, deploymentce856f22-34dc-469c-b4f9-3aed1d6513ea. GitHub fix branch pushed. Fullbackend283/283; frontend313/314 then sole stale moved-code contract fixed and rerun passed; finalPOST bounds/migration/whitespace follow-ups independently passed focused checks. Types/i18n/build/dryrun passed. Frozenrealbrowser20cases in2requests underoneconfirmation, exactcosts/20audits/20history, Undo restoredonepair.
- Remote0135 addedtwoindexes only; before/afterhashes for59snapshot/233actionrows and421prior schemaobjects match,423after. Historicalrepairall44groups/46audits remainscomplete.
- Productionduplicate merge remains8completedcases. Browserconnector timedoutduringpostdeployverification; no additionalproductionmergeattempt.
- Nextrelease candidates: F48Telegramdifference/order/Closingcash (0180fa3e,3892711b) independentlyPASS; F50exactfourSaleslabelerrors (747d7f44) independentlyPASS; F47Cremovehidden suppliercreation (74c4a0ce), F47Dportalatomic signup (c87eb4ad), F51salesimportguards (8ceb2b9b) awaitingintegration/independentchecks. F47Amanual/POSexplicitcandidateprompts, F47Bcontactimportambiguity, F51sale lotownership/atomicallocations/POSbranchlotguards active.
- Stillplanned: F46combinedconflict review/batching, complex productclusters, remainingmobile UI/minimize rollout, branchCRUD/review/undo canonicalidentity enforcement, canonical Salesexportbreakdowns. Stillneedsfacts: historicaldriver/salelinks, contactidentity cleanup, phonecamera hardware, legalbusiness/markets/image rights, bottokenrotation.
- Session limit permits eight simultaneous subagents, not ten; bounded tasks run in waves.
