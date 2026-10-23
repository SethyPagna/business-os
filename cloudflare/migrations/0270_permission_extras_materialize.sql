-- 0270 PERMISSION EXTRAS MATERIALIZE (lane 6.0.967, owner ruling 21 Oct 2026: "Full = main access only; extras are separate
-- and consistent everywhere", confirmed 23 Oct: "make it consistent ... it doesn't make anything different").
--
-- The Worker used to IMPLY several grants from a module grant. They are removed in the same release; this file writes every
-- implied grant out so that no principal (role or user) gains or loses effective access:
--   settings === true  =>  business_identity, sales_policy, receipt_settings, portal_posts, portal_faq, portal_about,
--                          customer_portal, library, drive_credentials, ai_providers
--   inventory_checks ABSENT  =>  count sessions follow Inventory (view: Inventory Full or Review and inventory:view !== false;
--                          check: the same and inventory:check !== false); written as inventory_checks (+ :view / :check overrides)
--   inventory_check_show_<field> NOT a boolean  =>  Inventory Full; written as true
-- Everything is evaluated on the merged map {...role, ...user} (a user key present, even null, overrides the role), and a
-- principal that is Administrator (role code 'admin' or merged all === true) is never touched.
-- Role rows are fixed from the role alone; a user row is then fixed from the user's merged map after its role changed
-- ('mid' phase), so a user override such as {settings:false} on a Settings Full role keeps its meaning key by key.
--
-- A stored drive_credentials:true without Settings Full, or any stored ai_providers key, did NOTHING before (no Worker reader
-- granted from it). To keep effective access exactly, such a value is overwritten with what the old rules granted (false
-- unless Settings Full). The ledger keeps the raw text, so the owner can see and re-grant it.
--
-- Ledgers (kept as evidence, excluded from backups in test-backup-tables-completeness-pure.cjs):
--   permission_extras_0270_state  one row per principal and phase (before | mid | after): raw text, admin flag, old-rule and new-rule matrices
--   permission_extras_0270_fix  one row per (principal, id, key) written
-- PRE:  no backslash in any permissions text; no duplicate member names in any permissions object.
-- POST: for every non-admin principal the new rules on the after data, the old rules on the after data and the old rules on the
--       before data agree on every capability bit; admin flags unchanged; unfixed rows are byte-identical; fixed rows differ only
--       in the written keys (both directions); row counts unchanged. A failed check reads a malformed JSON path and aborts the file.
-- Statement-splitter note: a conditional expression inside a statement is always parenthesised, opening bracket directly before it.
-- Pinned by scripts/test-migration-0270-permission-extras-native.cjs (a before/after oracle over every key).
-- RECOVERY (run only with the PRE-change Worker live): for rows still equal to their 'after' text,
--   UPDATE roles SET permissions = (SELECT b.raw FROM permission_extras_0270_state b WHERE b.phase = 'before' AND b.principal = 'role' AND b.id = roles.id)
--   WHERE id IN (SELECT id FROM permission_extras_0270_fix WHERE principal = 'role')
--     AND permissions IS (SELECT a.raw FROM permission_extras_0270_state a WHERE a.phase = 'after' AND a.principal = 'role' AND a.id = roles.id);
--   and the same for users. Rows edited since the migration are left alone.

SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM roles WHERE instr(COALESCE(permissions, ''), char(92)) > 0
  UNION ALL SELECT 1 FROM users WHERE instr(COALESCE(permissions, ''), char(92)) > 0
) THEN 1 ELSE json_extract('[]', '$[perm_extras_0270_pre_backslash]') END;

SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM (SELECT 'role' AS t, id, permissions AS j FROM roles UNION ALL SELECT 'user', id, permissions FROM users) s,
       json_each((CASE WHEN json_valid(s.j) THEN (CASE WHEN json_type(s.j) = 'object' THEN s.j ELSE '{}' END) ELSE '{}' END)) e
  GROUP BY s.t, s.id, e.key HAVING COUNT(*) > 1
) THEN 1 ELSE json_extract('[]', '$[perm_extras_0270_pre_duplicate_keys]') END;

