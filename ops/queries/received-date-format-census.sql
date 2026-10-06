-- Received-date format census (branch cutover lane LB). Read-only. Run it
-- through the Ops d1-export task after close. Owner ruling 6 Oct 2026: at the
-- cutover the DATE decides which lots merge, whatever text stored it, so the
-- run reads slash dates too. This shows which text shapes
-- product_batches.received_at holds and, for slash dates, which order
-- (MM/DD or DD/MM) they were written in.
--
-- One row per shape. The shape is a fixed label built from the text's form,
-- never from its content:
--   NULL, not text, blank, YYYY-MM-DD, YYYY-MM-DDT..., YYYY-MM-DD ...,
--   YYYY-MM-DD + other, N/N/YYYY (1-2 digit parts), N/N/YY, slash other,
--   N-N-YYYY, N.N.YYYY, other.
--   lots               lots in the shape
--   positive_lots      of them, lots with stock above 0 at some branch
--   first_seen / last_seen  MIN / MAX(created_at): which writer era stored them
-- For the slash shapes (N/N/YYYY, N/N/YY, slash other; NULL elsewhere):
--   max_first / max_second  the largest first / second number
--   first_gt_12        a first number above 12: only a day can be first (DD/MM)
--   second_gt_12       a second number above 12: only a day can be second (MM/DD)
--   both_le_12_differ  both 12 or less and different: the order changes the date
--   sibling_month_first / sibling_day_first  N/N/YYYY lots whose product has
--                      another lot stored as ISO on the month-first /
--                      day-first reading of the slash date (the UTC date part)
--   examples           up to 5 [product id, batch id, received_at], lowest ids
-- The cutover reads N/N/YYYY MONTH-FIRST (branchCutoverParent.ts
-- cutoverLotBusinessDay): the Aug-28 import column was batch(mm/dd/yyyy) and
-- 0077_batch_received_iso.sql rewrote those rows month-first. That holds while
-- first_gt_12 = 0 on every slash shape. first_gt_12 > 0 means day-first text
-- exists too: stop and ask the owner before the cutover.
-- Cost: one pass over product_batches and over the positive branch_batch_stock
-- rows; the sibling probe reads only the lots of products with a slash date,
-- through the variant index. D1 refuses a LIKE/GLOB pattern over 50 bytes;
-- every pattern here is shorter. Paired test:
-- cloudflare/scripts/test-received-date-format-census-query-pure.cjs
-- ops:min-rows 1
-- ops:max-rows 16
WITH pos AS MATERIALIZED (
  SELECT batch_id FROM branch_batch_stock WHERE quantity > 0 GROUP BY batch_id
), c0 AS MATERIALIZED (
  SELECT b.id, b.variant_product_id AS p, b.received_at AS v, b.created_at, trim(b.received_at) AS t
  FROM product_batches b
), c1 AS MATERIALIZED (
  SELECT c0.*,
    CASE
      WHEN v IS NULL THEN 'NULL'
      WHEN typeof(v) <> 'text' THEN 'not text'
      WHEN t = '' THEN 'blank'
      WHEN t GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN 'YYYY-MM-DD'
      WHEN substr(t, 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        THEN 'YYYY-MM-DD' || CASE substr(t, 11, 1) WHEN 'T' THEN 'T...' WHEN ' ' THEN ' ...' ELSE ' + other' END
      WHEN t GLOB '[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]' OR t GLOB '[0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]'
        OR t GLOB '[0-9][0-9]/[0-9]/[0-9][0-9][0-9][0-9]' OR t GLOB '[0-9]/[0-9]/[0-9][0-9][0-9][0-9]' THEN 'N/N/YYYY'
      WHEN t GLOB '[0-9]*/[0-9]*/[0-9][0-9]' AND NOT t GLOB '*[^0-9/]*' AND length(t) <= 8 THEN 'N/N/YY'
      WHEN instr(t, '/') > 0 THEN 'slash other'
      WHEN t GLOB '[0-9]*-[0-9]*-[0-9][0-9][0-9][0-9]' AND NOT t GLOB '*[^0-9-]*' THEN 'N-N-YYYY'
      WHEN t GLOB '[0-9]*.[0-9]*.[0-9][0-9][0-9][0-9]' AND NOT t GLOB '*[^0-9.]*' THEN 'N.N.YYYY'
      ELSE 'other'
    END AS shape,
    CASE WHEN instr(t, '/') > 0 THEN CAST(substr(t, 1, instr(t, '/') - 1) AS INTEGER) END AS s1,
    CASE WHEN instr(t, '/') > 0 THEN substr(t, instr(t, '/') + 1) END AS rest
  FROM c0
), c AS MATERIALIZED (
  SELECT c1.*,
    CASE WHEN rest IS NOT NULL AND instr(rest, '/') > 0 THEN CAST(substr(rest, 1, instr(rest, '/') - 1) AS INTEGER) END AS s2,
    CASE WHEN shape = 'N/N/YYYY' THEN printf('%s-%02d-%02d', substr(t, -4), s1,
      CAST(substr(rest, 1, instr(rest, '/') - 1) AS INTEGER)) END AS mf,
    CASE WHEN shape = 'N/N/YYYY' THEN printf('%s-%02d-%02d', substr(t, -4),
      CAST(substr(rest, 1, instr(rest, '/') - 1) AS INTEGER), s1) END AS df
  FROM c1
), sib AS MATERIALIZED (
  -- only N/N/YYYY lots, each joined to its own product's lots through the variant index
  SELECT s.id,
    MAX(CASE WHEN substr(trim(o.received_at), 1, 10) = s.mf THEN 1 ELSE 0 END) AS hit_mf,
    MAX(CASE WHEN substr(trim(o.received_at), 1, 10) = s.df THEN 1 ELSE 0 END) AS hit_df
  FROM c s CROSS JOIN product_batches o ON o.variant_product_id = s.p AND o.id <> s.id
  WHERE s.shape = 'N/N/YYYY' AND substr(trim(o.received_at), 1, 10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  GROUP BY s.id
), ex AS (
  SELECT shape, json_group_array(json_array(p, id, CASE WHEN v IS NULL OR typeof(v) = 'text' THEN v ELSE '<' || typeof(v) || '>' END)) AS examples
  FROM (SELECT shape, p, id, v, ROW_NUMBER() OVER (PARTITION BY shape ORDER BY id) AS rn FROM c)
  WHERE rn <= 5
  GROUP BY shape
), agg AS (
  SELECT c.shape,
    COUNT(*) AS lots,
    SUM(CASE WHEN pos.batch_id IS NOT NULL THEN 1 ELSE 0 END) AS positive_lots,
    MIN(c.created_at) AS first_seen,
    MAX(c.created_at) AS last_seen,
    MAX(c.s1) AS max_first,
    MAX(c.s2) AS max_second,
    SUM(CASE WHEN c.s1 > 12 THEN 1 ELSE 0 END) AS first_gt_12,
    SUM(CASE WHEN c.s2 > 12 THEN 1 ELSE 0 END) AS second_gt_12,
    SUM(CASE WHEN c.s1 <= 12 AND c.s2 <= 12 AND c.s1 <> c.s2 THEN 1 ELSE 0 END) AS both_le_12_differ,
    SUM(COALESCE(sib.hit_mf, 0)) AS sibling_month_first,
    SUM(COALESCE(sib.hit_df, 0)) AS sibling_day_first
  FROM c LEFT JOIN pos ON pos.batch_id = c.id LEFT JOIN sib ON sib.id = c.id
  GROUP BY c.shape
)
SELECT agg.shape, agg.lots, agg.positive_lots, agg.first_seen, agg.last_seen,
  CASE WHEN instr(agg.shape, '/') > 0 OR agg.shape = 'slash other' THEN agg.max_first END AS max_first,
  CASE WHEN instr(agg.shape, '/') > 0 OR agg.shape = 'slash other' THEN agg.max_second END AS max_second,
  CASE WHEN instr(agg.shape, '/') > 0 OR agg.shape = 'slash other' THEN agg.first_gt_12 END AS first_gt_12,
  CASE WHEN instr(agg.shape, '/') > 0 OR agg.shape = 'slash other' THEN agg.second_gt_12 END AS second_gt_12,
  CASE WHEN instr(agg.shape, '/') > 0 OR agg.shape = 'slash other' THEN agg.both_le_12_differ END AS both_le_12_differ,
  CASE WHEN agg.shape = 'N/N/YYYY' THEN agg.sibling_month_first END AS sibling_month_first,
  CASE WHEN agg.shape = 'N/N/YYYY' THEN agg.sibling_day_first END AS sibling_day_first,
  ex.examples
FROM agg LEFT JOIN ex ON ex.shape = agg.shape
ORDER BY agg.lots DESC, agg.shape
