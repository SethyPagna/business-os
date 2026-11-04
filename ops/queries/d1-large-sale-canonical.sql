-- d1-large-sale-canonical: for every sale of 24 lines or more, whether each line's stored pricing snapshot
-- is in the canonical form serializeSaleItemPricing writes (the large-sale fix stores a compact copy only
-- for canonical lines), how many allocation contexts it holds, and its largest stored receipt row
-- (request + before + after + response) against D1's 2,000,000-byte row limit. Ids, counts and bytes only.
-- ops:min-rows 0
-- ops:max-rows 40
-- ops:max-rows-read 42264
SELECT i.sale_id, COUNT(*) AS lines,
  SUM(i.pricing_snapshot_json = json_object('version', 1,
    'line_key', json_extract(i.pricing_snapshot_json, '$.line_key'),
    'pool', json_extract(i.pricing_snapshot_json, '$.pool'),
    'quantities', json_extract(i.pricing_snapshot_json, '$.quantities'),
    'amounts', json_extract(i.pricing_snapshot_json, '$.amounts'),
    'allocation_context', json_extract(i.pricing_snapshot_json, '$.allocation_context'),
    'receipt_allocation', json_extract(i.pricing_snapshot_json, '$.receipt_allocation'))) AS canonical_lines,
  COUNT(DISTINCT json_extract(i.pricing_snapshot_json, '$.allocation_context')) AS contexts,
  SUM(LENGTH(CAST(i.pricing_snapshot_json AS BLOB))) AS snapshot_bytes,
  (SELECT COUNT(*) FROM sale_mutation_receipts m WHERE m.sale_id = i.sale_id) AS receipts,
  (SELECT MAX(LENGTH(CAST(m.request_json AS BLOB)) + LENGTH(CAST(m.before_json AS BLOB))
      + LENGTH(CAST(m.after_json AS BLOB)) + LENGTH(CAST(m.response_json AS BLOB)))
    FROM sale_mutation_receipts m WHERE m.sale_id = i.sale_id) AS max_receipt_row_bytes
FROM sale_items i
WHERE i.sale_id IN (SELECT sale_id FROM sale_items GROUP BY sale_id HAVING COUNT(*) >= 24)
GROUP BY i.sale_id
ORDER BY snapshot_bytes DESC
LIMIT 40;