CREATE TABLE permission_extras_0270_state (
  phase TEXT NOT NULL CHECK (phase IN ('before', 'mid', 'after')),
  principal TEXT NOT NULL CHECK (principal IN ('role', 'user')),
  id INTEGER NOT NULL,
  role_id INTEGER,
  raw TEXT,
  admin INTEGER NOT NULL,
  dormant INTEGER NOT NULL,
  old_matrix TEXT NOT NULL,
  new_matrix TEXT NOT NULL,
  mt TEXT NOT NULL,
  PRIMARY KEY (phase, principal, id)
);
CREATE TABLE permission_extras_0270_fix (
  principal TEXT NOT NULL CHECK (principal IN ('role', 'user')),
  id INTEGER NOT NULL,
  name TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (value_json IN ('true', 'false')),
  PRIMARY KEY (principal, id, name)
);

CREATE VIEW permission_extras_0270_principal AS
WITH p AS (
  SELECT 'role' AS principal, r.id AS id, r.id AS role_id, r.permissions AS raw,
    (CASE WHEN json_valid(r.permissions) THEN (CASE WHEN json_type(r.permissions) = 'object' THEN r.permissions ELSE '{}' END) ELSE '{}' END) AS rb,
    '{}' AS ub,
    lower(trim(COALESCE(r.code, ''), ' ' || char(9) || char(10) || char(13))) AS rc
  FROM roles r
  UNION ALL
  SELECT 'user', u.id, u.role_id, u.permissions,
    (CASE WHEN json_valid(r.permissions) THEN (CASE WHEN json_type(r.permissions) = 'object' THEN r.permissions ELSE '{}' END) ELSE '{}' END),
    (CASE WHEN json_valid(u.permissions) THEN (CASE WHEN json_type(u.permissions) = 'object' THEN u.permissions ELSE '{}' END) ELSE '{}' END),
    lower(trim(COALESCE(r.code, ''), ' ' || char(9) || char(10) || char(13)))
  FROM users u LEFT JOIN roles r ON r.id = u.role_id
),
q AS (
  SELECT principal, id, role_id, raw, rb, ub, rc,
    COALESCE(json_type(ub, '$."all"'), json_type(rb, '$."all"')) AS all_t,
    COALESCE(json_type(ub, '$."settings"'), json_type(rb, '$."settings"')) AS settings_t,
    COALESCE(json_type(ub, '$."backup"'), json_type(rb, '$."backup"')) AS backup_t,
    COALESCE(json_type(ub, '$."inventory"'), json_type(rb, '$."inventory"')) AS inventory_t,
    COALESCE(json_type(ub, '$."business_identity"'), json_type(rb, '$."business_identity"')) AS k_business_identity_t,
    COALESCE(json_type(ub, '$."sales_policy"'), json_type(rb, '$."sales_policy"')) AS k_sales_policy_t,
    COALESCE(json_type(ub, '$."receipt_settings"'), json_type(rb, '$."receipt_settings"')) AS k_receipt_settings_t,
    COALESCE(json_type(ub, '$."portal_posts"'), json_type(rb, '$."portal_posts"')) AS k_portal_posts_t,
    COALESCE(json_type(ub, '$."portal_faq"'), json_type(rb, '$."portal_faq"')) AS k_portal_faq_t,
    COALESCE(json_type(ub, '$."portal_about"'), json_type(rb, '$."portal_about"')) AS k_portal_about_t,
    COALESCE(json_type(ub, '$."customer_portal"'), json_type(rb, '$."customer_portal"')) AS k_customer_portal_t,
    COALESCE(json_type(ub, '$."library"'), json_type(rb, '$."library"')) AS k_library_t,
    COALESCE(json_type(ub, '$."drive_credentials"'), json_type(rb, '$."drive_credentials"')) AS k_drive_credentials_t,
    COALESCE(json_type(ub, '$."ai_providers"'), json_type(rb, '$."ai_providers"')) AS k_ai_providers_t,
    COALESCE(json_type(ub, '$."inventory_checks"'), json_type(rb, '$."inventory_checks"')) AS ic_t,
    COALESCE(json_type(ub, '$."inventory_checks:view"'), json_type(rb, '$."inventory_checks:view"')) AS icv_t,
    COALESCE(json_type(ub, '$."inventory_checks:check"'), json_type(rb, '$."inventory_checks:check"')) AS icc_t,
    COALESCE(json_type(ub, '$."inventory:view"'), json_type(rb, '$."inventory:view"')) AS iv_t,
    COALESCE(json_type(ub, '$."inventory:check"'), json_type(rb, '$."inventory:check"')) AS ick_t,
    COALESCE(json_type(ub, '$."inventory_check_show_price"'), json_type(rb, '$."inventory_check_show_price"')) AS f_price_t,
    COALESCE(json_type(ub, '$."inventory_check_show_barcode"'), json_type(rb, '$."inventory_check_show_barcode"')) AS f_barcode_t,
    COALESCE(json_type(ub, '$."inventory_check_show_category"'), json_type(rb, '$."inventory_check_show_category"')) AS f_category_t,
    COALESCE(json_type(ub, '$."inventory_check_show_brand"'), json_type(rb, '$."inventory_check_show_brand"')) AS f_brand_t,
    COALESCE(json_type(ub, '$."inventory_check_show_stock"'), json_type(rb, '$."inventory_check_show_stock"')) AS f_stock_t,
    COALESCE(json_type(ub, '$."inventory_check_show_received"'), json_type(rb, '$."inventory_check_show_received"')) AS f_received_t,
    COALESCE(json_type(ub, '$."inventory_check_show_sales"'), json_type(rb, '$."inventory_check_show_sales"')) AS f_sales_t,
    COALESCE(json_type(ub, '$."inventory_check_show_customers"'), json_type(rb, '$."inventory_check_show_customers"')) AS f_customers_t,
    COALESCE(json_type(ub, '$."inventory_check_show_cost"'), json_type(rb, '$."inventory_check_show_cost"')) AS f_cost_t,
    (CASE WHEN json_type(ub, '$.inventory') IS NOT NULL THEN json_extract(ub, '$.inventory') ELSE json_extract(rb, '$.inventory') END) AS inv_v
  FROM p
),
v AS (
  SELECT q.*,
    (rc = 'admin' OR all_t IS 'true') AS admin,
    (settings_t IS 'true') AS sf,
    (backup_t IS 'true') AS bk,
    (CASE WHEN inventory_t IS 'true' THEN 'full' WHEN inventory_t IS 'text' AND inv_v IS 'review' THEN 'review' ELSE 'none' END) AS inv_tier
  FROM q
),
w AS (
  SELECT v.*,
    (CASE WHEN ic_t IS NOT NULL THEN (ic_t IS 'true' AND icv_t IS NOT 'false') ELSE (inv_tier <> 'none' AND iv_t IS NOT 'false') END) AS old_view,
    (ic_t IS 'true' AND icv_t IS NOT 'false') AS new_view
  FROM v
),
x AS (
  SELECT w.*,
    (old_view AND (CASE WHEN ic_t IS NOT NULL THEN (ic_t IS 'true' AND icc_t IS NOT 'false') ELSE (inv_tier <> 'none' AND ick_t IS NOT 'false') END)) AS old_check,
    (new_view AND icc_t IS NOT 'false') AS new_check
  FROM w
)
SELECT principal, id, role_id, raw, admin,
  ((k_drive_credentials_t IS 'true' AND NOT sf) OR k_ai_providers_t IS NOT NULL) AS dormant,
  json_object(
    'business_identity', (k_business_identity_t IS 'true' OR sf),
    'sales_policy', (k_sales_policy_t IS 'true' OR sf),
    'receipt_settings', (k_receipt_settings_t IS 'true' OR sf),
    'portal_posts', (k_portal_posts_t IS 'true' OR sf),
    'portal_faq', (k_portal_faq_t IS 'true' OR sf),
    'portal_about', (k_portal_about_t IS 'true' OR sf),
    'customer_portal', (k_customer_portal_t IS 'true' OR sf),
    'library', (k_library_t IS 'true' OR sf),
    'drive_credentials', sf,
    'ai_providers', sf,
    'cap:drive_control', sf,
    'cap:backup_diag', (bk OR sf),
    'cap:strip', (k_portal_posts_t IS 'true' OR k_customer_portal_t IS 'true' OR sf),
    'inventory_checks', old_view,
    'inventory_checks:check', old_check,
    'inventory_check_show_price', (old_view AND (CASE WHEN f_price_t IN ('true', 'false') THEN f_price_t = 'true' ELSE inv_tier = 'full' END)),
    'inventory_check_show_barcode', (old_view AND (CASE WHEN f_barcode_t IN ('true', 'false') THEN f_barcode_t = 'true' ELSE inv_tier = 'full' END)),
    'inventory_check_show_category', (old_view AND (CASE WHEN f_category_t IN ('true', 'false') THEN f_category_t = 'true' ELSE inv_tier = 'full' END)),
    'inventory_check_show_brand', (old_view AND (CASE WHEN f_brand_t IN ('true', 'false') THEN f_brand_t = 'true' ELSE inv_tier = 'full' END)),
    'inventory_check_show_stock', (old_view AND (CASE WHEN f_stock_t IN ('true', 'false') THEN f_stock_t = 'true' ELSE inv_tier = 'full' END)),
    'inventory_check_show_received', (old_view AND (CASE WHEN f_received_t IN ('true', 'false') THEN f_received_t = 'true' ELSE inv_tier = 'full' END)),
    'inventory_check_show_sales', (old_view AND (CASE WHEN f_sales_t IN ('true', 'false') THEN f_sales_t = 'true' ELSE inv_tier = 'full' END)),
    'inventory_check_show_customers', (old_view AND (CASE WHEN f_customers_t IN ('true', 'false') THEN f_customers_t = 'true' ELSE inv_tier = 'full' END)),
    'inventory_check_show_cost', (old_view AND (CASE WHEN f_cost_t IN ('true', 'false') THEN f_cost_t = 'true' ELSE inv_tier = 'full' END))) AS old_matrix,
  json_object(
    'business_identity', (k_business_identity_t IS 'true'),
    'sales_policy', (k_sales_policy_t IS 'true'),
    'receipt_settings', (k_receipt_settings_t IS 'true'),
    'portal_posts', (k_portal_posts_t IS 'true'),
    'portal_faq', (k_portal_faq_t IS 'true'),
    'portal_about', (k_portal_about_t IS 'true'),
    'customer_portal', (k_customer_portal_t IS 'true'),
    'library', (k_library_t IS 'true'),
    'drive_credentials', (k_drive_credentials_t IS 'true'),
    'ai_providers', (k_ai_providers_t IS 'true'),
    'cap:drive_control', (k_drive_credentials_t IS 'true'),
    'cap:backup_diag', (bk OR k_drive_credentials_t IS 'true'),
    'cap:strip', (k_portal_posts_t IS 'true' OR k_customer_portal_t IS 'true'),
    'inventory_checks', new_view,
    'inventory_checks:check', new_check,
    'inventory_check_show_price', (new_view AND f_price_t IS 'true'),
    'inventory_check_show_barcode', (new_view AND f_barcode_t IS 'true'),
    'inventory_check_show_category', (new_view AND f_category_t IS 'true'),
    'inventory_check_show_brand', (new_view AND f_brand_t IS 'true'),
    'inventory_check_show_stock', (new_view AND f_stock_t IS 'true'),
    'inventory_check_show_received', (new_view AND f_received_t IS 'true'),
    'inventory_check_show_sales', (new_view AND f_sales_t IS 'true'),
    'inventory_check_show_customers', (new_view AND f_customers_t IS 'true'),
    'inventory_check_show_cost', (new_view AND f_cost_t IS 'true')) AS new_matrix,
  json_object(
    'ic', ic_t,
    'icv', icv_t,
    'icc', icc_t,
    'f_price', f_price_t,
    'f_barcode', f_barcode_t,
    'f_category', f_category_t,
    'f_brand', f_brand_t,
    'f_stock', f_stock_t,
    'f_received', f_received_t,
    'f_sales', f_sales_t,
    'f_customers', f_customers_t,
    'f_cost', f_cost_t) AS mt
