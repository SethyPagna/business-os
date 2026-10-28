# Queue details

Full text of every open item on the progress.md board (moved verbatim from progress.md on 27 Oct 2026, 6.0.998). Each `### Q###` heading is the anchor the board links to; the source line keeps the 13–19 Oct section and group; a note after `→` was reconciled on 27 Oct from the private lane log. Board numbers can change when the board is reorganised; the item text cannot.

How to read the evidence pointers: `archive L<n>` is line n of the private archive file; `#<n>` is observation n of the 428-row obligation index (`Records/Recovery/HANDOFF-COVERAGE-AUDIT-20261012/obligation-index.json`) with its code status in `Records/Lanes/2026-10-13/BACKLOG-COVERAGE.md` (BC) Appendix A; every other name is a report in `Records/Lanes/2026-10-12/` or `Records/Lanes/2026-10-13/`. Status words: OPEN (live, not done), PARTIAL, MISSING (checked in code, absent), UNCERTAIN (needs a device, data or owner statement), OWNER (waits for an owner decision or action), DEVICE (physical-device acceptance), DATA (production data repair, owner-gated), HOLD (deliberately not shipping), DONE (code verified present, not necessarily deployed).

Moved from the old "Open task queue" section of progress.md:

Every open or unfinished task from the old ledger, the 12–13 Oct lane reports and the 428-observation register, by area. Format: `ID#n STATUS description`. `#n` points at the register row and its code status (BC Appendix A); `BC-Qn` are the owner questions in BC §4; `archive L<n>` is a line of the private archive; a trailing `[...]` names the report that holds the evidence. Items marked DONE or SUPERSEDED stay listed once so the register stays complete. Statuses are as checked 13 Oct (code at `0baa53f2`, equal to production for the Worker); the old ledger's unchecked boxes older than 12 Oct were reconciled against the register, later `[x]` entries in the ledger, and the lane reports.

Rows below retain the complete historical scope. Current saved, verified and deployed states are distinguished in the Status snapshot; older lane descriptions remain evidence until their specific acceptance is reconciled. Order is not priority, and actual available agent capacity governs concurrency.

## Older owner questions (BC §4)

- **Owner questions awaiting answers (BC §4, at most four at a time; non-blocking unless noted)**
  - BC-Q1 how the counted-stock family reaches production (blocks N2/N4b/N10; recommended: ship in slices — ruling 13 Oct says slices); BC-Q2 restore after repricing (answered 13 Oct: refuse); BC-Q3/Q4 apply-first questions (cancelled by the queue-first ruling); BC-Q5 replacement priced on an older Not-Paid sale: original rate, today's rate or USD-only (blocks finding E).
  - BC-Q6 same-day equal-cost receipts from different suppliers; BC-Q7 review-tier create matching an existing product (answered 13 Oct: hold for approval); BC-Q8 reject with a blank reason; BC-Q9 historical lot total greater than branch total; BC-Q10 rounding (answered 13 Oct: payable stays cents); BC-Q11 customer data in tracked docs (answered 13 Oct: Option 3).
  - BC-Q12 four permission clean-ups; BC-Q13 loyalty redemption step; BC-Q14 unknown phone in the POS picker; BC-Q15 short display ids; BC-Q16 stock-in session defaults; BC-Q17 receipt times and courier cost; BC-Q18 bulk edit discount/expiry and batch view; BC-Q19 what "labels manage" manages; BC-Q20 inventory statistics scope.
  - BC-Q21 POS print queue persistence; BC-Q22 commission rule; BC-Q23 website theme memory, badges, page-size selector, old shop name; BC-Q24 touch targets, POS confirmations, chips vs cards; BC-Q25 abuse limits, AI quota, CSP report endpoint, video fallback; BC-Q26 import review parity.

## Sales & money

### Q001

Source: Consolidation lanes (last recorded state 19 Oct) · owner-decided

- [~] **CONSOL-F — paid basket growth:** real HTTP808 confirms paid10/total10 plus Add20 becomes total30/paid10 while still Completed, absent from Not Paid; Overview collected rises10→30. Five independent first passes, anonymous cross-critiques (one disclosed substitute) and chair verdict are saved. Implementation remains OPEN: retained money/status, replay, collection/debt reports and settlement must agree; preserve actual change and correction authority. Debt-first return allocation is settled below; no financial runtime fix acceptance is claimed. → *27 Oct: sale payments S1–S3 are live; S4 is 6.0.982 (review).*

Takeover reconciliation, 28 Oct (6.0.1009): 982 is not in RC3; retained money, status and settlement work remains open.

### Q002

Source: Returns, sales money, shifts and expenses › **Sales and POS** · needs owner

  - S4R3-7#137 PARTIAL (ask payment method when completing an unpaid sale); S4R3-9#139 MISSING OWNER (receipt opened/closed time, BC-Q17); S4-30-UNIT-PRICE#153 OPEN OWNER (real decision stays open); S4-3/4/5#142 PARTIAL (status/stock/confirmation sibling lane); AR-POS-ENTRY#118 PARTIAL (receivable panel unmounted, POS on-credit deferred).

### Q003

Source: Returns, sales money, shifts and expenses › **Sales and POS** · needs owner

  - SALES-TIMESTAMP#61 PARTIAL (`sales.updated_at` mixed formats); POS-PRINT-QUEUE#59 PARTIAL OWNER (BC-Q21); POS-ADMIN-RECOVERY#60 MISSING OWNER (admin recovering an employee's crashed sale); V1-OLDCLIENT-CODE#92 MISSING (`money_precision_review_needed` has no EN/KM key); S4R6-1#421 PARTIAL (Sales expenses beside stats per day and shift).

### Q004

Source: Returns, sales money, shifts and expenses › **Sales and POS** · needs owner

  - S4R6-2#422 PARTIAL (today Show-all with bounded cursor); S4R5-2#423 DONE; POS-quickadd-permission#348 UNCERTAIN; PRODUCT-REVENUE-ALLOCATION#113 PARTIAL OWNER (line sums ignore whole-sale discounts); KERNEL-pricing#363 UNCERTAIN, KERNEL-sale-return#365 OPEN (one subtotal/discount/fee/tax/reversal helper); tax on an added sale line (archive L5584) OWNER (no stored tax rate: schema + pricing policy decision). → *26 Oct owner: no Show all; Previous/Next paging instead (6.0.990 removed it).*

Takeover reconciliation, 28 Oct (6.0.1009): 990 in RC3 removes Show all. Revenue allocation, kernels, tax and acceptance subparts remain open.

### Q005

Source: Returns, sales money, shifts and expenses › **Sales and POS** · ready

  - S4R4-1..4,6,10 and S4R5-3b,4 (archive L16432–L16538, L16401–L16414) legacy-OPEN, likely closed by the 10–11 Sep sale-detail releases, verify.

### Q006

Source: Returns, sales money, shifts and expenses › **Money rules and loyalty** · needs owner

  - REDEEM-1000#204, LOYALTY-khr-step#249 UNCERTAIN OWNER (BC-Q13); FX-forward-only#264, Currency-forward-only#388 PARTIAL (lock behaviour with a test and explain "applies to new sales" beside the rate editor); CHANGE-RATE-STAMP#195 DONE; Loyalty-switch-balance-acceptance#413 OWNER; Loyalty lookup disabled by policy#417 DONE (keep disabled unless the owner changes it).

Takeover reconciliation, 28 Oct (6.0.1009): 990 ancestry contains the forward-only exchange-rate note. Loyalty and remaining test/editor acceptance stay open.

### Q007

Source: Returns, sales money, shifts and expenses › **Money rules and loyalty** · needs owner

  - Actual-courier-receipt-printing#418 UNCERTAIN OWNER; Delivery-fee-authority#415 PARTIAL (unlinked courier fees enter delivery cost without double counting); S4R5-3b delivery reports read courier payments (legacy-open, verify, archive L16404).

### Q008

Source: Returns, sales money, shifts and expenses › **Data forensics (DATA, owner-gated)** · needs owner

  - FORENSICS#23 (sales 16671 and 16835, three closed shifts with the riel-twin refund bug, 7 lots with inflated received_quantity, past sale-line costs); S4-1#140 (row 160 fake undo, nine units), S4-2-HISTORICAL-DATA#141; HEADERONLY-SALES#100 and Historical-zero-line-sales#402 (older 16917/16827: only with source snapshot evidence).

### Q009

Source: Returns, sales money, shifts and expenses › **Data forensics (DATA, owner-gated)** · needs owner

  - DRIVER-SALE-LINK#101; Historical-settlement-repairs#398 (seven status changes, nine unreversed stock deductions, no blind flip); Data-correctness-reassertion#397; Production-data-audit-residual#403; Historical-identity-evidence-census#401; N45 historical warehouse-sale audit (archive L15979) and N47–N54 ledger items (archive L16001–L16087).

### Q010

Source: Returns, sales money, shifts and expenses › **Data forensics (DATA, owner-gated)** · ready

  - BH-1 bug hunt 27 Sep fix lanes (archive L223, `Records/Bugs/2026-09-27/`).

### Q011

Source: Returns, sales money, shifts and expenses › **Early-Sep ledger leftovers (archive L3001–L6543)** · ready

  - S4-11b OPEN (record who made each status update; the S4-6 one-line status-message change waits for it; S4-11a is live, archive L5629, L5961); S4-8/9-CANCELLED OPEN verify (`/report` does not exclude cancelled receipts: a pre-existing definition that belongs to the revenue-definition lane, archive L5957); S4-30 window (120 minutes from the sale; 0 = admin-only) shipped with migration 0115, whose application on production is not confirmed here.

### Q012

Source: Reports, exports and receipts › **Lane work** · ready

  - reports-L landed (L1–L4, 4-decimal split reports, overview 70→30 statements); money-surfaces-r2 (6.0.117–120) OPEN — courier cost readable on `GET /api/sales/:id/records` by any sales reader, Dashboard payment/branch cards exclude the rounding adjustment (cents), Sales strip shows $0.00 for absent cost, dead legacy SQL [SONNET-AREA-REVIEW-R2-REPORTS-UI F1,F4,F5, CLAUDE-MONEY-SURFACES-R2]. Export totals vs rows can differ up to 0.0001 for legacy 5-decimal sales and when returned cost exceeds cost (owner info).

### Q013

Source: Reports, exports and receipts › **Register** · ready

  - REPORT-CENTER#56 PARTIAL (broader reports, other exports, Telegram report images); REPORTS-TWO-VERSIONS#106 OPEN (held redesign); S4R3-3#133 PARTIAL (edge/security-layer message for 5xx: `http.ts:501`); S4R3-1/2/4/5/6/8#131,#132,#134,#135,#136,#138 DONE; S4-7#144 DONE; REPORT-DELIVERY-COST#112 DONE (L4 courier cost inferable from profit separate and open).

### Q014

Source: Reports, exports and receipts › **Register** · needs owner

  - Discount-report-port#414 PARTIAL (pending costs and item discounts across report and Telegram consumers); EXPORT-post-addsale-audit#281 UNCERTAIN; STATS-defined-audit#282 UNCERTAIN; H1-EXPORT-OPTIONS#202 / H1-options-confirm#241 OPEN OWNER; DATE-filenames#289 PARTIAL (UTC-stamped export filenames vs business date); RECEIPT-locale#255 DONE.

### Q015

Source: Reports, exports and receipts › **Register** · needs owner

  - RECEIPT-PERSISTED-DEFAULTS#110 DONE; B5/A2#369 DEVICE (both receipt paper sizes on the real print flow); Y4#176 / Y4-print-scroll#231 UNCERTAIN (print/reprint scroll).

### Q016

Source: Reports, exports and receipts › **Legacy ledger leftovers (not in the register)** · needs owner

  - STATEMENT-EXPORTS OPEN (one-year complete statement exports unwired, archive L1216); DATE-SEMANTICS OPEN (remaining date semantics, hardware/data evidence, public work and safe folder consolidation, archive L1219); NEWASKS-SEP3 PARTIAL (Sep 3 owner asks: sale-detail redesign, drop the KHR line per item/discount/membership/delivery while keeping Grand Total, relabel Driver → Delivery; add-products-to-sale shipped as S4-24b; KHR needs template normalisation or an owner toggle, archive L2997). → *27 Oct: paged complete Returns exports are in 6.0.989 (RC2b); the other statements stay open.*

### Q017

Source: Reports, exports and receipts › **Early-Sep ledger leftovers (archive L3001–L6543)** · needs owner

  - RCPT-KHR-DEFAULTS OWNER (the four `show_*_khr` defaults are duplicated in `constants.ts` and `receiptAppliedConfig.ts`; flipping them does not change the live receipt because the saved template merges over them: the owner toggles the four switches or approves a one-time normalisation, same decision as NEWASKS-SEP3, archive L3001–L3007).

### Q018

Source: Reports, exports and receipts › **Early-Sep ledger leftovers (archive L3001–L6543)** · needs owner

  - S4R3-2-SUBTOTAL-REPAIR DATA OWNER (22 legacy-import sales with a 0 subtotal, about $3,462, depress Dashboard revenue; the writer fix `625830d5` is in the base, the one-time 22-row repair is staged and NOT run and needs owner sanction, archive L4836, L15886, L16563); DELIVERY-FIELDS-UI OPEN verify (surface the delivery fields in the UI and verify capture of `delivery_actual_cost_count`, archive L3081).

### Q019

Source: Reports, exports and receipts › **Early-Sep ledger leftovers (archive L3001–L6543)** · needs owner

  - P581-LEFTOVERS OPEN (rename link-over spec, permission-sweep leftovers, reports plan, stock-reason presets, user-gated production forward fixes, archive L3018–L3019, L3035).

### Q020

