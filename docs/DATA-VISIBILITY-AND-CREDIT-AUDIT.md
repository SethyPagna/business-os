# Data-visibility & customer-credit audit (Aug 31 2026)

Investigation only — nothing below is implemented yet. Answers three questions
the user raised: (1) "awaiting payment" vs "on credit" (received-but-unpaid);
(2) what data is captured but never shown in the UI ("missing columns"); (3) an
excel-style column model on large screens so users see more without page-hopping.

Method: read the DB schema (`cloudflare/migrations/*.sql`), the backend sale/
contact routes, and the on-screen tables/detail views. All D1 access was
read-only. Claims carry `file:line` evidence; the Sales detail-modal gap was
re-verified by hand.

---

## 1. "Awaiting payment" vs "on credit" — the model gap

**Sale statuses** (`cloudflare/src/lib/salesStatus.ts`): `completed`,
`awaiting_payment`, `awaiting_delivery`, `cancelled`, `partial_return`,
`returned`. **Only `completed` + `awaiting_delivery` deduct stock.**

- `awaiting_payment` does **not** deduct stock — it's a *held/parked order*
  ("decide the payment later on the Sales page"). Goods are NOT released.
- **POS forces full payment** for every other status:
  `POS.tsx:2613` blocks checkout when `totalPaid < total` unless the status is
  `awaiting_payment`. There is no partial / credit tender.

So **"on credit" — customer takes the goods (stock leaves) but still owes a
balance — has no representation.** `awaiting_payment` withholds stock (wrong),
and `completed` assumes paid-in-full (loses the balance).

**The asymmetry with suppliers is the tell.** The supplier (AP) side has a
complete credit model; the customer (AR) side has nothing:

| | Supplier (AP) | Customer (AR) |
|---|---|---|
| Credit flag | `product_batches.payment_status` = `paid`/`credit` (mig 0065) | — |
| Due date | `credit_due_date` (mig 0065) | — |
| Outstanding math | `contacts.ts:1060,1335-1396` (`credit_open_usd`, `outstanding_balance_usd`, aging, status filters) | — |
| UI | `ApInvoicesSection.tsx` (due dates, outstanding totals, status filters) | none — `CustomersTab.tsx` has no owed/outstanding/credit anywhere |

This is exactly why the legacy AR report had no home: those "Unpaid" invoices are
customers who took goods on credit, which the live model can't express. The new
`customer_receivables` ledger (migration 0094) parks that history, but the app
still can't **create or manage** a customer credit sale going forward.

**Proposal (symmetric to the supplier side):**
1. Allow a `completed` (stock-deducted) sale to be **partially paid / on credit**
   — persist the outstanding balance (`amount_paid_usd/khr` already exist) + an
   optional `credit_due_date`, instead of forcing full tender.
2. In the UI, separate **"Awaiting payment"** (held, not released) from
   **"On credit"** (released, balance owed) — distinct business states.
3. Add a customer **Receivables/AR** section (mirror `ApInvoicesSection`) reading
   `customer_receivables` + live on-credit sales: who owes, how much, aging, due
   dates; and a per-customer balance on `CustomersTab`.

---

## 2. Captured but not shown — the "missing columns"

Backend returns everything (`GET /api/sales` sends `s.*` + `si.*`,
`sales.ts:1569,1585`), so every gap below is a **UI-rendering** gap, not a
data-availability one. Buckets: **List**, **Detail/Receipt**, **Not shown**.

### Sales — biggest genuine gaps
- **`SaleDetailModal` totals are USD-only and incomplete** (verified,
  `SaleDetailModal.tsx:344-394`): shows subtotal/discount/tax/total/paid/change
  in USD, but has **no delivery-fee line, no actual-delivery-cost, no
  split-tender (`payment_details`), no `payment_currency`, and no KHR
  counterparts** for paid/change/tax/discount. The printable receipt shows most
  of these; the admin detail view does not.
- **`delivery_actual_cost_usd/khr`** (mig 0068) — recorded per sale at checkout
  (`POS.tsx:2733`) but per-sale visible only in the export + Dashboard/report
  aggregates; you cannot see it on an individual sale.
- **`sale_items` batch identity** `batch_id` / `batch_label` / `batch_expiry_date`
  (mig 0014) — captured, shown nowhere on the sale (notable vs 0014's stated
  intent that a receipt/return "still shows the correct lot/expiry").
- **`sale_items` per-line cost** `cost_price_usd/khr` and the whole **manual-
  discount audit trail** (`manual_discount_type/value/usd/khr`, mig 0007) —
  invisible; the receipt only shows a derived (base − charged) number.
- Also never shown per-sale: `payment_currency`, `subtotal_khr`,
  `delivery_fee_paid_by`, `loyalty_accrual` (the "earns points?" flag),
  `sale_items.unit` (UoM), `returned_quantity`. (`updated_at`,
  `client_request_id`, `search_normalized` are internal — expected.)

### Products
- Not surfaced anywhere: `custom_fields` (JSON), `rfid_confirmed_qty`,
  `discount_badge_color` (used for styling only).
