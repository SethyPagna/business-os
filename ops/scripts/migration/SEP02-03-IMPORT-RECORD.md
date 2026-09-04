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

**Blast radius: BOUNDED, and smaller than feared.** Measured read-only on Sep 4 2026 by
replaying each applied batch's own product resolution twice — once under the old helper,
once under the fixed rule — and diffing the resolved `product_id` per line.

| Batch | Lines checked | Resolve differently | Verdict |
|---|---|---|---|
| Sep 1, invoice lines | 56 over 29 invoices | **0** | clean; its only non-numeric code is blank |
| Sep 1, stock transfers | 4 non-numeric codes | **0** | all four are header/banner rows |
| Sep 2, the pre-existing 15 | 15 invoices | **2 dropped lines** | 004430 and 004434; other 13 reconcile to the cent |
| Sep 2, this batch's 22 | 45 distinct lines | 0 | resolved under the fixed rule |
| Aug 30 / Aug 31 | n/a | n/a | not exposed — see below |

**Total production impact of the defect: 2 lines, $51**, both in the two held invoices,
both restorable. Nothing was ever silently mis-booked into a wrong product; the
near-miss stayed a near-miss.

The Sep-1 **transfer** path deserved its own check and got one: it calls
`resolveUniqueBarcode` with **no name fallback**, so a bogus short key hitting exactly
one active product would mis-book silently. Its four non-numeric codes are `"Item Code"`
and three `"Created By:Super Admin…"` banner rows; none matches an active product.

Aug 30 and Aug 31 were **read rather than assumed**: `digits()` at `import-aug30:63` and
`import-aug31:74` is only ever called from `phoneKey` (`:265` and `:208`), never a
barcode lookup, and `barcodeKey` at `import-aug31:160` is a function parameter holding a
mapping column name, not the imported helper.

**Three matching strategies, two of which lie.** Recorded because they produce a
confidently wrong number: matching reported lines to live lines by normalized **name**
gives false positives, because the legacy report spells products differently
(`"Elf Halo Glow Powder Fair Nautral"` vs `"e.l.f. Halo Glow Powder Fair Natural"`);
matching by **price** gives false positives on nearly every line, because the report's
`Price` column is **pre-discount** while `sale_items.applied_price_usd` is
**post-discount**. Both said 5 dropped lines across 3 invoices. Only matching on
**product identity** gives the true 2 across 2, and the reported-vs-live line counts
corroborate it.

Peer `business-os-v1-db` separately confirmed no *shipped app* code strips digits from a
barcode (`productDetailRule.ts` trims and lowercases only), so the class was always
confined to migration tooling.

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


## How to exclude these rows from a stock backfill — read this before writing one

These 22 sales are `sale_status = 'completed'` and stock was **never taken** for them. Nothing in
the row says so. Any job that derives stock from completed sales — a backfill, a reconciliation, a
"repair the missing deductions" pass — will deduct 56 line quantities that were never meant to
move. Raised by `business-os-v1-ba`; it is the one genuine latent trap in this import.

```sql
-- interim handles. Both select exactly these 22 rows, verified against production:
--   notes LIKE 'Legacy import 004%'                -> 22
--   id BETWEEN 16842 AND 16863                     -> 22
--   notes-matches falling outside that id range    -> 0
```

Treat those as **interim, not durable**. `notes` is free text with no constraint preventing a
later import, a support edit or a UI note from matching `'Legacy import 004%'`; exact-today is not
the same property as stable.

**The durable handle is missing, and that is a defect in this import.**
`sales.legacy_receipt_number` is the typed column the system already uses for exactly this, in the
format `<invoice>@<YYYY-MM-DD>`. The date suffix exists because legacy invoice numbers repeat
across years — `004400@2025-07-24` and `004400@2026-09-01` are different sales. It is populated on
**15,004** rows, including all **35** from the earlier `0044xx@2026-09-0x` reconciliation, and is
**NULL on all 22 of these**. No value in the 004435–004456 range is currently tagged, and the index
`idx_sales_legacy_receipt_number` is **not unique**, so a corrective write cannot fail halfway on a
constraint. The write has **not** been made — it is a production write and needs the user's go.

