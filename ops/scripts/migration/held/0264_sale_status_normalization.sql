-- 0264 SALE-STATUS-NORMALIZATION (lane 6.0.891, plan slice S6; owner ruling 20 Oct 2026):
-- every past sale ends with status Not Paid (awaiting_payment) or Completed only;
-- Cancelled is unchanged. partial_return, returned and awaiting_delivery become
-- TAGS (sales.return_state, sales.delivery_pending). Past fully returned sales
-- stay unflagged (return_review_state is not written). A sale that read Not Paid
-- stays Not Paid; nothing here turns Not Paid into paid.
--
-- ============================== HELD =====================================
-- Parked in ops/scripts/migration/held/, deliberately OUTSIDE cloudflare/migrations,
-- so no deploy applies it. Moving it into cloudflare/migrations (keeping the name
-- 0264) is the "apply" decision and needs, first, ALL of:
--   1. 0263 (lane 6.0.890) applied: sales.return_state, return_review_state,
--      return_reviewed_at/_by_id/_by_name, sales.delivery_pending, and table
--      sale_status_normalization_ledger. A missing column or table aborts this
--      file at its first statement that names it (nothing is written).
--   2. Worker release A live (writes return_state / delivery_pending, no longer
--      writes the retired statuses, imports and undo replay translate them).
--      Applied under the OLD Worker, the guard triggers below reject its next
--      return, and returns stop working.
--   3. The census (ops/scripts/census/not-paid-conversion-census.mjs) run on a
--      local restore and reviewed by the owner: this file maps every sale EXACTLY
--      as reporting reads it today, so a sale that was wrongly converted to paid
--      BEFORE this file stays paid here. Fixing those is the separate, owner-gated
--      correction (held 0266); this file only guarantees it makes nothing worse.
--   4. The owner's go, in the post-20:00 window with open_today = 0: every
--      changed sale gets a sale_write_revisions bump, so open editors get 409.
--   5. lib/backup.ts restore normalization (S6) in the same release, or a backup
--      older than this file brings the retired statuses back (the guard triggers
--      are fenced off in restore mode on purpose).
--
-- ============================== WHAT IT DOES =============================
-- Reporting reads a sale's payment state today as (lib/salesStatus.ts
-- notPaidSaleSql, lib/salesAnalytics.ts reportingSaleStatusExpr):
--   Not Paid  = sale_status = 'awaiting_payment'
--            OR (sale_status IN ('partial_return','returned')
--                AND status_before_return = 'awaiting_payment')
--   Cancelled = sale_status = 'cancelled'
--   otherwise paid (a NULL status_before_return reads paid)
-- The mapping below is that reading, written down as the new sale_status, so
-- revenue, pending (Not Paid) and collected figures are identical before and
-- after BY CONSTRUCTION; the POST assertions prove it on the real rows.
--   sale_status:        Not Paid -> 'awaiting_payment'; cancelled stays; blank and
--                       every other retired status -> 'completed'
--   status_before_cancel: 'partial_return'/'returned' -> the payment state from
--                       status_before_return; 'awaiting_delivery' -> 'completed'
--   return_state:       'returned' -> 'full', 'partial_return' -> 'partial' (the label
--                       the till shows today wins); a sale with no return label but
--                       return evidence takes the evidence (lib/returnBulkAction.ts
--                       saleStatusStatement: every line covered -> full, else partial);
--                       a cancelled sale takes status_before_cancel's label. Values
--                       the new Worker already wrote are kept.
--   delivery_pending:   1 where sale_status (or, when cancelled, status_before_cancel)
--                       was 'awaiting_delivery', i.e. exactly the delivery queue of
--                       routes/notifications.ts today. Existing 1s are kept.
--   status_before_return is frozen: not read after this, not written.
-- Written once per sale in ONE UPDATE (one revision bump). updated_at is not
-- touched: a normalization is not a user edit.
--
-- Loyalty (migration 0251): its AFTER UPDATE OF sale_status trigger fires on the
-- change below. Loyalty is OFF in production, so for every changed sale with
-- loyalty_accrual = 1 it writes a 'skipped' loyalty_sale_earning flag and zeroes the
-- accrual. That is allowed only for sales at or below the loyalty_points_reset
-- watermark (they never count toward balances); PRE refuses the file when loyalty is
-- on or when a changed sale above the watermark would be touched, POST proves it.
--
-- ============================== PRE (abort, nothing written) =============
-- Recorded in sale_status_norm_guard_0264 (a failing row is a CHECK abort and rolls
-- the whole file back; D1 applies a migration file atomically):
--   pre_vocab_known        no sale_status outside the six known values (or blank)
--   pre_loyalty_off        loyalty_points_enabled is not on
--   pre_not_restore_mode   no maintenance restore flag
--   pre_ledger_empty       sale_status_normalization_ledger has no rows
--   pre_no_post_reset_accrual  no changed sale above the watermark would lose accrual
--   pre_money_updatable    every sale this file updates passes the 0161 money-precision
--                          trigger (an UPDATE of a sale it rejects would abort mid-file)
-- Numbers worth writing down before applying (read-only, --command, never --file):
--   SELECT sale_status, COUNT(*) FROM sales GROUP BY sale_status;
--   SELECT COUNT(*) FROM sales WHERE status_before_cancel IN ('partial_return','returned','awaiting_delivery');
--   SELECT metric, value FROM sale_status_norm_pre_0264;   -- after a LOCAL dry run
--
-- ============================== POST (abort when violated) ===============
--   post_no_retired_status      no retired status in sale_status or status_before_cancel
--   post_ledger_complete        ledger rows = the PRE candidate count, each joins a sale
--   post_ledger_matches_sales   every ledger sale reads its sale_status_after / status_before_cancel_after
--   post_expected_class         sale_status_after is 'awaiting_payment' iff the sale read Not Paid before
--   post_recognized_unchanged   recognized (not cancelled) count and total_usd identical
--   post_pending_unchanged      Not Paid count and total_usd identical (the pending/revenue split)
--   post_cancelled_unchanged    cancelled count identical
--   post_untouched_sales        sales outside the ledger keep completed/awaiting_payment/cancelled counts
--   post_review_untouched       return_review_state: no sale newly flagged (past full returns unflagged)
--   post_return_state_labels    every ledger sale that carried a return label has a return_state
--   post_delivery_tag           every ledger sale that was awaiting_delivery has delivery_pending = 1
--   post_loyalty_pre_reset_only accrual changed only at or below the watermark, and only to 0
--   post_loyalty_other_unchanged  accrual of sales outside the ledger unchanged
--
-- ============================== RECOVERY (append-only) ===================
-- No data is destroyed: sale_status_normalization_ledger keeps every changed sale's
-- before-image (sale_status, status_before_return, status_before_cancel), and
-- status_before_return was never written. To undo, in a LATER numbered migration or
-- an owner-approved ops run, only for sales untouched since (sale_status still
-- equals the ledger's after-value):
--   DROP TRIGGER IF EXISTS sales_status_vocab_ins;
--   DROP TRIGGER IF EXISTS sales_status_vocab_upd;
--   UPDATE sales SET
--     sale_status = (SELECT l.sale_status_before FROM sale_status_normalization_ledger l WHERE l.sale_id = sales.id),
--     status_before_cancel = (SELECT l.status_before_cancel_before FROM sale_status_normalization_ledger l WHERE l.sale_id = sales.id),
--     delivery_pending = CASE WHEN EXISTS (SELECT 1 FROM sale_status_normalization_ledger l WHERE l.sale_id = sales.id
--       AND 'awaiting_delivery' IN (l.sale_status_before, l.status_before_cancel_before)) THEN 0 ELSE delivery_pending END
--   WHERE id IN (SELECT l.sale_id FROM sale_status_normalization_ledger l WHERE l.sale_status_after IS sales.sale_status);
--   (return_state stays: it is a tag, new Worker code ignores it when the statuses are back.)
-- Not recoverable by SQL, and not needed: loyalty_accrual zeroed on sales at or below
-- the watermark (trigger loyalty_sale_birth_immutable forbids raising it; the value
-- is in the ledger as loyalty_accrual_before), and the 'skipped' flag rows the 0251
-- trigger inserted into system_flags (harmless; loyalty is off).
-- A sale last touched by this file shows a sale_write_revisions bump and nothing else.
--
-- Proof: cloudflare/scripts/test-held-0264-normalization-native.cjs (every shape,
-- kernel revenue / pending identical before and after, guard trigger, loyalty
-- watermark, mutants that the POST guard catches).

CREATE TABLE sale_status_norm_guard_0264 (
  check_name TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

CREATE TABLE sale_status_norm_pre_0264 (
  metric TEXT PRIMARY KEY,
  value REAL NOT NULL
);

CREATE TABLE sale_return_state_backfill_0264 (
  sale_id INTEGER PRIMARY KEY,
  return_state TEXT NOT NULL CHECK (return_state IN ('partial', 'full')),
  basis TEXT NOT NULL CHECK (basis IN ('label', 'cancel_label', 'evidence'))
);

-- ---- PRE ----
INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'pre_vocab_known',
  CASE WHEN NOT EXISTS (SELECT 1 FROM sales WHERE sale_status IS NOT NULL
    AND sale_status NOT IN ('', 'completed', 'awaiting_payment', 'awaiting_delivery', 'cancelled', 'partial_return', 'returned'))
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'pre_loyalty_off',
  CASE WHEN NOT (lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'loyalty_points_enabled'), ''))) IN ('1', 'true', 'yes', 'on'))
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'pre_not_restore_mode',
  CASE WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'pre_ledger_empty',
  CASE WHEN NOT EXISTS (SELECT 1 FROM sale_status_normalization_ledger) THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'pre_no_post_reset_accrual',
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM sales s
    WHERE (s.sale_status IS NULL OR s.sale_status IN ('', 'partial_return', 'returned', 'awaiting_delivery')
        OR s.status_before_cancel IN ('partial_return', 'returned', 'awaiting_delivery'))
      AND s.id > COALESCE((SELECT json_extract(value, '$.sales') FROM system_flags WHERE key = 'loyalty_points_reset'), 0)
      AND COALESCE(s.loyalty_accrual, 0) = 1
      AND s.sale_status IS NOT 'awaiting_payment' AND s.sale_status IS NOT 'cancelled'
      AND NOT (COALESCE(s.sale_status, '') IN ('partial_return', 'returned') AND COALESCE(s.status_before_return, '') = 'awaiting_payment')
  ) THEN 1 ELSE 0 END;

