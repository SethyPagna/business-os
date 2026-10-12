-- Finding M exposure: sale-keyed return-type stock movements whose reference_id
-- is at or above the next customer-return id block every later return create
-- (returns.ts postcondition counts movements by reference_id alone).
-- Counts and ids only; no names, cash or notes.
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT seq FROM sqlite_sequence WHERE name = 'returns') AS returns_seq,
  (SELECT MAX(id) FROM returns) AS max_return_id,
  (SELECT MAX(id) FROM sales) AS max_sale_id,
  (SELECT MIN(m.reference_id) FROM inventory_movements m
    WHERE m.movement_type IN ('return', 'damage_in', 'replacement_out', 'write_off')
      AND m.reference_id > COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'returns'), 0)
      AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.id = m.reference_id)) AS first_blocking_return_id,
  (SELECT COUNT(DISTINCT m.reference_id) FROM inventory_movements m
    WHERE m.movement_type IN ('return', 'damage_in', 'replacement_out', 'write_off')
      AND m.reference_id > COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'returns'), 0)
      AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.id = m.reference_id)) AS future_blocking_ids,
  (SELECT COUNT(*) FROM inventory_movements m
    WHERE m.movement_type IN ('return', 'damage_in', 'replacement_out', 'write_off')
      AND m.reference_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.id = m.reference_id)) AS return_type_rows_not_return_keyed,
  (SELECT COUNT(*) FROM returns WHERE created_at >= datetime('now', '-7 days')) AS returns_last_7d,
  (SELECT MAX(COALESCE(strftime('%Y-%m-%d %H:%M:%S', created_at), created_at)) FROM returns) AS last_return_at,
  datetime('now') AS checked_at_utc
