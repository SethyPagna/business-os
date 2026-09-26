-- Precondition for moving the ASSETS binding to business-os-assets-apac: does
-- any row hold an ABSOLUTE url -- http(s)://, protocol-relative //, or a
-- bucket host (r2.dev, r2.cloudflarestorage.com) -- where the app stores
-- relative '/uploads/<name>' paths? Port of the SELECT-only checks in the R2
-- APAC plan's d1-url-audit.sql, with protocol-relative paths added. Every
-- count must be 0; a non-zero count fails the job, and which column it was is
-- only in the encrypted artifact.
--
-- One row of scalar sub-queries, not a UNION ALL: D1 refuses compound SELECTs
-- past a few terms ("too many terms in compound SELECT").
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero *
SELECT
  (SELECT COUNT(*) FROM products
    WHERE image_path LIKE 'http%' OR image_path LIKE '//%') AS products_image_path_absolute,
  (SELECT COUNT(*) FROM product_images
    WHERE image_path LIKE 'http%' OR image_path LIKE '//%') AS product_images_image_path_absolute,
  (SELECT COUNT(*) FROM promotions
    WHERE image_path LIKE 'http%' OR image_path LIKE '//%') AS promotions_image_path_absolute,
  (SELECT COUNT(*) FROM users
    WHERE avatar_path LIKE 'http%' OR avatar_path LIKE '//%') AS users_avatar_path_absolute,
  (SELECT COUNT(*) FROM file_assets
    WHERE public_path LIKE 'http%' OR public_path LIKE '//%') AS file_assets_public_path_absolute,
  (SELECT COUNT(*) FROM customer_share_submissions
    WHERE screenshots_json LIKE '%http%') AS customer_share_screenshots_with_url,
  (SELECT COUNT(*) FROM import_job_files
    WHERE stored_path LIKE 'http%' OR stored_path LIKE '//%') AS import_job_files_stored_path_absolute,
  (SELECT COUNT(*) FROM import_job_image_matches
    WHERE image_path LIKE 'http%' OR image_path LIKE '//%') AS import_job_image_matches_image_path_absolute,
  (SELECT COUNT(*) FROM settings
    WHERE value LIKE '%r2.dev%' OR value LIKE '%r2.cloudflarestorage%'
       OR (value LIKE '%http%' AND value LIKE '%/uploads/%')) AS settings_bucket_or_upload_url,
  (SELECT COUNT(*) FROM products
    WHERE image_path LIKE '%r2.dev%' OR image_path LIKE '%r2.cloudflarestorage%') AS products_bucket_host,
  (SELECT COUNT(*) FROM product_images
    WHERE image_path LIKE '%r2.dev%' OR image_path LIKE '%r2.cloudflarestorage%') AS product_images_bucket_host
