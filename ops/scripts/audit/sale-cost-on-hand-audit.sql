-- Sale and return line cost audit for held migration 0200 (U-cost; owner
-- decisions 2026-09-26 and 2026-09-27).
-- READ-ONLY: every statement is a single SELECT. Run it AFTER migration 0195
-- is applied: the era of the buggy average ends 2 hours after 0195's apply
-- time (catalog_cost_repair_0195_backup.created_at), and before 0195 that
-- table does not exist, so every statement fails with "no such table" by
-- design. Run each statement on its own with --command (wrangler d1 execute
-- --file returns no rows); the exact owner-run commands, and which numbers to
-- read, are in the header of
-- ops/scripts/migration/held/0200_sale_cost_on_hand_repair.sql (OWNER-RUN AUDIT).
-- The plan text between plan:begin and plan:stop is byte-identical to
-- ops/scripts/migration/held/0200_sale_cost_on_hand_repair.sql (pinned by
-- cloudflare/scripts/test-held-0200-sale-cost-repair-pure.cjs); the
-- method, reconstruction, guard and limits are documented in that
-- migration's header.
--
-- Buckets (statement 1 always lists all eight, zero when empty):
--   repair               -- 0200 rewrites the sale line cost
--   window               -- sale line written by the old Worker in the 2 hours
--                           after 0195 applied; 0200 rewrites it
--   returns_sale_linked  -- return line that copied a rewritten sale line's
--                           cost (by sale_item_id, or by product when
--                           sale_item_id is NULL); 0200 rewrites it
--   returns_walk_in      -- walk-in return line that took the buggy catalog
--                           cost; 0200 rewrites it at the return's time
--   ledger_unverified    -- came from the buggy average, but a lot does not
--                           reconcile; listed with the best estimate, NOT rewritten
--   needs_owner_review   -- affected or possibly affected, not provable;
--                           listed with the best estimate and a reason, NOT rewritten
--   after_window         -- still matching the buggy average after the
--                           window: a deploy-lag tell, must be 0
--   already_correct      -- came from the buggy average, which equalled the
--                           on-hand cost; informational
-- Statements 1 and 3 print counts and sums only (safe for logs). Statement 2
-- prints rows: for the encrypted ops export only.

