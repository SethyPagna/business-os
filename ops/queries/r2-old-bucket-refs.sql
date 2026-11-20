-- r2-old-bucket-refs: does any stored value address the OLD R2 bucket
-- (business-os-assets, eeur) directly, by its name or by an R2 public / S3
-- host, in every column UPLOAD_REFERENCE_SOURCES (cloudflare/src/lib/
-- uploadReferences.ts) lists, plus the Library (file_assets)? The app stores
-- relative '/uploads/NAME' paths that the Worker serves from its ASSETS
-- binding, so only such an absolute value could still read the old bucket.
-- The apac name is removed before the old name is looked for, so
-- 'business-os-assets-apac' never counts. Counts only: no value is returned.
-- *_old columns must be 0. upload_rows_seen is the positive control: it must
-- be above 0, or the scan saw no data and the zeros prove nothing.
-- One row: a cross join of one-row aggregates, each table scanned once (the
-- health-r2-references.sql shape), not a UNION ALL (D1 compound limit).
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero products_old,gallery_old,avatars_old,promotions_old,settings_old,submissions_old,import_matches_old,import_files_old,pending_old,library_old
-- ops:max-rows-read 11447
SELECT
  g0.products_old, g0.upload_rows_seen, g1.gallery_old, g2.avatars_old, g3.promotions_old, g4.settings_old,
  g5.submissions_old, g6.import_matches_old, g7.import_files_old, g8.pending_old, g9.library_old
FROM
  (SELECT
    COALESCE(SUM(
      instr(lower((COALESCE(image_path, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(custom_fields, ''))), 'r2.dev') > 0
      OR instr(lower((COALESCE(image_path, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(custom_fields, ''))), 'r2.cloudflarestorage') > 0
      OR instr(replace(lower((COALESCE(image_path, '') || ' ' || COALESCE(description, '') || ' ' || COALESCE(custom_fields, ''))), 'business-os-assets-apac', ''), 'business-os-assets') > 0
    ), 0) AS products_old,
    COALESCE(SUM(instr(lower(COALESCE(image_path, '')), 'uploads') > 0), 0) AS upload_rows_seen
  FROM products) g0,
  (SELECT COALESCE(SUM(
      instr(lower((COALESCE(image_path, ''))), 'r2.dev') > 0
      OR instr(lower((COALESCE(image_path, ''))), 'r2.cloudflarestorage') > 0
      OR instr(replace(lower((COALESCE(image_path, ''))), 'business-os-assets-apac', ''), 'business-os-assets') > 0
    ), 0) AS gallery_old FROM product_images) g1,
  (SELECT COALESCE(SUM(
      instr(lower((COALESCE(avatar_path, ''))), 'r2.dev') > 0
      OR instr(lower((COALESCE(avatar_path, ''))), 'r2.cloudflarestorage') > 0
      OR instr(replace(lower((COALESCE(avatar_path, ''))), 'business-os-assets-apac', ''), 'business-os-assets') > 0
    ), 0) AS avatars_old FROM users) g2,
  (SELECT COALESCE(SUM(
      instr(lower((COALESCE(image_path, '') || ' ' || COALESCE(link_url, ''))), 'r2.dev') > 0
      OR instr(lower((COALESCE(image_path, '') || ' ' || COALESCE(link_url, ''))), 'r2.cloudflarestorage') > 0
      OR instr(replace(lower((COALESCE(image_path, '') || ' ' || COALESCE(link_url, ''))), 'business-os-assets-apac', ''), 'business-os-assets') > 0
    ), 0) AS promotions_old FROM promotions) g3,
  (SELECT COALESCE(SUM(
      instr(lower((COALESCE(value, ''))), 'r2.dev') > 0
      OR instr(lower((COALESCE(value, ''))), 'r2.cloudflarestorage') > 0
      OR instr(replace(lower((COALESCE(value, ''))), 'business-os-assets-apac', ''), 'business-os-assets') > 0
    ), 0) AS settings_old FROM settings) g4,
  (SELECT COALESCE(SUM(
      instr(lower((COALESCE(screenshots_json, ''))), 'r2.dev') > 0
      OR instr(lower((COALESCE(screenshots_json, ''))), 'r2.cloudflarestorage') > 0
      OR instr(replace(lower((COALESCE(screenshots_json, ''))), 'business-os-assets-apac', ''), 'business-os-assets') > 0
    ), 0) AS submissions_old FROM customer_share_submissions) g5,
  (SELECT COALESCE(SUM(
      instr(lower((COALESCE(image_path, ''))), 'r2.dev') > 0
      OR instr(lower((COALESCE(image_path, ''))), 'r2.cloudflarestorage') > 0
      OR instr(replace(lower((COALESCE(image_path, ''))), 'business-os-assets-apac', ''), 'business-os-assets') > 0
    ), 0) AS import_matches_old FROM import_job_image_matches) g6,
  (SELECT COALESCE(SUM(
      instr(lower((COALESCE(stored_path, ''))), 'r2.dev') > 0
      OR instr(lower((COALESCE(stored_path, ''))), 'r2.cloudflarestorage') > 0
      OR instr(replace(lower((COALESCE(stored_path, ''))), 'business-os-assets-apac', ''), 'business-os-assets') > 0
    ), 0) AS import_files_old FROM import_job_files) g7,
  (SELECT COALESCE(SUM(
      instr(lower((COALESCE(payload_json, ''))), 'r2.dev') > 0
      OR instr(lower((COALESCE(payload_json, ''))), 'r2.cloudflarestorage') > 0
      OR instr(replace(lower((COALESCE(payload_json, ''))), 'business-os-assets-apac', ''), 'business-os-assets') > 0
    ), 0) AS pending_old FROM pending_actions) g8,
  (SELECT COALESCE(SUM(
      instr(lower((COALESCE(public_path, '') || ' ' || COALESCE(stored_name, ''))), 'r2.dev') > 0
      OR instr(lower((COALESCE(public_path, '') || ' ' || COALESCE(stored_name, ''))), 'r2.cloudflarestorage') > 0
      OR instr(replace(lower((COALESCE(public_path, '') || ' ' || COALESCE(stored_name, ''))), 'business-os-assets-apac', ''), 'business-os-assets') > 0
    ), 0) AS library_old FROM file_assets) g9
LIMIT 1
