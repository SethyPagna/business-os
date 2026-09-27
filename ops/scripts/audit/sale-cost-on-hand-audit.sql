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
-- Buckets (statement 1 always lists all ten, zero when empty):
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
--   after_window         -- still matching a buggy producer after the
--                           window: a deploy-lag tell, must be 0
--   already_correct      -- came from a buggy producer, which equalled the
--                           on-hand cost; informational
--   unaffected           -- every other line in scope (not from a buggy
--                           producer, or already holding the on-hand cost);
--                           informational, left out of statement 2
--   unbucketed           -- a line in scope the plan failed to place: must be 0
-- after_window and unbucketed also make migration 0200 abort while non-zero.
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
merge_ev AS MATERIALIZED (
  SELECT m.ord, m.at, CAST(json_extract(m.rev, '$.keeperId') AS INTEGER) AS keeper_id,
    CAST(json_extract(m.rev, '$.keeperPricingBefore.cost_price_usd') AS REAL) AS keeper_before,
    (SELECT pd.cost_price_usd FROM products pd WHERE pd.id = CAST(json_extract(m.rev, '$.dupId') AS INTEGER)) AS dup_cost,
    CAST(json_extract(m.rev, '$.keeperChoice.cost.cost_price_usd') AS REAL) AS chosen
  FROM merge_rev m
),
merge_b AS MATERIALIZED (
  SELECT v.keeper_id, v.at,
    ROUND(AVG(v.c), 4) AS b1,
    CAST(AVG(v.c) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
    CASE WHEN MAX(v.c) > 2 * MIN(v.c) THEN MAX(v.c) ELSE ROUND(AVG(v.c), 4) END AS b2
  FROM (SELECT ord, keeper_id, at, keeper_before AS c FROM merge_ev UNION SELECT ord, keeper_id, at, dup_cost FROM merge_ev) v
  WHERE v.c > 0
  GROUP BY v.ord, v.keeper_id, v.at
  UNION ALL
  SELECT keeper_id, at, chosen, chosen, chosen FROM merge_ev WHERE chosen > 0
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
    sm.sale_at AS born,
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
  SELECT 'return', -ri.id, ri.id, NULL, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at), datetime(r.created_at),
    COALESCE((SELECT MIN(im.id) FROM inventory_movements im
        WHERE im.reference_id = r.id AND im.movement_type = 'return' AND im.product_id = ri.product_id
          AND datetime(im.created_at) >= datetime(r.created_at, '-60 seconds')),
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= datetime(r.created_at)),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im))
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  WHERE r.sale_id IS NULL AND COALESCE(r.return_scope, 'customer') = 'customer' AND ri.sale_item_id IS NULL
    AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0 AND datetime(r.created_at) >= '2026-09-16 14:04:42'
),
item_ctx AS MATERIALIZED (
  SELECT x.*,
    CASE WHEN x.lot_owner <> COALESCE(x.moved_dup, x.product_now) THEN x.lot_owner ELSE COALESCE(x.moved_dup, x.product_now) END AS prod_at,
    x.moved_dup IS NOT NULL AS moved, COALESCE(x.lot_owner <> COALESCE(x.moved_dup, x.product_now), 0) AS orphan,
    CASE WHEN x.t >= x.fix_at THEN x.fix_at ELSE '2026-09-16 14:04:42' END AS since
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
    WHERE (it.t >= '2026-09-16 14:04:42' OR it.born >= '2026-09-16 14:04:42')
      AND (it.t < p.scan_end OR it.born < p.era_end)) x
),
lot_touch AS MATERIALIZED (
  SELECT im.batch_id AS lot_id, datetime(im.created_at) AS at
    FROM inventory_movements im
   WHERE im.movement_type IN ('add', 'stock_in') AND im.quantity > 0 AND im.batch_id IS NOT NULL
     AND im.created_at >= '2026-09-16 14:04:42'
  UNION
  SELECT CAST(a.entity_id AS INTEGER), datetime(a.created_at)
    FROM audit_logs a
   WHERE a.action = 'batch_update' AND a.entity = 'product_batch' AND datetime(a.created_at) >= '2026-09-16 14:04:42'
     AND (json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') IS NOT NULL
       OR json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.is_active') IS NOT NULL)
),
setter AS MATERIALIZED (
  SELECT DISTINCT o.p, o.at FROM (
    SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lt.lot_id AND rm.at > lt.at
        ORDER BY rm.ord LIMIT 1), pb.variant_product_id) AS p, lt.at
      FROM lot_touch lt JOIN product_batches pb ON pb.id = lt.lot_id
    UNION
    SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pce.id
        AND rm.at > datetime(pce.created_at) ORDER BY rm.ord LIMIT 1), pce.product_id), datetime(pce.created_at)
      FROM product_cost_entries pce WHERE datetime(pce.created_at) >= '2026-09-16 14:04:42') o
  WHERE o.p IN (SELECT prod_at FROM item_ctx) AND o.at IS NOT NULL
),
anchor AS MATERIALIZED (
  SELECT ic.ik AS ak, ic.prod_at AS p, ic.t AS at, ic.kind, ic.item_id, ic.sale_id, ic.return_id, ic.product_now, ic.quantity,
    ic.recorded, ic.born, ic.t, ic.pos, ic.fix_at, ic.era_end, ic.moved, ic.orphan, ic.since
  FROM item_ctx ic
  UNION ALL
  SELECT 1000000000000 + ROW_NUMBER() OVER (ORDER BY s.p, s.at), s.p, s.at, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM setter s
),
anchor_me AS MATERIALIZED (
  SELECT x.*, pce.id IS NOT NULL AS has_me, pce.cost_usd AS me_cost, COALESCE(pce.baseline_batch_id, 0) AS me_baseline,
    nm.id IS NOT NULL AS now_has_me, nm.cost_usd AS now_me_cost, COALESCE(nm.baseline_batch_id, 0) AS now_me_baseline
  FROM (SELECT a.*,
      (SELECT pc.id FROM product_cost_entries pc
        WHERE (pc.product_id = a.p OR pc.id IN (SELECT rm.row_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = a.p))
          AND datetime(pc.created_at) <= a.at
          AND COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pc.id AND rm.at > a.at
            ORDER BY rm.ord LIMIT 1), pc.product_id) = a.p
        ORDER BY pc.id DESC LIMIT 1) AS me_id,
      (SELECT pc.id FROM product_cost_entries pc WHERE pc.product_id = a.product_now AND datetime(pc.created_at) <= a.t
        ORDER BY pc.id DESC LIMIT 1) AS now_me_id,
      EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = a.p AND rm.at > a.t) AS me_moved
    FROM anchor a) x
  LEFT JOIN product_cost_entries pce ON pce.id = x.me_id
  LEFT JOIN product_cost_entries nm ON nm.id = x.now_me_id
),
cand_lots AS MATERIALIZED (
  SELECT pb.id AS lot_id FROM product_batches pb WHERE pb.variant_product_id IN (SELECT prod_at FROM item_ctx)
  UNION
  SELECT rm.row_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.dup_id IN (SELECT prod_at FROM item_ctx)
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
lot_base AS MATERIALIZED (
  SELECT pb.id AS lot_id, pb.is_active, pb.unit_cost_usd AS cost_now, datetime(pb.updated_at) AS updated_at,
    datetime(COALESCE(pb.created_at, pb.received_at)) AS created, COALESCE(pb.received_at, '') AS received_at,
    (SELECT im.unit_cost_usd FROM inventory_movements im
      WHERE im.batch_id = pb.id AND im.quantity > 0 AND im.unit_cost_usd > 0 ORDER BY im.id LIMIT 1) AS receipt_cost,
    (SELECT MAX(le.at) FROM lot_edit le WHERE le.lot_id = pb.id) AS last_edit_at,
    CASE WHEN b.lot_id IS NOT NULL
      OR (NOT EXISTS (SELECT 1 FROM inventory_movements im WHERE im.batch_id = pb.id)
        AND (COALESCE(pb.received_quantity, 0) > 0 OR COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id), 0) <> 0))
    THEN 1 ELSE 0 END AS bad
  FROM product_batches pb
  LEFT JOIN (
    SELECT DISTINCT w.lot_id FROM (
      SELECT e.lot_id, SUM(e.qty) OVER (PARTITION BY e.lot_id ORDER BY e.pos, e.qty DESC ROWS UNBOUNDED PRECEDING) AS running,
        SUM(e.qty) OVER (PARTITION BY e.lot_id) AS total
      FROM ev e) w
    WHERE w.running < 0
       OR w.total <> COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = w.lot_id), 0)) b ON b.lot_id = pb.id
  WHERE pb.id IN (SELECT lot_id FROM cand_lots)
),
lot_x AS MATERIALIZED (
  SELECT am.*, lb.lot_id, lb.created, lb.received_at, lb.bad,
    CASE WHEN lb.is_active = 1 OR lb.updated_at > am.at THEN 1 ELSE 0 END AS active_t,
    COALESCE(
      (SELECT le.cost FROM lot_edit le WHERE le.lot_id = lb.lot_id AND le.at <= am.at ORDER BY le.id DESC LIMIT 1),
      CASE WHEN lb.last_edit_at > am.at THEN COALESCE(lb.receipt_cost, lb.cost_now)
           WHEN lb.updated_at > am.at AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005
             THEN lb.receipt_cost END,
      lb.cost_now) AS cost_t,
    CASE WHEN (COALESCE(lb.is_active, 0) <> 1 AND lb.updated_at > am.at)
      OR lb.last_edit_at > am.at
      OR (lb.updated_at > am.at AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005)
      OR EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lb.lot_id AND rm.at > am.at)
    THEN 1 ELSE 0 END AS changed
  FROM anchor_me am
  LEFT JOIN (
    SELECT pb.id AS lot_id, pb.variant_product_id AS key_p, pb.variant_product_id AS cur_p FROM product_batches pb
    UNION
    SELECT rm.row_id, rm.dup_id, pb.variant_product_id
      FROM row_move rm JOIN product_batches pb ON pb.id = rm.row_id WHERE rm.tbl = 'product_batches') lk
    ON lk.key_p = am.p
   AND COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lk.lot_id AND rm.at > am.at
         ORDER BY rm.ord LIMIT 1), lk.cur_p) = am.p
  LEFT JOIN lot_base lb ON lb.lot_id = lk.lot_id
),
lot_q AS MATERIALIZED (
  SELECT w.ak, w.lot_id, w.q FROM (
    SELECT u.ak, u.lot_id, u.is_ev,
      SUM(u.qty) OVER (PARTITION BY u.lot_id ORDER BY u.pos, u.is_ev ROWS UNBOUNDED PRECEDING) AS q
    FROM (SELECT lx.ak, lx.lot_id, lx.pos, 0 AS is_ev, 0 AS qty FROM lot_x lx
           WHERE lx.lot_id IS NOT NULL AND lx.active_t = 1 AND lx.ak < 1000000000000
          UNION ALL
          SELECT NULL, e.lot_id, e.pos, 1, e.qty FROM ev e) u) w
  WHERE w.is_ev = 0
),
lot_rows AS MATERIALIZED (
  SELECT y.*, ROW_NUMBER() OVER (PARTITION BY y.ak, y.eligible ORDER BY y.received_at DESC, y.lot_id DESC) AS fb_rank
  FROM (
    SELECT lx.*,
      CASE WHEN lx.lot_id IS NOT NULL AND lx.active_t = 1 AND lx.cost_t > 0 AND lx.created <= lx.at AND (lx.has_me = 0 OR lx.lot_id > lx.me_baseline)
        THEN 1 ELSE 0 END AS eligible,
      lq.q
    FROM lot_x lx LEFT JOIN lot_q lq ON lq.ak = lx.ak AND lq.lot_id = lx.lot_id) y
),
ak_agg AS MATERIALIZED (
  SELECT r.ak, r.p, r.at, r.kind, r.item_id, r.sale_id, r.return_id, r.product_now, r.quantity, r.recorded, r.born, r.t, r.pos,
    r.fix_at, r.era_end, r.moved, r.orphan, r.since, r.me_moved, r.now_has_me, r.now_me_cost, r.now_me_baseline,
    ROUND(AVG(DISTINCT r.hc), 4) AS b1,
    CAST(AVG(DISTINCT r.hc) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
    CASE WHEN MAX(r.hc) > 2 * MIN(r.hc) THEN MAX(r.hc) ELSE ROUND(AVG(DISTINCT r.hc), 4) END AS b2,
    CASE WHEN SUM(r.wq) > 0 THEN CAST(SUM(r.wq * r.wc) / SUM(r.wq) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END AS w,
    SUM(r.wq) AS on_hand_units,
    MAX(CASE WHEN r.u = 0 AND r.active_t = 1 AND r.created <= r.at AND r.bad = 1 THEN 1 ELSE 0 END) AS unverified,
    MAX(CASE WHEN r.u = 0 AND r.changed = 1 AND r.created <= r.at THEN 1 ELSE 0 END) AS lot_changed,
    MAX(CASE WHEN r.u = 0 AND r.fb_rank = 1 AND r.eligible = 1 THEN r.cost_t END) AS fallback
  FROM (
    SELECT lr.*, u.k AS u,
      CASE WHEN u.k = 0 THEN CASE WHEN lr.eligible = 1 THEN lr.cost_t END
           ELSE CASE WHEN lr.has_me = 1 AND lr.me_cost > 0 THEN lr.me_cost END END AS hc,
      CASE WHEN lr.has_me = 1 AND lr.lot_id <= lr.me_baseline THEN lr.me_cost ELSE lr.cost_t END AS wc,
      CASE WHEN u.k = 0 AND lr.q > 0 AND (CASE WHEN lr.has_me = 1 AND lr.lot_id <= lr.me_baseline THEN lr.me_cost ELSE lr.cost_t END) > 0
        THEN lr.q END AS wq
    FROM lot_rows lr CROSS JOIN (SELECT 0 AS k UNION ALL SELECT 1) u) r
  GROUP BY r.ak
),
item_match AS MATERIALIZED (
  SELECT g.*,
    CASE WHEN ABS(g.recorded - g.b1) < 0.00006 OR ABS(g.recorded - g.b1h) < 0.00006 OR ABS(g.recorded - g.b2) < 0.00006 THEN 1 ELSE 0 END AS h_match,
    CASE WHEN EXISTS (SELECT 1 FROM merge_b mb WHERE mb.keeper_id = g.p AND mb.at >= g.since AND mb.at <= g.t
      AND (ABS(g.recorded - mb.b1) < 0.00006 OR ABS(g.recorded - mb.b1h) < 0.00006 OR ABS(g.recorded - mb.b2) < 0.00006)) THEN 1 ELSE 0 END AS m_match,
    CASE WHEN g.s_any = 1 OR EXISTS (SELECT 1 FROM merge_ev me WHERE me.keeper_id = g.p AND me.at >= g.since AND me.at <= g.t)
      THEN 1 ELSE 0 END AS has_setter,
    COALESCE((SELECT CASE WHEN ABS(g.recorded - ROUND(AVG(n.c), 4)) < 0.00006
          OR ABS(g.recorded - CAST(AVG(n.c) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0) < 0.00006
          OR ABS(g.recorded - CASE WHEN MAX(n.c) > 2 * MIN(n.c) THEN MAX(n.c) ELSE ROUND(AVG(n.c), 4) END) < 0.00006 THEN 1 ELSE 0 END
        FROM (SELECT pb.unit_cost_usd AS c FROM product_batches pb
               WHERE pb.variant_product_id = g.product_now AND pb.is_active = 1 AND pb.unit_cost_usd > 0
                 AND datetime(COALESCE(pb.created_at, pb.received_at)) <= g.t
                 AND (g.now_has_me = 0 OR pb.id > g.now_me_baseline)
              UNION
              SELECT g.now_me_cost WHERE g.now_has_me = 1 AND g.now_me_cost > 0) n), 0) AS n_match
  FROM (
    SELECT i.*,
      MAX(CASE WHEN ABS(i.recorded - s.b1) < 0.00006 OR ABS(i.recorded - s.b1h) < 0.00006 OR ABS(i.recorded - s.b2) < 0.00006
        THEN 1 ELSE 0 END) AS s_match,
      MAX(CASE WHEN s.ak IS NOT NULL THEN 1 ELSE 0 END) AS s_any
    FROM ak_agg i LEFT JOIN ak_agg s ON s.ak >= 1000000000000 AND s.p = i.p AND s.at >= i.since AND s.at <= i.t
    WHERE i.ak < 1000000000000
    GROUP BY i.ak) g
),
classified_items AS MATERIALIZED (
  SELECT g.*,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.matched = 1 AND g.differs = 1 THEN 'after_window'
        WHEN g.born < g.era_end THEN 'unaffected' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'needs_owner_review'
      WHEN g.matched = 1 AND g.correct IS NULL THEN 'needs_owner_review'
      WHEN g.matched = 1 AND g.unverified = 1 THEN 'ledger_unverified'
      WHEN g.matched = 1 AND g.differs = 0 THEN 'already_correct'
      WHEN g.matched = 1 AND g.kind = 'return' THEN 'returns_walk_in'
      WHEN g.matched = 1 AND g.t >= g.fix_at THEN 'window'
      WHEN g.matched = 1 THEN 'repair'
      WHEN g.differs = 0 THEN 'unaffected'
      WHEN g.n_match = 1 OR g.uncertain = 1 THEN 'needs_owner_review'
      WHEN g.t < g.fix_at AND g.has_setter = 0 THEN 'unaffected'
      ELSE 'needs_owner_review'
    END AS bucket,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.matched = 1 AND g.differs = 1 THEN 'buggy_average_after_deploy_window' ELSE 'after_deploy_window' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'sold_lot_belongs_to_another_product'
      WHEN g.matched = 1 AND g.correct IS NULL THEN 'no_derivable_cost'
      WHEN g.matched = 1 AND g.unverified = 1 THEN 'lot_ledger_does_not_reconcile'
      WHEN g.matched = 1 AND g.differs = 0 THEN 'buggy_average_equalled_on_hand'
      WHEN g.matched = 1 AND g.kind = 'sale' AND g.t >= g.fix_at THEN g.producer || '_deploy_window'
      WHEN g.matched = 1 THEN g.producer
      WHEN g.differs = 0 THEN CASE WHEN g.correct IS NULL THEN 'no_lot_cost_at_line' ELSE 'recorded_equals_on_hand' END
      WHEN g.n_match = 1 THEN 'matches_only_todays_lot_state'
      WHEN g.uncertain = 1 THEN 'lot_history_changed_after_sale'
      WHEN g.t < g.fix_at AND g.has_setter = 0 THEN 'catalog_cost_set_before_era'
      ELSE 'recorded_cost_unexplained'
    END AS reason
  FROM (
    SELECT f.*, CASE WHEN f.correct IS NULL OR ABS(f.recorded - f.correct) < 0.00005 THEN 0 ELSE 1 END AS differs,
      CASE WHEN f.h_match = 1 OR f.s_match = 1 OR f.m_match = 1 THEN 1 ELSE 0 END AS matched,
      CASE WHEN f.h_match = 1 THEN 'buggy_average' WHEN f.s_match = 1 THEN 'stale_buggy_average' ELSE 'stale_merge_cost' END AS producer
    FROM (
      SELECT m.kind, m.item_id, m.sale_id, m.return_id, m.product_now AS product_id, m.quantity, m.recorded, m.t, m.born, m.pos,
        m.fix_at, m.era_end, COALESCE(m.w, m.fallback) AS correct, COALESCE(m.on_hand_units, 0) AS on_hand_units,
        m.h_match, m.s_match, m.m_match, m.n_match, m.has_setter, m.b1 AS buggy_mean_usd,
        COALESCE(m.unverified, 0) AS unverified, m.orphan,
        CASE WHEN m.moved = 1 OR m.me_moved = 1 OR COALESCE(m.lot_changed, 0) = 1 THEN 1 ELSE 0 END AS uncertain
      FROM item_match m) f) g
),
linked AS MATERIALIZED (
  SELECT y.return_item_id, y.return_id, y.sale_id, y.product_id, y.quantity, y.recorded, y.t, y.by_product, y.n_lines, y.n_unequal,
    SUM(CASE WHEN y.hit = 1 AND y.bucket IN ('repair', 'window') THEN 1 ELSE 0 END) AS n_repaired,
    SUM(CASE WHEN y.hit = 1 AND y.bucket IN ('ledger_unverified', 'needs_owner_review', 'after_window') THEN 1 ELSE 0 END) AS n_review,
    MIN(CASE WHEN y.hit = 1 THEN y.correct END) AS min_correct,
    MAX(CASE WHEN y.hit = 1 THEN y.correct END) AS max_correct,
    MAX(CASE WHEN y.item_id = y.first_line_id THEN y.correct END) AS first_correct,
    MAX(CASE WHEN y.hit = 1 THEN y.buggy_mean_usd END) AS buggy_mean_usd
  FROM (
    SELECT rl.*, c.item_id, c.bucket, c.correct, c.buggy_mean_usd,
      CASE WHEN c.item_id = rl.sale_item_id OR (rl.sale_item_id IS NULL AND sc.product_id = rl.product_id
        AND (rl.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = rl.branch_id)) THEN 1 ELSE 0 END AS hit
    FROM (
      SELECT z.*,
        (SELECT COUNT(*) FROM sale_items sc WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS n_lines,
        (SELECT COALESCE(SUM(CASE WHEN ABS(sc.cost_price_usd - z.recorded) < 0.00006 THEN 0 ELSE 1 END), 0) FROM sale_items sc
          WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS n_unequal,
        (SELECT MIN(sc.id) FROM sale_items sc WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS first_line_id
      FROM (
        SELECT ri.id AS return_item_id, r.id AS return_id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd AS recorded,
          datetime(r.created_at) AS t, ri.sale_item_id IS NULL AS by_product, ri.sale_item_id, ri.branch_id
        FROM returns r JOIN return_items ri ON ri.return_id = r.id
        WHERE r.sale_id IS NOT NULL AND COALESCE(r.return_scope, 'customer') = 'customer'
          AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0) z) rl
    JOIN classified_items c ON c.kind = 'sale' AND c.sale_id = rl.sale_id
    JOIN sale_items sc ON sc.id = c.item_id) y
  GROUP BY y.return_item_id
  HAVING MAX(CASE WHEN y.bucket IS NOT NULL THEN 1 ELSE 0 END) = 1
),
scope AS MATERIALIZED (
  SELECT 'sale' AS kind, si.id AS item_id, si.sale_id, NULL AS return_id, si.product_id, si.quantity, si.cost_price_usd AS recorded,
    datetime(s.created_at) AS t
  FROM sales s JOIN sale_items si ON si.sale_id = s.id JOIN params p
  WHERE si.product_id IS NOT NULL AND si.cost_price_usd > 0
    AND datetime(s.created_at) >= '2026-09-16 14:04:42' AND datetime(s.created_at) < p.era_end
  UNION ALL
  SELECT 'return', ri.id, r.sale_id, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at)
  FROM returns r JOIN return_items ri ON ri.return_id = r.id JOIN params p
  WHERE COALESCE(r.return_scope, 'customer') = 'customer' AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0
    AND r.sale_id IS NULL AND ri.sale_item_id IS NULL
    AND datetime(r.created_at) >= '2026-09-16 14:04:42' AND datetime(r.created_at) < p.era_end
),
classified AS MATERIALIZED (
  SELECT v.kind, v.item_id, v.sale_id, v.return_id, v.product_id, v.quantity, v.recorded, v.correct, v.buggy_mean_usd, v.pos,
    v.on_hand_units, v.t, v.bucket, v.reason
  FROM (
    SELECT u.*, MAX(u.src) OVER (PARTITION BY u.kind, u.item_id) AS covered
    FROM (
      SELECT c.kind, c.item_id, c.sale_id, c.return_id, c.product_id, c.quantity, c.recorded, c.correct, c.buggy_mean_usd, c.pos,
        c.on_hand_units, c.t, c.bucket, c.reason, 1 AS src
      FROM classified_items c WHERE c.bucket IS NOT NULL
      UNION ALL
      SELECT 'return', l.return_item_id, l.sale_id, l.return_id, l.product_id, l.quantity, l.recorded,
        COALESCE(l.first_correct, l.min_correct), l.buggy_mean_usd, NULL, NULL, l.t,
        CASE WHEN l.n_lines = 0 THEN 'needs_owner_review'
             WHEN l.n_unequal > 0 THEN 'unaffected'
             WHEN l.n_review > 0 THEN 'needs_owner_review'
             WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct THEN 'returns_sale_linked'
             WHEN l.n_repaired > 0 THEN 'needs_owner_review'
             ELSE 'unaffected' END,
        CASE WHEN l.n_lines = 0 THEN 'no_matching_sale_line'
             WHEN l.n_unequal > 0 THEN 'return_cost_not_copied_from_sale'
             WHEN l.n_review > 0 THEN 'follows_unrepaired_sale_line'
             WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct
               THEN CASE WHEN l.by_product = 1 THEN 'copied_from_sale_line_by_product' ELSE 'copied_from_sale_line' END
             WHEN l.n_repaired > 0 THEN 'sale_lines_of_product_now_differ'
             ELSE 'follows_sale_line' END,
        1
      FROM linked l
      UNION ALL
      SELECT s.kind, s.item_id, s.sale_id, s.return_id, s.product_id, s.quantity, s.recorded, NULL, NULL, NULL, NULL, s.t,
        'unbucketed', 'in_scope_line_not_classified', 0
      FROM scope s) u) v
  WHERE v.src = 1 OR v.covered = 0
)
-- plan:stop
SELECT b.value AS bucket, COUNT(c.kind) AS lines, ROUND(COALESCE(SUM(c.quantity), 0), 4) AS units,
  ROUND(COALESCE(SUM(c.quantity * (c.correct - c.recorded)), 0), 4) AS cost_delta_usd
FROM json_each('["repair","window","returns_sale_linked","returns_walk_in","ledger_unverified","needs_owner_review","after_window","already_correct","unaffected","unbucketed"]') b
LEFT JOIN classified c ON c.bucket = b.value
GROUP BY b.key, b.value ORDER BY b.key;

-- 2. Every listed line (all buckets but unaffected) with its sale or return (row-level: encrypted ops export only).
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
merge_ev AS MATERIALIZED (
  SELECT m.ord, m.at, CAST(json_extract(m.rev, '$.keeperId') AS INTEGER) AS keeper_id,
    CAST(json_extract(m.rev, '$.keeperPricingBefore.cost_price_usd') AS REAL) AS keeper_before,
    (SELECT pd.cost_price_usd FROM products pd WHERE pd.id = CAST(json_extract(m.rev, '$.dupId') AS INTEGER)) AS dup_cost,
    CAST(json_extract(m.rev, '$.keeperChoice.cost.cost_price_usd') AS REAL) AS chosen
  FROM merge_rev m
),
merge_b AS MATERIALIZED (
  SELECT v.keeper_id, v.at,
    ROUND(AVG(v.c), 4) AS b1,
    CAST(AVG(v.c) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
    CASE WHEN MAX(v.c) > 2 * MIN(v.c) THEN MAX(v.c) ELSE ROUND(AVG(v.c), 4) END AS b2
  FROM (SELECT ord, keeper_id, at, keeper_before AS c FROM merge_ev UNION SELECT ord, keeper_id, at, dup_cost FROM merge_ev) v
  WHERE v.c > 0
  GROUP BY v.ord, v.keeper_id, v.at
  UNION ALL
  SELECT keeper_id, at, chosen, chosen, chosen FROM merge_ev WHERE chosen > 0
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
    sm.sale_at AS born,
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
  SELECT 'return', -ri.id, ri.id, NULL, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at), datetime(r.created_at),
    COALESCE((SELECT MIN(im.id) FROM inventory_movements im
        WHERE im.reference_id = r.id AND im.movement_type = 'return' AND im.product_id = ri.product_id
          AND datetime(im.created_at) >= datetime(r.created_at, '-60 seconds')),
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= datetime(r.created_at)),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im))
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  WHERE r.sale_id IS NULL AND COALESCE(r.return_scope, 'customer') = 'customer' AND ri.sale_item_id IS NULL
    AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0 AND datetime(r.created_at) >= '2026-09-16 14:04:42'
),
item_ctx AS MATERIALIZED (
  SELECT x.*,
    CASE WHEN x.lot_owner <> COALESCE(x.moved_dup, x.product_now) THEN x.lot_owner ELSE COALESCE(x.moved_dup, x.product_now) END AS prod_at,
    x.moved_dup IS NOT NULL AS moved, COALESCE(x.lot_owner <> COALESCE(x.moved_dup, x.product_now), 0) AS orphan,
    CASE WHEN x.t >= x.fix_at THEN x.fix_at ELSE '2026-09-16 14:04:42' END AS since
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
    WHERE (it.t >= '2026-09-16 14:04:42' OR it.born >= '2026-09-16 14:04:42')
      AND (it.t < p.scan_end OR it.born < p.era_end)) x
),
lot_touch AS MATERIALIZED (
  SELECT im.batch_id AS lot_id, datetime(im.created_at) AS at
    FROM inventory_movements im
   WHERE im.movement_type IN ('add', 'stock_in') AND im.quantity > 0 AND im.batch_id IS NOT NULL
     AND im.created_at >= '2026-09-16 14:04:42'
  UNION
  SELECT CAST(a.entity_id AS INTEGER), datetime(a.created_at)
    FROM audit_logs a
   WHERE a.action = 'batch_update' AND a.entity = 'product_batch' AND datetime(a.created_at) >= '2026-09-16 14:04:42'
     AND (json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') IS NOT NULL
       OR json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.is_active') IS NOT NULL)
),
setter AS MATERIALIZED (
  SELECT DISTINCT o.p, o.at FROM (
    SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lt.lot_id AND rm.at > lt.at
        ORDER BY rm.ord LIMIT 1), pb.variant_product_id) AS p, lt.at
      FROM lot_touch lt JOIN product_batches pb ON pb.id = lt.lot_id
    UNION
    SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pce.id
        AND rm.at > datetime(pce.created_at) ORDER BY rm.ord LIMIT 1), pce.product_id), datetime(pce.created_at)
      FROM product_cost_entries pce WHERE datetime(pce.created_at) >= '2026-09-16 14:04:42') o
  WHERE o.p IN (SELECT prod_at FROM item_ctx) AND o.at IS NOT NULL
),
anchor AS MATERIALIZED (
  SELECT ic.ik AS ak, ic.prod_at AS p, ic.t AS at, ic.kind, ic.item_id, ic.sale_id, ic.return_id, ic.product_now, ic.quantity,
    ic.recorded, ic.born, ic.t, ic.pos, ic.fix_at, ic.era_end, ic.moved, ic.orphan, ic.since
  FROM item_ctx ic
  UNION ALL
  SELECT 1000000000000 + ROW_NUMBER() OVER (ORDER BY s.p, s.at), s.p, s.at, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM setter s
),
anchor_me AS MATERIALIZED (
  SELECT x.*, pce.id IS NOT NULL AS has_me, pce.cost_usd AS me_cost, COALESCE(pce.baseline_batch_id, 0) AS me_baseline,
    nm.id IS NOT NULL AS now_has_me, nm.cost_usd AS now_me_cost, COALESCE(nm.baseline_batch_id, 0) AS now_me_baseline
  FROM (SELECT a.*,
      (SELECT pc.id FROM product_cost_entries pc
        WHERE (pc.product_id = a.p OR pc.id IN (SELECT rm.row_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = a.p))
          AND datetime(pc.created_at) <= a.at
          AND COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pc.id AND rm.at > a.at
            ORDER BY rm.ord LIMIT 1), pc.product_id) = a.p
        ORDER BY pc.id DESC LIMIT 1) AS me_id,
      (SELECT pc.id FROM product_cost_entries pc WHERE pc.product_id = a.product_now AND datetime(pc.created_at) <= a.t
        ORDER BY pc.id DESC LIMIT 1) AS now_me_id,
      EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = a.p AND rm.at > a.t) AS me_moved
    FROM anchor a) x
  LEFT JOIN product_cost_entries pce ON pce.id = x.me_id
  LEFT JOIN product_cost_entries nm ON nm.id = x.now_me_id
),
cand_lots AS MATERIALIZED (
  SELECT pb.id AS lot_id FROM product_batches pb WHERE pb.variant_product_id IN (SELECT prod_at FROM item_ctx)
  UNION
  SELECT rm.row_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.dup_id IN (SELECT prod_at FROM item_ctx)
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
lot_base AS MATERIALIZED (
  SELECT pb.id AS lot_id, pb.is_active, pb.unit_cost_usd AS cost_now, datetime(pb.updated_at) AS updated_at,
    datetime(COALESCE(pb.created_at, pb.received_at)) AS created, COALESCE(pb.received_at, '') AS received_at,
    (SELECT im.unit_cost_usd FROM inventory_movements im
      WHERE im.batch_id = pb.id AND im.quantity > 0 AND im.unit_cost_usd > 0 ORDER BY im.id LIMIT 1) AS receipt_cost,
    (SELECT MAX(le.at) FROM lot_edit le WHERE le.lot_id = pb.id) AS last_edit_at,
    CASE WHEN b.lot_id IS NOT NULL
      OR (NOT EXISTS (SELECT 1 FROM inventory_movements im WHERE im.batch_id = pb.id)
        AND (COALESCE(pb.received_quantity, 0) > 0 OR COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id), 0) <> 0))
    THEN 1 ELSE 0 END AS bad
  FROM product_batches pb
  LEFT JOIN (
    SELECT DISTINCT w.lot_id FROM (
      SELECT e.lot_id, SUM(e.qty) OVER (PARTITION BY e.lot_id ORDER BY e.pos, e.qty DESC ROWS UNBOUNDED PRECEDING) AS running,
        SUM(e.qty) OVER (PARTITION BY e.lot_id) AS total
      FROM ev e) w
    WHERE w.running < 0
       OR w.total <> COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = w.lot_id), 0)) b ON b.lot_id = pb.id
  WHERE pb.id IN (SELECT lot_id FROM cand_lots)
),
lot_x AS MATERIALIZED (
  SELECT am.*, lb.lot_id, lb.created, lb.received_at, lb.bad,
    CASE WHEN lb.is_active = 1 OR lb.updated_at > am.at THEN 1 ELSE 0 END AS active_t,
    COALESCE(
      (SELECT le.cost FROM lot_edit le WHERE le.lot_id = lb.lot_id AND le.at <= am.at ORDER BY le.id DESC LIMIT 1),
      CASE WHEN lb.last_edit_at > am.at THEN COALESCE(lb.receipt_cost, lb.cost_now)
           WHEN lb.updated_at > am.at AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005
             THEN lb.receipt_cost END,
      lb.cost_now) AS cost_t,
    CASE WHEN (COALESCE(lb.is_active, 0) <> 1 AND lb.updated_at > am.at)
      OR lb.last_edit_at > am.at
      OR (lb.updated_at > am.at AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005)
      OR EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lb.lot_id AND rm.at > am.at)
    THEN 1 ELSE 0 END AS changed
  FROM anchor_me am
  LEFT JOIN (
    SELECT pb.id AS lot_id, pb.variant_product_id AS key_p, pb.variant_product_id AS cur_p FROM product_batches pb
    UNION
    SELECT rm.row_id, rm.dup_id, pb.variant_product_id
      FROM row_move rm JOIN product_batches pb ON pb.id = rm.row_id WHERE rm.tbl = 'product_batches') lk
    ON lk.key_p = am.p
   AND COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lk.lot_id AND rm.at > am.at
         ORDER BY rm.ord LIMIT 1), lk.cur_p) = am.p
  LEFT JOIN lot_base lb ON lb.lot_id = lk.lot_id
),
lot_q AS MATERIALIZED (
  SELECT w.ak, w.lot_id, w.q FROM (
    SELECT u.ak, u.lot_id, u.is_ev,
      SUM(u.qty) OVER (PARTITION BY u.lot_id ORDER BY u.pos, u.is_ev ROWS UNBOUNDED PRECEDING) AS q
    FROM (SELECT lx.ak, lx.lot_id, lx.pos, 0 AS is_ev, 0 AS qty FROM lot_x lx
           WHERE lx.lot_id IS NOT NULL AND lx.active_t = 1 AND lx.ak < 1000000000000
          UNION ALL
          SELECT NULL, e.lot_id, e.pos, 1, e.qty FROM ev e) u) w
  WHERE w.is_ev = 0
),
lot_rows AS MATERIALIZED (
  SELECT y.*, ROW_NUMBER() OVER (PARTITION BY y.ak, y.eligible ORDER BY y.received_at DESC, y.lot_id DESC) AS fb_rank
  FROM (
    SELECT lx.*,
      CASE WHEN lx.lot_id IS NOT NULL AND lx.active_t = 1 AND lx.cost_t > 0 AND lx.created <= lx.at AND (lx.has_me = 0 OR lx.lot_id > lx.me_baseline)
        THEN 1 ELSE 0 END AS eligible,
      lq.q
    FROM lot_x lx LEFT JOIN lot_q lq ON lq.ak = lx.ak AND lq.lot_id = lx.lot_id) y
),
ak_agg AS MATERIALIZED (
  SELECT r.ak, r.p, r.at, r.kind, r.item_id, r.sale_id, r.return_id, r.product_now, r.quantity, r.recorded, r.born, r.t, r.pos,
    r.fix_at, r.era_end, r.moved, r.orphan, r.since, r.me_moved, r.now_has_me, r.now_me_cost, r.now_me_baseline,
    ROUND(AVG(DISTINCT r.hc), 4) AS b1,
    CAST(AVG(DISTINCT r.hc) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
    CASE WHEN MAX(r.hc) > 2 * MIN(r.hc) THEN MAX(r.hc) ELSE ROUND(AVG(DISTINCT r.hc), 4) END AS b2,
    CASE WHEN SUM(r.wq) > 0 THEN CAST(SUM(r.wq * r.wc) / SUM(r.wq) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END AS w,
    SUM(r.wq) AS on_hand_units,
    MAX(CASE WHEN r.u = 0 AND r.active_t = 1 AND r.created <= r.at AND r.bad = 1 THEN 1 ELSE 0 END) AS unverified,
    MAX(CASE WHEN r.u = 0 AND r.changed = 1 AND r.created <= r.at THEN 1 ELSE 0 END) AS lot_changed,
    MAX(CASE WHEN r.u = 0 AND r.fb_rank = 1 AND r.eligible = 1 THEN r.cost_t END) AS fallback
  FROM (
    SELECT lr.*, u.k AS u,
      CASE WHEN u.k = 0 THEN CASE WHEN lr.eligible = 1 THEN lr.cost_t END
           ELSE CASE WHEN lr.has_me = 1 AND lr.me_cost > 0 THEN lr.me_cost END END AS hc,
      CASE WHEN lr.has_me = 1 AND lr.lot_id <= lr.me_baseline THEN lr.me_cost ELSE lr.cost_t END AS wc,
      CASE WHEN u.k = 0 AND lr.q > 0 AND (CASE WHEN lr.has_me = 1 AND lr.lot_id <= lr.me_baseline THEN lr.me_cost ELSE lr.cost_t END) > 0
        THEN lr.q END AS wq
    FROM lot_rows lr CROSS JOIN (SELECT 0 AS k UNION ALL SELECT 1) u) r
  GROUP BY r.ak
),
item_match AS MATERIALIZED (
  SELECT g.*,
    CASE WHEN ABS(g.recorded - g.b1) < 0.00006 OR ABS(g.recorded - g.b1h) < 0.00006 OR ABS(g.recorded - g.b2) < 0.00006 THEN 1 ELSE 0 END AS h_match,
    CASE WHEN EXISTS (SELECT 1 FROM merge_b mb WHERE mb.keeper_id = g.p AND mb.at >= g.since AND mb.at <= g.t
      AND (ABS(g.recorded - mb.b1) < 0.00006 OR ABS(g.recorded - mb.b1h) < 0.00006 OR ABS(g.recorded - mb.b2) < 0.00006)) THEN 1 ELSE 0 END AS m_match,
    CASE WHEN g.s_any = 1 OR EXISTS (SELECT 1 FROM merge_ev me WHERE me.keeper_id = g.p AND me.at >= g.since AND me.at <= g.t)
      THEN 1 ELSE 0 END AS has_setter,
    COALESCE((SELECT CASE WHEN ABS(g.recorded - ROUND(AVG(n.c), 4)) < 0.00006
          OR ABS(g.recorded - CAST(AVG(n.c) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0) < 0.00006
          OR ABS(g.recorded - CASE WHEN MAX(n.c) > 2 * MIN(n.c) THEN MAX(n.c) ELSE ROUND(AVG(n.c), 4) END) < 0.00006 THEN 1 ELSE 0 END
        FROM (SELECT pb.unit_cost_usd AS c FROM product_batches pb
               WHERE pb.variant_product_id = g.product_now AND pb.is_active = 1 AND pb.unit_cost_usd > 0
                 AND datetime(COALESCE(pb.created_at, pb.received_at)) <= g.t
                 AND (g.now_has_me = 0 OR pb.id > g.now_me_baseline)
              UNION
              SELECT g.now_me_cost WHERE g.now_has_me = 1 AND g.now_me_cost > 0) n), 0) AS n_match
  FROM (
    SELECT i.*,
      MAX(CASE WHEN ABS(i.recorded - s.b1) < 0.00006 OR ABS(i.recorded - s.b1h) < 0.00006 OR ABS(i.recorded - s.b2) < 0.00006
        THEN 1 ELSE 0 END) AS s_match,
      MAX(CASE WHEN s.ak IS NOT NULL THEN 1 ELSE 0 END) AS s_any
    FROM ak_agg i LEFT JOIN ak_agg s ON s.ak >= 1000000000000 AND s.p = i.p AND s.at >= i.since AND s.at <= i.t
    WHERE i.ak < 1000000000000
    GROUP BY i.ak) g
),
classified_items AS MATERIALIZED (
  SELECT g.*,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.matched = 1 AND g.differs = 1 THEN 'after_window'
        WHEN g.born < g.era_end THEN 'unaffected' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'needs_owner_review'
      WHEN g.matched = 1 AND g.correct IS NULL THEN 'needs_owner_review'
      WHEN g.matched = 1 AND g.unverified = 1 THEN 'ledger_unverified'
      WHEN g.matched = 1 AND g.differs = 0 THEN 'already_correct'
      WHEN g.matched = 1 AND g.kind = 'return' THEN 'returns_walk_in'
      WHEN g.matched = 1 AND g.t >= g.fix_at THEN 'window'
      WHEN g.matched = 1 THEN 'repair'
      WHEN g.differs = 0 THEN 'unaffected'
      WHEN g.n_match = 1 OR g.uncertain = 1 THEN 'needs_owner_review'
      WHEN g.t < g.fix_at AND g.has_setter = 0 THEN 'unaffected'
      ELSE 'needs_owner_review'
    END AS bucket,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.matched = 1 AND g.differs = 1 THEN 'buggy_average_after_deploy_window' ELSE 'after_deploy_window' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'sold_lot_belongs_to_another_product'
      WHEN g.matched = 1 AND g.correct IS NULL THEN 'no_derivable_cost'
      WHEN g.matched = 1 AND g.unverified = 1 THEN 'lot_ledger_does_not_reconcile'
      WHEN g.matched = 1 AND g.differs = 0 THEN 'buggy_average_equalled_on_hand'
      WHEN g.matched = 1 AND g.kind = 'sale' AND g.t >= g.fix_at THEN g.producer || '_deploy_window'
      WHEN g.matched = 1 THEN g.producer
      WHEN g.differs = 0 THEN CASE WHEN g.correct IS NULL THEN 'no_lot_cost_at_line' ELSE 'recorded_equals_on_hand' END
      WHEN g.n_match = 1 THEN 'matches_only_todays_lot_state'
      WHEN g.uncertain = 1 THEN 'lot_history_changed_after_sale'
      WHEN g.t < g.fix_at AND g.has_setter = 0 THEN 'catalog_cost_set_before_era'
      ELSE 'recorded_cost_unexplained'
    END AS reason
  FROM (
    SELECT f.*, CASE WHEN f.correct IS NULL OR ABS(f.recorded - f.correct) < 0.00005 THEN 0 ELSE 1 END AS differs,
      CASE WHEN f.h_match = 1 OR f.s_match = 1 OR f.m_match = 1 THEN 1 ELSE 0 END AS matched,
      CASE WHEN f.h_match = 1 THEN 'buggy_average' WHEN f.s_match = 1 THEN 'stale_buggy_average' ELSE 'stale_merge_cost' END AS producer
    FROM (
      SELECT m.kind, m.item_id, m.sale_id, m.return_id, m.product_now AS product_id, m.quantity, m.recorded, m.t, m.born, m.pos,
        m.fix_at, m.era_end, COALESCE(m.w, m.fallback) AS correct, COALESCE(m.on_hand_units, 0) AS on_hand_units,
        m.h_match, m.s_match, m.m_match, m.n_match, m.has_setter, m.b1 AS buggy_mean_usd,
        COALESCE(m.unverified, 0) AS unverified, m.orphan,
        CASE WHEN m.moved = 1 OR m.me_moved = 1 OR COALESCE(m.lot_changed, 0) = 1 THEN 1 ELSE 0 END AS uncertain
      FROM item_match m) f) g
),
linked AS MATERIALIZED (
  SELECT y.return_item_id, y.return_id, y.sale_id, y.product_id, y.quantity, y.recorded, y.t, y.by_product, y.n_lines, y.n_unequal,
    SUM(CASE WHEN y.hit = 1 AND y.bucket IN ('repair', 'window') THEN 1 ELSE 0 END) AS n_repaired,
    SUM(CASE WHEN y.hit = 1 AND y.bucket IN ('ledger_unverified', 'needs_owner_review', 'after_window') THEN 1 ELSE 0 END) AS n_review,
    MIN(CASE WHEN y.hit = 1 THEN y.correct END) AS min_correct,
    MAX(CASE WHEN y.hit = 1 THEN y.correct END) AS max_correct,
    MAX(CASE WHEN y.item_id = y.first_line_id THEN y.correct END) AS first_correct,
    MAX(CASE WHEN y.hit = 1 THEN y.buggy_mean_usd END) AS buggy_mean_usd
  FROM (
    SELECT rl.*, c.item_id, c.bucket, c.correct, c.buggy_mean_usd,
      CASE WHEN c.item_id = rl.sale_item_id OR (rl.sale_item_id IS NULL AND sc.product_id = rl.product_id
        AND (rl.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = rl.branch_id)) THEN 1 ELSE 0 END AS hit
    FROM (
      SELECT z.*,
        (SELECT COUNT(*) FROM sale_items sc WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS n_lines,
        (SELECT COALESCE(SUM(CASE WHEN ABS(sc.cost_price_usd - z.recorded) < 0.00006 THEN 0 ELSE 1 END), 0) FROM sale_items sc
          WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS n_unequal,
        (SELECT MIN(sc.id) FROM sale_items sc WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS first_line_id
      FROM (
        SELECT ri.id AS return_item_id, r.id AS return_id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd AS recorded,
          datetime(r.created_at) AS t, ri.sale_item_id IS NULL AS by_product, ri.sale_item_id, ri.branch_id
        FROM returns r JOIN return_items ri ON ri.return_id = r.id
        WHERE r.sale_id IS NOT NULL AND COALESCE(r.return_scope, 'customer') = 'customer'
          AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0) z) rl
    JOIN classified_items c ON c.kind = 'sale' AND c.sale_id = rl.sale_id
    JOIN sale_items sc ON sc.id = c.item_id) y
  GROUP BY y.return_item_id
  HAVING MAX(CASE WHEN y.bucket IS NOT NULL THEN 1 ELSE 0 END) = 1
),
scope AS MATERIALIZED (
  SELECT 'sale' AS kind, si.id AS item_id, si.sale_id, NULL AS return_id, si.product_id, si.quantity, si.cost_price_usd AS recorded,
    datetime(s.created_at) AS t
  FROM sales s JOIN sale_items si ON si.sale_id = s.id JOIN params p
  WHERE si.product_id IS NOT NULL AND si.cost_price_usd > 0
    AND datetime(s.created_at) >= '2026-09-16 14:04:42' AND datetime(s.created_at) < p.era_end
  UNION ALL
  SELECT 'return', ri.id, r.sale_id, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at)
  FROM returns r JOIN return_items ri ON ri.return_id = r.id JOIN params p
  WHERE COALESCE(r.return_scope, 'customer') = 'customer' AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0
    AND r.sale_id IS NULL AND ri.sale_item_id IS NULL
    AND datetime(r.created_at) >= '2026-09-16 14:04:42' AND datetime(r.created_at) < p.era_end
),
classified AS MATERIALIZED (
  SELECT v.kind, v.item_id, v.sale_id, v.return_id, v.product_id, v.quantity, v.recorded, v.correct, v.buggy_mean_usd, v.pos,
    v.on_hand_units, v.t, v.bucket, v.reason
  FROM (
    SELECT u.*, MAX(u.src) OVER (PARTITION BY u.kind, u.item_id) AS covered
    FROM (
      SELECT c.kind, c.item_id, c.sale_id, c.return_id, c.product_id, c.quantity, c.recorded, c.correct, c.buggy_mean_usd, c.pos,
        c.on_hand_units, c.t, c.bucket, c.reason, 1 AS src
      FROM classified_items c WHERE c.bucket IS NOT NULL
      UNION ALL
      SELECT 'return', l.return_item_id, l.sale_id, l.return_id, l.product_id, l.quantity, l.recorded,
        COALESCE(l.first_correct, l.min_correct), l.buggy_mean_usd, NULL, NULL, l.t,
        CASE WHEN l.n_lines = 0 THEN 'needs_owner_review'
             WHEN l.n_unequal > 0 THEN 'unaffected'
             WHEN l.n_review > 0 THEN 'needs_owner_review'
             WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct THEN 'returns_sale_linked'
             WHEN l.n_repaired > 0 THEN 'needs_owner_review'
             ELSE 'unaffected' END,
        CASE WHEN l.n_lines = 0 THEN 'no_matching_sale_line'
             WHEN l.n_unequal > 0 THEN 'return_cost_not_copied_from_sale'
             WHEN l.n_review > 0 THEN 'follows_unrepaired_sale_line'
             WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct
               THEN CASE WHEN l.by_product = 1 THEN 'copied_from_sale_line_by_product' ELSE 'copied_from_sale_line' END
             WHEN l.n_repaired > 0 THEN 'sale_lines_of_product_now_differ'
             ELSE 'follows_sale_line' END,
        1
      FROM linked l
      UNION ALL
      SELECT s.kind, s.item_id, s.sale_id, s.return_id, s.product_id, s.quantity, s.recorded, NULL, NULL, NULL, NULL, s.t,
        'unbucketed', 'in_scope_line_not_classified', 0
      FROM scope s) u) v
  WHERE v.src = 1 OR v.covered = 0
)
-- plan:stop
SELECT c.kind, c.bucket, c.reason, c.item_id, c.sale_id, s.receipt_number, c.return_id, r.return_number, c.t AS line_at,
  c.product_id, c.quantity, c.recorded AS recorded_cost_usd, c.buggy_mean_usd, c.correct AS correct_cost_usd, c.on_hand_units,
  ROUND(c.quantity * (c.correct - c.recorded), 4) AS cost_delta_usd
FROM classified c LEFT JOIN sales s ON s.id = c.sale_id LEFT JOIN returns r ON r.id = c.return_id
WHERE c.bucket <> 'unaffected'
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
merge_ev AS MATERIALIZED (
  SELECT m.ord, m.at, CAST(json_extract(m.rev, '$.keeperId') AS INTEGER) AS keeper_id,
    CAST(json_extract(m.rev, '$.keeperPricingBefore.cost_price_usd') AS REAL) AS keeper_before,
    (SELECT pd.cost_price_usd FROM products pd WHERE pd.id = CAST(json_extract(m.rev, '$.dupId') AS INTEGER)) AS dup_cost,
    CAST(json_extract(m.rev, '$.keeperChoice.cost.cost_price_usd') AS REAL) AS chosen
  FROM merge_rev m
),
merge_b AS MATERIALIZED (
  SELECT v.keeper_id, v.at,
    ROUND(AVG(v.c), 4) AS b1,
    CAST(AVG(v.c) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
    CASE WHEN MAX(v.c) > 2 * MIN(v.c) THEN MAX(v.c) ELSE ROUND(AVG(v.c), 4) END AS b2
  FROM (SELECT ord, keeper_id, at, keeper_before AS c FROM merge_ev UNION SELECT ord, keeper_id, at, dup_cost FROM merge_ev) v
  WHERE v.c > 0
  GROUP BY v.ord, v.keeper_id, v.at
  UNION ALL
  SELECT keeper_id, at, chosen, chosen, chosen FROM merge_ev WHERE chosen > 0
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
    sm.sale_at AS born,
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
  SELECT 'return', -ri.id, ri.id, NULL, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at), datetime(r.created_at),
    COALESCE((SELECT MIN(im.id) FROM inventory_movements im
        WHERE im.reference_id = r.id AND im.movement_type = 'return' AND im.product_id = ri.product_id
          AND datetime(im.created_at) >= datetime(r.created_at, '-60 seconds')),
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= datetime(r.created_at)),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im))
  FROM return_items ri JOIN returns r ON r.id = ri.return_id
  WHERE r.sale_id IS NULL AND COALESCE(r.return_scope, 'customer') = 'customer' AND ri.sale_item_id IS NULL
    AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0 AND datetime(r.created_at) >= '2026-09-16 14:04:42'
),
item_ctx AS MATERIALIZED (
  SELECT x.*,
    CASE WHEN x.lot_owner <> COALESCE(x.moved_dup, x.product_now) THEN x.lot_owner ELSE COALESCE(x.moved_dup, x.product_now) END AS prod_at,
    x.moved_dup IS NOT NULL AS moved, COALESCE(x.lot_owner <> COALESCE(x.moved_dup, x.product_now), 0) AS orphan,
    CASE WHEN x.t >= x.fix_at THEN x.fix_at ELSE '2026-09-16 14:04:42' END AS since
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
    WHERE (it.t >= '2026-09-16 14:04:42' OR it.born >= '2026-09-16 14:04:42')
      AND (it.t < p.scan_end OR it.born < p.era_end)) x
),
lot_touch AS MATERIALIZED (
  SELECT im.batch_id AS lot_id, datetime(im.created_at) AS at
    FROM inventory_movements im
   WHERE im.movement_type IN ('add', 'stock_in') AND im.quantity > 0 AND im.batch_id IS NOT NULL
     AND im.created_at >= '2026-09-16 14:04:42'
  UNION
  SELECT CAST(a.entity_id AS INTEGER), datetime(a.created_at)
    FROM audit_logs a
   WHERE a.action = 'batch_update' AND a.entity = 'product_batch' AND datetime(a.created_at) >= '2026-09-16 14:04:42'
     AND (json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.unit_cost_usd') IS NOT NULL
       OR json_type(CASE WHEN json_valid(a.details) THEN a.details END, '$.is_active') IS NOT NULL)
),
setter AS MATERIALIZED (
  SELECT DISTINCT o.p, o.at FROM (
    SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lt.lot_id AND rm.at > lt.at
        ORDER BY rm.ord LIMIT 1), pb.variant_product_id) AS p, lt.at
      FROM lot_touch lt JOIN product_batches pb ON pb.id = lt.lot_id
    UNION
    SELECT COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pce.id
        AND rm.at > datetime(pce.created_at) ORDER BY rm.ord LIMIT 1), pce.product_id), datetime(pce.created_at)
      FROM product_cost_entries pce WHERE datetime(pce.created_at) >= '2026-09-16 14:04:42') o
  WHERE o.p IN (SELECT prod_at FROM item_ctx) AND o.at IS NOT NULL
),
anchor AS MATERIALIZED (
  SELECT ic.ik AS ak, ic.prod_at AS p, ic.t AS at, ic.kind, ic.item_id, ic.sale_id, ic.return_id, ic.product_now, ic.quantity,
    ic.recorded, ic.born, ic.t, ic.pos, ic.fix_at, ic.era_end, ic.moved, ic.orphan, ic.since
  FROM item_ctx ic
  UNION ALL
  SELECT 1000000000000 + ROW_NUMBER() OVER (ORDER BY s.p, s.at), s.p, s.at, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
  FROM setter s
),
anchor_me AS MATERIALIZED (
  SELECT x.*, pce.id IS NOT NULL AS has_me, pce.cost_usd AS me_cost, COALESCE(pce.baseline_batch_id, 0) AS me_baseline,
    nm.id IS NOT NULL AS now_has_me, nm.cost_usd AS now_me_cost, COALESCE(nm.baseline_batch_id, 0) AS now_me_baseline
  FROM (SELECT a.*,
      (SELECT pc.id FROM product_cost_entries pc
        WHERE (pc.product_id = a.p OR pc.id IN (SELECT rm.row_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = a.p))
          AND datetime(pc.created_at) <= a.at
          AND COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.row_id = pc.id AND rm.at > a.at
            ORDER BY rm.ord LIMIT 1), pc.product_id) = a.p
        ORDER BY pc.id DESC LIMIT 1) AS me_id,
      (SELECT pc.id FROM product_cost_entries pc WHERE pc.product_id = a.product_now AND datetime(pc.created_at) <= a.t
        ORDER BY pc.id DESC LIMIT 1) AS now_me_id,
      EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_cost_entries' AND rm.dup_id = a.p AND rm.at > a.t) AS me_moved
    FROM anchor a) x
  LEFT JOIN product_cost_entries pce ON pce.id = x.me_id
  LEFT JOIN product_cost_entries nm ON nm.id = x.now_me_id
),
cand_lots AS MATERIALIZED (
  SELECT pb.id AS lot_id FROM product_batches pb WHERE pb.variant_product_id IN (SELECT prod_at FROM item_ctx)
  UNION
  SELECT rm.row_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.dup_id IN (SELECT prod_at FROM item_ctx)
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
lot_base AS MATERIALIZED (
  SELECT pb.id AS lot_id, pb.is_active, pb.unit_cost_usd AS cost_now, datetime(pb.updated_at) AS updated_at,
    datetime(COALESCE(pb.created_at, pb.received_at)) AS created, COALESCE(pb.received_at, '') AS received_at,
    (SELECT im.unit_cost_usd FROM inventory_movements im
      WHERE im.batch_id = pb.id AND im.quantity > 0 AND im.unit_cost_usd > 0 ORDER BY im.id LIMIT 1) AS receipt_cost,
    (SELECT MAX(le.at) FROM lot_edit le WHERE le.lot_id = pb.id) AS last_edit_at,
    CASE WHEN b.lot_id IS NOT NULL
      OR (NOT EXISTS (SELECT 1 FROM inventory_movements im WHERE im.batch_id = pb.id)
        AND (COALESCE(pb.received_quantity, 0) > 0 OR COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id), 0) <> 0))
    THEN 1 ELSE 0 END AS bad
  FROM product_batches pb
  LEFT JOIN (
    SELECT DISTINCT w.lot_id FROM (
      SELECT e.lot_id, SUM(e.qty) OVER (PARTITION BY e.lot_id ORDER BY e.pos, e.qty DESC ROWS UNBOUNDED PRECEDING) AS running,
        SUM(e.qty) OVER (PARTITION BY e.lot_id) AS total
      FROM ev e) w
    WHERE w.running < 0
       OR w.total <> COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = w.lot_id), 0)) b ON b.lot_id = pb.id
  WHERE pb.id IN (SELECT lot_id FROM cand_lots)
),
lot_x AS MATERIALIZED (
  SELECT am.*, lb.lot_id, lb.created, lb.received_at, lb.bad,
    CASE WHEN lb.is_active = 1 OR lb.updated_at > am.at THEN 1 ELSE 0 END AS active_t,
    COALESCE(
      (SELECT le.cost FROM lot_edit le WHERE le.lot_id = lb.lot_id AND le.at <= am.at ORDER BY le.id DESC LIMIT 1),
      CASE WHEN lb.last_edit_at > am.at THEN COALESCE(lb.receipt_cost, lb.cost_now)
           WHEN lb.updated_at > am.at AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005
             THEN lb.receipt_cost END,
      lb.cost_now) AS cost_t,
    CASE WHEN (COALESCE(lb.is_active, 0) <> 1 AND lb.updated_at > am.at)
      OR lb.last_edit_at > am.at
      OR (lb.updated_at > am.at AND lb.receipt_cost IS NOT NULL AND ABS(lb.receipt_cost - COALESCE(lb.cost_now, 0)) >= 0.00005)
      OR EXISTS (SELECT 1 FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lb.lot_id AND rm.at > am.at)
    THEN 1 ELSE 0 END AS changed
  FROM anchor_me am
  LEFT JOIN (
    SELECT pb.id AS lot_id, pb.variant_product_id AS key_p, pb.variant_product_id AS cur_p FROM product_batches pb
    UNION
    SELECT rm.row_id, rm.dup_id, pb.variant_product_id
      FROM row_move rm JOIN product_batches pb ON pb.id = rm.row_id WHERE rm.tbl = 'product_batches') lk
    ON lk.key_p = am.p
   AND COALESCE((SELECT rm.dup_id FROM row_move rm WHERE rm.tbl = 'product_batches' AND rm.row_id = lk.lot_id AND rm.at > am.at
         ORDER BY rm.ord LIMIT 1), lk.cur_p) = am.p
  LEFT JOIN lot_base lb ON lb.lot_id = lk.lot_id
),
lot_q AS MATERIALIZED (
  SELECT w.ak, w.lot_id, w.q FROM (
    SELECT u.ak, u.lot_id, u.is_ev,
      SUM(u.qty) OVER (PARTITION BY u.lot_id ORDER BY u.pos, u.is_ev ROWS UNBOUNDED PRECEDING) AS q
    FROM (SELECT lx.ak, lx.lot_id, lx.pos, 0 AS is_ev, 0 AS qty FROM lot_x lx
           WHERE lx.lot_id IS NOT NULL AND lx.active_t = 1 AND lx.ak < 1000000000000
          UNION ALL
          SELECT NULL, e.lot_id, e.pos, 1, e.qty FROM ev e) u) w
  WHERE w.is_ev = 0
),
lot_rows AS MATERIALIZED (
  SELECT y.*, ROW_NUMBER() OVER (PARTITION BY y.ak, y.eligible ORDER BY y.received_at DESC, y.lot_id DESC) AS fb_rank
  FROM (
    SELECT lx.*,
      CASE WHEN lx.lot_id IS NOT NULL AND lx.active_t = 1 AND lx.cost_t > 0 AND lx.created <= lx.at AND (lx.has_me = 0 OR lx.lot_id > lx.me_baseline)
        THEN 1 ELSE 0 END AS eligible,
      lq.q
    FROM lot_x lx LEFT JOIN lot_q lq ON lq.ak = lx.ak AND lq.lot_id = lx.lot_id) y
),
ak_agg AS MATERIALIZED (
  SELECT r.ak, r.p, r.at, r.kind, r.item_id, r.sale_id, r.return_id, r.product_now, r.quantity, r.recorded, r.born, r.t, r.pos,
    r.fix_at, r.era_end, r.moved, r.orphan, r.since, r.me_moved, r.now_has_me, r.now_me_cost, r.now_me_baseline,
    ROUND(AVG(DISTINCT r.hc), 4) AS b1,
    CAST(AVG(DISTINCT r.hc) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
    CASE WHEN MAX(r.hc) > 2 * MIN(r.hc) THEN MAX(r.hc) ELSE ROUND(AVG(DISTINCT r.hc), 4) END AS b2,
    CASE WHEN SUM(r.wq) > 0 THEN CAST(SUM(r.wq * r.wc) / SUM(r.wq) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END AS w,
    SUM(r.wq) AS on_hand_units,
    MAX(CASE WHEN r.u = 0 AND r.active_t = 1 AND r.created <= r.at AND r.bad = 1 THEN 1 ELSE 0 END) AS unverified,
    MAX(CASE WHEN r.u = 0 AND r.changed = 1 AND r.created <= r.at THEN 1 ELSE 0 END) AS lot_changed,
    MAX(CASE WHEN r.u = 0 AND r.fb_rank = 1 AND r.eligible = 1 THEN r.cost_t END) AS fallback
  FROM (
    SELECT lr.*, u.k AS u,
      CASE WHEN u.k = 0 THEN CASE WHEN lr.eligible = 1 THEN lr.cost_t END
           ELSE CASE WHEN lr.has_me = 1 AND lr.me_cost > 0 THEN lr.me_cost END END AS hc,
      CASE WHEN lr.has_me = 1 AND lr.lot_id <= lr.me_baseline THEN lr.me_cost ELSE lr.cost_t END AS wc,
      CASE WHEN u.k = 0 AND lr.q > 0 AND (CASE WHEN lr.has_me = 1 AND lr.lot_id <= lr.me_baseline THEN lr.me_cost ELSE lr.cost_t END) > 0
        THEN lr.q END AS wq
    FROM lot_rows lr CROSS JOIN (SELECT 0 AS k UNION ALL SELECT 1) u) r
  GROUP BY r.ak
),
item_match AS MATERIALIZED (
  SELECT g.*,
    CASE WHEN ABS(g.recorded - g.b1) < 0.00006 OR ABS(g.recorded - g.b1h) < 0.00006 OR ABS(g.recorded - g.b2) < 0.00006 THEN 1 ELSE 0 END AS h_match,
    CASE WHEN EXISTS (SELECT 1 FROM merge_b mb WHERE mb.keeper_id = g.p AND mb.at >= g.since AND mb.at <= g.t
      AND (ABS(g.recorded - mb.b1) < 0.00006 OR ABS(g.recorded - mb.b1h) < 0.00006 OR ABS(g.recorded - mb.b2) < 0.00006)) THEN 1 ELSE 0 END AS m_match,
    CASE WHEN g.s_any = 1 OR EXISTS (SELECT 1 FROM merge_ev me WHERE me.keeper_id = g.p AND me.at >= g.since AND me.at <= g.t)
      THEN 1 ELSE 0 END AS has_setter,
    COALESCE((SELECT CASE WHEN ABS(g.recorded - ROUND(AVG(n.c), 4)) < 0.00006
          OR ABS(g.recorded - CAST(AVG(n.c) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0) < 0.00006
          OR ABS(g.recorded - CASE WHEN MAX(n.c) > 2 * MIN(n.c) THEN MAX(n.c) ELSE ROUND(AVG(n.c), 4) END) < 0.00006 THEN 1 ELSE 0 END
        FROM (SELECT pb.unit_cost_usd AS c FROM product_batches pb
               WHERE pb.variant_product_id = g.product_now AND pb.is_active = 1 AND pb.unit_cost_usd > 0
                 AND datetime(COALESCE(pb.created_at, pb.received_at)) <= g.t
                 AND (g.now_has_me = 0 OR pb.id > g.now_me_baseline)
              UNION
              SELECT g.now_me_cost WHERE g.now_has_me = 1 AND g.now_me_cost > 0) n), 0) AS n_match
  FROM (
    SELECT i.*,
      MAX(CASE WHEN ABS(i.recorded - s.b1) < 0.00006 OR ABS(i.recorded - s.b1h) < 0.00006 OR ABS(i.recorded - s.b2) < 0.00006
        THEN 1 ELSE 0 END) AS s_match,
      MAX(CASE WHEN s.ak IS NOT NULL THEN 1 ELSE 0 END) AS s_any
    FROM ak_agg i LEFT JOIN ak_agg s ON s.ak >= 1000000000000 AND s.p = i.p AND s.at >= i.since AND s.at <= i.t
    WHERE i.ak < 1000000000000
    GROUP BY i.ak) g
),
classified_items AS MATERIALIZED (
  SELECT g.*,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.matched = 1 AND g.differs = 1 THEN 'after_window'
        WHEN g.born < g.era_end THEN 'unaffected' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'needs_owner_review'
      WHEN g.matched = 1 AND g.correct IS NULL THEN 'needs_owner_review'
      WHEN g.matched = 1 AND g.unverified = 1 THEN 'ledger_unverified'
      WHEN g.matched = 1 AND g.differs = 0 THEN 'already_correct'
      WHEN g.matched = 1 AND g.kind = 'return' THEN 'returns_walk_in'
      WHEN g.matched = 1 AND g.t >= g.fix_at THEN 'window'
      WHEN g.matched = 1 THEN 'repair'
      WHEN g.differs = 0 THEN 'unaffected'
      WHEN g.n_match = 1 OR g.uncertain = 1 THEN 'needs_owner_review'
      WHEN g.t < g.fix_at AND g.has_setter = 0 THEN 'unaffected'
      ELSE 'needs_owner_review'
    END AS bucket,
    CASE
      WHEN g.t >= g.era_end THEN CASE WHEN g.matched = 1 AND g.differs = 1 THEN 'buggy_average_after_deploy_window' ELSE 'after_deploy_window' END
      WHEN g.orphan = 1 AND g.differs = 1 THEN 'sold_lot_belongs_to_another_product'
      WHEN g.matched = 1 AND g.correct IS NULL THEN 'no_derivable_cost'
      WHEN g.matched = 1 AND g.unverified = 1 THEN 'lot_ledger_does_not_reconcile'
      WHEN g.matched = 1 AND g.differs = 0 THEN 'buggy_average_equalled_on_hand'
      WHEN g.matched = 1 AND g.kind = 'sale' AND g.t >= g.fix_at THEN g.producer || '_deploy_window'
      WHEN g.matched = 1 THEN g.producer
      WHEN g.differs = 0 THEN CASE WHEN g.correct IS NULL THEN 'no_lot_cost_at_line' ELSE 'recorded_equals_on_hand' END
      WHEN g.n_match = 1 THEN 'matches_only_todays_lot_state'
      WHEN g.uncertain = 1 THEN 'lot_history_changed_after_sale'
      WHEN g.t < g.fix_at AND g.has_setter = 0 THEN 'catalog_cost_set_before_era'
      ELSE 'recorded_cost_unexplained'
    END AS reason
  FROM (
    SELECT f.*, CASE WHEN f.correct IS NULL OR ABS(f.recorded - f.correct) < 0.00005 THEN 0 ELSE 1 END AS differs,
      CASE WHEN f.h_match = 1 OR f.s_match = 1 OR f.m_match = 1 THEN 1 ELSE 0 END AS matched,
      CASE WHEN f.h_match = 1 THEN 'buggy_average' WHEN f.s_match = 1 THEN 'stale_buggy_average' ELSE 'stale_merge_cost' END AS producer
    FROM (
      SELECT m.kind, m.item_id, m.sale_id, m.return_id, m.product_now AS product_id, m.quantity, m.recorded, m.t, m.born, m.pos,
        m.fix_at, m.era_end, COALESCE(m.w, m.fallback) AS correct, COALESCE(m.on_hand_units, 0) AS on_hand_units,
        m.h_match, m.s_match, m.m_match, m.n_match, m.has_setter, m.b1 AS buggy_mean_usd,
        COALESCE(m.unverified, 0) AS unverified, m.orphan,
        CASE WHEN m.moved = 1 OR m.me_moved = 1 OR COALESCE(m.lot_changed, 0) = 1 THEN 1 ELSE 0 END AS uncertain
      FROM item_match m) f) g
),
linked AS MATERIALIZED (
  SELECT y.return_item_id, y.return_id, y.sale_id, y.product_id, y.quantity, y.recorded, y.t, y.by_product, y.n_lines, y.n_unequal,
    SUM(CASE WHEN y.hit = 1 AND y.bucket IN ('repair', 'window') THEN 1 ELSE 0 END) AS n_repaired,
    SUM(CASE WHEN y.hit = 1 AND y.bucket IN ('ledger_unverified', 'needs_owner_review', 'after_window') THEN 1 ELSE 0 END) AS n_review,
    MIN(CASE WHEN y.hit = 1 THEN y.correct END) AS min_correct,
    MAX(CASE WHEN y.hit = 1 THEN y.correct END) AS max_correct,
    MAX(CASE WHEN y.item_id = y.first_line_id THEN y.correct END) AS first_correct,
    MAX(CASE WHEN y.hit = 1 THEN y.buggy_mean_usd END) AS buggy_mean_usd
  FROM (
    SELECT rl.*, c.item_id, c.bucket, c.correct, c.buggy_mean_usd,
      CASE WHEN c.item_id = rl.sale_item_id OR (rl.sale_item_id IS NULL AND sc.product_id = rl.product_id
        AND (rl.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = rl.branch_id)) THEN 1 ELSE 0 END AS hit
    FROM (
      SELECT z.*,
        (SELECT COUNT(*) FROM sale_items sc WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS n_lines,
        (SELECT COALESCE(SUM(CASE WHEN ABS(sc.cost_price_usd - z.recorded) < 0.00006 THEN 0 ELSE 1 END), 0) FROM sale_items sc
          WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS n_unequal,
        (SELECT MIN(sc.id) FROM sale_items sc WHERE sc.sale_id = z.sale_id AND (sc.id = z.sale_item_id OR (z.sale_item_id IS NULL
          AND sc.product_id = z.product_id AND (z.branch_id IS NULL OR sc.branch_id IS NULL OR sc.branch_id = z.branch_id)))) AS first_line_id
      FROM (
        SELECT ri.id AS return_item_id, r.id AS return_id, r.sale_id, ri.product_id, ri.quantity, ri.cost_price_usd AS recorded,
          datetime(r.created_at) AS t, ri.sale_item_id IS NULL AS by_product, ri.sale_item_id, ri.branch_id
        FROM returns r JOIN return_items ri ON ri.return_id = r.id
        WHERE r.sale_id IS NOT NULL AND COALESCE(r.return_scope, 'customer') = 'customer'
          AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0) z) rl
    JOIN classified_items c ON c.kind = 'sale' AND c.sale_id = rl.sale_id
    JOIN sale_items sc ON sc.id = c.item_id) y
  GROUP BY y.return_item_id
  HAVING MAX(CASE WHEN y.bucket IS NOT NULL THEN 1 ELSE 0 END) = 1
),
scope AS MATERIALIZED (
  SELECT 'sale' AS kind, si.id AS item_id, si.sale_id, NULL AS return_id, si.product_id, si.quantity, si.cost_price_usd AS recorded,
    datetime(s.created_at) AS t
  FROM sales s JOIN sale_items si ON si.sale_id = s.id JOIN params p
  WHERE si.product_id IS NOT NULL AND si.cost_price_usd > 0
    AND datetime(s.created_at) >= '2026-09-16 14:04:42' AND datetime(s.created_at) < p.era_end
  UNION ALL
  SELECT 'return', ri.id, r.sale_id, r.id, ri.product_id, ri.quantity, ri.cost_price_usd, datetime(r.created_at)
  FROM returns r JOIN return_items ri ON ri.return_id = r.id JOIN params p
  WHERE COALESCE(r.return_scope, 'customer') = 'customer' AND ri.product_id IS NOT NULL AND ri.cost_price_usd > 0
    AND r.sale_id IS NULL AND ri.sale_item_id IS NULL
    AND datetime(r.created_at) >= '2026-09-16 14:04:42' AND datetime(r.created_at) < p.era_end
),
classified AS MATERIALIZED (
  SELECT v.kind, v.item_id, v.sale_id, v.return_id, v.product_id, v.quantity, v.recorded, v.correct, v.buggy_mean_usd, v.pos,
    v.on_hand_units, v.t, v.bucket, v.reason
  FROM (
    SELECT u.*, MAX(u.src) OVER (PARTITION BY u.kind, u.item_id) AS covered
    FROM (
      SELECT c.kind, c.item_id, c.sale_id, c.return_id, c.product_id, c.quantity, c.recorded, c.correct, c.buggy_mean_usd, c.pos,
        c.on_hand_units, c.t, c.bucket, c.reason, 1 AS src
      FROM classified_items c WHERE c.bucket IS NOT NULL
      UNION ALL
      SELECT 'return', l.return_item_id, l.sale_id, l.return_id, l.product_id, l.quantity, l.recorded,
        COALESCE(l.first_correct, l.min_correct), l.buggy_mean_usd, NULL, NULL, l.t,
        CASE WHEN l.n_lines = 0 THEN 'needs_owner_review'
             WHEN l.n_unequal > 0 THEN 'unaffected'
             WHEN l.n_review > 0 THEN 'needs_owner_review'
             WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct THEN 'returns_sale_linked'
             WHEN l.n_repaired > 0 THEN 'needs_owner_review'
             ELSE 'unaffected' END,
        CASE WHEN l.n_lines = 0 THEN 'no_matching_sale_line'
             WHEN l.n_unequal > 0 THEN 'return_cost_not_copied_from_sale'
             WHEN l.n_review > 0 THEN 'follows_unrepaired_sale_line'
             WHEN l.n_repaired = l.n_lines AND l.min_correct = l.max_correct
               THEN CASE WHEN l.by_product = 1 THEN 'copied_from_sale_line_by_product' ELSE 'copied_from_sale_line' END
             WHEN l.n_repaired > 0 THEN 'sale_lines_of_product_now_differ'
             ELSE 'follows_sale_line' END,
        1
      FROM linked l
      UNION ALL
      SELECT s.kind, s.item_id, s.sale_id, s.return_id, s.product_id, s.quantity, s.recorded, NULL, NULL, NULL, NULL, s.t,
        'unbucketed', 'in_scope_line_not_classified', 0
      FROM scope s) u) v
  WHERE v.src = 1 OR v.covered = 0
)
-- plan:stop
-- One reference to classified: each reference re-expands the whole plan at prepare time.
SELECT
  ROUND(COALESCE(SUM(CASE WHEN c.kind = 'sale' AND c.bucket IN ('repair', 'window') AND s.id IS NOT NULL
      AND lower(trim(COALESCE(s.sale_status, ''))) <> 'cancelled' THEN c.quantity * (c.correct - c.recorded) END), 0), 4) AS sold_cost_delta_usd,
  ROUND(COALESCE(SUM(CASE WHEN c.kind = 'return' AND c.bucket IN ('returns_sale_linked', 'returns_walk_in') AND ri.return_to_stock = 1
      THEN c.quantity * (c.correct - c.recorded) END), 0), 4) AS returned_cost_delta_usd,
  COUNT(CASE WHEN c.kind = 'return' AND c.bucket IN ('returns_sale_linked', 'returns_walk_in') THEN 1 END) AS return_lines
FROM classified c
LEFT JOIN sales s ON c.kind = 'sale' AND s.id = c.sale_id
LEFT JOIN return_items ri ON c.kind = 'return' AND ri.id = c.item_id;