-- 1. Bucket summary: every bucket, lines, units, cost delta (correct - recorded) x qty.
-- plan:begin
WITH
params AS MATERIALIZED (
  SELECT fx AS fix_at,
    COALESCE(datetime(fx, '+2 hours'), '9999-12-31 23:59:59') AS era_end,
    COALESCE(datetime(fx, '+7 days'), '9999-12-31 23:59:59') AS scan_end
  FROM (SELECT COALESCE(MIN(datetime(created_at)), '9999-12-31 23:59:59') AS fx FROM catalog_cost_repair_0195_backup)
),
merge_rev AS MATERIALIZED (
  SELECT us.id * 1000000 AS ord, datetime(us.created_at) AS at, us.payload_json AS rev
    FROM undo_snapshots us
   WHERE us.kind IN ('product.merge', 'product.merge.group.child') AND us.status <> 'reversed'
     AND datetime(us.created_at) >= '2026-09-16 14:04:42' AND json_valid(us.payload_json)
  UNION ALL
  SELECT us.id * 1000000 + r.key, datetime(us.created_at), r.value
    FROM undo_snapshots us
    JOIN json_each(CASE WHEN json_valid(us.payload_json) THEN us.payload_json ELSE '{}' END, '$.reversals') r
   WHERE us.kind = 'product.merge.bulk' AND us.status <> 'reversed' AND datetime(us.created_at) >= '2026-09-16 14:04:42'
),
row_move AS MATERIALIZED (
  SELECT 'sale_items' AS tbl, CAST(i.value AS INTEGER) AS row_id, CAST(json_extract(m.rev, '$.dupId') AS INTEGER) AS dup_id, m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.reparentedSaleItemIds') i
  UNION
  SELECT json_extract(t.value, '$.table'), CAST(i.value AS INTEGER), CAST(json_extract(m.rev, '$.dupId') AS INTEGER), m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.reparentedByTable') t JOIN json_each(t.value, '$.ids') i
   WHERE json_extract(t.value, '$.table') IN ('sale_items', 'return_items', 'product_cost_entries')
  UNION
  SELECT 'product_batches', CAST(json_extract(b.value, '$.id') AS INTEGER), CAST(json_extract(m.rev, '$.dupId') AS INTEGER), m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.repointedBatches') b
),
merge_lots AS MATERIALIZED (
  SELECT m.at, m.ord, 'fold' AS how, f.value AS lot
    FROM merge_rev m JOIN json_each(m.rev, '$.foldedBatches') f
  UNION ALL
  SELECT m.at, m.ord, 'write_off', w.value
    FROM merge_rev m JOIN json_each(m.rev, '$.writtenOffBatches') w
),
merge_pos AS MATERIALIZED (
  SELECT m2.at, COALESCE((SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= m2.at),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im)) - 0.5 AS pos
  FROM (SELECT DISTINCT at FROM merge_lots) m2
),
lot_edit AS MATERIALIZED (
  SELECT a.id, CAST(a.entity_id AS INTEGER) AS lot_id, datetime(a.created_at) AS at,
    CAST(json_extract(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') AS REAL) AS cost
  FROM audit_logs a
  WHERE a.action = 'batch_update' AND a.entity = 'product_batch'
    AND json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') IS NOT NULL
),
sale_lines AS MATERIALIZED (
  SELECT si.id AS item_id, si.sale_id, si.product_id AS product_now, si.quantity, si.cost_price_usd AS recorded,
    datetime(s.created_at) AS sale_at
  FROM sale_items si JOIN sales s ON s.id = si.sale_id
  WHERE si.product_id IS NOT NULL AND si.cost_price_usd > 0 AND datetime(s.created_at) >= '2026-09-16 14:04:42'
  UNION
  SELECT si.id, si.sale_id, si.product_id, si.quantity, si.cost_price_usd, datetime(s.created_at)
  FROM inventory_movements im
  JOIN sale_items si ON si.sale_id = im.reference_id AND si.product_id = im.product_id
  JOIN sales s ON s.id = si.sale_id
  WHERE im.movement_type = 'sale' AND im.created_at >= '2026-09-16 14:04:42'
    AND si.cost_price_usd > 0 AND datetime(s.created_at) < '2026-09-16 14:04:42'
),
items AS MATERIALIZED (
  SELECT 'sale' AS kind, sm.item_id AS ik, sm.item_id, sm.sale_id, NULL AS return_id, sm.product_now, sm.quantity, sm.recorded,
    COALESCE((SELECT datetime(im.created_at) FROM inventory_movements im WHERE im.id = COALESCE(sm.mv_id, sm.mv_any)), sm.sale_at) AS t,
    COALESCE(sm.mv_id, sm.mv_any,
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= sm.sale_at),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im)) AS pos
  FROM (SELECT sl.*,
      (SELECT MIN(im.id) FROM inventory_movements im
        WHERE im.reference_id = sl.sale_id AND im.movement_type = 'sale' AND im.product_id = sl.product_now
          AND im.unit_cost_usd IS NOT NULL AND ABS(im.unit_cost_usd - sl.recorded) < 0.00006) AS mv_id,
      (SELECT MIN(im.id) FROM inventory_movements im
        WHERE im.reference_id = sl.sale_id AND im.movement_type = 'sale' AND im.product_id = sl.product_now) AS mv_any
    FROM sale_lines sl) sm
  UNION ALL
  SELECT 'return', -ri.id, ri.id, NULL, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at),
    COALESCE((SELECT MIN(im.id) FROM inventory_movements im WHERE im.reference_id = r.id AND im.movement_type = 'return'),
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= datetime(r.created_at)),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im))
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  WHERE r.sale_id IS NULL AND COALESCE(r.return_scope, 'customer') = 'customer' AND ri.sale_item_id IS NULL
    AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0 AND datetime(r.created_at) >= '2026-09-16 14:04:42'
),
item_ctx AS MATERIALIZED (
  SELECT x.*,
    CASE WHEN x.lot_owner <> COALESCE(x.moved_dup, x.product_now) THEN x.lot_owner ELSE COALESCE(x.moved_dup, x.product_now) END AS prod_at,
    x.moved_dup IS NOT NULL AS moved, COALESCE(x.lot_owner <> COALESCE(x.moved_dup, x.product_now), 0) AS orphan
  FROM (SELECT it.*, p.fix_at, p.era_end,
      (SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = pb.id AND rm.at > it.t
          ORDER BY rm.ord LIMIT 1), pb.variant_product_id)
        FROM product_batches pb
       WHERE pb.id = CASE it.kind WHEN 'sale' THEN (SELECT si.batch_id FROM sale_items si WHERE si.id = it.item_id)
         ELSE (SELECT ri.batch_id FROM return_items ri WHERE ri.id = it.item_id) END) AS lot_owner,
      (SELECT rm.dup_id FROM row_move rm
        WHERE rm.tbl = CASE it.kind WHEN 'sale' THEN 'sale_items' ELSE 'return_items' END
          AND rm.row_id = it.item_id AND rm.at > it.t ORDER BY rm.ord LIMIT 1) AS moved_dup
    FROM items it JOIN params p
    WHERE it.t >= '2026-09-16 14:04:42' AND it.t < p.scan_end) x
),
pce_at AS MATERIALIZED (
  SELECT ic.ik, pce.id, pce.cost_usd, pce.baseline_batch_id
    FROM item_ctx ic JOIN product_cost_entries pce ON pce.product_id = ic.prod_at
   WHERE datetime(pce.created_at) <= ic.t
     AND NOT EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pce.id AND rm.at > ic.t)
  UNION
  SELECT ic.ik, pce.id, pce.cost_usd, pce.baseline_batch_id
    FROM item_ctx ic
    JOIN row_move rm ON rm.tbl = 'product_cost_entries' AND rm.dup_id = ic.prod_at AND rm.at > ic.t
    JOIN product_cost_entries pce ON pce.id = rm.row_id
   WHERE datetime(pce.created_at) <= ic.t
     AND NOT EXISTS (SELECT 1 FROM row_move r2 WHERE r2.tbl = 'product_cost_entries' AND r2.row_id = rm.row_id
       AND r2.at > ic.t AND r2.ord < rm.ord)
),
pce_top AS MATERIALIZED (
  SELECT ik, cost_usd, baseline_batch_id FROM (
    SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.ik ORDER BY x.id DESC) AS rn FROM pce_at x)
  WHERE rn = 1
),
item_me AS MATERIALIZED (
  SELECT ic.*,
    pt.ik IS NOT NULL AS has_me, pt.cost_usd AS me_cost, COALESCE(pt.baseline_batch_id, 0) AS me_baseline,
    EXISTS (SELECT 1 FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t) AS now_has_me,
    (SELECT pce.cost_usd FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t ORDER BY pce.id DESC LIMIT 1) AS now_me_cost,
    COALESCE((SELECT pce.baseline_batch_id FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t ORDER BY pce.id DESC LIMIT 1), 0) AS now_me_baseline,
    EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = ic.prod_at AND rm.at > ic.t) AS me_moved
  FROM item_ctx ic LEFT JOIN pce_top pt ON pt.ik = ic.ik
),
item_lot AS MATERIALIZED (
  SELECT m.ik, pb.id AS lot_id
    FROM item_me m JOIN product_batches pb ON pb.variant_product_id = m.prod_at
   WHERE NOT EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = pb.id AND rm.at > m.t)
  UNION
  SELECT m.ik, rm.row_id
    FROM item_me m JOIN row_move rm ON rm.tbl = 'product_batches' AND rm.dup_id = m.prod_at AND rm.at > m.t
   WHERE NOT EXISTS (SELECT 1 FROM row_move r2 WHERE r2.tbl = 'product_batches' AND r2.row_id = rm.row_id
       AND r2.at > m.t AND r2.ord < rm.ord)
),
lot_base AS MATERIALIZED (
  SELECT pb.id AS lot_id, pb.is_active, pb.unit_cost_usd AS cost_now, datetime(pb.updated_at) AS updated_at,
    datetime(COALESCE(pb.created_at, pb.received_at)) AS created, COALESCE(pb.received_at, '') AS received_at,
    COALESCE(pb.received_quantity, 0) AS received_quantity,
    (SELECT im.unit_cost_usd FROM inventory_movements im
      WHERE im.batch_id = pb.id AND im.quantity > 0 AND im.unit_cost_usd > 0 ORDER BY im.id LIMIT 1) AS receipt_cost,
    (SELECT MAX(le.at) FROM lot_edit le WHERE le.lot_id = pb.id) AS last_edit_at
  FROM product_batches pb WHERE pb.id IN (SELECT lot_id FROM item_lot)
),
lot_at AS MATERIALIZED (
  SELECT il.ik, il.lot_id, m.t, m.pos, m.has_me, m.me_cost, m.me_baseline, lb.created, lb.received_at,
    CASE WHEN lb.is_active = 1 OR lb.updated_at > m.t THEN 1 ELSE 0 END AS active_t,
    COALESCE(
      (SELECT le.cost FROM lot_edit le WHERE le.lot_id = il.lot_id AND le.at <= m.t ORDER BY le.id DESC LIMIT 1),
      CASE WHEN lb.last_edit_at > m.t THEN COALESCE(lb.receipt_cost, lb.cost_now)
           WHEN lb.updated_at > m.t AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005
             THEN lb.receipt_cost END,
      lb.cost_now) AS cost_t,
    CASE WHEN (COALESCE(lb.is_active, 0) <> 1 AND lb.updated_at > m.t)
      OR lb.last_edit_at > m.t
      OR (lb.updated_at > m.t AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005)
      OR EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = il.lot_id AND rm.at > m.t)
    THEN 1 ELSE 0 END AS changed
  FROM item_lot il JOIN item_me m ON m.ik = il.ik JOIN lot_base lb ON lb.lot_id = il.lot_id
),
bset AS MATERIALIZED (
  SELECT la.ik, 'h' AS v, la.cost_t AS cost
    FROM lot_at la
   WHERE la.active_t = 1 AND la.cost_t > 0 AND la.created <= la.t AND (la.has_me = 0 OR la.lot_id > la.me_baseline)
  UNION
  SELECT m.ik, 'h', m.me_cost FROM item_me m WHERE m.has_me = 1 AND m.me_cost > 0
  UNION
  SELECT m.ik, 'n', pb.unit_cost_usd
    FROM item_me m JOIN product_batches pb ON pb.variant_product_id = m.product_now
   WHERE pb.is_active = 1 AND pb.unit_cost_usd > 0
     AND datetime(COALESCE(pb.created_at, pb.received_at)) <= m.t
     AND (m.now_has_me = 0 OR pb.id > m.now_me_baseline)
  UNION
  SELECT m.ik, 'n', m.now_me_cost FROM item_me m WHERE m.now_has_me = 1 AND m.now_me_cost > 0
),
item_match AS MATERIALIZED (
  SELECT m.ik,
    MAX(CASE WHEN b.v = 'h' AND (ABS(m.recorded - b.b1) < 0.00006 OR ABS(m.recorded - b.b1h) < 0.00006 OR ABS(m.recorded - b.b2) < 0.00006) THEN 1 ELSE 0 END) AS h_match,
    MAX(CASE WHEN b.v = 'n' AND (ABS(m.recorded - b.b1) < 0.00006 OR ABS(m.recorded - b.b1h) < 0.00006 OR ABS(m.recorded - b.b2) < 0.00006) THEN 1 ELSE 0 END) AS n_match,
    MAX(CASE WHEN b.v = 'h' THEN b.b1 END) AS buggy_mean_usd
  FROM item_me m JOIN (
    SELECT ik, v,
      ROUND(AVG(cost), 4) AS b1,
      CAST(AVG(cost) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
      CASE WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost) ELSE ROUND(AVG(cost), 4) END AS b2
    FROM bset GROUP BY ik, v) b ON b.ik = m.ik
  GROUP BY m.ik
),
cand_lots AS MATERIALIZED (
  SELECT lot_id FROM lot_base
),
ev AS MATERIALIZED (
  SELECT im.batch_id AS lot_id, im.id AS pos, im.quantity AS qty
    FROM inventory_movements im WHERE im.batch_id IN (SELECT lot_id FROM cand_lots)
  UNION ALL
  SELECT x.lot_id, x.pos, -x.q FROM (
    SELECT COALESCE((SELECT CAST(json_extract(ml.lot, '$.dupBatchId') AS INTEGER) FROM merge_lots ml JOIN json_each(ml.lot, '$.saleAllocationIds') ai
          WHERE ml.how = 'fold' AND CAST(ai.value AS INTEGER) = a.id ORDER BY ml.ord LIMIT 1), a.batch_id) AS lot_id,
      a.quantity - COALESCE(a.released_quantity, 0) AS q,
      (SELECT MIN(im.id) FROM sale_items si JOIN inventory_movements im
          ON im.reference_id = si.sale_id AND im.movement_type = 'sale' AND im.product_id = si.product_id AND im.batch_id IS NULL
        WHERE si.id = a.sale_item_id) AS pos
    FROM sale_item_batch_allocations a) x
  WHERE x.pos IS NOT NULL AND x.lot_id IN (SELECT lot_id FROM cand_lots)
  UNION ALL
  SELECT x.lot_id, x.pos, x.qty FROM (
    SELECT CAST(json_extract(ml.lot, CASE ml.how WHEN 'fold' THEN '$.dupBatchId' ELSE '$.batchId' END) AS INTEGER) AS lot_id,
      mp.pos, -json_extract(s.value, '$.quantity') AS qty
      FROM merge_lots ml JOIN json_each(ml.lot, CASE ml.how WHEN 'fold' THEN '$.dupStockBefore' ELSE '$.stockBefore' END) s
      JOIN merge_pos mp ON mp.at = ml.at
    UNION ALL
    SELECT CAST(json_extract(ml.lot, '$.keeperBatchId') AS INTEGER), mp.pos, json_extract(s.value, '$.quantity')
      FROM merge_lots ml JOIN json_each(ml.lot, '$.dupStockBefore') s
      JOIN merge_pos mp ON mp.at = ml.at
     WHERE ml.how = 'fold') x
  WHERE x.lot_id IN (SELECT lot_id FROM cand_lots)
),
bad_lots AS MATERIALIZED (
  SELECT lot_id FROM (
    SELECT e.lot_id, SUM(e.qty) OVER (PARTITION BY e.lot_id ORDER BY e.pos, e.qty DESC ROWS UNBOUNDED PRECEDING) AS running,
      SUM(e.qty) OVER (PARTITION BY e.lot_id) AS total
    FROM ev e) w
  WHERE w.running < 0
     OR w.total <> COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = w.lot_id), 0)
  UNION
  SELECT lb.lot_id FROM lot_base lb
   WHERE NOT EXISTS (SELECT 1 FROM inventory_movements im WHERE im.batch_id = lb.lot_id)
     AND (lb.received_quantity > 0 OR COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = lb.lot_id), 0) <> 0)
),
weighted AS MATERIALIZED (
  SELECT ik,
    CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END AS w,
    SUM(qty) AS on_hand_units
  FROM (
    SELECT o.ik, CASE WHEN o.has_me = 1 AND o.lot_id <= o.me_baseline THEN o.me_cost ELSE o.cost_t END AS cost, o.q AS qty
    FROM (
      SELECT la.ik, la.lot_id, la.cost_t, la.has_me, la.me_cost, la.me_baseline, SUM(e.qty) AS q
        FROM lot_at la JOIN ev e ON e.lot_id = la.lot_id AND e.pos < la.pos
       WHERE la.active_t = 1
       GROUP BY la.ik, la.lot_id, la.cost_t, la.has_me, la.me_cost, la.me_baseline) o
    WHERE o.q > 0 AND (CASE WHEN o.has_me = 1 AND o.lot_id <= o.me_baseline THEN o.me_cost ELSE o.cost_t END) > 0)
  GROUP BY ik
),
lot_agg AS MATERIALIZED (
  SELECT ik,
    MAX(CASE WHEN active_t = 1 AND created <= t AND bad = 1 THEN 1 ELSE 0 END) AS unverified,
    MAX(CASE WHEN changed = 1 AND created <= t THEN 1 ELSE 0 END) AS lot_changed,
    MAX(CASE WHEN fb_rank = 1 AND eligible = 1 THEN cost_t END) AS fallback
  FROM (
    SELECT y.*, ROW_NUMBER() OVER (PARTITION BY y.ik, y.eligible ORDER BY y.received_at DESC, y.lot_id DESC) AS fb_rank
    FROM (
      SELECT la.*, bl.lot_id IS NOT NULL AS bad,
        CASE WHEN la.active_t = 1 AND la.cost_t > 0 AND la.created <= la.t AND (la.has_me = 0 OR la.lot_id > la.me_baseline)
          THEN 1 ELSE 0 END AS eligible
      FROM lot_at la LEFT JOIN bad_lots bl ON bl.lot_id = la.lot_id) y)
  GROUP BY ik
),
classified_items AS MATERIALIZED (
  SELECT g.*,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.h_match = 1 AND g.differs = 1 THEN 'after_window' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'needs_owner_review'
      WHEN g.h_match = 1 AND g.correct IS NULL THEN 'needs_owner_review'
      WHEN g.h_match = 1 AND g.unverified = 1 THEN 'ledger_unverified'
      WHEN g.h_match = 1 AND g.differs = 0 THEN 'already_correct'
      WHEN g.h_match = 1 AND g.kind = 'return' THEN 'returns_walk_in'
      WHEN g.h_match = 1 AND g.t >= g.fix_at THEN 'window'
      WHEN g.h_match = 1 THEN 'repair'
      WHEN g.differs = 0 THEN NULL
      WHEN g.n_match = 1 OR g.uncertain = 1 THEN 'needs_owner_review'
    END AS bucket,
    CASE
      WHEN g.t >= g.era_end THEN 'buggy_average_after_deploy_window'
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'sold_lot_belongs_to_another_product'
      WHEN g.h_match = 1 AND g.correct IS NULL THEN 'no_derivable_cost'
      WHEN g.h_match = 1 AND g.unverified = 1 THEN 'lot_ledger_does_not_reconcile'
      WHEN g.h_match = 1 AND g.differs = 0 THEN 'buggy_average_equalled_on_hand'
      WHEN g.h_match = 1 AND g.t >= g.fix_at THEN 'buggy_average_deploy_window'
      WHEN g.h_match = 1 THEN 'buggy_average'
      WHEN g.n_match = 1 THEN 'matches_only_todays_lot_state'
      ELSE 'lot_history_changed_after_sale'
    END AS reason
  FROM (
    SELECT f.*, CASE WHEN f.correct IS NULL OR ABS(f.recorded - f.correct) < 0.00005 THEN 0 ELSE 1 END AS differs
    FROM (
      SELECT m.kind, m.item_id, m.sale_id, m.return_id, m.product_now AS product_id, m.quantity, m.recorded, m.t, m.pos,
        m.fix_at, m.era_end, COALESCE(w.w, la.fallback) AS correct, COALESCE(w.on_hand_units, 0) AS on_hand_units,
        COALESCE(mt.h_match, 0) AS h_match, COALESCE(mt.n_match, 0) AS n_match, mt.buggy_mean_usd,
        COALESCE(la.unverified, 0) AS unverified, m.orphan,
        CASE WHEN m.moved = 1 OR m.me_moved = 1 OR COALESCE(la.lot_changed, 0) = 1 THEN 1 ELSE 0 END AS uncertain
      FROM item_me m LEFT JOIN weighted w ON w.ik = m.ik LEFT JOIN item_match mt ON mt.ik = m.ik
      LEFT JOIN lot_agg la ON la.ik = m.ik) f) g
),
linked AS MATERIALIZED (
  SELECT ri.id AS return_item_id, r.id AS return_id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd AS recorded,
    datetime(r.created_at) AS t, ri.sale_item_id IS NULL AS by_product,
    COUNT(*) AS n_affected,
    SUM(CASE WHEN c.bucket IN ('repair', 'window') THEN 1 ELSE 0 END) AS n_repaired,
    MIN(c.correct) AS min_correct, MAX(c.correct) AS max_correct, MIN(c.item_id) AS first_line_id,
    MAX(c.buggy_mean_usd) AS buggy_mean_usd,
    (SELECT COUNT(*) FROM sale_items s2 WHERE s2.sale_id = r.sale_id AND (s2.id = ri.sale_item_id
      OR (ri.sale_item_id IS NULL AND s2.product_id = ri.product_id
        AND (ri.branch_id IS NULL OR s2.branch_id IS NULL OR s2.branch_id = ri.branch_id)))) AS n_lines,
    NOT EXISTS (SELECT 1 FROM sale_items s2 WHERE s2.sale_id = r.sale_id AND (s2.id = ri.sale_item_id
      OR (ri.sale_item_id IS NULL AND s2.product_id = ri.product_id
        AND (ri.branch_id IS NULL OR s2.branch_id IS NULL OR s2.branch_id = ri.branch_id)))
      AND NOT (ABS(s2.cost_price_usd - ri.cost_price_usd) < 0.00006)) AS all_equal
  FROM classified_items c
  JOIN sale_items sc ON sc.id = c.item_id
  JOIN returns r ON r.sale_id = c.sale_id
  JOIN return_items ri ON ri.return_id = r.id AND ri.cost_price_usd IS NOT NULL
   AND (ri.sale_item_id = c.item_id OR (ri.sale_item_id IS NULL AND ri.product_id = sc.product_id
     AND (ri.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = ri.branch_id)))
  WHERE c.kind = 'sale' AND c.bucket IN ('repair', 'window', 'ledger_unverified', 'needs_owner_review')
  GROUP BY ri.id, r.id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd, r.created_at, ri.sale_item_id, ri.branch_id
),
classified AS MATERIALIZED (
  SELECT kind, item_id, sale_id, return_id, product_id, quantity, recorded, correct, buggy_mean_usd, pos, on_hand_units, t, bucket, reason
    FROM classified_items WHERE bucket IS NOT NULL
  UNION ALL
  SELECT 'return', l.return_item_id, l.sale_id, l.return_id, l.product_id, l.quantity, l.recorded,
    COALESCE((SELECT c2.correct FROM classified_items c2 WHERE c2.kind = 'sale' AND c2.item_id = l.first_line_id), l.min_correct),
    l.buggy_mean_usd, NULL, NULL, l.t,
    CASE WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct THEN 'returns_sale_linked' ELSE 'needs_owner_review' END,
    CASE WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct
           THEN CASE WHEN l.by_product = 1 THEN 'copied_from_sale_line_by_product' ELSE 'copied_from_sale_line' END
         WHEN l.n_repaired = l.n_lines THEN 'sale_lines_of_product_now_differ'
         ELSE 'follows_unrepaired_sale_line' END
  FROM linked l WHERE l.all_equal = 1
)
-- plan:stop
SELECT b.value AS bucket, COUNT(c.kind) AS lines, ROUND(COALESCE(SUM(c.quantity), 0), 4) AS units,
  ROUND(COALESCE(SUM(c.quantity * (c.correct - c.recorded)), 0), 4) AS cost_delta_usd
