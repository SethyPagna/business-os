# Latest-data deep verification plan (P2-3b, planning only — no execution)

Status: **plan only**, nothing executed. The full run starts only after the coordinator confirms
Codex's independent pass is done and says where its output lives (decision 15); step 0 (this plan
+ a read-only production D1 snapshot) is P2-3b's entire scope right now.

**Timezone (decision 20, "everything is Cambodian")**: all times are **Asia/Phnom_Penh (ICT,
UTC+07:00, no DST)** — never "Bangkok." Legacy export timestamps are Cambodia wall-clock text; the
app's `created_at` columns are UTC. Every date-based join below shifts UTC → ICT with `+7 hours`
before comparing (mirrors `cloudflare/src/lib/businessDateWindow.ts`'s `BUSINESS_TZ_FORWARD`), and
uses its sargable-then-exact pattern (date-only prefilter + `date(col,'+7 hours')` exact match)
rather than a raw string compare — `created_at` is a mix of ISO and space-separated shapes, and a
raw compare misfiles rows at the `T` vs space boundary.

## 0. Inputs

- **Raw exports**: `tmp/latest-data-input-20260902/latest data/` (16 files, §1), read-only.
- **Existing pipeline** (already run once, 2026-09-02): `tmp/latest-data-reconcile/*.mjs` + its
  `*.json` evidence, and the workbook
  `outputs/01a061f6-6bb2-7b33-8856-4710816f39bf/latest-data-zero-error-reconciliation-20260902.xlsx`
  (26 sheets: Controls, Sources, Product Groups, Product Variants ×2, Branch Stock ×2, Negative
  Stock, Barcode Decisions, Barcode Conflicts, Preserved Products, Customers, Contact Exceptions,
  Suppliers, Delivery Contacts, Missing/Live-Extra/Exceptions Sales ×4, Expenses, Stock In Delta,
  Shrinkage, Transfers, Transfer Items, Live Ops Controls). Its Controls gate list (evidence
  snapshot 20260902 12:32:33, "Production writes: NONE") is the baseline this plan extends.
- **Production D1**: this P2-3b snapshot (`bos-rc-workers/d1-snapshot-<ts>/`) plus the earlier
  `tmp/latest-data-reconcile/remote-snapshot.json` (2026-09-02T14:12Z = **21:12 ICT**, 6,104
  products) the existing pipeline used. Re-diff against whichever is freshest at full-run time.
- **Codex's output** (decision 15): unknown path/format yet — see §5.

## 1. The 16 raw exports

Row/date figures from `tmp/latest-data-reconcile/source-analysis.json` (2026-09-02T13:05:10Z).
Source date text is ICT wall-clock (legacy POS timezone). Barcode+name join = project rule
(barcode non-unique, 238 live products share "0"; name primary, barcode corroborates), per
`reconcile_products.mjs`. Phone+name join for contacts = project rule, never name alone.

| # | File (rows) | Maps to | Join key | Gate | Output sheet |
|---|---|---|---|---|---|
| 1 | `Item Export-shop.xlsx` (6,047) | `products` + Shop `branch_stock` | barcode+name | 100% resolve; clamped-negative qty (13 rows) matches; exceptions = the 350 already on **Preserved Products** | **Product Variants/Branch Stock** (extend) + new **Stock Mismatches** |
| 2 | `Item Export-warhehouse.xlsx` (6,047) | `products` + Warehouse `branch_stock` | barcode+name | same shape, 1 negative row clamped | same as #1, warehouse branch |
| 3 | `stock-report-2021-2026...xlsx` (5,908; Ending 23,054/clamped 23,070) | sum of both branches' `branch_stock` + `inventory_movements` running total | name+barcode; no per-row timestamp | Begin+In−Shrink−Sold+Adj = Ending, within clamping rule; 161 no-barcode rows flagged not failed | **Stock In Delta** (extend) |
| 4 | `PO Invoice...cosmetics 2021-2026.xls` (2,763 hdr/11,418 items, $1,358,320.30) | `product_batches`(shop) + `suppliers` | PO date (ICT, `received_at`+7h) + supplier label + barcode/name | every header → ≥1 batch same local day/supplier, qty sums within rounding; document the "-" (1,455 rows) fallback | new **Supplier POs — Shop** |
| 5 | `PO Invoice...warehouse 2021-2026.xls` (203 hdr/3,429 items, $919,079.46) | same, warehouse | same as #4 | same as #4 | new **Supplier POs — Warehouse** |
| 6 | `Shrinkage qtty 2021-2026.xls` (608 events/933 items, 3,375.8 units) | `inventory_movements` (or `damaged_stock_lots` — **confirm which is live before joining**) | event time (ICT, +7h) + barcode/name + qty | 100% of 933 rows → 1 movement same local day/product/qty, or documented gap; 12 Khmer reason codes preserved verbatim + English gloss | new **Shrinkage Delta** |
| 7 | `account-receivable-report...xls` (13,282; Paid 13,182/Unpaid 98/Outstanding 2) | `customer_receivables` (13,272 in fresh snapshot — 10-row delta already visible) | invoice+date (+7h) + phone+name | every row → 1 receivable, status + amount within $0.01; source's own `paidUsd>totalUsd` inconsistency reported as a **source** data-quality issue | new **Receivables Delta** |
| 8 | `report-drawer-history.xls` (760 sessions; gross $1,984,862.93) | no 1:1 table — cross-check daily `sales` aggregate by local-ICT day | local-ICT day; cashier via `user_aliases` (Aza=Za) | per-day gross/cash/ABA within $1; cashier never null | new **Drawer Reconciliation** |
| 9 | `report-expense...and time.xls` (4,265; $135,126.60/82,799,100 KHR) | `fees` (4,256 in fresh snapshot, 9-row delta) + `delivery_contacts` for courier labels | expense date (+7h) + label + amount (USD/KHR as-is, no guessed FX) | every label → 1 saved tag; every courier label → a delivery_contacts row; totals match | **Expenses** (extend) |
| 10 | `report-invoice-detail...shop.xls` (15,004 receipts/40,543 lines/36,145 product lines) | `sales`(14,983)+`sale_items`(36,104) — 21/41-row deltas to explain | receipt#+date (+7h); 4,432 reused receipt numbers resolved by date+amount, reusing `sales-product-mapping.json` | 100% live receipts 1:1; revenue = canonical definition (net, tax/delivery excl., refunds subtracted) | **Missing/Live-Extra/Exceptions Sales** (extend) |
| 11 | `report-user-2021-2026.xls` (1 block, "Aza"; gross $1,885,977.80) | `users`/`user_aliases` + daily `sales` aggregate | user identity via alias, then local-ICT day (2021-01-01 source date is a placeholder, flagged not joined literally) | totals match cashier "Za" sales within rounding | folds into **Drawer Reconciliation** |
| 12-14 | `stock branch transfer*.xls` (1,219 summary/"Done"; 16 transfer#s have item detail, 40 rows/197 units; ~1,203 summary-only) | `stock_transfers` (37 live rows) | transfer#+date (+7h) for the 16 detailed; batch+branch identity end-to-end for live rows | 16 detailed transfers 1:1; live rows checked for batch-identity-preserved pre/post stock | **Transfers/Transfer Items** (extend); note ~1,203 remain summary-only by source limit |
| 15 | `stock-in-report...stock in version.xlsx` (21,330; 352 no-barcode, 8 zero-qty) | `product_batches`/`inventory_movements` (stock-in) | date(+7h)+barcode+name+qty; extends `verify_stock_in.mjs`'s existing source↔migration-CSV signature one hop into D1 (that script's `isoLegacyDate()` needs no shift — both sides ICT; the **new** CSV↔D1 hop does, since `received_at` is UTC) | every matched migration-CSV row → 1 D1 row same local day/qty; no-barcode/zero-qty rows flagged not dropped | **Stock In Delta** (extend) |
| 16 | `report-item-sold...warehouse and shop.xls` (770 day-groups/37,138 items, $1,887,184.03) | independent daily rollup vs `sale_items`/`sales` (cross-checks #10) | local-ICT day + barcode/name | per-day qty/total matches #10's rollup within rounding; any new mismatch here is a fresh finding | new **Daily Sold Rollup Cross-Check** |

## 2. Row-count baseline

Method (actual numbers in `bos-rc-workers/p2-3b-report.md`): diff `manifest.json` counts (this
run) against `remote-snapshot.json.counts` (14:12Z UTC / 21:12 ICT run) per table. A **products**
count change is the interesting signal; sales/sale_items/inventory_movements/receivables growth is
expected business activity (sanity check: no row count went backward).

## 3. Barcode web cross-check extension

Extends the existing 15-product sample to: **243 barcode-less live products** (238 "0" + 5 blank —
search by name only, propose a fill only on an unambiguous name+brand match) and **29 cross-name
barcode conflicts** (search by barcode AND each conflicting name; decide which name the barcode
actually belongs to, or "likely mismatched, name kept" — never a silent overwrite). Both land on
**Barcode Decisions**/**Barcode Conflicts** with evidence URL + retrieval time in ICT.

## 4. Sales/stock-in/transfers/contacts reconciliation

Covered per-export in §1 (10/15/16 sales+stock-in, 12-14 transfers, 7-9 receivables/expenses).
Contacts: phone+name (never name alone), reusing `contact-reconciliation.json`'s phone
normalization (855-country-code, multi-value cells) against the fresh snapshot's 4,712 customers.

## 5. Waiting on Codex

**Input slot**: path/format TBD — the coordinator supplies this once the user confirms Codex is
done. **Diff method**: join Codex's output to §1's decision sheets on the same keys
(barcode+name / phone+name / receipt+date); produce a 3-way table {existing pipeline, Codex,
production D1} × {agree, disagree, only-one-has-it}. Existing-pipeline-vs-Codex disagreements are
top priority for human review before any guarded SQL is drafted for them.

## 6. Guarded SQL shape (prepared only, never applied)

`UPDATE <table> SET <col> = <new> WHERE id = <id> AND barcode = <expected_barcode> AND description
= <expected_description>` (or the table's equivalent three identity columns): id pins the row, the
other two guard against clobbering a row someone else already edited since this plan was written.
No script in this plan or its outputs executes any of these — they go on per-issue decision sheets
for a human, or a later explicitly-approved deploy step, to run.
