# Current task status
Updated: 2026-09-09T09:30:00Z
Release `3b98fc1a` is live at Worker version `fb2aa5c4-22ec-4de5-ab32-806de9fce7dd` (deployment `8bfacf42-bd8b-4e62-9d61-1c4f2c7ddf51`, 100%). Owner correction is applied: Not Paid/awaiting_payment deducts stock exactly once. The guarded recovery corrected four lines across sales 16952/16953/16954 after backup; completed sale 16951 remains unchanged. Mutation timeout handling (45 seconds with unknown outcomes) and Khmer write-error presentation are deployed.

## F01: Completed sale changed back to awaiting payment must allow authorized payment method, amount, item and delete/correction actions.

Status: Deployed
Next: Earlier browser checks passed; normal production follow-through remains. Browser access is available again.
Notes: Sales correction and scope tests; final release smoke.

## F02: Audit all historical sales with missing branch, Warehouse/multiple branches, or N/A driver.

Status: Repair complete; evidence gaps open
Next: 2 ambiguous mixed/Warehouse sales,21 unknown drivers,4282 unlinked legacy fees and6 zero-item sales need evidence.
Notes: Census covered 15,096 sales and 36,340 lines. Proven null metadata repair prepared; ambiguous fulfillment/driver facts remain unresolved.

## F03: Enforce Shop-only sales; Warehouse stock must transfer first, including added lines, imports, replacements and generated sales.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Backend enforcement and sibling parity tests integrated.

## F04: Stock-in session times out after 12 seconds.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Session-specific 60-second transport, stable request identity, durable retry; no global timeout inflation.

## F05: Multiple products with multiple images each fail in one stock session, including encoded spaces/Khmer/percent filenames.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Older build reproduced 409; identical retained 3-product/6-image request succeeded once on eb06b80b. Six asset GETs and product/gallery ownership passed.

## F06: Add/edit/create product images: upload, attach from Library, files, camera entry, and PWA draft lifecycle.

Status: Deployed
Next: Actual phone-camera hardware validation remains.
Notes: Upload/Library associations and close/minimize/retry passed. Actual phone camera hardware was unavailable; do not claim a hardware test.

## F07: Library totals: physical storage, file quantities by type, correct usage and deletion protection.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Physical counts unchanged by retry; covers and gallery usage correct.

## F08: Same barcode/leading zeros: scanner, search, same-session recognition and merge must use compatible identity.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Guarded UPC/internal-code parity; do not strip meaningful arbitrary code zeros.

## F09: Merge cost uses distinct nonzero available costs; highest retail/wholesale prices; preserve stock/relations/audit/undo.

Status: Implementation deployed; execution partial
Next: Continue only from a fresh authenticated duplicate preview.
Notes: 1,600 synthetic folds in 64 requests; retry mean remains fixed, changed source refuses retry.

## F10: Run the production duplicate merge; one confirmation, bounded progress, faster saves.

Status: 174 merges recorded;1774 eligible remain
Next: Last fresh preview: 1,793 groups / 1,812 candidates, 19 quarantined groups, 1,774 eligible merges. 174 historical merges recorded, including 166 verified this run. Recovery and two-read optimization deployed; remaining cleanup not executed yet.
Notes: Prior action IDs318–325 retained. The new global conflict workflow is live under F65; no claim that the entire duplicate catalog has been merged.

## F11: Detect duplicate barcode OR name added earlier in the same session, including queued/saved lines; otherwise green only after resolved lookup.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Session identity and duplicate parity tests integrated; explicit quantity edit preserved.

## F12: Gross sales, discounts, refunds and revenue must agree across Dashboard chart, headline, Sales, Inventory and reports.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Tested gross 200, total discount 15, net 185; raw item-discount basis corrected.

## F13: Credit is recognized in revenue and profit (N39); latest visible wording overridden by F44 Not Paid / ប្រាក់ជំពាក់.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Credit/revenue parity and report tests integrated.

## F14: Shift registration is report-only and close always works (N37).

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Real route tests; blank and explicit zero are different; invalid values rejected without blocking legitimate close.

