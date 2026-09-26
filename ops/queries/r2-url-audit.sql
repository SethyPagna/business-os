-- Precondition for moving the ASSETS binding to business-os-assets-apac: does
-- any row point at an upload by an ABSOLUTE url, where the app stores relative
-- '/uploads/<name>' paths? Port of the SELECT-only checks in the R2 APAC plan's
-- d1-url-audit.sql, with protocol-relative paths added.
--
-- Each table/column gets two counts:
--   <table>_move      a url the bucket move would break: an R2 public or dev
--                     host (r2.dev, r2.cloudflarestorage) anywhere in the value,
--                     or an absolute '/uploads/' url on one of the app's own
--                     hosts (leangbeauty.com and its subdomains, and the retired
--                     leangcosmetics.dpdns.org and its subdomains). Must be 0.
--   <table>_external  every other absolute url (http%, or protocol-relative
--                     //) -- Google avatars, a Facebook link in settings, any
--                     third-party host. Counted for the encrypted report only;
--                     it never fails the check, because the bucket move does
--                     not touch those hosts.
-- Only the _move columns are named in expect-zero below. Which column failed,
-- and every count, is only in the encrypted artifact.
--
-- Host matching is by LIKE on '//<host>/uploads/' and '.<host>/uploads/', so a
-- look-alike host such as notleangbeauty.com is external, not ours. LIKE is
-- ASCII case-insensitive in D1 (SQLite), so HTTPS://LEANGBEAUTY.COM matches.
-- Adding an app host means adding it to every _move predicate AND to the
-- fixtures in cloudflare/scripts/test-ops-r2-url-audit-pure.cjs.
--
-- One row of scalar sub-queries, not a UNION ALL: D1 refuses compound SELECTs
-- past a few terms ("too many terms in compound SELECT").
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:expect-zero products_move,product_images_move,promotions_move,users_move,file_assets_move,customer_share_submissions_move,import_job_files_move,import_job_image_matches_move,settings_move
SELECT
  (SELECT COUNT(*) FROM products WHERE
      image_path LIKE '%r2.dev%' OR image_path LIKE '%r2.cloudflarestorage%'
      OR image_path LIKE '%//leangbeauty.com/uploads/%' OR image_path LIKE '%.leangbeauty.com/uploads/%'
      OR image_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR image_path LIKE '%.leangcosmetics.dpdns.org/uploads/%'
  ) AS products_move,
  (SELECT COUNT(*) FROM products WHERE
      (image_path LIKE 'http%' OR image_path LIKE '//%')
      AND NOT (image_path LIKE '%r2.dev%' OR image_path LIKE '%r2.cloudflarestorage%'
        OR image_path LIKE '%//leangbeauty.com/uploads/%' OR image_path LIKE '%.leangbeauty.com/uploads/%'
        OR image_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR image_path LIKE '%.leangcosmetics.dpdns.org/uploads/%')
  ) AS products_external,
  (SELECT COUNT(*) FROM product_images WHERE
      image_path LIKE '%r2.dev%' OR image_path LIKE '%r2.cloudflarestorage%'
      OR image_path LIKE '%//leangbeauty.com/uploads/%' OR image_path LIKE '%.leangbeauty.com/uploads/%'
      OR image_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR image_path LIKE '%.leangcosmetics.dpdns.org/uploads/%'
  ) AS product_images_move,
  (SELECT COUNT(*) FROM product_images WHERE
      (image_path LIKE 'http%' OR image_path LIKE '//%')
      AND NOT (image_path LIKE '%r2.dev%' OR image_path LIKE '%r2.cloudflarestorage%'
        OR image_path LIKE '%//leangbeauty.com/uploads/%' OR image_path LIKE '%.leangbeauty.com/uploads/%'
        OR image_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR image_path LIKE '%.leangcosmetics.dpdns.org/uploads/%')
  ) AS product_images_external,
  (SELECT COUNT(*) FROM promotions WHERE
      image_path LIKE '%r2.dev%' OR image_path LIKE '%r2.cloudflarestorage%'
      OR image_path LIKE '%//leangbeauty.com/uploads/%' OR image_path LIKE '%.leangbeauty.com/uploads/%'
      OR image_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR image_path LIKE '%.leangcosmetics.dpdns.org/uploads/%'
  ) AS promotions_move,
  (SELECT COUNT(*) FROM promotions WHERE
      (image_path LIKE 'http%' OR image_path LIKE '//%')
      AND NOT (image_path LIKE '%r2.dev%' OR image_path LIKE '%r2.cloudflarestorage%'
        OR image_path LIKE '%//leangbeauty.com/uploads/%' OR image_path LIKE '%.leangbeauty.com/uploads/%'
        OR image_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR image_path LIKE '%.leangcosmetics.dpdns.org/uploads/%')
  ) AS promotions_external,
  (SELECT COUNT(*) FROM users WHERE
      avatar_path LIKE '%r2.dev%' OR avatar_path LIKE '%r2.cloudflarestorage%'
      OR avatar_path LIKE '%//leangbeauty.com/uploads/%' OR avatar_path LIKE '%.leangbeauty.com/uploads/%'
      OR avatar_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR avatar_path LIKE '%.leangcosmetics.dpdns.org/uploads/%'
  ) AS users_move,
  (SELECT COUNT(*) FROM users WHERE
      (avatar_path LIKE 'http%' OR avatar_path LIKE '//%')
      AND NOT (avatar_path LIKE '%r2.dev%' OR avatar_path LIKE '%r2.cloudflarestorage%'
        OR avatar_path LIKE '%//leangbeauty.com/uploads/%' OR avatar_path LIKE '%.leangbeauty.com/uploads/%'
        OR avatar_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR avatar_path LIKE '%.leangcosmetics.dpdns.org/uploads/%')
  ) AS users_external,
  (SELECT COUNT(*) FROM file_assets WHERE
      public_path LIKE '%r2.dev%' OR public_path LIKE '%r2.cloudflarestorage%'
      OR public_path LIKE '%//leangbeauty.com/uploads/%' OR public_path LIKE '%.leangbeauty.com/uploads/%'
      OR public_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR public_path LIKE '%.leangcosmetics.dpdns.org/uploads/%'
  ) AS file_assets_move,
  (SELECT COUNT(*) FROM file_assets WHERE
      (public_path LIKE 'http%' OR public_path LIKE '//%')
      AND NOT (public_path LIKE '%r2.dev%' OR public_path LIKE '%r2.cloudflarestorage%'
        OR public_path LIKE '%//leangbeauty.com/uploads/%' OR public_path LIKE '%.leangbeauty.com/uploads/%'
        OR public_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR public_path LIKE '%.leangcosmetics.dpdns.org/uploads/%')
  ) AS file_assets_external,
  (SELECT COUNT(*) FROM customer_share_submissions WHERE
      screenshots_json LIKE '%r2.dev%' OR screenshots_json LIKE '%r2.cloudflarestorage%'
      OR screenshots_json LIKE '%//leangbeauty.com/uploads/%' OR screenshots_json LIKE '%.leangbeauty.com/uploads/%'
      OR screenshots_json LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR screenshots_json LIKE '%.leangcosmetics.dpdns.org/uploads/%'
  ) AS customer_share_submissions_move,
  (SELECT COUNT(*) FROM customer_share_submissions WHERE
      (screenshots_json LIKE '%http%' OR screenshots_json LIKE '%"//%')
      AND NOT (screenshots_json LIKE '%r2.dev%' OR screenshots_json LIKE '%r2.cloudflarestorage%'
        OR screenshots_json LIKE '%//leangbeauty.com/uploads/%' OR screenshots_json LIKE '%.leangbeauty.com/uploads/%'
        OR screenshots_json LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR screenshots_json LIKE '%.leangcosmetics.dpdns.org/uploads/%')
  ) AS customer_share_submissions_external,
  (SELECT COUNT(*) FROM import_job_files WHERE
      stored_path LIKE '%r2.dev%' OR stored_path LIKE '%r2.cloudflarestorage%'
      OR stored_path LIKE '%//leangbeauty.com/uploads/%' OR stored_path LIKE '%.leangbeauty.com/uploads/%'
      OR stored_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR stored_path LIKE '%.leangcosmetics.dpdns.org/uploads/%'
  ) AS import_job_files_move,
  (SELECT COUNT(*) FROM import_job_files WHERE
      (stored_path LIKE 'http%' OR stored_path LIKE '//%')
      AND NOT (stored_path LIKE '%r2.dev%' OR stored_path LIKE '%r2.cloudflarestorage%'
        OR stored_path LIKE '%//leangbeauty.com/uploads/%' OR stored_path LIKE '%.leangbeauty.com/uploads/%'
        OR stored_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR stored_path LIKE '%.leangcosmetics.dpdns.org/uploads/%')
  ) AS import_job_files_external,
  (SELECT COUNT(*) FROM import_job_image_matches WHERE
      image_path LIKE '%r2.dev%' OR image_path LIKE '%r2.cloudflarestorage%'
      OR image_path LIKE '%//leangbeauty.com/uploads/%' OR image_path LIKE '%.leangbeauty.com/uploads/%'
      OR image_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR image_path LIKE '%.leangcosmetics.dpdns.org/uploads/%'
  ) AS import_job_image_matches_move,
  (SELECT COUNT(*) FROM import_job_image_matches WHERE
      (image_path LIKE 'http%' OR image_path LIKE '//%')
      AND NOT (image_path LIKE '%r2.dev%' OR image_path LIKE '%r2.cloudflarestorage%'
        OR image_path LIKE '%//leangbeauty.com/uploads/%' OR image_path LIKE '%.leangbeauty.com/uploads/%'
        OR image_path LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR image_path LIKE '%.leangcosmetics.dpdns.org/uploads/%')
  ) AS import_job_image_matches_external,
  (SELECT COUNT(*) FROM settings WHERE
      value LIKE '%r2.dev%' OR value LIKE '%r2.cloudflarestorage%'
      OR value LIKE '%//leangbeauty.com/uploads/%' OR value LIKE '%.leangbeauty.com/uploads/%'
      OR value LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR value LIKE '%.leangcosmetics.dpdns.org/uploads/%'
  ) AS settings_move,
  (SELECT COUNT(*) FROM settings WHERE
      (value LIKE '%http%' OR value LIKE '//%' OR value LIKE '%"//%')
      AND NOT (value LIKE '%r2.dev%' OR value LIKE '%r2.cloudflarestorage%'
        OR value LIKE '%//leangbeauty.com/uploads/%' OR value LIKE '%.leangbeauty.com/uploads/%'
        OR value LIKE '%//leangcosmetics.dpdns.org/uploads/%' OR value LIKE '%.leangcosmetics.dpdns.org/uploads/%')
  ) AS settings_external
