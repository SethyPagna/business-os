-- Return-edit-guard sizing: customer returns left with no lines, and edit
-- receipts that sent an empty items list (receipts exist since 0140).
-- Counts and return ids only; no names, phones, cash notes or reasons.
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(*) FROM returns r
    WHERE COALESCE(r.return_scope, 'customer') = 'customer'
      AND NOT EXISTS (SELECT 1 FROM return_items ri WHERE ri.return_id = r.id)) AS customer_returns_without_lines,
  (SELECT group_concat(id) FROM (SELECT r.id FROM returns r
    WHERE COALESCE(r.return_scope, 'customer') = 'customer'
      AND NOT EXISTS (SELECT 1 FROM return_items ri WHERE ri.return_id = r.id)
    ORDER BY r.id LIMIT 50)) AS lineless_return_ids_first50,
  (SELECT COUNT(*) FROM return_mutation_receipts x
    WHERE json_extract(x.request_json, '$.items.present') = 1
      AND json_array_length(json_extract(x.request_json, '$.items.value')) = 0) AS empty_item_edit_receipts,
  (SELECT group_concat(return_id) FROM (SELECT DISTINCT x.return_id FROM return_mutation_receipts x
    WHERE json_extract(x.request_json, '$.items.present') = 1
      AND json_array_length(json_extract(x.request_json, '$.items.value')) = 0
    ORDER BY x.return_id LIMIT 50)) AS empty_edit_return_ids_first50,
  (SELECT COUNT(*) FROM returns) AS returns_total,
  datetime('now') AS checked_at_utc
