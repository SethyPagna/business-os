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
-- Every sale whose client_request_id is the import's own key,
-- 'sales-import:<job_id>:<row>'. Since a6c4cf093 (2026-08-28), the commit
-- that introduced the key, applyHistoricalSaleImport is the ONLY writer of
-- that prefix (git log --all -S"sales-import:" over cloudflare/src,
-- frontend/src and ops finds only a6c4cf093 and this lane), and EVERY version
-- of it (21 commits a6c4cf093..197c78c1d, each read with git show) writes
-- exactly four stock statements, all additive by @returned_quantity and all
-- behind `if (!isReturnGroup || returnedQuantity <= 0) continue`: no version
-- ever deducted stock at creation. So no sale carrying the prefix ever had
-- units taken that a later cancel should give back.
--
-- The import's commit ledger (import_sales_commits) is NOT used: import
-- retention deletes it 7 days after a job ends (lib/importRetention.ts), so
-- production holds no joinable ledger rows for the existing imports.
--
-- A POST /api/sales caller can choose its own client_request_id, so a forged
-- prefix is possible in principle. The guards below abort the whole file if
-- any target carries evidence of a POS-made sale (a creation snapshot whose
-- origin is not 'sales_import', or money_precision_version 1, which the
-- import never writes) or a key that is not the import's shape. Nothing is
-- guessed: an abort is reported, not worked around.
--
-- legacy-sale:% rows (ops migration scripts) and POS sales are not touched.
-- Cancelled imported sales are marked too: once skipped, always skipped. Units
-- an earlier cancel or amendment already handed back are NOT corrected here
-- (a stock write, owner-gated; sized by
-- ops/queries/forensics-f4-imported-sales-stock-skipped.sql).
--
-- The flag changes no quantity anywhere: no branch_stock, lot, rollup or
-- movement row is written. Provenance is the work table below (every marked
-- sale with its before-values) and stock_skipped_by_name on each sale; no
-- audit_logs row, so the file names no table the held 0200 cost repair reads
-- or writes beyond sales columns it never names (test-held-0200 proves the
-- two orders agree on a seeded import). The UPDATE bumps each marked sale's
-- write revision (trigger sale_revision_sales_update, 0120), so an Undo
-- pinned to the old revision is refused as "changed". Every target must pass
-- the 0161 sales money trigger; one that does not aborts the file atomically
-- with 'money_precision_invalid_sales' (the ops query counts them first).
--
-- ============================== IDEMPOTENCE ==============================
-- The work table is filled with INSERT OR IGNORE from rows still unmarked;
-- rows already applied drive nothing. A second run marks nothing and every
-- guard holds on the empty set. A fixture database without imports is a no-op.
--
-- ============================== PRE-ASSERTION (read-only, run first) =====
--   ops/queries/forensics-f4-imported-sales-stock-skipped.sql: to_mark is the
--   number this file must mark; pos_evidence, bad_shape and would_trip_0161
--   must be 0.
--
-- ============================== POST-ASSERTION ===========================
--   SELECT COUNT(*) FROM imported_sale_stock_skip_0235 WHERE applied=1;          -- = to_mark
--   SELECT COUNT(*) FROM sales WHERE client_request_id >= 'sales-import:' AND client_request_id < 'sales-import;'
--     AND COALESCE(stock_skipped,0)=0;                                            -- 0
--   SELECT COUNT(*) FROM sales WHERE stock_skipped_by_name='migration:0235_imported_sales_stock_skipped'
--     AND COALESCE(client_request_id,'') NOT LIKE 'sales-import:%';               -- 0
--
-- ============================== RECOVERY =================================
-- Clearing the flag is only safe for a sale that has not changed since it was
-- marked. A marked sale that was later cancelled moved nothing (it was
-- skipped); clear its flag and an un-cancel would then DEDUCT units that were
-- never handed back. So recovery clears only rows whose sale still has the
-- updated_at and status recorded here; any other row needs owner review.
--   UPDATE sales SET stock_skipped = 0, stock_skipped_at = NULL, stock_skipped_by_name = NULL
--   WHERE stock_skipped_by_name = 'migration:0235_imported_sales_stock_skipped'
--     AND EXISTS (SELECT 1 FROM imported_sale_stock_skip_0235 w WHERE w.sale_id = sales.id AND w.applied = 1
--       AND w.updated_at_before IS sales.updated_at AND w.sale_status IS sales.sale_status);
--   UPDATE imported_sale_stock_skip_0235 SET applied = 0, applied_at = NULL
--   WHERE sale_id IN (SELECT id FROM sales WHERE COALESCE(stock_skipped, 0) = 0);
-- Rows still applied = 1 after that are the ones that changed: list them with
--   SELECT w.sale_id, w.receipt_number FROM imported_sale_stock_skip_0235 w WHERE w.applied = 1;

CREATE TABLE IF NOT EXISTS imported_sale_stock_skip_0235 (
  sale_id INTEGER PRIMARY KEY,
  client_request_id TEXT NOT NULL,
  receipt_number TEXT,
  sale_status TEXT,
  updated_at_before TEXT,
  stock_skipped_before INTEGER NOT NULL,
  stock_skipped_at_before TEXT,
  stock_skipped_by_name_before TEXT,
  applied INTEGER NOT NULL DEFAULT 0,
  applied_at TEXT
);

