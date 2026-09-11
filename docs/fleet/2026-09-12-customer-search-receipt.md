# September12 follow-up: long receipts, customer reassignment, employee search

Status: active investigation/implementation, not certified or deployed. Base84c73529; prior live70c81aa0ec1e. Preserve all earlier registers. Root integration is codex/customer-search-receipt-followup-20260912, separate from dirty shared checkout; writers use their own worktrees and durable claims.

## Requirements and acceptance

1. Long thermal receipts: same80mm width/margins for1,10,25+items. User one-item vs long receipt proof supersedes prior driver-only explanation. No entire long receipt shrink-to-one-page. Preserve all lines/totals/QR; explicit80x50 remains one compact sheet. Check direct Print98x148 destination as well as80mm/PDF; physical output remains to verify.
2. Reports header: ONLY full report-option name, Filter, Show, vertical3dots. Remove count from header; preserve useful totals below. Other mode controls below, no menu wrapping off header. EN/KM320+all reportviews.
3. Customer change: default choose a different customer likePOS by name/phone, update selected sale identity snapshots and relationships old->new surgically. Do not rename original global customer. Permission alternative: name-edit-only, reassignment disallowed. User clarification pending whether name-only applies sale snapshot or entire profile. Enforce permission backend, not justbutton. Preserve audit, exact retry, undo, unrelated sales and loyalty/credit integrity.
4. Mobile sale detail: customer name/phone belong Customer section, not driver/Sale section. Outer compact list unchanged. Item Price and discount same line; small fit-sized full-value edit inputs, Qty/Price/Total/Edit headers retained.
5. Employee product selection: broad 'kerastase' must expose ALL matches, including Kerastase Conditioner Genesis75ml barcode03474637319687; role-scope correct, explicit errors, real received dates and positive lots selectable. Do not invent date repairs from stale UI. Test authorized employee without Products access, broadquerypagination, exactname/barcode, stale/cache/denial boundaries.

## Evidence and ownership

- Print investigator product_scope_audit reproduced actual Chromium Receipt/print popup: app80mm CSS page height124.83/248.65/455.03mm for1/10/25items mapped to98x148 destination yields onepage with inkwidth72.1/43.0/23.5mm. Removing forcedwhole-receiptpageheight yields10items two full-width pages71.6–72.1mm. App regression originated85294c21. Also custom148mm document misclassified ascard by<=150 rule; fixedPDFalwaysoneimagepage shrinks. OwnprintReceipt/receiptPdfLayout+focusedtests in isolatedwriter, independentreview required.
- Reports owner reports_followup found ReportFrame still passescount and mixedactionfragments into SectionHeader, causing19badge andmenuwrap. OwnReports frame/hub/views/CSS+focusedtests, neverglobalsharedkit.
- Product investigator urgent_status_backend nativeFTS65families: size8page1ids1..8 excludes target; fullnamefindstarget; page9findstarget. Sale-add discards pagination and omits surface=pos; Sales/POSemployee withoutProducts receives403 then false No products. POS itself haspagination and correctsurface, so employeePOSlive cache/filter issue remains unproven. Sale_editor_audit owns SaleDetail layout/add-replace paginatedsearch+tests only.
- Customer investigator urgent_status_frontend: namedcustomer path opens Contactsprofileedit, assignmentpicker incorrectlyneedsContacts:view. Existing sales_picker and atomiccustomer operation permit sales:customer. Proposed inheritedcustomer_reassign permission with false=>nameonly. Name-only and loyalty semantics being resolved before writes.
- Loyalty blocker reproduced from actual points function: old+100manualaward and redeemed100sale balance0 becomesold100/new0(clampednegative) after naive reassignment. Do not certify header-only update as surgical. Independentbackendinvestigator checking safe atomicbalanceguards/attribution policy. No production data changes authorized through inference.

## Verification plan

Focused failing reproductions -> bounded isolated changes -> independent read-only adversarial review -> integrated typecheck/i18n/build/fullfrontend and affected native backend suites -> real EN/KM responsive and1/10/25 receipt browser matrix -> record provenance if deployed under user approval. Never claim physical printer, employee device freshness, loyalty reconciliation, or production writes tested from synthetic source assertions alone.
