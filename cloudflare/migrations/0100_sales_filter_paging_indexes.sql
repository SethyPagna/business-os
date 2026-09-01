-- Sales history is now paged in D1 instead of truncating to one client-side
-- 500-row window. These indexes match the filters that otherwise cannot use
-- idx_sales_created_pg because an equality predicate precedes the date/order
-- columns. The sale_items index supports the branch fallback EXISTS clause;
-- the existing product-first index cannot seek by branch_id alone.

CREATE INDEX IF NOT EXISTS idx_sales_branch_created
  ON sales (branch_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_sales_cashier_created
  ON sales (cashier_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_sale_items_branch_sale
  ON sale_items (branch_id, sale_id);

-- Branch transfer history is also server-paged now. These support the
-- chronological list and the two exact branch filters without scanning the
-- entire transfer ledger for every page/date-range change.
CREATE INDEX IF NOT EXISTS idx_stock_transfers_created
  ON stock_transfers (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_from_created
  ON stock_transfers (from_branch_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_to_created
  ON stock_transfers (to_branch_id, created_at DESC, id DESC);