-- The range bounds ('sales-import:' <= key < 'sales-import;', ';' being the
-- byte after ':') plus the two NOT NULL / <> '' terms let SQLite use the
-- partial unique index idx_sales_client_request_unique_pg.
INSERT OR IGNORE INTO imported_sale_stock_skip_0235 (
  sale_id, client_request_id, receipt_number, sale_status, updated_at_before,
  stock_skipped_before, stock_skipped_at_before, stock_skipped_by_name_before
)
SELECT s.id, s.client_request_id, s.receipt_number, s.sale_status, s.updated_at,
  COALESCE(s.stock_skipped, 0), s.stock_skipped_at, s.stock_skipped_by_name
FROM sales s
WHERE s.client_request_id IS NOT NULL AND s.client_request_id <> ''
  AND s.client_request_id >= 'sales-import:' AND s.client_request_id < 'sales-import;'
  AND COALESCE(s.stock_skipped, 0) = 0;

-- Guards: every check must be 1 or the CHECK constraint aborts the file
-- before any sale is marked.
CREATE TABLE IF NOT EXISTS imported_sale_stock_skip_guard_0235 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);
DELETE FROM imported_sale_stock_skip_guard_0235;
-- every pending key has the import's shape: sales-import:<job>:<row number>
INSERT INTO imported_sale_stock_skip_guard_0235 (check_name, ok)
SELECT 'pending_keys_have_import_shape', CASE WHEN NOT EXISTS (
  SELECT 1 FROM imported_sale_stock_skip_0235 w
  WHERE w.applied = 0
    AND NOT (rtrim(w.client_request_id, '0123456789') GLOB 'sales-import:?*:'
      AND length(rtrim(w.client_request_id, '0123456789')) < length(w.client_request_id))
) THEN 1 ELSE 0 END;
-- every pending row still points at the same unflagged sale
INSERT INTO imported_sale_stock_skip_guard_0235 (check_name, ok)
SELECT 'pending_rows_match_their_sale', CASE WHEN NOT EXISTS (
  SELECT 1 FROM imported_sale_stock_skip_0235 w
  LEFT JOIN sales s ON s.id = w.sale_id
  WHERE w.applied = 0
    AND (s.id IS NULL OR s.client_request_id IS NOT w.client_request_id OR COALESCE(s.stock_skipped, 0) <> 0)
) THEN 1 ELSE 0 END;
-- no pending sale carries evidence that the POS, not the import, made it
INSERT INTO imported_sale_stock_skip_guard_0235 (check_name, ok)
SELECT 'pending_sales_were_imported', CASE WHEN NOT EXISTS (
  SELECT 1 FROM imported_sale_stock_skip_0235 w JOIN sales s ON s.id = w.sale_id
  WHERE w.applied = 0
    AND (COALESCE(s.money_precision_version, 0) = 1
      OR (json_valid(s.creation_snapshot_json)
        AND json_extract(s.creation_snapshot_json, '$.origin') IS NOT NULL
        AND json_extract(s.creation_snapshot_json, '$.origin') <> 'sales_import'))
) THEN 1 ELSE 0 END;
-- the pending set is every unflagged prefix sale (the count this file marks)
INSERT INTO imported_sale_stock_skip_guard_0235 (check_name, ok)
SELECT 'pending_equals_unflagged_imports', CASE WHEN
  (SELECT COUNT(*) FROM imported_sale_stock_skip_0235 WHERE applied = 0)
  = (SELECT COUNT(*) FROM sales s
     WHERE s.client_request_id IS NOT NULL AND s.client_request_id <> ''
       AND s.client_request_id >= 'sales-import:' AND s.client_request_id < 'sales-import;'
       AND COALESCE(s.stock_skipped, 0) = 0)
THEN 1 ELSE 0 END;

UPDATE sales SET
  stock_skipped = 1,
  stock_skipped_at = CURRENT_TIMESTAMP,
  stock_skipped_by_name = 'migration:0235_imported_sales_stock_skipped'
WHERE id IN (SELECT sale_id FROM imported_sale_stock_skip_0235 WHERE applied = 0)
  AND COALESCE(stock_skipped, 0) = 0;

-- Post-guards: every pending row's sale is now marked, and no unflagged
-- import is left, so the marked count equals the unflagged count above.
DELETE FROM imported_sale_stock_skip_guard_0235;
INSERT INTO imported_sale_stock_skip_guard_0235 (check_name, ok)
SELECT 'every_pending_sale_marked', CASE WHEN NOT EXISTS (
  SELECT 1 FROM imported_sale_stock_skip_0235 w JOIN sales s ON s.id = w.sale_id
  WHERE w.applied = 0 AND COALESCE(s.stock_skipped, 0) <> 1
) THEN 1 ELSE 0 END;
INSERT INTO imported_sale_stock_skip_guard_0235 (check_name, ok)
SELECT 'no_unflagged_import_left', CASE WHEN NOT EXISTS (
  SELECT 1 FROM sales s
  WHERE s.client_request_id IS NOT NULL AND s.client_request_id <> ''
    AND s.client_request_id >= 'sales-import:' AND s.client_request_id < 'sales-import;'
    AND COALESCE(s.stock_skipped, 0) = 0
) THEN 1 ELSE 0 END;

UPDATE imported_sale_stock_skip_0235 SET applied = 1, applied_at = CURRENT_TIMESTAMP WHERE applied = 0;