FROM x;

INSERT INTO permission_extras_0270_state (phase, principal, id, role_id, raw, admin, dormant, old_matrix, new_matrix, mt)
SELECT 'before', principal, id, role_id, raw, admin, dormant, old_matrix, new_matrix, mt FROM permission_extras_0270_principal;

-- role fixes: a key bit whose new-rule value differs from the old-rule value gets the old value written
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, o.key, (CASE o.value WHEN 1 THEN 'true' ELSE 'false' END)
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id, json_each(b.old_matrix) o
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0 AND o.key IN ('business_identity', 'sales_policy', 'receipt_settings', 'portal_posts', 'portal_faq', 'portal_about', 'customer_portal', 'library', 'drive_credentials', 'ai_providers')
  AND o.value IS NOT json_extract(n.new_matrix, '$."' || o.key || '"');
-- count sessions: the view bit (old rules read inventory when inventory_checks is absent)
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_checks', (CASE json_extract(b.old_matrix, '$."inventory_checks"') WHEN 1 THEN 'true' ELSE 'false' END)
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') IS NOT json_extract(n.new_matrix, '$."inventory_checks"')
  AND (json_extract(b.old_matrix, '$."inventory_checks"') = 0 OR json_extract(n.mt, '$.ic') IS NOT 'true');
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_checks:view', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(n.new_matrix, '$."inventory_checks"') = 0 AND json_extract(n.mt, '$.icv') IS 'false';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_checks:check', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_checks:check"') = 1 AND json_extract(n.mt, '$.icc') IS 'false';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_checks:check', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_checks:check"') = 0 AND json_extract(n.mt, '$.icc') IS NOT 'false';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_price', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_price"') = 1 AND json_extract(n.mt, '$.f_price') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_price', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_price"') = 0 AND json_extract(n.mt, '$.f_price') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_barcode', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_barcode"') = 1 AND json_extract(n.mt, '$.f_barcode') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_barcode', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_barcode"') = 0 AND json_extract(n.mt, '$.f_barcode') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_category', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_category"') = 1 AND json_extract(n.mt, '$.f_category') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_category', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_category"') = 0 AND json_extract(n.mt, '$.f_category') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_brand', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_brand"') = 1 AND json_extract(n.mt, '$.f_brand') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_brand', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_brand"') = 0 AND json_extract(n.mt, '$.f_brand') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_stock', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_stock"') = 1 AND json_extract(n.mt, '$.f_stock') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_stock', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_stock"') = 0 AND json_extract(n.mt, '$.f_stock') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_received', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_received"') = 1 AND json_extract(n.mt, '$.f_received') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_received', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_received"') = 0 AND json_extract(n.mt, '$.f_received') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_sales', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_sales"') = 1 AND json_extract(n.mt, '$.f_sales') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_sales', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_sales"') = 0 AND json_extract(n.mt, '$.f_sales') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_customers', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_customers"') = 1 AND json_extract(n.mt, '$.f_customers') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_customers', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_customers"') = 0 AND json_extract(n.mt, '$.f_customers') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_cost', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_cost"') = 1 AND json_extract(n.mt, '$.f_cost') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'role', b.id, 'inventory_check_show_cost', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'before' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'role' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_cost"') = 0 AND json_extract(n.mt, '$.f_cost') IS 'true';

