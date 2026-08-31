-- Audit trail for source-backed corrections where the first migration pack's
-- converted sale_date landed on a different calendar day than the raw old-
-- system invoice-detail report.

CREATE TABLE IF NOT EXISTS legacy_sale_date_corrections (
  receipt_number TEXT PRIMARY KEY,
  previous_created_at TEXT NOT NULL,
  source_created_at TEXT NOT NULL,
  source_file TEXT NOT NULL,
  corrected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_legacy_sale_date_corrections_source_date
  ON legacy_sale_date_corrections(source_created_at, receipt_number);