Source: Reports, exports and receipts › **Completeness-pass additions (archive L6544–L16757)** · ready

  - REVENUE-DEFINITION-DRIFT OPEN verify (`compat.ts` still holds un-apportioned `- COALESCE(rf.refund_usd, 0)` copies near lines 390/400/434/444 and `attributedLineRevenue` near 345, and the Dashboard summary tiles use `SUM(total_usd)` over non-cancelled sales, a third revenue definition, so the tiles and the Analytics panel disagree on the same screen, archive L16605–L16611; related Discount-report-port#414).

Takeover reconciliation, 28 Oct (6.0.1009): 1001 covers related Dashboard/Sales reads; revenue-definition correctness remains open pending certification.

### Q021

Source: Added 27 Oct from the lane log · owner-decided

- Sale payments S5–S8: the remaining slices of the 24 Oct payments design after S1–S3 (live) and S4 (6.0.982), including the five flagged old short sales (record the payment with its real date, "recorded late", kept out of current drawers).

Takeover reconciliation, 28 Oct (6.0.1009): S5–S8 and the recorded-late repair remain open. No historic-data write is authorized.

### Q022

Source: Added 27 Oct from the lane log · ready

- 6.0.982 P3 follow-ups: a credit-only sale is counted and its revision bumped by the linked rename; add tests for the preview, audit and summary counts.

Takeover reconciliation, 28 Oct (6.0.1009): 982 is not deployed in RC3; its P3 follow-ups remain open.

### Q023

Source: Added 27 Oct from the lane log · owner-decided

- Past sale statuses normalised to Completed / Not Paid plus tags, and records wrongly turned from Not Paid into Paid corrected (owner 20 Oct; held migration; state not re-checked here since 20 Oct).

### Q024

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Imports, stock and money** · ready

  - Exchange replacement sale: loyalty accrual must follow the programme switch. SELECT-only ops audits: pre-6.0.131 replace-all deactivations, pre-6.0.134 grouped-return statuses, and the affected-customer count for the restored loyalty points (run in the postflight).

## Stock & products

### Q025

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - cost-unknown + Conflicts: $0 cost = $0 loss, NULL cost = unknown and flagged, every unknown-cost item and empty-barcode product listed in Conflicts; sweep EVERY cost reader (reports, salesAnalytics, removalLosses, conflicts). Also closes the Reports courier column that prints a hidden figure as $0.00, and multilot NOTE 1 (a $0-cost lot disposal valued at catalog price). → *27 Oct: the Conflicts list is lane 6.0.988 (review).*

Takeover reconciliation, 28 Oct (6.0.1009): 988 Conflicts lists/marks and 0273 are deployed. The cost-reader sweep and remaining subparts stay open.

### Q026

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Imports, stock and money** · ready

  - Import approve costs about 2,170 statements against the Paid 1,000-per-invocation limit: HIGH, VERIFY the production path before relying on large imports (multilot r3 refute).

Takeover reconciliation, 28 Oct (6.0.1009): 1004 counts physical D1 calls separately from the historical 2,170-statement measurement. Capacity verification remains open.

### Q027

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Imports, stock and money** · ready

  - A 150-row plain CSV Add becomes one batch of 301 statements, over the 300 chunk (pre-existing, CPU split makes it harmless today): fold into the import lane.

Takeover reconciliation, 28 Oct (6.0.1009): A 301-statement batch is one D1 call under 1004. Row, bind, CPU and atomicity limits remain separate open checks.

### Q028

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Imports, stock and money** · ready

  - Multilot: movements written in the deploy window above the watermark revert aggregate-only; the 0250 runbook must cover "migration applied but publish failed" and Worker-only rollback windows.

### Q029

Source: Stock, catalog, contacts and suppliers › **Historical release 2 lane scope (shipped inside release 2e; unresolved follow-ups and device acceptance remain open)** · ready

  - multilot-revert (6.0.113–116) OPEN — Revert of a multi-lot removal restores branch_stock but not lots (`stockRevert.ts:547`, CSV path since 6.0.56) plus ops query `branch-exceeds-lots.sql` [OPUS-AREA-REVIEW-R2-STOCK-RETURNS F1, CLAUDE-MULTILOT-REVERT]. import-returns-followups (6.0.131–136) OPEN — import skip keeps product, create-fold typed qty becomes stock-in, imported-sale returns must not subtract loyalty points (`contacts.ts:827`), bulk status ignores imported units, three import row codes English-only, misleading "Pricing changed" on stock conflict [same review F3–F7]. ui-polish-r2 (6.0.121–124) OPEN — undated-only Set starts on an empty lot, failed photo tile cramped and Save silently drops it, old-iOS picker can lock the form, storefront picker has no cancel [SONNET-AREA-REVIEW-R2-REPORTS-UI F3,F6–F8].

### Q030

Source: Stock, catalog, contacts and suppliers › **N5** · ready

  - F4#11 MISSING — a return restock raises the lot's `received_quantity` (`productBatches.ts:349`); REVERT-ATOMIC-AUDIT#19 PARTIAL — stock_revert audit written after the revert (`inventory.ts:3133`); after STAB/N1 [BC §3 N5].

### Q031

Source: Stock, catalog, contacts and suppliers › **N6** · ready

  - D4#372 / D4-historical-dates#230 OPEN — Worker default received date is the UTC day, business day is Cambodia UTC+7 (`productBatches.ts:190,295,628`, `batches.ts:500`); 38 other `toISOString().slice(0,10)` sites need triage [BC §3 N6].

### Q032

Source: Stock, catalog, contacts and suppliers › **N8** · needs owner

  - PRODUCT-DISMISS-REOPEN#115 MISSING — no undismiss/includeDismissed for product clusters (`products.ts:5816,5825`); SUPPLIER-LOT-IDENTITY#87 MISSING OWNER — same-day equal-cost receipts from different suppliers share one lot (BC-Q6); SUPPLIER-E3-E4-E5#82 UNCERTAIN FIFO drain mirror / predicate divergence / numeric ref collision.

### Q033

Source: Stock, catalog, contacts and suppliers › **Counted-stock family (HOLD, root chain only; BC-Q1)** · owner-decided

  - P1-STOCK-PREREQ#0 (durable dated-count receipts, count admission), P1-DAMAGED#1 (counted sellable tagged stock), inline damaged amount on the Set row (owner ruling 12 Oct), 31 COUNTED-* rows (OPTION-CONSUMERS, CONDITION-HISTORY, SCOPED-SET, SHARED-QUANTITY, TAG-UI, STANDALONE-REVERT, SALE-AMENDMENTS, RECEIVING-EXACT, TRANSFER-EXACT, INVENTORY-ADJUST-ADAPTER, SUPPLIER-RETURN-EXACT, BACKUP-RESTORE, CONVERSION-FRACTIONS ...), N10 merge-consumer seams (sale cancel single/group, return cancel/group Undo/Redo, stockRevert, transfer replay), customer1be COUNTED-MERGE-FOLD-EXACT (`1be0918a6`), replay `15fbdc8e0` (+ replay-conditions `6f96c7cf7` certified with exceptions), customer-return-backend `8070f00` (Opus BLOCK, fix plan: keep return_items.product_id = sold product, keeper only on stock-side rows) [BC §1.2, §3 N10, OPUS-REVIEW-CUSTOMER-RETURN-BACKEND, SONNET-REFUTE-REPLAY-CONDITIONS].

### Q034

Source: Stock, catalog, contacts and suppliers › **Stock UI/logic leftovers** · ready

  - REASON-CODE#83 PARTIAL (only `full_access_required` is coded, `inventory.ts:1182`); N6-NAV-RETRY#55 MISSING (session retry handle is component state); PIN-products-branch-move#298 and PIN-inventory-drain#299 MISSING (pin refetched rows only from authoritative stock); MERGE-COST-WARNING#157 PARTIAL (server sends `costOutliers`, dialog never renders it).

### Q035

Source: Stock, catalog, contacts and suppliers › **Stock UI/logic leftovers** · needs owner

  - S4-27#151 PARTIAL (undated lots get English-only batch word); S4-19b#147 PARTIAL (`MAX(batch_number)+1` on TEXT, `productBatches.ts:365`); S4-17b#146 UNCERTAIN (survey and undoable fold of cost-forked twins); P9-9#72 UNCERTAIN (tagged stock needs a signed-in live check); S4-SESSION-ID#154, S4-SESSION-PAYMENT#155, S4-SESSION-COST-PREFILL#156 UNCERTAIN OWNER (BC-Q16).

### Q036

Source: Stock, catalog, contacts and suppliers › **Stock UI/logic leftovers** · needs owner

  - STOCK-STATS-SCOPE#107 PARTIAL OWNER (BC-Q20); LABEL-MANAGE#14 UNCERTAIN OWNER (BC-Q19); LOT-NO-SUPPLIER-CONFLICT#15 PARTIAL (conflict type for lots with no supplier); PRODUCT-REMOVE-REVERSIBLE#17 PARTIAL (Remove refuses while a stock-in session is reversible, `productDelete.ts`); BATCH-historical-parity#351 PARTIAL; BATCH-view-readonly#324 UNCERTAIN OWNER and BATCH-branch-view#325 SUPERSEDED.

### Q037

Source: Stock, catalog, contacts and suppliers › **Stock UI/logic leftovers** · needs owner

  - BATCH-group-picker#310 CLOSED; BULK-discount-expiry#313 UNCERTAIN OWNER (BC-Q18); TRANSFER-example#311 OPEN OWNER; Z1-writer#233 OPEN (default two-branch writer lot attribution) and Z1-display-conflict#234 SUPERSEDED; STOCK-CHANGE-RIDEALONG#127 UNCERTAIN (stale residue, close); DETAIL-status-gap#295 OPEN OWNER; KERNEL-stock#364 OPEN (one on-hand/reserved/available/threshold helper across Dashboard, Inventory, Branches, POS, resolver).

### Q038

Source: Stock, catalog, contacts and suppliers › **Stock UI/logic leftovers** · ready

  - G1 filter/preview#374 OPEN.

### Q039

Source: Stock, catalog, contacts and suppliers › **Catalog and product detail** · ready

  - D3#166 / D3-detail-filters#213 PARTIAL (movement filters, full Date/Type/Batch/Qty/Running-balance/Reference table); D3-detail-search#214 OPEN (search by supplier/batch attributes); D5a#167 DONE and D5a-read#215 OPEN (supplier attribution across read surfaces); D2b#165 / D2-date-row#212 OPEN (Date row under search on Products and Inventory).

### Q040

Source: Stock, catalog, contacts and suppliers › **Catalog and product detail** · needs owner

  - D6 (archive L11303) OPEN (rename cascades with before→after preview); IDENTITY-rename-regroup#342 PARTIAL (rename does not regroup); IDENTITY-auto-merge-evidence#343 PARTIAL (auto-merge flag/filter and losing values); GROUP-image-owner#346 PARTIAL; PRODUCT-detail-density#287 PARTIAL; PRODUCT-edit-layout-confirm#288 OWNER.

### Q041

Source: Stock, catalog, contacts and suppliers › **Catalog and product detail** · ready

  - PRODUCT-MOBILE-DESCRIPTION#116 PARTIAL (hide inline descriptions on mobile); EXACT-DUP-CLICK-ACCEPTANCE#126 UNCERTAIN (not verified live); INVENTORY-EXCISION-LEFTOVERS#125 PARTIAL (unused catalog collectors, repoint `#product-` notification anchors); POS-price-condition-picker#347 PARTIAL (SP/VIP/condition tiers, never show cost in POS).

### Q042

Source: Stock, catalog, contacts and suppliers › **Catalog and product detail** · ready

  - K7-edit-jump#227 UNCERTAIN (edit-form section jumps); PICKER-GUARD#69 DONE; REASON-DIRTY#84 DONE.

### Q043

Source: Stock, catalog, contacts and suppliers › **Official names and duplicates** · needs owner

  - OFFICIAL-NAMES#22,#117 OWNER (sourced official-name Excel for the owner's review, no import without it; waits for the owner's current-stock confirmation; 6030/6031 "Abercrombie" copy); Product-duplicate-correction-remainder#406 DATA (remaining eligible groups with a fresh manifest and reversible receipts); Product-7091-inactive#405 SUPERSEDED.

### Q044

Source: Stock, catalog, contacts and suppliers › **Legacy ledger leftovers (not in the register)** · owner-decided

  - ADJUST-SIBLING-IDENTITY OPEN — post-commit audit/read uncertainty and concurrent new-barcode sibling identity (adjust candidate `a22d3b1e` rejected, archive L657); SEP1-3-LEGACY-DEDUCT HOLD — Sep 1–3 legacy-import sales stay un-deducted by owner ruling (held file `ops/scripts/migration/held/legacy_sep2_3_import_stock_deduction.sql`, 107 units, archive L1775).

### Q045

Source: Stock, catalog, contacts and suppliers › **Legacy ledger leftovers (not in the register)** · needs owner

  - LEGACY-SHORT-LINES OWNER — two legacy invoices live but each one line short, held out of the paid flip (archive L2614); P3-DEFAULTS OWNER — Program 3 design defaults the owner may overrule (losses, compat cost keys admin-only, reason optional, shift-amend gating, archive L1917).

### Q046

Source: Stock, catalog, contacts and suppliers › **Early-Sep ledger leftovers (archive L3001–L6543; most were closed by later releases, verify before any work)** · ready

  - CATALOG-INTEGRITY items 2–5 OPEN verify (merge reparenting of sales, supplier backfill of 18,996 lots across 2,667 products, `/detail-report` suppliers name-only, fuzzy name duplicate detection, each with undo, archive L3476–L3490); BATCHES-SET-SIGN OPEN verify (`batches.ts` set-sign write bug, task chip spawned, plus the uncommitted `Products.tsx` onAdd one-liner that hides the catalog Add-Product on Stock Changes, archive L4226–L4237).

### Q047

Source: Stock, catalog, contacts and suppliers › **Early-Sep ledger leftovers (archive L3001–L6543; most were closed by later releases, verify before any work)** · ready

  - PDUP-REOPEN OPEN verify (= PRODUCT-DISMISS-REOPEN#115; Products duplicates tab reopen through includeDismissed + undismiss in `products.ts`, archive L3184); S4-32-COST-GUARD OPEN verify (cost mean only across similar costs: 2x guard over 353 merge-candidate groups, worst case 1.58x so the threshold fires on nothing today, take the highest above the threshold with a visible flag; no closure seen, archive L6190–L6215).

### Q048

Source: Stock, catalog, contacts and suppliers › **Early-Sep ledger leftovers (archive L3001–L6543; most were closed by later releases, verify before any work)** · owner-decided

  - S4-29-MEASURED DATA (one same-name unbarcoded pair, 1,695 leading-zero barcode groups over 3,411 rows, placeholder product id 10185 "Ysl New Item" to delete by owner ruling 4 Sep; migration 0112 was written unrun, confirm it ran, archive L5375, L5660).

### Q049

Source: Stock, catalog, contacts and suppliers › **Early-Sep ledger leftovers (archive L3001–L6543; most were closed by later releases, verify before any work)** · needs owner

  - SEP2-PROD-APPLY DATA (the 2 Sep production apply left four defects; twin products 3,881 and 15,004 rewritten receipt numbers were repaired later by 0109 and 0107; STILL OPEN: 27,278 lot quantities zeroed into 9,921 RECON lots, where 0108 only relabelled the codes and the zeroed quantities are not shown repaired, and the Delivery label that became a courier contact, with no closure seen; the forward fix `twin-merge.sql` was never applied and the pre-change Time Travel bookmark is never restored, archive L3028–L3035).

### Q050

Source: Stock, catalog, contacts and suppliers › **Early-Sep ledger leftovers (archive L3001–L6543; most were closed by later releases, verify before any work)** · needs owner

  - PROD-CLAIMS-UNVERIFIED OWNER (supplier-attribution and naming-convention drift stay unverified until the owner names a concrete offending record; six other corruption claims were refuted by read-only SELECT, archive L3313).

### Q051

Source: Next owner scope — Inventory, image-only filters and permissions (18 October) · owner-decided

- **OPEN — Main Inventory page:** promote the existing Branches > Products/Inventory surface into primary navigation, using compact Products-like rows on desktop and mobile. Group related details instead of many sparse columns. Keep the active branch visible even when there is only one. Resolve the existing Branches-specific activity gate and preserve old navigation/deep-link behavior.

### Q052

Source: Next owner scope — Inventory, image-only filters and permissions (18 October) · owner-decided

- **OPEN — Resumable count sessions:** save checks, counted quantities and issue reasons in resumable sessions without changing actual stock, financial records or history. Provide compact sections for all product checking rows, sessions and issues. A tick means checked/completed, no mark means unchecked, and there is one issue state with different reasons; this supersedes the earlier red/yellow severity proposal. Icons and accessible labels distinguish states without relying on color alone. Put compact horizontally scrollable filter rows immediately below search, including issue reasons and stock status, with a separate date range. Sale ranking is an optional filter/sort; the owner has not selected a default ranking measure. Keep current stock distinct from period sales metrics and rank on the server before pagination.

### Q053

Source: Next owner scope — Inventory, image-only filters and permissions (18 October) · owner-decided

- **OPEN — Image-only upload:** add a product received-date range and stock/filter menus alongside existing category/brand controls. The owner explicitly selected received date. Preserve restricted grants across listing, totals, filter choices and ranking so hidden data cannot be inferred. Reuse existing upload/preview/save paths.

### Q054

Source: Next owner scope — Inventory, image-only filters and permissions (18 October) · owner-decided

- **OPEN — Configurable permissions:** extend existing Full/Review/View/Hidden tiers and per-action controls rather than create a competing permission system. Custom users must be able to configure shown, hidden and partial information. Inventory hides cost from non-admins by default, with page-specific configurable permissions analogous to Products image-only. Trace the remaining partial fields and role defaults before changing them. Enforce redaction and actions on the server, including export, direct links, background requests and filter/count responses.

### Q055

Source: Next owner scope — Inventory, image-only filters and permissions (18 October) · owner-decided

- **Required acceptance:** EN/KM, dd/mm/yyyy, narrow/wide and long content; keyboard focus, touch, horizontal filter scrolling and no page overflow; iOS/Android/PWA fallbacks; account/branch/session changes and cache isolation; Free/Paid query limits; discriminating permission, ordering, date-boundary and pagination tests. Physical device checks remain explicitly unverified. The first-principles source map is private in Records; a full design council, session collaboration/conflict handling and ranking semantics remain pending. Resumable persistence and one issue state are owner decisions. Nothing here is implemented or deployed yet.

### Q056

Source: Imports, exports and legacy migration › **Register** · ready

  - P1-IMPORT-RETRY#2 PARTIAL (apply retries must keep applied-group identity; delayed CSV upload); F13#12 PARTIAL (re-importing an export adds stock; Fill-missing ignores quantity); N1b#183 / N1b-options#217 PARTIAL (calculation choices: discounts, notifications, duplicate policy); N1c#184 / N1c-intake#218 PARTIAL (one entry point, one or many files).

### Q057

Source: Imports, exports and legacy migration › **Register** · ready

  - P7-f#175 / P7-f-inventory-add#229 / H2#375 PARTIAL (inventory ADD import lacks supplier/payment_status/credit_due_date columns); Z1b#178 DONE, Z1-writer#233; S4-28#152 PARTIAL (wholesale tier through import/clone/export); WHOLESALE-PERIPHERALS#123 DONE; M6#173, M6-adjustments#208, M6-drawers#209, M6-suppliers#210 OPEN (930 historical stock adjustments, 755 cash sessions, supplier invoices; `stock_adjustments`/`drawer_sessions` ledgers deferred).

### Q058

Source: Imports, exports and legacy migration › **Register** · needs owner

  - LEGACY-BARCODE-AUDIT#105 PARTIAL (normaliser strips `Libre10ml` to `10`); CSV-general-replace-wizard#274, CSV-addsale-new-product#275, CSV-replace-columns#276, CSV-replace-match#277 PARTIAL, CSV-wipe-reimport#278 UNCERTAIN, CSV-layer-status#279 SUPERSEDED, CSV-cost-tolerance#280 OWNER, CSV-mode-timing-status#315 SUPERSEDED.

### Q059

Source: Imports, exports and legacy migration › **Register** · needs owner

  - DATED-frontdoor#272 DONE, DATED-rerun-status#273 SUPERSEDED; IMPORT-review-parity#256 PARTIAL OWNER (BC-Q26: Sales/Inventory have no in-modal Cancel); IMPORT-gallery-choice#314 PARTIAL (multi-image import or document single image); IMPORT-tracker-dwell#320 UNCERTAIN; UNIFIED-live-verify#321, SALES-roundtrip-live#352, QA-import-ripple#357, PERF-import-live#312 OPEN/UNCERTAIN live checks.

### Q060

Source: Imports, exports and legacy migration › **Register** · needs owner

  - D1b(a)#370 DONE; D6b#373 PARTIAL; Sales/returns-fold-import#385 MISSING (populate `search_normalized` in `salesImportCommit.ts:361`, `stockActionCommit.ts:787`; cheap, Sonnet); KERNEL-adjust-deltas#366 OPEN; COMMISSION-SERVICE#201 / RULE-commission#240 OWNER (rule never stated); IMPORT-old-flow-supersession#353 SUPERSEDED.

### Q061

Source: Imports, exports and legacy migration › **Register** · ready

  - XLSX/CSV mode tabs untranslated (`ProductImportModeTabs.tsx:10-13`, CSV-general#274); import row-code translations (R2 F5).

### Q062

Source: Imports, exports and legacy migration › **Legacy ledger leftovers (not in the register)** · ready

  - BARCODEKEY-BOUND OPEN (legacy-import barcode normaliser mis-keys SKU-style codes; re-run the applied Sep 1 and Sep 2 batches under both helpers and diff product_id per line; `legacy-preflight.mjs:77` still calls the old helper, archive L2618); MIG-0106-ALIAS HOLD (release-candidate `0106_barcode_aliases.sql` never applied; renumber and rebase if that line is ever merged, archive L2980).

### Q063

Source: Imports, exports and legacy migration › **Legacy ledger leftovers (not in the register)** · ready

  - HO24-PARKED-MIGR HOLD (migrations 0185–0191 parked in `ops/scripts/migration/held/`; 0192–0207 are applied, verify which held ones remain, archive L493); D1b(b)#371 PARTIAL (consistent branch/supplier/date sibling reports); WHOLESALE-THRESHOLD#122 CLOSED; J3/N3a#376 DONE.

### Q064

Source: Imports, exports and legacy migration · needs owner

- **Early-Sep ledger leftovers (archive L3421, L6531)**: MIG-AUG31-DAY PARTIAL (the 31 Aug day report import was prepared and verified but never recorded as applied; the AR half is live through 0094 and 13,244 invoices) (commission fields: BC-Q22).

### Q065

Source: Imports, exports and legacy migration › **Import robustness lane (queued; OPUS-CORRECTNESS-HUNT-R2 H2/H4, 13 Oct)** · ready

  - IMPORT-VERDICT-DRIFT OPEN (an import chunk throws 500/failed when a row's verdict changes between Analyze and Approve: Remove newly through insufficient stock in release 2, Set already before; no production imports have been applied yet); IMPORT-UTC-LOT-DATE OPEN (counted and import lots are dated by the UTC date, so 00:00–06:59 KH lands on the previous day, also `productBatches.ts:190/295/686`; use `businessToday()`).

### Q066

Source: Added 27 Oct from the lane log · ready

- 6.0.991 P3 follow-ups: the scanner test is weak, a residual race outside sale create, wide expiry seeks.

Takeover reconciliation, 28 Oct (6.0.1009): 991 scanner, race and expiry-seek residuals remain open; deployment of 994 does not close them all.

## Returns

### Q067

Source: Returns, sales money, shifts and expenses › **Findings still MISSING on production** · owner-decided

  - (repro tests RED by design, kept out of release candidates): C imported returned quantity ignored in capacity (`returns.ts:733`; N1 returns-capacity landed 6.0.82–86 for release 2, check composition); D partial return on Not Paid leaves the Not Paid list, settlement refused, drawer pays out (`sales.ts:2420`); E replacement on a Not Paid sale booked as Cash (`returns.ts:101`; BC-Q5 rate rule).

Takeover reconciliation, 28 Oct (6.0.1009): Imported capacity, Not Paid debt/cash and replacement correctness require current-code proof; no subpart is closed here.

### Q068

Source: Returns, sales money, shifts and expenses › **Findings still MISSING on production** · owner-decided

  - F paid sale that grows stays Completed, $20 unsettleable (`saleLineAddition.ts:592`); G restore after same-line repricing (owner ruling 12 Oct: refuse with "record a new return"); M return id N collides with sale-keyed movements (first blocking id 16780, latent); capacity float-sum refusal (`returnCreateAction.ts:355`) [BC §1.3, §3 N1, N2 (needs BC-Q1, Q4, Q5), OPUS-AREA-REVIEW-R2-STOCK-RETURNS, FINAL-a3e831ad6cc0d4e8c]. → *27 Oct: G (refuse restore after repricing) is 6.0.989 (RC2b, deploying); F belongs to the sale-payments work (6.0.982).*

Takeover reconciliation, 28 Oct (6.0.1009): 989/RC2b includes restore-after-reprice refusal. Paid-sale growth belongs to outstanding 982; ID/capacity residuals remain open.

### Q069

Source: Returns, sales money, shifts and expenses › **Returns register** · needs owner

  - F2#10 PARTIAL (Not Paid returns until RETURNS-MONEY 0204; held migration 0238 backfill: see Holds); RETURN-atomicity#248 / PART77-RETURNS-ATOMIC#185 PARTIAL (cross-step atomic create/edit, unpaged/N+1 sites); RETURN-replacement#330 PARTIAL (same-name replacement/settlement, unified chooser); RETURN-cancel-policy#296 PARTIAL OWNER (cancellation semantics for refund/stock/COGS).

Takeover reconciliation, 28 Oct (6.0.1009): 997 and old-cancel policies are answered. Implementation and cancellation, stock and COGS gaps remain open.

### Q070

Source: Returns, sales money, shifts and expenses › **Returns register** · ready

  - SALE-RETURN-ID#97 UNCERTAIN (equal sale/return ids, finding M); RETURN-SUBCENT#96 DONE; legacy v0 customer return create/edit does per-line N+1 capacity reads (Free-plan P1, OPUS-EFFICIENCY-REVIEW-R2 W2); two-line mixed CREATE over Free budget (CRB spin-off); edit/create `batch_id` asymmetry; EditReturnModal never sends `stock_condition` (7077327 finding 1), PATCH not actor-fenced (finding 8).

Takeover reconciliation, 28 Oct (6.0.1009): Related work is in 1004 budgets, 999 damaged handling and 997 edits. Atomicity and the other named gaps remain open.

### Q071

Source: Returns, sales money, shifts and expenses › **Legacy ledger leftovers (not in the register)** · needs owner

  - RETURNS-ENDPOINT OPEN — returns endpoint/UI `66399fef` isolated pending lifecycle integration; list/export 500/1000 loaded-row cap is a separate completeness issue (archive L1081); P1-RULINGS-PRECISION OWNER — non-blocking rulings on Precision v1: cached old PWA `409 money_precision_review_needed`, preview page-size key, zero-result pager, sub-cent return cancel, spurious `write_conflict` on return create (archive L1947).

Takeover reconciliation, 28 Oct (6.0.1009): RC3 includes 992 legacy unlock/money-detail handling. Export completeness and unresolved Precision rulings remain open.

### Q072

Source: Returns, sales money, shifts and expenses › **Legacy ledger leftovers (not in the register)** · ready

  - F-register tasks F69–F73, U16–U20 (Sep 8): F73 transfer receipt/audit retry gap, F71 Library mounted review needs sync-event consumption repair, U20 broader device layout coverage (archive L14800; the full F-register lives in the obligation index).

### Q073

Source: Added 27 Oct from the lane log · ready

- 6.0.994 E1 follow-up: return and receipt number probes retry on same-second collisions; give the exchange request statement headroom (RC2b sits exactly at the budget of 50).

Takeover reconciliation, 28 Oct (6.0.1009): Exchange number-probe/headroom work remains open; 994 in RC3 does not complete E1.

## Contacts

### Q074

Source: Stock, catalog, contacts and suppliers › **Contacts and suppliers** · needs owner

  - P10-14#66 OPEN (872 customers with blank gender: report and make fixable); GEN-MEMBERSHIP#57 OPEN (shared General customer's legacy membership value: clear and verify); CONTACT-CLEANUP#99 UNCERTAIN (membership-blocked customer cluster, supplier profile confirmation); Q4-data-review#378 OPEN OWNER (two duplicate-phone customer pairs: the owner merges them in the Duplicates tab).

### Q075

Source: Stock, catalog, contacts and suppliers › **Contacts and suppliers** · needs owner

  - CUSTOMER-membership-prefix#427 OPEN OWNER (exact legacy prefix only if authorised); CONTACT-compare-review#334 PARTIAL, CONTACT-bulk-reviewed#336 PARTIAL (no pair-order implicit bulk merge, 3+ clusters explicit), CONTACT-identity-index#337 PARTIAL (normalised indexed identity keys), CONTACT-duplicate-km#285 OPEN (real Khmer for Resolve/Dismiss/search), CONTACT-merge-scope#283 DONE, CONTACT-merge-atomic#335 DONE, CONTACT-dismiss-sync#284 SUPERSEDED.

### Q076

Source: Stock, catalog, contacts and suppliers › **Contacts and suppliers** · needs owner

  - F72-unknown-phone#409 UNCERTAIN OWNER (BC-Q14); Supplier-residual-invoice-ledger#384 PARTIAL (historical invoice monetary residual without double stock); SUPPLIER-AUTO-BACKFILL#120 PARTIAL DATA (18,996 blank-supplier lots, 7,340 source receipt lines carry a supplier); LOT-BACKFILL#68 DATA (19,914 untraced legacy lots); UNCOSTED10#77 DATA (10 genuinely uncosted removal rows).

## Shift, receipts, Telegram

### Q077

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Imports, stock and money** · ready

  - Shift-cash leftovers: amend opened_at later, sales between close and reopen (resolved by the round 6 parent-close float), admin time edits that leave money outside a shift.

Takeover reconciliation, 28 Oct (6.0.1009): Return corrections and old cancels counting today are settled policy. Shift time/cash residuals remain open.

### Q078

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - Receipt TIN and licences: Khmer and English receipt, TIN and licence fields in settings printed on the receipt (accountant to confirm the invoice format).

### Q079

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - Per-cashier shift report: open and close, per-cashier totals, all-cashier summary (design in the shift-cash report).

### Q080

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - Telegram admin-only check: the full phone number may be shown only where the audience is verified admin-only; add the check and a test.

### Q081

Source: Returns, sales money, shifts and expenses › **Shifts and expenses** · needs owner

  - S4-10#145 DONE; SHIFT20-COUNT#58 DATA (shift 20 closing-count amendment); Historical-Sep4-shift-close#412 DATA OWNER; N46#420 DATA OWNER (expense note 993000 vs 99300 KHR before any write).

### Q082

Source: Returns, sales money, shifts and expenses › **Shifts and expenses** · ready

  - N43 (shift open/close cash semantics) and N44 (field-specific compact input sizing) legacy-OPEN (archive L15949, L15966; shift lines now covered by shift-cash-everywhere 6.0.104–107 + 6.0.154–157 refuter fixes in flight: telegram-topics pin, Additional on the shift list card, per-shift drawer mutation guard, reopen/close actor named).

Takeover reconciliation, 28 Oct (6.0.1009): 1006 covers whole-hundreds cash and 1007 payment-day reports. Shift field and money acceptance remain open.

### Q083

Source: Returns, sales money, shifts and expenses › **Shifts and expenses** · ready

  - fees/expenses K lane done, fees-k-frontend (6.0.137–140, in flight: deleteFee expected_updated_at + 409, ReviewQueue reject 512 cap + EN/KM for reason_too_long/invalid_reason/review_entity_changed/review_already_decided, 409 undo_history_stale refresh, Backups 503 guidance) OPEN [CLAUDE-FEES-K-FIX-FINAL, CLAUDE-FEES-K-FRONTEND]. K backlog: K5 pattern in label replace/classify, sale cancel fees, contact-merge repoint.

### Q084

Source: Returns, sales money, shifts and expenses › **Shifts and expenses** · ready

  - review audit best-effort; six sites name the freshest-session device; `PATCH /action-history` unconditional flip; K8b needs a migration (pending_actions.requested_device_name/_tz, number 0249+).

### Q085

Source: Telegram and notifications · ready

- Pending-tag + Telegram-per-review lane (release 3 slice C, above); Khmer wording unification (Stock-in session, import row codes, Audit Log context block English labels "Before", "Created By", "Pending Action Id", "Requested By", km "sale" is bare លក់ where ការលក់ is more natural, 18 uses) OPEN [CLAUDE-RELEASE-2-GATE-FIXES, P-KM key map KM-STOCKIN-WORDING-KEYS].

Takeover reconciliation, 28 Oct (6.0.1009): RC3 strings do not certify the whole glossary or Khmer copy; this scope remains open.

### Q086

Source: Telegram and notifications · needs owner

- TG-TOPICS-OPS#37 / OPS-settings OPEN OWNER (guarded deployment-only write of the six Telegram topic ids supplied by the owner 27 Sep; production stores none; single-tenant per organization, never a migration); Telegram-live-shift-acceptance#399 OPEN (live shift-close behaviour); S4-6#143 PARTIAL (status message names the actual updater; amend message now names the actor in shift-cash-everywhere); TG-ASTRAL#88 PARTIAL (shared astral-character fixture for `cleanLine` and `saleItemNameLayout`); Notifications low/out alerts only on a sale crossing the threshold (donor NOTIF-V2 `ca36cfb3b`, `telegram.ts:1024` still a standing list) MISSING; Telegram carries profit/courier chat-wide by design (owner info); LOYALTY-notification manual adjustment#416 DONE; QUEUE-ERROR-CODE#91 PARTIAL (raw English `last_error`); Telegram report images (REPORT-CENTER#56). → *27 Oct: crossing-only alerts are lane 6.0.991 (RC2b, deploying).*

Takeover reconciliation, 28 Oct (6.0.1009): 1007 is related Telegram work. Live, device and data-specific subparts still need separate evidence.

### Q087

Source: Telegram and notifications › **Legacy ledger leftovers (not in the register)** · needs owner

  - CP3B1-SETTOPIC OPEN (PENDING entry for the /settopic broadcast, U-broadcast, archive L184); BP-10 OWNER (Telegram settings permissions question left open after CP-3d, archive L188); amend message names the actor (done in shift-cash-everywhere), but who amended a sale/return status in older status messages: S4-6#143.

Takeover reconciliation, 28 Oct (6.0.1009): Telegram settings authority and legacy-actor residuals remain open; 1007 does not satisfy the whole obligation.

### Q088

Source: Telegram and notifications · owner-decided

- **Early-Sep ledger leftovers (archive L5953)**: TG-REPORT-DATE-INPUT PARTIAL (the `/report` command refused dd-mm-yyyy input before the owner ruled the whole app day-first, so the refusal now inverts; parser state not stated).

## Permissions

### Q089

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - Admin reset code: an admin-issued one-time code replaces the authenticator-only reset.

### Q090

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - Forced-change neutral copy: the forced password-change screen says "publicly known", which is wrong for a short seeded password; neutral EN/KM wording.

### Q091

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - Review before/after records: a before/after record for every action and a record viewer (owner 14 Oct).

Takeover reconciliation, 28 Oct (6.0.1009): The 27 Oct ruling requires Records on every row/page. Systemic writers, viewers, retention and permissions remain open.

### Q092

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **review-r3 (refute of review-telegram r2 and pending-tag r2; no blocker, no ?fields leak)** · ready

  - F1/F6: creating a request never broadcasts, so the pending tag appears only on the next visit; the ProductDuplicatesTab conflict apply does not refresh. F2: the second removal-alert site is unpinned. F3: `?fields` edge values (empty, array, case, repeated) are not answered 400. F4: more invisible characters to strip (U+2060, U+00AD, U+3164 and similar; keep ZWSP, ZWNJ, ZWJ and Khmer). F5: a retried create, edit or fee delete with the same client_request_id queues two pending rows and two alerts (`createPendingAction` is not idempotent). → *27 Oct: F3 strict `?fields` and F5 idempotent pending actions are lane 6.0.985 (RC2b, deploying).*

### Q093

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **review-r3 (refute of review-telegram r2 and pending-tag r2; no blocker, no ?fields leak)** · owner-decided

  - Also: a false "Products merged" alert on a removal-only conflict review (pre-existing); 30 alerts in 3 seconds have no rate limit; slice A still open (approve-performs-merge, details name, Khmer reader, bounded duplicate F8, 12-alert burst); create-fold must also require `merge_duplicates` (parity with merge-permission-fold, defaults granted per owner 14 Oct). → *27 Oct: approve-performs-merge (slice A) is lane 6.0.985 (RC2b, deploying).*

### Q094

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Security and audit follow-ups (sec-settings r5, sec-sale-time r4, app-session)** · ready

  - Drift-guard hardening: the retention writer scan can be fooled by a dynamic import, a new helper in `lib/audit.ts`, a reused allowlist expression, multi-row VALUES, `.js` files, and migrations are unscanned.

### Q095

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Security and audit follow-ups (sec-settings r5, sec-sale-time r4, app-session)** · needs owner

  - Stock Set undo/redo writes no audit row. Owner questions (all prunable today): promotions, `product/delete` with stock, loyalty `award_points`, whether review rejects matter after 21 days; also award_points and promotion replay receipts after 21 days, a record of the purge itself, and a purge cost that grows.

Takeover reconciliation, 28 Oct (6.0.1009): Backup-created/refused attempts now have an explicit keep-forever ruling. Wider stock audit/retention questions remain open.

### Q096

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Security and audit follow-ups (sec-settings r5, sec-sale-time r4, app-session)** · ready

  - `sale_refused` is missing from the audit vocabulary (Khmer label); the Server page shows an English refusal text; per-user rate limit on refused sales (refusal rows are already collapsed per account, reason and request id per day).

### Q097

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Security and audit follow-ups (sec-settings r5, sec-sale-time r4, app-session)** · ready

  - Courier blind write: an amender with the courier-cost switch off can still write the courier cost through the API (write-side gate).

### Q098

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Security and audit follow-ups (sec-settings r5, sec-sale-time r4, app-session)** · ready

  - NOTE C: `actorReadScope.ts` org field shape flip (interacts with the H7 epochs).

### Q099

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Security and audit follow-ups (sec-settings r5, sec-sale-time r4, app-session)** · ready

  - Remaining non-aborting uploads: product, import and avatar uploads still use wrappers that do not abort.

### Q100

Source: Accounts, sessions and drafts › **account-isolation-2 OPEN (queued after receiving-f1)** · ready

  - server switch does not reset the account (`AppContext.tsx:1903-1909`); import `apiFormPost` server-switch fence only (keep the same-server pin in `privateTransportScope.test.ts:84-90`); server component in actor-scoped pending keys (fee create, transfer run, shift, return/sale mutations, POS carts) with read-new-then-legacy, never delete.

Takeover reconciliation, 28 Oct (6.0.1009): 1002 transport and the 1003 bell actor-reset blocker are related work. Server-switch/pending-key acceptance remains open.

### Q101

Source: Accounts, sessions and drafts › **account-isolation-2 OPEN (queued after receiving-f1)** · ready

  - FeeForm/BranchForm/Branches/FeesPage recompute draft keys per render (partly in DU-B 6.0.34).

### Q102

Source: Accounts, sessions and drafts › **Register** · needs owner

  - P1-ACCOUNT-DRAFTS#7 DONE; Q15#28 / Profile-modal#394 PARTIAL OWNER (full profile page, photo, sign-in linking, OTP/2FA, annotated EN/KM tutorials); Q-DRAFTS2#35 MISSING DEFERRED (server-side cross-device drafts); F54-BOUNDARY#102 and F54-persistent-callback#410 PARTIAL (persistent queryCache/IDB callbacks and already-started results outside the shared HTTP fence).

### Q103

Source: Accounts, sessions and drafts › **Register** · ready

  - F53/F55 (archive L16733, L16741: permission-refresh coalescing; pending offline work across hard runtime changes, moot after offline removal); Z6#180 / Z6-otp-live#238 OPEN (OTP enable/validation live end to end); MAIL-domain#258 OWNER-CONFIRMED14Oct (Resend verified; email/Google details match and no live test requested; owner confirmation is not an end-to-end certificate).

### Q104

Source: Accounts, sessions and drafts › **Register** · owner-decided

  - OAUTH-redirect#259 OWNER-CONFIRMED14Oct (matching details; no live Google test requested); W3 login batching + atomic lockout (`loginLockout.ts:96`, non-atomic read-modify-write) OPEN; customer self-service password reset (P9-6#81, #362, #379) MISSING (staff-issued temporary password is the only path; Telegram share + Resend email chosen 5 Oct; starts after portal-csrf merges; high conflict on `portal.ts`). → *27 Oct: the atomic lockout shipped in 6.0.986 (live, RC1).*

### Q105

Source: Accounts, sessions and drafts › **Legacy ledger leftovers (not in the register)** · owner-decided

  - POSTUPLOAD-RECHECK OPEN (post-upload account/permission recheck; product save actor fence, archive L750); OFFLINE-DRAIN / U-DRAIN#13 OPEN (one-time automatic upload of queued sales/outbox rows, then remove the snapshot/mirror code, the POS checkout gate and copy; owner 26 Sep and 1 Oct; census 29 Sep: 7 uncommitted files, no commits; related F1 snapshot-loop removal in Efficiency).

### Q106

Source: Accounts, sessions and drafts › **Legacy ledger leftovers (not in the register)** · ready

  - SETTINGS-wire-images-idea#349 UNCERTAIN (optional Settings entry point).

### Q107

Source: Accounts, sessions and drafts › **Completeness-pass additions (archive L16735–L16743)** · ready

  - FRESHNESS-FIXES OPEN verify (frontend cache freshness found on 8–9 Sep: an own-user update followed by an unrelated-user update inside the debounce loses the required bootstrap and a payloadless role refresh misses it, experiment `e24fc25e`, fix from `9654562d`; an invalidation during a pending read let the next read reuse stale in-flight work and an old response repopulate the shared cache, fix `538d65ee` in `http.ts`, and a late local fallback can replace a fresher server cache; these SHAs exist only on `archive/*` branches, not on origin/main or the release-2 base, so treat the fixes as not integrated; related F54-BOUNDARY#102 and F53/F55 above).

### Q108

Source: Permissions, review queue, audit and undo › **Review-queue completion plan (OPUS-PLAN-REVIEW-QUEUE-COMPLETION): historical B, C and D shipped in release2e; sliceA and the listed follow-ups remain OPEN** · ready

  - A approve-performs-merge (shared `runIdentityEditFold`, `confirm_merge_into` preview, reviewer merge/image/survivor-price/cost checks, approval inside the merge batch, undo restores identity, Free budget refusal); B mini pending-review tag + shared store (Products, Inventory, Fees, Branches, reasons); C Telegram alert per review + queue route (`reviewAlert.ts`, `requestDefer.ts`, reviewGate, reviewQueue, telegram.ts/telegramLang.ts, Settings). → *27 Oct: slice A is lane 6.0.985 (RC2b, deploying).*

Takeover reconciliation, 28 Oct (6.0.1009): 985 is deployed in RC2b. The extra queued-field/undo-identity owner question remains distinct and unanswered.

### Q109

Source: Permissions, review queue, audit and undo › **Review-queue completion plan (OPUS-PLAN-REVIEW-QUEUE-COMPLETION): historical B, C and D shipped in release2e; sliceA and the listed follow-ups remain OPEN** · needs owner

  - D permission catalog and all copy (permissions-catalog lane 6.0.143–146: D1 packs, D2 editor rows with on/off action rows, D3 defaults after owner, D4 parity test + hidden rows + sign-up toggle). Open owner calls: only changed fields move on a merge (Q1), Free refuses over-budget merge approval (Q3), queue scope beyond today (Q4), Employee defaults union on fresh installs (Q5), hide `security_settings`/`drive_credentials` (Q6), create-fold spelling needs edit permission (Q8), who sees tags (Q9), reject reason in Telegram up to 120 chars (Q10), Website Editor sign-up toggle off (Q11), merge stays off for Employee (Q12).

### Q110

Source: Permissions, review queue, audit and undo › **R2 security review conditions** · ready

  - (OPUS-AREA-REVIEW-R2-SECURITY, PASS-WITH-CONDITIONS): F3 inventory `unlockPricing` discount compare mirror (sub-cent); F4 role-editor descriptions/labels stale, branches add/delete absent from editor (always refused), `inventory:edit_reasons` default mismatch, no Website Editor sign-up toggle → permissions-audit lane; F5 late picker photo upload not owner-bound (attribution only).

### Q111

Source: Permissions, review queue, audit and undo › **R2 security review conditions** · needs owner

  - create-fold lets add-without-edit rewrite barcode spelling (BC-Q8). OPUS-CORRECTNESS-HUNT-R2 H1 SHOULD-FIX: new review refusal codes (`review_action_full_required`, `review_entity_changed`, `review_already_decided`, `invalid_reason`, `reason_too_long`) reach a Khmer reviewer in English (fees-k-frontend covers part).

### Q112

Source: Permissions, review queue, audit and undo › **Register** · needs owner

  - Q14#27 OPEN OWNER (branch-scoped order visibility + per-branch KPI in profile); VIS1#103 MISSING (cashier self / non-admin / all visibility; foundation `389244dc` not an ancestor); Q16#29 PARTIAL (undo broadcasts); Q17#30 / Review-UI-decision-notification#392 PARTIAL (before→after preview of the actual change in the real screen format, submitter notified; N4b apply-first redesign CANCELLED by the 13 Oct queue-first ruling).

### Q113

Source: Permissions, review queue, audit and undo › **Register** · ready

  - AUDIT-PER-RECORD#18 PARTIAL; AUDIT-FILTER-CAP#20 PARTIAL (cheap: cap values per filter, `auditLogQuery.ts:208-216`); K1#169, K1-create-delete#221, K1-scopes#222, K1-remaining#383 PARTIAL (server undo/redo appliers missing for contacts, files, lookups, users/roles, settings, fees, sale/return create); UNDO-status-conflict#322 DONE.

Takeover reconciliation, 28 Oct (6.0.1009): The Records programme requires applies-to dates and audit completeness; the named subparts remain open.

### Q114

Source: Permissions, review queue, audit and undo › **Register** · needs owner

  - K6#171 DONE; PERM-action-editor#244 PARTIAL (direct per-action admin selection, preset bundles; BC-Q12); Custom-permissions#391 PARTIAL (reject unsupported combinations, `users.ts:1014-1075`); SECURITY-SETTINGS#41 UNCERTAIN OWNER (keep or remove the unused key); REPAIR-permission-rule#247 UNCERTAIN OWNER (`POST /repair-integrity` backup-or-settings gate).

Takeover reconciliation, 28 Oct (6.0.1009): Resets, restore and factory reset require backup_restore plus password. Broader catalog and repair permission scope remains open.

### Q115

Source: Permissions, review queue, audit and undo › **Register** · ready

  - PERM-library-fallback#270 UNCERTAIN (transitional "Full library OR settings"); PERM-import-contradiction#297 PARTIAL; REVIEW-source-sections#291 PARTIAL (source-page grouping, device/user/time identity in approval/audit/users); HISTORY-scope-example#271 UNCERTAIN; CONTACT-compare-review#334; N3 import-authority step 2 root-only (re-check inside the final-deactivate commit guard, donor per-row-group/rename guards, frontend Confirm/Retry that will 403) PARTIAL.

### Q116

Source: Permissions, review queue, audit and undo › **Register** · needs owner

  - Wide-Records-cascades#407 PARTIAL; permission deep-walk (archive L9374, L8614, L9385) legacy-OPEN; Organization-concept removal ORG-removal#306 OPEN OWNER (audit read sites before removing or hard-coding the default business); donors PERM-PROMO-DISC `86c3a2fb3`, PROD-PERM `c7d8529ee` PARTIAL.

Takeover reconciliation, 28 Oct (6.0.1009): Records on every row/page is answered. Visibility, retention, cascades and organisation removal remain open.

### Q117

Source: Permissions, review queue, audit and undo › **Correctness hunt R2 follow-ups (OPUS-CORRECTNESS-HUNT-R2, 13 Oct 09:15Z; no blocker)** · ready

  - H3 OPEN (an approved review's exact discount differs from the direct-edit rounding: review-queue slice A); H7 OPEN (a same-user network blip causes a permission refresh and `resetActorReadSession`, which locks the Fee/Branch forms with a false "account changed" and drops typed text: fees-k-frontend 6.0.158–160 puts a shared `useFrozenDraftAuthority` on the write identity, also efficiency A6).

Takeover reconciliation, 28 Oct (6.0.1009): 1002/1003 address the current account-scope incident; earlier Dashboard sign-in fixes do not close this obligation.

### Q118

Source: Permissions, review queue, audit and undo › **Correctness hunt R2 follow-ups (OPUS-CORRECTNESS-HUNT-R2, 13 Oct 09:15Z; no blocker)** · ready

  - H6 dead SQL tails in `getSalesGroupedTotals` and `getProductSalesRanking` go to money-surfaces (6.0.161).

## Public site

### Q119

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - Returns policy page: 7 days, unopened, with receipt, same as the store.

### Q120

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - Storefront minimum age 16.

### Q121

Source: Public website, storefront and membership › **Rulings not yet in code** · owner-decided

  - W-SITE#39 PARTIAL — `frontend/index.html:16` sets `maximum-scale=1, user-scalable=no` for every host (owner: zoom on public only); no footer/About independent-retailer line; thorough minimalist EN/KM overhaul; W-ADMIN#40 OPEN (admin landing in the same design language).

### Q122

Source: Public website, storefront and membership › **Rulings not yet in code** · needs owner

  - P9-3#78 PARTIAL (stale policy text "official distributors", "Business OS" wording in FAQ/privacy copy: `faqStarterText.ts:17,36`, `en.json:3571,3631,3659`, `km.json:3571`, `portalContentI18n.ts:59`; do not touch `legalContent.ts:118`), P9-4#79 assistant chat-box first MISSING DEFERRED, P9-5#80 featured/trending/bestseller on the front page PARTIAL DEFERRED (the Worker never sends ranks; BC-Q23b), P9-6#81 customer forgot-password MISSING.

### Q123

Source: Public website, storefront and membership › **Rulings not yet in code** · needs owner

  - P10-20-PUBLIC#76 OPEN OWNER (rows per page change under the exception); PORTAL-EDITOR#85 DONE; PREVIEW-PROMOTIONS#86 MISSING (Website Editor preview builds `catalogTabProps` without `promotionRules`, `CatalogPage.tsx:3139`); PREVIEW-PAGESIZE#93 MISSING (shared localStorage key); PORTAL-OLD-SHOP-NAME#203 / A6-portal-data#242 OWNER (production portal businessName/title/intro/submissionInstructions only through owner-authorised editing).

### Q124

Source: Public website, storefront and membership › **Rulings not yet in code** · needs owner

  - PORTAL-structured-details#286 PARTIAL; PORTAL-preferences-scope#308 PARTIAL (anonymous theme/language persistence, install/download presentation; BC-Q23a); PORTAL-sticky-pagesize-live#309, PORTAL-embedded-cache#360 UNCERTAIN (reproduce first); PORTAL-grouped-pagination#361 SUPERSEDED; PORTAL-guest-accounts#362 PARTIAL; PORTAL-small-targets#318 OWNER.

### Q125

Source: Public website, storefront and membership › **Rulings not yet in code** · needs owner

  - SCAN-public-decision#302, SCAN-editor#303 OWNER (camera barcode search for shoppers; recommended-products scanner); K7-portal#226; DNS-old-domain#260 OWNER (old `leangcosmetics` domain redirects need DNS on Cloudflare); CONTENT-stories#265, Stories/posts/comments#389, Canva-like promotions editor#396, PROMO-editor-deferred#245, CANVA-PROMOTIONS#205 DEFERRED.

### Q126

Source: Public website, storefront and membership › **Rulings not yet in code** · owner-decided

  - Part535 translations#380 DONE; Portal Contact us#395 CLOSED; sign-up toggle in Website Editor (R2 F4, plan slice D4) OPEN; portal membership lookup disabled by policy (keep).

## Platform & ops

### Q127

Source: Consolidation lanes (last recorded state 19 Oct) · ready

- [~] **CONSOL-RECONCILE — full task ledger:** stable requirement/source/test/donor/release/acceptance mapping is underway. Inventory count sessions are in progress and image-only received-date filters remain queued; date/session/baseline/customer decisions are settled; their composed implementation and acceptance remain open. Physical devices/PWA, licence/compliance, broader correctness/performance and safe cleanup remain OPEN/HOLD. Preserve the entire historical queue below; old MISSING or checked rows need current evidence.

Takeover reconciliation, 28 Oct (6.0.1009): This reconciliation preserves all 212 IDs. The full requirement/code/test/release/acceptance audit remains partial.

### Q128

Source: Consolidation lanes (last recorded state 19 Oct) · ready

- [~] **CONSOL-J — executor authority and import recovery:**809–811 have bounded Astra GO. A six-case role/reassignment/policy/cancel matrix passes, with synthetic-policy and queue-entry limits recorded.812 adds a phase/status comparison inside the existing atomic lease claim: actual811 review bypass is now refused without changing product, review, audit, stock or cache; separate fresh approval succeeds. Twelve production-SQL controls and two deliberately wrong implementations distinguish phase admission from a stale status read. Generic product Free budgets remain a confirmed gap: actual inline start55/approve77 attempted statements exceed the configured50. Same-phase stale runs, ambiguous queued/failed intent, expired holders, staging/DLQ publication and full lost-ACK recovery remain OPEN. Final combined gate, Astra composition and production acceptance are pending.

### Q129

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - sheetjs-0.20: 0.20.3 is approved and verified (tarball 2,409,319 bytes, vendored untracked in the sheet worktree). Parity found 30 of 30 .xlsx and 8 of 16 .xls identical; 8 legacy HTML-as-xls differ (numeric cells keep leading zeros, text cells gain spaces around separators, a few text cells become ISO dates) and the `t="d"` date reader reads one day early. Rework the reader, normalise the HTML-export whitespace, decide leading-zero handling (barcodes benefit), re-run parity; then commit PART B separately.

### Q130

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - LICENSE file: "All rights reserved — Leang Cosmetics".

### Q131

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Owner-decision lanes (14 Oct)** · owner-decided

  - Offline queue removal slices S0, S5, S6 (tills drained; unblocked).

### Q132

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Efficiency (Free 50-statement paths) and hygiene** · ready

  - Free-plan paths over 50 statements: the conflict review loop alone, Dashboard startup at about 4.2k sales (view-more lists now 2–3 statements after the card); lanes E-TG, E-RET, E-ECHO, E-SNAP, E-PUT, E-STOCKIN, E-CLEAN stay queued behind slice A.

Takeover reconciliation, 28 Oct (6.0.1009): 1001–1008 cover related work. The current ceiling counts physical D1 calls; historical statement observations remain evidence, not a whole-app Free certificate.

### Q133

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Efficiency (Free 50-statement paths) and hygiene** · ready

  - Comments sweep: mechanical comment cleanup per package (517 to shorten, 50 to remove, the 4-decimal rule stated once), then the tokenizer strip; also one raiseIfSql builder (59 copies), casts through unknown, storage-key constants exported once, shared late-picker queue, BranchField, i18n duplicate-key check (516 duplicate keys per pack), productIdentity LIMIT 200 group cap, importEngine NaN delta, hard-coded Telegram 2000.

### Q134

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Efficiency (Free 50-statement paths) and hygiene** · ready

  - fees-k leftovers N1, N4, N5, N6 and the ProductForm duplicate-warning state; storefront leftovers (pattern filter not exact, unused assistant* keys, stored FAQ text in production settings may still promise something).

### Q135

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Data and platform** · ready

  - K8b needs migration number 0249 or later (pending_actions requested_device_name/_tz; 0250 is now taken by the multilot watermark, so pick a free number against `d1_migrations` and every ref's files).

### Q136

Source: Release 3 queue (opened 14 Oct from the "release 3" items in Records/Recovery/LANES.md since 13 Oct 22:40Z) › **Data and platform** · owner-decided

  - Privacy purge of history (scrub and force-push after the lanes merge; keep the private mirror), see Privacy below; repository private later (owner 14 Oct).

### Q137

Source: UI, mobile and device acceptance › **Owner daily-use UI (DU-A/B/C)** · owner-decided

  - DU-B landed (newest-first lots, sole-branch chip, fences, 6.0.30–35, 6.0.90). **DU-C OPEN (queued after DU-A)**: `ProductsImageOnlyView:227` lot order, StockSessionLineEntry `isComposing` guard, inputMode/visual-viewport pins, ProductForm `<form>`/Enter, Modal keyboard opt-in + focus trap/restore (FastStockInModal Esc), image preview/save/reopen mounted test + Safari compression fallback test, EN/KM `new_batch`/`open_files`/`export_format_excel` [HAIKU-DAILY-USE-COVERAGE]. Remaining sole-branch chip sites per OWNER-BRANCH and Haiku map (ManageBatchesModal, VariantFormModal, NewSupplierReturnModal, POS CartItem, POS ProductDetailSheet) were widened into DU-B: verify composed.

Takeover reconciliation, 28 Oct (6.0.1009): UI requests remain open; each changed surface/version needs prototype approval before application.

### Q138

Source: UI, mobile and device acceptance › **Physical devices (DEVICE, owner action; NOT RUN)** · needs owner

  - P1-PHYSICAL#5, Physical-authenticated-acceptance#404 — iOS/Android camera and library photo (preview immediate, survives save/reopen), HEIC from library, native keyboard and Add/Remove/Set, installed-PWA restart bar, Android back, printing, installed-PWA lifecycle; checklist `Lanes/2026-10-12/OWNER-DEVICE-ACCEPTANCE-RECEIVING.md` (steps 1–12 for release 1). Owner has not tested the live photo fix on a phone.

Takeover reconciliation, 28 Oct (6.0.1009): Physical iOS/Android/PWA acceptance remains open and distinct from desktop simulation.

### Q139

Source: UI, mobile and device acceptance › **Open owner-UI register** · ready

  - P1-OWNER-UI#6 PARTIAL umbrella; RESPONSIVE-PASS#71 / ADMIN-responsive-live#317 PARTIAL (full compact, mobile, public, portal pass); VISUAL14#104 PARTIAL (14-reference pagination/precision/security matrices); QA-initial-live#316, QA-page-pass#358, UI-label-live#300, MODAL-live#305, ROLE-live#307, SYNC-live#301 OPEN live verification after deploy.

Takeover reconciliation, 28 Oct (6.0.1009): Responsive/live acceptance remains open; visible changes need versioned prototype approval.

### Q140

Source: UI, mobile and device acceptance › **Open owner-UI register** · ready

  - Q-MINIMIZE#16, F3-DRAFT-CHROME#168, F3-tabs#216 PARTIAL (only 14 flow kinds can park; about 30 dirty-state modals cannot; universal minimize for the other 24 draft modals, one modal per slice, last); S4-20#148 PARTIAL (Save at page end, minimize across forms); S4-21#149 PARTIAL (shared Discard/Back contract; QuickAddModal has no guard). → *27 Oct: the QuickAddModal guard shipped in 6.0.987 (live, RC1).*

Takeover reconciliation, 28 Oct (6.0.1009): Minimize, close and unsaved-work behavior remain open; each affected float needs prototype review before change.

### Q141

Source: UI, mobile and device acceptance › **Open owner-UI register** · needs owner

  - S4-22#150 PARTIAL (global Khmer line-height/clipping); S4R4-11#426 PARTIAL (sale-detail scan button); S4R4-7#424, S4R4-8/9#425 DONE; B1-STATS#164 / B1-stats-sweep#211 PARTIAL; N3a/N3#174, N3-palette#219 OWNER (palette confirmation), N3-section-sweep#220 PARTIAL (SectionCard rows page by page); Y16#177 / Y16-toolbar#232 PARTIAL (History/Manage join the chip row on six hubs).

Takeover reconciliation, 28 Oct (6.0.1009): Khmer, palette and toolbar scope remains open. Preserve current typography; changed layouts need packet approval.

### Q142

Source: UI, mobile and device acceptance › **Open owner-UI register** · needs owner

  - Z5#179 / Z5-currency#235 PARTIAL (currency-symbol contrast), Z5-receipt-settings#236 OWNER, Z5-live-check#237; Z7#181 / Z7-spacing#239 UNCERTAIN; SELECTION-columns#344 PARTIAL, SELECTION-header-conflict#345 SUPERSEDED; STATSTRIP-DORMANT-DATE#124 MISSING (close: precondition unmet); ADVISORY-ANCHOR#89 and LAYER-REASON-INLINE#186 UNCERTAIN (need a render).

### Q143

Source: UI, mobile and device acceptance › **Open owner-UI register** · needs owner

  - TOUCH-TARGETS#189 MISSING OWNER (BC-Q24: 44px on touch only?); PAGER-visual-check#293; PAGESIZE-KEYBOARD#95 SUPERSEDED; ZERO-PAGER#94 DONE; UI-theme-audit#269 UNCERTAIN; SETTINGS-visual#290 UNCERTAIN; Profile-modal-redesign#394 UNCERTAIN; Archived-visual-verification#386 OPEN; Thumbnail-simultaneous-detail#387 OPEN (verify with a real image).

Takeover reconciliation, 28 Oct (6.0.1009): Touch, pager and theme checks remain open. Products remains the first shared-style checkpoint.

### Q144

Source: UI, mobile and device acceptance › **Open owner-UI register** · needs owner

  - VIEWER-LOCALE-SURVIVORS#187 PARTIAL (day/numeric grouping in sync, banner, branch, backup, audit, export); K7-path-input#228 PARTIAL (backup path input width: owner must point at the input); Q18#31 UNCERTAIN OWNER (short display ids, BC-Q15); I18N-GOOGLE-LOGIN#161, I18N-ORPHAN-KEYS#160, I18N-unused-km#268, Unused-i18n-keys#393 (see Docs).

### Q145

Source: UI, mobile and device acceptance › **Open owner-UI register** · ready

  - NATIVE-DIALOG-SWEEP#191 / CONFIRM-SWEEP#121 PARTIAL (11 native alert/prompt sites remain: ProductForm x6, PrintSettings x2, Receipt, ReviewQueue, Settings; needs an input dialog; U-confirm); ASYNC-UNMOUNT-TIMERS#190 PARTIAL; PERMISSION-UI-HIDING#128 PARTIAL (Add/Edit controls for users without contacts add/edit: `CustomersTab`, Suppliers, Delivery tabs). → *27 Oct: PERMISSION-UI-HIDING#128 shipped in 6.0.987 (live, RC1).*

### Q146

Source: UI, mobile and device acceptance › **Open owner-UI register** · needs owner

  - STAT-FOLD-PERSISTENCE#129 UNCERTAIN; DEFAULTS-unnamed#292 OWNER; U1 backlog: rows per page (current defaults accepted, 1 Oct), N44 input sizing, cross-page consistency checklist (archive L8862), request batches of 18 and 20 Aug (archive L8297, L8156: re-triaged in the register).

### Q147

Source: UI, mobile and device acceptance › **Legacy ledger leftovers (not in the register)** · ready

  - SW-OPEN-RESIDUALS OPEN (service-worker stale-shell residuals: redirect dropping the query, un-aborted timed-out fetch, 200-HTML interstitial caching, archive L638); STOREFRONT-404 OPEN (one unidentified console 404 on the storefront after deploy, archive L1750).

### Q148

Source: UI, mobile and device acceptance › **Legacy ledger leftovers (not in the register)** · needs owner

  - SW-LIVE-SMOKE, SMOKE-ENDSHIFT, PHYSICAL-PRINT, P4-IOS-LAG DEVICE (legacy browser upgrade warm-reload proof; signed-in POS End Shift smoke; physical receipt print with the driver-forms default of the four Print Settings modes; iOS PWA lag re-measure after wave 2); P4-KM-DUPKEY OWNER (Khmer for `contact_duplicate_will_use_existing` composed in-file, needs a native-speaker check).

Takeover reconciliation, 28 Oct (6.0.1009): Owner-device smokes remain open. A successful deployment with bot challenges is not physical acceptance.

### Q149

Source: UI, mobile and device acceptance › **Legacy ledger leftovers (not in the register)** · ready

  - KHMER-WORKBOOK-4 HOLD (four whitespace-only Khmer workbook edits intentionally held: JSX supplies the separators); PW-EXPECTED-RED PARTIAL (Playwright findings not fixed: blocked-site-data login, bootstrap prefetch catch, iOS 16px inputs, account-handover POS filters, Vary: Accept, English last_error); COMPACT-PUBLIC-POLISH OPEN (broad compact/public/customer-portal visual polish).

### Q150

Source: UI, mobile and device acceptance › **Legacy ledger leftovers (not in the register)** · needs owner

  - OWNER-ADDS-SEP7 PARTIAL (same-session duplicate feedback, sale-row eye removal, branch-vs-total stock alert parity, action minimization/permissions, gross/net clarity); F49-BROWSER-API OPEN (deprecated browser API console warning attribution); STAFF-DATE-TYPING OWNER (tell counter staff that typing 9032026 now means 9 March, day-first).

### Q151

Source: UI, mobile and device acceptance › **Legacy ledger leftovers (not in the register)** · ready

  - DEBLOAT-I18N-927 OPEN (927 dead i18n keys about 160 KB queued behind FX-ui; unused is not dead, list for the owner); RETAINED-UI-REQUESTS#111 PARTIAL (delivery-contact rename parity, stock reason presets, 375px Products overflow); SCAN-sales-returns-live#304 OPEN (live check of the new Sales/Returns scan placement and camera flow).

### Q152

Source: UI, mobile and device acceptance › **Completeness-pass additions (archive L6544–L16757)** · ready

  - PARITY-SWEEP OPEN (every capability must exist on every surface that plausibly needs it; the named gap is POS quick-add creating plain contacts while the full contact forms support multi-option contacts; sweep POS quick-adds, manual add-stock vs import validation, receive-batch vs the §12 rules, edit forms vs import normalisers, and list every gap as its own item before fixing: Track F, archive L6861, L10483).

### Q153

Source: UI, mobile and device acceptance › **Completeness-pass additions (archive L6544–L16757)** · needs owner

  - QA-TRACK-E DEVICE (infra-dependent live checks: `wrangler tail` during a real transfer, reset, backup and import to watch D1 write contention and a Free-plan CPU trip, a real-device responsive pass, and a concurrent two-tab edit race on the same product or branch stock, archive L10481).

### Q154

Source: UI, mobile and device acceptance › **Completeness-pass additions (archive L6544–L16757)** · ready

  AUG25-BATCH-LEFTOVERS UNCERTAIN verify (Aug 25–27 request batches, no closure found in the ledger: POS group-option display and picking for the "multiple pricings" request, related POS-price-condition-picker#347, archive L13672; import CPU efficiency, whole-CSV re-decode per window and sales re-partition per chunk, archive L13677; the message `Write blocked - server unavailable (operation: data:reset)` was reported and never investigated, archive L13504; `mode='all'` reset cleans R2 with a blanket prefix wipe instead of exact keys, related N7 dataset lifecycle, archive L13168).

### Q155

Source: UI, mobile and device acceptance › **Early-Sep UI leftovers (archive L3208, L5415, L6113)** · ready

  - PRODCARD-MOBILE-DESC OPEN (hide the inline mobile-card description, `ExpandableDescription` at `Products.tsx:3442`); S4-26-VISUAL DEVICE (reports hub density was verified only from emitted CSS, not visually, because rc worktree previews serve the main checkout); S4-33-AMEND-RECHECK OPEN (re-check that the S4-30 amendment ledger shows dates day-first).

### Q156

Source: UI, mobile and device acceptance › **Early-Sep defect lists (Part 549 / Part 539 / Part 77, archive L6435–L6492; verify each against current code)** · ready

  - layering HIGH — InfoHint `z-[1000]` renders under Modal `z-[1050]` (move to `z-[1055]`); InventoryReasonManagerModal (RenameCascadeModal was fixed in `352ed476`) `z-50` are buried; about 19 inline `fixed inset-0` overlays and the `Sidebar.tsx:498` backdrop remain.

Takeover reconciliation, 28 Oct (6.0.1009): Shared-layer fixes remain open; visible dialog/guard changes need prototype approval.

### Q157

Source: UI, mobile and device acceptance › **Early-Sep defect lists (Part 549 / Part 539 / Part 77, archive L6435–L6492; verify each against current code)** · ready

  - Date and locale sites — `App.tsx:1253`, `Branches.tsx:270`, `Backup.tsx:708`, `AuditLog.tsx:164/184`, `inventoryExport.ts:119`, `recordFilters.ts:59` (UTC midnight) and `.toLocaleString` digit grouping (tracked as VIEWER-LOCALE-SURVIVORS#187). the mouse-wheel number-input guard `e273e127` is already in the base (DONE); POS touch targets under 40px (#189).

### Q158

Source: UI, mobile and device acceptance › **Early-Sep defect lists (Part 549 / Part 539 / Part 77, archive L6435–L6492; verify each against current code)** · ready

  - 10 unguarded fetch-then-setState sites and 6 uncleaned timers (#190); 65 native confirm/prompt/alert calls (#191); Part 539 LOW — POS needs a reload to see changed settings.

### Q159

Source: UI, mobile and device acceptance › **Early-Sep defect lists (Part 549 / Part 539 / Part 77, archive L6435–L6492; verify each against current code)** · ready

  - storefront sign-up with a blank membership uses a native `window.confirm`. Part 77 MEDIUM (review-tier bypasses, offline-sale timestamps and Suppliers/Delivery sort were fixed) — still open: import-review parity, failed-job "Queued 0%" (offline-sale timestamps are moot after the offline removal; Suppliers/Delivery sort and pagination were fixed in `92648cef`).

### Q160

Source: Efficiency, performance and Free/Paid › **Release-2 efficiency review (OPUS-EFFICIENCY-REVIEW-R2, COMPLETE 13 Oct 09:05Z, no blocking bug)** · ready

  - W1 P2 `PUT /api/products/:id` reads the same row 7–8 times before one write (`products.ts` 2413–2507, `productWrites.ts:140`); W2 P1 on Free — legacy v0 customer return create/edit does per-line N+1 capacity reads duplicating a set-based check; W3 P1 on Free — Telegram overview and /report re-read the same sales snapshot up to five times per message.

Takeover reconciliation, 28 Oct (6.0.1009): 1001/1007 are related read reductions. Each named efficiency and behavior subpart still needs evidence.

### Q161

Source: Efficiency, performance and Free/Paid › **Release-2 efficiency review (OPUS-EFFICIENCY-REVIEW-R2, COMPLETE 13 Oct 09:05Z, no blocking bug)** · ready

  - W4 P2 every report snapshot does two full read passes plus three restore checks (one D1 batch is already a consistent snapshot); W5 P3 duplicate reads in the identity-fold and approval paths; A1 `removeStockFromBatch` superseded in production code; A2 six hand-rolled 4-place rounders with two half-way rules; A3 the L4 goods-profit rule exists in three shapes.
  - A4 "exactly one row changed" guard pasted 9 times; A5 second AsyncLocalStorage/WeakMap/global hook to carry the device.

### Q162

Source: Efficiency, performance and Free/Paid › **C3v2 data-architecture plan (27 Sep; every change measured A/B, KV flag, rollback in about 60 s; `Records/Performance/2026-09-25/claude/C3v2-data-architecture-plan.md`)** · owner-decided

  - A0 metrics (per-request rows_read/rows_written/statements/ms in Server-Timing and Analytics Engine) PARTIAL; A1 hygiene (awaited broadcasts → waitUntil, awaited cache-version bumps, ETag/304) OPEN; A2-RETENTION#45 PARTIAL (`job_runs` table; retention must skip every FK/JSON-referenced `action_history` row, never expire `undo_snapshots`; owner ruling keeps expenses and reverts forever; `ephemeralRetention.ts:233`).

### Q163

Source: Efficiency, performance and Free/Paid › **C3v2 data-architecture plan (27 Sep; every change measured A/B, KV flag, rollback in about 60 s; `Records/Performance/2026-09-25/claude/C3v2-data-architecture-plan.md`)** · ready

  - A3-CATALOG#46 PARTIAL (one scan per page, parallel stock reads, cached filters); A4-DASHBOARD#47 PARTIAL (20 s startup cache keyed by permissions + versions); A5-SEARCH#48 UNCERTAIN (Khmer tokenizer probe, FTS only if confirmed); A6-THUMBNAILS#49 PARTIAL (wire w160/320/640 + srcset, orphan audit report-only); A7-R2-LIFECYCLE#50 UNCERTAIN (imports 7 d, quarantine 30 d, aborted multipart 1 d, backups in their own bucket).

Takeover reconciliation, 28 Oct (6.0.1009): Dashboard freshness is settled: at most five minutes old, with calculation time and prepared figures. 1001 implementation/certification remains open.

### Q164

Source: Efficiency, performance and Free/Paid › **C3v2 data-architecture plan (27 Sep; every change measured A/B, KV flag, rollback in about 60 s; `Records/Performance/2026-09-25/claude/C3v2-data-architecture-plan.md`)** · needs owner

  - A8-READ-MODELS#51 UNCERTAIN (only if 7 days of A0 numbers cross thresholds); F1 remove the leftover offline snapshot loop (11 serial requests per device every 5 min, results discarded) OPEN; F2 Durable Object auto-pong and pause polls while the tab is hidden, F3 stop pre-downloading every route on deploy OPEN; B1 backups keyset paging instead of OFFSET, full backup at 03:00 local, separate backups bucket (owner decision) OPEN.

Takeover reconciliation, 28 Oct (6.0.1009): Free external encrypted backups are selected. Bucket, schedule, assets, recovery and other architecture subparts remain open.

### Q165

Source: Efficiency, performance and Free/Paid › **C3v2 data-architecture plan (27 Sep; every change measured A/B, KV flag, rollback in about 60 s; `Records/Performance/2026-09-25/claude/C3v2-data-architecture-plan.md`)** · needs owner

  - W1-W2-W3#53 PARTIAL (sale create 18–20 D1 trips → 3–4, report reader one-batch snapshot, login batching); PROD-Q1-Q9#52 DATA (read-only production counts via ops d1-export); MEASURE-TOKEN#54 OWNER (Account Analytics Read scope); V-location (every binding and external call checked for distance from Cambodia) PARTIAL; PD-1 precomputed search/catalog read model (archive L317) OPEN.

### Q166

Source: Efficiency, performance and Free/Paid › **C3v2 data-architecture plan (27 Sep; every change measured A/B, KV flag, rollback in about 60 s; `Records/Performance/2026-09-25/claude/C3v2-data-architecture-plan.md`)** · ready

  - U-receipt duplicate receipt numbers possible (no UNIQUE since 0107, probe outside the batch) OPEN; PD-1 audit lanes I1–I10 and adversarial audits A1–A3 of Codex work (archive L368–L380) historical, reports in `Records/Performance/2026-09-25`.

### Q167

Source: Efficiency, performance and Free/Paid › **Release-3 efficiency lanes (OPUS-EFFICIENCY-REVIEW-R2 queue, disjoint file sets)** · ready

  - E-TG (W3: Telegram overview and /report read the sales snapshot once; after shift-cash lands; `telegram.ts`); E-RET (W2 set-based v0 return capacity + F2 returns PATCH refetch; `returns.ts`, `Returns.tsx`); E-ECHO (F1: every write re-read 2–4x, writeId on every channel; AppContext and page sync handlers); E-SNAP (W4: single-batch report snapshot, measure first; `salesAnalytics.ts`).
  - E-PUT (W1/W5: product PUT row reads; after review-queue slice A); E-STOCKIN (W6: stock-in one line per request on Free); E-CLEAN (A1–A6: delete `removeStockFromBatch`, one `roundPlaces`, shared costViewProfit, shared one-row-changed guard, one device context, frozen-draft block); also I1 identity lookup unindexable (migration, owner-scheduled), I2 audit insert session sort, C1 expense delete never sends `expected_updated_at` (in fees-k-frontend).

### Q168

Source: Efficiency, performance and Free/Paid › **Register** · ready

  - P1-SW-FALLBACK-LIMITS#4 PARTIAL (forever-pending storage operations, install/activation failures); PERF-CPU-WORKLOAD#65 DATA (real Free-account measurement, 500 MB check, daily read budget); PERF-7-SITES#188 PARTIAL (non-sargable report/stat/audit WHERE, audit indexes); PERF-inventory-summary#250 (`inventory.ts:759` unpaged `SELECT p.*`), PERF-customers#251, PERF-sales-date#252, PERF-returns-date#253 (`datetime(col)` windows) PARTIAL (measure p95 first).

Takeover reconciliation, 28 Oct (6.0.1009): Actual CPU, storage, daily consumption and result-size measurements remain open; fewer calls alone is insufficient.

### Q169

Source: Efficiency, performance and Free/Paid › **Register** · ready

  - SEARCH-movement-diacritics#254 MISSING (33 scattered INSERT sites; practical loss nil); STATS-status-conflict#323; A4a-paid#207 OPEN (Paid `cpu_ms` 300000 and queue batch 5 re-basing; continuation unlock M4); K4#170, K4-live-staging#223, K4-sentry#224, K4-remaining#382 PARTIAL (live R2 NDJSON staging; Sentry beyond reportError).

### Q170

Source: Efficiency, performance and Free/Paid › **Register** · ready

  - K7#172, K7-perf#225, K7-portal#226 PARTIAL; UMBRELLA#182 OPEN (media policy, storage/job hardening, final gate); STORAGE-baseline#327 OPEN; JOBS-finite-other#328; D1-contention-conditional#319 UNCERTAIN (only on a real recurring thrown error); SENTRY-X#73, SENTRY-6#74, SENTRY-1F#75 OPEN (D1 CPU limit 58 events; expression tree too large; product identity review).

### Q171

Source: Efficiency, performance and Free/Paid › **Register** · needs owner

  - SENTRY-decision#262 OWNER; BLOAT-DEFERRED#119 PARTIAL (FTS optimize, portal screenshot GC, upload/orphan GC); PRELOAD-DEFERRAL#70 DONE; P1-FREE-REUSE#3 DONE; OWNER-PLANS (Free/Paid both profiles build; storefront budget unchanged); Free-plan budgets: restore 38 and add-items 41 statements near the 50 limit.

Takeover reconciliation, 28 Oct (6.0.1009): Sentry, GC and budget-edge questions remain open. Separate Free/Paid profiles and no silent switch are retained.

### Q172

Source: Efficiency, performance and Free/Paid › **Legacy ledger leftovers (not in the register)** · needs owner

  - FREE-CAPACITY OPEN (actual CPU/query/storage/daily budgets for the Free plan; restore dependency discovery exceeds the Free query budget, archive L665); INC-FREE-READY OPEN (Free-plan readiness unfinished; Free and Paid stay separate profiles, never switched silently, archive L187); P1-RULINGS-FREE OWNER (non-blocking: free-account measurement deploy, live D1 size read vs the 500 MB cap, bulk re-import about 150k writes vs the 100k/day cap, last_error_code migration, archive L1933).

Takeover reconciliation, 28 Oct (6.0.1009): The 30 Oct Free switch, no extension and external backup strategy are settled. Readiness, measurement, recovery and deployment approval remain open.

### Q173

Source: Efficiency, performance and Free/Paid › **Legacy ledger leftovers (not in the register)** · ready

  - U-SYNC PARTIAL (sync coalescing, useSyncReload, PageSlot memo, NotificationContext, hidden-tab timers: phase 1 done, refuter was running, shipping not seen, archive L305); C3V4-NEWITEMS OPEN (tab-return fan-out, checkout triple reload, dashboard refresh per sale, stock-in commit batching, version bumps into the D1 write batch before the money cache, W2 7-day shadow compare; `Records/Performance/2026-09-27/C3v4-council-synthesis.md`).

Takeover reconciliation, 28 Oct (6.0.1009): 1002 contains related sync coalescing; latest-delta review, composition and adoption remain pending.

### Q174

Source: Efficiency, performance and Free/Paid › **Legacy ledger leftovers (not in the register)** · ready

  - P4-WAVE2 PARTIAL (inventory `/adjust` round trips, contacts create audit, stockSession pre-reads, returns N+1, batches audits, products FTS fallback, archive L1892); CP3B1-F3 OPEN (F3 rework held after R-F1F3 was not certified; stop pre-downloading every route on deploy).

### Q175

Source: Efficiency, performance and Free/Paid › **Early-Sep ledger leftovers (archive L3475, L6435, L6444; verify)** · ready

  - D1-BLOAT deferred (FTS optimize, portal-screenshot GC, `uploads/` orphan GC, `inventory_movements` retention); 36 non-sargable `date(created_at)` sites and the movements-search REPLACE chain (Part 77), of which 7 hot ones are `returns.ts:492`, `sales.ts:1758/1774` and three audit-log retention sites (sargable lanes `67b8e3b9`, `3c36bfba`, `60df8ba0`, `bd2f0680` fixed contacts/compat and some sites; the `sales.ts` datetime wrap is deliberate, archive L16612).

### Q176

Source: Efficiency, performance and Free/Paid › **Early-Sep ledger leftovers (archive L3475, L6435, L6444; verify)** · ready

  - `audit_logs` has no indexes; unpaged reads and N+1 (also in Returns).

### Q177

Source: Efficiency, performance and Free/Paid › **Completeness-pass additions (archive L14894)** · ready

  - F58-CHUNK-POLICY OPEN (isolated frontend chunk-policy candidate `57854fd6` cut measured asset loading and removed static import cycles; independent certification and integration were pending and it was excluded from the 8 Sep small release; the SHA exists only on `archive/*` branches).

### Q178

Source: Privacy, security and secrets › **Owner-requested audits (13 Oct)** · owner-decided

  - **Reports COMPLETE (13 Oct), follow-ups OPEN**: OPUS-SECURITY-AUDIT-WHOLE-APP covers11 checklist areas (7 MEDIUM findings); LICENSE-AUDIT inventories shipped/dev dependencies, assets and terms. Their original candidate was `dde1ba879`; the reports do not certify current code. The owner settled the project licence on14 Oct: proprietary, all rights reserved. The LICENSE file, package metadata, THIRD_PARTY_NOTICES and remaining remediation stay in Release3.

Takeover reconciliation, 28 Oct (6.0.1009): License/security follow-ups remain open; RC3 deployment does not certify whole-app compliance.

### Q179

Source: Privacy, security and secrets › **Owner-requested audits (13 Oct)** · ready

  - COMPLIANCE-GAP-REVIEW is **COMPLETE (13 Oct)**: Cambodian commerce, consumer/data/cookie, invoice, cosmetics, accessibility and third-party gaps are mapped to code, owner information or professional review. This technical report is not legal advice. Its unresolved code/content and external actions remain in Release3 and Owner/external actions; completed research is not completed remediation. [QUEUED-BRIEFS-2026-10-13]

### Q180

Source: Privacy, security and secrets › **Public-repo customer data (owner Option 3, not urgent)** · owner-decided

  - Q21#34 MISSING — customer names/phones remain in tracked docs (old `progress.md`, four lines of `docs/history/session-log.md`) and in git history. Steps: (1) this rewrite removed them from `progress.md`; (2) scrub `docs/history/session-log.md` (use ids); (3) after the current lanes merge, purge history (force-push; breaks open branches; Haiku privacy scan ace55b9 of pushed branches reports).
  - (4) create a private GitHub copy pushed regularly; (5) customer data stays organised in local Records. Do not rewrite history before then.

Takeover reconciliation, 28 Oct (6.0.1009): Private Records and gated history-purge boundaries remain. No deletion or force-push is authorized by this takeover.

### Q181

Source: Privacy, security and secrets › **Security register** · ready

  - ERROR-5XX-REDACTION#21 PARTIAL (44 route-level 5xx responses still return raw messages: `system.ts` x7, `compat.ts` x7, `sales.ts` x6, `users.ts:596`, `actionHistory.ts` x4; shared handler is sanitised); ADMIN-VARY#90 MISSING (`Vary: Accept` on the admin document rewrite); IMAGE-validate-entrypoints#331 PARTIAL (decode/pixel/bomb/orientation parity across upload, camera, ZIP, dataURL, avatar, promotion, portal).

### Q182

Source: Privacy, security and secrets › **Security register** · needs owner

  - IMAGE-cap-atomic#333 PARTIAL (three-image cap race in `importJobs.ts:827,835`); ABUSE-bindings#338 PARTIAL (Workers Rate Limiting binding + Turnstile, BC-Q25); AI-quota-gateway#339 PARTIAL (daily quota, AI Gateway, validated tools); SECURITY-header-rollout#340 PARTIAL (CSP enforce vs report-only); METRICS-dashboard#341 PARTIAL.

### Q183

Source: Privacy, security and secrets › **Security register** · needs owner

  - Unsafe-method-origin / return body admission#408 PARTIAL; PUBLIC-INTERNAL-ID#197 DONE; MEMBERSHIP-ORACLE#198 DONE; OWNER-SECURITY#36 OWNER (no stray `admin` user; 2FA on Cloudflare and GitHub; remove old-domain OAuth redirect URIs; delete the old zone later; confirm the test password is not a real one); Q20#33 UNCERTAIN (SEC-3 P3 items: recover from the original report).

### Q184

Source: Privacy, security and secrets › **Security register** · needs owner

  - SECRET-rotate-confirm#261 OWNER (confirm the replaced Cloudinary secret); Malformed-secret-credential-name#400 OWNER (rotation and cleanup of the legacy malformed secret name); Deploy-build-state-evidence#419 PARTIAL (record build-time full SHA and dirty paths in the release record); R2-OLD-BUCKET#42 OWNER (keep only the latest; permanent delete is the owner's action).

### Q185

Source: Privacy, security and secrets › **Security register** · ready

  - donor SEC-SALES `f69b0edfa` MISSING (cashier LIKE filter open to any viewer, future-skew-only client timestamp bound); Haiku privacy/secrets scan of seven pushed branches (HAIKU-PRIVACY-SCAN-BRANCHES, 13 Oct) found no real secret, token, phone, email or chat id in added lines; about 51 name-shaped test literals were not individually cleared (27 already on main).

### Q186

Source: Privacy, security and secrets › **Early-Sep ledger leftovers (archive L6492)** · ready

  - the Part 539 portal findings (`aiProviderId` in `/config`, the membership-existence oracle on `POST /portal/submissions`) are DONE as PUBLIC-INTERNAL-ID#197 and MEMBERSHIP-ORACLE#198; the `portal_password_resets` table and RFID stub tables are dead schema (zombie cleanup, see Docs); the production portal settings carry the brand name in four user-editable fields (owner decided the brand 27 Sep).

### Q187

Source: Branch cleanup and repository hygiene › **Branch cleanup checkpoint COMPLETE (13 Oct); new cleanup requires fresh proof** · ready

  - Historical BRANCH-CLEANUP-MANIFEST inventoried1096 remote refs/996 tips with merged, patch-equivalent, release-only and unique classes. The independently reviewed13 Oct run deleted416 branches after preserving all tips, a53-tip bundle and47 keep tags; its postflight retained main, releases and protected PR refs. Evidence: LANES.md13 Oct11:14Z and private branch backup logs. No new cleanup has run. Revalidate current tips, claims, open PR heads/bases and redundancy before any further expected-SHA deletion; preserve active, unmerged and uncertain work.

Takeover reconciliation, 28 Oct (6.0.1009): Branch/worktree cleanup remains held pending a current manifest and authorization; this reconciliation deletes nothing.

### Q188

Source: Branch cleanup and repository hygiene · needs owner

- PR9#44 OWNER (`codex/verified-resume-20260925` fully contained in urgent; close after RELEASE-1 with the owner's OK); P-public (archive L277) OPEN — `claude/p-public-20260925` (`97587c5b`, 19 commits) was never merged, the earlier [x] was wrong; reconcile lane queued ahead of storefront lanes; RC-UNMERGED-CANDIDATES#108 PARTIAL (merge-cost, customer/POS performance, indexed barcode, Reports, bulk actions); P1-PARKED#8 PARTIAL (freshly composed parked lanes: P-DON donor ports P-RET, SEC-SALES, SALE-CORNER-TAG `163d6c989`, DATE-UI `30c23c558`/DATE-W `39cf7331f`, DATA-AUDIT-B `63979fb4a`, REVERT-SET `ceb9af819`, NOTIF-V2, G38 members/telegram, G37-P2 HOLD, DEBLOAT `d08348422`, PROD-PERM; Codex 2 Oct stock family and PR9 DROP); P10-18#67 parked patch; U-branch-prep (retire Shop into Store; execution done by the cutover; never rerun); Q12#25 OWNER (private main + public sanitized mirror; new repo from `archive/docker-postgres-2026-07-26`, owner OK before creating any repo); downloads/worktrees: one checkout rule, push archive/<name> for anything unmerged, then remove.

Takeover reconciliation, 28 Oct (6.0.1009): Unknown/unmerged candidates and the separate legacy repository stay preserved. Snapshots do not prove integration.

### Q189

Source: Branch cleanup and repository hygiene › **Legacy ledger leftovers (not in the register)** · needs owner

  - RC-LINE OWNER (`rc/coordinated-2026-09-02` with 149 commits plus `rc/p2-*`, `rc/sec-*` are never deployable; the 4 Sep inventory calls them probably dead, confirm before deleting, archive L2824); HO24-BRANCH-DELETE OWNER (branch deletions per the 24 Sep manifest `docs/fleet/2026-09-24-branch-cleanup-manifest.md` run from the owner machine; superseded by the 13 Oct manifest).

### Q190

Source: Branch cleanup and repository hygiene › **Legacy ledger leftovers (not in the register)** · ready

  - HO24-WEBSITE-POSTS HOLD (`rc/website-posts-api-20260924` needs its frontend; bulk settings save drops posts, archive L502).

### Q191

Source: Branch cleanup and repository hygiene › **Legacy ledger leftovers (not in the register)** · needs owner

  - CP-3d held lanes of 30 Sep, status unverified because several landed in the 5–7 Oct releases (check the cleanup manifest before treating any as open): RETURNS-MONEY / RET-A (findings D/E/F still MISSING), IMPORT-U12, SALES-W1, IDX, PERM-WORKER, HEALTH-Q and AUTH-P1b (certified with exceptions), BULK-STATUS, CRON-OBS, PLAN-GUARD (token decision), READS-CUT (not certified), UI redesign lanes (ui-stock-1/2/3, ui-conflicts-1/2, ui-detail-1), SCAN1/SCAN2, A2+B1 (needs owner approval of the deletes), U-cost3 0200 repair.

### Q192

Source: Docs, tooling and code hygiene · ready

- progress.md rewrite — DONE by this commit (6.0.149); remaining documentation debt: `docs/history/session-log.md` customer-data lines (Privacy); LOG-PROTOCOL-BACKFILL#130 PARTIAL (board-only records / missing narrative 545/546/554/556); Q19#32 PARTIAL (tidy ledgers and folders); HYGIENE#24 PARTIAL (dead code, naming, no comments; final pass at the end on one release branch with the tokenizer strip); SONNET-NO-COMMENTS-SIMPLIFY-R2 (766 new comment lines in 78 files in release 2 to remove or shorten; defers to the `no-comments` skill) OPEN; TOOLING#38 OPEN (agent-friendly CDP/devtools verification skills, isolated parallel worktree instances, timeout-8 browser tests); I18N-ORPHAN-KEYS#160 MISSING (remove `special_price*` x4; `returns_count_label`, `still_need_decision` dormant → owner list), I18N-GOOGLE-LOGIN#161 (ask the Khmer reviewer), Unused-i18n-keys#393, I18N-unused-km#268; ZOMBIE-ROUTES-TABLES#194 UNCERTAIN (delete four dead GET routes in `compat.ts:1191,1200,1201,1205` after a route-order test; 28 uncalled routes, password-reset table, RFID stubs), ZOMBIE-OTHER#200 PARTIAL, CONTACT-LEGACY-404#192 DONE, BOOTSTRAP-PHANTOM-FIELDS#193 MISSING, ZOMBIE-DATED-OLD#199 SUPERSEDED, PROMO-wired-audit#266 PARTIAL (all ten routes live), Part535/dead-state#381 MISSING; P3-CDP-TIMEOUT OPEN (raw CDP send()/evaluate() without timeout in eight browser tests; unreachable `bulkImport*` wrappers); DEBLOAT-REMAINDER OPEN (114 exported symbols with no production caller, 40 unused-local diagnostics, BulkImportModal dead review-conflict UI x17; unused is not dead, so list for the owner); PICKER-GUARD-WIDEN OPEN (searchablePickersP6 watches only category|brand|supplier|unit: widen to product name and barcode bindings; row #69 itself is DONE); the U-1 per-lane checklist (refuter per lane, hygiene sweep per lane, discriminating tests registered in `test:utils`, docs updated when behaviour changes) is standing process for every lane; per-checkpoint exact-SHA gates replaced the old CERT sweep.

Takeover reconciliation, 28 Oct (6.0.1009): Only board staleness is addressed here; documentation, hygiene, zombie and per-lane obligations remain open.

### Q193

Source: Docs, tooling and code hygiene › **Early-Sep ledger leftovers (archive L4690, L5715, L6170, L6492; unused is not dead: list for the owner, never delete on sight)** · ready

  - zombie/orphan cleanup lane — the custom-tables cluster, DatedStockReconciliationModal chain, `lib/businessMetrics.ts`, `__lightbox_test_entry.tsx`, the `utils/index.ts` barrel, PublicCatalogPage dead membership machinery, duplicates (`users.ts` normalizePhoneLookup, three escapeHtml copies, `localDb.ts` dead CSV exports), about 28 uncalled routes plus 4 shadowed compat import-jobs routes (ZOMBIE-ROUTES#194), 2 never-sent AppBootstrapPayload fields, contact bulk-import transports that call a removed route.

### Q194

Source: Docs, tooling and code hygiene › **Early-Sep ledger leftovers (archive L4690, L5715, L6170, L6492; unused is not dead: list for the owner, never delete on sight)** · ready

  - Orphaned language keys `special_price`, `special_price_hint`, `special_price_usd_full`, `special_price_khr_full`, `returns_count_label`, `still_need_decision` (no call site; deletion goes in one dedicated commit, S4-28). Session-log backfill: entries 545, 546, 554, 556 are missing and 553 is vacant; Part numbers are assigned at log time, not in commit messages (standing rule). Stale test `performanceLoadingUx.test.ts` (~line 1568, `salesGroupMode`) was RED at that head: one-line fix, probably already fixed.

### Q195

Source: Backup, restore, Library and production data › **Register** · ready

  - N7 / G49 dataset lifecycle MISSING (BC §3 N7: unbounded `listObjects` in `system.ts:615,1319`, reset text "product images" while images stay, `datasetOperationStore.ts` unused, no bounded cleanup for six growing tables, transfer-receipt retirement has no caller); FULL-LIFECYCLE#62 PARTIAL (durable reset/restore/export/transfer/journal continuation).

### Q196

Source: Backup, restore, Library and production data › **Register** · owner-decided

  - 0098-REPLAY#63 UNCERTAIN; RESTORE-UI-ASSETS#64 / BACKUP-restore-C#246 PARTIAL (typed-phrase danger confirm, use the server dry-run, `restorable` flag read nowhere, "validated" toast after a real restore, resumable restore; restore is Paid-only; maintenance write-blocking; design K10a = replace with the backup); DRIVE-connect#257 / A3#163,#367 OWNER-MANAGED14Oct (owner handles Drive; no agent setup task; backup/asset integrity checks remain separate).

Takeover reconciliation, 28 Oct (6.0.1009): Permission/password rules and external encrypted backups on Free are settled. Restore UI, assets and recovery checks remain open.

### Q197

Source: Backup, restore, Library and production data › **Register** · ready

  - DRIVE-assets-restore#267, Drive-asset-mirror#390 PARTIAL (manifest + referenced assets, retry 401/403/429/5xx, checksums, round trip, cancel UI); BACKUP-finalize-sets#329 (newest 2 valid R2 sets); QA-reset-ripple#355, QA-restore-assets-ripple#356, QA-infra-pass#359, QA-transfer-ripple#354 OPEN live checks; MIGRATION-RECOVERY#43 (every data-changing migration writes a backup table first and ships tested recovery SQL: migrate → recover → byte-identical).

Takeover reconciliation, 28 Oct (6.0.1009): Drive assets, checksums, live reset/restore and migration recovery remain open; owner-managed setup is not integrity proof.

### Q198

Source: Backup, restore, Library and production data › **Register** · ready

  - K3 video#377 MISSING (container pipeline is paid-only: free fallback = store as is, BC-Q25d); IMAGE-provider#243 DONE; IMAGE-variants-audit#332 PARTIAL (bound thumb192/card640/detail1600, audit orphans); A2-live#206 / A2#162 OPEN (live verification checklist after deploy: reset, products, POS lots, iPhone install, import round trip, R2 two finalized sets, bare receipt id, Phnom Penh labels).

### Q199

Source: Backup, restore, Library and production data › **Register** · ready

  - POS-LIVE-RECEIPT-CHECK#109; four live data gaps measured 4 Sep (archive L15151) and `RECON` lot code S4-19 (DATE-STORED-ADJ#159 DONE: display day-first, stored code unchanged; rewrite of 6,031 month-first stored lots is a separate data job); "Sentry" and Resend/Drive/OAuth/DNS items are owner actions (below).

### Q200

Source: Backup, restore, Library and production data › **Legacy ledger leftovers (not in the register)** · ready

  - LIFECYCLE OPEN (dataset lifecycle: sales-reset route, atomic generation/journal, import fencing, backup/restore orchestration, R2 staging, principal recovery; migrations 0185–0191 parked, archive L807); LIFECYCLE-0188-HOLD (never apply 0188 remotely: its guards affect receipt deletion and backup/reset paths do not yet preserve permanent retirement evidence; wire the 0188 retirement trigger into the reset route first, archive L818, L640).

### Q201

Source: Backup, restore, Library and production data › **Legacy ledger leftovers (not in the register)** · ready

  - RESTORE-TOCTOU OPEN (restore admission-read TOCTOU and restore effects after force-clear, archive L815); RESTORE-UI-CONFIRM-ASSETS (#64) and Free restore capacity; HIST-HEADER-ONLY-SALES / HIST-DUP-CONTACTS data items are listed under Returns and Contacts.

Takeover reconciliation, 28 Oct (6.0.1009): RC3 chunks restore deletion and releases maintenance on pre-delete refusal. TOCTOU, assets and Free recovery scope remain open.

### Q202

Source: Owner and external actions · needs owner

- A2 live verification (owner, since 31 Aug): reset-data, a POS sale with lots and bare receipt ids, storefront install on iPhone, import round-trip, R2 keeps exactly two finalised sets (archive L4560, L6320); A3 connect Google Drive in Settings → Backup (archive L6326).

Takeover reconciliation, 28 Oct (6.0.1009): Drive setup is owner-managed and settled; A2/live asset verification remains open.

### Q203

Source: Owner and external actions · needs owner

- P07 / P05 owner statements of 8 Sep (archive L14844, L14896): the owner said the Telegram bot token was rotated, and repeated confirmation on14Oct; retain owner-confirmed status and do not re-rotate from an old pending entry; the owner says most images are first-party photography, so the image-rights review covers exceptions only; business, market and image-rights facts remain an owner-register item.

### Q204

Source: Owner and external actions · needs owner

- Owner-only (not code): Drive is owner-managed; Resend verification/email/Google details are owner-confirmed14Oct, with no live email/Google test requested; move DNS if old-domain redirects are wanted; confirm the replaced Cloudinary secret; rotate the legacy malformed secret name; create a Sentry project or drop it; edit the four production portal rebrand fields; Account Analytics Read token scope; point at the too-wide backup path input; name the fixed dropdowns that should become user-defined (OPTIONS-user-defined#263); decide the `redeemValueKhrStep` (BC-Q13); stray `admin` user, 2FA on Cloudflare/GitHub; delete the old R2 bucket and old zone after verification; confirm the Shop→Store official-names Excel after the owner's stock reconciliation.

### Q205

Source: Owner and external actions › **Owner rulings of 5–6 Oct not (fully) in code (BC §2.6, sampled at 0baa53f2)** · owner-decided

  - changed-fields-only saves PARTIAL (Settings main form done; receipt settings, roles and Website Editor unchecked); products have no created-date filter UNCERTAIN (use received date); every return must link to a sale PARTIAL (NewReturnModal requires one, the Worker still accepts none: `returns.ts:1519`); Not Paid return lowers the debt MISSING (finding D).

Takeover reconciliation, 28 Oct (6.0.1009): Changed-fields saves, return links and Not Paid semantics remain open until each is verified.

### Q206

Source: Owner and external actions › **Owner rulings of 5–6 Oct not (fully) in code (BC §2.6, sampled at 0baa53f2)** · owner-decided

  - import slash dates read day-first unless the header says mm/dd/yyyy MISSING (`batchCode.ts:50`, donors DATE-UI `30c23c558` / DATE-W `39cf7331f`); low/out alerts only when a sale crosses the threshold MISSING (`telegram.ts:1024`); website phone sign-ups OFF MISSING until portal-csrf ships (6.0.44, default `portal.ts:531` still true). → *27 Oct: lane 6.0.991 (RC2b, deploying).*

Takeover reconciliation, 28 Oct (6.0.1009): 991 crossing-alert work is deployed in RC2b. Import-date/phone-signup current-code and acceptance residuals remain open.

### Q207

Source: Owner and external actions › **Owner rulings of 5–6 Oct not (fully) in code (BC §2.6, sampled at 0baa53f2)** · owner-decided

  - sale corner tag (payment chip + return ribbon) MISSING (donor SALE-CORNER-TAG `163d6c989`); shop closing time forces open shifts closed UNCERTAIN (only per-shift `shift_close_time` found); category/brand import "Main - Sub" UNCERTAIN (import parsing unread); stock-in edit adjusts quantity without booking a loss UNCERTAIN.

### Q208

Source: Owner and external actions › **Cheap safe list (BC §2.4, Sonnet, disjoint from lanes)** · ready

  - AUDIT-FILTER-CAP#20, TG-ASTRAL#88, PERMISSION-UI-HIDING#128, ZOMBIE-ROUTES#194, ADMIN-VARY#90, PIN-products-branch-move#298, S4-21 QuickAddModal guard#149, Sales/returns-fold-import#385, S4R4-11#426, docs-only #266/#70/#124; then the language-pack batch #160, #274, #157, #286/#78, #264/#388 after DU-A and receiving-f1 merge. → *27 Oct: #128 and the S4-21 guard shipped in 6.0.987 (live, RC1).*
  - then #86, #93, #179, #83, #272 comment, #97 after their file owners.

### Q209

Source: Owner and external actions › **Groups G40–G64 (5 Oct triage, 8 days stale, re-check before any lane)** · ready

  - G40 products list/columns 10, G42 form/Conflicts pager 5, G44 stats strip/range row 9, G45 POS/shift forms 5, G46 money messages 2, G56 route sweep gate 6, G57 iOS PWA/device checks 7 (P2); G41 detail floats 8, G43 inventory/branches 4, G47 selection actions 2, G48 short ids 1, G50 import polish 6, G51 role editor 2, G52 storefront polish 5, G53 app shell 4, G54 UI hints/i18n 8, G55 settings hub 5, G58 shared UI kit 3, G59 admin design pass 4, G60 deploy slimming 1, G61 field identity/autocomplete 2 (P3).
  - G49 dataset lifecycle (N7); G62 security hardening, G63 toolchain/lint gate, G64 backup page copy/Drive folders; G01–G39 mostly live-verified. Index of the full requests/rules populations: obligation index (1,327 requests, 290 rules, 86 questions, 1,121 register rows).

### Q210

Source: Added 27 Oct from the lane log · ready

- Run the 6.0.995 `returns.created_at` shape census through the ops workflow once it is on main.

Takeover reconciliation, 28 Oct (6.0.1009): 995 supplies the census query; execution remains open and was not dispatched by this reconciliation.

### Q211

Source: Added 27 Oct from the lane log · ready

- Multi-client template must render the 6.0.984 crons (*/5, */15, 17 */3) (reconciler, multi-client line).

Takeover reconciliation, 28 Oct (6.0.1009): Multi-client cron verification remains open. The Leang-only takeover does not certify BM Shop.

### Q212

Source: Added 27 Oct from the lane log · ready

- `test-branch-review-state-pure` hangs at check 9 on the base too (pre-existing, seen 26 Oct).

Takeover reconciliation, 28 Oct (6.0.1009): 29428256b in RC3 repairs the original hang; the release passed its 1,084-file Worker sweep. Retain this ID and its evidence.

## Evidence pointers by source section

- Stock, catalog, contacts and suppliers: Evidence: BC §1.3, §2.8, §3, App. A; lane reports named above; archive grep by ID.
- Returns, sales money, shifts and expenses: Evidence: BC §1.3 (A–M), §3 N1/N2, App. A; the three R2 area reviews.
- Reports, exports and receipts: Evidence: BC App. A; SONNET-AREA-REVIEW-R2-REPORTS-UI.
- UI, mobile and device acceptance: Evidence: HAIKU-DAILY-USE-COVERAGE, SONNET-AREA-REVIEW-R2-REPORTS-UI, BC §1.4, §2.4, §2.8, App. A.
- Accounts, sessions and drafts: Evidence: BC §1.4, §2.8; CLAUDE-RECEIVING-F1.
- Permissions, review queue, audit and undo: Evidence: OPUS-AREA-REVIEW-R2-SECURITY, OPUS-PLAN-REVIEW-QUEUE-COMPLETION, OPUS-CORRECTNESS-HUNT-R2, BC §1.2, §2.5.
- Telegram and notifications: Evidence: BC §2.5, §2.6; CLAUDE-SHIFT-TELEGRAM-ADDITIONAL, CLAUDE-SHIFT-CASH-EVERYWHERE.
- Imports, exports and legacy migration: Evidence: BC §3 N3, §2.4 B, App. A.
- Efficiency, performance and Free/Paid: Evidence: OPUS-EFFICIENCY-REVIEW-R2, BC §2.8 (query cost), App. A.
- Privacy, security and secrets: Evidence: BC §2.8, §4 Q11/Q12/Q25; OPUS-AREA-REVIEW-R2-SECURITY.
- Public website, storefront and membership: Evidence: BC §2.8 (W-SITE), §4 Q23; 27 Sep owner decisions above.