UPDATE roles SET
  permissions = json_patch(
    (CASE WHEN json_valid(permissions) THEN (CASE WHEN json_type(permissions) = 'object' THEN permissions ELSE '{}' END) ELSE '{}' END),
    (SELECT json_group_object(f.name, json(f.value_json)) FROM permission_extras_0270_fix f WHERE f.principal = 'role' AND f.id = roles.id)),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id IN (SELECT id FROM permission_extras_0270_fix WHERE principal = 'role');

INSERT INTO permission_extras_0270_state (phase, principal, id, role_id, raw, admin, dormant, old_matrix, new_matrix, mt)
SELECT 'mid', principal, id, role_id, raw, admin, dormant, old_matrix, new_matrix, mt FROM permission_extras_0270_principal WHERE principal = 'user';

-- user fixes: begin
-- user fixes: a key bit whose new-rule value differs from the old-rule value gets the old value written
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, o.key, (CASE o.value WHEN 1 THEN 'true' ELSE 'false' END)
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id, json_each(b.old_matrix) o
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0 AND o.key IN ('business_identity', 'sales_policy', 'receipt_settings', 'portal_posts', 'portal_faq', 'portal_about', 'customer_portal', 'library', 'drive_credentials', 'ai_providers')
  AND o.value IS NOT json_extract(n.new_matrix, '$."' || o.key || '"');
