-- Sale line cost audit for held migration 0200 (U-cost, owner decision 2026-09-26).
-- READ-ONLY: every statement is a single SELECT. Run it AFTER migration 0195
-- is applied: the era of the buggy average ends at 0195's apply time
-- (catalog_cost_repair_0195_backup.created_at), and before 0195 that table
-- does not exist, so every statement fails with "no such table" by design.
-- Run each statement on its
-- own with --command (wrangler d1 execute --file returns no rows); the exact
-- owner-run commands, and which numbers to read, are in the header of
-- ops/scripts/migration/held/0200_sale_cost_on_hand_repair.sql (OWNER-RUN AUDIT).
-- The plan text between plan:begin and plan:stop is byte-identical to
-- ops/scripts/migration/held/0200_sale_cost_on_hand_repair.sql (pinned by
-- cloudflare/scripts/test-held-0200-sale-cost-repair-pure.cjs); the
-- method, guard and limits are documented in that migration's header.
--
-- Buckets:
--   repair             -- 0200 rewrites the line cost (and copied return lines)
--   ledger_unverified  -- came from the buggy average, but a lot of the product
--                         does not reconcile; left alone, owner decision
--   already_correct    -- came from the buggy average, which equalled the
--                         on-hand cost (single-cost shelf)
--   no_derivable_cost  -- no lot with a recorded cost existed at the sale
-- Lines whose cost did not come from the buggy average are not listed.