-- ---- PRE-image aggregates ----
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'sales_n', COUNT(*) FROM sales;
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'recognized_n', COUNT(*) FROM sales WHERE COALESCE(NULLIF(sale_status, ''), 'completed') <> 'cancelled';
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'recognized_total', ROUND(COALESCE(SUM(total_usd), 0), 4) FROM sales WHERE COALESCE(NULLIF(sale_status, ''), 'completed') <> 'cancelled';
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'pending_n', COUNT(*) FROM sales
WHERE sale_status = 'awaiting_payment' OR (sale_status IN ('partial_return', 'returned') AND status_before_return = 'awaiting_payment');
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'pending_total', ROUND(COALESCE(SUM(total_usd), 0), 4) FROM sales
WHERE sale_status = 'awaiting_payment' OR (sale_status IN ('partial_return', 'returned') AND status_before_return = 'awaiting_payment');
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'cancelled_n', COUNT(*) FROM sales WHERE sale_status = 'cancelled';
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'ledger_n', COUNT(*) FROM sales
WHERE sale_status IS NULL OR sale_status IN ('', 'partial_return', 'returned', 'awaiting_delivery')
  OR status_before_cancel IN ('partial_return', 'returned', 'awaiting_delivery');
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'unchanged_completed', COUNT(*) FROM sales WHERE sale_status = 'completed'
  AND COALESCE(status_before_cancel, '') NOT IN ('partial_return', 'returned', 'awaiting_delivery');
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'unchanged_awaiting_payment', COUNT(*) FROM sales WHERE sale_status = 'awaiting_payment'
  AND COALESCE(status_before_cancel, '') NOT IN ('partial_return', 'returned', 'awaiting_delivery');
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'unchanged_cancelled', COUNT(*) FROM sales WHERE sale_status = 'cancelled'
  AND COALESCE(status_before_cancel, '') NOT IN ('partial_return', 'returned', 'awaiting_delivery');
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'loyalty_other_sum', COALESCE(SUM(COALESCE(loyalty_accrual, 0)), 0) FROM sales
WHERE COALESCE(sale_status, '') NOT IN ('', 'partial_return', 'returned', 'awaiting_delivery')
  AND COALESCE(status_before_cancel, '') NOT IN ('partial_return', 'returned', 'awaiting_delivery');