FROM json_each('["repair","window","returns_sale_linked","returns_walk_in","ledger_unverified","needs_owner_review","after_window","already_correct"]') b
LEFT JOIN classified c ON c.bucket = b.value
GROUP BY b.key, b.value ORDER BY b.key;

-- 2. Every listed line with its sale or return (row-level: encrypted ops export only).
-- plan:begin
WITH
params AS MATERIALIZED (
  SELECT fx AS fix_at,
    COALESCE(datetime(fx, '+2 hours'), '9999-12-31 23:59:59') AS era_end,
    COALESCE(datetime(fx, '+7 days'), '9999-12-31 23:59:59') AS scan_end
  FROM (SELECT COALESCE(MIN(datetime(created_at)), '9999-12-31 23:59:59') AS fx FROM catalog_cost_repair_0195_backup)
),
merge_rev AS MATERIALIZED (
  SELECT us.id * 1000000 AS ord, datetime(us.created_at) AS at, us.payload_json AS rev
    FROM undo_snapshots us
   WHERE us.kind IN ('product.merge', 'product.merge.group.child') AND us.status <> 'reversed'
     AND datetime(us.created_at) >= '2026-09-16 14:04:42' AND json_valid(us.payload_json)
  UNION ALL
  SELECT us.id * 1000000 + r.key, datetime(us.created_at), r.value
    FROM undo_snapshots us
    JOIN json_each(CASE WHEN json_valid(us.payload_json) THEN us.payload_json ELSE '{}' END, '$.reversals') r
   WHERE us.kind = 'product.merge.bulk' AND us.status <> 'reversed' AND datetime(us.created_at) >= '2026-09-16 14:04:42'
),
row_move AS MATERIALIZED (
  SELECT 'sale_items' AS tbl, CAST(i.value AS INTEGER) AS row_id, CAST(json_extract(m.rev, '$.dupId') AS INTEGER) AS dup_id, m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.reparentedSaleItemIds') i
  UNION
  SELECT json_extract(t.value, '$.table'), CAST(i.value AS INTEGER), CAST(json_extract(m.rev, '$.dupId') AS INTEGER), m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.reparentedByTable') t JOIN json_each(t.value, '$.ids') i
   WHERE json_extract(t.value, '$.table') IN ('sale_items', 'return_items', 'product_cost_entries')
  UNION
  SELECT 'product_batches', CAST(json_extract(b.value, '$.id') AS INTEGER), CAST(json_extract(m.rev, '$.dupId') AS INTEGER), m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.repointedBatches') b
),
merge_lots AS MATERIALIZED (
  SELECT m.at, m.ord, 'fold' AS how, f.value AS lot
    FROM merge_rev m JOIN json_each(m.rev, '$.foldedBatches') f
  UNION ALL
  SELECT m.at, m.ord, 'write_off', w.value
    FROM merge_rev m JOIN json_each(m.rev, '$.writtenOffBatches') w
),
merge_pos AS MATERIALIZED (
  SELECT m2.at, COALESCE((SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= m2.at),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im)) - 0.5 AS pos
  FROM (SELECT DISTINCT at FROM merge_lots) m2
),
lot_edit AS MATERIALIZED (
  SELECT a.id, CAST(a.entity_id AS INTEGER) AS lot_id, datetime(a.created_at) AS at,
    CAST(json_extract(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') AS REAL) AS cost
  FROM audit_logs a
  WHERE a.action = 'batch_update' AND a.entity = 'product_batch'
    AND json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') IS NOT NULL
),
sale_lines AS MATERIALIZED (
  SELECT si.id AS item_id, si.sale_id, si.product_id AS product_now, si.quantity, si.cost_price_usd AS recorded,
    datetime(s.created_at) AS sale_at
  FROM sale_items si JOIN sales s ON s.id = si.sale_id
  WHERE si.product_id IS NOT NULL AND si.cost_price_usd > 0 AND datetime(s.created_at) >= '2026-09-16 14:04:42'
  UNION
  SELECT si.id, si.sale_id, si.product_id, si.quantity, si.cost_price_usd, datetime(s.created_at)
  FROM inventory_movements im
  JOIN sale_items si ON si.sale_id = im.reference_id AND si.product_id = im.product_id
  JOIN sales s ON s.id = si.sale_id
  WHERE im.movement_type = 'sale' AND im.created_at >= '2026-09-16 14:04:42'
    AND si.cost_price_usd > 0 AND datetime(s.created_at) < '2026-09-16 14:04:42'
),
items AS MATERIALIZED (
  SELECT 'sale' AS kind, sm.item_id AS ik, sm.item_id, sm.sale_id, NULL AS return_id, sm.product_now, sm.quantity, sm.recorded,
    COALESCE((SELECT datetime(im.created_at) FROM inventory_movements im WHERE im.id = COALESCE(sm.mv_id, sm.mv_any)), sm.sale_at) AS t,
    COALESCE(sm.mv_id, sm.mv_any,
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= sm.sale_at),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im)) AS pos
  FROM (SELECT sl.*,
      (SELECT MIN(im.id) FROM inventory_movements im
        WHERE im.reference_id = sl.sale_id AND im.movement_type = 'sale' AND im.product_id = sl.product_now
          AND im.unit_cost_usd IS NOT NULL AND ABS(im.unit_cost_usd - sl.recorded) < 0.00006) AS mv_id,
      (SELECT MIN(im.id) FROM inventory_movements im
        WHERE im.reference_id = sl.sale_id AND im.movement_type = 'sale' AND im.product_id = sl.product_now) AS mv_any
    FROM sale_lines sl) sm
  UNION ALL
  SELECT 'return', -ri.id, ri.id, NULL, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at),
    COALESCE((SELECT MIN(im.id) FROM inventory_movements im WHERE im.reference_id = r.id AND im.movement_type = 'return'),
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= datetime(r.created_at)),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im))
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  WHERE r.sale_id IS NULL AND COALESCE(r.return_scope, 'customer') = 'customer' AND ri.sale_item_id IS NULL
    AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0 AND datetime(r.created_at) >= '2026-09-16 14:04:42'
),
item_ctx AS MATERIALIZED (
  SELECT x.*,
    CASE WHEN x.lot_owner <> COALESCE(x.moved_dup, x.product_now) THEN x.lot_owner ELSE COALESCE(x.moved_dup, x.product_now) END AS prod_at,
    x.moved_dup IS NOT NULL AS moved, COALESCE(x.lot_owner <> COALESCE(x.moved_dup, x.product_now), 0) AS orphan
  FROM (SELECT it.*, p.fix_at, p.era_end,
      (SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = pb.id AND rm.at > it.t
          ORDER BY rm.ord LIMIT 1), pb.variant_product_id)
        FROM product_batches pb
       WHERE pb.id = CASE it.kind WHEN 'sale' THEN (SELECT si.batch_id FROM sale_items si WHERE si.id = it.item_id)
         ELSE (SELECT ri.batch_id FROM return_items ri WHERE ri.id = it.item_id) END) AS lot_owner,
      (SELECT rm.dup_id FROM row_move rm
        WHERE rm.tbl = CASE it.kind WHEN 'sale' THEN 'sale_items' ELSE 'return_items' END
          AND rm.row_id = it.item_id AND rm.at > it.t ORDER BY rm.ord LIMIT 1) AS moved_dup
    FROM items it JOIN params p
    WHERE it.t >= '2026-09-16 14:04:42' AND it.t < p.scan_end) x
),
pce_at AS MATERIALIZED (
  SELECT ic.ik, pce.id, pce.cost_usd, pce.baseline_batch_id
    FROM item_ctx ic JOIN product_cost_entries pce ON pce.product_id = ic.prod_at
   WHERE datetime(pce.created_at) <= ic.t
     AND NOT EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pce.id AND rm.at > ic.t)
  UNION
  SELECT ic.ik, pce.id, pce.cost_usd, pce.baseline_batch_id
    FROM item_ctx ic
    JOIN row_move rm ON rm.tbl = 'product_cost_entries' AND rm.dup_id = ic.prod_at AND rm.at > ic.t
    JOIN product_cost_entries pce ON pce.id = rm.row_id
   WHERE datetime(pce.created_at) <= ic.t
     AND NOT EXISTS (SELECT 1 FROM row_move r2 WHERE r2.tbl = 'product_cost_entries' AND r2.row_id = rm.row_id
       AND r2.at > ic.t AND r2.ord < rm.ord)
),
pce_top AS MATERIALIZED (
  SELECT ik, cost_usd, baseline_batch_id FROM (
    SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.ik ORDER BY x.id DESC) AS rn FROM pce_at x)
  WHERE rn = 1
),
item_me AS MATERIALIZED (
  SELECT ic.*,
    pt.ik IS NOT NULL AS has_me, pt.cost_usd AS me_cost, COALESCE(pt.baseline_batch_id, 0) AS me_baseline,
    EXISTS (SELECT 1 FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t) AS now_has_me,
    (SELECT pce.cost_usd FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t ORDER BY pce.id DESC LIMIT 1) AS now_me_cost,
    COALESCE((SELECT pce.baseline_batch_id FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t ORDER BY pce.id DESC LIMIT 1), 0) AS now_me_baseline,
    EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = ic.prod_at AND rm.at > ic.t) AS me_moved
  FROM item_ctx ic LEFT JOIN pce_top pt ON pt.ik = ic.ik
),
item_lot AS MATERIALIZED (
  SELECT m.ik, pb.id AS lot_id
    FROM item_me m JOIN product_batches pb ON pb.variant_product_id = m.prod_at
   WHERE NOT EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = pb.id AND rm.at > m.t)
  UNION
  SELECT m.ik, rm.row_id
    FROM item_me m JOIN row_move rm ON rm.tbl = 'product_batches' AND rm.dup_id = m.prod_at AND rm.at > m.t
   WHERE NOT EXISTS (SELECT 1 FROM row_move r2 WHERE r2.tbl = 'product_batches' AND r2.row_id = rm.row_id
       AND r2.at > m.t AND r2.ord < rm.ord)
),
lot_base AS MATERIALIZED (
  SELECT pb.id AS lot_id, pb.is_active, pb.unit_cost_usd AS cost_now, datetime(pb.updated_at) AS updated_at,
    datetime(COALESCE(pb.created_at, pb.received_at)) AS created, COALESCE(pb.received_at, '') AS received_at,
    COALESCE(pb.received_quantity, 0) AS received_quantity,
    (SELECT im.unit_cost_usd FROM inventory_movements im
      WHERE im.batch_id = pb.id AND im.quantity > 0 AND im.unit_cost_usd > 0 ORDER BY im.id LIMIT 1) AS receipt_cost,
    (SELECT MAX(le.at) FROM lot_edit le WHERE le.lot_id = pb.id) AS last_edit_at
  FROM product_batches pb WHERE pb.id IN (SELECT lot_id FROM item_lot)
),
lot_at AS MATERIALIZED (
  SELECT il.ik, il.lot_id, m.t, m.pos, m.has_me, m.me_cost, m.me_baseline, lb.created, lb.received_at,
    CASE WHEN lb.is_active = 1 OR lb.updated_at > m.t THEN 1 ELSE 0 END AS active_t,
    COALESCE(
      (SELECT le.cost FROM lot_edit le WHERE le.lot_id = il.lot_id AND le.at <= m.t ORDER BY le.id DESC LIMIT 1),
      CASE WHEN lb.last_edit_at > m.t THEN COALESCE(lb.receipt_cost, lb.cost_now)
           WHEN lb.updated_at > m.t AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005
             THEN lb.receipt_cost END,
      lb.cost_now) AS cost_t,
    CASE WHEN (COALESCE(lb.is_active, 0) <> 1 AND lb.updated_at > m.t)
      OR lb.last_edit_at > m.t
      OR (lb.updated_at > m.t AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005)
      OR EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = il.lot_id AND rm.at > m.t)
    THEN 1 ELSE 0 END AS changed
  FROM item_lot il JOIN item_me m ON m.ik = il.ik JOIN lot_base lb ON lb.lot_id = il.lot_id
),
bset AS MATERIALIZED (
  SELECT la.ik, 'h' AS v, la.cost_t AS cost
    FROM lot_at la
   WHERE la.active_t = 1 AND la.cost_t > 0 AND la.created <= la.t AND (la.has_me = 0 OR la.lot_id > la.me_baseline)
  UNION
  SELECT m.ik, 'h', m.me_cost FROM item_me m WHERE m.has_me = 1 AND m.me_cost > 0
  UNION
  SELECT m.ik, 'n', pb.unit_cost_usd
    FROM item_me m JOIN product_batches pb ON pb.variant_product_id = m.product_now
   WHERE pb.is_active = 1 AND pb.unit_cost_usd > 0
     AND datetime(COALESCE(pb.created_at, pb.received_at)) <= m.t
     AND (m.now_has_me = 0 OR pb.id > m.now_me_baseline)
  UNION
  SELECT m.ik, 'n', m.now_me_cost FROM item_me m WHERE m.now_has_me = 1 AND m.now_me_cost > 0
),
item_match AS MATERIALIZED (
  SELECT m.ik,
    MAX(CASE WHEN b.v = 'h' AND (ABS(m.recorded - b.b1) < 0.00006 OR ABS(m.recorded - b.b1h) < 0.00006 OR ABS(m.recorded - b.b2) < 0.00006) THEN 1 ELSE 0 END) AS h_match,
    MAX(CASE WHEN b.v = 'n' AND (ABS(m.recorded - b.b1) < 0.00006 OR ABS(m.recorded - b.b1h) < 0.00006 OR ABS(m.recorded - b.b2) < 0.00006) THEN 1 ELSE 0 END) AS n_match,
    MAX(CASE WHEN b.v = 'h' THEN b.b1 END) AS buggy_mean_usd
  FROM item_me m JOIN (
    SELECT ik, v,
      ROUND(AVG(cost), 4) AS b1,
      CAST(AVG(cost) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
      CASE WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost) ELSE ROUND(AVG(cost), 4) END AS b2
    FROM bset GROUP BY ik, v) b ON b.ik = m.ik
  GROUP BY m.ik
),
cand_lots AS MATERIALIZED (
  SELECT lot_id FROM lot_base
),
ev AS MATERIALIZED (
  SELECT im.batch_id AS lot_id, im.id AS pos, im.quantity AS qty
    FROM inventory_movements im WHERE im.batch_id IN (SELECT lot_id FROM cand_lots)
  UNION ALL
  SELECT x.lot_id, x.pos, -x.q FROM (
    SELECT COALESCE((SELECT CAST(json_extract(ml.lot, '$.dupBatchId') AS INTEGER) FROM merge_lots ml JOIN json_each(ml.lot, '$.saleAllocationIds') ai
          WHERE ml.how = 'fold' AND CAST(ai.value AS INTEGER) = a.id ORDER BY ml.ord LIMIT 1), a.batch_id) AS lot_id,
      a.quantity - COALESCE(a.released_quantity, 0) AS q,
      (SELECT MIN(im.id) FROM sale_items si JOIN inventory_movements im
          ON im.reference_id = si.sale_id AND im.movement_type = 'sale' AND im.product_id = si.product_id AND im.batch_id IS NULL
        WHERE si.id = a.sale_item_id) AS pos
    FROM sale_item_batch_allocations a) x
  WHERE x.pos IS NOT NULL AND x.lot_id IN (SELECT lot_id FROM cand_lots)
  UNION ALL
  SELECT x.lot_id, x.pos, x.qty FROM (
    SELECT CAST(json_extract(ml.lot, CASE ml.how WHEN 'fold' THEN '$.dupBatchId' ELSE '$.batchId' END) AS INTEGER) AS lot_id,
      mp.pos, -json_extract(s.value, '$.quantity') AS qty
      FROM merge_lots ml JOIN json_each(ml.lot, CASE ml.how WHEN 'fold' THEN '$.dupStockBefore' ELSE '$.stockBefore' END) s
      JOIN merge_pos mp ON mp.at = ml.at
    UNION ALL
    SELECT CAST(json_extract(ml.lot, '$.keeperBatchId') AS INTEGER), mp.pos, json_extract(s.value, '$.quantity')
      FROM merge_lots ml JOIN json_each(ml.lot, '$.dupStockBefore') s
      JOIN merge_pos mp ON mp.at = ml.at
     WHERE ml.how = 'fold') x
  WHERE x.lot_id IN (SELECT lot_id FROM cand_lots)
),
bad_lots AS MATERIALIZED (
  SELECT lot_id FROM (
    SELECT e.lot_id, SUM(e.qty) OVER (PARTITION BY e.lot_id ORDER BY e.pos, e.qty DESC ROWS UNBOUNDED PRECEDING) AS running,
      SUM(e.qty) OVER (PARTITION BY e.lot_id) AS total
    FROM ev e) w
  WHERE w.running < 0
     OR w.total <> COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = w.lot_id), 0)
  UNION
  SELECT lb.lot_id FROM lot_base lb
   WHERE NOT EXISTS (SELECT 1 FROM inventory_movements im WHERE im.batch_id = lb.lot_id)
     AND (lb.received_quantity > 0 OR COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = lb.lot_id), 0) <> 0)
),
weighted AS MATERIALIZED (
  SELECT ik,
    CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END AS w,
    SUM(qty) AS on_hand_units
  FROM (
    SELECT o.ik, CASE WHEN o.has_me = 1 AND o.lot_id <= o.me_baseline THEN o.me_cost ELSE o.cost_t END AS cost, o.q AS qty
    FROM (
      SELECT la.ik, la.lot_id, la.cost_t, la.has_me, la.me_cost, la.me_baseline, SUM(e.qty) AS q
        FROM lot_at la JOIN ev e ON e.lot_id = la.lot_id AND e.pos < la.pos
       WHERE la.active_t = 1
       GROUP BY la.ik, la.lot_id, la.cost_t, la.has_me, la.me_cost, la.me_baseline) o
    WHERE o.q > 0 AND (CASE WHEN o.has_me = 1 AND o.lot_id <= o.me_baseline THEN o.me_cost ELSE o.cost_t END) > 0)
  GROUP BY ik
),
lot_agg AS MATERIALIZED (
  SELECT ik,
    MAX(CASE WHEN active_t = 1 AND created <= t AND bad = 1 THEN 1 ELSE 0 END) AS unverified,
    MAX(CASE WHEN changed = 1 AND created <= t THEN 1 ELSE 0 END) AS lot_changed,
    MAX(CASE WHEN fb_rank = 1 AND eligible = 1 THEN cost_t END) AS fallback
  FROM (
    SELECT y.*, ROW_NUMBER() OVER (PARTITION BY y.ik, y.eligible ORDER BY y.received_at DESC, y.lot_id DESC) AS fb_rank
    FROM (
      SELECT la.*, bl.lot_id IS NOT NULL AS bad,
        CASE WHEN la.active_t = 1 AND la.cost_t > 0 AND la.created <= la.t AND (la.has_me = 0 OR la.lot_id > la.me_baseline)
          THEN 1 ELSE 0 END AS eligible
      FROM lot_at la LEFT JOIN bad_lots bl ON bl.lot_id = la.lot_id) y)
  GROUP BY ik
),
classified_items AS MATERIALIZED (
  SELECT g.*,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.h_match = 1 AND g.differs = 1 THEN 'after_window' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'needs_owner_review'
      WHEN g.h_match = 1 AND g.correct IS NULL THEN 'needs_owner_review'
      WHEN g.h_match = 1 AND g.unverified = 1 THEN 'ledger_unverified'
      WHEN g.h_match = 1 AND g.differs = 0 THEN 'already_correct'
      WHEN g.h_match = 1 AND g.kind = 'return' THEN 'returns_walk_in'
      WHEN g.h_match = 1 AND g.t >= g.fix_at THEN 'window'
      WHEN g.h_match = 1 THEN 'repair'
      WHEN g.differs = 0 THEN NULL
      WHEN g.n_match = 1 OR g.uncertain = 1 THEN 'needs_owner_review'
    END AS bucket,
    CASE
      WHEN g.t >= g.era_end THEN 'buggy_average_after_deploy_window'
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'sold_lot_belongs_to_another_product'
      WHEN g.h_match = 1 AND g.correct IS NULL THEN 'no_derivable_cost'
      WHEN g.h_match = 1 AND g.unverified = 1 THEN 'lot_ledger_does_not_reconcile'
      WHEN g.h_match = 1 AND g.differs = 0 THEN 'buggy_average_equalled_on_hand'
      WHEN g.h_match = 1 AND g.t >= g.fix_at THEN 'buggy_average_deploy_window'
      WHEN g.h_match = 1 THEN 'buggy_average'
      WHEN g.n_match = 1 THEN 'matches_only_todays_lot_state'
      ELSE 'lot_history_changed_after_sale'
    END AS reason
  FROM (
    SELECT f.*, CASE WHEN f.correct IS NULL OR ABS(f.recorded - f.correct) < 0.00005 THEN 0 ELSE 1 END AS differs
    FROM (
      SELECT m.kind, m.item_id, m.sale_id, m.return_id, m.product_now AS product_id, m.quantity, m.recorded, m.t, m.pos,
        m.fix_at, m.era_end, COALESCE(w.w, la.fallback) AS correct, COALESCE(w.on_hand_units, 0) AS on_hand_units,
        COALESCE(mt.h_match, 0) AS h_match, COALESCE(mt.n_match, 0) AS n_match, mt.buggy_mean_usd,
        COALESCE(la.unverified, 0) AS unverified, m.orphan,
        CASE WHEN m.moved = 1 OR m.me_moved = 1 OR COALESCE(la.lot_changed, 0) = 1 THEN 1 ELSE 0 END AS uncertain
      FROM item_me m LEFT JOIN weighted w ON w.ik = m.ik LEFT JOIN item_match mt ON mt.ik = m.ik
      LEFT JOIN lot_agg la ON la.ik = m.ik) f) g
),
linked AS MATERIALIZED (
  SELECT ri.id AS return_item_id, r.id AS return_id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd AS recorded,
    datetime(r.created_at) AS t, ri.sale_item_id IS NULL AS by_product,
    COUNT(*) AS n_affected,
    SUM(CASE WHEN c.bucket IN ('repair', 'window') THEN 1 ELSE 0 END) AS n_repaired,
    MIN(c.correct) AS min_correct, MAX(c.correct) AS max_correct, MIN(c.item_id) AS first_line_id,
    MAX(c.buggy_mean_usd) AS buggy_mean_usd,
    (SELECT COUNT(*) FROM sale_items s2 WHERE s2.sale_id = r.sale_id AND (s2.id = ri.sale_item_id
      OR (ri.sale_item_id IS NULL AND s2.product_id = ri.product_id
        AND (ri.branch_id IS NULL OR s2.branch_id IS NULL OR s2.branch_id = ri.branch_id)))) AS n_lines,
    NOT EXISTS (SELECT 1 FROM sale_items s2 WHERE s2.sale_id = r.sale_id AND (s2.id = ri.sale_item_id
      OR (ri.sale_item_id IS NULL AND s2.product_id = ri.product_id
        AND (ri.branch_id IS NULL OR s2.branch_id IS NULL OR s2.branch_id = ri.branch_id)))
      AND NOT (ABS(s2.cost_price_usd - ri.cost_price_usd) < 0.00006)) AS all_equal
  FROM classified_items c
  JOIN sale_items sc ON sc.id = c.item_id
  JOIN returns r ON r.sale_id = c.sale_id
  JOIN return_items ri ON ri.return_id = r.id AND ri.cost_price_usd IS NOT NULL
   AND (ri.sale_item_id = c.item_id OR (ri.sale_item_id IS NULL AND ri.product_id = sc.product_id
     AND (ri.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = ri.branch_id)))
  WHERE c.kind = 'sale' AND c.bucket IN ('repair', 'window', 'ledger_unverified', 'needs_owner_review')
  GROUP BY ri.id, r.id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd, r.created_at, ri.sale_item_id, ri.branch_id
),
classified AS MATERIALIZED (
  SELECT kind, item_id, sale_id, return_id, product_id, quantity, recorded, correct, buggy_mean_usd, pos, on_hand_units, t, bucket, reason
    FROM classified_items WHERE bucket IS NOT NULL
  UNION ALL
  SELECT 'return', l.return_item_id, l.sale_id, l.return_id, l.product_id, l.quantity, l.recorded,
    COALESCE((SELECT c2.correct FROM classified_items c2 WHERE c2.kind = 'sale' AND c2.item_id = l.first_line_id), l.min_correct),
    l.buggy_mean_usd, NULL, NULL, l.t,
    CASE WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct THEN 'returns_sale_linked' ELSE 'needs_owner_review' END,
    CASE WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct
           THEN CASE WHEN l.by_product = 1 THEN 'copied_from_sale_line_by_product' ELSE 'copied_from_sale_line' END
         WHEN l.n_repaired = l.n_lines THEN 'sale_lines_of_product_now_differ'
         ELSE 'follows_unrepaired_sale_line' END
  FROM linked l WHERE l.all_equal = 1
)
-- plan:stop
SELECT c.kind, c.bucket, c.reason, c.item_id, c.sale_id, s.receipt_number, c.return_id, r.return_number, c.t AS line_at,
  c.product_id, c.quantity, c.recorded AS recorded_cost_usd, c.buggy_mean_usd, c.correct AS correct_cost_usd, c.on_hand_units,
  ROUND(c.quantity * (c.correct - c.recorded), 4) AS cost_delta_usd
