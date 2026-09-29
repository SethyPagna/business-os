-- Read-path indexes for readers that scan today (lane IDX: OPT-1, OPT-5,
-- OPT-10, SCAN1 L17). Indexes only: no table, trigger or row changes.
--
-- scripts/test-migration-0205-perf-indexes-pure.cjs quotes every reader from
-- its source file and pins its plan, plus the readers whose plan must not move.
--
-- SQLite uses an expression index only for the exact expression the reader
-- writes, and a partial index only when the reader's WHERE implies the
-- index's WHERE, so these shapes follow the readers' text:
--   * idx_audit_logs_sale_ref: the sales list Not-paid page and the settle
--     check (0196's action index made both a three-way OR plus a sort per row).
--   * idx_products_active_expiry leads with is_active: the planner never
--     picks a partial expiry-only index over the is_active indexes.
--   * The foreign-key indexes are partial on IS NOT NULL: a row without a link
--     writes no index entry, and the `supplier_id IS NULL` name-match readers
--     keep their scan instead of seeking every unlinked lot.
--
-- Plans are pinned without sqlite_stat1, as production runs; ship no ANALYZE
-- or PRAGMA optimize with this (OPT-9: statistics can flip these plans).
-- Recovery: a later migration with DROP INDEX IF EXISTS for each name.

CREATE INDEX IF NOT EXISTS idx_audit_logs_sale_ref
  ON audit_logs(CAST(COALESCE(entity_id, record_id) AS TEXT))
  WHERE entity = 'sale' OR table_name = 'sale';
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_id_text ON audit_logs(CAST(entity_id AS TEXT));
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id_text ON audit_logs(CAST(record_id AS TEXT));

CREATE INDEX IF NOT EXISTS idx_products_active_expiry
  ON products(is_active, expiry_date)
  WHERE expiry_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_batches_credit_due
  ON product_batches(credit_due_date)
  WHERE payment_status = 'credit';
CREATE INDEX IF NOT EXISTS idx_product_batches_supplier
  ON product_batches(supplier_id)
  WHERE supplier_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_returns_customer ON returns(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_returns_supplier ON returns(supplier_id) WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_returns_return_number ON returns(return_number);
CREATE INDEX IF NOT EXISTS idx_sales_delivery_contact_created
  ON sales(delivery_contact_id, created_at)
  WHERE delivery_contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_share_submissions_customer_status
  ON customer_share_submissions(customer_id, status);
