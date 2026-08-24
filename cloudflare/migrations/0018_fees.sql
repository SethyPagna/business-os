-- Adds the `fees` table backing the new standalone Fees page (tracking tax,
-- delivery, and other manual fees/charges separately from the read-only
-- "Fees collected" stat card Inventory.tsx already has, which only ever
-- summed tax + delivery off completed sales and had no manual-entry or
-- individually-editable record).
--
-- A fee can optionally be matched to an existing sale (sale_id), but this is
-- deliberately NOT a foreign key with ON DELETE CASCADE: a fee is its own
-- durable record. If the sale it was matched against is later deleted, the
-- fee must still exist and still show its own amount/date/notes -- matching
-- the "must reconcile against real records, no broken data" ask. sale_id
-- just becomes an orphaned reference at that point (routes/fees.ts's list
-- endpoint LEFT JOINs and tolerates a missing sale row the same way
-- routes/sales.ts already tolerates a missing customer_id).
--
-- Both currencies are stored (amount_usd, amount_khr) rather than one
-- amount + a currency flag, matching every other money-bearing table in
-- this schema (sales, sale_items, returns all store _usd/_khr pairs side by
-- side) -- keeps every downstream report/sum consistent with the rest of
-- the app instead of needing a conversion at read time.
--
-- fee_type is free-text, not a CHECK-constrained enum (D1/SQLite has no
-- native enum type, and the known set -- tax, delivery, change, other --
-- is enforced at the edges by the frontend's fixed dropdown, same pattern
-- migrations/0017_customers_gender.sql already used for `gender`).

CREATE TABLE fees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fee_type TEXT NOT NULL DEFAULT 'other',
  label TEXT,
  amount_usd REAL NOT NULL DEFAULT 0,
  amount_khr REAL NOT NULL DEFAULT 0,
  fee_date TEXT NOT NULL,
  sale_id INTEGER,
  branch_id INTEGER,
  notes TEXT,
  created_by INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_fees_fee_date ON fees(fee_date);
CREATE INDEX idx_fees_fee_type ON fees(fee_type);
CREATE INDEX idx_fees_sale_id ON fees(sale_id);
