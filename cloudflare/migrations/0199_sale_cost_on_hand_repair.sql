-- 0199: past sale lines whose recorded cost came from the buggy catalog
-- average get the cost the stock on hand actually had when they were sold.
--
-- Owner decision (2026-09-26): past sales whose recorded cost came from the
-- buggy average must be corrected so reports and profit are right. This is a
-- bug repair. It writes ONLY cost fields: sale_items.cost_price_usd and, for a
-- return line copied from a repaired sale line, return_items.cost_price_usd.
-- Never price, revenue, quantity, status, receipts, KHR, movements or snapshots.
--
-- ============================== WHAT REPORTS READ ========================
-- COGS / profit (lib/salesAnalytics.ts header, routes/reports.ts,
-- lib/productSalesLedger.ts):
--   cost_usd   = SUM(sale_items.cost_price_usd * sale_items.quantity) over
--                recognized sales, MINUS SUM(return_items.cost_price_usd *
--                return_items.quantity) for restocked customer-return lines
--   profit_usd = revenue_usd - cost_usd + delivery_net_usd
-- sale_items.cost_price_usd is a snapshot of products.cost_price_usd taken
-- when the line is written (routes/sales.ts, lib/saleLineAddition.ts).
--
-- ============================== WHICH LINES ==============================
-- The buggy average (a5a2169f, committed 2026-09-16 14:04:42 UTC, until 0195):
-- the mean of the DISTINCT positive unit costs of the product's active lots
-- (after the latest manual override's baseline, plus that override's cost),
-- counting lots that had SOLD OUT. Until 156c67d2 (2026-09-19 20:42 UTC) a
-- dearest cost more than twice the cheapest replaced the mean.
-- A line is a candidate only when ALL hold:
--   - its sale was created at or after 2026-09-16 14:04:42 UTC and before
--     0195 was applied (catalog_cost_repair_0195_backup.created_at);
--   - its recorded cost is positive and EQUALS the buggy average recomputed as
--     of the sale (either variant, either rounding) -- proof the figure came
--     from that formula, not a legacy import, a merge or a hand-typed cost.
--
-- ============================== THE CORRECT COST =========================
-- The owner rule (2026-09-25) applied to the shelf AT THE SALE, not today:
-- SUM(on-hand qty x unit cost) / SUM(on-hand qty) over the product's active
-- lots with a recorded (> 0) cost that were on hand just before the line's
-- own stock movement; a manual override prices the on-hand units of the lots
-- at or below its baseline; nearest 4dp half up. Nothing on hand: the newest
-- received lot that existed at the sale. Not today's corrected average: the
-- shelf a past line was sold from is gone, and today's figure describes the
-- lots left now.
-- On hand at the sale is rebuilt per lot from a ledger, positioned by
-- inventory_movements.id: every movement stamped with the lot (batch_id),
-- plus, for a sale movement stamped with no lot (a multi-lot line), that
-- line's net sale_item_batch_allocations (quantity - released_quantity).
--
-- ============================== SAFETY GUARD =============================
-- A candidate is repaired only when EVERY active lot of its product is
-- verified: the ledger sums exactly to today's branch_batch_stock total,
-- never runs negative, and a lot with a received quantity has at least one
-- ledger event. A product failing that is reported as 'ledger_unverified'
-- by the audit and left alone.
--
-- ============================== LIMITS ===================================
--   - Lot unit costs, is_active and received_at are read as they are TODAY. A
--     lot whose cost was edited, or that was deactivated, after the sale
--     makes the buggy average differ from the recorded cost, so the line is
--     not a candidate (not repaired) -- it is not mis-repaired.
--   - Merges re-point lots and sale lines to the keeper; the buggy average
--     over the keeper's union rarely equals the recorded cost, so such lines
--     are usually not candidates. When it does equal, the rebuilt shelf is
--     the keeper's union.
--   - The reconciliation guard proves a lot's ledger balances, not that every
--     intermediate step is timed right: two unstamped events that cancel
--     (e.g. an unstamped void of an unstamped sale) are invisible, and a void
--     of a multi-lot line is folded into the sale's own position.
--   - A line with no sale movement (held / stock-skipped) is positioned at the
--     first movement at or after its sale time (second resolution).
--   - Two lines of one sale for the same product share the first matching
--     movement's position.
--   - KHR costs are untouched (the catalog KHR cost is never averaged).
--   - inventory_movements.unit_cost_usd of the sale keeps the old snapshot; no
--     report reads it for COGS.
--   - No undo or replay path writes sale_items.cost_price_usd: the only
--     writers are the line-creating INSERTs (routes/sales.ts,
--     lib/saleLineAddition.ts, lib/salesImportCommit.ts,
--     lib/stockActionCommit.ts, routes/returns.ts), so no recorded undo puts
--     the old figure back.
--
-- ============================== AUDIT ====================================
-- ops/scripts/audit/sale-cost-on-hand-audit.sql (SELECT-only) carries the
-- same plan text (pinned by test-migration-0199-sale-cost-repair-pure.cjs)
-- and lists every bucket: repair, ledger_unverified, already_correct,
-- no_derivable_cost.
--
-- ============================== PRE ASSERTIONS ===========================
-- Read-only, immediately before applying (record every figure):
--   SELECT COUNT(*), ROUND(SUM(quantity), 4), ROUND(SUM(total_usd), 4), ROUND(SUM(applied_price_usd * quantity), 4),
--          ROUND(SUM(cost_price_khr * quantity), 4), ROUND(SUM(cost_price_usd * quantity), 4) FROM sale_items;   -- S
--   SELECT COUNT(*), ROUND(SUM(quantity), 4), ROUND(SUM(total_usd), 4), ROUND(SUM(cost_price_usd * quantity), 4) FROM return_items; -- RI
--   SELECT COUNT(*), ROUND(SUM(total_usd), 4), ROUND(SUM(subtotal_usd), 4), group_concat(DISTINCT sale_status) FROM sales;         -- SA
--   SELECT COUNT(*), ROUND(SUM(total_refund_usd), 4) FROM returns;                                                                 -- RE
--   The audit's first statement: the 'repair' bucket's line count R and cost
--   delta D = SUM(quantity x (correct - recorded)).
--
-- ============================== POST ASSERTIONS ==========================
--   SELECT COUNT(*) FROM sale_cost_repair_0199;                                  -- R
--   SELECT ROUND(SUM(quantity * (new_cost_price_usd - old_cost_price_usd)), 4)
--     FROM sale_cost_repair_0199;                                                -- D
--   S again: every figure equal EXCEPT the last, which moved by exactly D
--     (sale_items.cost_price_usd * quantity).
--   RI again: count, quantity and total_usd equal; the cost sum moved by
--     SELECT ROUND(SUM(ri.quantity * (x.new_cost_price_usd - x.old_cost_price_usd)), 4)
--       FROM sale_cost_repair_0199_return_items x JOIN return_items ri ON ri.id = x.return_item_id;
--   SA and RE again: identical (revenue, refunds, statuses untouched).
--   The audit's first statement again: no 'repair' bucket (a repaired line no
--   longer matches the buggy average, so a second run finds nothing).
--
-- ============================== RECOVERY =================================
-- Owner-approved only. Puts back the pre-0199 cost of every line that still
-- holds the figure 0199 wrote (a line changed since is left alone and shows
-- in the preview). Preview:
--   SELECT COUNT(*) FROM sale_items si JOIN sale_cost_repair_0199 r ON r.sale_item_id = si.id
--     WHERE si.cost_price_usd IS NOT r.new_cost_price_usd;
-- Statements:
--   UPDATE sale_items SET cost_price_usd = (SELECT r.old_cost_price_usd FROM sale_cost_repair_0199 r WHERE r.sale_item_id = sale_items.id)
--     WHERE id IN (SELECT r.sale_item_id FROM sale_cost_repair_0199 r WHERE r.new_cost_price_usd IS sale_items.cost_price_usd);
--   UPDATE return_items SET cost_price_usd = (SELECT x.old_cost_price_usd FROM sale_cost_repair_0199_return_items x WHERE x.return_item_id = return_items.id)
--     WHERE id IN (SELECT x.return_item_id FROM sale_cost_repair_0199_return_items x WHERE x.new_cost_price_usd IS return_items.cost_price_usd);
-- The backup tables are never dropped by code; they are the audit trail.
-- D1 applies the migration transactionally. No explicit transaction statements.
-- If the plan exceeds D1's statement limits the migration fails as a whole
-- and nothing is written; run the audit first to size it.

