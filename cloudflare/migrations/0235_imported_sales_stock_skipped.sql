-- 0235: mark every sale the sales import created as outside the stock ledger
-- (sales.stock_skipped = 1). RET-B F4 / loophole LH-2, transition-matrix
-- audit of 2026-10-05. Append-only chain; the work and guard tables below are
-- this file's own. LF-only (see .gitattributes and
-- scripts/test-migration-line-endings-pure.cjs).
--
-- ============================= WHY THIS EXISTS ===========================
-- lib/salesImportCommit.ts writes historical sales WITHOUT deducting stock:
-- the real-world sale took the units off the shelf long before the file was
-- produced, and the counted stock already reflects it. But it never set the
-- sticky stock_skipped flag (migration 0114), which is the only thing the
-- transition kernel reads to know a sale's units were never in the ledger
-- (lib/saleTransitions.ts planSaleStockTransition). So cancelling an imported
-- sale, or lowering/removing one of its lines, handed back units the system
-- never took -- phantom stock. From this release the import sets the flag
-- itself; this file marks the sales imported before it.
--
-- ============================== WHICH SALES ==============================
-- Exactly the sales a committed import row created: the import's own
-- idempotency key is client_request_id = 'sales-import:<job_id>:<row>' and its
-- commit ledger is import_sales_commits (migration 0060) with
-- group_key = 'row:<row>' and status 'applied'. A sale is marked only when
-- that key joins to an applied ledger row -- not by a LIKE on the id, not by
-- legacy_receipt_number (POS sales never carry the prefix; legacy-sale:% rows
-- written by ops/scripts/migration are a different source and are NOT marked
-- here). Cancelled imported sales are marked too: once skipped, always
-- skipped. The units an earlier cancel or amendment already handed back are
-- NOT corrected here (that is a stock write, owner-gated; sized by the
-- read-only query in the RET-B lane report).
--
-- The flag changes no quantity anywhere: no branch_stock, lot, rollup or
-- movement row is written. Provenance is the work table below (every marked
-- sale with its before-values) and stock_skipped_by_name on each sale; no
-- audit_logs row, so the file names no table the held 0200 cost repair reads
-- or writes beyond sales columns it never names (test-held-0200 proves the
-- two orders agree). It bumps each marked sale's write revision
-- (trigger sale_revision_sales_update, 0120), so an Undo pinned to the old
-- revision is refused as "changed" instead of replaying stale stock math.
--
-- ============================== IDEMPOTENCE ==============================
-- The work table is filled with INSERT OR IGNORE from rows still unmarked;
-- rows already applied drive nothing. A second run marks nothing and every
-- guard holds on the empty set. A fixture database without imports is a no-op.
--
-- ============================== PRE-ASSERTION (read-only, run first) =====
--   SELECT COUNT(*) AS to_mark,
--          SUM(CASE WHEN s.sale_status='cancelled' THEN 1 ELSE 0 END) AS cancelled
--   FROM import_sales_commits c
--   JOIN sales s ON s.client_request_id = 'sales-import:' || c.job_id || ':' || c.row_number
--     AND s.client_request_id IS NOT NULL AND s.client_request_id <> ''
--   WHERE c.status='applied' AND c.group_key = 'row:' || c.row_number
--     AND COALESCE(s.stock_skipped,0)=0;
--   SELECT COUNT(*) FROM imported_sale_stock_skip_0235;  -- expect 'no such table' (first run)
--
-- ============================== POST-ASSERTION ===========================
--   SELECT COUNT(*) FROM imported_sale_stock_skip_0235 WHERE applied=1;          -- = to_mark
--   SELECT COUNT(*) FROM import_sales_commits c
--   JOIN sales s ON s.client_request_id = 'sales-import:' || c.job_id || ':' || c.row_number
--     AND s.client_request_id IS NOT NULL AND s.client_request_id <> ''
--   WHERE c.status='applied' AND c.group_key = 'row:' || c.row_number
--     AND COALESCE(s.stock_skipped,0)=0;                                          -- 0
--   SELECT COUNT(*) FROM sales WHERE stock_skipped_by_name='migration:0235_imported_sales_stock_skipped'
--     AND COALESCE(client_request_id,'') NOT LIKE 'sales-import:%';               -- 0
--
-- ============================== RECOVERY =================================
-- Every marked sale and its before-values are in imported_sale_stock_skip_0235.
-- To reverse (stock is untouched either way, so nothing else moves):
--   UPDATE sales SET stock_skipped = 0, stock_skipped_at = NULL, stock_skipped_by_name = NULL
--   WHERE id IN (SELECT sale_id FROM imported_sale_stock_skip_0235 WHERE applied = 1)
--     AND stock_skipped_by_name = 'migration:0235_imported_sales_stock_skipped';
--   UPDATE imported_sale_stock_skip_0235 SET applied = 0, applied_at = NULL;

