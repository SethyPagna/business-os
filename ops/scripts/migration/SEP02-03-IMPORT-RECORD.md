# Sep 2–3 2026 legacy import — production apply record

Applied to production D1 `business-os` (`49795be9-eabe-43f1-8e16-b86faed60cb1`) on
**2026-09-04** by session `business-os-v1-21`, on the user's explicit go, after
announcing the write to all eleven live peer sessions and receiving no objection.

**Reference to re-verify, not proof.** Re-derive anything here from D1 before acting on it.

## Recovery

Pre-write D1 Time Travel bookmark, captured immediately before the apply:

```
0000126d-00000064-000050dc-e4baaad3f0743e943943449ec02bd96e
```

```bash
wrangler d1 time-travel restore business-os --bookmark=0000126d-00000064-000050dc-e4baaad3f0743e943943449ec02bd96e
```

Every row written by this batch is identifiable without the bookmark:
`sales.notes LIKE 'Legacy import 004%(Sep 2-3 batch)%'` (22 rows, ids 16842–16863),
`supplier_invoices.source_file = 'account-payable-report-supplier-sep02-04.xls'` (5 rows,
legacy_id 1305–1309), `customer_receivables.source_file =
'account-receivable-report-sep02-04.xls'` (22 rows).

## What was written

No migration was applied; the chain top stays **0107**. No deploy was involved.

| Target | Rows | Note |
|---|---|---|
| `sales` | +22 | ids 16842–16863, `$3,462.00`, all `completed`, `amount_paid_usd = total_usd`, `loyalty_accrual = 0` |
| `sale_items` | +56 | |
| `sales` (updated) | 11 | `awaiting_payment` → `completed` on the already-imported invoices |
| `supplier_invoices` | +5 | `$3,002.00`, all Paid, source_branch `shop` |
| `customer_receivables` | +22 | all Paid, outstanding 0 |

Apply result: 711 rows written, 3,009 read, all statements successful.

## Stock was deliberately not touched

The user's instruction was "don't affect stock quantity, no deduction". Sales were
inserted **directly** rather than through `routes/sales.ts` or `lib/importEngine.ts`,
because both deduct stock for a status in
`salesStatus.ts::STOCK_DEDUCTED_STATUSES` — which contains `completed`.

Verified before and after: `SUM(products.stock_quantity)` **23,085 → 23,085** and
`COUNT(inventory_movements)` **23,079 → 23,079**. `products` (10,272) and `customers`
(4,970) both unchanged — nothing was created.

**Known consequence, intentional:** sold-quantity and stock-value disagree for these
invoices permanently. Read that as designed, not as a bug (flagged by peer `business-os-v1-ba`).

## Count reconciliation

`sales` moved 15,012 → 15,035, which is +23 against +22 written. The extra row is
**live business activity**, not this batch: sale id 16841 (`20260904-102300`, cashier
Rath) was rung up between the baseline snapshot and the apply. `MAX(sales.id)` is
16863 — this batch's last row — and no sale exists above it. Same for the one extra
`sale_items` row.

## Held back — needs a user ruling

`004430` and `004434` were **not** flipped to paid. Both are already live and both are
**short a line**, so their live total is not the invoice's real total:

| Invoice | Live | Report | Missing line |
|---|---|---|---|
| 004430 | $54 | $79 | YSL Libre 10ml — $25 |
| 004434 | $105 | $131 | Clinical Completely Clean 45g ×2 — $26 |

Marking a short invoice settled turns a visible exception into a closed record
(raised by `business-os-v1-ba`), so the flip waits until the lines are restored.

## The defect that caused those two, and the one it nearly caused here

`legacy-preflight.mjs::barcodeKey()` strips non-digits. It does **not** produce an
empty key for a SKU-style code — it produces a short numeric one:

```
"Libre10ml"          -> "10"
"CompletelyClean45g" -> "45"
```

The Sep-2 reconciliation fed those into a barcode lookup, matched nothing, and dropped
the lines. **This planner had the same bug** and it was caught in pre-write review by
peer session `business-os-v1-4a` before anything reached production. The near-miss was
serious: **44 live products carry the literal barcode `10`** (the placeholder used for
10ml perfumes), three of them active — including `10111 "YSL Libre 10ml"`, the exact
product the dropped line refers to. Only the duplicate-barcode quarantine prevented a
mis-book, and it did so by accident; with exactly one active match a YSL Libre line
would have been written against an unrelated perfume and looked correct forever.

Fixed in `0b4470a0`: a source code is a barcode only when it is **entirely digits**;
otherwise resolution falls through to SKU and then to a single exact active name.

**Blast radius is wider than this lane.** `import-sep01-legacy-reports.mjs` uses the
same helper via its own `digits()`, so Sep 1 shares the exposure. Peer
`business-os-v1-db` separately confirmed no *shipped app* code strips digits from a
barcode (`productDetailRule.ts` trims and lowercases only), so this class is confined
to the migration tooling. **Bounding it across the full reconciliation window is not
done and is owed** — it is a defect report, not part of this import.

## Identity policy applied

Unique **active** barcode first, then SKU, then a single exact active name; anything
else is quarantined rather than guessed. Nothing was created — no product, no customer.

- **Products** — all 45 distinct lines resolved to existing rows.
- **Six duplicate-barcode pairs** (the Sep-2 twin-product defect) resolved to the
  **older** pre-reconciliation row per the user's ruling: 5158, 4209, 2585, 9092, 1024, 7231.
- **Customers** — 14 resolved by phone or exact name. Six did not (`Ah phy`,
  `Kylean Thap`, `Sroun Kimhout`, `Ratana Sokhavatey`, `Sorphong Sam`, and `leap leap`
  which matches three records). Per the user's ruling these carry their reported name
  and phone with `customer_id` NULL — nothing created, no duplicate risk.
- **Suppliers** — Lang → 23, naomi → 28, j secrat → 20.
- **Cashier** — the exports carry no cashier column; `Za` (user id 3) matches the
  fifteen invoices already imported for the same days.

## Sources

Archived under explicit dated names in `Migration from old system/` (untracked):
`report-invoice-detail-sep02-04.xls`, `account-receivable-report-sep02-04.xls`,
`account-payable-report-supplier-sep02-04.xls`, `report-item-new-sep02-04.xls`.

The dated names are load-bearing: the archive **already holds an unrelated near-empty
`report-invoice-detail.xls`**, so resolving by bare report name — as the sibling
importers do — would silently pick the wrong file. The pure test asserts this.