## F15: Shift report compares registered opening/end USD and KHR; unknown stays unknown (N38).

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Migration 0132 conservatively treats ambiguous legacy zero as unknown; report/Telegram tests passed.

## F16: Shift Report is its own selectable report view with export, not an extra block in overview.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Final browser smoke includes selection/export.

## F17: Concise Telegram reports (N42).

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Bilingual composed payloads, day-first dates and concise report tests passed; no live messages sent.

## F18: Delivery accounting clearly explains customer charge, actual courier cost, store-paid portion and contribution without double deduction.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Financial parity verified; negative contribution can represent store subsidy.

## F19: Expenses generated by sales show a sale link; branch is Shop; manual expenses need no sale ID.

Status: Implemented; proven branch repair complete
Next: Do not invent missing legacy sale links.
Notes: Existing unlinked legacy fees lack proof of a sale relationship. Never invent links; proven branch metadata correction prepared.

## F20: Records line belongs INSIDE expanded sale details, not the collapsed row (latest correction to N41).

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Browser placement, single dialog and return-to-detail flow passed.

## F21: Records includes actor/time, status, products/quantity, payments, delivery fee and actual cost with readable before/after detail.

Status: Expanded core Records deployed; remaining writers tracked in F74
Next: Changed-only typed EN/KM core history live21d22fc. Return-create and wider contact/payment reference cascades remain separate.
Notes: Structured detail/integrity tests pass. Unknown/pruned provenance is explicit; retained replay history survives both clear paths. Sales list D1 failure is F34.

## F22: Customer delivery fee and actual delivery cost are separately editable and recorded.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Fee changes customer total; actual cost does not. No-delivery conversion is F32.

## F23: Dashboard low/out lists load more at the bottom and reset on leaving.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Desktop and 375px scroll 10→20 and leave/reenter reset passed.

## F24: Total stock alerts use Shop+Warehouse; branch pages/POS branch options use individual branch stock.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Pure aggregate/branch tests; alert setting events refresh Dashboard, POS and Branches.

## F25: Permissions/roles fully scoped across add/edit/session/images, review, imports, bulk, offline and undo.

Status: Existing fixes deployed; F55 open
Next: New offline ownership/recovery issue has a separate reviewed plan.
Notes: Synchronous matrix through 96abe402 and Queue authority through 1aae81d3 independently certified, including races, cancellation and current-role checks. Combined first-release sweep passed.

## F26: Dismiss offline/update notifications with X without hiding failed saves or lying about connectivity.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Dismissal helper and App integration complete; reconnect/error behavior retained.

## F27: Remove redundant eye next to Print in sales rows.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Browser row access remains; Actions shows Print only.

## F28: Take over Claude lanes, commits, dirty/unverified work and progress sessions.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Twenty-lane lineage and shared patch inventory preserved; original dirty worktrees untouched.

## F29: Remove duplicate delivery_actual_cost_usd field and rejected stopgap kind comment in Sales merge fallout.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Source/type/parity gates cover composed Sales.

## F30: Finish earlier N18/N21/N23 and N28–N36/audit lanes without losing their fixes.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Canonical ea9f0d1b base includes checkpoint 2 and earlier integrations; individual follow-up fixes retained.

## F31: GitHub commits describe individual fixes, not checkpoint/batch commits.

Status: Individual fix commits pushed
Next: Latest live4495bccf branch is pushed; runtime fixes retain individual commits. Subsequent candidates remain separate until release.
Notes: Each runtime fix retained separately on release branches; private reports excluded.

## F32: Sale originally without delivery allows later driver, customer fee and actual cost.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Full backend 276 suites; all frontend 306 files covered; independent money/migration review and browser actual retry/driver/totals/Records passed.

## F33: Preserve original basket, payments, driver and actor for future sales.

Status: Deployed
Next: Earlier browser checks passed; normal production follow-through remains. Browser access is available again.
Notes: Four writers, migration 0134, backup and immutable Records independently pass; original basket/payment remain unchanged after later edits in browser. Backend 278/278 pass.

## F34: Sales list/detail Records SQL failed in real D1.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Frozen actual Worker list/detail now 200; count and compound ordering repaired.

