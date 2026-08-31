-- Incremental legacy migration ledgers (Aug 31 2026).
--
-- The old application exposes supplier AP and deleted-during-sale reports,
-- but neither record type had a faithful destination in Business OS.  They
-- are deliberately stored as their own ledgers: AP rows must not manufacture
-- stock receipts, and abandoned/deleted cart lines must not manufacture sales
-- or inventory movements.

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_branch TEXT NOT NULL,
  branch_id INTEGER,
  legacy_id INTEGER NOT NULL,
  supplier_id INTEGER,
  supplier_code TEXT,
  supplier_name TEXT NOT NULL,
  invoice_no TEXT,
  invoice_date TEXT NOT NULL,
  due_date TEXT,
  term_days INTEGER NOT NULL DEFAULT 0,
  taxable_amount_usd REAL NOT NULL DEFAULT 0,
  vat_amount_usd REAL NOT NULL DEFAULT 0,
  total_amount_usd REAL NOT NULL DEFAULT 0,
  amount_paid_usd REAL NOT NULL DEFAULT 0,
  outstanding_balance_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_branch, legacy_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_invoices_date
  ON supplier_invoices(invoice_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_supplier_date
  ON supplier_invoices(supplier_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_status_due
  ON supplier_invoices(status, due_date);
CREATE INDEX IF NOT EXISTS idx_supplier_invoices_branch_date
  ON supplier_invoices(branch_id, invoice_date DESC);

CREATE TABLE IF NOT EXISTS legacy_deleted_sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL,
  event_started_at TEXT,
  event_ended_at TEXT,
  invoice_no TEXT,
  reference_no TEXT,
  cashier_name TEXT,
  bill_delete_reason TEXT,
  deleted_at TEXT,
  deleted_by TEXT,
  deletion_reason TEXT,
  product_id INTEGER,
  source_product_name TEXT NOT NULL,
  product_name TEXT,
  source_code TEXT,
  quantity REAL NOT NULL DEFAULT 0,
  unit_price_usd REAL NOT NULL DEFAULT 0,
  discount_raw TEXT,
  total_usd REAL NOT NULL DEFAULT 0,
  source_file TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_file, source_row)
);

CREATE INDEX IF NOT EXISTS idx_legacy_deleted_items_event
  ON legacy_deleted_sale_items(event_key, source_row);
CREATE INDEX IF NOT EXISTS idx_legacy_deleted_items_deleted_at
  ON legacy_deleted_sale_items(deleted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_legacy_deleted_items_product
  ON legacy_deleted_sale_items(product_id, deleted_at DESC);

-- Source-backed corrections for the legacy sales converter's item-column
-- bug.  The source report carries per-unit Price/Discount; the old converter
-- accidentally used the receipt-wide amount on the first line.  Keeping the
-- correction rows makes the repair independently reconcilable later.
CREATE TABLE IF NOT EXISTS legacy_sale_item_corrections (
  source_key TEXT PRIMARY KEY,
  receipt_number TEXT NOT NULL,
  line_ordinal INTEGER NOT NULL,
  product_id INTEGER,
  product_name TEXT,
  sku TEXT,
  quantity REAL NOT NULL DEFAULT 1,
  branch_id INTEGER,
  batch_id INTEGER,
  applied_price_usd REAL NOT NULL,
  total_usd REAL NOT NULL,
  base_price_usd REAL NOT NULL,
  manual_discount_usd REAL NOT NULL,
  cost_price_usd REAL NOT NULL,
  source_file TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(receipt_number, line_ordinal)
);

CREATE INDEX IF NOT EXISTS idx_legacy_sale_item_corrections_receipt
  ON legacy_sale_item_corrections(receipt_number, line_ordinal);

-- Every row inserted here applies one signed stock effect and writes its
-- matching inventory movement in the same SQLite statement/trigger.  The
-- source key is the idempotency guard: rerunning an import uses INSERT OR
-- IGNORE and can never apply a sale or transfer twice.
CREATE TABLE IF NOT EXISTS legacy_inventory_effects (
  source_key TEXT PRIMARY KEY,
  product_id INTEGER NOT NULL,
  branch_id INTEGER NOT NULL,
  batch_id INTEGER,
  quantity_delta REAL NOT NULL DEFAULT 0,
  movement_quantity REAL NOT NULL,
  movement_type TEXT NOT NULL,
  reason TEXT,
  reference_id INTEGER,
  occurred_at TEXT NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS trg_legacy_inventory_effect_apply
AFTER INSERT ON legacy_inventory_effects
BEGIN
  UPDATE products
  SET stock_quantity = stock_quantity + NEW.quantity_delta,
      updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.product_id;

  UPDATE branch_stock
  SET quantity = quantity + NEW.quantity_delta
  WHERE product_id = NEW.product_id AND branch_id = NEW.branch_id;

  UPDATE branch_batch_stock
  SET quantity = quantity + NEW.quantity_delta,
      updated_at = CURRENT_TIMESTAMP
  WHERE NEW.batch_id IS NOT NULL
    AND batch_id = NEW.batch_id AND branch_id = NEW.branch_id;

  INSERT INTO inventory_movements (
    product_id, product_name, branch_id, branch_name, movement_type,
    quantity, unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr,
    reason, reference_id, user_id, user_name, created_at, batch_id
  )
  SELECT
    p.id, p.name, b.id, b.name, NEW.movement_type,
    NEW.movement_quantity,
    COALESCE(p.cost_price_usd, 0), COALESCE(p.cost_price_khr, 0),
    NEW.movement_quantity * COALESCE(p.cost_price_usd, 0),
    NEW.movement_quantity * COALESCE(p.cost_price_khr, 0),
    NEW.reason, NEW.reference_id, NULL, 'Old system', NEW.occurred_at,
    NEW.batch_id
  FROM products p
  JOIN branches b ON b.id = NEW.branch_id
  WHERE p.id = NEW.product_id;
END;
