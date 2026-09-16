# Urgent sales payment and editor repair — 11 September 2026

Base: a55c2444; deployed source at intake: 648804c0cce5. Main shared worktree is dirty and excluded from writes.

## Requirements and acceptance

- P0: Not Paid → Completed and payment correction commit payment, status, Records and operation receipts atomically. Exact replay cannot double-charge, double-deduct stock or duplicate records. Missing proof remains recoverable; an idle unresolved request must not say Loading.
- Investigate receipt 20260911-154615 (sale 17000). Production read confirms awaiting_payment, total USD 54, paid 0, no settlement receipt or sale record event. Do not invent payment method or mark this customer paid during testing.
- Sale items display plain values with Qty, Price, Total column headers; each row's Edit reveals quantity, price and discount inputs; Apply saves an atomic amendment, Cancel restores display. Totals reflect POS discount semantics and Records preserve before/after. Delivery fee and actual cost follow explicit Edit behavior.
- Compact metadata: barcode | branch; supplier | date, without Received date label.
- Products listing and product selection for stock adjustments and transfers are all-time. Remove received-date filtering from those product collections while retaining required lot provenance selection.
- Copyable names/details use normal text. Desktop wholesale display omits redundant label. Mobile image click opens only image viewer.
- Verify English/Khmer, permission boundaries, actual native D1 transactions, replay, changed actor/request races, responsive UI and the integrated build before authorized deployment.

## Evidence and lanes

- Backend investigation reproduced native D1 failure: sale_record_events UUID CHECK uses a 251-character GLOB, exceeding workerd's 50-character pattern limit. A batch changing status plus inserting the record rolls back. Inspect all affected schema patterns and repair through an append-only, data-preserving migration.
- Frontend investigation reproduced idle pending request rendered as Loading because pendingStatus is passed as saving. Add bounded receipt-first reconciliation and identity guards.
- Receipt display miscalculates per-item savings: base 30 plus manual discount 3 incorrectly produces original 33, then compares to applied 27. Correct actual original is 30; discount 3 per line, 6 across two lines. Stored receipt total 54 is consistent.
- Astra medium owns backend migration/native tests; Astra medium owns frontend recovery; Sol medium owns sale editors/discount presentation; Sol medium owns product scope/display. Writers use separate worktrees and exact path claims. Lead owns live read-only diagnosis, integration, review and release.

## Verification and release state

Migration 0156 from integrated commit f853a921 was applied remotely on 11 September 2026 around 10:44 UTC (49 statements, 85.26 ms). Recovery bookmark: `000014d8-0000004a-000050e3-796346c7ac819f191d3e96821c991497`. Independent review verified all five table metadata, no inbound foreign keys, unchanged indexes/triggers, and 15,360 input mutations with identical validation acceptance. Actual Wrangler local migration testing verified populated copies and complete rollback on final-ledger conflict. Native Hono settlement reproduced pre-fix failure and post-fix payment/record/receipt success with duplicate replay protection.

Remote pre/post counters identical: sales 15,174 / USD 1,903,223.801 / KHR 7,740,848,075.05; returns 5 / USD 173 / KHR 701,820; sale items 36,513 / quantity 59,146 / USD 1,895,080.7514; branch-stock and branch-lot totals both 24,589. All five rebuilt tables had zero rows before and after, indexes/triggers were identical, no long GLOB patterns or helper objects remained, and quick_check returned ok. The exact-token maintenance hold was cleared (one row, zero remaining). Sale 17000 stayed awaiting_payment with paid 0 and total 54; no payment method was invented. Existing production Worker remains 648804c0cce5 until the subsequent app release.

## Integrated app candidate

Runtime changes are frozen at 8f1f528a; a3b2eaac and 63e6af53 only update two stale source-shape tests to retain the intended layout and inventory read-surface assertions. The integrated candidate includes receipt-first recovery, plain-by-default per-row atomic editors, corrected discount presentation, all-time product catalog/stock selectors, normal copyable identity text, and isolated thumbnail release events.

Independent editor review verified the integrated runtime files equal the reviewed owner commit and exercised production Edit/Apply/Cancel callbacks plus actual Hono mutation, replay, conflict, forged amount, permission and settings-race rollback cases. Independent product review initially blocked long-group AND semantics and Khmer UTF-8 pattern handling; the follow-up preserves every group and uses byte-bounded LIKE with a literal fallback. Eight native workerd/D1 exact-name, ASCII, Khmer and boundary cases now pass.

Final Worker typecheck, frontend typecheck, public runtime/source checks, i18n (5,711 keys / 590 files), focused editor/recovery/product tests and production build pass. The build retains circular/large-chunk warnings; it is not warning-free. Full suites and app deployment remain pending at this checkpoint. No production payment was submitted for testing. A prior passing utility suite did not exercise the production GLOB limit; native schema and route execution are required for this repair.

## Final release — LIVE

The complete frontend suite passed **365/365** after the two test-only assertion repairs. The complete backend sweep passed **350/350** discovered scripts; the subsequently added `test-sale-line-edit-pure.cjs` passed separately, covering all **351** current scripts. The sweep included native D1 receipt-route regression, actual migration application/rollback, status/payment/replay, returns, fees, shift closing/reconciliation, stock/lot integrity, and transfers/undo. Independent native product-search checks also passed. Final build at e21ca2bc passed; the release tree was clean.

Deployed **e21ca2bc109a** at 100% as Worker version **d85ea095-5c24-4358-b5e8-78db738923c7**, created **2026-09-11T11:44:32.464Z**, rollout **11:44:34.502Z**. Build hash **19b71de4d05a8d8f**, built **2026-09-11T11:42:56.178Z**. First deployment attempt failed at a read-only Cloudflare API GET with 503 before upload; retry succeeded. Runtime/version independently returned this exact revision/hash and health returned ok. Migration 0156 remained applied once; post-release quick_check returned ok.

Authenticated production browser checks in Khmer confirmed receipt 20260911-154615 has plain Qty/Price/Total values, row Edit reveals quantity/base-price/fixed-discount inputs, and Cancel restores display. Delivery fee and actual delivery cost also require Edit and cancel correctly. The two actual USD3 discounts now display USD6 aggregate, not USD12, with unchanged USD54 total. Status choices open without the previous idle Loading presentation. No payment or sale amendment was submitted during production smoke; read-only postflight still shows awaiting_payment / paid0 / empty payment details. The operator must refresh and retry the original saved payment intent (if present), not assume this release recorded a customer payment.

Products loaded an all-time catalog of6,158 active products; the filter menu has no received-date section. Full-name search `Clarins Super Restorative Decollete And Neck Concentrate 75ml` succeeds and shows the exact stocked product. Visual inspection confirmed normal non-underlined product-name text and value-only wholesale display. A thumbnail click opened only the gallery, not product detail. Physical iPhone/PWA touch, camera and printer behavior is not certified by this desktop smoke. Existing line amendments retain their prior lack of action-history undo/redo; before/after Records are implemented and verified. Broader owner-requested UI work outside this urgent follow-up is not silently marked complete.

All changes are on the pushed fix branch `codex/urgent-sales-payment-20260911`; the dirty shared main worktree was not edited, staged or reset. `progress.md` remains owned by an existing cross-tool ledger claim, so this release record is handed to that owner rather than overwriting their ledger.
