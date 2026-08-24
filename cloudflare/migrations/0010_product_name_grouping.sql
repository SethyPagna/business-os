-- Fixes the Products/Inventory "Groups" filter freeze (reported as: pick
-- Filter -> Group -> "Filter Group" and the whole app hangs on
-- "Refreshing", then every other page starts failing too).
--
-- Root cause: products.ts's buildSearchFilters and inventory.ts's
-- appendInventoryProductFilters both decided "is this product part of a
-- group" with a correlated EXISTS that re-scans the entire products table
-- for every single row:
--
--   EXISTS (SELECT 1 FROM products p2 WHERE p2.id <> p.id
--           AND lower(trim(p2.name)) = lower(trim(p.name)) ...)
--
-- That's O(n^2) over the catalog, and lower(trim(name)) can't use the
-- existing idx_products_name_lower_pg index (it's only on lower(name), not
-- lower(trim(name))), so each of those per-row scans was a full table scan.
-- paginateProductFamilies evaluates the WHERE clause twice per request
-- (once for the COUNT, once for the page), and Inventory's
-- getInventoryProductMetadata adds two more (brand list + initials bar) --
-- so one "Groups" filter click could mean 4-5 full O(n^2) passes over the
-- table in a single request, blowing well past D1/Workers' CPU-time limit.
-- Because D1 serializes writes/queries per database, that one request tied
-- up the whole database long enough to make unrelated pages look broken
-- too -- matching exactly what was reported.
--
-- Fix: stop recomputing "grouped" at query time altogether. Group
-- membership is now a persisted, indexed fact on the row itself
-- (name_key + is_grouped_cached), maintained by triggers whenever a
-- product is inserted, renamed, (de)activated, or deleted -- regardless of
-- which code path did it (single edit, CSV import, admin script, etc,
-- since these are database-level triggers, not application code). Reading
-- "is this product grouped" becomes a plain indexed column check, and
-- writes only ever touch the handful of rows that share a name, never the
-- whole table.
--
-- name_key mirrors the frontend's grouping key exactly (see
-- frontend/src/utils/productGrouping.ts's resolveGroupKey): lower(trim(name)).

ALTER TABLE products ADD COLUMN name_key TEXT DEFAULT '';
ALTER TABLE products ADD COLUMN is_grouped_cached INTEGER DEFAULT 0;

-- One-time backfill for existing rows (ALTER TABLE ... ADD COLUMN doesn't
-- run triggers, and there are no triggers yet at this point in the
-- migration anyway). This is the only place a full-table GROUP BY happens
-- -- once, at migration time, not on every request.
UPDATE products SET name_key = lower(trim(name));

UPDATE products
  SET is_grouped_cached = 1
  WHERE is_active = 1
    AND name_key <> ''
    AND name_key IN (
      SELECT name_key FROM products
      WHERE is_active = 1 AND name_key <> ''
      GROUP BY name_key
      HAVING COUNT(*) > 1
    );

CREATE INDEX IF NOT EXISTS idx_products_name_key_pg ON products (name_key);
CREATE INDEX IF NOT EXISTS idx_products_active_grouped_pg ON products (is_active, is_grouped_cached);

-- Keep name_key in sync and recompute is_grouped_cached for just the
-- (small) set of rows sharing a name_key -- never the whole table.
--
-- NOTE: the BEGIN below is deliberately uppercase. Cloudflare's remote
-- `wrangler d1 migrations apply --remote` has a known bug (workers-sdk
-- #10998) where a lowercase `begin` inside CREATE TRIGGER makes its
-- statement-splitter mis-parse the trigger body and fail with
-- "incomplete input: SQLITE_ERROR [code: 7500]" -- it works fine locally
-- and via plain `wrangler d1 execute`, only remote migrations choke on it.
-- Uppercase BEGIN avoids it. Verified this trigger design (insert/rename/
-- deactivate/reactivate/delete/blank-name/merge, plus 200 randomized ops)
-- against a real SQLite engine before writing this migration.
CREATE TRIGGER IF NOT EXISTS trg_products_ai_name_key
AFTER INSERT ON products
BEGIN
  UPDATE products SET name_key = lower(trim(NEW.name)) WHERE id = NEW.id;
  UPDATE products
    SET is_grouped_cached = (
      (SELECT COUNT(*) FROM products p2 WHERE p2.name_key = lower(trim(NEW.name)) AND p2.is_active = 1) > 1
    )
    WHERE name_key = lower(trim(NEW.name)) AND is_active = 1 AND lower(trim(NEW.name)) <> '';
END;

CREATE TRIGGER IF NOT EXISTS trg_products_au_name_active
AFTER UPDATE OF name, is_active ON products
WHEN NEW.name IS NOT OLD.name OR NEW.is_active IS NOT OLD.is_active
BEGIN
  UPDATE products SET name_key = lower(trim(NEW.name)) WHERE id = NEW.id AND name_key IS NOT lower(trim(NEW.name));

  -- Recompute the group this row is LEAVING (its old name_key), if it
  -- actually changed name_key.
  UPDATE products
    SET is_grouped_cached = (
      (SELECT COUNT(*) FROM products p2 WHERE p2.name_key = OLD.name_key AND p2.is_active = 1) > 1
    )
    WHERE name_key = OLD.name_key AND is_active = 1 AND OLD.name_key <> '' AND OLD.name_key IS NOT lower(trim(NEW.name));

  -- Recompute the group this row is now IN (its new name_key / new active
  -- state -- covers plain (de)activation with no name change too).
  UPDATE products
    SET is_grouped_cached = (
      (SELECT COUNT(*) FROM products p2 WHERE p2.name_key = lower(trim(NEW.name)) AND p2.is_active = 1) > 1
    )
    WHERE name_key = lower(trim(NEW.name)) AND is_active = 1 AND lower(trim(NEW.name)) <> '';

  -- If this row itself just went inactive or blank-named, the two updates
  -- above won't have touched it (they only target is_active=1 / non-blank
  -- rows) -- clear its own flag explicitly so it doesn't keep a stale 1.
  UPDATE products SET is_grouped_cached = 0
    WHERE id = NEW.id AND (NEW.is_active = 0 OR lower(trim(NEW.name)) = '');
END;

CREATE TRIGGER IF NOT EXISTS trg_products_ad_name_key
AFTER DELETE ON products
BEGIN
  UPDATE products
    SET is_grouped_cached = (
      (SELECT COUNT(*) FROM products p2 WHERE p2.name_key = OLD.name_key AND p2.is_active = 1) > 1
    )
    WHERE name_key = OLD.name_key AND is_active = 1 AND OLD.name_key <> '';
END;
