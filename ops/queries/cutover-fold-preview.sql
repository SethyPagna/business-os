-- Branch cutover fold preview (lane LB, verifier precheck 6). Read-only; run it
-- through the Ops d1-export task before the cutover night, with the shop
-- closed, so the owner sees what the lot merge at LC Store will do BEFORE the
-- point of no return. One row of counts. It predicts the parent's fold stage
-- (branchCutoverParent.ts planCutoverLotFolds) on today's stock:
--   branches_ok            1 when exactly one active 'shop' and one active
--                          'warehouse' branch exist (canonical_key, else name)
--   moving_products        products with stock at Shop (one child each)
--   arriving_lots          Shop lots not yet at the Warehouse
--   same_date_merges       lot folds (one per merged group)
--   folded_lots            lots emptied into a survivor
--   expiry_splits          arriving lots kept apart: different expiry
--   supplier_splits        arriving lots kept apart: different suppliers
--   cost_splits            arriving lots kept apart: free vs unknown cost
--                          with no real cost in the group
--   empty_supplier_merges  folds that merge a no-supplier lot into the lot
--                          that has the supplier (owner 6 Oct)
--   unknown_cost_merges    folds where free/unknown-cost units take the real
--                          cost (owner 6 Oct)
--   cost_blend_folds       folds whose surviving lot gets a new unit cost
--   fractional_rows        stock rows at either branch with a fraction
--   inexact_pairs          Shop + Warehouse sums that are not an exact
--                          12-place decimal (the cutover refuses to begin)
--   max_lots_per_product   most positive lots one moving product has
--   received_date_only / _utc_z / _zoned / _space_time / _other / _null
--                          received_at formats of the positive lots
--   received_next_day_in_cambodia  timestamps at 17:00 UTC or later, whose
--                          Cambodia business day is the next date
-- Business day = UTC+7; a date-only value is the day as stored; a timestamp
-- without a zone is UTC. Supplier = supplier_id, else lower(trim(name)).
-- The fold stage also keeps apart a blend whose average rounds to $0.0000;
-- this preview does not model that case. Paired test:
-- cloudflare/scripts/test-branch-cutover-fold-preview-query-pure.cjs
-- ops:min-rows 1
-- ops:max-rows 1
WITH br AS (
  SELECT
    (SELECT MIN(id) FROM branches WHERE is_active = 1 AND COALESCE(canonical_key, lower(trim(name))) = 'shop') AS src,
    (SELECT MIN(id) FROM branches WHERE is_active = 1 AND COALESCE(canonical_key, lower(trim(name))) = 'warehouse') AS tgt,
    (SELECT COUNT(*) FROM branches WHERE is_active = 1 AND COALESCE(canonical_key, lower(trim(name))) = 'shop') AS n_src,
    (SELECT COUNT(*) FROM branches WHERE is_active = 1 AND COALESCE(canonical_key, lower(trim(name))) = 'warehouse') AS n_tgt
), moving AS (
  SELECT s.product_id AS p FROM branch_stock s, br WHERE s.branch_id = br.src AND s.quantity > 0
), lq AS (
  SELECT b.id, b.variant_product_id AS p, b.received_at, b.expiry_date, b.unit_cost_usd AS cost,
    CASE WHEN typeof(b.supplier_id) IN ('integer', 'real') AND b.supplier_id = CAST(b.supplier_id AS INTEGER) THEN 'id:' || CAST(b.supplier_id AS INTEGER)
      WHEN trim(COALESCE(b.supplier_name, '')) <> '' THEN 'name:' || lower(trim(b.supplier_name)) ELSE '' END AS sk,
    COALESCE((SELECT s.quantity FROM branch_batch_stock s WHERE s.batch_id = b.id AND s.branch_id = br.src), 0) AS sq,
    COALESCE((SELECT s.quantity FROM branch_batch_stock s WHERE s.batch_id = b.id AND s.branch_id = br.tgt), 0) AS tq
  FROM product_batches b, br
  WHERE b.variant_product_id IN (SELECT p FROM moving)
    AND b.id IN (SELECT batch_id FROM branch_batch_stock WHERE branch_id IN (br.src, br.tgt) AND quantity > 0)
), l1 AS (
  SELECT id, p, sk, cost, received_at,
    CASE WHEN trim(received_at) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN trim(received_at)
      WHEN trim(received_at) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN date(trim(received_at), '+7 hours') END AS day,
    quote(expiry_date) AS ek,
    CASE WHEN typeof(cost) IN ('integer', 'real') AND cost > 0 THEN 'recorded' WHEN cost = 0 THEN 'zero' ELSE 'unknown' END AS cc,
    CASE WHEN tq > 0 THEN 1 ELSE 0 END AS prior,
    CASE WHEN tq = 0 AND sq > 0 THEN 1 ELSE 0 END AS arrival
  FROM lq WHERE sq + tq > 0
), l2 AS (
  SELECT l1.*,
    CASE WHEN sk = '' AND MIN(NULLIF(sk, '')) OVER (PARTITION BY p, day, ek) = MAX(NULLIF(sk, '')) OVER (PARTITION BY p, day, ek)
      THEN MIN(NULLIF(sk, '')) OVER (PARTITION BY p, day, ek) ELSE sk END AS ps
  FROM l1 WHERE day IS NOT NULL
), l3 AS (
  SELECT l2.*,
    CASE WHEN MAX(cc = 'recorded') OVER (PARTITION BY p, day, ek, ps) = 1 THEN 'recorded' ELSE cc END AS pc
  FROM l2
), l4 AS (
  SELECT l3.*,
    COALESCE(MIN(CASE WHEN prior = 1 AND sk = ps THEN id END) OVER (PARTITION BY p, day, ek, ps, pc),
      MIN(CASE WHEN arrival = 1 AND sk = ps THEN id END) OVER (PARTITION BY p, day, ek, ps, pc)) AS survivor,
    MAX(arrival) OVER (PARTITION BY p, day, ek, ps, pc) AS has_arrival,
    COUNT(*) OVER (PARTITION BY p, day) AS c_day,
    COUNT(*) OVER (PARTITION BY p, day, ek) AS c_e,
    COUNT(*) OVER (PARTITION BY p, day, ek, ps) AS c_s,
    COUNT(*) OVER (PARTITION BY p, day, ek, ps, pc) AS c_c
  FROM l3
), l5 AS (
  SELECT l4.*,
    CASE WHEN arrival = 1 OR id = survivor OR (ps <> '' AND sk = '' AND prior = 1) THEN 1 ELSE 0 END AS member
  FROM l4
), l6 AS (
  SELECT l5.*,
    SUM(member) OVER (PARTITION BY p, day, ek, ps, pc) AS n_member,
    SUM(CASE WHEN member = 1 AND sk = '' THEN 1 ELSE 0 END) OVER (PARTITION BY p, day, ek, ps, pc) AS n_empty,
    SUM(CASE WHEN member = 1 AND cc <> 'recorded' THEN 1 ELSE 0 END) OVER (PARTITION BY p, day, ek, ps, pc) AS n_uncosted,
    MIN(CASE WHEN member = 1 AND cc = 'recorded' THEN cost END) OVER (PARTITION BY p, day, ek, ps, pc) AS min_cost,
    MAX(CASE WHEN member = 1 AND cc = 'recorded' THEN cost END) OVER (PARTITION BY p, day, ek, ps, pc) AS max_cost
  FROM l5
), f AS (
  SELECT l6.*, CASE WHEN has_arrival = 1 AND survivor IS NOT NULL AND n_member >= 2 THEN 1 ELSE 0 END AS folds
  FROM l6
), pos AS (
  SELECT l1.p, l1.received_at FROM l1
)
SELECT
  CASE WHEN (SELECT n_src FROM br) = 1 AND (SELECT n_tgt FROM br) = 1 THEN 1 ELSE 0 END AS branches_ok,
  (SELECT COUNT(*) FROM moving) AS moving_products,
  (SELECT COUNT(*) FROM l1 WHERE arrival = 1) AS arriving_lots,
  (SELECT COUNT(*) FROM f WHERE folds = 1 AND id = survivor) AS same_date_merges,
  (SELECT COUNT(*) FROM f WHERE folds = 1 AND member = 1 AND id <> survivor) AS folded_lots,
  (SELECT COUNT(*) FROM f WHERE arrival = 1 AND c_e < c_day) AS expiry_splits,
  (SELECT COUNT(*) FROM f WHERE arrival = 1 AND c_e = c_day AND c_s < c_e) AS supplier_splits,
  (SELECT COUNT(*) FROM f WHERE arrival = 1 AND c_e = c_day AND c_s = c_e AND c_c < c_s) AS cost_splits,
  (SELECT COUNT(*) FROM f WHERE folds = 1 AND id = survivor AND ps <> '' AND n_empty > 0) AS empty_supplier_merges,
  (SELECT COUNT(*) FROM f WHERE folds = 1 AND id = survivor AND pc = 'recorded' AND n_uncosted > 0) AS unknown_cost_merges,
  (SELECT COUNT(*) FROM f WHERE folds = 1 AND id = survivor AND pc = 'recorded' AND (cc <> 'recorded' OR min_cost <> max_cost)) AS cost_blend_folds,
  (SELECT COUNT(*) FROM branch_stock, br WHERE branch_id IN (br.src, br.tgt) AND quantity <> CAST(quantity AS INTEGER))
    + (SELECT COUNT(*) FROM branch_batch_stock, br WHERE branch_id IN (br.src, br.tgt) AND quantity <> CAST(quantity AS INTEGER)) AS fractional_rows,
  (SELECT COUNT(*) FROM branch_stock s JOIN br ON s.branch_id = br.src JOIN branch_stock t ON t.product_id = s.product_id AND t.branch_id = br.tgt
    WHERE s.quantity > 0 AND CAST(printf('%.12f', s.quantity + t.quantity) AS REAL) <> s.quantity + t.quantity)
    + (SELECT COUNT(*) FROM branch_batch_stock s JOIN br ON s.branch_id = br.src JOIN branch_batch_stock t ON t.batch_id = s.batch_id AND t.branch_id = br.tgt
    WHERE s.quantity > 0 AND CAST(printf('%.12f', s.quantity + t.quantity) AS REAL) <> s.quantity + t.quantity) AS inexact_pairs,
  (SELECT COALESCE(MAX(n), 0) FROM (SELECT COUNT(*) AS n FROM pos GROUP BY p)) AS max_lots_per_product,
  (SELECT COUNT(*) FROM pos WHERE trim(received_at) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]') AS received_date_only,
  (SELECT COUNT(*) FROM pos WHERE received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z') AS received_utc_z,
  (SELECT COUNT(*) FROM pos WHERE received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*[+-][0-9][0-9]*') AS received_zoned,
  (SELECT COUNT(*) FROM pos WHERE received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] *') AS received_space_time,
  (SELECT COUNT(*) FROM pos WHERE received_at IS NOT NULL
    AND NOT trim(received_at) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND NOT received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'
    AND NOT received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*[+-][0-9][0-9]*'
    AND NOT received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] *') AS received_other,
  (SELECT COUNT(*) FROM pos WHERE received_at IS NULL) AS received_null,
  (SELECT COUNT(*) FROM pos WHERE length(trim(received_at)) > 10
    AND date(trim(received_at), '+7 hours') <> substr(trim(received_at), 1, 10)) AS received_next_day_in_cambodia
