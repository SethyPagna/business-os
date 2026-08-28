-- K2 / 11.13 + 11.12 (Part 410): the return-options chooser and Replace.
--
-- 1) Three-way stock classification per returned item. return_to_stock's
--    boolean (restock yes/no) becomes stock_action: 'none' | 'restock' |
--    'damaged'. The boolean column STAYS and is kept in step ('restock'
--    writes 1, the other two write 0) so nothing that still reads it --
--    exports, older clients mid-deploy -- changes meaning under it.
ALTER TABLE return_items ADD COLUMN stock_action TEXT;
UPDATE return_items SET stock_action = CASE WHEN COALESCE(return_to_stock, 0) = 1 THEN 'restock' ELSE 'none' END WHERE stock_action IS NULL;

-- 2) Damaged stock lives as TRACEABLE LOTS tied to the exact return,
--    branch and batch (locked design note) -- never as a duplicate
--    "damaged" product row and never inside sellable branch_stock.
--    quantity_remaining is what POS's damage option (11.9, next part) may
--    still draw from; it starts equal to quantity and only ever shrinks.
CREATE TABLE IF NOT EXISTS damaged_stock_lots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  product_name TEXT,
  branch_id INTEGER,
  batch_id INTEGER,
  return_id INTEGER,
  quantity REAL NOT NULL DEFAULT 0,
  quantity_remaining REAL NOT NULL DEFAULT 0,
  reason TEXT,
  created_by_user_id INTEGER,
  created_by_user_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_damaged_lots_product_branch ON damaged_stock_lots(product_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_damaged_lots_return ON damaged_stock_lots(return_id);

-- 3) Replace (11.12): the replacement lines handed to the customer with a
--    return -- an even exchange from SAME-NAME stock by default, drawn the
--    POS way (branch + batch), recorded beside the return's own items.
CREATE TABLE IF NOT EXISTS return_replacement_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT,
  branch_id INTEGER,
  batch_id INTEGER,
  quantity REAL NOT NULL DEFAULT 0,
  applied_price_usd REAL DEFAULT 0,
  applied_price_khr REAL DEFAULT 0,
  total_usd REAL DEFAULT 0,
  total_khr REAL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_return_replacements_return ON return_replacement_items(return_id);

-- 4) How the value gap between returned and replacement lines settles:
--    'even_exchange' (default -- no money moves, only allowed when the gap
--    is zero) or 'price_difference' (full-access only; the signed gap is
--    stored, positive = customer owes the difference).
ALTER TABLE returns ADD COLUMN settlement_mode TEXT;
ALTER TABLE returns ADD COLUMN settlement_diff_usd REAL DEFAULT 0;
ALTER TABLE returns ADD COLUMN settlement_diff_khr REAL DEFAULT 0;
