-- Mark a sale whose status change deliberately moved NO stock.
--
-- WHY.  On 2026-09-02 a reconciliation pass rewrote every product's quantity
-- to the physically-counted truth, and that count ALREADY assumes the
-- migrated old-system sales are completed.  On 2026-09-03 at 21:48 local an
-- admin bulk-changed 7 migrated sales from `awaiting_payment` to `completed`;
-- the transition kernel dutifully deducted 9 units that were already
-- accounted for, and branch 2 is 9 units short across 9 products.
--
-- The user's rule (2026-09-03): "i want you to make them status completed
-- without changing stock quantity. and make this an option for admins."
--
-- WHAT THIS STORES.  routes/sales.ts's PATCH /:id/status accepts an
-- admin-only `skip_stock` flag (isAdminControlUser, refused with 403 for
-- anyone else) that performs the whole transition -- status, payment fields,
-- cancellation record, audit, notification -- while emitting ZERO stock
-- statements: no branch_stock, no products.stock_quantity, no
-- branch_batch_stock, no allocation release and no inventory_movements row.
-- These columns are how a sale that was skipped ON PURPOSE stays
-- distinguishable, months later, from one whose deduction was lost to a bug.
--
-- WHY IT IS ALSO A GUARD, NOT JUST A LABEL.  lib/saleTransitions.ts's held()
-- state machine assumes the system itself took the units out.  Once a sale
-- reaches `completed` without any deduction, held(completed) is a lie for
-- that sale, and a later cancel would compute delta = 0 - quantity and ADD
-- units that were never taken -- inventing stock, the exact failure this
-- feature exists to stop.  So the route reads stock_skipped back on EVERY
-- later transition of the sale and skips stock again.  Once skipped, always
-- skipped: the sale is permanently outside the stock ledger.  Real returns
-- against it still restock normally, because routes/returns.ts works from the
-- return record (goods physically came back) and not from held().
--
-- The default is 0, so every existing row keeps today's behaviour exactly.

ALTER TABLE sales ADD COLUMN stock_skipped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sales ADD COLUMN stock_skipped_at TEXT;
ALTER TABLE sales ADD COLUMN stock_skipped_by_name TEXT;

-- Partial index: the interesting rows are the rare marked ones (auditing
-- "which sales were moved without touching stock"), so the index stays tiny.
CREATE INDEX IF NOT EXISTS idx_sales_stock_skipped ON sales(stock_skipped) WHERE stock_skipped = 1;
