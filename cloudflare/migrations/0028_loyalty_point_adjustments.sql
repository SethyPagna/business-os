-- Auditable administrator-issued loyalty points. Balances remain calculated
-- from immutable events rather than stored as a mutable customer total.
CREATE TABLE loyalty_point_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL,
  points REAL NOT NULL CHECK (points > 0),
  note TEXT,
  created_by_id INTEGER,
  created_by_name TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_loyalty_point_adjustments_customer_created
  ON loyalty_point_adjustments(customer_id, created_at DESC);
