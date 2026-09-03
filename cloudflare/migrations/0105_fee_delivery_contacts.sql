-- Link standalone expense rows to delivery contacts without changing their
-- accounting classification.  A Capital Express row may therefore remain
-- fee_type='expense', while a Grab row can be fee_type='delivery'; the link is
-- independent and lets the courier drill-down include both sales and costs.
ALTER TABLE fees ADD COLUMN delivery_contact_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_fees_delivery_contact_date
  ON fees(delivery_contact_id, fee_date DESC, id DESC);
