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

Frontend recovery and the remaining editor/product fixes are still in progress. A prior passing utility suite did not exercise the production GLOB limit; native schema and route execution are required for this repair.