-- count sessions: the view bit (old rules read inventory when inventory_checks is absent)
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_checks', (CASE json_extract(b.old_matrix, '$."inventory_checks"') WHEN 1 THEN 'true' ELSE 'false' END)
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') IS NOT json_extract(n.new_matrix, '$."inventory_checks"')
  AND (json_extract(b.old_matrix, '$."inventory_checks"') = 0 OR json_extract(n.mt, '$.ic') IS NOT 'true');
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_checks:view', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(n.new_matrix, '$."inventory_checks"') = 0 AND json_extract(n.mt, '$.icv') IS 'false';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_checks:check', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_checks:check"') = 1 AND json_extract(n.mt, '$.icc') IS 'false';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_checks:check', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_checks:check"') = 0 AND json_extract(n.mt, '$.icc') IS NOT 'false';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_price', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_price"') = 1 AND json_extract(n.mt, '$.f_price') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_price', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_price"') = 0 AND json_extract(n.mt, '$.f_price') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_barcode', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_barcode"') = 1 AND json_extract(n.mt, '$.f_barcode') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_barcode', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_barcode"') = 0 AND json_extract(n.mt, '$.f_barcode') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_category', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_category"') = 1 AND json_extract(n.mt, '$.f_category') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_category', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_category"') = 0 AND json_extract(n.mt, '$.f_category') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_brand', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_brand"') = 1 AND json_extract(n.mt, '$.f_brand') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_brand', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_brand"') = 0 AND json_extract(n.mt, '$.f_brand') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_stock', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_stock"') = 1 AND json_extract(n.mt, '$.f_stock') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_stock', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_stock"') = 0 AND json_extract(n.mt, '$.f_stock') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_received', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_received"') = 1 AND json_extract(n.mt, '$.f_received') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_received', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_received"') = 0 AND json_extract(n.mt, '$.f_received') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_sales', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_sales"') = 1 AND json_extract(n.mt, '$.f_sales') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_sales', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_sales"') = 0 AND json_extract(n.mt, '$.f_sales') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_customers', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_customers"') = 1 AND json_extract(n.mt, '$.f_customers') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_customers', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_customers"') = 0 AND json_extract(n.mt, '$.f_customers') IS 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_cost', 'true'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_cost"') = 1 AND json_extract(n.mt, '$.f_cost') IS NOT 'true';
INSERT INTO permission_extras_0270_fix (principal, id, name, value_json)
SELECT 'user', b.id, 'inventory_check_show_cost', 'false'
FROM permission_extras_0270_state b JOIN permission_extras_0270_state n ON n.phase = 'mid' AND n.principal = b.principal AND n.id = b.id
WHERE b.phase = 'before' AND b.principal = 'user' AND b.admin = 0
  AND json_extract(b.old_matrix, '$."inventory_checks"') = 1 AND json_extract(b.old_matrix, '$."inventory_check_show_cost"') = 0 AND json_extract(n.mt, '$.f_cost') IS 'true';
