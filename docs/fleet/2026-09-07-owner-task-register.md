# Owner task register — September 7, 2026

This is the current request register. `progress.md` links here. Append new owner
requests and corrections; do not replace earlier requests or silently drop them.
Root owns prioritization, integration, evidence, and deployment claims.

Last reconciled: 2026-09-07T13:17:47.798Z. Functional fixes precede UI polish.
Current production: **02eecbe3833b**, Worker **c3a21a40-544b-4678-bacd-bc50441df8a1**, 100% at **2026-09-07 13:14:39 UTC**. Migration 0134 preserved all 15,106 existing Sales rows and prior schema objects. GitHub release branch pushed. F33/F36/F37/F38 now deployed. Live smoke and duplicate merge follow. Historical repair attempts committed no changes; all 4,333 targets matched their original snapshots and audits remained zero.

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
| F02 | Audit all historical sales with missing branch, Warehouse/multiple branches, or N/A driver. | Audit complete; Pending live / accounting, root | Census covered 15,096 sales and 36,340 lines. Proven null metadata repair prepared; ambiguous fulfillment/driver facts remain unresolved. |
| F03 | Enforce Shop-only sales; Warehouse stock must transfer first, including added lines, imports, replacements and generated sales. | Deployed 821efc94; recorded limitations retained | Backend enforcement and sibling parity tests integrated. |
| F04 | Stock-in session times out after 12 seconds. | Deployed 821efc94; recorded limitations retained | Session-specific 60-second transport, stable request identity, durable retry; no global timeout inflation. |
| F05 | Multiple products with multiple images each fail in one stock session, including encoded spaces/Khmer/percent filenames. | Deployed 821efc94; recorded limitations retained | Older build reproduced 409; identical retained 3-product/6-image request succeeded once on eb06b80b. Six asset GETs and product/gallery ownership passed. |
| F06 | Add/edit/create product images: upload, attach from Library, files, camera entry, and PWA draft lifecycle. | Deployed 821efc94; recorded limitations retained | Upload/Library associations and close/minimize/retry passed. Actual phone camera hardware was unavailable; do not claim a hardware test. |
| F07 | Library totals: physical storage, file quantities by type, correct usage and deletion protection. | Deployed 821efc94; recorded limitations retained | Physical counts unchanged by retry; covers and gallery usage correct. |
| F08 | Same barcode/leading zeros: scanner, search, same-session recognition and merge must use compatible identity. | Deployed 821efc94; recorded limitations retained | Guarded UPC/internal-code parity; do not strip meaningful arbitrary code zeros. |
| F09 | Merge cost uses distinct nonzero available costs; highest retail/wholesale prices; preserve stock/relations/audit/undo. | Implementation deployed 821efc94; production merge pending / identity, root | 1,600 synthetic folds in 64 requests; retry mean remains fixed, changed source refuses retry. |
| F10 | Run the production duplicate merge; one confirmation, bounded progress, faster saves. | Pending live / root | Signed-in production browser ready. Run supported reviewed route after deployment; record actual counts and undo IDs. |
| F11 | Detect duplicate barcode OR name added earlier in the same session, including queued/saved lines; otherwise green only after resolved lookup. | Deployed 821efc94; recorded limitations retained | Session identity and duplicate parity tests integrated; explicit quantity edit preserved. |
| F12 | Gross sales, discounts, refunds and revenue must agree across Dashboard chart, headline, Sales, Inventory and reports. | Deployed 821efc94; recorded limitations retained | Tested gross 200, total discount 15, net 185; raw item-discount basis corrected. |
| F13 | Credit is positive “Credit $n”, recognized in revenue and profit (N39). | Deployed 821efc94; recorded limitations retained | Credit/revenue parity and report tests integrated. |
| F14 | Shift registration is report-only and close always works (N37). | Deployed 821efc94; recorded limitations retained | Real route tests; blank and explicit zero are different; invalid values rejected without blocking legitimate close. |
| F15 | Shift report compares registered opening/end USD and KHR; unknown stays unknown (N38). | Deployed 821efc94; recorded limitations retained | Migration 0132 conservatively treats ambiguous legacy zero as unknown; report/Telegram tests passed. |
| F16 | Shift Report is its own selectable report view with export, not an extra block in overview. | Deployed 821efc94; recorded limitations retained | Final browser smoke includes selection/export. |
| F17 | Concise Telegram reports (N42). | Deployed 821efc94; recorded limitations retained | Bilingual composed payloads, day-first dates and concise report tests passed; no live messages sent. |
| F18 | Delivery accounting clearly explains customer charge, actual courier cost, store-paid portion and contribution without double deduction. | Deployed 821efc94; recorded limitations retained | Financial parity verified; negative contribution can represent store subsidy. |
| F19 | Expenses generated by sales show a sale link; branch is Shop; manual expenses need no sale ID. | Implementation deployed 821efc94; historical correction pending / root | Existing unlinked legacy fees lack proof of a sale relationship. Never invent links; proven branch metadata correction prepared. |
| F20 | Records line belongs INSIDE expanded sale details, not the collapsed row (latest correction to N41). | Deployed 821efc94; recorded limitations retained | Browser placement, single dialog and return-to-detail flow passed. |
| F21 | Records includes actor/time, status, products/quantity, payments, delivery fee and actual cost with readable before/after detail. | Records deployed 821efc94; future snapshots F33 pending / sales | Structured detail/integrity tests pass. Unknown/pruned provenance is explicit; retained replay history survives both clear paths. Sales list D1 failure is F34. |
| F22 | Customer delivery fee and actual delivery cost are separately editable and recorded. | Deployed 821efc94; conversion F32 deployed c475e637 / sales | Fee changes customer total; actual cost does not. No-delivery conversion is F32. |
| F23 | Dashboard low/out lists load more at the bottom and reset on leaving. | Deployed 821efc94; recorded limitations retained | Desktop and 375px scroll 10→20 and leave/reenter reset passed. |
| F24 | Total stock alerts use Shop+Warehouse; branch pages/POS branch options use individual branch stock. | Deployed 821efc94; recorded limitations retained | Pure aggregate/branch tests; alert setting events refresh Dashboard, POS and Branches. |
| F25 | Permissions/roles fully scoped across add/edit/session/images, review, imports, bulk, offline and undo. | Deployed 821efc94; recorded limitations retained | Synchronous matrix through 96abe402 and Queue authority through 1aae81d3 independently certified, including races, cancellation and current-role checks. Combined first-release sweep passed. |
| F26 | Dismiss offline/update notifications with X without hiding failed saves or lying about connectivity. | Deployed 821efc94; recorded limitations retained | Dismissal helper and App integration complete; reconnect/error behavior retained. |
| F27 | Remove redundant eye next to Print in sales rows. | Deployed 821efc94; recorded limitations retained | Browser row access remains; Actions shows Print only. |
| F28 | Take over Claude lanes, commits, dirty/unverified work and progress sessions. | Deployed 821efc94; recorded limitations retained | Twenty-lane lineage and shared patch inventory preserved; original dirty worktrees untouched. |
| F29 | Remove duplicate delivery_actual_cost_usd field and rejected stopgap kind comment in Sales merge fallout. | Deployed 821efc94; recorded limitations retained | Source/type/parity gates cover composed Sales. |
| F30 | Finish earlier N18/N21/N23 and N28–N36/audit lanes without losing their fixes. | Deployed 821efc94; recorded limitations retained | Canonical ea9f0d1b base includes checkpoint 2 and earlier integrations; individual follow-up fixes retained. |
| F31 | GitHub commits describe individual fixes, not checkpoint/batch commits. | Public fix commits pushed through c475e637 / lineage, root | Separate public release history preserves messages/authors; eight internal reports excluded, required clean test fixture retained. Pushed release branch at 821efc94. |
| F32 | Sale originally without delivery allows later driver, customer fee and actual cost. | Deployed c475e637 / sales | Full backend 276 suites; all frontend 306 files covered; independent money/migration review and browser actual retry/driver/totals/Records passed. |
| F33 | Preserve original basket, payments, driver and actor for future sales. | Deployed 02eecbe3; live follow-through active | Four writers, migration 0134, backup and immutable Records independently pass; original basket/payment remain unchanged after later edits in browser. Backend 278/278 pass. |
| F34 | Sales list/detail Records SQL failed in real D1. | Deployed 821efc94 / sales | Frozen actual Worker list/detail now 200; count and compound ordering repaired. |
| F35 | Fast Stock minimize restored wrong host and consumed the chip. | Deployed 821efc94 / media | Exact user5 frozen browser restore passed; preserves draft and consumes only after modal mounts. |
| F36 | Sales read retry/deadline/cache cancellation and visible manual Retry after failure. | Deployed 02eecbe3; live follow-through active | Frozen 5ec39289 browser: one request aborted at 20s, visible Retry, one manual retry succeeds; late responses never overwrite data or navigation. |
| F37 | Duplicate preview times out on large catalogs because it queries stock/batches/cost per group. | Deployed 02eecbe3; live follow-through active | Independent real route 2,000 groups uses 43 reads instead of roughly 6,000; merge rules, prices and blockers preserved. |
| F38 | Immediately recording payment after changing Completed to Credit reports a false other-device conflict. | Deployed 02eecbe3; live follow-through active | 9d707f1d carries exact committed status version into payment review; real concurrent-write protection and typed tender values retained. |

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

## Release and follow-through

1. Verified application release 02eecbe3 is deployed at 100%; migration 0134 preservation checks pass.
2. Check live Sales and duplicate preview, then perform requested supported duplicate merge with audit/undo.
3. Historical correction remains unapplied after remote batch failures. Re-census and re-pin the 65-column schema before a reviewed bounded repair; never reuse the obsolete 64-column bundle.
4. Continue deferred UI and resolve business/rights facts and Telegram rotation.

Detailed evidence: [takeover ledger](2026-09-07-codex-takeover.md), individual Git
commits, and private local `outputs/takeover-20260907/` reports. Local checks do not
stand in for deployment, and missing historical evidence is never fabricated.
