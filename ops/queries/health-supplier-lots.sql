-- health-supplier-lots: supplier purchases ARE the lot ledger (GET
-- /api/contacts/suppliers/:id/purchases reads product_batches), so the checks are
-- on the lots' own receipt fields (DATA-MATCH DM-17).
--   negative_received         received_quantity or received_cost_usd below 0
--   lots_name_only_resolvable supplier_id NULL but supplier_name matches exactly one supplier
--                             (the purchases float finds them by name; the owner rule says link)
--   credit_without_due        payment_status 'credit' with no credit_due_date (INFO)
--   receipt_cost_drift        lots with a received_cost_usd (migration 0080) that differs from
--                             the lot's own receipt movements ('add', 'stock_in' =
--                             STOCK_RECEIPT_MOVEMENT_TYPES) by more than a cent, reverted lots
--                             left out (INFO/RATCHET: imports and merges make it approximate)
-- Counts only.
-- ops:min-rows 1
-- ops:max-rows 1
WITH rc AS MATERIALIZED (
  SELECT batch_id, SUM(COALESCE(total_cost_usd, 0)) AS cost, SUM(ABS(COALESCE(quantity, 0))) AS qty
  FROM inventory_movements
  WHERE batch_id IS NOT NULL AND movement_type IN ('add', 'stock_in')
  GROUP BY batch_id
)
SELECT
  (SELECT COUNT(*) FROM product_batches WHERE COALESCE(received_quantity, 0) < 0 OR COALESCE(received_cost_usd, 0) < 0) AS negative_received,
  (SELECT COUNT(*) FROM product_batches pb WHERE pb.supplier_id IS NULL AND COALESCE(trim(pb.supplier_name), '') <> ''
     AND (SELECT COUNT(*) FROM suppliers s WHERE lower(trim(s.name)) = lower(trim(pb.supplier_name))) = 1) AS lots_name_only_resolvable,
  (SELECT COUNT(*) FROM product_batches WHERE payment_status = 'credit' AND COALESCE(credit_due_date, '') = '') AS credit_without_due,
  (SELECT COUNT(*) FROM product_batches pb JOIN rc ON rc.batch_id = pb.id
     WHERE pb.received_cost_usd IS NOT NULL AND ABS(pb.received_cost_usd - rc.cost) > 0.01
       AND NOT EXISTS (SELECT 1 FROM inventory_movements r WHERE r.batch_id = pb.id AND r.reference_id LIKE 'revert:%')) AS receipt_cost_drift
