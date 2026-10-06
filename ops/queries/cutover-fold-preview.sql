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
--   free_unknown_merges    folds of a $0 lot with an unknown-cost lot and no
--                          real cost: the merged cost is UNKNOWN (owner 6 Oct)
--   empty_supplier_merges  folds that merge a no-supplier lot into the lot
--                          that has the supplier (owner 6 Oct)
--   uncosted_merges        folds where free/unknown-cost units take the real
--                          cost (owner 6 Oct)
--   cost_blend_folds       folds whose surviving lot gets a new unit cost
--                          (a blend, a real cost, or $0 becoming unknown)
--   fractional_rows        stock rows at either branch with a fraction
--   inexact_pairs          Shop + Warehouse sums that are not an exact
--                          12-place decimal (the cutover refuses to begin)
--   max_lots_per_product   most positive lots one moving product has
--   received_date_only / _utc_z / _zoned / _space_time / _null
--                          received_at formats of the positive lots
--   received_slash         slash dates (M/D/YYYY, 1-2 digit parts) read MONTH-FIRST,
--                          the order of the Aug-28 import's batch(mm/dd/yyyy) column
--                          that 0077 rewrote: they merge with ISO lots of that day
--   received_slash_ambiguous  of those, the ones a day-first reading would make
--                          another real date (both parts <= 12, not equal);
--                          ops/queries/received-date-format-census.sql shows them
--   received_other         non-null values with no business day (unparseable,
--                          not a real date): they never merge
--   received_next_day_in_cambodia  timestamps at 17:00 UTC or later, whose
--                          Cambodia business day is the next date
-- D1 refuses a LIKE/GLOB pattern over 50 bytes ("pattern too complex"); every pattern here is shorter.
-- Business day = UTC+7; a date-only value is the day as stored; a timestamp
-- without a zone is UTC; a slash date is month-first. Supplier = supplier_id, else lower(trim(name)).
-- The fold stage also keeps apart a blend whose average rounds to $0.0000
-- (terminal roundingSplit); this preview does not model that case. Paired test:
-- cloudflare/scripts/test-branch-cutover-fold-preview-query-pure.cjs
-- ops:min-rows 1
-- ops:max-rows 1
WITH br AS MATERIALIZED (
  SELECT
    (SELECT MIN(id) FROM branches WHERE is_active = 1 AND COALESCE(canonical_key, lower(trim(name))) = 'shop') AS src,
    (SELECT MIN(id) FROM branches WHERE is_active = 1 AND COALESCE(canonical_key, lower(trim(name))) = 'warehouse') AS tgt,
    (SELECT COUNT(*) FROM branches WHERE is_active = 1 AND COALESCE(canonical_key, lower(trim(name))) = 'shop') AS n_src,
    (SELECT COUNT(*) FROM branches WHERE is_active = 1 AND COALESCE(canonical_key, lower(trim(name))) = 'warehouse') AS n_tgt
), qty AS MATERIALIZED (
  -- one row per positive lot at either branch: two index range reads, no per-row sub-query
  SELECT s.batch_id,
    SUM(CASE WHEN s.branch_id = br.src THEN s.quantity ELSE 0 END) AS sq,
    SUM(CASE WHEN s.branch_id = br.tgt THEN s.quantity ELSE 0 END) AS tq
  FROM br JOIN branch_batch_stock s ON s.branch_id IN (br.src, br.tgt) AND s.quantity > 0
  GROUP BY s.batch_id
), l1 AS MATERIALIZED (
  -- the positive lots of moving products (stock at the Shop), with their fold keys
  SELECT b.id, b.variant_product_id AS p, b.unit_cost_usd AS cost, b.received_at,
    CASE WHEN typeof(b.supplier_id) IN ('integer', 'real') AND b.supplier_id = CAST(b.supplier_id AS INTEGER) THEN 'id:' || CAST(b.supplier_id AS INTEGER)
      WHEN trim(COALESCE(b.supplier_name, '')) <> '' THEN 'name:' || lower(trim(b.supplier_name)) ELSE '' END AS sk,
    -- the business day: branchCutoverParent.ts cutoverLotDaySql('b.received_at'), verbatim (the paired test pins it)
    CASE WHEN trim(b.received_at) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN trim(b.received_at)
      WHEN substr(trim(b.received_at),1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(trim(b.received_at),11,2) GLOB '[T ][0-9]'
        AND NOT substr(trim(b.received_at),13) GLOB '*[^!-~]*' THEN date(trim(b.received_at), '+7 hours')
      WHEN date(CASE WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),7,4)||'-'||substr(trim(b.received_at),1,2)||'-'||substr(trim(b.received_at),4,2)
        WHEN trim(b.received_at) GLOB '[0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-0'||substr(trim(b.received_at),1,1)||'-'||substr(trim(b.received_at),3,2)
        WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-'||substr(trim(b.received_at),1,2)||'-0'||substr(trim(b.received_at),4,1)
        WHEN trim(b.received_at) GLOB '[0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),5,4)||'-0'||substr(trim(b.received_at),1,1)||'-0'||substr(trim(b.received_at),3,1) END)=CASE WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),7,4)||'-'||substr(trim(b.received_at),1,2)||'-'||substr(trim(b.received_at),4,2)
        WHEN trim(b.received_at) GLOB '[0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-0'||substr(trim(b.received_at),1,1)||'-'||substr(trim(b.received_at),3,2)
        WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-'||substr(trim(b.received_at),1,2)||'-0'||substr(trim(b.received_at),4,1)
        WHEN trim(b.received_at) GLOB '[0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),5,4)||'-0'||substr(trim(b.received_at),1,1)||'-0'||substr(trim(b.received_at),3,1) END THEN CASE WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),7,4)||'-'||substr(trim(b.received_at),1,2)||'-'||substr(trim(b.received_at),4,2)
        WHEN trim(b.received_at) GLOB '[0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-0'||substr(trim(b.received_at),1,1)||'-'||substr(trim(b.received_at),3,2)
        WHEN trim(b.received_at) GLOB '[0-9][0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),6,4)||'-'||substr(trim(b.received_at),1,2)||'-0'||substr(trim(b.received_at),4,1)
        WHEN trim(b.received_at) GLOB '[0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN substr(trim(b.received_at),5,4)||'-0'||substr(trim(b.received_at),1,1)||'-0'||substr(trim(b.received_at),3,1) END END AS day,
    quote(b.expiry_date) AS ek,
    CASE WHEN typeof(b.unit_cost_usd) IN ('integer', 'real') AND b.unit_cost_usd > 0 THEN 'recorded' WHEN b.unit_cost_usd = 0 THEN 'zero' ELSE 'unknown' END AS cc,
    CASE WHEN qty.tq > 0 THEN 1 ELSE 0 END AS prior,
    CASE WHEN qty.tq = 0 AND qty.sq > 0 THEN 1 ELSE 0 END AS arrival
  FROM br JOIN qty JOIN product_batches b ON b.id = qty.batch_id
    JOIN branch_stock ms ON ms.product_id = b.variant_product_id AND ms.branch_id = br.src AND ms.quantity > 0
), l2 AS (
  SELECT l1.*,
    CASE WHEN sk = '' AND MIN(NULLIF(sk, '')) OVER (PARTITION BY p, day, ek) = MAX(NULLIF(sk, '')) OVER (PARTITION BY p, day, ek)
      THEN MIN(NULLIF(sk, '')) OVER (PARTITION BY p, day, ek) ELSE sk END AS ps
  FROM l1 WHERE day IS NOT NULL
), l3 AS (
  SELECT l2.*,
    CASE WHEN MAX(cc = 'recorded') OVER (PARTITION BY p, day, ek, ps) = 1 THEN 'recorded' ELSE 'none' END AS pc
  FROM l2
), l4 AS (
  SELECT l3.*,
    COALESCE(MIN(CASE WHEN prior = 1 AND sk = ps THEN id END) OVER (PARTITION BY p, day, ek, ps, pc),
      MIN(CASE WHEN arrival = 1 AND sk = ps THEN id END) OVER (PARTITION BY p, day, ek, ps, pc)) AS survivor,
    MAX(arrival) OVER (PARTITION BY p, day, ek, ps, pc) AS has_arrival,
    COUNT(*) OVER (PARTITION BY p, day) AS c_day,
    COUNT(*) OVER (PARTITION BY p, day, ek) AS c_e,
    COUNT(*) OVER (PARTITION BY p, day, ek, ps) AS c_s
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
    SUM(CASE WHEN member = 1 AND cc = 'zero' THEN 1 ELSE 0 END) OVER (PARTITION BY p, day, ek, ps, pc) AS n_zero,
    SUM(CASE WHEN member = 1 AND cc = 'unknown' THEN 1 ELSE 0 END) OVER (PARTITION BY p, day, ek, ps, pc) AS n_unknown,
    MIN(CASE WHEN member = 1 AND cc = 'recorded' THEN cost END) OVER (PARTITION BY p, day, ek, ps, pc) AS min_cost,
    MAX(CASE WHEN member = 1 AND cc = 'recorded' THEN cost END) OVER (PARTITION BY p, day, ek, ps, pc) AS max_cost
  FROM l5
), f AS MATERIALIZED (
  SELECT l6.*, CASE WHEN has_arrival = 1 AND survivor IS NOT NULL AND n_member >= 2 THEN 1 ELSE 0 END AS folds
  FROM l6
), fa AS (
  -- one pass over the classified lots
  SELECT
    COALESCE(SUM(CASE WHEN folds = 1 AND id = survivor THEN 1 ELSE 0 END), 0) AS same_date_merges,
    COALESCE(SUM(CASE WHEN folds = 1 AND member = 1 AND id <> survivor THEN 1 ELSE 0 END), 0) AS folded_lots,
    COALESCE(SUM(CASE WHEN arrival = 1 AND c_e < c_day THEN 1 ELSE 0 END), 0) AS expiry_splits,
    COALESCE(SUM(CASE WHEN arrival = 1 AND c_e = c_day AND c_s < c_e THEN 1 ELSE 0 END), 0) AS supplier_splits,
    COALESCE(SUM(CASE WHEN folds = 1 AND id = survivor AND ps <> '' AND n_empty > 0 THEN 1 ELSE 0 END), 0) AS empty_supplier_merges,
    COALESCE(SUM(CASE WHEN folds = 1 AND id = survivor AND pc = 'recorded' AND n_uncosted > 0 THEN 1 ELSE 0 END), 0) AS uncosted_merges,
    COALESCE(SUM(CASE WHEN folds = 1 AND id = survivor AND pc = 'none' AND n_zero > 0 AND n_unknown > 0 THEN 1 ELSE 0 END), 0) AS free_unknown_merges,
    COALESCE(SUM(CASE WHEN folds = 1 AND id = survivor AND ((pc = 'recorded' AND (cc <> 'recorded' OR min_cost <> max_cost))
      OR (pc = 'none' AND cc = 'zero' AND n_unknown > 0)) THEN 1 ELSE 0 END), 0) AS cost_blend_folds
  FROM f
), la AS (
  -- one pass over the positive lots of moving products
  SELECT
    COALESCE(SUM(arrival), 0) AS arriving_lots,
    COALESCE(SUM(CASE WHEN trim(received_at) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN 1 ELSE 0 END), 0) AS received_date_only,
    COALESCE(SUM(CASE WHEN received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z' THEN 1 ELSE 0 END), 0) AS received_utc_z,
    COALESCE(SUM(CASE WHEN (substr(received_at, 1, 11) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T' AND substr(received_at, -1) <> 'Z'
      AND (instr(substr(received_at, 12), '+') > 0 OR instr(substr(received_at, 12), '-') > 0)) THEN 1 ELSE 0 END), 0) AS received_zoned,
    COALESCE(SUM(CASE WHEN received_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] *' THEN 1 ELSE 0 END), 0) AS received_space_time,
    COALESCE(SUM(CASE WHEN day IS NOT NULL AND instr(received_at, '/') > 0 THEN 1 ELSE 0 END), 0) AS received_slash,
    COALESCE(SUM(CASE WHEN day IS NOT NULL AND instr(received_at, '/') > 0 AND CAST(substr(day, 9, 2) AS INTEGER) <= 12
      AND substr(day, 9, 2) <> substr(day, 6, 2) THEN 1 ELSE 0 END), 0) AS received_slash_ambiguous,
    COALESCE(SUM(CASE WHEN received_at IS NOT NULL AND day IS NULL THEN 1 ELSE 0 END), 0) AS received_other,
    COALESCE(SUM(CASE WHEN received_at IS NULL THEN 1 ELSE 0 END), 0) AS received_null,
    COALESCE(SUM(CASE WHEN length(trim(received_at)) > 10
      AND date(trim(received_at), '+7 hours') <> substr(trim(received_at), 1, 10) THEN 1 ELSE 0 END), 0) AS received_next_day_in_cambodia
  FROM l1
)
SELECT
  CASE WHEN br.n_src = 1 AND br.n_tgt = 1 THEN 1 ELSE 0 END AS branches_ok,
  (SELECT COUNT(*) FROM branch_stock s WHERE s.branch_id = br.src AND s.quantity > 0) AS moving_products,
  la.arriving_lots,
  fa.same_date_merges, fa.folded_lots, fa.expiry_splits, fa.supplier_splits, fa.empty_supplier_merges,
  fa.uncosted_merges, fa.free_unknown_merges, fa.cost_blend_folds,
  (SELECT COUNT(*) FROM branch_stock s WHERE s.branch_id IN (br.src, br.tgt) AND s.quantity <> CAST(s.quantity AS INTEGER))
    + (SELECT COUNT(*) FROM branch_batch_stock s WHERE s.branch_id IN (br.src, br.tgt) AND s.quantity <> CAST(s.quantity AS INTEGER)) AS fractional_rows,
  (SELECT COUNT(*) FROM branch_stock s JOIN branch_stock t ON t.product_id = s.product_id AND t.branch_id = br.tgt
    WHERE s.branch_id = br.src AND s.quantity > 0 AND CAST(printf('%.12f', s.quantity + t.quantity) AS REAL) <> s.quantity + t.quantity)
    + (SELECT COUNT(*) FROM branch_batch_stock s JOIN branch_batch_stock t ON t.batch_id = s.batch_id AND t.branch_id = br.tgt
    WHERE s.branch_id = br.src AND s.quantity > 0 AND CAST(printf('%.12f', s.quantity + t.quantity) AS REAL) <> s.quantity + t.quantity) AS inexact_pairs,
  (SELECT COALESCE(MAX(n), 0) FROM (SELECT COUNT(*) AS n FROM l1 GROUP BY p)) AS max_lots_per_product,
  la.received_date_only, la.received_utc_z, la.received_zoned, la.received_space_time, la.received_slash, la.received_slash_ambiguous,
  la.received_other, la.received_null,
  la.received_next_day_in_cambodia
FROM br, fa, la
