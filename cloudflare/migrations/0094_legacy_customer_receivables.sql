-- Customer accounts-receivable ledger (Aug 31 2026).
--
-- The old application exposes a customer AR report (per-invoice outstanding
-- balance + paid/unpaid status), but Business OS had no faithful destination
-- for it: the legacy sales converter books every imported sale as fully paid
-- (amount_paid = grand total) and keeps the credit only as a free-text note,
-- so the real customer outstanding balances -- 61 invoices customers still owe
-- and 367 invoices that were overpaid (store-held credit) -- were being lost.
--
-- Store the report faithfully in its own ledger, exactly as supplier AP is kept
-- in supplier_invoices (migration 0088). AR rows are a record of what was owed
-- at export time; they must NOT rewrite sale.amount_paid or manufacture any
-- payment, refund, or inventory movement. The source_file + legacy_id (the AR
-- report's own row ID) are the idempotency guard so a rerun cannot duplicate.

CREATE TABLE IF NOT EXISTS customer_receivables (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legacy_id INTEGER NOT NULL,
  customer_id INTEGER,
  customer_code TEXT,
  customer_name TEXT NOT NULL,
  invoice_no TEXT,
  invoice_date TEXT NOT NULL,
  taxable_amount_usd REAL NOT NULL DEFAULT 0,
  vat_amount_usd REAL NOT NULL DEFAULT 0,
  total_amount_usd REAL NOT NULL DEFAULT 0,
  amount_paid_usd REAL NOT NULL DEFAULT 0,
  outstanding_balance_usd REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_file, legacy_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_receivables_date
  ON customer_receivables(invoice_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_customer_receivables_customer_date
  ON customer_receivables(customer_id, invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_receivables_status
  ON customer_receivables(status, outstanding_balance_usd);
CREATE INDEX IF NOT EXISTS idx_customer_receivables_invoice_no
  ON customer_receivables(invoice_no, invoice_date DESC);