FROM classified c LEFT JOIN sales s ON s.id = c.sale_id LEFT JOIN returns r ON r.id = c.return_id
ORDER BY c.bucket, c.t, c.kind, c.item_id;

-- 3. Report effect of the rewritten buckets: COGS on recognized (not cancelled)
--    sales, and the restocked-return cost that COGS subtracts.
-- plan:begin
WITH
params AS MATERIALIZED (
  SELECT fx AS fix_at,
    COALESCE(datetime(fx, '+2 hours'), '9999-12-31 23:59:59') AS era_end,
    COALESCE(datetime(fx, '+7 days'), '9999-12-31 23:59:59') AS scan_end
  FROM (SELECT COALESCE(MIN(datetime(created_at)), '9999-12-31 23:59:59') AS fx FROM catalog_cost_repair_0195_backup)
),
merge_rev AS MATERIALIZED (
  SELECT us.id * 1000000 AS ord, datetime(us.created_at) AS at, us.payload_json AS rev
    FROM undo_snapshots us
   WHERE us.kind IN ('product.merge', 'product.merge.group.child') AND us.status <> 'reversed'
     AND datetime(us.created_at) >= '2026-09-16 14:04:42' AND json_valid(us.payload_json)
  UNION ALL
  SELECT us.id * 1000000 + r.key, datetime(us.created_at), r.value
    FROM undo_snapshots us
    JOIN json_each(CASE WHEN json_valid(us.payload_json) THEN us.payload_json ELSE '{}' END, '$.reversals') r
   WHERE us.kind = 'product.merge.bulk' AND us.status <> 'reversed' AND datetime(us.created_at) >= '2026-09-16 14:04:42'
),
row_move AS MATERIALIZED (
  SELECT 'sale_items' AS tbl, CAST(i.value AS INTEGER) AS row_id, CAST(json_extract(m.rev, '$.dupId') AS INTEGER) AS dup_id, m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.reparentedSaleItemIds') i
  UNION
  SELECT json_extract(t.value, '$.table'), CAST(i.value AS INTEGER), CAST(json_extract(m.rev, '$.dupId') AS INTEGER), m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.reparentedByTable') t JOIN json_each(t.value, '$.ids') i
   WHERE json_extract(t.value, '$.table') IN ('sale_items', 'return_items', 'product_cost_entries')
  UNION
  SELECT 'product_batches', CAST(json_extract(b.value, '$.id') AS INTEGER), CAST(json_extract(m.rev, '$.dupId') AS INTEGER), m.at, m.ord
    FROM merge_rev m JOIN json_each(m.rev, '$.repointedBatches') b
),
merge_lots AS MATERIALIZED (
  SELECT m.at, m.ord, 'fold' AS how, f.value AS lot
    FROM merge_rev m JOIN json_each(m.rev, '$.foldedBatches') f
  UNION ALL
  SELECT m.at, m.ord, 'write_off', w.value
    FROM merge_rev m JOIN json_each(m.rev, '$.writtenOffBatches') w
),
merge_pos AS MATERIALIZED (
  SELECT m2.at, COALESCE((SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= m2.at),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im)) - 0.5 AS pos
  FROM (SELECT DISTINCT at FROM merge_lots) m2
),
lot_edit AS MATERIALIZED (
  SELECT a.id, CAST(a.entity_id AS INTEGER) AS lot_id, datetime(a.created_at) AS at,
    CAST(json_extract(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') AS REAL) AS cost
  FROM audit_logs a
  WHERE a.action = 'batch_update' AND a.entity = 'product_batch'
    AND json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') IS NOT NULL
),
sale_lines AS MATERIALIZED (
  SELECT si.id AS item_id, si.sale_id, si.product_id AS product_now, si.quantity, si.cost_price_usd AS recorded,
    datetime(s.created_at) AS sale_at
  FROM sale_items si JOIN sales s ON s.id = si.sale_id
  WHERE si.product_id IS NOT NULL AND si.cost_price_usd > 0 AND datetime(s.created_at) >= '2026-09-16 14:04:42'
  UNION
  SELECT si.id, si.sale_id, si.product_id, si.quantity, si.cost_price_usd, datetime(s.created_at)
  FROM inventory_movements im
  JOIN sale_items si ON si.sale_id = im.reference_id AND si.product_id = im.product_id
  JOIN sales s ON s.id = si.sale_id
  WHERE im.movement_type = 'sale' AND im.created_at >= '2026-09-16 14:04:42'
    AND si.cost_price_usd > 0 AND datetime(s.created_at) < '2026-09-16 14:04:42'
),
items AS MATERIALIZED (
  SELECT 'sale' AS kind, sm.item_id AS ik, sm.item_id, sm.sale_id, NULL AS return_id, sm.product_now, sm.quantity, sm.recorded,
    COALESCE((SELECT datetime(im.created_at) FROM inventory_movements im WHERE im.id = COALESCE(sm.mv_id, sm.mv_any)), sm.sale_at) AS t,
    COALESCE(sm.mv_id, sm.mv_any,
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= sm.sale_at),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im)) AS pos
  FROM (SELECT sl.*,
      (SELECT MIN(im.id) FROM inventory_movements im
        WHERE im.reference_id = sl.sale_id AND im.movement_type = 'sale' AND im.product_id = sl.product_now
          AND im.unit_cost_usd IS NOT NULL AND ABS(im.unit_cost_usd - sl.recorded) < 0.00006) AS mv_id,
      (SELECT MIN(im.id) FROM inventory_movements im
        WHERE im.reference_id = sl.sale_id AND im.movement_type = 'sale' AND im.product_id = sl.product_now) AS mv_any
    FROM sale_lines sl) sm
  UNION ALL
  SELECT 'return', -ri.id, ri.id, NULL, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at),
    COALESCE((SELECT MIN(im.id) FROM inventory_movements im WHERE im.reference_id = r.id AND im.movement_type = 'return'),
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= datetime(r.created_at)),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im))
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  WHERE r.sale_id IS NULL AND COALESCE(r.return_scope, 'customer') = 'customer' AND ri.sale_item_id IS NULL
    AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0 AND datetime(r.created_at) >= '2026-09-16 14:04:42'
),
item_ctx AS MATERIALIZED (
  SELECT x.*,
    CASE WHEN x.lot_owner <> COALESCE(x.moved_dup, x.product_now) THEN x.lot_owner ELSE COALESCE(x.moved_dup, x.product_now) END AS prod_at,
    x.moved_dup IS NOT NULL AS moved, COALESCE(x.lot_owner <> COALESCE(x.moved_dup, x.product_now), 0) AS orphan
  FROM (SELECT it.*, p.fix_at, p.era_end,
      (SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = pb.id AND rm.at > it.t
          ORDER BY rm.ord LIMIT 1), pb.variant_product_id)
        FROM product_batches pb
       WHERE pb.id = CASE it.kind WHEN 'sale' THEN (SELECT si.batch_id FROM sale_items si WHERE si.id = it.item_id)
         ELSE (SELECT ri.batch_id FROM return_items ri WHERE ri.id = it.item_id) END) AS lot_owner,
      (SELECT rm.dup_id FROM row_move rm
        WHERE rm.tbl = CASE it.kind WHEN 'sale' THEN 'sale_items' ELSE 'return_items' END
          AND rm.row_id = it.item_id AND rm.at > it.t ORDER BY rm.ord LIMIT 1) AS moved_dup
    FROM items it JOIN params p
    WHERE it.t >= '2026-09-16 14:04:42' AND it.t < p.scan_end) x
),
pce_at AS MATERIALIZED (
  SELECT ic.ik, pce.id, pce.cost_usd, pce.baseline_batch_id
    FROM item_ctx ic JOIN product_cost_entries pce ON pce.product_id = ic.prod_at
   WHERE datetime(pce.created_at) <= ic.t
     AND NOT EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pce.id AND rm.at > ic.t)
  UNION
  SELECT ic.ik, pce.id, pce.cost_usd, pce.baseline_batch_id
    FROM item_ctx ic
    JOIN row_move rm ON rm.tbl = 'product_cost_entries' AND rm.dup_id = ic.prod_at AND rm.at > ic.t
    JOIN product_cost_entries pce ON pce.id = rm.row_id
   WHERE datetime(pce.created_at) <= ic.t
     AND NOT EXISTS (SELECT 1 FROM row_move r2 WHERE r2.tbl = 'product_cost_entries' AND r2.row_id = rm.row_id
       AND r2.at > ic.t AND r2.ord < rm.ord)
),
pce_top AS MATERIALIZED (
  SELECT ik, cost_usd, baseline_batch_id FROM (
    SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.ik ORDER BY x.id DESC) AS rn FROM pce_at x)
  WHERE rn = 1
),
item_me AS MATERIALIZED (
  SELECT ic.*,
    pt.ik IS NOT NULL AS has_me, pt.cost_usd AS me_cost, COALESCE(pt.baseline_batch_id, 0) AS me_baseline,
    EXISTS (SELECT 1 FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t) AS now_has_me,
    (SELECT pce.cost_usd FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t ORDER BY pce.id DESC LIMIT 1) AS now_me_cost,
    COALESCE((SELECT pce.baseline_batch_id FROM product_cost_entries pce
      WHERE pce.product_id = ic.product_now AND datetime(pce.created_at) <= ic.t ORDER BY pce.id DESC LIMIT 1), 0) AS now_me_baseline,
    EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = ic.prod_at AND rm.at > ic.t) AS me_moved
  FROM item_ctx ic LEFT JOIN pce_top pt ON pt.ik = ic.ik
),
item_lot AS MATERIALIZED (
  SELECT m.ik, pb.id AS lot_id
    FROM item_me m JOIN product_batches pb ON pb.variant_product_id = m.prod_at
   WHERE NOT EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = pb.id AND rm.at > m.t)
  UNION
  SELECT m.ik, rm.row_id
    FROM item_me m JOIN row_move rm ON rm.tbl = 'product_batches' AND rm.dup_id = m.prod_at AND rm.at > m.t
   WHERE NOT EXISTS (SELECT 1 FROM row_move r2 WHERE r2.tbl = 'product_batches' AND r2.row_id = rm.row_id
       AND r2.at > m.t AND r2.ord < rm.ord)
),
lot_base AS MATERIALIZED (
  SELECT pb.id AS lot_id, pb.is_active, pb.unit_cost_usd AS cost_now, datetime(pb.updated_at) AS updated_at,
    datetime(COALESCE(pb.created_at, pb.received_at)) AS created, COALESCE(pb.received_at, '') AS received_at,
    COALESCE(pb.received_quantity, 0) AS received_quantity,
    (SELECT im.unit_cost_usd FROM inventory_movements im
      WHERE im.batch_id = pb.id AND im.quantity > 0 AND im.unit_cost_usd > 0 ORDER BY im.id LIMIT 1) AS receipt_cost,
    (SELECT MAX(le.at) FROM lot_edit le WHERE le.lot_id = pb.id) AS last_edit_at
  FROM product_batches pb WHERE pb.id IN (SELECT lot_id FROM item_lot)
),
lot_at AS MATERIALIZED (
  SELECT il.ik, il.lot_id, m.t, m.pos, m.has_me, m.me_cost, m.me_baseline, lb.created, lb.received_at,
    CASE WHEN lb.is_active = 1 OR lb.updated_at > m.t THEN 1 ELSE 0 END AS active_t,
    COALESCE(
      (SELECT le.cost FROM lot_edit le WHERE le.lot_id = il.lot_id AND le.at <= m.t ORDER BY le.id DESC LIMIT 1),
      CASE WHEN lb.last_edit_at > m.t THEN COALESCE(lb.receipt_cost, lb.cost_now)
           WHEN lb.updated_at > m.t AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005
             THEN lb.receipt_cost END,
      lb.cost_now) AS cost_t,
    CASE WHEN (COALESCE(lb.is_active, 0) <> 1 AND lb.updated_at > m.t)
      OR lb.last_edit_at > m.t
      OR (lb.updated_at > m.t AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005)
      OR EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = il.lot_id AND rm.at > m.t)
    THEN 1 ELSE 0 END AS changed
  FROM item_lot il JOIN item_me m ON m.ik = il.ik JOIN lot_base lb ON lb.lot_id = il.lot_id
),
bset AS MATERIALIZED (
  SELECT la.ik, 'h' AS v, la.cost_t AS cost
    FROM lot_at la
   WHERE la.active_t = 1 AND la.cost_t > 0 AND la.created <= la.t AND (la.has_me = 0 OR la.lot_id > la.me_baseline)
  UNION
  SELECT m.ik, 'h', m.me_cost FROM item_me m WHERE m.has_me = 1 AND m.me_cost > 0
  UNION
  SELECT m.ik, 'n', pb.unit_cost_usd
    FROM item_me m JOIN product_batches pb ON pb.variant_product_id = m.product_now
   WHERE pb.is_active = 1 AND pb.unit_cost_usd > 0
     AND datetime(COALESCE(pb.created_at, pb.received_at)) <= m.t
     AND (m.now_has_me = 0 OR pb.id > m.now_me_baseline)
  UNION
  SELECT m.ik, 'n', m.now_me_cost FROM item_me m WHERE m.now_has_me = 1 AND m.now_me_cost > 0
),
item_match AS MATERIALIZED (
  SELECT m.ik,
    MAX(CASE WHEN b.v = 'h' AND (ABS(m.recorded - b.b1) < 0.00006 OR ABS(m.recorded - b.b1h) < 0.00006 OR ABS(m.recorded - b.b2) < 0.00006) THEN 1 ELSE 0 END) AS h_match,
    MAX(CASE WHEN b.v = 'n' AND (ABS(m.recorded - b.b1) < 0.00006 OR ABS(m.recorded - b.b1h) < 0.00006 OR ABS(m.recorded - b.b2) < 0.00006) THEN 1 ELSE 0 END) AS n_match,
    MAX(CASE WHEN b.v = 'h' THEN b.b1 END) AS buggy_mean_usd
  FROM item_me m JOIN (
    SELECT ik, v,
      ROUND(AVG(cost), 4) AS b1,
      CAST(AVG(cost) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
      CASE WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost) ELSE ROUND(AVG(cost), 4) END AS b2
    FROM bset GROUP BY ik, v) b ON b.ik = m.ik
  GROUP BY m.ik
),
cand_lots AS MATERIALIZED (
  SELECT lot_id FROM lot_base
),
ev AS MATERIALIZED (
  SELECT im.batch_id AS lot_id, im.id AS pos, im.quantity AS qty
    FROM inventory_movements im WHERE im.batch_id IN (SELECT lot_id FROM cand_lots)
  UNION ALL
  SELECT x.lot_id, x.pos, -x.q FROM (
    SELECT COALESCE((SELECT CAST(json_extract(ml.lot, '$.dupBatchId') AS INTEGER) FROM merge_lots ml JOIN json_each(ml.lot, '$.saleAllocationIds') ai
          WHERE ml.how = 'fold' AND CAST(ai.value AS INTEGER) = a.id ORDER BY ml.ord LIMIT 1), a.batch_id) AS lot_id,
      a.quantity - COALESCE(a.released_quantity, 0) AS q,
      (SELECT MIN(im.id) FROM sale_items si JOIN inventory_movements im
          ON im.reference_id = si.sale_id AND im.movement_type = 'sale' AND im.product_id = si.product_id AND im.batch_id IS NULL
        WHERE si.id = a.sale_item_id) AS pos
    FROM sale_item_batch_allocations a) x
  WHERE x.pos IS NOT NULL AND x.lot_id IN (SELECT lot_id FROM cand_lots)
  UNION ALL
  SELECT x.lot_id, x.pos, x.qty FROM (
    SELECT CAST(json_extract(ml.lot, CASE ml.how WHEN 'fold' THEN '$.dupBatchId' ELSE '$.batchId' END) AS INTEGER) AS lot_id,
      mp.pos, -json_extract(s.value, '$.quantity') AS qty
      FROM merge_lots ml JOIN json_each(ml.lot, CASE ml.how WHEN 'fold' THEN '$.dupStockBefore' ELSE '$.stockBefore' END) s
      JOIN merge_pos mp ON mp.at = ml.at
    UNION ALL
    SELECT CAST(json_extract(ml.lot, '$.keeperBatchId') AS INTEGER), mp.pos, json_extract(s.value, '$.quantity')
      FROM merge_lots ml JOIN json_each(ml.lot, '$.dupStockBefore') s
      JOIN merge_pos mp ON mp.at = ml.at
     WHERE ml.how = 'fold') x
  WHERE x.lot_id IN (SELECT lot_id FROM cand_lots)
),
bad_lots AS MATERIALIZED (
  SELECT lot_id FROM (
    SELECT e.lot_id, SUM(e.qty) OVER (PARTITION BY e.lot_id ORDER BY e.pos, e.qty DESC ROWS UNBOUNDED PRECEDING) AS running,
      SUM(e.qty) OVER (PARTITION BY e.lot_id) AS total
    FROM ev e) w
  WHERE w.running < 0
     OR w.total <> COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = w.lot_id), 0)
  UNION
  SELECT lb.lot_id FROM lot_base lb
   WHERE NOT EXISTS (SELECT 1 FROM inventory_movements im WHERE im.batch_id = lb.lot_id)
     AND (lb.received_quantity > 0 OR COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = lb.lot_id), 0) <> 0)
),
weighted AS MATERIALIZED (
  SELECT ik,
    CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END AS w,
    SUM(qty) AS on_hand_units
  FROM (
    SELECT o.ik, CASE WHEN o.has_me = 1 AND o.lot_id <= o.me_baseline THEN o.me_cost ELSE o.cost_t END AS cost, o.q AS qty
    FROM (
      SELECT la.ik, la.lot_id, la.cost_t, la.has_me, la.me_cost, la.me_baseline, SUM(e.qty) AS q
        FROM lot_at la JOIN ev e ON e.lot_id = la.lot_id AND e.pos < la.pos
       WHERE la.active_t = 1
       GROUP BY la.ik, la.lot_id, la.cost_t, la.has_me, la.me_cost, la.me_baseline) o
    WHERE o.q > 0 AND (CASE WHEN o.has_me = 1 AND o.lot_id <= o.me_baseline THEN o.me_cost ELSE o.cost_t END) > 0)
  GROUP BY ik
),
lot_agg AS MATERIALIZED (
  SELECT ik,
    MAX(CASE WHEN active_t = 1 AND created <= t AND bad = 1 THEN 1 ELSE 0 END) AS unverified,
    MAX(CASE WHEN changed = 1 AND created <= t THEN 1 ELSE 0 END) AS lot_changed,
    MAX(CASE WHEN fb_rank = 1 AND eligible = 1 THEN cost_t END) AS fallback
  FROM (
    SELECT y.*, ROW_NUMBER() OVER (PARTITION BY y.ik, y.eligible ORDER BY y.received_at DESC, y.lot_id DESC) AS fb_rank
    FROM (
      SELECT la.*, bl.lot_id IS NOT NULL AS bad,
        CASE WHEN la.active_t = 1 AND la.cost_t > 0 AND la.created <= la.t AND (la.has_me = 0 OR la.lot_id > la.me_baseline)
          THEN 1 ELSE 0 END AS eligible
      FROM lot_at la LEFT JOIN bad_lots bl ON bl.lot_id = la.lot_id) y)
  GROUP BY ik
),
classified_items AS MATERIALIZED (
  SELECT g.*,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.h_match = 1 AND g.differs = 1 THEN 'after_window' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'needs_owner_review'
      WHEN g.h_match = 1 AND g.correct IS NULL THEN 'needs_owner_review'
      WHEN g.h_match = 1 AND g.unverified = 1 THEN 'ledger_unverified'
      WHEN g.h_match = 1 AND g.differs = 0 THEN 'already_correct'
      WHEN g.h_match = 1 AND g.kind = 'return' THEN 'returns_walk_in'
      WHEN g.h_match = 1 AND g.t >= g.fix_at THEN 'window'
      WHEN g.h_match = 1 THEN 'repair'
      WHEN g.differs = 0 THEN NULL
      WHEN g.n_match = 1 OR g.uncertain = 1 THEN 'needs_owner_review'
    END AS bucket,
    CASE
      WHEN g.t >= g.era_end THEN 'buggy_average_after_deploy_window'
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'sold_lot_belongs_to_another_product'
      WHEN g.h_match = 1 AND g.correct IS NULL THEN 'no_derivable_cost'
      WHEN g.h_match = 1 AND g.unverified = 1 THEN 'lot_ledger_does_not_reconcile'
      WHEN g.h_match = 1 AND g.differs = 0 THEN 'buggy_average_equalled_on_hand'
      WHEN g.h_match = 1 AND g.t >= g.fix_at THEN 'buggy_average_deploy_window'
      WHEN g.h_match = 1 THEN 'buggy_average'
      WHEN g.n_match = 1 THEN 'matches_only_todays_lot_state'
      ELSE 'lot_history_changed_after_sale'
    END AS reason
  FROM (
    SELECT f.*, CASE WHEN f.correct IS NULL OR ABS(f.recorded - f.correct) < 0.00005 THEN 0 ELSE 1 END AS differs
    FROM (
      SELECT m.kind, m.item_id, m.sale_id, m.return_id, m.product_now AS product_id, m.quantity, m.recorded, m.t, m.pos,
        m.fix_at, m.era_end, COALESCE(w.w, la.fallback) AS correct, COALESCE(w.on_hand_units, 0) AS on_hand_units,
        COALESCE(mt.h_match, 0) AS h_match, COALESCE(mt.n_match, 0) AS n_match, mt.buggy_mean_usd,
        COALESCE(la.unverified, 0) AS unverified, m.orphan,
        CASE WHEN m.moved = 1 OR m.me_moved = 1 OR COALESCE(la.lot_changed, 0) = 1 THEN 1 ELSE 0 END AS uncertain
      FROM item_me m LEFT JOIN weighted w ON w.ik = m.ik LEFT JOIN item_match mt ON mt.ik = m.ik
      LEFT JOIN lot_agg la ON la.ik = m.ik) f) g
),
linked AS MATERIALIZED (
  SELECT ri.id AS return_item_id, r.id AS return_id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd AS recorded,
    datetime(r.created_at) AS t, ri.sale_item_id IS NULL AS by_product,
    COUNT(*) AS n_affected,
    SUM(CASE WHEN c.bucket IN ('repair', 'window') THEN 1 ELSE 0 END) AS n_repaired,
    MIN(c.correct) AS min_correct, MAX(c.correct) AS max_correct, MIN(c.item_id) AS first_line_id,
    MAX(c.buggy_mean_usd) AS buggy_mean_usd,
    (SELECT COUNT(*) FROM sale_items s2 WHERE s2.sale_id = r.sale_id AND (s2.id = ri.sale_item_id
      OR (ri.sale_item_id IS NULL AND s2.product_id = ri.product_id
        AND (ri.branch_id IS NULL OR s2.branch_id IS NULL OR s2.branch_id = ri.branch_id)))) AS n_lines,
    NOT EXISTS (SELECT 1 FROM sale_items s2 WHERE s2.sale_id = r.sale_id AND (s2.id = ri.sale_item_id
      OR (ri.sale_item_id IS NULL AND s2.product_id = ri.product_id
        AND (ri.branch_id IS NULL OR s2.branch_id IS NULL OR s2.branch_id = ri.branch_id)))
      AND NOT (ABS(s2.cost_price_usd - ri.cost_price_usd) < 0.00006)) AS all_equal
  FROM classified_items c
  JOIN sale_items sc ON sc.id = c.item_id
  JOIN returns r ON r.sale_id = c.sale_id
  JOIN return_items ri ON ri.return_id = r.id AND ri.cost_price_usd IS NOT NULL
   AND (ri.sale_item_id = c.item_id OR (ri.sale_item_id IS NULL AND ri.product_id = sc.product_id
     AND (ri.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = ri.branch_id)))
  WHERE c.kind = 'sale' AND c.bucket IN ('repair', 'window', 'ledger_unverified', 'needs_owner_review')
  GROUP BY ri.id, r.id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd, r.created_at, ri.sale_item_id, ri.branch_id
),
classified AS MATERIALIZED (
  SELECT kind, item_id, sale_id, return_id, product_id, quantity, recorded, correct, buggy_mean_usd, pos, on_hand_units, t, bucket, reason
    FROM classified_items WHERE bucket IS NOT NULL
  UNION ALL
  SELECT 'return', l.return_item_id, l.sale_id, l.return_id, l.product_id, l.quantity, l.recorded,
    COALESCE((SELECT c2.correct FROM classified_items c2 WHERE c2.kind = 'sale' AND c2.item_id = l.first_line_id), l.min_correct),
    l.buggy_mean_usd, NULL, NULL, l.t,
    CASE WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct THEN 'returns_sale_linked' ELSE 'needs_owner_review' END,
    CASE WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct
           THEN CASE WHEN l.by_product = 1 THEN 'copied_from_sale_line_by_product' ELSE 'copied_from_sale_line' END
         WHEN l.n_repaired = l.n_lines THEN 'sale_lines_of_product_now_differ'
         ELSE 'follows_unrepaired_sale_line' END
  FROM linked l WHERE l.all_equal = 1
)
-- plan:stop
SELECT
  (SELECT ROUND(COALESCE(SUM(c.quantity * (c.correct - c.recorded)), 0), 4) FROM classified c JOIN sales s ON s.id = c.sale_id
    WHERE c.kind = 'sale' AND c.bucket IN ('repair', 'window') AND lower(trim(COALESCE(s.sale_status, ''))) <> 'cancelled') AS sold_cost_delta_usd,
  (SELECT ROUND(COALESCE(SUM(c.quantity * (c.correct - c.recorded)), 0), 4) FROM classified c JOIN return_items ri ON ri.id = c.item_id
    WHERE c.kind = 'return' AND c.bucket IN ('returns_sale_linked', 'returns_walk_in') AND ri.return_to_stock = 1) AS returned_cost_delta_usd,
  (SELECT COUNT(*) FROM classified c WHERE c.kind = 'return' AND c.bucket IN ('returns_sale_linked', 'returns_walk_in')) AS return_lines;
