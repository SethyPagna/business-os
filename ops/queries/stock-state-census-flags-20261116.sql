-- stock-state-census-flags-20261116: stock-state design Phase 0, census C9: the low / out flag distribution under the CURRENT
-- low-stock settings, computed with the design's own status formula over the visible catalogue.
--   cfg_enabled / cfg_mode / cfg_threshold   the three settings keys resolved as resolveLowStockConfig does (absent or blank =
--                       enabled, product mode, 10; anything a shop would read as no = off; a threshold that is not a whole
--                       number up to 1,000,000 falls back to 10). SQL trim removes spaces only, JS trim also removes other
--                       white space: a key with a stray tab would resolve differently here, which the settings census shows.
--   rows_healthy / rows_low / rows_out        visible rows (header rows included) by status: out when qty <= out threshold,
--                       else low when qty <= effective low threshold (-1 when alerts are off, the global in global mode,
--                       COALESCE(own, global) in product mode), else healthy; NULL quantity counts as 0
--   child_low / child_out                     the summary's child counters (visible rows with status 1 / 2)
--   fam_healthy / fam_low / fam_out           family status by the design's header rule: a family is healthy when any member
--                       (non-header members when it has any) is healthy, else low when any is low, else out
--   families                                  visible families
--   low_by_own_threshold / low_by_global      low rows whose own threshold decided / the global decided (a hint for how many
--                       rows a settings change would flip)
--   flip_if_global_5 / _20                    rows whose status would change if the mode were global with 5 / 20
-- Counts only; no name, no key text. Never ANALYZE, never a write. One row.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 100000
WITH cfg AS MATERIALIZED (
  SELECT
    CASE WHEN lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'low_stock_alert_enabled'), ''))) IN ('0', 'false', 'off', 'no')
         THEN 0 ELSE 1 END AS enabled,
    CASE WHEN lower(trim(COALESCE((SELECT value FROM settings WHERE key = 'low_stock_threshold_mode'), ''))) = 'global'
         THEN 'global' ELSE 'product' END AS mode,
    COALESCE((SELECT CASE WHEN length(trim(value)) BETWEEN 1 AND 18 AND trim(value) NOT GLOB '*[^0-9]*'
                           AND CAST(trim(value) AS INTEGER) <= 1000000 THEN CAST(trim(value) AS INTEGER) END
              FROM settings WHERE key = 'low_stock_threshold_default'), 10) AS threshold
),
base AS MATERIALIZED (
  SELECT p.id AS id,
    CASE WHEN COALESCE(p.is_group, 0) = 1 AND COALESCE(p.parent_id, 0) = 0 THEN 1 ELSE 0 END AS hdr,
    COALESCE(NULLIF(COALESCE(parent.name_key, p.name_key), ''), 'id:' || COALESCE(parent.id, p.id)) AS fk,
    COALESCE(p.stock_quantity, 0) AS q,
    COALESCE(p.out_of_stock_threshold, 0) AS ou,
    p.low_stock_threshold AS lo
  FROM products p
  LEFT JOIN products parent ON parent.id = p.parent_id
  WHERE p.is_active = 1
     OR COALESCE(p.stock_quantity, 0) <> 0
     OR EXISTS (SELECT 1 FROM branch_stock bs WHERE bs.product_id = p.id AND bs.quantity <> 0)
     OR EXISTS (SELECT 1 FROM product_batches pb JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id
                WHERE pb.variant_product_id = p.id AND bbs.quantity <> 0)
     OR EXISTS (SELECT 1 FROM damaged_stock_lots dl WHERE dl.product_id = p.id AND dl.quantity_remaining <> 0)
),
st AS MATERIALIZED (
  SELECT base.fk AS fk, base.hdr AS hdr, base.lo AS lo,
    CASE WHEN base.q <= base.ou THEN 2
         WHEN base.q <= (CASE WHEN cfg.enabled = 0 THEN -1 WHEN cfg.mode = 'global' THEN cfg.threshold
                              ELSE COALESCE(base.lo, cfg.threshold) END) THEN 1
         ELSE 0 END AS s,
    CASE WHEN base.q <= base.ou THEN 2 WHEN base.q <= 5 THEN 1 ELSE 0 END AS s5,
    CASE WHEN base.q <= base.ou THEN 2 WHEN base.q <= 20 THEN 1 ELSE 0 END AS s20,
    cfg.mode AS mode, cfg.enabled AS enabled
  FROM base CROSS JOIN cfg
),
fam AS MATERIALIZED (
  SELECT fk,
    CASE WHEN SUM(CASE WHEN hdr = 0 THEN 1 ELSE 0 END) > 0
         THEN SUM(CASE WHEN hdr = 0 AND s = 0 THEN 1 ELSE 0 END) ELSE SUM(CASE WHEN s = 0 THEN 1 ELSE 0 END) END AS h,
    CASE WHEN SUM(CASE WHEN hdr = 0 THEN 1 ELSE 0 END) > 0
         THEN SUM(CASE WHEN hdr = 0 AND s = 1 THEN 1 ELSE 0 END) ELSE SUM(CASE WHEN s = 1 THEN 1 ELSE 0 END) END AS l
  FROM st GROUP BY fk
),
fa AS MATERIALIZED (
  SELECT COUNT(*) AS families, SUM(CASE WHEN h > 0 THEN 1 ELSE 0 END) AS fam_healthy,
    SUM(CASE WHEN h = 0 AND l > 0 THEN 1 ELSE 0 END) AS fam_low, SUM(CASE WHEN h = 0 AND l = 0 THEN 1 ELSE 0 END) AS fam_out
  FROM fam
),
sa AS MATERIALIZED (
  SELECT SUM(CASE WHEN s = 0 THEN 1 ELSE 0 END) AS rows_healthy, SUM(CASE WHEN s = 1 THEN 1 ELSE 0 END) AS rows_low,
    SUM(CASE WHEN s = 2 THEN 1 ELSE 0 END) AS rows_out,
    SUM(CASE WHEN s = 1 AND mode = 'product' AND enabled = 1 AND lo IS NOT NULL THEN 1 ELSE 0 END) AS low_by_own_threshold,
    SUM(CASE WHEN s = 1 AND (mode = 'global' OR enabled = 0 OR lo IS NULL) THEN 1 ELSE 0 END) AS low_by_global,
    SUM(CASE WHEN s <> s5 THEN 1 ELSE 0 END) AS flip_if_global_5,
    SUM(CASE WHEN s <> s20 THEN 1 ELSE 0 END) AS flip_if_global_20
  FROM st
)
SELECT
  (SELECT enabled FROM cfg) AS cfg_enabled,
  (SELECT mode FROM cfg) AS cfg_mode,
  (SELECT threshold FROM cfg) AS cfg_threshold,
  COALESCE(sa.rows_healthy, 0) AS rows_healthy, COALESCE(sa.rows_low, 0) AS rows_low, COALESCE(sa.rows_out, 0) AS rows_out,
  COALESCE(sa.rows_low, 0) AS child_low, COALESCE(sa.rows_out, 0) AS child_out,
  fa.families, COALESCE(fa.fam_healthy, 0) AS fam_healthy, COALESCE(fa.fam_low, 0) AS fam_low, COALESCE(fa.fam_out, 0) AS fam_out,
  COALESCE(sa.low_by_own_threshold, 0) AS low_by_own_threshold, COALESCE(sa.low_by_global, 0) AS low_by_global,
  COALESCE(sa.flip_if_global_5, 0) AS flip_if_global_5, COALESCE(sa.flip_if_global_20, 0) AS flip_if_global_20
FROM sa, fa