- Shown in detail but **not in the table**: `description`, `wholesale_price_usd/khr`
  (mig 0093), `special_price`, low/out-of-stock thresholds.

### Customers
- `notes` — in the export + detail but **omitted from the table columns**
  (`CustomersTab.tsx:439`).
- Loyalty breakdown `points_earned/redeemed/rewarded/deducted` — computed, but the
  table shows only the net `points_balance`.

### Returns
- **No status column/badge** on the Returns list (unlike Sales' `StatusBadge`);
  cancelled returns are only dimmed. `exchange_rate`, `device_name/tz` never shown;
  `cashier_name`/`branch_name` shown in detail but not the list.

---

## 3. Excel-style columns on large screens

**Current state (agent-surveyed):**
- **No shared data-grid.** Every on-screen table is bespoke `<table>`/`<th>`/`<td>`
  JSX. The one reusable piece, `ContactTable` (`contacts/shared.tsx:282`), takes
  `columns` as a plain `ReactNode[]` + a hardcoded `renderRow` — no column model.
- **No on-screen column chooser exists.** Responsive control today is Tailwind
  `hidden md:table-cell` / `lg:table-cell` / `xl:table-cell` per column (Sales,
  Products, Inventory), or a whole-table→cards swap (Returns, Contacts).
- **A ready foundation exists for exports**: `shared/ExportOptionsDialog.tsx` +
  `utils/exportOptions.ts` — an `ExportColumn { key, label, defaultSelected }`
  model with select-all/defaults/per-column checkboxes and **per-surface
  localStorage memory** (`bos_export_columns_<key>`). It drives the export file,
  not the screen, but it's the right model to reuse on-screen.

**Proposed approach:**
1. Introduce a shared `ColumnDef { key, label, defaultVisible, render, minWidth,
   optional }` model + a `useColumnVisibility(surfaceKey)` hook that remembers the
   chosen columns per surface in localStorage (reuse the exportOptions pattern).
2. A large-screen-only **column chooser** (gear/▾ on the table header) that
   toggles optional columns; compact/mobile keeps the folded row/expander layout
   per the density preference — this is a large-screen affordance only.
3. The **"extra columns" are exactly the stored-but-not-shown fields from §2** —
   e.g. Sales could expose delivery fee, actual delivery cost, payment currency,
   loyalty-accrual, batch/lot, per-line cost; Returns a status column; Customers
   notes + points breakdown + (from §1) an outstanding-balance column.
4. Refactor order (least→most work): Contacts (already a `columns` array) →
   Inventory/Returns → Sales/Products (cells are inline JSX, need extraction into
   a columns array first).

---

## Suggested sequencing (needs a decision on priority)

- **A. Customer credit / AR** (§1) — the deepest and most valuable; backend
  (allow on-credit completed sales + due date) + a customer AR view. Reuses the
  supplier AP pattern and the new `customer_receivables` ledger.
- **B. Fill the visible gaps** (§2) — smaller, high-signal wins, e.g. complete the
  `SaleDetailModal` (delivery fee, split tender, KHR, actual cost), add a Returns
  status badge, show batch/lot on a sale.
- **C. Excel-style column chooser** (§3) — the biggest build; a shared column model
  + per-surface chooser. B's fields become C's optional columns, so doing a slice
  of B first de-risks C.

These overlap hot frontend lanes (Sales/Products/Contacts/Returns), so
implementation must be coordinated per the parallel-session rules.

---

## Implementation status (Part 573 — user said "do all")

Built disjoint-first to avoid the hot lanes. Shipped + verified:

- **A (backend model + read):** migration `0096_sales_credit_due_date.sql`;
  `GET /customers/reports/ar-invoices` (`contacts.ts`, mirrors the AP endpoint,
  resilient if the ledger isn't applied). Worker typecheck + endpoint SQL verified
  in local sqlite against the 13,243-row ledger.
- **A (UI):** `contacts/ArInvoicesSection.tsx` + `getCustomerReceivables` transport
  — a customer Receivables view (owed/credit/paid buckets, filters, column chooser).
  Typecheck clean. **NOT mounted** (its home `CustomersTab.tsx` is owned by the
  active contacts lane) — a one-line mount is the follow-up.
- **B:** `SaleDetailModal` now shows delivery fee / actual cost / split-tender /
  payment currency / KHR amounts / an Outstanding (on-credit) line; Returns list
  gained a **Status** column.
- **C:** shared `columnPreferences.ts` (unit-tested) + `useColumnPreferences` +
  `ColumnChooser`; wired live into the Returns list (Status default-on, Cashier
  optional) — verified in-browser: chooser toggles columns and remembers per
  surface. Also wired into the AR section.

Deferred (all to avoid conflict / need another lane's files):
- **Mount** `ArInvoicesSection` into the Customers tab (contacts lane owns it).
- **i18n keys** for the new labels in `lang/{en,km}.json` (Sales lane owns the
  packs) — labels use English fallbacks meanwhile.
- **POS "create an on-credit sale"** entry UX (partial tender + due date) —
  design-sensitive; `sales.credit_due_date` is in place for it.
- **Column chooser on Sales/Products/Contacts tables** — those tables are in hot
  lanes and need refactoring into a columns array first.