## F35: Fast Stock minimize restored wrong host and consumed the chip.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Exact user5 frozen browser restore passed; preserves draft and consumes only after modal mounts.

## F36: Sales read retry/deadline/cache cancellation and visible manual Retry after failure.

Status: Deployed
Next: Earlier browser checks passed; normal production follow-through remains. Browser access is available again.
Notes: Frozen 5ec39289 browser: one request aborted at 20s, visible Retry, one manual retry succeeds; late responses never overwrite data or navigation.

## F37: Duplicate preview times out on large catalogs because it queries stock/batches/cost per group.

Status: Deployed
Next: Large-catalog preview fixed; fresh production merge remains pending.
Notes: Independent real route 2,000 groups uses 43 reads instead of roughly 6,000; merge rules, prices and blockers preserved.

## F38: Immediately recording payment after changing Completed to Credit reports a false other-device conflict.

Status: Deployed
Next: Payment update carries the committed status version.
Notes: 9d707f1d carries exact committed status version into payment review; real concurrent-write protection and typed tender values retained.

## F39: Live bulk merging remains about eight seconds per case and fails on database overload.

Status: Improved merge implementation deployed; production follow-through open
Next: F46 and F65 are live. Remaining production duplicate execution is tracked under F10; measure current real behavior during that reviewed run.
Notes: Eight commits preceded an 87.3s request failure. Inspect serial D1 round trips and invocation limits; preserve atomic cases, undo and whole-cluster cost mean.

## F40: Bulk merge error falsely says data not saved after partial commits.

Status: Deployed
Next: Production continuation requires fresh authenticated review.
Notes: Return/reconcile committed cases and undo IDs on failure; explicit resumable partial state, no blind retry.

## F41: Idle import polling writes to D1 and immediate retries amplify database overload.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Skip no-op reaper writes when no stale jobs exist; preserve guarded stale recovery. Fail overload once instead of immediately retrying it.

## F42: Contacts duplicates: supplier creation in stock sessions, raw versus spaced customer phone numbers, obsolete membership IDs; inspect existing fixes before correction.

Status: Fresh contact census complete; guarded cleanup pending
Next: 2 supplier name-only clusters (10/6members);14newerrows have no countedlinks. Customer triple23907/25000/25001 has differentmembershipIDs. No blindidentitymerge;2stalephonekeys needguardedrepair. No deliveryduplicatecluster.
Notes: Explicit manual/POS choices integrated at c09c707a, final gates/browser pending. Existing ambiguous memberships/contacts require reviewed identity evidence.

## F43: Contact phone entry automatically spaces digits as typed; formatted display and canonical matching must agree.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Progressive spacing, prefixes, paste and caret covered in seven create/edit/quick-add fields.

## F44: Latest owner correction: visible Credit / ឥណទាន becomes Not Paid / ប្រាក់ជំពាក់ everywhere.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Supersedes N39/F13 unpaid-state wording. Internal values/accounting unchanged; distinct Store Credit, supplier credit and overpayment concepts preserved.

## F45: Investigate failed admin WebSocket and reported content.js/VM listener/startTime errors.

Status: WebSocket fixed; VM attribution open
Next: Anonymous startTime source remains unproven.
Notes: Cooldown lacked wake-up and actual logout did not disconnect. Both corrected. content.js listener is extension noise; VM startTime ownership unproven.

## F46: Combined selected-conflict review and bounded merge.

Status: Deployed; independent version verified100%
Next: Livebfd16f0d. Focused/native/full gates passed;0136/0137 schema applied with unchanged stock/history assertions. Remaining large N-group merge/direct Remove is F65, not included.
Notes: Independent SQLite/source checks passed, but real11-case preview fails before writes. Migration0136 not deployed.

## F47: Prevent and clearly prompt about existing customers, suppliers and delivery contacts across add/create/edit/quick-add/import/session surfaces; distinguish reuse from intentional creation.

Status: Guards deployed; legacy cleanup open
Next: Preserve existing reuse/separate choices and backend guards. Fresh legacy census and identity repair tracked under F42.
Notes: Explicit reuse/separate choices, phone/name/membership guards, reviewed snapshots, import targets, atomic new-customer signup and no hidden supplier creation. Exact browser passed; unrelated failed saves remain visible.

