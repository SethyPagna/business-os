# Historical payment and bulk-Done preflight — September 5

Read-only production observations, approximately 23:24–23:29 UTC September 4
(September 5 Bangkok). These are a dated snapshot, not permission to execute a
repair. No sale, receivable, payment, stock, audit or history row was changed.

## Latest owner clarification

Fully paid applies **only to sales matching the actual reconciliation**; the rest
follow normal system processing. Owner also asks to check the old accidental
multi-select Done action and ensure consistency with the latest reconciliation
sales source. This supersedes any blanket before/after-date settlement reading.

## Reconciliation identity

- Production run `latest-data-20260902-v1` is complete, recorded at
  `2026-09-02T15:30:00.000Z`. Its source ZIP, workbook and baseline hashes exactly
  match the local `tmp/latest-data-reconcile/zero-error-migration-plan.json`.
- The source-link ledger has 15,004 sale-header links to
  `report-invoice-detail-2021-2026 shop.xls`. **All 82 current awaiting-payment
  sales are linked to this run**; source times range July 6 through September 2
  16:42 local. Current gross stored invoice totals $9,798.60; recorded USD
  payments $44.50. These are not newly issued post-reconciliation invoices.
- A separate later Sep 2–3 import, documented in the original checkout's
  `ops/scripts/migration/SEP02-03-IMPORT-RECORD.md`, was applied September 4.
  Its receivable source `account-receivable-report-sep02-04.xls` currently has
  22 rows, all with zero outstanding. Do not conflate source dates with apply
  dates or use a blanket September 4 cutoff.
- The original reconciliation receivables source still has 100 positive-balance
  rows. Source membership alone does not prove payment. The final settlement
  manifest must resolve the owner's intended boundary/exceptions and match
  primary keys plus source identity, not repeated invoice numbers alone.

## Confirmed accidental Done incident remains unreverted

Action history **160** was recorded September 3 at 14:49:05 UTC (21:49 local).
It says nine sales, but seven actual transitions are proven by audit rows
3378–3384. Two no-op selections have no evidence identifying them; never guess.

| Sale ID | Legacy invoice/date | Current status | Recorded USD/KHR paid | USD total | Matching AR ID |
|---|---|---|---|---:|---:|
| 16786 | 004416 / 2026-09-01 | completed | 0 / 0 | 82 | 26490 |
| 16789 | 004413 / 2026-09-01 | completed | 0 / 0 | 14 | 26493 |
| 16791 | 004411 / 2026-09-01 | completed | 0 / 0 | 14 | 26495 |
| 16795 | 004407 / 2026-09-01 | completed | 0 / 0 | 26 | 26499 |
| 16796 | 004406 / 2026-09-01 | completed | 0 / 0 | 36 | 26500 |
| 16798 | 004404 / 2026-09-01 | completed | 0 / 0 | 68 | 26502 |
| 16801 | 004401 / 2026-09-01 | completed | 0 / 0 | 57 | 26505 |

The seven receivables are still Unpaid, total $297. There are no returns for
these sales and no subsequent status audit or compensating movement. Each sale
has `stock_skipped=0`; updated timestamps remain those of the erroneous batch.
History 160 is still `undoable`, `reversible=1`, but both payloads are `{}`.
Do not treat its visual Undo label as a usable persisted reversal.

Movement IDs **46189–46197** still record -1 unit each in branch 2, with null
batch IDs, reason `Sale status changed from awaiting_payment to completed`.
Product IDs: 165, 5196, 5067, 4115, 4259, 238, 3924, 955, 939. No reversal exists.

**Important version correction:** the old proposed seven status PATCHes are no
longer a stock repair. The current `salesStatus.ts` treats awaiting-payment as
holding stock; Completed → Awaiting Payment now moves zero units. Any incident
repair must explicitly reverse the proven extra nine units, account for current
branch/lot allocations and merged product identities, and preserve subsequent
business movements. Do not replay the old procedure blindly.

## Source-total exceptions still present

- Sale 16812 / 004434: stored $105, five lines, no product 1369 line.
- Sale 16816 / 004430: stored $54, two lines, no product 10111 line.
- The prior import record reports source totals $131/$79 and missing products
  Clinical Completely Clean 45g ×2 / YSL Libre 10ml. Live omissions are confirmed;
  source rows and current product identities must be re-proved before repair.
  Do not mark known-short invoices fully paid or run the quarantined SQL.

## Next safety gates

Resolve whether the owner means all source-linked reconciliation sales or only
a particular business-date subset, and how the seven accidental completions fit
that settlement. Capture exact current rows/fingerprints and a fresh recovery
bookmark immediately before an authorized repair. Assert identity, totals,
receivables, native-currency payments, branch/batch/product deltas and audit
effects; rehearse an exact inverse. No automatic future-sales completion rule.
