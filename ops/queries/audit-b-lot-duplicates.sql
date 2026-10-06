-- DATA-AUDIT lane B (stock & cost), query 13 of 15: lots at ONE branch that the owner's date-only merge rule says are the same lot.
-- Owner ask 7 Oct 2026: "compare all the backend data for any inconsistencies or logic that isn't consistent".
--
-- Owner rulings 3-4 Sep and 6 Oct 2026 (product-child-row-model, branch-consolidation): a lot is identified by its RECEIVED DATE -- the business day (UTC+7),
-- whatever text stored it (ISO date, ISO timestamp, a month-first slash date) -- and lots received on the same day merge, except that a different EXPIRY
-- date keeps them apart and two different SUPPLIERS keep them apart (a lot with no supplier merges into the one supplier its day has; a free $0 lot and
-- an unknown-cost lot merge). By construction one product holds one lot per received-date code (UNIQUE (variant_product_id, batch_key); lib/productBatches.ts),
-- so a same-day, same-expiry, same-supplier pair at one branch can only arise from another batch_key shape (a return's ' event:...' lot, an import's own key, a
-- date written two ways). The cutover (branchCutoverParent.ts planCutoverLotFolds) folds Shop lots into the Warehouse by exactly this rule; THIS query looks for
-- the pairs that already sit at ONE branch and the fold does not touch.
-- The business-day and supplier-key expressions are branchCutoverParent.ts cutoverLotDaySql / cutoverSupplierKeySql, verbatim (ops/queries/cutover-fold-preview.sql
-- carries the same text; its paired test pins it). Lots with stock above 0 at the branch, active lots only. Not repeated: received-date-format-census.sql (the shapes),
-- cutover-fold-preview.sql (the cross-branch fold).
--
-- One row. Zero-expected (a non-zero value is a defect, named by the column):
--   duplicate_lot_groups             (product, branch, business day, expiry) groups of 2+ lots holding stock whose suppliers do not differ (at most one distinct supplier)
--   positive_lots_without_day        lots holding stock whose received_at has no business day (NULL or not a date): they can never merge
--   Info columns:
--   duplicate_lots / duplicate_extra_lots / duplicate_units   lots in those groups / lots beyond one per group / stock units in them
--   duplicate_groups_event_lot       of the groups, those that include a return-created lot (batch_key starts ' event:')
--   duplicate_groups_cost_differs    of the groups, those whose recorded costs differ (the merge would blend them)
--   duplicate_groups_empty_supplier  of the groups, those mixing a no-supplier lot with a supplied one (the empty one merges into the supplied one)
--   supplier_split_groups            groups of 2+ same-day same-expiry lots at one branch held apart by two different suppliers (legitimate)
--   positive_lots                    lots holding stock (the denominator)
--   examples                         up to 5 [product_id, branch_id, day, lot ids (json), units], the largest first
-- Measured cost: one pass over the positive branch_batch_stock rows joined to their lots, the business-day text evaluated once per row, one GROUP BY; see the scale
-- test output (test-audit-b-scale-workerd.cjs).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero duplicate_lot_groups,positive_lots_without_day
WITH lots AS MATERIALIZED (
  SELECT bbs.branch_id AS branch_id, b.variant_product_id AS p, b.id AS id, CASE WHEN trim(b.received_at) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN trim(b.received_at) WHEN substr(trim(b.received_at),1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(trim(b.received_at),11,2) GLOB '[T ][0-9]' AND NOT substr(trim(b.received_at),13) GLOB '*[^!-~]*' THEN date(trim(b.received_at), '+7 hours') WHEN date(CASE WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),7,4)||'-'||substr(trim(b.received_at),1,2)||'-'||substr(trim(b.received_at),4,2) WHEN trim(b.received_at) GLOB '[0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-0'||substr(trim(b.received_at),1,1)||'-'||substr(trim(b.received_at),3,2) WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-'||substr(trim(b.received_at),1,2)||'-0'||substr(trim(b.received_at),4,1) WHEN trim(b.received_at) GLOB '[0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),5,4)||'-0'||substr(trim(b.received_at),1,1)||'-0'||substr(trim(b.received_at),3,1) END)=CASE WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),7,4)||'-'||substr(trim(b.received_at),1,2)||'-'||substr(trim(b.received_at),4,2) WHEN trim(b.received_at) GLOB '[0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-0'||substr(trim(b.received_at),1,1)||'-'||substr(trim(b.received_at),3,2) WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-'||substr(trim(b.received_at),1,2)||'-0'||substr(trim(b.received_at),4,1) WHEN trim(b.received_at) GLOB '[0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),5,4)||'-0'||substr(trim(b.received_at),1,1)||'-0'||substr(trim(b.received_at),3,1) END THEN CASE WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),7,4)||'-'||substr(trim(b.received_at),1,2)||'-'||substr(trim(b.received_at),4,2) WHEN trim(b.received_at) GLOB '[0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-0'||substr(trim(b.received_at),1,1)||'-'||substr(trim(b.received_at),3,2) WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-'||substr(trim(b.received_at),1,2)||'-0'||substr(trim(b.received_at),4,1) WHEN trim(b.received_at) GLOB '[0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),5,4)||'-0'||substr(trim(b.received_at),1,1)||'-0'||substr(trim(b.received_at),3,1) END END AS day, quote(b.expiry_date) AS ek,
    CASE WHEN typeof(b.supplier_id) IN ('integer','real') AND b.supplier_id=CAST(b.supplier_id AS INTEGER) THEN 'id:'||CAST(b.supplier_id AS INTEGER) WHEN trim(coalesce(b.supplier_name,''))<>'' THEN 'name:'||lower(trim(b.supplier_name)) ELSE '' END AS sk, b.unit_cost_usd AS cost, b.batch_key AS batch_key, bbs.quantity AS q
  FROM branch_batch_stock bbs
  JOIN product_batches b ON b.id = bbs.batch_id
  WHERE bbs.quantity > 0 AND b.is_active = 1
), g AS MATERIALIZED (
  SELECT branch_id, p, day, ek, COUNT(*) AS n,
    COUNT(DISTINCT CASE WHEN sk <> '' THEN sk END) AS nsup,
    SUM(q) AS units, MIN(id) AS first_id,
    MAX(CASE WHEN batch_key >= ' event:' AND batch_key < ' event;' THEN 1 ELSE 0 END) AS has_event,
    MIN(CASE WHEN typeof(cost) IN ('integer', 'real') AND cost > 0 THEN cost END) AS min_cost,
    MAX(CASE WHEN typeof(cost) IN ('integer', 'real') AND cost > 0 THEN cost END) AS max_cost,
    MAX(CASE WHEN sk = '' THEN 1 ELSE 0 END) AS has_empty,
    json_group_array(id) AS ids
  FROM lots
  WHERE day IS NOT NULL
  GROUP BY branch_id, p, day, ek
  HAVING COUNT(*) > 1
)
SELECT
  (SELECT COUNT(*) FROM g WHERE nsup <= 1) AS duplicate_lot_groups,
  (SELECT COUNT(*) FROM lots WHERE day IS NULL) AS positive_lots_without_day,
  (SELECT COALESCE(SUM(n), 0) FROM g WHERE nsup <= 1) AS duplicate_lots,
  (SELECT COALESCE(SUM(n - 1), 0) FROM g WHERE nsup <= 1) AS duplicate_extra_lots,
  (SELECT COALESCE(SUM(units), 0) FROM g WHERE nsup <= 1) AS duplicate_units,
  (SELECT COUNT(*) FROM g WHERE nsup <= 1 AND has_event = 1) AS duplicate_groups_event_lot,
  (SELECT COUNT(*) FROM g WHERE nsup <= 1 AND min_cost <> max_cost) AS duplicate_groups_cost_differs,
  (SELECT COUNT(*) FROM g WHERE nsup = 1 AND has_empty = 1) AS duplicate_groups_empty_supplier,
  (SELECT COUNT(*) FROM g WHERE nsup >= 2) AS supplier_split_groups,
  (SELECT COUNT(*) FROM lots) AS positive_lots,
  (SELECT COALESCE(json_group_array(json_array(p, branch_id, day, json(ids), units)), '[]')
    FROM (SELECT p, branch_id, day, ids, units FROM g WHERE nsup <= 1 ORDER BY units DESC, p, branch_id LIMIT 5)) AS examples
