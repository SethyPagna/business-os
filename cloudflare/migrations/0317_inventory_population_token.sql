-- 0317: a membership token for the Inventory status counts, kept by the database itself.
--
-- The counts (lib/inventoryCheckList.ts) need the size of the Inventory population: the active product rows that are not family headers. Almost every stock write moves the cached `products`
-- version, so a count keyed on it reran all day. The token below changes only when that population can change, so the count is read once per real change of membership, whichever writer made it.
--
-- inventory_population_token  one row (id = 1), a random 16-hex token. Triggers on products set a new one on INSERT, on DELETE, and on an UPDATE that really changes id, is_active or is_group.
-- A backup restore holds the maintenance flag in mode 'restore' and the triggers do not fire then (the guard of 0124), the restore and every dataset reset rotate the data epoch and the token
-- together (lib/dataEpoch.ts), so nothing counted before them is read afterwards. The token table is not backed up: a restored database keeps a token of its own.
-- idx_products_inventory_population  the count is a covering count of this partial index: one entry per member row, written only when a row enters or leaves the population.
--
-- PRE:  products has is_active and is_group, no inventory_population_token table.
-- POST: one token row, three triggers, one partial index. No product, stock or history row is read or changed.
-- Cost: a product create writes 1 token row and 1 index entry on top of its own rows, an import of N rows writes N of each, a delete the same, an update that touches none of id, is_active, is_group writes 0.
-- Recovery: drop the three triggers, the index and the table, the Worker then keys the counts on an unreadable token and computes them uncached (correct, dearer). Nothing else depends on them.
CREATE TABLE inventory_population_token (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  stamp TEXT NOT NULL CHECK (length(stamp) = 16)
);

INSERT INTO inventory_population_token (id, stamp) VALUES (1, lower(hex(randomblob(8))));

CREATE INDEX idx_products_inventory_population ON products (is_active, is_group) WHERE is_active = 1 AND COALESCE(is_group, 0) = 0;

CREATE TRIGGER inventory_population_token_products_insert AFTER INSERT ON products
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE inventory_population_token SET stamp = lower(hex(randomblob(8))) WHERE id = 1;
END;

CREATE TRIGGER inventory_population_token_products_delete AFTER DELETE ON products
WHEN NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE inventory_population_token SET stamp = lower(hex(randomblob(8))) WHERE id = 1;
END;

CREATE TRIGGER inventory_population_token_products_update AFTER UPDATE OF id, is_active, is_group ON products
WHEN (OLD.id IS NOT NEW.id OR OLD.is_active IS NOT NEW.is_active OR OLD.is_group IS NOT NEW.is_group)
  AND NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'maintenance' AND json_extract(value, '$.mode') = 'restore')
BEGIN
  UPDATE inventory_population_token SET stamp = lower(hex(randomblob(8))) WHERE id = 1;
END;