-- user fixes: end

UPDATE users SET
  permissions = json_patch(
    (CASE WHEN json_valid(permissions) THEN (CASE WHEN json_type(permissions) = 'object' THEN permissions ELSE '{}' END) ELSE '{}' END),
    (SELECT json_group_object(f.name, json(f.value_json)) FROM permission_extras_0270_fix f WHERE f.principal = 'user' AND f.id = users.id)),
  updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT id FROM permission_extras_0270_fix WHERE principal = 'user');

INSERT INTO permission_extras_0270_state (phase, principal, id, role_id, raw, admin, dormant, old_matrix, new_matrix, mt)
SELECT 'after', principal, id, role_id, raw, admin, dormant, old_matrix, new_matrix, mt FROM permission_extras_0270_principal;

-- POST 1: three-way agreement on every bit; admin flag unchanged; no principal appeared or vanished
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM permission_extras_0270_state b
  JOIN permission_extras_0270_state a ON a.phase = 'after' AND a.principal = b.principal AND a.id = b.id, json_each(b.old_matrix) o
  WHERE b.phase = 'before' AND b.admin = 0
    AND (json_extract(a.new_matrix, '$."' || o.key || '"') IS NOT o.value
      OR json_extract(a.old_matrix, '$."' || o.key || '"') IS NOT o.value)
) AND NOT EXISTS (
  SELECT 1 FROM permission_extras_0270_state b LEFT JOIN permission_extras_0270_state a ON a.phase = 'after' AND a.principal = b.principal AND a.id = b.id
  WHERE b.phase = 'before' AND (a.id IS NULL OR a.admin IS NOT b.admin)
) THEN 1 ELSE json_extract('[]', '$[perm_extras_0270_post_matrix]') END;

