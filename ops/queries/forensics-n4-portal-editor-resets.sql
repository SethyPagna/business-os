-- N4 (PUBLIC-PAINT-FINAL.md): the Website Editor builds its draft from the
-- public config, which never carried these 24 keys, so a Save wrote each one
-- back as the editor's default. One row per settings save that changed a key
-- from a real value to exactly that default. Only saves audited with
-- before/after values (settings route since cdbcd6539, 23 Sep 2026) are
-- visible; an old value over 2048 characters is recorded as "(N chars, #hash)".
-- An owner who deliberately chose the default looks the same: review each row.
--   audit_id, saved_at, user_id, setting_key, old_value_chars, old_value_preview
--   keys_reset_in_same_save   many at once is the editor's signature
--   current_is_reset_value    1: the stored value is still the default
--   later_writes_of_key       audited saves of this key after this one
-- ops:min-rows 0
-- ops:max-rows 2000
WITH editor_defaults(setting_key, reset_value) AS (
  VALUES
    ('customer_portal_about_title', ''), ('customer_portal_about_content', ''),
    ('customer_portal_about_blocks', '[]'), ('customer_portal_address_link', ''),
    ('customer_portal_logo_size', '80'), ('customer_portal_logo_fit', 'cover'),
    ('customer_portal_logo_zoom', '100'), ('customer_portal_logo_position_x', '50'),
    ('customer_portal_logo_position_y', '50'), ('customer_portal_title_size', '40'),
    ('customer_portal_ai_intro', ''), ('customer_portal_translations', '{}'),
    ('customer_portal_language', 'auto'), ('customer_portal_show_top_seller_badge', 'false'),
    ('customer_portal_show_top_product_badge', 'false'), ('customer_portal_show_recommended_badge', 'false'),
    ('customer_portal_show_promotion_badge', 'false'), ('customer_portal_show_new_arrival_badge', 'false'),
    ('customer_portal_highlight_rank_limit', '3'), ('customer_portal_recommended_product_ids', '[]'),
    ('customer_portal_stock_threshold_mode', 'product'), ('customer_portal_low_stock_threshold', '10'),
    ('customer_portal_out_of_stock_threshold', '0'), ('customer_portal_show_point_value', 'false')
),
saves AS (
  SELECT a.id AS audit_id, COALESCE(strftime('%Y-%m-%d %H:%M:%S', a.created_at), a.created_at) AS saved_at,
    a.user_id, a.old_value, a.new_value
  FROM audit_logs a
  WHERE a.entity = 'settings' AND a.action = 'update' AND a.entity_id IS NULL
    AND json_valid(a.old_value) AND json_valid(a.new_value)
),
resets AS (
  SELECT s.audit_id, s.saved_at, s.user_id, d.setting_key, d.reset_value,
    CAST(json_extract(s.old_value, '$.' || d.setting_key) AS TEXT) AS old_text
  FROM saves s
  JOIN editor_defaults d
  WHERE json_type(s.new_value, '$.' || d.setting_key) IS NOT NULL
    AND COALESCE(CAST(json_extract(s.new_value, '$.' || d.setting_key) AS TEXT), '') = d.reset_value
    AND NULLIF(CAST(json_extract(s.old_value, '$.' || d.setting_key) AS TEXT), '') IS NOT NULL
    AND CAST(json_extract(s.old_value, '$.' || d.setting_key) AS TEXT) <> d.reset_value
    AND NOT (d.reset_value = 'false' AND lower(CAST(json_extract(s.old_value, '$.' || d.setting_key) AS TEXT)) IN ('0', 'false', 'no', 'off'))
)
SELECT
  r.audit_id, r.saved_at, r.user_id, r.setting_key,
  length(r.old_text) AS old_value_chars,
  substr(r.old_text, 1, 120) AS old_value_preview,
  COUNT(*) OVER (PARTITION BY r.audit_id) AS keys_reset_in_same_save,
  CASE WHEN (SELECT st.value FROM settings st WHERE st.key = r.setting_key) IS r.reset_value THEN 1 ELSE 0 END AS current_is_reset_value,
  (SELECT COUNT(*) FROM saves later
    WHERE later.audit_id > r.audit_id AND json_type(later.new_value, '$.' || r.setting_key) IS NOT NULL) AS later_writes_of_key
FROM resets r
ORDER BY r.audit_id, r.setting_key
LIMIT 2000
