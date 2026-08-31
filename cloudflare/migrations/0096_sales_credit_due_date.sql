-- Customer on-credit sales (Aug 31 2026).
--
-- Business OS had two customer non-paid states that don't fit "on credit":
--   * awaiting_payment -- a HELD order; stock is NOT released (see
--     lib/salesStatus.ts STOCK_DEDUCTED_STATUSES) and no money is taken.
--   * completed -- assumed paid in full (POS forces full tender).
-- Neither expresses "the customer took the goods but still owes a balance."
--
-- Give a completed (stock-deducted) sale an optional credit due date so it can
-- carry an outstanding balance (total_usd - amount_paid_usd) the way the
-- supplier side already does with product_batches.credit_due_date (migration
-- 0065). Nullable and additive: existing rows and the fully-paid path are
-- unaffected; the outstanding amount itself is derived from the existing
-- amount_paid_usd/khr columns, so no money column changes.
ALTER TABLE sales ADD COLUMN credit_due_date TEXT;

CREATE INDEX IF NOT EXISTS idx_sales_credit_due
  ON sales(credit_due_date)
  WHERE credit_due_date IS NOT NULL;
