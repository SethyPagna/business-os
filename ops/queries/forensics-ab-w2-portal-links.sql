-- AB-W2/AB-W3: stored storefront links, the About picture and editor list fields the Worker rules refuse.
-- Promotion strip links were checked only in the editor, never on save, and a
-- link such as /\host opened another site. A listed link or picture is not
-- published, and a listed strip cannot be saved until its link is fixed.
-- Candidates: the Worker rules (lib/safeLinkUrl.ts) decide; review each row.
-- A '%' escape that is not UTF-8 in the About picture is refused but not listed.
--   source, row_ref, field    promotions id, or settings key with [item index]
--   value_chars, value_preview
--   reason    links: backslash, encoded_second_slash, protocol_relative, control_character,
--               too_long, resolves_to_second_slash, not_http_or_site_path
--             About picture: too_long, control_character, bidi_control, byte_order_mark,
--               backslash, double_slash, not_own_upload, dot_segment, encoded_slash
--             list items: field_not_text
-- ops:min-rows 0
-- ops:max-rows 500
WITH digits(d) AS (VALUES (0), (1), (2), (3), (4), (5), (6), (7), (8), (9)),
positions(n) AS (SELECT a.d * 100 + b.d * 10 + c.d + 1 FROM digits a, digits b, digits c),
list_link_fields(field) AS (VALUES ('mediaUrl'), ('linkUrl')),
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
stored_values AS (
  SELECT 'promotions' AS source, CAST(id AS TEXT) AS row_ref, 'link_url' AS field, link_url AS stored
  FROM promotions WHERE link_type = 'url' AND link_url IS NOT NULL
  UNION ALL
  SELECT 'settings', key, key, value
  FROM settings
  WHERE key IN ('customer_portal_logo_image', 'customer_portal_cover_image', 'customer_portal_favicon_image', 'customer_portal_about_image')
  UNION ALL
  SELECT 'settings', i.setting_key || '[' || i.item_index || ']', f.field, json_extract(i.item_json, '$.' || f.field)
  FROM list_items i, list_link_fields f
  WHERE i.setting_key IN ('customer_portal_about_blocks', 'customer_portal_promo_items')
    AND json_type(i.item_json, '$.' || f.field) = 'text'
),
link_values AS (
  SELECT source, row_ref, field, field = 'customer_portal_about_image' AS is_picture,
    trim(stored, char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200,
      8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)) AS v
  FROM stored_values
),
shaped AS (
  SELECT source, row_ref, field, is_picture, v,
    CASE
      WHEN instr(v, '?') > 0 AND (instr(v, '#') = 0 OR instr(v, '?') < instr(v, '#')) THEN substr(v, 1, instr(v, '?') - 1)
      WHEN instr(v, '#') > 0 THEN substr(v, 1, instr(v, '#') - 1)
      ELSE v
    END AS path_part
  FROM link_values
  WHERE v <> ''
),
characters AS (
  SELECT s.source, s.row_ref, s.field, s.is_picture,
    unicode(substr(s.v, p.n, 1)) AS cp, upper(substr(s.v, p.n, 9)) AS esc
  FROM shaped s
  JOIN positions p ON p.n <= length(s.v)
),
character_reasons AS (
  SELECT source, row_ref, field,
    min(CASE
      WHEN cp < 32 OR cp = 127 THEN 'control_character'
      WHEN NOT is_picture THEN NULL
      WHEN cp BETWEEN 128 AND 159 THEN 'control_character'
      WHEN substr(esc, 1, 3) = '%7F' THEN 'control_character'
      WHEN substr(esc, 1, 1) = '%' AND substr(esc, 2, 1) IN ('0', '1') AND substr(esc, 3, 1) <> ''
        AND instr('0123456789ABCDEF', substr(esc, 3, 1)) > 0 THEN 'control_character'
      WHEN substr(esc, 1, 5) IN ('%C2%8', '%C2%9') AND substr(esc, 6, 1) <> ''
        AND instr('0123456789ABCDEF', substr(esc, 6, 1)) > 0 THEN 'control_character'
      WHEN cp BETWEEN 8234 AND 8238 OR cp BETWEEN 8294 AND 8297 THEN 'bidi_control'
      WHEN substr(esc, 1, 8) = '%E2%80%A' AND substr(esc, 9, 1) IN ('A', 'B', 'C', 'D', 'E') THEN 'bidi_control'
      WHEN substr(esc, 1, 8) = '%E2%81%A' AND substr(esc, 9, 1) IN ('6', '7', '8', '9') THEN 'bidi_control'
      WHEN cp = 65279 OR esc = '%EF%BB%BF' THEN 'byte_order_mark'
    END) AS reason
  FROM characters
  GROUP BY source, row_ref, field
),
checked AS (
  SELECT s.source, s.row_ref, s.field, s.v,
    CASE
      WHEN s.is_picture THEN CASE
        WHEN length(s.v) > 500 THEN 'too_long'
        WHEN c.reason IS NOT NULL THEN c.reason
        WHEN instr(s.v, char(92)) > 0 OR instr(upper(s.v), '%5C') > 0 THEN 'backslash'
        WHEN substr(s.path_part, 1, 9) <> '/uploads/' OR length(s.path_part) <= 9 THEN 'not_own_upload'
        WHEN instr(s.v, '//') > 0 THEN 'double_slash'
        WHEN instr(replace(lower(s.path_part), '%2e', '.') || '/', '/./') > 0
          OR instr(replace(lower(s.path_part), '%2e', '.') || '/', '/../') > 0 THEN 'dot_segment'
        WHEN instr(lower(s.path_part), '%2f') > 0 THEN 'encoded_slash'
      END
      WHEN instr(s.v, char(92)) > 0 THEN 'backslash'
      WHEN lower(substr(s.v, 1, 4)) IN ('/%2f', '/%5c') THEN 'encoded_second_slash'
      WHEN substr(s.v, 1, 2) = '//' THEN 'protocol_relative'
      WHEN c.reason IS NOT NULL THEN c.reason
      WHEN length(s.v) > 500 THEN 'too_long'
      WHEN substr(s.v, 1, 1) = '/' AND instr(s.path_part, '//') > 0
        AND (instr(replace(lower(s.path_part), '%2e', '.'), '/./') > 0 OR instr(replace(lower(s.path_part), '%2e', '.'), '/../') > 0)
        THEN 'resolves_to_second_slash'
      WHEN substr(s.v, 1, 1) <> '/' AND lower(substr(s.v, 1, 7)) <> 'http://' AND lower(substr(s.v, 1, 8)) <> 'https://'
        THEN 'not_http_or_site_path'
    END AS reason
  FROM shaped s
  LEFT JOIN character_reasons c ON c.source = s.source AND c.row_ref = s.row_ref AND c.field = s.field
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