## F48: Shift difference must show when supported across Telegram, reports and history; Closing cash / សាច់ប្រាក់បិទវេន; Not Paid / ប្រាក់ជំពាក់; use owner's supplied concise report arrangement.

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Each known currency difference is shown even under review; missing inputs remain unknown. Requested section order and Closing cash labels are pinned.

## F49: Attribute Protected Audience, Shared Storage and StorageType.persistent deprecation warnings and fix actual app use.

Status: Unresolved attribution
Next: No matching app use reproduced; identify exact warning source.
Notes: No matching app API use found in source or clean-browser warnings. Exact reported third-party/extension source remains unproven; no suppression.

## F50: Correct unassociated form labels (browser reports four resources).

Status: Deployed
Next: No new implementation pending for the verified scope.
Notes: Sales custom-export flow now has zero unassociated labels in the clean-browser check. Other forms remain separate follow-up candidates.

## F51: Enforce owner-confirmed canonical Shop/Warehouse and product/branch/lot identity across every writer; retain daily prompt/report-only cash and Not Paid revenue.

Status: Deployed
Next: Shop-only sale authority, two canonical branches and lot checks retained.
Notes: CRUD/review/undo/reset and Warehouse→Shop transfer guards, disabled sale-side Warehouse, stale-lot checks, authoritative general/dated/sales imports, and canonical export buckets passed independent and combined checks. Historical unknown identities are not silently repaired.

## F52: Investigate negative revenue/profit accuracy.

Status: Production census complete; causes and repairs open
Next: Global/report buckets positive.142 sale profit negatives,100 product losses,30 negative KHR discount cells,5 zero-item/4 zero-subtotal-with-items sales and2 refunds on cancelled sales flagged.21 negative delivery margins require context. No orphan return items/excess returned quantities. Signed change may bevalid; preserve evidence and investigate withoutclamping.
Notes: No formula defect established. Preserve genuine losses; never clamp or invent money.

## P01: Privacy, Terms and Cookie policies; footer policy button reachable at page bottom.

Status: Deployed
Next: Policies and footer are live.
Notes: Reader routes, footer, focus/history/title/scroll behavior verified.

## P02: Determine cookie consent needs; form consent and durable policy version/time/locale.

Status: Deployed; legal facts open
Next: Consent controls live; applicable obligations depend on confirmed markets/business facts.
Notes: Optional map/AI/share consent controls and server enforcement; migrations 0130/0131 required. No claim of universal legal compliance.

## P03: Minimize collected data; inspect analytics/third-party embeds.

Status: Deployed
Next: Initial public load and optional embed consent checked.
Notes: Initial public load has no third-party requests/embeds; map revocation unloads; raw session identifiers removed; HMAC secret needed at release.

## P04: Accessible public site: alt text, contrast, keyboard forms, clear buttons and small-screen heading.

Status: Deployed
Next: Small-screen, keyboard, alt-text and contrast fixes verified within tested surfaces.
Notes: 375px heading one line/no overflow; modal focus/inert/scroll checks and UI fixes passed.

## P05: Remove fake reviews/unsupported claims and review image copyright.

Status: Mostly first-party photography, per owner
Next: Confirm exceptional third-party assets and retain their provenance.
Notes: No invented reviews/claims added. Existing image ownership/license cannot be proven from a file alone; keep this risk visible.

## P06: Add truthful business details; check applicable local law and flag risks.

Status: Business facts needed
Next: Registered legal identity, registration, email and target markets unconfirmed.
Notes: Trade name/address/phone verified. Registered legal identity, registration, email and target markets remain unconfirmed; Cambodia sources and conditional foreign-market risks documented privately.

## P07: Configuration security findings discovered during takeover.

Status: Owner reports token rotated
Next: Dated independent evidence not located; no repeat rotation requested.
Notes: Dedicated portal HMAC configured and malformed binding removed previously. Owner reports Telegram token already rotated; do not repeat rotation based on stale notes. No credential values retained here.

## U01: Improve small-screen main/subpage back navigation and remove the large empty bottom gap.

