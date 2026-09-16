-- 0167: backfill a cost snapshot onto existing 'remove'/'write_off'
-- inventory_movements rows that carry no cost anywhere.
--
-- PREPARED, NOT APPLIED. Data-only; no DDL. Append-only chain (0166 is the
-- prior migration slot; this lane only ever saw up to 0164 applied, so the
-- number is reserved ahead by the coordinator for this lane -- see the
-- session's own coordination notes, not re-derived here).
--
-- MUST run AFTER 0165 (the product-duplicate merge migration, p5/data-merge
-- lane) -- see the "same-name twin" tier below. It reads whichever product
-- row 0165 leaves standing after folding duplicates together; running this
-- migration first would price some rows off a twin 0165 is about to merge
-- away, and the backfilled number would go stale the moment 0165 lands.
--
-- Owner (Sep 15 2026): "there is issue with the product loss (removed
-- stock)...if it is removed not restock it is loss...i see the report says
-- row removed has 1 no cost price. this is impossible find issue and fix."
-- Production evidence: inventory_movements id 47026 (product 2556
-- "Girlactik Face Glow Goldie", a leading-zero-barcode duplicate of a
-- product that carries the real cost) is priced at $0 -- its own lot and
-- its own product row are both uncosted. 17 of 56 'remove' rows carry no
-- cost snapshot in production.
--
-- lib/removalLosses.ts's REMOVAL_LOSS_SELECT already resolves this same
-- four-tier chain AT READ TIME (lot cost -> product cost -> the product's
-- own other costed lot -> a same-name twin's costed lot), so the loss STAT
-- is already correct without this migration. This migration exists for
-- surfaces that read inventory_movements' unit_cost_usd/total_cost_usd
-- columns directly (the raw stock-change ledger, exports, any future
-- report that is not routed through removalLosses.ts) so THOSE surfaces
-- stop showing "no cost" for a row the loss stat already knows how to
-- price.
--
-- Two UPDATE statements:
--   1. unit_cost_usd / unit_cost_khr, from the chain below, ONLY on rows
--      that currently carry neither a unit nor a total cost (so a row
--      genuinely priced at a real $0 total -- which cannot happen for a
--      positive-quantity removal since removalRowLossUsd already treats a
--      stored 0 as absence -- is never touched, and a row this migration
--      cannot price at all is left alone rather than being pinned to a
--      wrong number).
--   2. total_cost_usd / total_cost_khr, computed from the unit cost just
--      set x quantity, ONLY on rows whose total is still 0.
--
-- Idempotent by construction: the WHERE guards on both statements only
-- match a row currently at cost 0/NULL, so a second run updates zero rows
-- -- verified by scripts/verify-0167-removal-cost-backfill.cjs, which runs
-- this file twice against a copy of a given sqlite path and asserts the
-- second run is a no-op and no row outside the uncosted-loss set changed.
--
-- Restricted to `quantity > 0` -- a negative-quantity row (a stock-session
-- undo's 'remove', or the merge's 'adjustment') is never a loss and is left
-- completely untouched by both statements below.

UPDATE inventory_movements
SET
  unit_cost_usd = (
    SELECT COALESCE(
      NULLIF(pb.unit_cost_usd, 0),
      NULLIF(p.cost_price_usd, 0),
      (SELECT NULLIF(pb2.unit_cost_usd, 0) FROM product_batches pb2
         WHERE pb2.variant_product_id = p.id
           AND pb2.unit_cost_usd IS NOT NULL AND pb2.unit_cost_usd > 0
         ORDER BY pb2.received_at DESC, pb2.id DESC LIMIT 1),
      (SELECT NULLIF(pb3.unit_cost_usd, 0) FROM product_batches pb3
         JOIN products p3 ON p3.id = pb3.variant_product_id
         WHERE p3.id != p.id AND LOWER(TRIM(p3.name)) = LOWER(TRIM(p.name))
           AND pb3.unit_cost_usd IS NOT NULL AND pb3.unit_cost_usd > 0
         ORDER BY pb3.received_at DESC, pb3.id DESC LIMIT 1)
    )
    FROM products p
    LEFT JOIN product_batches pb ON pb.id = inventory_movements.batch_id
    WHERE p.id = inventory_movements.product_id
  ),
  unit_cost_khr = (
    -- product_batches carries no per-lot KHR cost column (migration 0065
    -- only added unit_cost_usd), so the KHR chain is two-tier: the
    -- product's own cost_price_khr, then a same-name twin's.
    SELECT COALESCE(
      NULLIF(p.cost_price_khr, 0),
      (SELECT NULLIF(p3.cost_price_khr, 0) FROM products p3
         WHERE p3.id != p.id AND LOWER(TRIM(p3.name)) = LOWER(TRIM(p.name))
         ORDER BY p3.id DESC LIMIT 1)
    )
    FROM products p WHERE p.id = inventory_movements.product_id
  )
WHERE movement_type IN ('remove', 'write_off')
  AND quantity > 0
  AND COALESCE(unit_cost_usd, 0) = 0
  AND COALESCE(total_cost_usd, 0) = 0
  -- Only touch rows the chain can actually resolve, so the guard above
  -- stays a true idempotency check rather than a repeated no-op write.
  AND EXISTS (
    SELECT 1 FROM products p
    LEFT JOIN product_batches pb ON pb.id = inventory_movements.batch_id
    WHERE p.id = inventory_movements.product_id
      AND COALESCE(
        NULLIF(pb.unit_cost_usd, 0),
        NULLIF(p.cost_price_usd, 0),
        (SELECT NULLIF(pb2.unit_cost_usd, 0) FROM product_batches pb2
           WHERE pb2.variant_product_id = p.id
             AND pb2.unit_cost_usd IS NOT NULL AND pb2.unit_cost_usd > 0
           ORDER BY pb2.received_at DESC, pb2.id DESC LIMIT 1),
        (SELECT NULLIF(pb3.unit_cost_usd, 0) FROM product_batches pb3
           JOIN products p3 ON p3.id = pb3.variant_product_id
           WHERE p3.id != p.id AND LOWER(TRIM(p3.name)) = LOWER(TRIM(p.name))
             AND pb3.unit_cost_usd IS NOT NULL AND pb3.unit_cost_usd > 0
           ORDER BY pb3.received_at DESC, pb3.id DESC LIMIT 1)
      ) IS NOT NULL
  );

UPDATE inventory_movements
SET total_cost_usd = ROUND(unit_cost_usd * quantity, 4)
WHERE movement_type IN ('remove', 'write_off')
  AND quantity > 0
  AND unit_cost_usd IS NOT NULL AND unit_cost_usd > 0
  AND COALESCE(total_cost_usd, 0) = 0;

UPDATE inventory_movements
SET total_cost_khr = ROUND(unit_cost_khr * quantity, 4)
WHERE movement_type IN ('remove', 'write_off')
  AND quantity > 0
  AND unit_cost_khr IS NOT NULL AND unit_cost_khr > 0
  AND COALESCE(total_cost_khr, 0) = 0;