INSERT INTO sale_status_norm_pre_0264 (metric, value)
SELECT 'review_flagged_n', COUNT(*) FROM sales WHERE return_review_state IS NOT NULL;

-- ---- return_state backfill (lib/returnBulkAction.ts saleStatusStatement, as a table) ----
INSERT INTO sale_return_state_backfill_0264 (sale_id, return_state, basis)
SELECT x.id, x.return_state, x.basis FROM (
  SELECT s.id,
    CASE
      WHEN s.sale_status = 'returned' THEN 'full'
      WHEN s.sale_status = 'partial_return' THEN 'partial'
      WHEN s.sale_status = 'cancelled' AND s.status_before_cancel = 'returned' THEN 'full'
      WHEN s.sale_status = 'cancelled' AND s.status_before_cancel = 'partial_return' THEN 'partial'
      WHEN NOT EXISTS (
        SELECT 1 FROM sale_items si
        WHERE si.sale_id = s.id AND COALESCE((
          SELECT SUM(ri.quantity) FROM return_items ri JOIN returns r ON r.id = ri.return_id
          WHERE r.sale_id = s.id AND COALESCE(r.status, 'completed') != 'cancelled' AND COALESCE(r.return_scope, 'customer') = 'customer'
            AND (ri.sale_item_id = si.id OR (ri.sale_item_id IS NULL AND ri.product_id = si.product_id))
        ), 0) + MAX(COALESCE(si.returned_quantity, 0), 0) < si.quantity
      ) THEN 'full'
      ELSE 'partial' END AS return_state,
    CASE
      WHEN s.sale_status IN ('returned', 'partial_return') THEN 'label'
      WHEN s.sale_status = 'cancelled' AND s.status_before_cancel IN ('returned', 'partial_return') THEN 'cancel_label'
      ELSE 'evidence' END AS basis
  FROM sales s
  WHERE s.sale_status IN ('returned', 'partial_return')
    OR (s.sale_status = 'cancelled' AND s.status_before_cancel IN ('returned', 'partial_return'))
    OR EXISTS (SELECT 1 FROM returns r WHERE r.sale_id = s.id AND COALESCE(r.status, 'completed') != 'cancelled' AND COALESCE(r.return_scope, 'customer') = 'customer')
    OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND MAX(COALESCE(si.returned_quantity, 0), 0) > 0)
) x;