Status: Not started
Next: Small-screen navigation/back-gap layout.


## U02: Add icons to subpage navigation.

Status: Deferred to later checkpoint by owner
Next: Preserve reviewed plans; urgent sales/POS and transfer take priority. Add appropriate mobile subpage icons consistently after urgent sale integrity fix.


## U03: Reports centered with safe edge gutters, larger readable text, consistent larger filter button.

Status: Core deployed; polish open
Next: Final mobile visual review.


## U04: Compact Shift button with stats/actions; move export beside section title or near small-screen page title without crowding notifications.

Status: Core deployed; arrangement open
Next: Remaining mobile Shift/Export placement.


## U05: One highlighted Not Paid row; positive total/final profit green.

Status: Deployed4e576eaa
Next: Positive profit highlighting corrected.
Notes: Selected headline contrast corrected; no accounting changes.

## U06: Receipt Item/Qty/Price/Total headings English by default, including mixed English/Khmer setting.

Status: Deployed
Next: English Item/Qty/Price/Total receipt headings.


## U07: Add minus next to Close for edit/add/set/stock/session actions; Back/discard/minimize must cooperate with scoped drafts.

Status: Partly deployed
Next: Fast Stock and per-product Add/Remove/Set close/minimize behavior is deployed under F66/F67. Remaining broader modal/draft coverage is still open.


## U08: Compact Start/End dates; default entire days 00:00–23:59 without extra selector; align with stats/actions across Dashboard/Sales/Expenses/Returns/Branches.

Status: Not started
Next: Compact full-day date controls aligned with stats/actions.


## U09: Compact rectangular payment-method control while changing awaiting-payment status.

Status: Not started
Next: Compact payment-method button.


## U10: Date/time before IDs on receipts, sessions and analogous rows.

Status: Partly deployed
Next: Complete remaining date/time-before-ID lists.


## U11: Compact report presets and This month on same row.

Status: Not started
Next: Compact report presets.


## U12: Consistent button/stat heights following the Shift control.

Status: Not started
Next: Consistent button/stat heights.


## U13: Expanded mobile Sales: Return/Print/Close one row, three status options one row, Cancel/Back alongside Update; Records at bottom; merge membership/attach controls.

Status: Deployed73fd7dc1
Next: Verified checkpoint at100% traffic; no migration.


## U14: Expanded sale header compact ID/status/actions with date/time below; evaluate double-click/long-press copy with accessible explicit alternative.

Status: Deployed73fd7dc1
Next: Verified checkpoint at100% traffic; no migration.


## U15: Collapsed mobile Sales: cashier and branch share receipt/time row, pipe separators, bold cashier.

Status: Deployed73fd7dc1
Next: Verified checkpoint at100% traffic; no migration.


## F53: Permission refresh intent and session isolation.

Status: Deployed4e576eaa
Next: Permission refresh coalescing and session-generation isolation.
Notes: Independent event/debounce/logout race checks passed; backend authority unchanged.

## F54: Shared HTTP cache invalidation and server precedence.

Status: Deployed4e576eaa
Next: Shared HTTP cache scope only; persistent mirror callbacks remain separate.
Notes: 69 focused tests and512 timing schedules; callback-side persistent mirror effects remain outside scope.

## F55: Preserve and scope pending offline work across accounts/runtime changes

Status: Paused by owner
Next: Preserve prior plan and pending offline work. Do not implement offline redesign in the current wave.
Notes: No production loss or backend authorization bypass demonstrated.

## F56: Prevent stale expense edits and false success after concurrent deletion

Status: Deployed73fd7dc1
Next: Verified checkpoint at100% traffic; no migration.
Notes: c851dba8 source includes null/absent/versioned deletion handling.

## F57: Protect promotion images and display their Library references

Status: Deployed; independent version verified100%
Next: Livebfd16f0d. Focused/native/full gates passed;0136/0137 schema applied with unchanged stock/history assertions. Remaining large N-group merge/direct Remove is F65, not included.
Notes: Frontend reference display ready; no promotion rewiring.

## F58: Reduce unnecessary frontend chunk loading

