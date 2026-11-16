-- stock-state-census-exactness-20261116: stock-state design Phase 0, census C1, C2, C3, C8 and C10.
-- Decides whether the e4 integer money column and the verbatim REAL quantity copies are exact on production data:
--   C1  fractional / non-numeric quantities in products, branch_stock and branch_batch_stock
--   C2  NULL products.stock_quantity (the bell sorts NULL first, so the copy must keep NULL)
--   C3  cost_price_usd / cost_price_khr with more than 4 decimals (the design's own test: |c*10000 - round(c*10000)| > 1e-6)
--   C8  largest ids, quantities and per-row values (the isSafeInteger / 9e14 guard in the generator)
--   C10 typeof and sign distribution of low_stock_threshold and out_of_stock_threshold
--   inexact_products  rows the generator would flag inexact = 1 (the design's exact predicate)
-- One pass over each table, no name, phone or customer column; every figure is a count or a maximum.
-- Never ANALYZE, never a write. One row of scalar columns.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 160000
WITH pr AS MATERIALIZED (
  SELECT
    COUNT(*) AS products_total,
    SUM(CASE WHEN q IS NULL THEN 1 ELSE 0 END) AS stock_null,
    SUM(CASE WHEN tq NOT IN ('integer', 'real', 'null') THEN 1 ELSE 0 END) AS stock_non_numeric,
    SUM(CASE WHEN tq IN ('integer', 'real') AND q <> CAST(q AS INTEGER) THEN 1 ELSE 0 END) AS stock_fractional,
    SUM(CASE WHEN tq IN ('integer', 'real') AND q < 0 THEN 1 ELSE 0 END) AS stock_negative,
    SUM(CASE WHEN tu NOT IN ('integer', 'real', 'null') OR tk NOT IN ('integer', 'real', 'null') THEN 1 ELSE 0 END) AS cost_non_numeric,
    SUM(CASE WHEN tu IN ('integer', 'real') AND ABS(cu * 10000 - ROUND(cu * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS cost_usd_over_4dp,
    SUM(CASE WHEN tk IN ('integer', 'real') AND ABS(ck * 10000 - ROUND(ck * 10000)) > 0.000001 THEN 1 ELSE 0 END) AS cost_khr_over_4dp,
    SUM(CASE WHEN tu IN ('integer', 'real') AND ABS(MAX(COALESCE(q, 0), 0) * cu) > 900000000000000 THEN 1 ELSE 0 END) AS value_usd_over_9e14,
    SUM(CASE WHEN tk IN ('integer', 'real') AND ABS(MAX(COALESCE(q, 0), 0) * ck) > 900000000000000 THEN 1 ELSE 0 END) AS value_khr_over_9e14,
    SUM(CASE WHEN tq NOT IN ('integer', 'real', 'null')
               OR COALESCE(q, 0) <> CAST(COALESCE(q, 0) AS INTEGER)
               OR (tu IN ('integer', 'real') AND (ABS(cu * 10000 - ROUND(cu * 10000)) > 0.000001 OR ABS(MAX(COALESCE(q, 0), 0) * cu) > 900000000000000))
               OR (tk IN ('integer', 'real') AND (ABS(ck * 10000 - ROUND(ck * 10000)) > 0.000001 OR ABS(MAX(COALESCE(q, 0), 0) * ck) > 900000000000000))
             THEN 1 ELSE 0 END) AS inexact_products,
    SUM(CASE WHEN tl = 'null' THEN 1 ELSE 0 END) AS low_thr_null,
    SUM(CASE WHEN tl = 'integer' THEN 1 ELSE 0 END) AS low_thr_integer,
    SUM(CASE WHEN tl = 'real' THEN 1 ELSE 0 END) AS low_thr_real,
    SUM(CASE WHEN tl NOT IN ('integer', 'real', 'null') THEN 1 ELSE 0 END) AS low_thr_other_type,
    SUM(CASE WHEN tl IN ('integer', 'real') AND lo < 0 THEN 1 ELSE 0 END) AS low_thr_negative,
    SUM(CASE WHEN tl IN ('integer', 'real') AND lo <> CAST(lo AS INTEGER) THEN 1 ELSE 0 END) AS low_thr_fractional,
    SUM(CASE WHEN to_ = 'null' THEN 1 ELSE 0 END) AS out_thr_null,
    SUM(CASE WHEN to_ = 'integer' THEN 1 ELSE 0 END) AS out_thr_integer,
    SUM(CASE WHEN to_ = 'real' THEN 1 ELSE 0 END) AS out_thr_real,
    SUM(CASE WHEN to_ NOT IN ('integer', 'real', 'null') THEN 1 ELSE 0 END) AS out_thr_other_type,
    SUM(CASE WHEN to_ IN ('integer', 'real') AND ou < 0 THEN 1 ELSE 0 END) AS out_thr_negative,
    SUM(CASE WHEN to_ IN ('integer', 'real') AND ou <> CAST(ou AS INTEGER) THEN 1 ELSE 0 END) AS out_thr_fractional,
    MAX(id) AS max_product_id,
    MAX(CASE WHEN tq IN ('integer', 'real') THEN q END) AS max_stock_quantity,
    MIN(CASE WHEN tq IN ('integer', 'real') THEN q END) AS min_stock_quantity,
    MAX(CASE WHEN tu IN ('integer', 'real') THEN cu END) AS max_cost_usd,
    MAX(CASE WHEN tk IN ('integer', 'real') THEN ck END) AS max_cost_khr,
    MAX(CASE WHEN tu IN ('integer', 'real') THEN MAX(COALESCE(q, 0), 0) * cu END) AS max_row_value_usd,
    MAX(CASE WHEN tk IN ('integer', 'real') THEN MAX(COALESCE(q, 0), 0) * ck END) AS max_row_value_khr
  FROM (
    SELECT id, stock_quantity AS q, typeof(stock_quantity) AS tq,
      cost_price_usd AS cu, typeof(cost_price_usd) AS tu, cost_price_khr AS ck, typeof(cost_price_khr) AS tk,
      low_stock_threshold AS lo, typeof(low_stock_threshold) AS tl, out_of_stock_threshold AS ou, typeof(out_of_stock_threshold) AS to_
    FROM products
  )
),
bs AS MATERIALIZED (
  SELECT
    COUNT(*) AS branch_stock_rows,
    SUM(CASE WHEN typeof(quantity) NOT IN ('integer', 'real') THEN 1 ELSE 0 END) AS branch_stock_null_or_non_numeric,
    SUM(CASE WHEN typeof(quantity) IN ('integer', 'real') AND quantity <> CAST(quantity AS INTEGER) THEN 1 ELSE 0 END) AS branch_stock_fractional,
    SUM(CASE WHEN typeof(quantity) IN ('integer', 'real') AND quantity < 0 THEN 1 ELSE 0 END) AS branch_stock_negative,
    MAX(branch_id) AS max_branch_id,
    MAX(CASE WHEN typeof(quantity) IN ('integer', 'real') THEN quantity END) AS max_branch_stock_quantity
  FROM branch_stock
),
lt AS MATERIALIZED (
  SELECT
    COUNT(*) AS lot_stock_rows,
    SUM(CASE WHEN typeof(quantity) NOT IN ('integer', 'real') THEN 1 ELSE 0 END) AS lot_stock_null_or_non_numeric,
    SUM(CASE WHEN typeof(quantity) IN ('integer', 'real') AND quantity <> CAST(quantity AS INTEGER) THEN 1 ELSE 0 END) AS lot_stock_fractional,
    SUM(CASE WHEN typeof(quantity) IN ('integer', 'real') AND quantity < 0 THEN 1 ELSE 0 END) AS lot_stock_negative,
    MAX(CASE WHEN typeof(quantity) IN ('integer', 'real') THEN quantity END) AS max_lot_quantity
  FROM branch_batch_stock
)
SELECT pr.*, bs.*, lt.* FROM pr, bs, lt