If it is authorised, three conditions on it (all from `business-os-v1-ba`, all worth honouring):
re-confirm zero overlap with the values already present immediately before writing; derive each
value from **its own invoice and that invoice's own date**, never from position in the 16842–16863
id order, because this set spans **both Sep 2 and Sep 3** and a positional fill would silently
misdate any row whose insert order does not match its invoice date; and state the 22 explicit
`invoice -> value` pairs in this file so the write is checkable line by line.

**The gap is confined to `sales`.** `supplier_invoices` and `customer_receivables` both carry
`legacy_id`, `source_file`, `source_row` and `imported_at`, and this import populated them
(legacy_id 1305–1309 and the two dated `source_file` values). Those rows are already durably
identifiable; only the sales rows are not.

**A check that will NOT isolate these 22.** "Every completed sale has matching
`inventory_movements`" would flag a population, not this batch: production has **14,943** completed
sales and **23,079** movement rows, of which only **144** are sale-related at all (movement types:
add, adjustment, delete, reconciliation_add, reconciliation_remove, transfer_in, transfer_out,
return, return_reversal, sale). Ordinary POS deductions are **not** written as movements in this
system — `stock_quantity` is updated directly — so **14,905** completed sales already have no
movement row and these 22 join that population rather than standing out from it.

That is also why `SUM(products.stock_quantity)` holding at **23,085** is the load-bearing proof of
"no deduction" here; the flat `COUNT(inventory_movements)` at 23,079 only rules out offsetting
writes.


## Two warnings worth more than the counts

**1. The outcome was benign because a guard held, not because the key was harmless.**
(`business-os-v1-ee` and `business-os-v1-7c`.) `"Libre10ml"` normalises to `"10"`, and
**44 live products carry that literal barcode** — the 10ml-perfume placeholder. Only the
duplicate-barcode quarantine turned a mis-book into a drop, and it did so by accident:
with exactly one active match the line would have been written against an unrelated
perfume and looked correct forever. **If that quarantine is ever relaxed, this class
becomes silent mis-booking against those 44 products.** The bound says 2 lines and $51;
that number describes how lucky the data was, not how safe the code was.

**2. "No stock movement" is a property of writing D1 directly, NOT a property of the
change.** (`business-os-v1-ba`.) These rows are `completed`, and `completed` is in
`STOCK_DEDUCTED_STATUSES`, which **is** load-bearing: `routes/sales.ts:225` gates
`shouldDeductStock` on it and `lib/saleTransitions.ts:53` gates transitions on it. The
same rows created or re-applied **through the route or the UI would deduct**, because
that is what the status is supposed to mean. A later session that repeats this work "the
normal way" on the strength of a note saying "this does not affect stock" would take
deductions nobody expects. Say the method, not just the outcome.

## Why some legacy sales carry sale movements and others do not

Established read-only while scoping a later status flip, and recorded here because it
looks alarming and is not. Some legacy sales sit in `awaiting_payment` — a status **not**
in `STOCK_DEDUCTED_STATUSES` — while carrying `movement_type = 'sale'` rows. That is not a
route deducting against the constant, and not a status regression that failed to reverse.
Every one of those movement rows carries `reason LIKE 'Old-system sale%'`: they were
written deliberately by the legacy reconciliation to record the old system's own stock
effects. Most are attributed to `user_name = 'Old system'`; a couple are attributed to the
real cashier instead, which is attribution, not a different mechanism.

`movement_type = 'sale'` rows do not exist in this database before **2026-08-28** at all.
Legacy sales older than that have no movements because none was ever recorded — the same
reason all **14,921** already-completed legacy sales have none. Stock for that era arrived
as a migrated snapshot.

**Attribution is not provenance.** Reach for `reason`, not `user_name`, when bounding a
legacy set (`business-os-v1-ba`). Here `user_name` would have split this set 66 / 2 and sent
the next reader hunting a phantom manual stock adjustment by a named cashier; `reason LIKE
'Old-system sale%'` covers **68 of 68** and is what actually settled it.

