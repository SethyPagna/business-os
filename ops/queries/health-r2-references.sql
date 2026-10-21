-- health-r2-references: the D1 side of the R2 match (DATA-MATCH section 3). How
-- many rows point at a stored object, per source, so a run can be compared with
-- the previous run and with the bucket inventory (STORAGE-FINAL 4b, lane S3) by
-- prefix. The prefilter is instr(lower(col), 'uploads'), the widened form
-- STORAGE-FINAL 4b requires (it also catches uploads%2F, \/uploads\/ and
-- /Uploads/, which instr(col, 'uploads/') misses). Row counts, not object counts:
-- one row can name several objects. The sources are UPLOAD_REFERENCE_SOURCES
-- (lib/uploadReferences.ts), pinned by the test. Absolute URLs are r2-url-audit's job.
-- Also the Google Drive mirror's freshness (the only off-site copy of the database).
-- Counts and timestamps only.
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(*) FROM products WHERE instr(lower(image_path), 'uploads') > 0) AS products_image_rows,
  (SELECT COUNT(*) FROM products WHERE is_active = 1 AND instr(lower(image_path), 'uploads') > 0) AS products_image_rows_active,
  (SELECT COUNT(*) FROM product_images WHERE instr(lower(image_path), 'uploads') > 0) AS gallery_rows,
  (SELECT COUNT(*) FROM users WHERE instr(lower(avatar_path), 'uploads') > 0) AS avatar_rows,
  (SELECT COUNT(*) FROM promotions WHERE instr(lower(image_path), 'uploads') > 0 OR instr(lower(link_url), 'uploads') > 0) AS promotion_rows,
  (SELECT COUNT(*) FROM settings WHERE instr(lower(value), 'uploads') > 0) AS settings_rows,
  (SELECT COUNT(*) FROM products WHERE instr(lower(description), 'uploads') > 0 OR instr(lower(custom_fields), 'uploads') > 0) AS product_text_rows,
  (SELECT COUNT(*) FROM customer_share_submissions WHERE instr(lower(screenshots_json), 'private/') > 0) AS private_screenshot_rows,
  (SELECT COUNT(*) FROM customer_share_submissions WHERE instr(lower(screenshots_json), 'uploads') > 0) AS submission_upload_rows,
  (SELECT COUNT(*) FROM import_job_image_matches WHERE instr(lower(image_path), 'uploads') > 0) AS import_match_rows,
  (SELECT COUNT(*) FROM import_job_files f WHERE NOT EXISTS (SELECT 1 FROM import_jobs j WHERE j.id = f.job_id
     AND j.status IN ('completed', 'completed_with_errors', 'failed', 'cancelled'))) AS import_files_open_jobs,
  (SELECT COUNT(*) FROM pending_actions WHERE status = 'open' AND instr(lower(payload_json), 'uploads') > 0) AS pending_action_rows,
  (SELECT COUNT(*) FROM file_assets) AS library_rows,
  (SELECT COUNT(*) FROM file_assets WHERE COALESCE(public_path, '') = '' OR COALESCE(stored_name, '') = '') AS library_rows_without_key,
  (SELECT COUNT(*) FROM google_drive_sync_entries) AS drive_entries,
  (SELECT COUNT(*) FROM google_drive_sync_entries WHERE COALESCE(last_error, '') <> '') AS drive_entries_with_error,
  (SELECT MAX(last_synced_at) FROM google_drive_sync_entries) AS drive_last_synced_at,
  datetime('now') AS checked_at_utc
