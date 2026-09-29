-- AB-W2: stored storefront links and editor list fields the AB-W2 rules refuse.
-- Promotion strip links were checked only in the editor, never on save, and a
-- link such as /\host opened another site. After AB-W2 a listed link or picture
-- is not published, and a listed strip cannot be saved until its link is fixed.
-- Candidates: the Worker rule (lib/safeLinkUrl.ts) decides; review each row.
--   source, row_ref, field    promotions id, or settings key with [item index]
--   value_chars, value_preview
--   reason    backslash, encoded_second_slash, protocol_relative, control_character,
--             too_long, not_http_or_site_path, or field_not_text (list items only)
-- ops:min-rows 0
-- ops:max-rows 500
WITH list_link_fields(field) AS (VALUES ('mediaUrl'), ('linkUrl')),
list_text_fields(setting_key, field) AS (
  VALUES
    ('customer_portal_about_blocks', 'id'), ('customer_portal_about_blocks', 'type'),
    ('customer_portal_about_blocks', 'title'), ('customer_portal_about_blocks', 'body'),
    ('customer_portal_about_blocks', 'mediaUrl'), ('customer_portal_faq_items', 'id'),
    ('customer_portal_faq_items', 'question'), ('customer_portal_faq_items', 'answer'),
    ('customer_portal_promo_items', 'id'), ('customer_portal_promo_items', 'eyebrow'),
    ('customer_portal_promo_items', 'title'), ('customer_portal_promo_items', 'subtitle'),
    ('customer_portal_promo_items', 'body'), ('customer_portal_promo_items', 'mediaUrl'),
    ('customer_portal_promo_items', 'ctaLabel'), ('customer_portal_promo_items', 'linkUrl'),
    ('customer_portal_promo_items', 'linkProductId'), ('customer_portal_promo_items', 'linkProductName')
),
list_items AS (
  SELECT s.key AS setting_key, item.key AS item_index, item.value AS item_json
  FROM settings s,
    json_each(CASE WHEN json_valid(s.value) AND json_type(s.value) = 'array' THEN s.value ELSE '[]' END) item
  WHERE s.key IN ('customer_portal_about_blocks', 'customer_portal_faq_items', 'customer_portal_promo_items')
    AND item.type = 'object'
),
link_values AS (
  SELECT 'promotions' AS source, CAST(id AS TEXT) AS row_ref, 'link_url' AS field, trim(link_url) AS v
  FROM promotions WHERE link_type = 'url' AND link_url IS NOT NULL
  UNION ALL
  SELECT 'settings', key, key, trim(value)
  FROM settings WHERE key IN ('customer_portal_logo_image', 'customer_portal_cover_image', 'customer_portal_favicon_image')
  UNION ALL
  SELECT 'settings', i.setting_key || '[' || i.item_index || ']', f.field, trim(json_extract(i.item_json, '$.' || f.field))
  FROM list_items i, list_link_fields f
  WHERE i.setting_key IN ('customer_portal_about_blocks', 'customer_portal_promo_items')
    AND json_type(i.item_json, '$.' || f.field) = 'text'
),
checked AS (
  SELECT source, row_ref, field, v,
    CASE
      WHEN instr(v, char(92)) > 0 THEN 'backslash'
      WHEN lower(substr(v, 1, 4)) IN ('/%2f', '/%5c') THEN 'encoded_second_slash'
      WHEN substr(v, 1, 2) = '//' THEN 'protocol_relative'
      WHEN v GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') THEN 'control_character'
      WHEN length(v) > 500 THEN 'too_long'
      WHEN substr(v, 1, 1) <> '/' AND lower(substr(v, 1, 7)) <> 'http://' AND lower(substr(v, 1, 8)) <> 'https://'
        THEN 'not_http_or_site_path'
    END AS reason
  FROM link_values
  WHERE v <> ''
)
SELECT source, row_ref, field, length(v) AS value_chars, substr(v, 1, 120) AS value_preview, reason
FROM checked
WHERE reason IS NOT NULL
UNION ALL
SELECT 'settings', i.setting_key || '[' || i.item_index || ']', t.field,
  length(json_extract(i.item_json, '$.' || t.field)), substr(json_extract(i.item_json, '$.' || t.field), 1, 120),
  'field_not_text'
FROM list_items i
JOIN list_text_fields t ON t.setting_key = i.setting_key
WHERE json_type(i.item_json, '$.' || t.field) IN ('object', 'array')
  OR (t.field <> 'linkProductId' AND json_type(i.item_json, '$.' || t.field) IN ('integer', 'real', 'true', 'false'))
ORDER BY 1, 2, 3
LIMIT 500