**And that is the argument for the marker gap above, made better than tidiness.**
`inventory_movements` has a durable, queryable provenance marker — `reason LIKE
'Old-system sale%'` — which is exactly why the question in this section was answerable in a
single query instead of by inference. `sales` has no equivalent for this batch, which is why
the 22 rows need a `notes LIKE` match and an id range. Same system, same need, solved in one
table and lost in the other. Backfilling `legacy_receipt_number` is not housekeeping; it
restores to `sales` a capability `inventory_movements` already has.


## A third near-miss: `customer_receivables.invoice_no` is not a key

Found Sep 4 2026 while scoping the status flip, prompted by `business-os-v1-ba` noticing a
duplicate invoice number in passing. **`customer_receivables` has no `sale_id` and no date
qualifier on `invoice_no`.** Its real identity is `UNIQUE(source_file, legacy_id)`; the
invoice number is just a copied label, and it recycles hard:

| Measure | Value |
|---|---|
| AR rows | 13,304 |
| Distinct `invoice_no` | 6,807 |
| Invoice numbers appearing more than once | 4,179 (max 3 copies) |
| AR rows sharing a number with another row | **10,676 — 80%** |

`sales` solved this with `legacy_receipt_number` = `<invoice>@<YYYY-MM-DD>`. AR never did.

**The flip script correlated on the bare number and was one guard away from being wrong.**
Its AR statement matched `s.legacy_receipt_number LIKE cr.invoice_no || '@%'` — no date on
the AR side. Measured against the 82 target sales, that predicate reaches **152 AR rows**:
the intended 82, plus **70 wrong-year rows totalling $9,809.75** belonging to other
customers. Every one of those 70 is already `status = 'Paid'`, and the statement's
`WHERE status <> 'Paid'` filtered all 70 out — so the net effect on today's data was
exactly the correct 82 rows, $9,754.10 outstanding.

**That is the barcode near-miss again, in a different table.** Benign because of what the
data happened to contain, not because the key was right. Nothing was ever applied under
the loose form.

**The first fix traded a loud failure for a silent one, and was itself replaced.**
Tightening the predicate to `cr.invoice_no || '@' || substr(cr.invoice_date,1,10)` removed
the over-match, and an over-match is loud — wrong rows have to be excluded by something.
An under-match is silent (`business-os-v1-ba`): that predicate joins **two independently
sourced dates**, the AR file's `invoice_date` and the date baked into
`sales.legacy_receipt_number`. They agree for all 82 today. A legacy file recording an
invoice a day late, or a timezone difference at either write, produces a pair that differs
by one day and simply vanishes from the result set with no error.

**So the join was removed from execution entirely.** The 82 receivables are now addressed
by `id` — the primary key, which surfaces the table's *declared* identity
`UNIQUE(source_file, legacy_id)`. `invoice_no || '@' || date` is a **reconstructed** key,
correct today only because two sources happen to agree; the declared key is correct by
construction. The ids were resolved read-only and the mapping proved strictly **1:1**:
82 pairs / 82 distinct sales / 82 distinct AR rows, covering all 82 target sales, and the
**customer name agrees on all 82 pairs** — a third field corroborating a pairing derived
from two. Re-checked independently by id: all 82 present, all 82 still unpaid,
$9,754.10 outstanding.

The script now also states **expected `rows_written` per statement** (1 / 1 / 1 / 1 / 82 /
82) so the operator compares against a number at execution time rather than trusting a
count established at authoring time. That is the same lesson as the constructed index blob
that was valid against the HEAD it was built from and inverted when HEAD moved: **a
predicate verified against the data it was authored against has exactly that property.**

**And the re-run question found the one statement that was genuinely unsafe.**
`business-os-v1-ba` asked whether a second execution is a no-op, reasoning that pinning
the AR ids might have dropped the state condition along with the join. It had not — the
receivables update still carries `status <> 'Paid'`. But the question was right and the
answer was worse than the case that prompted it: **the two `sale_items` restorations were
bare `INSERT ... VALUES` with no guard at all.** A second run would have duplicated both
lines, while the total corrections below them — guarded on `AND total_usd = <old>` — would
have correctly no-opped. The result is a sale carrying **twice the line at the same total**:
worse than either failing or succeeding, and reached by an operator doing the reasonable
thing after an ambiguous first run.