Status: Deployed73fd7dc1
Next: Verified checkpoint at100% traffic; no migration.
Notes: Zero static chunk cycles. Asset-size improvements are not a measured user-latency claim.

## F59: Use owner-supplied Khmer actual delivery cost labels

Status: Deployed73fd7dc1
Next: Verified checkpoint at100% traffic; no migration.
Notes: Only these two terms are approved for code changes.

## F60: Review all English/current Khmer wording and provide Excel proposals

Status: Workbook delivered; explicit owner edits deployed
Next: 11 source wording updates applied; untouched proposals remain unapproved.
Notes: Workbook delivered with 6145 source entries. Eleven explicit owner-edited source wording changes were deployed; untouched proposed translations remain unapproved.

## F61: Stock-positive POS product blocked by received-date picker; branch choices missing

Status: Stock remainder and lot coverage fixes deployed; branch screenshot follow-through open
Next: Inactive positive lots count toward known stock; missing coverage fails closed. Original missing branch-step observation still needs production follow-through.


## F62: Save still leads to Back/Discard prompt

Status: Deployed
Next: Verified in a5a4162f; retain normal production follow-through.


## F63: Reset revoked device history so it can request approval again

Status: Deployed
Next: Verified in a5a4162f; retain normal production follow-through.


## F64: Existing-product add/create session needs barcode scanner

Status: Deployed
Next: Verified in a5a4162f; retain normal production follow-through.


## F65: Conflict Merge/Remove actions and owner-defined field rules

Status: Deployed; production duplicate execution still open
Next: Global review, N-member merge and independent Remove deployed at4495bccf (runtime sourcea5702d49). Fresh production preview and owner field choices needed before remaining authorized merges; no1600-row execution claim.


## F66: Stock actions: X closes with Discard / Back / Minimize; minus preserves directly

Status: Deployed
Next: Fast Stock and per-product X/Discard/Back/Minimize separation, scoped draft restore and failed-attempt preservation verified.


## F67: Add/Remove/Set quantity labels, signed delta, before/after and reason

Status: Deployed
Next: Add/Remove signed quantity and Set target total with before/after, signed difference and reason verified.


## F68: iOS PWA responsive containment with left/right margins across pages/dialogs

Status: Deferred to later checkpoint by owner
Next: Preserve reviewed plans; urgent sales/POS and transfer take priority. Video shows stock-change list/dialog clipped on right; assess viewport scale, input autozoom, widths and keyboard. Fix admin PWA fit and requested zoom behavior; test margins and controls at mobile widths.


## F69: Shop to Warehouse transfer fails; both canonical transfer directions must work with branch/lot identity and permissions

Status: Deployed
Next: Shop↔Warehouse, reverse Undo/Redo and strict explicit-lot race rollback passed. Warehouse sales remain prohibited. Retry receipt gap is tracked separately as F73.
Notes: Owner request with screenshot codex-clipboard-ef24b217-5a3e-4e63-891f-6c047e236707.png; previous tasks retained.

## F70: Products name/barcode search is too slow

Status: Indexed lookup improvement deployed; production latency follow-through open
Next: Same tested sibling results via existing name_key index. Local5,000-product benchmark improved; this is not a measurement of whole production search latency.
Notes: Owner request with screenshot codex-clipboard-ef24b217-5a3e-4e63-891f-6c047e236707.png; previous tasks retained.

## F71: Library image search is too slow

Status: Deployed; independent version verified100%
Next: Livebfd16f0d. Focused/native/full gates passed;0136/0137 schema applied with unchanged stock/history assertions. Remaining large N-group merge/direct Remove is F65, not included.
Notes: Owner request with screenshot codex-clipboard-ef24b217-5a3e-4e63-891f-6c047e236707.png; previous tasks retained.

## F72: Sale customer Edit only: anonymous General stays anonymous; phone-first actual-contact assignment and scoped customer/membership edits

Status: Deployed; confirmed General repair applied
Next: 24969 marker1 at2026-09-09 01:52:30; 5 sales/1 return retained.22305 marker0 and152 sales unchanged. History535/audit4466. Physical-device follow-through remains.
Notes: Latest owner instruction supersedes earlier replacement menu. Prior617135b7 is not approved unchanged. Preserve exact sale+linked-return attribution and unrelated customer transactions.

