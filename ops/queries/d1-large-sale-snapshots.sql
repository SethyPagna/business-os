-- d1-large-sale-snapshots: sales since the 13 Sep pricing snapshots with many lines or large stored
-- per-line pricing snapshots. Each line's snapshot copies the whole basket, so the read-back of a sale
-- above about 58 lines exceeds D1's 2,000,000-byte value limit. Read-only sizing for the large-sale fix.
-- ops:min-rows 0
-- ops:max-rows 60
SELECT s.id AS sale_id, date(s.created_at, '+7 hours') AS kh_day, s.money_precision_version AS mpv,
  s.sale_status, COUNT(i.id) AS lines, COALESCE(SUM(LENGTH(i.pricing_snapshot_json)), 0) AS snapshot_bytes,
  COALESCE(MAX(LENGTH(i.pricing_snapshot_json)), 0) AS max_line_bytes,
  (SELECT MAX(LENGTH(m.response_json)) FROM sale_mutation_receipts m WHERE m.sale_id = s.id) AS max_receipt_bytes
FROM sales s JOIN sale_items i ON i.sale_id = s.id
WHERE s.created_at >= '2026-09-13'
GROUP BY s.id
HAVING COUNT(i.id) >= 30 OR COALESCE(SUM(LENGTH(i.pricing_snapshot_json)), 0) >= 400000
ORDER BY snapshot_bytes DESC, lines DESC
LIMIT 60;
