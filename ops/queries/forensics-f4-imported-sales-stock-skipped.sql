-- RET-B F4 / LH-2 sizing, read-only, for an Ops run BEFORE migration 0235
-- (cloudflare/migrations/0235_imported_sales_stock_skipped.sql) ships.
-- One row. Counts only: no names, phones or money.
--
-- The 0235 target set is every sale whose client_request_id carries the sales
-- import's own key, 'sales-import:<job>:<row>' (only applyHistoricalSaleImport
-- writes it, since a6c4cf093). The import ledger is not used: retention
-- deletes it 7 days after a job ends.
--   imported_sales          sales with the prefix
--   to_mark                 ... with stock_skipped = 0 (0235 marks exactly these)
--   to_mark_cancelled       ... currently cancelled (cancel already handed units back)
--   to_mark_return_status   ... in partial_return / returned
--   already_marked          prefix sales already stock_skipped
--   bad_shape               to_mark keys not 'sales-import:<job>:<digits>'     (must be 0; 0235 aborts)
--   pos_evidence            to_mark sales with money_precision_version 1 or a
--                           creation snapshot whose origin is not sales_import (must be 0; 0235 aborts)
--   would_trip_0161         to_mark sales the 0161 sales money trigger would reject
--                           on any UPDATE (must be 0; 0235 aborts atomically)
--   with_lot_allocations    to_mark sales whose lines hold lot allocations (info: the
--                           import writes none; amendments or un-cancels can)
--   moved_sales / moved_net_units
--                           to_mark sales whose own stock movements (cancel,
--                           un-cancel, status change, amendment; customer-return
--                           rows excluded) are non-empty, and the net units those
--                           movements put BACK (+) or took (-). Positive net units
--                           are phantom stock 0235 does not repair (owner-gated, D2).
--   legacy_sale_unmarked / legacy_sale_unmarked_cancelled
--                           'legacy-sale:%' rows (ops migration scripts), a separate
--                           source 0235 does NOT mark (D3)
--   sep23_targets_to_mark   to_mark sales among the Sep 23 subtotal-repair cohort
--                           (16842-16863); if > 0 and sep23_repair_applied = 0, that
--                           repair (lib/legacySubtotalRepair.ts, which requires
--                           stock_skipped = 0) must run before 0235 or it will refuse
--   sep23_repair_applied    action_history rows of that repair
-- ops:min-rows 1
-- ops:max-rows 1
WITH imported AS MATERIALIZED (
  SELECT s.id, s.sale_status, COALESCE(s.stock_skipped, 0) AS stock_skipped, s.client_request_id AS k,
    COALESCE(s.money_precision_version, 0) AS mpv, s.creation_snapshot_json AS snap,
    s.calculated_total_usd, s.total_usd, s.rounding_adjustment_usd
  FROM sales s
  WHERE s.client_request_id IS NOT NULL AND s.client_request_id <> ''
    AND s.client_request_id >= 'sales-import:' AND s.client_request_id < 'sales-import;'
),
target AS MATERIALIZED (
  SELECT * FROM imported WHERE stock_skipped = 0
),
moved AS MATERIALIZED (
  SELECT t.id,
    SUM(CASE WHEN m.movement_type IN ('return', 'damage_in') THEN ABS(COALESCE(m.quantity, 0))
             WHEN m.movement_type IN ('sale', 'damage_out') THEN -ABS(COALESCE(m.quantity, 0)) ELSE 0 END) AS net_units
  FROM target t
  JOIN inventory_movements m ON m.reference_id = t.id
    AND m.movement_type IN ('sale', 'return', 'damage_in', 'damage_out')
    AND m.product_id IN (SELECT si.product_id FROM sale_items si WHERE si.sale_id = t.id)
    AND NOT (COALESCE(m.reason, '') LIKE 'Return: %' OR COALESCE(m.reason, '') LIKE 'Return #%'
      OR COALESCE(m.reason, '') IN ('Apply grouped return status', 'Undo grouped return status'))
  GROUP BY t.id
)
SELECT
  (SELECT COUNT(*) FROM imported) AS imported_sales,
  (SELECT COUNT(*) FROM target) AS to_mark,
  (SELECT COUNT(*) FROM target WHERE sale_status = 'cancelled') AS to_mark_cancelled,
  (SELECT COUNT(*) FROM target WHERE sale_status IN ('partial_return', 'returned')) AS to_mark_return_status,
  (SELECT COUNT(*) FROM imported WHERE stock_skipped <> 0) AS already_marked,
  (SELECT COUNT(*) FROM target WHERE NOT (rtrim(k, '0123456789') GLOB 'sales-import:?*:'
     AND length(rtrim(k, '0123456789')) < length(k))) AS bad_shape,
  (SELECT COUNT(*) FROM target WHERE mpv = 1
     OR (json_valid(snap) AND json_extract(snap, '$.origin') IS NOT NULL AND json_extract(snap, '$.origin') <> 'sales_import')) AS pos_evidence,
  (SELECT COUNT(*) FROM target WHERE NOT COALESCE((typeof(mpv) = 'integer' AND (
       (mpv = 0 AND calculated_total_usd IS NULL AND rounding_adjustment_usd = 0)
       OR (mpv IN (0, 1)
         AND typeof(calculated_total_usd) IN ('integer', 'real') AND calculated_total_usd BETWEEN 0 AND 100000000000
         AND calculated_total_usd = CAST(ROUND(calculated_total_usd * 10000) AS INTEGER) / 10000.0
         AND typeof(total_usd) IN ('integer', 'real') AND total_usd BETWEEN 0 AND 100000000000
         AND total_usd = CAST(ROUND(total_usd * 10000) AS INTEGER) / 10000.0
         AND typeof(rounding_adjustment_usd) IN ('integer', 'real') AND rounding_adjustment_usd BETWEEN -0.005 AND 0.005
         AND rounding_adjustment_usd = CAST(ROUND(rounding_adjustment_usd * 10000) AS INTEGER) / 10000.0
         AND CAST(ROUND(total_usd * 10000) AS INTEGER) % 100 = 0
         AND CAST(ROUND(calculated_total_usd * 10000) AS INTEGER) + CAST(ROUND(rounding_adjustment_usd * 10000) AS INTEGER) = CAST(ROUND(total_usd * 10000) AS INTEGER)
         AND ((CAST(ROUND(calculated_total_usd * 10000) AS INTEGER) + 50) / 100) * 100 = CAST(ROUND(total_usd * 10000) AS INTEGER)))), 0)) AS would_trip_0161,
  (SELECT COUNT(*) FROM target t WHERE EXISTS (SELECT 1 FROM sale_item_batch_allocations a
     JOIN sale_items si ON si.id = a.sale_item_id WHERE si.sale_id = t.id)) AS with_lot_allocations,
  (SELECT COUNT(*) FROM moved WHERE net_units <> 0) AS moved_sales,
  (SELECT COALESCE(SUM(net_units), 0) FROM moved) AS moved_net_units,
  (SELECT COUNT(*) FROM sales WHERE client_request_id LIKE 'legacy-sale:%' AND COALESCE(stock_skipped, 0) = 0) AS legacy_sale_unmarked,
  (SELECT COUNT(*) FROM sales WHERE client_request_id LIKE 'legacy-sale:%' AND COALESCE(stock_skipped, 0) = 0
     AND sale_status = 'cancelled') AS legacy_sale_unmarked_cancelled,
  (SELECT COUNT(*) FROM target WHERE id BETWEEN 16842 AND 16863) AS sep23_targets_to_mark,
  (SELECT COUNT(*) FROM action_history WHERE entity = 'sep23_subtotal_repair') AS sep23_repair_applied
