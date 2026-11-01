-- d1-payload-bytes: bytes held in the large JSON and text payload columns,
-- to size compression and archiving against the 500 MB database cap.
-- Byte totals only, no content.
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COALESCE(SUM(length(CAST(request_json AS BLOB)) + length(CAST(before_json AS BLOB))
     + length(CAST(after_json AS BLOB)) + length(CAST(response_json AS BLOB))), 0) FROM sale_mutation_receipts) AS sale_mutation_receipt_bytes,
  (SELECT COALESCE(SUM(length(CAST(payload_json AS BLOB))), 0) FROM undo_snapshots) AS undo_snapshot_bytes,
  (SELECT COALESCE(SUM(length(CAST(details AS BLOB)) + length(CAST(old_value AS BLOB))
     + length(CAST(new_value AS BLOB))), 0) FROM audit_logs) AS audit_bytes,
  (SELECT COALESCE(SUM(length(CAST(request_json AS BLOB)) + length(CAST(receipt_json AS BLOB))), 0) FROM sale_bulk_operations) AS sale_bulk_bytes,
  (SELECT COALESCE(SUM(length(CAST(undo_payload AS BLOB)) + length(CAST(redo_payload AS BLOB))), 0) FROM action_history) AS action_history_bytes;
