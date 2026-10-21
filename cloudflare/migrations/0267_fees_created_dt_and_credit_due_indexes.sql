-- 0267: three read indexes the performance audit (21 Oct 2026, AUDIT-PERFORMANCE items 1 and 2) proved with EXPLAIN.
--
-- Schema only: no table row is inserted, updated or deleted, and no query text changes, so no result can change.
--
-- 1. idx_fees_created_dt ON fees(datetime(created_at)) and idx_fees_branch_created_dt ON fees(branch_id, datetime(created_at)): every expense window on created_at filters
--    `datetime(<alias>.created_at) >= @from AND datetime(<alias>.created_at) < @to` (shift reconciliation
--    shiftFeeWhere, report delivery fees and courier totals in salesAnalytics, fees.ts createdFrom/createdTo).
--    No index covered the expression, so each call walked the whole fees table (4,243 rows read per
--    /api/shifts/current at 4,240 fees). The expression is stored by the index, so the predicate text matches as is.
--    A branch drawer adds `(fees.branch_id = @branchId OR fees.branch_id IS NULL)`; the planner then answers each OR term
--    from idx_fees_branch_id alone and reads every fee of the branch (EXPLAIN-proved), so the second index leads with
--    branch_id and lets both OR terms use the date range.
-- 2. idx_product_batches_credit_due: the supplier-credit reminder of the notification bell
--    (routes/notifications.ts buildSupplierCreditSection) read and sorted every lot. The partial index holds only
--    active lots on credit, ordered by due date, so the ORDER BY credit_due_date LIMIT 50 stops early.
--
-- PRE: fees, product_batches and the columns the indexes name exist; none of the three indexes exists yet.
-- POST: all three indexes exist with the agreed names and no row count of fees or product_batches changed.
-- A failed check reads a malformed JSON path and aborts the file.
-- Idempotent: CREATE INDEX IF NOT EXISTS.
-- Pinned by scripts/test-migration-0267-fees-credit-indexes-native.cjs.
--
-- RECOVERY: schema only, nothing to restore; the Worker works with or without the indexes (they only change plans).
--   DROP INDEX IF EXISTS idx_fees_created_dt;
--   DROP INDEX IF EXISTS idx_fees_branch_created_dt;
--   DROP INDEX IF EXISTS idx_product_batches_credit_due;

SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('fees') WHERE name = 'created_at') = 1
  AND (SELECT COUNT(*) FROM pragma_table_info('product_batches') WHERE name IN ('credit_due_date','payment_status','is_active')) = 3
THEN 1 ELSE json_extract('[]','$[fees_credit_indexes_0267_pre_columns]') END;

CREATE INDEX IF NOT EXISTS idx_fees_created_dt ON fees (datetime(created_at));
CREATE INDEX IF NOT EXISTS idx_fees_branch_created_dt ON fees (branch_id, datetime(created_at));
CREATE INDEX IF NOT EXISTS idx_product_batches_credit_due ON product_batches (credit_due_date)
  WHERE payment_status = 'credit' AND is_active = 1;

SELECT CASE WHEN (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index'
    AND name IN ('idx_fees_created_dt','idx_fees_branch_created_dt','idx_product_batches_credit_due')) = 3
THEN 1 ELSE json_extract('[]','$[fees_credit_indexes_0267_post_indexes]') END;