-- POST 2: no administrator was written; a row with no fix keeps its text byte for byte
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM permission_extras_0270_fix f JOIN permission_extras_0270_state b ON b.phase = 'before' AND b.principal = f.principal AND b.id = f.id WHERE b.admin = 1
) AND NOT EXISTS (
  SELECT 1 FROM permission_extras_0270_state a JOIN permission_extras_0270_state b ON b.phase = 'before' AND b.principal = a.principal AND b.id = a.id
  WHERE a.phase = 'after' AND a.raw IS NOT b.raw
    AND NOT EXISTS (SELECT 1 FROM permission_extras_0270_fix f WHERE f.principal = a.principal AND f.id = a.id)
) THEN 1 ELSE json_extract('[]', '$[perm_extras_0270_post_untouched]') END;

-- POST 3: a fixed row differs only in its written keys, in both directions
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM permission_extras_0270_state b JOIN permission_extras_0270_state a ON a.phase = 'after' AND a.principal = b.principal AND a.id = b.id,
    json_each((CASE WHEN json_valid(b.raw) THEN (CASE WHEN json_type(b.raw) = 'object' THEN b.raw ELSE '{}' END) ELSE '{}' END)) e
  WHERE b.phase = 'before'
    AND EXISTS (SELECT 1 FROM permission_extras_0270_fix f WHERE f.principal = b.principal AND f.id = b.id)
    AND NOT EXISTS (SELECT 1 FROM permission_extras_0270_fix f WHERE f.principal = b.principal AND f.id = b.id AND f.name = e.key)
    AND (json_type(a.raw, '$."' || e.key || '"') IS NOT json_type(b.raw, '$."' || e.key || '"')
      OR json_extract(a.raw, '$."' || e.key || '"') IS NOT json_extract(b.raw, '$."' || e.key || '"'))
) AND NOT EXISTS (
  SELECT 1 FROM permission_extras_0270_state b JOIN permission_extras_0270_state a ON a.phase = 'after' AND a.principal = b.principal AND a.id = b.id,
    json_each((CASE WHEN json_valid(a.raw) THEN (CASE WHEN json_type(a.raw) = 'object' THEN a.raw ELSE '{}' END) ELSE '{}' END)) e
  WHERE b.phase = 'before'
    AND EXISTS (SELECT 1 FROM permission_extras_0270_fix f WHERE f.principal = b.principal AND f.id = b.id)
    AND NOT EXISTS (SELECT 1 FROM permission_extras_0270_fix f WHERE f.principal = b.principal AND f.id = b.id AND f.name = e.key)
    AND json_type(b.raw, '$."' || e.key || '"') IS NULL
) THEN 1 ELSE json_extract('[]', '$[perm_extras_0270_post_only_fixed_keys]') END;

-- POST 4: row counts
SELECT CASE WHEN (SELECT COUNT(*) FROM permission_extras_0270_state WHERE phase = 'before') = (SELECT COUNT(*) FROM roles) + (SELECT COUNT(*) FROM users)
  AND (SELECT COUNT(*) FROM permission_extras_0270_state WHERE phase = 'after') = (SELECT COUNT(*) FROM roles) + (SELECT COUNT(*) FROM users)
THEN 1 ELSE json_extract('[]', '$[perm_extras_0270_post_counts]') END;

DROP VIEW permission_extras_0270_principal;
