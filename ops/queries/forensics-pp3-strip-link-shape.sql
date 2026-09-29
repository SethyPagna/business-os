-- SCAN2 PP-3: announcement-strip rows (promotions) whose stored link or picture
-- the storefront must not follow. The strip write path (routes/promotions.ts)
-- stored any trimmed link_url and image_path; only the public read and the
-- banner click refuse javascript: and the like.
-- link_url is checked against lib/safeLinkUrl.ts (an http(s) URL or a path with
-- a single leading '/', no control characters, at most 500 characters), with the
-- two shapes lane AB-W2 adds (a backslash, an encoded second slash):
--   backslash, encoded_second_slash, protocol_relative, control_character,
--   too_long, not_http_or_site_path
-- image_path is listed when it starts '//' (protocol_relative), holds a control
-- character, or names a scheme other than http(s) before any '/'
-- (non_http_scheme: javascript:, data:, ...).
-- Columns: promotion_id, is_active, link_type, field, reason, value_chars,
--   value_preview (the first 120 characters)
-- Repair (proposed, not run): fix or clear the link / picture on the strip editor;
-- never by SQL.
-- Ids and the stored link text only. Read-only.
-- ops:min-rows 0
-- ops:max-rows 1000
WITH vals AS MATERIALIZED (
  SELECT id, is_active, link_type, 'link_url' AS field, trim(link_url) AS v FROM promotions
  WHERE COALESCE(trim(link_url), '') <> ''
  UNION ALL
  SELECT id, is_active, link_type, 'image_path', trim(image_path) FROM promotions
  WHERE COALESCE(trim(image_path), '') <> ''
),
checked AS MATERIALIZED (
  SELECT id, is_active, link_type, field, v,
    CASE
      WHEN field = 'link_url' AND instr(v, char(92)) > 0 THEN 'backslash'
      WHEN field = 'link_url' AND lower(substr(v, 1, 4)) IN ('/%2f', '/%5c') THEN 'encoded_second_slash'
      WHEN substr(v, 1, 2) = '//' THEN 'protocol_relative'
      WHEN v GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*') THEN 'control_character'
      WHEN field = 'link_url' AND length(v) > 500 THEN 'too_long'
      WHEN field = 'link_url' AND substr(v, 1, 1) <> '/'
        AND lower(substr(v, 1, 7)) <> 'http://' AND lower(substr(v, 1, 8)) <> 'https://' THEN 'not_http_or_site_path'
      WHEN field = 'image_path' AND instr(v, ':') > 0
        AND (instr(v, '/') = 0 OR instr(v, ':') < instr(v, '/'))
        AND lower(substr(v, 1, instr(v, ':') - 1)) NOT IN ('http', 'https') THEN 'non_http_scheme'
    END AS reason
  FROM vals
)
SELECT id AS promotion_id, is_active, link_type, field, reason, length(v) AS value_chars, substr(v, 1, 120) AS value_preview
FROM checked
WHERE reason IS NOT NULL
ORDER BY id, field
LIMIT 1000
