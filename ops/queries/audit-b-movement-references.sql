-- DATA-AUDIT lane B (stock & cost), query 4 of 16: does every inventory_movements row point at things that exist?
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Owner rule (conflict-resolution-moves-all-links, 31 Aug): a merge or conflict resolution MOVES every linked record onto
-- the survivor and never orphans one. A movement names a product, a branch, usually a lot (batch_id) and, for sale / return
-- family rows, the sale or return it belongs to (reference_id). The meaning of reference_id depends on the type (lib/movementReference.ts):
--   'sale'                                                  -> sales.id
--   return_reversal, replacement_out, damage_reversal,
--   supplier_return, supplier_return_reversal               -> returns.id
--   'return', 'damage_in', 'damage_out'                     -> a returns.id OR a sales.id (both families write them),
--                                                              told apart by whether that record holds the movement's product
-- Text references ('revert:<id>', 'stock-set:...', 'stock-in-edit:...', 'damaged-lot:...') and NULL are not record ids and are
-- left alone here (reverts: audit-b-revert-linkage.sql).
--
-- One row, zero-expected columns (a non-zero value is a defect, named by the column):
--   movements_product_missing       the product row no longer exists
--   movements_branch_missing        the branch row does not exist
--   movements_lot_missing           batch_id names a lot (product_batches row) that no longer exists
--   movements_lot_other_product     batch_id names a lot of ANOTHER product than the movement's
--   sale_movements_sale_missing     a 'sale' movement whose sale does not exist
--   sale_movements_line_missing     a 'sale' movement whose sale has no line for the movement's product at the movement's branch (a deduction at a branch the sale never sold from)
--   return_family_return_missing    a return-family movement (list above) whose return does not exist
--   ambiguous_reference_unowned     a 'return' / 'damage_in' / 'damage_out' movement with a numeric reference_id that is neither
--                                   a return nor a sale holding the movement's product (the ledger shows it with no receipt)
--   first_ids                       json object: the lowest offending movement id per column, ids only
-- Measured cost: one pass over inventory_movements with primary-key probes into products, product_batches, sales and returns, and a point lookup in the covering
-- sale_items index (product, branch, sale) for the sale / return family; no GROUP BY (a grouping of the movement log costs ~400 ms at production scale).
-- Measured at production scale (workerd D1, 189 ms best of 5 on an idle host, 399k rows read; fixture = 6 Oct 2026 inventory, test-audit-b-scale-workerd.cjs; a loaded host runs 2-3x slower).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero movements_product_missing,movements_branch_missing,movements_lot_missing,movements_lot_other_product,sale_movements_sale_missing,sale_movements_line_missing,return_family_return_missing,ambiguous_reference_unowned
WITH m AS MATERIALIZED (
  SELECT m.id,
    CASE WHEN m.product_id IS NOT NULL AND p.id IS NULL THEN 1 ELSE 0 END AS no_product,
    CASE WHEN m.branch_id IS NOT NULL AND m.branch_id NOT IN (SELECT id FROM branches) THEN 1 ELSE 0 END AS no_branch,
    CASE WHEN m.batch_id IS NOT NULL AND pb.id IS NULL THEN 1 ELSE 0 END AS no_lot,
    CASE WHEN pb.id IS NOT NULL AND pb.variant_product_id IS NOT m.product_id THEN 1 ELSE 0 END AS other_lot,
    CASE WHEN m.movement_type = 'sale' AND typeof(m.reference_id) IN ('integer', 'real') AND s.id IS NULL THEN 1 ELSE 0 END AS no_sale,
    CASE WHEN m.movement_type = 'sale' AND s.id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.product_id = m.product_id AND si.branch_id IS m.branch_id AND si.sale_id = s.id) THEN 1 ELSE 0 END AS no_line,
    CASE WHEN m.movement_type IN ('return_reversal', 'replacement_out', 'damage_reversal', 'supplier_return', 'supplier_return_reversal')
      AND typeof(m.reference_id) IN ('integer', 'real') AND r.id IS NULL THEN 1 ELSE 0 END AS no_return,
    CASE WHEN m.movement_type IN ('return', 'damage_in', 'damage_out') AND typeof(m.reference_id) IN ('integer', 'real')
      AND NOT EXISTS (SELECT 1 FROM return_items ri WHERE ri.return_id = m.reference_id AND ri.product_id = m.product_id)
      AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = m.reference_id AND +si.product_id = m.product_id) THEN 1 ELSE 0 END AS unowned
  FROM inventory_movements m
  LEFT JOIN products p ON p.id = m.product_id
  LEFT JOIN product_batches pb ON pb.id = m.batch_id
  LEFT JOIN sales s ON m.movement_type = 'sale' AND s.id = m.reference_id
  LEFT JOIN returns r ON m.movement_type IN ('return_reversal', 'replacement_out', 'damage_reversal', 'supplier_return', 'supplier_return_reversal') AND r.id = m.reference_id
)
SELECT
  COALESCE(SUM(no_product), 0) AS movements_product_missing,
  COALESCE(SUM(no_branch), 0) AS movements_branch_missing,
  COALESCE(SUM(no_lot), 0) AS movements_lot_missing,
  COALESCE(SUM(other_lot), 0) AS movements_lot_other_product,
  COALESCE(SUM(no_sale), 0) AS sale_movements_sale_missing,
  COALESCE(SUM(no_line), 0) AS sale_movements_line_missing,
  COALESCE(SUM(no_return), 0) AS return_family_return_missing,
  COALESCE(SUM(unowned), 0) AS ambiguous_reference_unowned,
  json_object('product', MIN(CASE WHEN no_product = 1 THEN id END), 'branch', MIN(CASE WHEN no_branch = 1 THEN id END),
    'lot', MIN(CASE WHEN no_lot = 1 THEN id END), 'other_lot', MIN(CASE WHEN other_lot = 1 THEN id END),
    'sale', MIN(CASE WHEN no_sale = 1 THEN id END), 'line', MIN(CASE WHEN no_line = 1 THEN id END),
    'return', MIN(CASE WHEN no_return = 1 THEN id END), 'unowned', MIN(CASE WHEN unowned = 1 THEN id END)) AS first_ids
FROM m