## U16: Reports compact filters and navigation per owner screenshot

Status: Deployed
Next: Report selector inside white filters, smaller Show, USD default, simplified choices, no redundant summary, horizontal breakdown tabs, contained filter styles. Reset persists across reload. Chromium phone/desktop layout and keyboard verified; physical iOS remains open under U20.
Notes: Owner request with screenshot codex-clipboard-ef24b217-5a3e-4e63-891f-6c047e236707.png; previous tasks retained.

## U17: Sales plain-text colored statuses and compact print/actions column

Status: Deployed
Next: Plain EN/KM highlighted badges, one compact print/column-chooser column; header/data/loading parity independently verified.
Notes: Owner request with screenshot codex-clipboard-ef24b217-5a3e-4e63-891f-6c047e236707.png; previous tasks retained.

## U18: Branch product section has redundant actions column

Status: Deployed
Next: Desktop Actions column removed; compact product-cell menu retains merged-member Detail/Adjust/Catalog. Mobile actions retained.
Notes: Owner request with screenshot codex-clipboard-ef24b217-5a3e-4e63-891f-6c047e236707.png; previous tasks retained.

## U19: Transfer reference should show only TRF identifier

Status: Deployed
Next: Only TRF reference shown; redundant Transfer badge/subline removed; date, tooltip and navigation preserved.
Notes: Owner request with screenshot codex-clipboard-ef24b217-5a3e-4e63-891f-6c047e236707.png; previous tasks retained.

## U20: Responsive layout in iOS PWA and desktop device-toolbar emulation

Status: Open; verify affected surfaces
Next: Verify viewport containment, side margins, compact filters and horizontal tabs at phone and desktop widths; distinguish app defects from browser tooling problems.
Notes: Owner request with screenshot codex-clipboard-ef24b217-5a3e-4e63-891f-6c047e236707.png; previous tasks retained.

## F73: Transfer retries lack server receipt deduplication and audit is after stock writes

Status: Transfer stock-limit fix deployed; broader durability remains open
Next: Livecap uses min selectedlot/source aggregate, rejects nonfiniteavailability. AdminUI Shop→Warehouse options verified without movingstock. Employee inventory/branches remain absent; preserve full F73 durability WIP.
Notes: Found during independent F69 review; not introduced by symmetric transfer fix.

## F74: Specific, change-driven Sales Records with complete EN/KM labels and before/after for driver, delivery cost/fee, product add/remove/replace/quantity, customer/General/membership, status and payment

Status: Core Records and atomic return creation deployed; wide cascades paused
Next: 0142 return-create is live in1791eaf7. Wide reference cascades remain paused at7716f5e2; foundation26519d0e and carry patch preserved for later work.
Notes: Owner wants concise summaries with expandable detailed changes, not all possible fields on every record.

## P08: Coordinated LeangBeauty storefront follow-up: sticky compact search/filter, social/footer/policy links, FAQ, readable product detail, gallery and refresh guards; admin scroll control

Status: Deferred to later checkpoint by owner
Next: Preserve reviewed plans; urgent sales/POS and transfer take priority. Integrate reviewed public-site work against current live, refine compact storefront/customer portal design and retain accessibility/privacy behavior.
Notes: User explicitly authorized cross-session coordination; peer task01a08132-97e8-7301-9427-915a91fc9f9b, worktree bos-leang-redesign-20260908.

## F75: Employee individual Sales/POS actions including cancellation and status changes; all changes recorded. Multi-select, bulk, import and export disabled by default.

Status: Deployed; existing Employee role updated and audited
Next: Live1791eaf7 and role3 verified: original11 keys preserved plus five Sales/Returns denials, audit4299; users3/4 overrides unchanged. Local deployed permission-kernel check passes for both. Already-open Employee phone session remains untested.


## F76: Employees should not see Contacts invoices or detailed purchase history, especially suppliers; customer search in Sales remains available.

Status: Deployed
Next: Contacts financial privacy and bounded Sales/POS picker are live. Review-tier Contacts stays restricted; supplier access remains off. No employee phone session was used for post-deploy smoke.