Both are now `INSERT ... SELECT ... WHERE NOT EXISTS (sale_id, product_id)`. Verified
read-only that neither line is present today (0 and 0), so the guard is inert on the first
run and total on every one after it.

**All six statements now carry their own state guard**, so the file is idempotent end to
end: `NOT EXISTS` on the two restored lines, `AND total_usd = <old>` on the two total
corrections, `AND sale_status = 'awaiting_payment'` on the flip, `AND status <> 'Paid'` on
the receivables. The header says so, and says the thing an operator actually needs: **on a
re-run, 0 rows written everywhere is success, not failure.** A guard that makes re-running
safe is worth little if the person holding the file reads its silence as a fault.

**The guards buy more than idempotence — they buy convergence.** Each one tests the
precondition *that* statement needs rather than a shared "has this batch run" flag, so the
file reaches the correct end state from **any** starting point: fully unapplied, fully
applied, or any partial mixture. Stop after the inserts and a re-run no-ops them on
`NOT EXISTS` while the total corrections still see the old totals and apply correctly
(`business-os-v1-ba`). The batch *should* be atomic so a partial state should not arise;
the point is that the file does not have to depend on that. What this actually protects is
the ordinary case, not the exotic one: **the connection drops, the operator cannot tell
whether it committed, and the right move is simply to re-run.**

One correction worth recording because the plausible version is wrong: the six statements
are **order-insensitive**. The total corrections are guarded on a *literal* pre-correction
total (`AND total_usd = 54`), not on anything derived from the line items, so they cannot
fire early or twice wherever they sit. The ordering only becomes load-bearing if someone
later rewrites that guard to compute the total from `SUM(sale_items.total_usd)` — an
improvement that looks obvious and silently couples the sections. The script says: change
the guard and the order together, or not at all.

**Rule for the next reconciliation script:** `customer_receivables` is reachable by
`(source_file, legacy_id)` / `id`. Use that wherever the sale side can reach it, and the
reconstructed `invoice_no` + date only where it cannot — and say in the script which of the
two you are relying on and why. Whoever writes the next one will reach for `invoice_no`
first; that is what the 80% collision costs, and a comment naming the real key is what
stops them.

**Nothing in the Worker joins AR to sales on `invoice_no`** — grepped; the tables are not
linked in application code at all, so this is confined to migration and reconciliation
scripts. Any future script that reaches for `invoice_no` alone to tie AR to a sale is
wrong by default and needs the date, or the row's own `(source_file, legacy_id)`.

## The `partial_return` row, and a column that is empty everywhere

Sale **16671** (`004313@2026-08-25`, ចេ លក់ថ្នាំពេទ្យ, $349) is the only `partial_return`
in the database — `sales` holds 14,945 completed, 96 awaiting_payment, 3 cancelled, 1
partial_return. It was excluded from the flip because it is **already fully paid**
(`amount_paid_usd` = `total_usd` = $349), so there is nothing to settle, and flipping it to
`completed` would overwrite a return state rather than clear a debt. Its receivable (id 76)
is already `Paid` with zero outstanding, it has no supplier line, and the flip takes no
stock either way — the exclusion leaves no dangling reference. **A decision, not an
unfinished edge.**

Its `sale_items.returned_quantity` sums to 0, which looked like an anomaly and is not:
that column is **0 on all 36,230 sale_items rows**. It exists only for the sales-import
path (migration `0059_sale_item_import_return_quantity.sql`), and `routes/sales.ts:1698`
shadows it with a value derived from `return_items`, so the stored column is never read by
the API. The real return is recorded where it belongs: sale 16671 has one of the database's
two `returns` rows. The status is backed by a genuine return record, not set by hand.

## Sources

Archived under explicit dated names in `Migration from old system/` (untracked):
`report-invoice-detail-sep02-04.xls`, `account-receivable-report-sep02-04.xls`,
`account-payable-report-supplier-sep02-04.xls`, `report-item-new-sep02-04.xls`.

The dated names are load-bearing: the archive **already holds an unrelated near-empty
`report-invoice-detail.xls`**, so resolving by bare report name — as the sibling
importers do — would silently pick the wrong file. The pure test asserts this.
