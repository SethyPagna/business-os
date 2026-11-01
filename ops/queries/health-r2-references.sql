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
-- ops:max-rows-read 11450
SELECT
  g0.products_image_rows,
  g0.products_image_rows_active,
  g1.gallery_rows,
  g2.avatar_rows,
  g3.promotion_rows,
  g4.settings_rows,
  g0.product_text_rows,
  g5.private_screenshot_rows,
  g5.submission_upload_rows,
  g6.import_match_rows,
  g7.import_files_open_jobs,
  g8.pending_action_rows,
  g9.library_rows,
  g9.library_rows_without_key,
  g10.drive_entries,
  g10.drive_entries_with_error,
  (SELECT MAX(last_synced_at) FROM google_drive_sync_entries) AS drive_last_synced_at,
  datetime('now') AS checked_at_utc
FROM (SELECT
    COALESCE(SUM(instr(lower(image_path), 'uploads') > 0), 0) AS products_image_rows,
    COALESCE(SUM(is_active = 1 AND instr(lower(image_path), 'uploads') > 0), 0) AS products_image_rows_active,
    COALESCE(SUM(instr(lower(description), 'uploads') > 0 OR instr(lower(custom_fields), 'uploads') > 0), 0) AS product_text_rows
  FROM products) g0,
  (SELECT
    COALESCE(SUM(instr(lower(image_path), 'uploads') > 0), 0) AS gallery_rows
  FROM product_images) g1,
  (SELECT
    COALESCE(SUM(instr(lower(avatar_path), 'uploads') > 0), 0) AS avatar_rows
  FROM users) g2,
  (SELECT
    COALESCE(SUM(instr(lower(image_path), 'uploads') > 0 OR instr(lower(link_url), 'uploads') > 0), 0) AS promotion_rows
  FROM promotions) g3,
  (SELECT
    COALESCE(SUM(instr(lower(value), 'uploads') > 0), 0) AS settings_rows
  FROM settings) g4,
  (SELECT
    COALESCE(SUM(instr(lower(screenshots_json), 'private/') > 0), 0) AS private_screenshot_rows,
    COALESCE(SUM(instr(lower(screenshots_json), 'uploads') > 0), 0) AS submission_upload_rows
  FROM customer_share_submissions) g5,
  (SELECT
    COALESCE(SUM(instr(lower(image_path), 'uploads') > 0), 0) AS import_match_rows
  FROM import_job_image_matches) g6,
  (SELECT
    COALESCE(SUM(NOT EXISTS (SELECT 1 FROM import_jobs j WHERE j.id = f.job_id AND j.status IN ('completed', 'completed_with_errors', 'failed', 'cancelled'))), 0) AS import_files_open_jobs
  FROM import_job_files f) g7,
  (SELECT
    COALESCE(SUM(status = 'open' AND instr(lower(payload_json), 'uploads') > 0), 0) AS pending_action_rows
  FROM pending_actions) g8,
  (SELECT
    COUNT(*) AS library_rows,
    COALESCE(SUM(COALESCE(public_path, '') = '' OR COALESCE(stored_name, '') = ''), 0) AS library_rows_without_key
  FROM file_assets) g9,
  (SELECT
    COUNT(*) AS drive_entries,
    COALESCE(SUM(COALESCE(last_error, '') <> ''), 0) AS drive_entries_with_error
  FROM google_drive_sync_entries) g10
