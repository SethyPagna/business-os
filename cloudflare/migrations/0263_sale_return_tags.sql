-- 0263 sale return and delivery tags (lane 6.0.890, plan PLAN-SALE-STATUS-TAGS S1, expand step).
-- Owner, 20 Oct 2026: a sale has two statuses, Not Paid (awaiting_payment) and Completed; Cancelled
-- stays. Returns and delivery are tags beside the status and never change it.
--   return_state             NULL | 'partial' | 'full'
--   return_review_state      NULL | 'pending' | 'confirmed'   a NEW full return raises 'pending'
--   return_reviewed_at / return_reviewed_by_id / return_reviewed_by_name
--   delivery_pending         0 | 1   replaces the awaiting_delivery status; the delivery queue reads
--                                     delivery_pending = 1 AND sale_status <> 'cancelled'
-- sale_status_normalization_ledger holds one row per sale the HELD normalization (0264) rewrites,
-- so that rewrite can be reversed row by row. This file creates it empty.
-- Schema only: no row is inserted, updated or deleted. The return columns start NULL and
-- delivery_pending 0, so a Worker that predates this file reads and writes exactly as before.
--
-- PRE: sales has status_before_return (0125) and none of the new columns (ADD COLUMN would fail).
-- POST: every return column is NULL and delivery_pending is 0 on every row; both partial indexes
-- and the empty ledger exist. A failed check reads a malformed JSON path and aborts the file.
-- Pinned by scripts/test-migration-0263-sale-return-tags-native.cjs.
--
-- RECOVERY: schema only, nothing to restore; roll the Worker back first (it reads these columns), then
--   DROP INDEX IF EXISTS idx_sales_return_state_created;
--   DROP INDEX IF EXISTS idx_sales_delivery_pending_created;
--   DROP TABLE IF EXISTS sale_status_normalization_ledger;  -- only while it is empty (0264 not applied)
--   ALTER TABLE sales DROP COLUMN delivery_pending;  and the same for return_reviewed_by_name,
--   return_reviewed_by_id, return_reviewed_at, return_review_state, return_state.

SELECT CASE WHEN (SELECT COUNT(*) FROM pragma_table_info('sales') WHERE name = 'status_before_return') = 1
THEN 1 ELSE json_extract('[]','$[sale_return_tags_0263_pre_status_before_return]') END;

ALTER TABLE sales ADD COLUMN return_state TEXT CHECK (return_state IS NULL OR return_state IN ('partial','full'));
ALTER TABLE sales ADD COLUMN return_review_state TEXT CHECK (return_review_state IS NULL OR return_review_state IN ('pending','confirmed'));
ALTER TABLE sales ADD COLUMN return_reviewed_at TEXT;
ALTER TABLE sales ADD COLUMN return_reviewed_by_id INTEGER;
ALTER TABLE sales ADD COLUMN return_reviewed_by_name TEXT;
ALTER TABLE sales ADD COLUMN delivery_pending INTEGER NOT NULL DEFAULT 0 CHECK (delivery_pending IN (0,1));

CREATE INDEX IF NOT EXISTS idx_sales_return_state_created ON sales (return_state, created_at DESC, id DESC) WHERE return_state IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_delivery_pending_created ON sales (delivery_pending, created_at DESC, id DESC) WHERE delivery_pending = 1;

CREATE TABLE IF NOT EXISTS sale_status_normalization_ledger (
  sale_id INTEGER PRIMARY KEY,
  sale_status_before TEXT,
  status_before_return_before TEXT,
  status_before_cancel_before TEXT,
  sale_status_after TEXT NOT NULL,
  status_before_cancel_after TEXT,
  return_state_after TEXT,
  loyalty_accrual_before INTEGER,
  migrated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

SELECT CASE WHEN (SELECT COUNT(*) FROM sales WHERE return_state IS NOT NULL OR return_review_state IS NOT NULL
    OR return_reviewed_at IS NOT NULL OR return_reviewed_by_id IS NOT NULL OR return_reviewed_by_name IS NOT NULL
    OR delivery_pending <> 0) = 0
  AND (SELECT COUNT(*) FROM sale_status_normalization_ledger) = 0
  AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'index'
    AND name IN ('idx_sales_return_state_created','idx_sales_delivery_pending_created')) = 2
THEN 1 ELSE json_extract('[]','$[sale_return_tags_0263_post]') END;
