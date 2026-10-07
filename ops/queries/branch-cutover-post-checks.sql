-- Branch cutover post-checks, self-contained half (G12-CUTOVER-READINESS.md 3.4 items 1, 2-3
-- totals, 4 changed rows, 5, 7, 8 run-scoped orphans, 9 blanks, 10). Read-only; run it at P10 after
-- finalize. One row; every column must be 0 (ops:expect-zero *): a NULL or missing value fails too.
-- Expected values come from the run's own records, never a re-count of the result:
--   no_completed_run       the newest not-aborted journal is completed with terminal_json
--   source_*               Old Shop holds no stock, lots, damaged units or active RFID tags
--   target_units_off       LC Store units <> manifest sourceQuantityText + baseline target units
--   target_lot_units_off   the same for lot units (folds move units between lots, never out)
--   lots_exceed_stock      LC Store products whose lots exceed branch stock
--   receipts_off           |committed bc_<op>_<seq> receipts - committed_children|
--   receipt_members_off    those receipts without exactly one member, or a member not Shop ->
--                          Warehouse for one product
--   moved_units_off        sum of member quantities <> manifest sourceQuantityText
--   transfers_off          stock_transfers rows per receipt <> 1, or labels not Shop -> Warehouse
--   movements_off          |transfer_out at Shop / transfer_in at Warehouse since begin - one per
--                          allocation plus one per untracked part|, plus rows with another label
--   fold_lots_off          fold audit "after" quantities <> LC Store lot quantities now
--   fold_costs_off         re-costed survivors whose unit_cost_usd <> the recorded cost after
--   batches_changed_off    product_batches rows updated since begin that are not a re-costed
--                          survivor (lot identity, item 4; the comparable half checks content)
--   blank_labels           blank history labels on rows of the two branches (item 9)
--   directory_off          failed directory conditions (item 10): one active branch, LC Store
--                          default / role shop / key warehouse / the intent's name, Old Shop
--                          inactive / successor / key shop / the intent's name / notes kept
--   maintenance_flag       the maintenance flag is still present
--   inactive_with_stock    inactive products holding stock on any of the four ledgers (cache, branch rows, lots, held units): the run folds them into their active twin first
--   orphans                lot rows without a batch, stock rows without a product, receipts
--                          without a member, transfers since begin that no run receipt made
-- Cost: index range reads at the two branches (the run's movements and transfers from begin
-- on), the run's receipts by request id prefix, and one sequential pass over the big label
-- tables (inventory_movements, sales, product_batches). D1 refuses a LIKE/GLOB pattern over 50
-- bytes; there is none. At full production scale on workerd D1: about 0.4x the fold preview.
-- Paired test: cloudflare/scripts/test-branch-cutover-post-checks-native.cjs
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero *
WITH one AS (SELECT 1 AS x), op AS MATERIALIZED (
  -- the newest cutover that was not aborted: at P7 (just begun) and at P10 (completed) it is the same row
  SELECT c.operation_id AS id, c.source_branch_id AS src, c.target_branch_id AS tgt, c.created_at AS began, datetime(c.created_at) AS began_t, c.phase, c.terminal_json,
    c.committed_children AS children, c.manifest_json AS manifest, c.intent_json AS intent,
    json_extract(c.source_preimage_json, '$.name') AS src_name, json_extract(c.target_preimage_json, '$.name') AS tgt_name,
    c.source_preimage_json AS src_pre
  FROM branch_cutovers c WHERE c.phase <> 'aborted' ORDER BY c.created_at DESC, c.operation_id LIMIT 1
), fold AS MATERIALIZED (
  -- the run's own fold decisions (branchCutoverParent.ts, BRANCH_CUTOVER_FOLD_AUDIT_ACTION), read through the action index
  SELECT a.details AS d FROM op JOIN audit_logs a ON a.action = 'branch_cutover_lot_fold' AND json_extract(a.details, '$.operationId') = op.id
), fl AS MATERIALIZED (
  -- one row per lot a fold touched at the target: quantity before / after, and for the survivor its cost before / after
  SELECT CAST(json_extract(b.value, '$[0]') AS INTEGER) AS id, json_extract(b.value, '$[1]') AS qb,
    json_extract(f.d, '$.after[' || b.key || '][1]') AS qa,
    CASE WHEN CAST(json_extract(b.value, '$[0]') AS INTEGER) = json_extract(f.d, '$.survivorBatchId')
      AND json_extract(f.d, '$.unitCostUsdAfter') IS NOT json_extract(f.d, '$.unitCostUsdBefore') THEN 1 ELSE 0 END AS recost,
    json_extract(f.d, '$.unitCostUsdBefore') AS cb, json_extract(f.d, '$.unitCostUsdAfter') AS ca,
    CAST(json_extract(f.d, '$.after[' || b.key || '][0]') AS INTEGER) AS id_after
  FROM fold f, json_each(f.d, '$.before') b
), rc AS MATERIALIZED (
  SELECT r.id, r.status FROM op JOIN transfer_operation_receipts r
    ON substr(r.request_id, 1, length('bc_' || op.id || '_')) = 'bc_' || op.id || '_'
), mem AS MATERIALIZED (
  SELECT rc.id AS receipt, count(m.ordinal) AS n, COALESCE(SUM(m.quantity), 0) AS q,
    COALESCE(SUM(json_array_length(m.allocations_json) + CASE WHEN m.untracked_quantity > 0 THEN 1 ELSE 0 END), 0) AS moves,
    COALESCE(SUM(CASE WHEN m.source_branch_id IS NOT op.src OR m.destination_branch_id IS NOT op.tgt
      OR m.source_product_id IS NOT m.destination_product_id THEN 1 ELSE 0 END), 0) AS off_route
  FROM op, rc LEFT JOIN transfer_operation_members m ON m.receipt_id = rc.id GROUP BY rc.id
), mv AS MATERIALIZED (
  -- the run's movements at the two branches: an index range from begin (text bound), then the exact instant
  SELECT v.branch_id, v.movement_type, v.branch_name FROM op JOIN inventory_movements v
    ON v.branch_id IN (op.src, op.tgt) AND v.created_at >= op.began_t
  WHERE julianday(v.created_at) >= julianday(op.began_t) AND v.movement_type IN ('transfer_out', 'transfer_in')
), tgt_lots AS MATERIALIZED (
  SELECT b.variant_product_id AS p, SUM(s.quantity) AS q FROM op JOIN branch_batch_stock s ON s.branch_id = op.tgt
    JOIN product_batches b ON b.id = s.batch_id GROUP BY b.variant_product_id
)
SELECT
  CASE WHEN op.phase = 'completed' AND op.terminal_json IS NOT NULL THEN 0 ELSE 1 END AS no_completed_run,
  (SELECT count(*) FROM branch_stock WHERE branch_id = op.src AND quantity <> 0) AS source_stock,
  (SELECT count(*) FROM branch_batch_stock WHERE branch_id = op.src AND quantity <> 0) AS source_lots,
  (SELECT count(*) FROM damaged_stock_lots WHERE branch_id = op.src AND quantity_remaining <> 0) AS source_damaged,
  (SELECT count(*) FROM rfid_tags WHERE branch_id = op.src AND status = 'active') AS source_rfid,
  CASE WHEN abs((SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE branch_id = op.tgt)
    - CAST(json_extract(op.manifest, '$.sourceQuantityText') AS REAL) - CAST(json_extract(op.manifest, '$.baseline.targetQuantityText') AS REAL)) <= 0.000000001
    THEN 0 ELSE 1 END AS target_units_off,
  CASE WHEN abs((SELECT COALESCE(SUM(quantity), 0) FROM branch_batch_stock WHERE branch_id = op.tgt)
    - CAST(json_extract(op.manifest, '$.sourceLotQuantityText') AS REAL) - CAST(json_extract(op.manifest, '$.baseline.targetLotQuantityText') AS REAL)) <= 0.000000001
    THEN 0 ELSE 1 END AS target_lot_units_off,
  (SELECT count(*) FROM tgt_lots t LEFT JOIN branch_stock x ON x.product_id = t.p AND x.branch_id = op.tgt
    WHERE t.q > COALESCE(x.quantity, 0) + 0.000000001) AS lots_exceed_stock,
  abs((SELECT count(*) FROM rc WHERE status = 'committed') - op.children) + (SELECT count(*) FROM rc WHERE status <> 'committed') AS receipts_off,
  (SELECT count(*) FROM mem WHERE n <> 1 OR off_route <> 0) AS receipt_members_off,
  CASE WHEN abs((SELECT COALESCE(SUM(q), 0) FROM mem) - CAST(json_extract(op.manifest, '$.sourceQuantityText') AS REAL)) <= 0.000000001 THEN 0 ELSE 1 END AS moved_units_off,
  (SELECT count(*) FROM rc WHERE (SELECT count(*) FROM stock_transfers t WHERE t.receipt_id = rc.id) <> 1)
    + (SELECT count(*) FROM rc JOIN stock_transfers t ON t.receipt_id = rc.id
      WHERE t.from_branch_name IS NOT op.src_name OR t.to_branch_name IS NOT op.tgt_name OR t.from_branch_id IS NOT op.src OR t.to_branch_id IS NOT op.tgt) AS transfers_off,
  abs((SELECT count(*) FROM mv WHERE branch_id = op.src AND movement_type = 'transfer_out') - (SELECT COALESCE(SUM(moves), 0) FROM mem))
    + abs((SELECT count(*) FROM mv WHERE branch_id = op.tgt AND movement_type = 'transfer_in') - (SELECT COALESCE(SUM(moves), 0) FROM mem))
    + (SELECT count(*) FROM mv WHERE (branch_id = op.src AND movement_type = 'transfer_in') OR (branch_id = op.tgt AND movement_type = 'transfer_out')
      OR branch_name IS NOT CASE branch_id WHEN op.src THEN op.src_name ELSE op.tgt_name END) AS movements_off,
  (SELECT count(*) FROM fl LEFT JOIN branch_batch_stock s ON s.batch_id = fl.id_after AND s.branch_id = op.tgt WHERE s.quantity IS NOT fl.qa) AS fold_lots_off,
  (SELECT count(*) FROM fl JOIN product_batches b ON b.id = fl.id WHERE fl.recost = 1 AND b.unit_cost_usd IS NOT fl.ca) AS fold_costs_off,
  (SELECT count(*) FROM product_batches b WHERE b.updated_at >= op.began_t AND julianday(b.updated_at) >= julianday(op.began)
    AND NOT EXISTS (SELECT 1 FROM fl WHERE fl.id = b.id AND fl.recost = 1)) AS batches_changed_off,
  (SELECT count(*) FROM sales x WHERE +x.branch_id IN (op.src, op.tgt) AND (x.branch_name IS NULL OR (x.branch_name NOT IN (op.src_name, op.tgt_name) AND trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '')))
    + (SELECT count(*) FROM returns x WHERE x.branch_id IN (op.src, op.tgt) AND (x.branch_name IS NULL OR (x.branch_name NOT IN (op.src_name, op.tgt_name) AND trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '')))
    + (SELECT count(*) FROM inventory_movements x WHERE +x.branch_id IN (op.src, op.tgt) AND (x.branch_name IS NULL OR (x.branch_name NOT IN (op.src_name, op.tgt_name) AND trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '')))
    + (SELECT count(*) FROM stock_row_moves x WHERE x.branch_id IN (op.src, op.tgt) AND (x.branch_name IS NULL OR (x.branch_name NOT IN (op.src_name, op.tgt_name) AND trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '')))
    + (SELECT count(*) FROM stock_session_members x WHERE x.branch_id IN (op.src, op.tgt) AND (x.branch_name IS NULL OR (x.branch_name NOT IN (op.src_name, op.tgt_name) AND trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '')))
    + (SELECT count(*) FROM stock_transfers x WHERE x.from_branch_id IN (op.src, op.tgt) AND (x.from_branch_name IS NULL OR (x.from_branch_name NOT IN (op.src_name, op.tgt_name) AND trim(x.from_branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '')))
    + (SELECT count(*) FROM stock_transfers x WHERE x.to_branch_id IN (op.src, op.tgt) AND (x.to_branch_name IS NULL OR (x.to_branch_name NOT IN (op.src_name, op.tgt_name) AND trim(x.to_branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '')))
    + (SELECT count(*) FROM fees x WHERE x.branch_id IN (op.src, op.tgt) AND (x.branch_name IS NULL OR (x.branch_name NOT IN (op.src_name, op.tgt_name) AND trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '')))
    + (SELECT count(*) FROM product_batches x WHERE +x.received_branch_id IN (op.src, op.tgt) AND (x.received_branch_name IS NULL OR (x.received_branch_name NOT IN (op.src_name, op.tgt_name) AND trim(x.received_branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = '')))
    + (SELECT count(*) FROM shift_sessions x WHERE x.branch_id IN (op.src, op.tgt) AND (x.branch_name IS NULL OR (x.branch_name NOT IN (op.src_name, op.tgt_name) AND trim(x.branch_name, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) = ''))) AS blank_labels,
  (SELECT CASE WHEN count(*) = 1 THEN 0 ELSE 1 END FROM branches WHERE is_active = 1)
    + (SELECT count(*) FROM (SELECT 1 FROM one) WHERE NOT EXISTS (SELECT 1 FROM branches WHERE id = op.tgt AND is_active = 1 AND is_default = 1
      AND role = 'shop' AND canonical_key = 'warehouse' AND name = json_extract(op.intent, '$.successorName')))
    + (SELECT count(*) FROM (SELECT 1 FROM one) WHERE NOT EXISTS (SELECT 1 FROM branches WHERE id = op.src AND is_active = 0 AND is_default = 0
      AND successor_branch_id = op.tgt AND canonical_key = 'shop' AND name = json_extract(op.intent, '$.retiredName')
      AND notes IS json_extract(op.src_pre, '$.notes'))) AS directory_off,
  (SELECT count(*) FROM system_flags WHERE key = 'maintenance') AS maintenance_flag,
  (SELECT count(*) FROM products p WHERE p.is_active IS NOT 1 AND (COALESCE(p.stock_quantity, 0) <> 0
    OR EXISTS (SELECT 1 FROM branch_stock s WHERE s.product_id = p.id AND s.quantity <> 0)
    OR EXISTS (SELECT 1 FROM product_batches b CROSS JOIN branch_batch_stock s ON s.batch_id = b.id WHERE b.variant_product_id = p.id AND s.quantity <> 0)
    OR EXISTS (SELECT 1 FROM damaged_stock_lots d WHERE d.product_id = p.id AND d.quantity_remaining <> 0))) AS inactive_with_stock,
  (SELECT count(*) FROM branch_batch_stock s WHERE s.branch_id IN (op.src, op.tgt) AND NOT EXISTS (SELECT 1 FROM product_batches b WHERE b.id = s.batch_id))
    + (SELECT count(*) FROM branch_stock x WHERE x.branch_id IN (op.src, op.tgt) AND NOT EXISTS (SELECT 1 FROM products p WHERE p.id = x.product_id))
    + (SELECT count(*) FROM rc WHERE NOT EXISTS (SELECT 1 FROM transfer_operation_members m WHERE m.receipt_id = rc.id))
    + (SELECT count(*) FROM stock_transfers t WHERE t.created_at >= op.began_t AND julianday(t.created_at) >= julianday(op.began)
      AND NOT EXISTS (SELECT 1 FROM rc WHERE rc.id = t.receipt_id)) AS orphans
FROM one LEFT JOIN op