-- ---- ledger: the before-image of every sale this file changes ----
INSERT INTO sale_status_normalization_ledger
  (sale_id, sale_status_before, status_before_return_before, status_before_cancel_before,
   sale_status_after, status_before_cancel_after, return_state_after, loyalty_accrual_before, migrated_at)
SELECT s.id, s.sale_status, s.status_before_return, s.status_before_cancel,
  CASE
    WHEN s.sale_status = 'awaiting_payment' OR (s.sale_status IN ('partial_return', 'returned') AND s.status_before_return = 'awaiting_payment')
      THEN 'awaiting_payment'
    WHEN s.sale_status = 'cancelled' THEN 'cancelled'
    ELSE 'completed' END,
  CASE
    WHEN s.status_before_cancel IN ('partial_return', 'returned')
      THEN CASE WHEN s.status_before_return = 'awaiting_payment' THEN 'awaiting_payment' ELSE 'completed' END
    WHEN s.status_before_cancel = 'awaiting_delivery' THEN 'completed'
    ELSE s.status_before_cancel END,
  (SELECT w.return_state FROM sale_return_state_backfill_0264 w WHERE w.sale_id = s.id),
  s.loyalty_accrual,
  CURRENT_TIMESTAMP
FROM sales s
WHERE s.sale_status IS NULL OR s.sale_status IN ('', 'partial_return', 'returned', 'awaiting_delivery')
  OR s.status_before_cancel IN ('partial_return', 'returned', 'awaiting_delivery');