## U21: Invoice formats and designs should follow the Sales report section/subpage.

Status: Deployed and independently verified
Next: Live21d22fc at100%. Actual component EN/KM browser checks320/375/390/1280 passed; no physical-device claim.


## U22: Compact mobile Sales metadata: sale ID, time, branch and cashier together; customer phone and delivery together with driver name directly, without Driver label.

Status: Deployed and independently verified
Next: Live21d22fc at100%. Actual component EN/KM browser checks320/375/390/1280 passed; no physical-device claim.


## U23: Receipt payment methods directly beside Paid, e.g. Paid: ABA or Paid: ABA + Cash; remove separate method row.

Status: Deployed and independently verified
Next: Live21d22fc at100%. Actual component EN/KM browser checks320/375/390/1280 passed; no physical-device claim.


## F77: Urgent: sales show charged totals but zero item rows; repair receipt 20260909-101913 and other affected sales, preserve delivery/receipt totals, and prevent partial sale creation.

Status: Corrected and deployed
Next: Continue ordinary Sales/POS browser smoke when available; keep the recovery target immutable and do not rerun it. Broader historical mixed-branch/driver evidence remains open under F02/F03.
Notes: Atomic sale creation prevention is deployed. The signed-in Admin panel backed up and applied `sale-not-paid-stock-recovery-20260909-v1` once: four quantity-one `sale` movements were created for 16952/16953/16954; all four allocations are unreleased; 16951's existing 36-unit movement remains exactly once. Postflight item counts are 1/2/1 with revisions 10/7/4; product stock is 859=0, 409=8, 3490=2, 5370=6. Headers, totals and delivery data were preserved. Three recovery members and one backup receipt exist; no repeat guard was created. Records show the correction action in EN/KM.

## F78: Translate write failures and timeouts into Khmer; fix settings and other writes timing out after12s

Status: Deployed
Next: Observe normal settings/other writes in production; investigate any remaining server-side latency without retrying uncertain mutations.
Notes: Release includes 45-second mutation timeout handling with `outcome=unknown` for uncertain writes, 12-second read timeout, no blind retry, and localized EN/KM write-error/toast mapping. Focused timeout/error tests, typecheck, i18n and build passed.


## F79: Keep Edit Customer button on the customer section heading row

Status: Deployed
Next: Keep the customer action row in responsive SaleDetailModal smoke coverage.
Notes: Edit Customer is rendered in the customer section heading row in the live release.


## Review follow-ups

- employee-review-origin: Evaluate unsafe-method Origin/CSRF enforcement while preserving OAuth callbacks. — Deferred P3 hardening observation; no demonstrated exploit
- employee-review-body-limit: Reject oversized return bodies before JSON parsing, including chunked requests. — Deferred P3 hardening observation
- R-GEN-1: General repair rate counter is non-atomic; harden concurrent request admission. — Deferred P3; nonblocking independent review observation
- R-GEN-2: Recheck General repair permission immediately before frontend apply; Worker403 remains authoritative. — Deferred P3; nonblocking independent review observation
- R-GEN-3: Tighten General preview numeric types and outcome-marker parity. — Deferred P3; nonblocking independent review observation
- R-MERGE-1: Explicitly mark duplicate preview requests/responses no-store. — Deferred P3; nonblocking independent review observation
- R-MERGE-2: Bound relative quantity tolerance at implausibly large finite amounts. — Deferred P3; nonblocking independent review observation
- R-MERGE-3: Strengthen legacy ready-snapshot operation ID checks in merge finalization. — Deferred P3; nonblocking independent review observation
- R-MERGE-4: Suppress unverified numeric history IDs after adversarial wrong D1 metadata. — Deferred P3; nonblocking independent review observation
- R-D1-PRODUCT-CREATED: Product stockActionCommit created flag uses exact-one D1 metadata; product triggers report9. Current importer ignores flag and safely reselects. — Deferred P3
- R-RECOVERY-RESET-TOKEN: Tighten migration145 recovery-receipt reset exception to require a nonempty reset token. — Deferred P3; no reachable arbitrary flags writer identified