CREATE TABLE IF NOT EXISTS imported_sale_stock_skip_0235 (
  sale_id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  client_request_id TEXT NOT NULL,
  receipt_number TEXT,
  sale_status TEXT,
  stock_skipped_before INTEGER NOT NULL,
  stock_skipped_at_before TEXT,
  stock_skipped_by_name_before TEXT,
  applied INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT
);

INSERT OR IGNORE INTO imported_sale_stock_skip_0235 (
  sale_id, job_id, row_number, client_request_id, receipt_number, sale_status,
  stock_skipped_before, stock_skipped_at_before, stock_skipped_by_name_before
)
SELECT s.id, c.job_id, c.row_number, s.client_request_id, s.receipt_number, s.sale_status,
  COALESCE(s.stock_skipped, 0), s.stock_skipped_at, s.stock_skipped_by_name
FROM import_sales_commits c
JOIN sales s ON s.client_request_id = 'sales-import:' || c.job_id || ':' || c.row_number
  AND s.client_request_id IS NOT NULL AND s.client_request_id <> ''
WHERE c.status = 'applied'
  AND c.group_key = 'row:' || c.row_number
  AND COALESCE(s.stock_skipped, 0) = 0;

-- Guards: every check must be 1 or the CHECK constraint aborts the file
-- before any sale is marked.
CREATE TABLE IF NOT EXISTS imported_sale_stock_skip_guard_0235 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM imported_sale_stock_skip_guard_0235;
-- every pending row is a sales-import sale whose key still matches its ledger row
INSERT INTO imported_sale_stock_skip_guard_0235 (check_name, ok)
SELECT 'pending_rows_are_import_keys', CASE WHEN NOT EXISTS (
  SELECT 1 FROM imported_sale_stock_skip_0235 w
  JOIN sales s ON s.id = w.sale_id
  WHERE w.applied = 0
    AND (s.client_request_id IS NOT w.client_request_id
      OR w.client_request_id <> 'sales-import:' || w.job_id || ':' || w.row_number)
) THEN 1 ELSE 0 END;
-- each ledger row created at most one marked sale, and no sale is claimed twice
INSERT INTO imported_sale_stock_skip_guard_0235 (check_name, ok)
SELECT 'one_sale_per_import_row', CASE WHEN NOT EXISTS (
  SELECT 1 FROM imported_sale_stock_skip_0235 GROUP BY job_id, row_number HAVING COUNT(*) > 1
) THEN 1 ELSE 0 END;
-- nothing pending is already marked (the flag is never rewritten)
INSERT INTO imported_sale_stock_skip_guard_0235 (check_name, ok)
SELECT 'pending_rows_still_unmarked', CASE WHEN NOT EXISTS (
  SELECT 1 FROM imported_sale_stock_skip_0235 w JOIN sales s ON s.id = w.sale_id
  WHERE w.applied = 0 AND COALESCE(s.stock_skipped, 0) <> 0
) THEN 1 ELSE 0 END;

UPDATE sales SET
  stock_skipped = 1,
  stock_skipped_at = datetime('now'),
  stock_skipped_by_name = 'migration:0235_imported_sales_stock_skipped'
WHERE id IN (SELECT sale_id FROM imported_sale_stock_skip_0235 WHERE applied = 0)
  AND COALESCE(stock_skipped, 0) = 0;

UPDATE imported_sale_stock_skip_0235 SET applied = 1, applied_at = datetime('now') WHERE applied = 0;

-- Post-guard: no applied import row is left unmarked.
DELETE FROM imported_sale_stock_skip_guard_0235;
INSERT INTO imported_sale_stock_skip_guard_0235 (check_name, ok)
SELECT 'every_imported_sale_marked', CASE WHEN NOT EXISTS (
  SELECT 1 FROM import_sales_commits c
  JOIN sales s ON s.client_request_id = 'sales-import:' || c.job_id || ':' || c.row_number
  AND s.client_request_id IS NOT NULL AND s.client_request_id <> ''
  WHERE c.status = 'applied' AND c.group_key = 'row:' || c.row_number
    AND COALESCE(s.stock_skipped, 0) = 0
) THEN 1 ELSE 0 END;
