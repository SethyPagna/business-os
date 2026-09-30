-- d1-growth-candidates: tables that none of lib/audit.ts,
-- lib/importRetention.ts or lib/ephemeralRetention.ts prunes; the windowed
-- tables action_history, audit_logs and ai_response_logs; and the import
-- tables importRetention prunes: import_job_errors, plus import_job_source_rows
-- and import_job_rows, which production prunes only in business-os-import, so
-- rows here are main-database leftovers. Rows per table and, where measured,
-- the oldest row and the bytes of JSON/text payload columns (length of the
-- value cast to BLOB, i.e. UTF-8 bytes). Decide retention from these numbers,
-- not guesses.
-- Provenance tables (mutation receipts, undo_snapshots, sale_record_events,
-- the migration receipt tables) are NOT prune candidates: undoAppliers.ts and
-- KNOWN-90 depend on them. All but the migration receipt tables are measured
-- here.
-- One row of scalar sub-queries; each sub-query is its own scan, so a table
-- in several of them is read several times.
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(*) FROM action_history) AS action_history_rows,
  (SELECT COALESCE(SUM(length(CAST(undo_payload AS BLOB)) + length(CAST(redo_payload AS BLOB))), 0) FROM action_history) AS action_history_payload_bytes,
  (SELECT COUNT(*) FROM undo_snapshots) AS undo_snapshots_rows,
  (SELECT COALESCE(SUM(length(CAST(payload_json AS BLOB))), 0) FROM undo_snapshots) AS undo_snapshots_payload_bytes,
  (SELECT MIN(created_at) FROM undo_snapshots) AS undo_snapshots_oldest,
  (SELECT COUNT(*) FROM sale_mutation_receipts) AS sale_receipts_rows,
  (SELECT COALESCE(SUM(length(CAST(request_json AS BLOB)) + length(CAST(before_json AS BLOB)) + length(CAST(after_json AS BLOB)) + length(CAST(response_json AS BLOB))), 0) FROM sale_mutation_receipts) AS sale_receipts_bytes,
  (SELECT COUNT(*) FROM stock_mutation_receipts) AS stock_receipts_rows,
  (SELECT COALESCE(SUM(length(CAST(request_json AS BLOB)) + length(CAST(response_json AS BLOB))), 0) FROM stock_mutation_receipts) AS stock_receipts_bytes,
  (SELECT COUNT(*) FROM return_mutation_receipts) AS return_receipts_rows,
  (SELECT COALESCE(SUM(length(CAST(request_json AS BLOB)) + length(CAST(response_json AS BLOB))), 0) FROM return_mutation_receipts) AS return_receipts_bytes,
  (SELECT COUNT(*) FROM transfer_operation_receipts) AS transfer_receipts_rows,
  (SELECT COALESCE(SUM(length(CAST(request_json AS BLOB)) + length(CAST(response_json AS BLOB))), 0) FROM transfer_operation_receipts) AS transfer_receipts_bytes,
  (SELECT COUNT(*) FROM sale_record_events) AS sale_events_rows,
  (SELECT COALESCE(SUM(length(CAST(changes_json AS BLOB)) + length(CAST(response_json AS BLOB))), 0) FROM sale_record_events) AS sale_events_bytes,
  (SELECT COUNT(*) FROM audit_logs) AS audit_rows,
  (SELECT COALESCE(SUM(length(CAST(old_value AS BLOB)) + length(CAST(new_value AS BLOB))), 0) FROM audit_logs) AS audit_bytes,
  (SELECT COUNT(*) FROM ai_response_logs) AS ai_log_rows,
  (SELECT COALESCE(SUM(length(CAST(prompt_text AS BLOB)) + length(CAST(profile_json AS BLOB)) + length(CAST(candidate_products_json AS BLOB)) + length(CAST(recommendations_json AS BLOB)) + length(CAST(answer_text AS BLOB))), 0) FROM ai_response_logs) AS ai_log_bytes,
  (SELECT COUNT(*) FROM rfid_events) AS rfid_event_rows,
  (SELECT COALESCE(SUM(length(CAST(raw_json AS BLOB))), 0) FROM rfid_events) AS rfid_event_bytes,
  (SELECT MIN(seen_at) FROM rfid_events) AS rfid_event_oldest,
  (SELECT COUNT(*) FROM telegram_scheduled_sends) AS telegram_sends_rows,
  (SELECT COUNT(*) FROM telegram_scheduled_sends WHERE status = 'sent' AND created_at < datetime('now', '-30 days')) AS telegram_sends_sent_over_30d,
  (SELECT COUNT(*) FROM pending_actions) AS pending_actions_rows,
  (SELECT COUNT(*) FROM pending_actions WHERE status <> 'open') AS pending_actions_closed,
  (SELECT COALESCE(SUM(length(CAST(payload_json AS BLOB))), 0) FROM pending_actions WHERE status <> 'open') AS pending_actions_closed_bytes,
  (SELECT COUNT(*) FROM bulk_delete_jobs) AS bulk_delete_jobs_rows,
  (SELECT COALESCE(SUM(length(CAST(ids_json AS BLOB)) + length(CAST(failed_ids_json AS BLOB))), 0) FROM bulk_delete_jobs) AS bulk_delete_jobs_bytes,
  (SELECT COUNT(*) FROM password_reset_requests) AS password_reset_requests_rows,
  (SELECT COUNT(*) FROM portal_password_resets) AS portal_password_resets_rows,
  (SELECT COUNT(*) FROM portal_password_resets WHERE consumed_at IS NOT NULL OR expires_at < datetime('now', '-7 days')) AS portal_password_resets_dead,
  (SELECT COUNT(*) FROM quota_usage) AS quota_usage_rows,
  (SELECT MIN(updated_at) FROM quota_usage) AS quota_usage_oldest,
  (SELECT COUNT(*) FROM image_audit) AS image_audit_rows,
  (SELECT COUNT(*) FROM google_drive_sync_entries) AS drive_sync_rows,
  (SELECT COUNT(*) FROM import_job_source_rows) AS import_source_rows_main_db,
  (SELECT COALESCE(SUM(length(CAST(data_json AS BLOB))), 0) FROM import_job_source_rows) AS import_source_bytes_main_db,
  (SELECT COUNT(*) FROM import_job_rows) AS import_rows_main_db,
  (SELECT COALESCE(SUM(length(CAST(result_json AS BLOB))), 0) FROM import_job_rows) AS import_rows_bytes_main_db,
  (SELECT COUNT(*) FROM import_job_errors) AS import_errors_rows,
  (SELECT COALESCE(SUM(length(CAST(raw_json AS BLOB))), 0) FROM import_job_errors) AS import_errors_bytes;
