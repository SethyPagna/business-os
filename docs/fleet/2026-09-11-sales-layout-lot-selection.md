# September 11 follow-up: sales layouts and received-date selection

Owner: root. Integration: `codex/sales-layout-lot-selection-20260911`, isolated from dirty shared checkout. Base `857c4bdc`; previous production runtime `e21ca2bc109a`. Do not infer this branch is deployed.

## User acceptance and plan

1. Sales: icon-only Stats and full compact dates; Shift / centered compact Back+range+page+Next / History below search; same desktop/mobile. Receipt+time+cashier first row, customer/phone/driver second, status/payment/items/branch third. Hide row scrollbars.
2. Expenses: same date/pager structure, Shift left and Labels right. Blue Add. Time/category/label together; normal-text cashier/branch below. Row opens detail; authorized Edit/Delete live inside detail. Preserve approval and close/lock behavior.
3. Returns: date row History/Add Return, app-title Export. Pager Shift/Reasons flanks. Time+Return ID row1, original receipt row2, metadata row3.
4. Shared: full compact dates without calendar prefix, icon-only Stats on sales sections, horizontally scrollable mobile page title. Compact pagination retains words/icons and must not clip legitimate numbers in EN/KM.
5. Received-date picker: investigate screenshot Kerastase Conditioner Genesis75ml, barcode03474637319687, and census all stock. Ensure stale client metadata cannot hide valid stock; preserve branch, permission, actor, and request ownership. Never fabricate dates or modify stock to mask UI defects.
6. Independent source/runtime review, actual native Hono/D1 tests, frontend regression gates, real Chromium layout checks at320/360/390/1280 with bundled Khmer fonts; deploy only integrated verified candidate, then verify runtime provenance and live read-only picker.

## Production read-only evidence

- Product3263: Warehouse0, Shop3. Active lot56957 `ADJ09/02/2026`, received_at `2026-09-02T15:30:00.000Z`, Shop3. Target already has a valid dated lot; no date backfill is justified.
- Census: zero positive blank-date lots; zero positive inactive lots; zero product/branch mismatches between branch quantity, lot quantity, and active dated lot quantity. Positive orphan/invalid-date census also zero.
- Eight stale product-level cached totals:3578(8 vs7),4209(454 vs448),6028(14 vs4),6715(29 vs8),6781(21 vs3),8420(9 vs6),8938(8 vs4),10223(8 vs0). Catalog now reads authoritative branch sums rather than this cache. No production data was changed.
- Confirmed client mechanism: received-date sheet depended on global tracked-product index. A stale successful index could skip the exact-product lot request indefinitely. New picker fetches each product/branch directly and blocks selection until current-scope proof succeeds. Screenshot's historical browser network response is not available, so mechanism is confirmed, not every historical runtime detail.

## Integrated implementation

- Shared primitives41b3abd3; Feesafd85bd2; Sales/Returns802eaf93 plus history alignmentc4c3657b; title69ff7bd8; metadata14d50d8d.
- Picker28dac17b +3f1c1103: no-store exact-product endpoint, fail-closed pending/error/partial grouped results, stale product/branch/actor/session rejection. Narrow return-add permission supported without granting batch administration. Response cost/supplier/notes/payment fields excluded.
- Catalog61115d02: indexed authoritative branch totals for list/search/bootstrap/by-ID and stock predicates, preserving existing inactive-branch total semantics and active-only choice arrays. No migration/writes.

## Verification and unresolved release gates

- Native mounted Hono/D1 picker permissions and catalog stock tests PASS. Backend typecheck PASS. Independent picker and catalog reviews PASS.
- Actual Chromium full date endpoints fit at320/360/390/1280. Normal EN/KM pager center delta <=0.008px and no document overflow. Reviewer found legitimate large ranges/page numbers clipped by200px cap; correction required before release.
- Frontend broad gate initially363/367 files green; four failures are stale source-contract assertions after deliberate layout/scope changes. Updating assertions without removing behavioral invariants, then rerun whole gate.
- Independent Fees review caught queued-approval delete being described as completed deletion (pre-existing behavior carried into new detail); correction required before release.
- Frontend full gate atb302a88c:367/367 files PASS, typecheck/public-runtime/source syntax PASS. i18n5711keys592sources and production build1126modules PASS (existing chunk warnings).
- Fees queued-delete fixec420beb independently verified against actual server202 review contract and callback tests: pending approval is truthfully notified; accepted queued requests close/reload without claiming deletion. Localized receipt labels no longer expose undefined IDs.
- Pagerb302a88c deliberately shows selected page-size count, with full range in accessible label, and sizes page input for its digits. Repeated independent browser checks exposed global mobile `.grid {gap:0.75rem!important}` overriding normal AND important utility classes. Final67c28edd uses full-width inline-grid to avoid that selector. Actual rebuilt CSS/Chromium40/40 EN/KM x320/360/390/1280 xpages1/178/500/5000/61729 PASS. Gap0, no pager/root/document overflow, no label/input clipping; center delta<=0.008px. AtKM320page61729 pager187.05px; page-size client=scroll11px, inputclient=scroll40px. Full date endpoints remain visible.
- Remaining release gates: final frozen candidate build/focused regression, broad backend sweep completion/retry, deployment/provenance and live read-only smoke. No deployment claimed yet.

## Scope and safety notes

No stock quantities or received dates were invented/repaired. Existing product creation stock/lot seed atomicity is a separate prevention concern, not proven cause for this screenshot and not changed here. Physical device behavior and all possible network failure scenarios cannot be certified from desktop tests alone. Prior broader requests stay in existing progress ledgers; this follow-up does not erase them.