-- 1. Bucket summary: lines, units, cost delta (correct - recorded) x qty.
-- plan:begin
WITH
params AS (
  SELECT '2026-09-16 14:04:42' AS era_start,
    COALESCE((SELECT MIN(datetime(created_at)) FROM catalog_cost_repair_0195_backup), '9999-12-31 23:59:59') AS era_end
),
lines AS (
  SELECT si.id AS sale_item_id, si.sale_id, si.product_id, si.quantity, si.cost_price_usd AS recorded,
    datetime(s.created_at) AS sale_at,
    (SELECT MIN(im.id) FROM inventory_movements im
      WHERE im.reference_id = si.sale_id AND im.movement_type = 'sale' AND im.product_id = si.product_id
        AND im.unit_cost_usd IS NOT NULL AND ABS(im.unit_cost_usd - si.cost_price_usd) < 0.00006) AS mv_id
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  JOIN params p
  WHERE si.product_id IS NOT NULL AND si.cost_price_usd > 0
    AND datetime(s.created_at) >= p.era_start AND datetime(s.created_at) < p.era_end
),
lpos AS (
  SELECT l.*,
    COALESCE(l.mv_id,
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= l.sale_at),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im)) AS pos,
    (SELECT COUNT(*) FROM product_cost_entries pce
      WHERE pce.product_id = l.product_id AND datetime(pce.created_at) <= l.sale_at) > 0 AS has_me,
    (SELECT pce.cost_usd FROM product_cost_entries pce
      WHERE pce.product_id = l.product_id AND datetime(pce.created_at) <= l.sale_at ORDER BY pce.id DESC LIMIT 1) AS me_cost,
    COALESCE((SELECT pce.baseline_batch_id FROM product_cost_entries pce
      WHERE pce.product_id = l.product_id AND datetime(pce.created_at) <= l.sale_at ORDER BY pce.id DESC LIMIT 1), 0) AS me_baseline
  FROM lines l
),
buggy_set AS (
  SELECT lp.sale_item_id, pb.unit_cost_usd AS cost
    FROM lpos lp JOIN product_batches pb ON pb.variant_product_id = lp.product_id
   WHERE pb.is_active = 1 AND pb.unit_cost_usd > 0
     AND (lp.has_me = 0 OR pb.id > lp.me_baseline)
     AND datetime(COALESCE(pb.created_at, pb.received_at)) <= lp.sale_at
  UNION
  SELECT lp.sale_item_id, lp.me_cost FROM lpos lp WHERE lp.has_me = 1 AND lp.me_cost > 0
),
buggy AS (
  SELECT sale_item_id,
    ROUND(AVG(cost), 4) AS b1,
    CAST(AVG(cost) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
    CASE WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost) ELSE ROUND(AVG(cost), 4) END AS b2
  FROM buggy_set GROUP BY sale_item_id
),
cand AS (
  SELECT lp.*, b.b1, b.b2 FROM lpos lp JOIN buggy b ON b.sale_item_id = lp.sale_item_id
   WHERE ABS(lp.recorded - b.b1) < 0.00006 OR ABS(lp.recorded - b.b1h) < 0.00006 OR ABS(lp.recorded - b.b2) < 0.00006
),
cand_lots AS (
  SELECT pb.id AS lot_id, pb.variant_product_id AS product_id, pb.is_active, pb.unit_cost_usd AS cost,
    COALESCE(pb.received_quantity, 0) AS received_quantity
  FROM product_batches pb WHERE pb.variant_product_id IN (SELECT product_id FROM cand)
),
alloc_pos AS (
  SELECT si.id AS sale_item_id,
    (SELECT MIN(im.id) FROM inventory_movements im
      WHERE im.reference_id = si.sale_id AND im.movement_type = 'sale' AND im.product_id = si.product_id AND im.batch_id IS NULL) AS pos
  FROM sale_items si
  WHERE si.id IN (SELECT a.sale_item_id FROM sale_item_batch_allocations a WHERE a.batch_id IN (SELECT lot_id FROM cand_lots))
),
ev AS (
  SELECT im.batch_id AS lot_id, im.id AS pos, im.quantity AS qty
    FROM inventory_movements im WHERE im.batch_id IN (SELECT lot_id FROM cand_lots)
  UNION ALL
  SELECT a.batch_id, ap.pos, -(a.quantity - COALESCE(a.released_quantity, 0))
    FROM sale_item_batch_allocations a JOIN alloc_pos ap ON ap.sale_item_id = a.sale_item_id
   WHERE a.batch_id IN (SELECT lot_id FROM cand_lots) AND ap.pos IS NOT NULL
),
ev_total AS (
  SELECT lot_id, SUM(qty) AS ledger_total, COUNT(*) AS events FROM ev GROUP BY lot_id
),
lot_check AS (
  SELECT cl.lot_id, cl.product_id,
    COALESCE(et.ledger_total, 0) AS ledger_total,
    COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = cl.lot_id), 0) AS on_hand_now,
    COALESCE(et.events, 0) AS events,
    cl.received_quantity
  FROM cand_lots cl LEFT JOIN ev_total et ON et.lot_id = cl.lot_id
  WHERE cl.is_active = 1
),
lot_negative AS (
  SELECT lot_id FROM (
    SELECT e.lot_id, SUM(e.qty) OVER (PARTITION BY e.lot_id ORDER BY e.pos, e.qty DESC ROWS UNBOUNDED PRECEDING) AS running
    FROM ev e)
  WHERE running < 0 GROUP BY lot_id
),
bad_products AS (
  SELECT DISTINCT lc.product_id FROM lot_check lc
   WHERE lc.ledger_total <> lc.on_hand_now
      OR (lc.events = 0 AND lc.received_quantity > 0)
      OR lc.lot_id IN (SELECT lot_id FROM lot_negative)
),
onhand AS (
  SELECT c.sale_item_id, e.lot_id, SUM(e.qty) AS q
    FROM cand c
    JOIN cand_lots cl ON cl.product_id = c.product_id AND cl.is_active = 1
    JOIN ev e ON e.lot_id = cl.lot_id AND e.pos < c.pos
   GROUP BY c.sale_item_id, e.lot_id
),
terms AS (
  SELECT c.sale_item_id, cl.cost, o.q AS qty
    FROM cand c JOIN onhand o ON o.sale_item_id = c.sale_item_id JOIN cand_lots cl ON cl.lot_id = o.lot_id
   WHERE cl.cost > 0 AND o.q > 0 AND (c.has_me = 0 OR cl.lot_id > c.me_baseline)
  UNION ALL
  SELECT c.sale_item_id, c.me_cost, SUM(o.q)
    FROM cand c JOIN onhand o ON o.sale_item_id = c.sale_item_id JOIN cand_lots cl ON cl.lot_id = o.lot_id
   WHERE c.has_me = 1 AND c.me_cost > 0 AND cl.lot_id <= c.me_baseline AND o.q > 0
   GROUP BY c.sale_item_id, c.me_cost
),
weighted AS (
  SELECT sale_item_id,
    CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END AS w,
    SUM(qty) AS on_hand_units
  FROM terms GROUP BY sale_item_id
),
plan AS (
  SELECT c.sale_item_id, c.sale_id, c.product_id, c.quantity, c.recorded, c.b1 AS buggy_mean_usd, c.pos,
    COALESCE(w.w,
      (SELECT pb.unit_cost_usd FROM product_batches pb
        WHERE pb.variant_product_id = c.product_id AND pb.is_active = 1 AND pb.unit_cost_usd > 0
          AND (c.has_me = 0 OR pb.id > c.me_baseline)
          AND datetime(COALESCE(pb.created_at, pb.received_at)) <= c.sale_at
        ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS correct,
    COALESCE(w.on_hand_units, 0) AS on_hand_units,
    CASE WHEN c.product_id IN (SELECT product_id FROM bad_products) THEN 0 ELSE 1 END AS verified
  FROM cand c LEFT JOIN weighted w ON w.sale_item_id = c.sale_item_id
),
classified AS (
  SELECT plan.*,
    CASE WHEN correct IS NULL THEN 'no_derivable_cost'
         WHEN ABS(recorded - correct) < 0.00005 THEN 'already_correct'
         WHEN verified = 0 THEN 'ledger_unverified'
         ELSE 'repair' END AS bucket
  FROM plan
)
-- plan:stop
SELECT bucket, COUNT(*) AS lines, ROUND(SUM(quantity), 4) AS units,
  ROUND(SUM(quantity * (correct - recorded)), 4) AS cost_delta_usd
FROM classified GROUP BY bucket ORDER BY bucket;

-- 2. Every candidate line, with its sale and product.
-- plan:begin
WITH
params AS (
  SELECT '2026-09-16 14:04:42' AS era_start,
    COALESCE((SELECT MIN(datetime(created_at)) FROM catalog_cost_repair_0195_backup), '9999-12-31 23:59:59') AS era_end
),
lines AS (
  SELECT si.id AS sale_item_id, si.sale_id, si.product_id, si.quantity, si.cost_price_usd AS recorded,
    datetime(s.created_at) AS sale_at,
    (SELECT MIN(im.id) FROM inventory_movements im
      WHERE im.reference_id = si.sale_id AND im.movement_type = 'sale' AND im.product_id = si.product_id
        AND im.unit_cost_usd IS NOT NULL AND ABS(im.unit_cost_usd - si.cost_price_usd) < 0.00006) AS mv_id
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  JOIN params p
  WHERE si.product_id IS NOT NULL AND si.cost_price_usd > 0
    AND datetime(s.created_at) >= p.era_start AND datetime(s.created_at) < p.era_end
),
lpos AS (
  SELECT l.*,
    COALESCE(l.mv_id,
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= l.sale_at),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im)) AS pos,
    (SELECT COUNT(*) FROM product_cost_entries pce
      WHERE pce.product_id = l.product_id AND datetime(pce.created_at) <= l.sale_at) > 0 AS has_me,
    (SELECT pce.cost_usd FROM product_cost_entries pce
      WHERE pce.product_id = l.product_id AND datetime(pce.created_at) <= l.sale_at ORDER BY pce.id DESC LIMIT 1) AS me_cost,
    COALESCE((SELECT pce.baseline_batch_id FROM product_cost_entries pce
      WHERE pce.product_id = l.product_id AND datetime(pce.created_at) <= l.sale_at ORDER BY pce.id DESC LIMIT 1), 0) AS me_baseline
  FROM lines l
),
buggy_set AS (
  SELECT lp.sale_item_id, pb.unit_cost_usd AS cost
    FROM lpos lp JOIN product_batches pb ON pb.variant_product_id = lp.product_id
   WHERE pb.is_active = 1 AND pb.unit_cost_usd > 0
     AND (lp.has_me = 0 OR pb.id > lp.me_baseline)
     AND datetime(COALESCE(pb.created_at, pb.received_at)) <= lp.sale_at
  UNION
  SELECT lp.sale_item_id, lp.me_cost FROM lpos lp WHERE lp.has_me = 1 AND lp.me_cost > 0
),
buggy AS (
  SELECT sale_item_id,
    ROUND(AVG(cost), 4) AS b1,
    CAST(AVG(cost) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
    CASE WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost) ELSE ROUND(AVG(cost), 4) END AS b2
  FROM buggy_set GROUP BY sale_item_id
),
cand AS (
  SELECT lp.*, b.b1, b.b2 FROM lpos lp JOIN buggy b ON b.sale_item_id = lp.sale_item_id
   WHERE ABS(lp.recorded - b.b1) < 0.00006 OR ABS(lp.recorded - b.b1h) < 0.00006 OR ABS(lp.recorded - b.b2) < 0.00006
),
cand_lots AS (
  SELECT pb.id AS lot_id, pb.variant_product_id AS product_id, pb.is_active, pb.unit_cost_usd AS cost,
    COALESCE(pb.received_quantity, 0) AS received_quantity
  FROM product_batches pb WHERE pb.variant_product_id IN (SELECT product_id FROM cand)
),
alloc_pos AS (
  SELECT si.id AS sale_item_id,
    (SELECT MIN(im.id) FROM inventory_movements im
      WHERE im.reference_id = si.sale_id AND im.movement_type = 'sale' AND im.product_id = si.product_id AND im.batch_id IS NULL) AS pos
  FROM sale_items si
  WHERE si.id IN (SELECT a.sale_item_id FROM sale_item_batch_allocations a WHERE a.batch_id IN (SELECT lot_id FROM cand_lots))
),
ev AS (
  SELECT im.batch_id AS lot_id, im.id AS pos, im.quantity AS qty
    FROM inventory_movements im WHERE im.batch_id IN (SELECT lot_id FROM cand_lots)
  UNION ALL
  SELECT a.batch_id, ap.pos, -(a.quantity - COALESCE(a.released_quantity, 0))
    FROM sale_item_batch_allocations a JOIN alloc_pos ap ON ap.sale_item_id = a.sale_item_id
   WHERE a.batch_id IN (SELECT lot_id FROM cand_lots) AND ap.pos IS NOT NULL
),
ev_total AS (
  SELECT lot_id, SUM(qty) AS ledger_total, COUNT(*) AS events FROM ev GROUP BY lot_id
),
lot_check AS (
  SELECT cl.lot_id, cl.product_id,
    COALESCE(et.ledger_total, 0) AS ledger_total,
    COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = cl.lot_id), 0) AS on_hand_now,
    COALESCE(et.events, 0) AS events,
    cl.received_quantity
  FROM cand_lots cl LEFT JOIN ev_total et ON et.lot_id = cl.lot_id
  WHERE cl.is_active = 1
),
lot_negative AS (
  SELECT lot_id FROM (
    SELECT e.lot_id, SUM(e.qty) OVER (PARTITION BY e.lot_id ORDER BY e.pos, e.qty DESC ROWS UNBOUNDED PRECEDING) AS running
    FROM ev e)
  WHERE running < 0 GROUP BY lot_id
),
bad_products AS (
  SELECT DISTINCT lc.product_id FROM lot_check lc
   WHERE lc.ledger_total <> lc.on_hand_now
      OR (lc.events = 0 AND lc.received_quantity > 0)
      OR lc.lot_id IN (SELECT lot_id FROM lot_negative)
),
onhand AS (
  SELECT c.sale_item_id, e.lot_id, SUM(e.qty) AS q
    FROM cand c
    JOIN cand_lots cl ON cl.product_id = c.product_id AND cl.is_active = 1
    JOIN ev e ON e.lot_id = cl.lot_id AND e.pos < c.pos
   GROUP BY c.sale_item_id, e.lot_id
),
terms AS (
  SELECT c.sale_item_id, cl.cost, o.q AS qty
    FROM cand c JOIN onhand o ON o.sale_item_id = c.sale_item_id JOIN cand_lots cl ON cl.lot_id = o.lot_id
   WHERE cl.cost > 0 AND o.q > 0 AND (c.has_me = 0 OR cl.lot_id > c.me_baseline)
  UNION ALL
  SELECT c.sale_item_id, c.me_cost, SUM(o.q)
    FROM cand c JOIN onhand o ON o.sale_item_id = c.sale_item_id JOIN cand_lots cl ON cl.lot_id = o.lot_id
   WHERE c.has_me = 1 AND c.me_cost > 0 AND cl.lot_id <= c.me_baseline AND o.q > 0
   GROUP BY c.sale_item_id, c.me_cost
),
weighted AS (
  SELECT sale_item_id,
    CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END AS w,
    SUM(qty) AS on_hand_units
  FROM terms GROUP BY sale_item_id
),
plan AS (
  SELECT c.sale_item_id, c.sale_id, c.product_id, c.quantity, c.recorded, c.b1 AS buggy_mean_usd, c.pos,
    COALESCE(w.w,
      (SELECT pb.unit_cost_usd FROM product_batches pb
        WHERE pb.variant_product_id = c.product_id AND pb.is_active = 1 AND pb.unit_cost_usd > 0
          AND (c.has_me = 0 OR pb.id > c.me_baseline)
          AND datetime(COALESCE(pb.created_at, pb.received_at)) <= c.sale_at
        ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS correct,
    COALESCE(w.on_hand_units, 0) AS on_hand_units,
    CASE WHEN c.product_id IN (SELECT product_id FROM bad_products) THEN 0 ELSE 1 END AS verified
  FROM cand c LEFT JOIN weighted w ON w.sale_item_id = c.sale_item_id
),
classified AS (
  SELECT plan.*,
    CASE WHEN correct IS NULL THEN 'no_derivable_cost'
         WHEN ABS(recorded - correct) < 0.00005 THEN 'already_correct'
         WHEN verified = 0 THEN 'ledger_unverified'
         ELSE 'repair' END AS bucket
  FROM plan
)
-- plan:stop
SELECT c.bucket, c.sale_item_id, c.sale_id, s.receipt_number, s.created_at, s.sale_status, c.product_id, si.product_name,
  c.quantity, c.recorded AS recorded_cost_usd, c.buggy_mean_usd, c.correct AS on_hand_cost_usd, c.on_hand_units,
  ROUND(c.quantity * (c.correct - c.recorded), 4) AS cost_delta_usd
FROM classified c JOIN sales s ON s.id = c.sale_id JOIN sale_items si ON si.id = c.sale_item_id
ORDER BY c.bucket, s.created_at, c.sale_item_id;

-- 3. Report effect of the repair bucket: COGS on recognized (not cancelled)
--    sales, and the restocked-return cost that COGS subtracts.
-- plan:begin
WITH
params AS (
  SELECT '2026-09-16 14:04:42' AS era_start,
    COALESCE((SELECT MIN(datetime(created_at)) FROM catalog_cost_repair_0195_backup), '9999-12-31 23:59:59') AS era_end
),
lines AS (
  SELECT si.id AS sale_item_id, si.sale_id, si.product_id, si.quantity, si.cost_price_usd AS recorded,
    datetime(s.created_at) AS sale_at,
    (SELECT MIN(im.id) FROM inventory_movements im
      WHERE im.reference_id = si.sale_id AND im.movement_type = 'sale' AND im.product_id = si.product_id
        AND im.unit_cost_usd IS NOT NULL AND ABS(im.unit_cost_usd - si.cost_price_usd) < 0.00006) AS mv_id
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  JOIN params p
  WHERE si.product_id IS NOT NULL AND si.cost_price_usd > 0
    AND datetime(s.created_at) >= p.era_start AND datetime(s.created_at) < p.era_end
),
lpos AS (
  SELECT l.*,
    COALESCE(l.mv_id,
      (SELECT MIN(im.id) FROM inventory_movements im WHERE im.created_at >= l.sale_at),
      (SELECT COALESCE(MAX(im.id), 0) + 1 FROM inventory_movements im)) AS pos,
    (SELECT COUNT(*) FROM product_cost_entries pce
      WHERE pce.product_id = l.product_id AND datetime(pce.created_at) <= l.sale_at) > 0 AS has_me,
    (SELECT pce.cost_usd FROM product_cost_entries pce
      WHERE pce.product_id = l.product_id AND datetime(pce.created_at) <= l.sale_at ORDER BY pce.id DESC LIMIT 1) AS me_cost,
    COALESCE((SELECT pce.baseline_batch_id FROM product_cost_entries pce
      WHERE pce.product_id = l.product_id AND datetime(pce.created_at) <= l.sale_at ORDER BY pce.id DESC LIMIT 1), 0) AS me_baseline
  FROM lines l
),
buggy_set AS (
  SELECT lp.sale_item_id, pb.unit_cost_usd AS cost
    FROM lpos lp JOIN product_batches pb ON pb.variant_product_id = lp.product_id
   WHERE pb.is_active = 1 AND pb.unit_cost_usd > 0
     AND (lp.has_me = 0 OR pb.id > lp.me_baseline)
     AND datetime(COALESCE(pb.created_at, pb.received_at)) <= lp.sale_at
  UNION
  SELECT lp.sale_item_id, lp.me_cost FROM lpos lp WHERE lp.has_me = 1 AND lp.me_cost > 0
),
buggy AS (
  SELECT sale_item_id,
    ROUND(AVG(cost), 4) AS b1,
    CAST(AVG(cost) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 AS b1h,
    CASE WHEN MAX(cost) > 2 * MIN(cost) THEN MAX(cost) ELSE ROUND(AVG(cost), 4) END AS b2
  FROM buggy_set GROUP BY sale_item_id
),
cand AS (
  SELECT lp.*, b.b1, b.b2 FROM lpos lp JOIN buggy b ON b.sale_item_id = lp.sale_item_id
   WHERE ABS(lp.recorded - b.b1) < 0.00006 OR ABS(lp.recorded - b.b1h) < 0.00006 OR ABS(lp.recorded - b.b2) < 0.00006
),
cand_lots AS (
  SELECT pb.id AS lot_id, pb.variant_product_id AS product_id, pb.is_active, pb.unit_cost_usd AS cost,
    COALESCE(pb.received_quantity, 0) AS received_quantity
  FROM product_batches pb WHERE pb.variant_product_id IN (SELECT product_id FROM cand)
),
alloc_pos AS (
  SELECT si.id AS sale_item_id,
    (SELECT MIN(im.id) FROM inventory_movements im
      WHERE im.reference_id = si.sale_id AND im.movement_type = 'sale' AND im.product_id = si.product_id AND im.batch_id IS NULL) AS pos
  FROM sale_items si
  WHERE si.id IN (SELECT a.sale_item_id FROM sale_item_batch_allocations a WHERE a.batch_id IN (SELECT lot_id FROM cand_lots))
),
ev AS (
  SELECT im.batch_id AS lot_id, im.id AS pos, im.quantity AS qty
    FROM inventory_movements im WHERE im.batch_id IN (SELECT lot_id FROM cand_lots)
  UNION ALL
  SELECT a.batch_id, ap.pos, -(a.quantity - COALESCE(a.released_quantity, 0))
    FROM sale_item_batch_allocations a JOIN alloc_pos ap ON ap.sale_item_id = a.sale_item_id
   WHERE a.batch_id IN (SELECT lot_id FROM cand_lots) AND ap.pos IS NOT NULL
),
ev_total AS (
  SELECT lot_id, SUM(qty) AS ledger_total, COUNT(*) AS events FROM ev GROUP BY lot_id
),
lot_check AS (
  SELECT cl.lot_id, cl.product_id,
    COALESCE(et.ledger_total, 0) AS ledger_total,
    COALESCE((SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = cl.lot_id), 0) AS on_hand_now,
    COALESCE(et.events, 0) AS events,
    cl.received_quantity
  FROM cand_lots cl LEFT JOIN ev_total et ON et.lot_id = cl.lot_id
  WHERE cl.is_active = 1
),
lot_negative AS (
  SELECT lot_id FROM (
    SELECT e.lot_id, SUM(e.qty) OVER (PARTITION BY e.lot_id ORDER BY e.pos, e.qty DESC ROWS UNBOUNDED PRECEDING) AS running
    FROM ev e)
  WHERE running < 0 GROUP BY lot_id
),
bad_products AS (
  SELECT DISTINCT lc.product_id FROM lot_check lc
   WHERE lc.ledger_total <> lc.on_hand_now
      OR (lc.events = 0 AND lc.received_quantity > 0)
      OR lc.lot_id IN (SELECT lot_id FROM lot_negative)
),
onhand AS (
  SELECT c.sale_item_id, e.lot_id, SUM(e.qty) AS q
    FROM cand c
    JOIN cand_lots cl ON cl.product_id = c.product_id AND cl.is_active = 1
    JOIN ev e ON e.lot_id = cl.lot_id AND e.pos < c.pos
   GROUP BY c.sale_item_id, e.lot_id
),
terms AS (
  SELECT c.sale_item_id, cl.cost, o.q AS qty
    FROM cand c JOIN onhand o ON o.sale_item_id = c.sale_item_id JOIN cand_lots cl ON cl.lot_id = o.lot_id
   WHERE cl.cost > 0 AND o.q > 0 AND (c.has_me = 0 OR cl.lot_id > c.me_baseline)
  UNION ALL
  SELECT c.sale_item_id, c.me_cost, SUM(o.q)
    FROM cand c JOIN onhand o ON o.sale_item_id = c.sale_item_id JOIN cand_lots cl ON cl.lot_id = o.lot_id
   WHERE c.has_me = 1 AND c.me_cost > 0 AND cl.lot_id <= c.me_baseline AND o.q > 0
   GROUP BY c.sale_item_id, c.me_cost
),
weighted AS (
  SELECT sale_item_id,
    CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END AS w,
    SUM(qty) AS on_hand_units
  FROM terms GROUP BY sale_item_id
),
plan AS (
  SELECT c.sale_item_id, c.sale_id, c.product_id, c.quantity, c.recorded, c.b1 AS buggy_mean_usd, c.pos,
    COALESCE(w.w,
      (SELECT pb.unit_cost_usd FROM product_batches pb
        WHERE pb.variant_product_id = c.product_id AND pb.is_active = 1 AND pb.unit_cost_usd > 0
          AND (c.has_me = 0 OR pb.id > c.me_baseline)
          AND datetime(COALESCE(pb.created_at, pb.received_at)) <= c.sale_at
        ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS correct,
    COALESCE(w.on_hand_units, 0) AS on_hand_units,
    CASE WHEN c.product_id IN (SELECT product_id FROM bad_products) THEN 0 ELSE 1 END AS verified
  FROM cand c LEFT JOIN weighted w ON w.sale_item_id = c.sale_item_id
),
classified AS (
  SELECT plan.*,
    CASE WHEN correct IS NULL THEN 'no_derivable_cost'
         WHEN ABS(recorded - correct) < 0.00005 THEN 'already_correct'
         WHEN verified = 0 THEN 'ledger_unverified'
         ELSE 'repair' END AS bucket
  FROM plan
)
-- plan:stop
SELECT
  (SELECT ROUND(SUM(c.quantity * (c.correct - c.recorded)), 4) FROM classified c JOIN sales s ON s.id = c.sale_id
    WHERE c.bucket = 'repair' AND lower(trim(COALESCE(s.sale_status, ''))) <> 'cancelled') AS sold_cost_delta_usd,
  (SELECT ROUND(SUM(ri.quantity * (c.correct - c.recorded)), 4) FROM classified c
    JOIN return_items ri ON ri.sale_item_id = c.sale_item_id AND ri.cost_price_usd IS NOT NULL AND ABS(ri.cost_price_usd - c.recorded) < 0.00006
    WHERE c.bucket = 'repair') AS returned_cost_delta_usd,
  (SELECT COUNT(*) FROM classified c
    JOIN return_items ri ON ri.sale_item_id = c.sale_item_id AND ri.cost_price_usd IS NOT NULL AND ABS(ri.cost_price_usd - c.recorded) < 0.00006
    WHERE c.bucket = 'repair') AS return_lines;