CREATE TABLE sale_cost_repair_0199 (
  sale_item_id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL,
  product_id INTEGER,
  quantity,
  old_cost_price_usd,
  new_cost_price_usd,
  buggy_mean_usd,
  ledger_position INTEGER,
  on_hand_units,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sale_cost_repair_0199_return_items (
  return_item_id INTEGER PRIMARY KEY,
  sale_item_id INTEGER NOT NULL,
  old_cost_price_usd,
  new_cost_price_usd,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO sale_cost_repair_0199 (sale_item_id, sale_id, product_id, quantity, old_cost_price_usd, new_cost_price_usd, buggy_mean_usd, ledger_position, on_hand_units)
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
SELECT sale_item_id, sale_id, product_id, quantity, recorded, correct, buggy_mean_usd, pos, on_hand_units
FROM classified WHERE bucket = 'repair';

INSERT INTO sale_cost_repair_0199_return_items (return_item_id, sale_item_id, old_cost_price_usd, new_cost_price_usd)
SELECT ri.id, ri.sale_item_id, ri.cost_price_usd, r.new_cost_price_usd
FROM return_items ri JOIN sale_cost_repair_0199 r ON r.sale_item_id = ri.sale_item_id
WHERE ri.cost_price_usd IS NOT NULL AND ABS(ri.cost_price_usd - r.old_cost_price_usd) < 0.00006;

UPDATE sale_items SET cost_price_usd = (SELECT r.new_cost_price_usd FROM sale_cost_repair_0199 r WHERE r.sale_item_id = sale_items.id)
WHERE id IN (SELECT sale_item_id FROM sale_cost_repair_0199);

UPDATE return_items SET cost_price_usd = (SELECT x.new_cost_price_usd FROM sale_cost_repair_0199_return_items x WHERE x.return_item_id = return_items.id)
WHERE id IN (SELECT return_item_id FROM sale_cost_repair_0199_return_items);
