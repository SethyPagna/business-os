-- RET-B F4 / LH-2 sizing, read-only, for an Ops run BEFORE migration 0235
-- (cloudflare/migrations/0235_imported_sales_stock_skipped.sql) ships.
-- One row. Counts only: no names, phones or money.
--
-- The 0235 target set is exactly the sales a committed import row created:
-- client_request_id = 'sales-import:<job_id>:<row>' joined to an
-- import_sales_commits row with status 'applied' and group_key 'row:<row>'.
--   import_commits_applied   applied import ledger rows
--   linked_sales             of those, rows whose sale exists
--   to_mark                  linked sales with stock_skipped = 0 (0235 marks these)
--   to_mark_cancelled        ... currently cancelled (cancel already handed units back)
--   to_mark_return_status    ... in partial_return / returned
--   already_marked           linked sales an admin already marked
--   applied_without_sale     applied ledger rows with no sale (expect 0)
--   unlinked_import_ids      'sales-import:%' sales with no applied ledger row (not marked)
--   moved_sales / moved_net_units
--                            to_mark sales whose own stock movements (cancel,
--                            un-cancel, status change, amendment; customer-return
--                            rows excluded) are non-empty, and the net units those
--                            movements put BACK (+) or took (-). Positive net units
--                            are phantom stock 0235 does not repair (owner-gated).
--   legacy_sale_unmarked / legacy_sale_unmarked_cancelled
--                            'legacy-sale:%' rows (ops migration scripts), a separate
--                            source 0235 does NOT mark; owner/lead decision
--   sep23_targets_to_mark    to_mark sales among the Sep 23 subtotal-repair cohort
--                            (16842-16863); if > 0 and sep23_repair_applied = 0, the
--                            repair (lib/legacySubtotalRepair.ts, which requires
--                            stock_skipped = 0) must run before 0235 or it will refuse
--   sep23_repair_applied     action_history rows of that repair
-- ops:min-rows 1
-- ops:max-rows 1
WITH linked AS MATERIALIZED (
  SELECT s.id, s.sale_status, COALESCE(s.stock_skipped, 0) AS stock_skipped
  FROM import_sales_commits c
  JOIN sales s ON s.client_request_id = 'sales-import:' || c.job_id || ':' || c.row_number
    AND s.client_request_id IS NOT NULL AND s.client_request_id <> ''
  WHERE c.status = 'applied' AND c.group_key = 'row:' || c.row_number
),
moved AS MATERIALIZED (
  SELECT l.id,
    SUM(CASE WHEN m.movement_type IN ('return', 'damage_in') THEN ABS(COALESCE(m.quantity, 0))
             WHEN m.movement_type IN ('sale', 'damage_out') THEN -ABS(COALESCE(m.quantity, 0)) ELSE 0 END) AS net_units
  FROM linked l
  JOIN inventory_movements m ON m.reference_id = l.id
    AND m.movement_type IN ('sale', 'return', 'damage_in', 'damage_out')
    AND m.product_id IN (SELECT si.product_id FROM sale_items si WHERE si.sale_id = l.id)
    AND NOT (COALESCE(m.reason, '') LIKE 'Return: %' OR COALESCE(m.reason, '') LIKE 'Return #%'
      OR COALESCE(m.reason, '') IN ('Apply grouped return status', 'Undo grouped return status'))
  WHERE l.stock_skipped = 0
  GROUP BY l.id
)
SELECT
  (SELECT COUNT(*) FROM import_sales_commits WHERE status = 'applied') AS import_commits_applied,
  (SELECT COUNT(*) FROM linked) AS linked_sales,
  (SELECT COUNT(*) FROM linked WHERE stock_skipped = 0) AS to_mark,
  (SELECT COUNT(*) FROM linked WHERE stock_skipped = 0 AND sale_status = 'cancelled') AS to_mark_cancelled,
  (SELECT COUNT(*) FROM linked WHERE stock_skipped = 0 AND sale_status IN ('partial_return', 'returned')) AS to_mark_return_status,
  (SELECT COUNT(*) FROM linked WHERE stock_skipped <> 0) AS already_marked,
  (SELECT COUNT(*) FROM import_sales_commits WHERE status = 'applied') - (SELECT COUNT(*) FROM linked) AS applied_without_sale,
  (SELECT COUNT(*) FROM sales s WHERE s.client_request_id LIKE 'sales-import:%'
     AND s.id NOT IN (SELECT id FROM linked)) AS unlinked_import_ids,
  (SELECT COUNT(*) FROM moved WHERE net_units <> 0) AS moved_sales,
  (SELECT COALESCE(SUM(net_units), 0) FROM moved) AS moved_net_units,
  (SELECT COUNT(*) FROM sales WHERE client_request_id LIKE 'legacy-sale:%' AND COALESCE(stock_skipped, 0) = 0) AS legacy_sale_unmarked,
  (SELECT COUNT(*) FROM sales WHERE client_request_id LIKE 'legacy-sale:%' AND COALESCE(stock_skipped, 0) = 0
     AND sale_status = 'cancelled') AS legacy_sale_unmarked_cancelled,
  (SELECT COUNT(*) FROM linked WHERE stock_skipped = 0 AND id BETWEEN 16842 AND 16863) AS sep23_targets_to_mark,
  (SELECT COUNT(*) FROM action_history WHERE entity = 'sep23_subtotal_repair') AS sep23_repair_applied
