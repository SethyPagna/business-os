# Aug-31 incremental import + all-time customer AR ledger — reconciliation

**Status: PREPARED + VERIFIED, NOT YET APPLIED to remote D1.** This session
generated and proved the SQL; applying it to production is a deliberate, gated
step (see *How to apply*). Nothing here has touched the live database — every
D1 call made while preparing this was read-only (`rows_written: 0`).

Scripts / artifacts:
- `ops/scripts/migration/import-aug31-legacy-reports.mjs` — generator (default =
  read-only audit + local SQL; `--apply` writes to D1).
- `cloudflare/migrations/0094_legacy_customer_receivables.sql` — the AR ledger table.
- Generated SQL: `cloudflare/.wrangler/tmp/legacy-aug31-import/*.sql` (git-ignored).
- Source reports archived in `Downloads/27th-30th/` (durable) and loose in `Downloads/`.

---

## Why this exists — the gap the earlier passes left

1. **Aug-31 sales were never imported.** The applied Aug-27→30 pass
   (`import-aug30-legacy-reports.mjs`, migrations 0088–0092) stopped at receipt
   **4376**. The old system kept ringing sales through Aug 31 (invoices
   **4377–4390**). Live check: **0 sales exist on 2026-08-31** and none of
   4377–4390 are present — so importing them has **no double-count risk**.

2. **Customer outstanding balances were being dropped.** The legacy sales
   converter books every imported sale as *fully paid* (`amount_paid = grand
   total`) and keeps the credit only as a free-text note. Supplier **payables**
   have a home (`supplier_invoices`, 1,591 rows); customer **receivables** did
   not. The new all-time AR report is exactly that missing ledger — and it is
   not small: **61 invoices customers still owe ($7,397.10)** and **367 overpaid
   invoices (−$98,742.52 of store-held credit)**, net **−$91,345.42**.

## What the new files are (all cross-checked against each other)

| File | What it is | Reconciles to |
|---|---|---|
| `report-invoice-detail-31st.xls` | 14 invoices 4377–4390, 20 product lines, 24 units | goods $530 + delivery $17.5 = **$547.50** |
| `report-item-new-31st.xls` / `…categories.xls` | per-product / per-category day summary | "33 items" = 24 product units + 9 delivery lines ✓; total **$547.50** ✓ |
| `report-expense-income-31st.xls` | 2 delivery expenses (Grab 7,200 + Capital Express 10,000) | **17,200 KHR** |
| `report-user-31st.xls` | per-user summary — **only "Rath"** (partial: gross $146 of $547.5) | Rath's $42 credit = invoices 4377 ($13.5) + 4378 ($28.5) |
| `stock-report-31st.xlsx` | 20 items, movement columns | **only "Sold" (24 units)** — no stock-in/adjust/transfer to import |
| `account-receivable-report all time.xls` | 13,243 invoices, 2021→Aug-31, outstanding + status | TOTAL row = recomputed totals **to the cent** |

**AR ↔ invoice-detail cross-check (Aug-31 slice):** the AR report's 14 Aug-31
rows are the same invoices 4377–4390, same $547.50, and **per-invoice `Credit`
(invoice detail) === `Outstanding Balance` (AR) for all 14** — the two exports
corroborate each other exactly.

Notes on the source files:
- The two AR exports (`account-receivable-report all time.xls` and
  `account-receivable-report.xls`) carry **identical invoice data** (row-by-row
  diff: 0 differences); they differ only in non-data header bytes. The plain one
  is redundant. The script uses the "all time" copy.
- AR invoice numbers reset across years (6,796 distinct of 13,243), so the ledger
  is keyed by the report's own row **ID** (`source_file, legacy_id`), never by
  invoice number alone. Invoice dates are stored as UTC (Bangkok − 7h), matching
  `supplier_invoices`.

## What the SQL does

- **14 Aug-31 sales (4377–4390)** booked exactly like the applied 4351–4376 set:
  branch 2 (shop), `amount_paid = grand total`, credit kept in `notes`,
  `client_request_id = legacy-sale:<no>@2026-08-31`. All 20 product lines resolve
  to live products (each with its opening batch). One signed
  `legacy_inventory_effects` row per unit deducts stock and writes the movement
  through the 0088 trigger. Cashier is `Old system` (the day's user report only
  covers Rath and has no per-invoice attribution — the report is archived).
- **2 Aug-31 expenses** into `fees` with the exact natural-key guard.
- **13,243 AR rows** into `customer_receivables` (12,620 linked to a live
  customer by unique name; the rest keep the name with `customer_id NULL`).
  AR rows never rewrite `sale.amount_paid` and never move stock.

## Verification performed (all green)

- **Source gates** (script aborts on any mismatch): 14 sales · invoices 4377–4390
  · 24 units · $530 goods · $17.5 delivery · $147 credit · 2 expenses / 17,200 KHR
  · 13,243 AR rows · total $1,730,636.803 · paid $1,821,982.2188 · outstanding
  −$91,345.4158 · 13,243 distinct AR IDs.
- **AR ledger dry-run** in a local SQLite (migration 0094 + the 5 receivable
  files, **applied twice**): 13,243 rows, totals match to 4 dp, `ON CONFLICT`
  makes the rerun a no-op — idempotent.
- **Sales dry-run** in a local SQLite with the real 0088 trigger (**applied
  twice**): 14 sales, 20 sale_items (24 units), 20 inventory effects (−24),
  20 movements, branch-2 stock −24, 2 fees, all sale.items JSON populated;
  identical counts on the rerun — idempotent.
- **SQL integrity**: every AR row has a valid ISO date and balanced quoting;
  852 Khmer names and 25 apostrophes escaped correctly.
- One real bug was found and fixed during the sales dry-run: a per-line
  `NOT EXISTS` guard silently dropped the 2nd+ line of every multi-line sale
  (14 items instead of 20). Fixed by inserting all of a sale's lines in one
  statement, as the Aug-30 pass does.

## How to apply (gated — do only after review)

```bash
cd cloudflare && node scripts/with-wrangler-auth.cjs wrangler d1 migrations apply business-os --remote
cd .. && node ops/scripts/migration/import-aug31-legacy-reports.mjs --apply
```

The generator re-checks every gate and re-verifies that no Aug-31 sales exist
before it writes; `--apply` refuses to run until migration 0094 is applied.

## Not done / follow-ups

- **Not applied to remote D1** (deliberate — user-gated).
- The old system's Aug-31 sales are booked *fully paid* like the rest of the
  legacy cohort; the true receivable lives in `customer_receivables`. Retro-
  fitting historical `sale.amount_paid` from AR was **not** done (out of scope,
  and it would diverge from the already-applied 4351–4376 sales).
- No admin UI surfaces `customer_receivables` yet — a customer-AR section
  mirroring the supplier `ApInvoicesSection` would be the natural next step.