-- Every row this file updates must pass the money-precision trigger of migration 0161.
INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'pre_money_updatable',
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM sales s
    WHERE (s.id IN (SELECT sale_id FROM sale_status_normalization_ledger) OR s.id IN (SELECT sale_id FROM sale_return_state_backfill_0264))
      AND NOT COALESCE((typeof(s.money_precision_version) = 'integer' AND (
        (s.money_precision_version = 0 AND s.calculated_total_usd IS NULL AND s.rounding_adjustment_usd = 0)
        OR (s.money_precision_version IN (0, 1)
          AND typeof(s.calculated_total_usd) IN ('integer', 'real') AND s.calculated_total_usd BETWEEN 0 AND 100000000000 AND s.calculated_total_usd = CAST(ROUND(s.calculated_total_usd * 10000) AS INTEGER) / 10000.0
          AND typeof(s.total_usd) IN ('integer', 'real') AND s.total_usd BETWEEN 0 AND 100000000000 AND s.total_usd = CAST(ROUND(s.total_usd * 10000) AS INTEGER) / 10000.0
          AND typeof(s.rounding_adjustment_usd) IN ('integer', 'real') AND s.rounding_adjustment_usd BETWEEN -0.005 AND 0.005 AND s.rounding_adjustment_usd = CAST(ROUND(s.rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
          AND CAST(ROUND(s.total_usd * 10000) AS INTEGER) % 100 = 0
          AND CAST(ROUND(s.calculated_total_usd * 10000) AS INTEGER) + CAST(ROUND(s.rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(s.total_usd * 10000) AS INTEGER)
          AND ((CAST(ROUND(s.calculated_total_usd * 10000) AS INTEGER) + 50) / 100) * 100 = CAST(ROUND(s.total_usd * 10000) AS INTEGER)
        )
      )), 0)
  ) THEN 1 ELSE 0 END;

-- ---- the change: one UPDATE per sale ----
UPDATE sales SET
  sale_status = (SELECT l.sale_status_after FROM sale_status_normalization_ledger l WHERE l.sale_id = sales.id),
  status_before_cancel = (SELECT l.status_before_cancel_after FROM sale_status_normalization_ledger l WHERE l.sale_id = sales.id),
  return_state = COALESCE(return_state, (SELECT w.return_state FROM sale_return_state_backfill_0264 w WHERE w.sale_id = sales.id)),
  delivery_pending = CASE WHEN EXISTS (SELECT 1 FROM sale_status_normalization_ledger l WHERE l.sale_id = sales.id
    AND 'awaiting_delivery' IN (l.sale_status_before, l.status_before_cancel_before)) THEN 1 ELSE delivery_pending END
WHERE id IN (SELECT sale_id FROM sale_status_normalization_ledger);

-- Sales with return evidence whose status was already a payment state: the tag only.
UPDATE sales SET return_state = (SELECT w.return_state FROM sale_return_state_backfill_0264 w WHERE w.sale_id = sales.id)
WHERE return_state IS NULL
  AND id IN (SELECT sale_id FROM sale_return_state_backfill_0264)
  AND id NOT IN (SELECT sale_id FROM sale_status_normalization_ledger);

-- ---- guard triggers: the retired statuses can no longer be written (restore mode is fenced off) ----
CREATE TRIGGER sales_status_vocab_ins BEFORE INSERT ON sales
WHEN (NEW.sale_status IN ('partial_return', 'returned', 'awaiting_delivery') OR NEW.status_before_cancel IN ('partial_return', 'returned', 'awaiting_delivery'))
  AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  SELECT RAISE(ABORT, 'sale_status_return_retired');
END;

CREATE TRIGGER sales_status_vocab_upd BEFORE UPDATE OF sale_status, status_before_cancel ON sales
WHEN (NEW.sale_status IN ('partial_return', 'returned', 'awaiting_delivery') OR NEW.status_before_cancel IN ('partial_return', 'returned', 'awaiting_delivery'))
  AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  SELECT RAISE(ABORT, 'sale_status_return_retired');
END;

-- ---- POST ----
INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_no_retired_status',
  CASE WHEN NOT EXISTS (SELECT 1 FROM sales WHERE sale_status IS NULL OR sale_status IN ('', 'partial_return', 'returned', 'awaiting_delivery')
    OR status_before_cancel IN ('partial_return', 'returned', 'awaiting_delivery'))
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_ledger_complete',
  CASE WHEN (SELECT COUNT(*) FROM sale_status_normalization_ledger) = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'ledger_n')
    AND (SELECT COUNT(*) FROM sale_status_normalization_ledger l JOIN sales s ON s.id = l.sale_id) = (SELECT COUNT(*) FROM sale_status_normalization_ledger)
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_ledger_matches_sales',
  CASE WHEN NOT EXISTS (SELECT 1 FROM sale_status_normalization_ledger l JOIN sales s ON s.id = l.sale_id
    WHERE s.sale_status IS NOT l.sale_status_after OR s.status_before_cancel IS NOT l.status_before_cancel_after)
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_expected_class',
  CASE WHEN NOT EXISTS (SELECT 1 FROM sale_status_normalization_ledger l
    WHERE l.sale_status_after IS NOT CASE
      WHEN l.sale_status_before = 'awaiting_payment' OR (l.sale_status_before IN ('partial_return', 'returned') AND l.status_before_return_before = 'awaiting_payment')
        THEN 'awaiting_payment'
      WHEN l.sale_status_before = 'cancelled' THEN 'cancelled'
      ELSE 'completed' END)
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_recognized_unchanged',
  CASE WHEN (SELECT COUNT(*) FROM sales WHERE COALESCE(NULLIF(sale_status, ''), 'completed') <> 'cancelled') = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'recognized_n')
    AND (SELECT ROUND(COALESCE(SUM(total_usd), 0), 4) FROM sales WHERE COALESCE(NULLIF(sale_status, ''), 'completed') <> 'cancelled') = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'recognized_total')
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_pending_unchanged',
  CASE WHEN (SELECT COUNT(*) FROM sales WHERE sale_status = 'awaiting_payment') = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'pending_n')
    AND (SELECT ROUND(COALESCE(SUM(total_usd), 0), 4) FROM sales WHERE sale_status = 'awaiting_payment') = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'pending_total')
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_cancelled_unchanged',
  CASE WHEN (SELECT COUNT(*) FROM sales WHERE sale_status = 'cancelled') = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'cancelled_n')
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_untouched_sales',
  CASE WHEN (SELECT COUNT(*) FROM sales WHERE sale_status = 'completed' AND id NOT IN (SELECT sale_id FROM sale_status_normalization_ledger)) = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'unchanged_completed')
    AND (SELECT COUNT(*) FROM sales WHERE sale_status = 'awaiting_payment' AND id NOT IN (SELECT sale_id FROM sale_status_normalization_ledger)) = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'unchanged_awaiting_payment')
    AND (SELECT COUNT(*) FROM sales WHERE sale_status = 'cancelled' AND id NOT IN (SELECT sale_id FROM sale_status_normalization_ledger)) = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'unchanged_cancelled')
    AND (SELECT COUNT(*) FROM sales) = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'sales_n')
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_review_untouched',
  CASE WHEN (SELECT COUNT(*) FROM sales WHERE return_review_state IS NOT NULL) = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'review_flagged_n')
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_return_state_labels',
  CASE WHEN NOT EXISTS (SELECT 1 FROM sale_status_normalization_ledger l JOIN sales s ON s.id = l.sale_id
    WHERE (l.sale_status_before IN ('partial_return', 'returned') OR l.status_before_cancel_before IN ('partial_return', 'returned'))
      AND s.return_state IS NULL)
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_delivery_tag',
  CASE WHEN NOT EXISTS (SELECT 1 FROM sale_status_normalization_ledger l JOIN sales s ON s.id = l.sale_id
    WHERE 'awaiting_delivery' IN (l.sale_status_before, l.status_before_cancel_before) AND s.delivery_pending IS NOT 1)
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_loyalty_pre_reset_only',
  CASE WHEN NOT EXISTS (SELECT 1 FROM sale_status_normalization_ledger l JOIN sales s ON s.id = l.sale_id
    WHERE s.loyalty_accrual IS NOT l.loyalty_accrual_before
      AND NOT (s.id <= COALESCE((SELECT json_extract(value, '$.sales') FROM system_flags WHERE key = 'loyalty_points_reset'), 0) AND s.loyalty_accrual = 0))
  THEN 1 ELSE 0 END;

INSERT INTO sale_status_norm_guard_0264 (check_name, ok) SELECT 'post_loyalty_other_unchanged',
  CASE WHEN (SELECT COALESCE(SUM(COALESCE(loyalty_accrual, 0)), 0) FROM sales WHERE id NOT IN (SELECT sale_id FROM sale_status_normalization_ledger))
    = (SELECT value FROM sale_status_norm_pre_0264 WHERE metric = 'loyalty_other_sum')
  THEN 1 ELSE 0 END;
