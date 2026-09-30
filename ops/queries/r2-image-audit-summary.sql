-- r2-image-audit-summary: what the 6-hourly image audit (lib/imageAudit.ts)
-- already knows about uploads/ images, without listing the bucket. Counts and
-- bytes per audit status, the oversized tail, and how stale the audit is.
-- image_audit only covers image extensions under uploads/, so videos, PDFs,
-- variants/ and backups/ are not here (the r2-inventory task covers those).
-- Rows whose object has since been deleted stay in image_audit until a
-- reprocess notices (imageAudit.ts), so audited_* is an upper bound.
-- One row of scalar sub-queries, not a UNION ALL (D1 compound limit).
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(*) FROM image_audit) AS audited_rows,
  (SELECT COALESCE(SUM(byte_size), 0) FROM image_audit) AS audited_bytes,
  (SELECT COUNT(*) FROM image_audit WHERE status = 'ok') AS ok_rows,
  (SELECT COUNT(*) FROM image_audit WHERE status = 'oversized') AS oversized_rows,
  (SELECT COALESCE(SUM(byte_size), 0) FROM image_audit WHERE status = 'oversized') AS oversized_bytes,
  (SELECT COUNT(*) FROM image_audit WHERE status = 'optimized') AS optimized_rows,
  (SELECT COALESCE(SUM(original_size - byte_size), 0) FROM image_audit WHERE status = 'optimized' AND original_size IS NOT NULL) AS optimized_saved_bytes,
  (SELECT COUNT(*) FROM image_audit WHERE status = 'failed') AS failed_rows,
  (SELECT COUNT(*) FROM image_audit WHERE status = 'skipped') AS skipped_rows,
  (SELECT COUNT(*) FROM image_audit WHERE byte_size > 921600) AS over_900kb_rows,
  (SELECT COUNT(*) FROM image_audit WHERE byte_size > 2097152) AS over_2mb_rows,
  (SELECT MAX(byte_size) FROM image_audit) AS largest_bytes,
  (SELECT MIN(checked_at) FROM image_audit) AS oldest_checked_at,
  (SELECT COUNT(*) FROM image_audit WHERE checked_at < datetime('now', '-30 days')) AS checked_over_30d_ago,
  (SELECT last_run_at FROM image_audit_state WHERE id = 1) AS audit_last_run_at,
  (SELECT swept FROM image_audit_state WHERE id = 1) AS audit_swept,
  (SELECT COUNT(*) FROM file_assets) AS library_rows,
  (SELECT COALESCE(SUM(byte_size), 0) FROM file_assets) AS library_bytes,
  (SELECT COUNT(*) FROM file_assets WHERE media_type = 'video') AS library_video_rows,
  (SELECT COALESCE(SUM(byte_size), 0) FROM file_assets WHERE media_type = 'video') AS library_video_bytes,
  (SELECT COUNT(*) FROM file_assets WHERE COALESCE(media_type, 'image') NOT IN ('image', 'video')) AS library_other_rows;
