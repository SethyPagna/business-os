-- forensics-catalog-mirror-drift-rows: the products behind health-catalog-cost.active_mirror_drift, one row each
-- (DATA-MATCH DM-16 drill-down, lane 6.0.943). active_mirror_drift counts ACTIVE products whose
-- purchase_price_usd twin is not aligned with cost_price_usd: the same value, or an unknown (NULL) cost with a twin of
-- 0 or NULL (the mirror rule of lane 6.0.944, COST_MIRROR_COLUMNS in lib/catalogCostRecompute.ts). The
-- selection is health-catalog-cost's own: the same active-row filter and the same mirror predicate, applied
-- inside d so the derive runs only for the drifting rows; derived is CATALOG_COST_DERIVE_SQL verbatim
-- (lib/catalogCostRecompute.ts); test-health-drilldown-rows-native.cjs pins it, the active filter and the predicate
-- against the health query's text and checks the list has the same row count as the health column on shared
-- fixtures. active_cost_drift is 0 in production, so every row here has derived_cost_usd NULL: the
-- 0195/0256/0261 triggers and recomputeCatalogCost write BOTH columns only when the formula has a figure
-- (COALESCE(derive, stored)), which leaves a split nothing re-derives. Facts per product, by what each one confirms or refutes:
--   the pair              cost_price_usd, purchase_price_usd, drift_kind, diff_usd, the KHR twins
--                               (an unknown NULL cost with a twin of 0 is the policy -- routes/inventory.ts
--                               mirrorCostFields, the dated count insert -- and is not listed: it is not drift)
--     mirror_zero_cost_set     (X, 0): a cost-only writer or an INSERT that left the mirror at its default:
--                               importEngine.ts product import insert and update, routes/products.ts conflict
--                               merge, lib/createFold.ts, a manual edit while no lot has a recorded cost
--     cost_zero_mirror_set / both_set_differ / cost_unknown_mirror_set / mirror_null: a stale mirror, the
--                               cost changed or cleared and the mirror kept (merge undo restores cost only)
--     precision                 |cost - purchase| < 0.0001: a 4 dp rounding difference between writers
--   why the formula is silent   lots, lots_active, lots_cost_positive (active lots with a positive recorded
--                               cost: 0 means nothing to derive), on_hand_qty, newest lot, review_flag
--   cost-edit ledger            cost_entries, last_entry_* (product_cost_entries, the manual cost edits; the
--                               latest entry's baseline_batch_id hides older lots from the formula),
--                               last_entry_matches_cost / last_entry_matches_mirror
--   last writer signal          created_day, updated_at, request_kind (client_request_id prefix only),
--                               last_audit_at / last_audit_action (audit_logs entity product),
--                               last_cost_override_at (audit action cost_override)
-- Ids, dates, amounts and code-chosen tokens only: no product name, barcode or free text. The list is capped by
-- LIMIT 201 against max-rows 200, so a longer list fails the check instead of truncating quietly.
-- ops:min-rows 0
-- ops:max-rows 200
WITH d AS MATERIALIZED (
  SELECT products.id, products.cost_price_usd, products.purchase_price_usd, COALESCE(
      (SELECT CASE WHEN SUM(qty) > 0 THEN CAST(SUM(qty * cost) / SUM(qty) * 10000.0 + 0.5 + 1e-8 AS INTEGER) / 10000.0 END
        FROM (SELECT pb.unit_cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs WHERE bbs.batch_id = pb.id AND bbs.quantity > 0) AS qty FROM product_batches pb
          WHERE pb.variant_product_id = products.id AND pb.is_active = 1
          AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
          AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
          UNION ALL
          SELECT pce.cost_usd AS cost, (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs
              JOIN product_batches ob ON ob.id = bbs.batch_id
            WHERE ob.variant_product_id = products.id AND ob.is_active = 1
              AND ob.id <= pce.baseline_batch_id AND bbs.quantity > 0) AS qty FROM product_cost_entries pce
          WHERE pce.id = (SELECT id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1)
            AND typeof(pce.cost_usd) IN ('integer','real') AND pce.cost_usd > 0 AND pce.cost_usd <= 1.7976931348623157e308)),
      (SELECT pb.unit_cost_usd FROM product_batches pb
        WHERE pb.variant_product_id = products.id AND pb.is_active = 1
          AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0 AND pb.unit_cost_usd <= 1.7976931348623157e308
          AND (pb.id > (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) OR (SELECT baseline_batch_id FROM product_cost_entries WHERE product_id = products.id ORDER BY id DESC LIMIT 1) IS NULL)
        ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1)) AS derived,
    products.cost_price_khr, products.purchase_price_khr, products.created_at, products.updated_at,
    products.cost_review_key IS NOT NULL AS review_flag,
    CASE WHEN COALESCE(products.client_request_id, '') = '' THEN 'none'
      WHEN instr(products.client_request_id, ':') BETWEEN 2 AND 25 AND substr(products.client_request_id, 1, instr(products.client_request_id, ':') - 1) NOT GLOB '*[^a-z-]*'
        THEN substr(products.client_request_id, 1, instr(products.client_request_id, ':') - 1) ELSE 'opaque' END AS request_kind
  FROM products WHERE products.is_active = 1 AND NOT (products.cost_price_usd IS products.purchase_price_usd OR (products.cost_price_usd IS NULL AND COALESCE(products.purchase_price_usd, 0) = 0))
)
SELECT
  d.id AS product_id, d.cost_price_usd, d.purchase_price_usd, d.derived AS derived_cost_usd,
  typeof(d.cost_price_usd) AS cost_type, typeof(d.purchase_price_usd) AS mirror_type,
  CASE WHEN d.cost_price_usd IS NULL THEN 'cost_unknown_mirror_set'
    WHEN d.purchase_price_usd IS NULL THEN 'mirror_null'
    WHEN ABS(d.cost_price_usd - d.purchase_price_usd) < 0.0001 THEN 'precision'
    WHEN d.purchase_price_usd = 0 THEN 'mirror_zero_cost_set'
    WHEN d.cost_price_usd = 0 THEN 'cost_zero_mirror_set'
    ELSE 'both_set_differ' END AS drift_kind,
  ROUND(d.cost_price_usd - d.purchase_price_usd, 6) AS diff_usd,
  d.cost_price_khr, d.purchase_price_khr,
  (SELECT COUNT(*) FROM product_batches pb WHERE pb.variant_product_id = d.id) AS lots,
  (SELECT COUNT(*) FROM product_batches pb WHERE pb.variant_product_id = d.id AND pb.is_active = 1) AS lots_active,
  (SELECT COUNT(*) FROM product_batches pb WHERE pb.variant_product_id = d.id AND pb.is_active = 1
    AND typeof(pb.unit_cost_usd) IN ('integer','real') AND pb.unit_cost_usd > 0) AS lots_cost_positive,
  (SELECT SUM(bbs.quantity) FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id = bbs.batch_id
    WHERE pb.variant_product_id = d.id AND pb.is_active = 1 AND bbs.quantity > 0) AS on_hand_qty,
  (SELECT pb.id FROM product_batches pb WHERE pb.variant_product_id = d.id ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1) AS newest_lot_id,
  (SELECT pb.received_at FROM product_batches pb WHERE pb.variant_product_id = d.id ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1) AS newest_lot_received_at,
  (SELECT pb.unit_cost_usd FROM product_batches pb WHERE pb.variant_product_id = d.id ORDER BY COALESCE(pb.received_at, '') DESC, pb.id DESC LIMIT 1) AS newest_lot_unit_cost_usd,
  d.review_flag,
  (SELECT COUNT(*) FROM product_cost_entries pce WHERE pce.product_id = d.id) AS cost_entries,
  (SELECT pce.id FROM product_cost_entries pce WHERE pce.product_id = d.id ORDER BY pce.id DESC LIMIT 1) AS last_entry_id,
  (SELECT pce.cost_usd FROM product_cost_entries pce WHERE pce.product_id = d.id ORDER BY pce.id DESC LIMIT 1) AS last_entry_cost_usd,
  (SELECT pce.baseline_batch_id FROM product_cost_entries pce WHERE pce.product_id = d.id ORDER BY pce.id DESC LIMIT 1) AS last_entry_baseline_batch_id,
  (SELECT pce.created_at FROM product_cost_entries pce WHERE pce.product_id = d.id ORDER BY pce.id DESC LIMIT 1) AS last_entry_at,
  (SELECT pce.cost_usd IS d.cost_price_usd FROM product_cost_entries pce WHERE pce.product_id = d.id ORDER BY pce.id DESC LIMIT 1) AS last_entry_matches_cost,
  (SELECT pce.cost_usd IS d.purchase_price_usd FROM product_cost_entries pce WHERE pce.product_id = d.id ORDER BY pce.id DESC LIMIT 1) AS last_entry_matches_mirror,
  date(d.created_at, '+7 hours') AS created_day, d.updated_at, d.request_kind,
  (SELECT a.created_at FROM audit_logs a WHERE a.entity = 'product' AND a.entity_id = CAST(d.id AS TEXT) ORDER BY a.id DESC LIMIT 1) AS last_audit_at,
  (SELECT CASE WHEN a.action GLOB '*[^a-z_]*' THEN 'unrecognised' ELSE a.action END FROM audit_logs a
    WHERE a.entity = 'product' AND a.entity_id = CAST(d.id AS TEXT) ORDER BY a.id DESC LIMIT 1) AS last_audit_action,
  (SELECT MAX(a.created_at) FROM audit_logs a WHERE a.entity = 'product' AND a.entity_id = CAST(d.id AS TEXT) AND +a.action = 'cost_override') AS last_cost_override_at
FROM d
ORDER BY d.id
LIMIT 201
