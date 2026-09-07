-- 0130: record WHICH version of the storefront policies a customer agreed to.
--
-- The public storefront now asks a visitor to agree to the Terms & Conditions
-- and the Privacy Policy before an account is created.  A bare "consented: 1"
-- would prove nothing once the policy text is edited, so the account stores
-- the published version string (portal-legal-YYYY-MM-DD, minted from the
-- policy's own last-updated date) and the moment it was given.
--
-- Additive only.  Both columns are nullable and have NO default, so the
-- existing accounts stay NULL: they signed up before the checkbox existed
-- and back-filling a consent they never gave would be a false record.
-- NULL therefore means exactly "not asked", never "refused".
--
-- The Worker fails account creation/sign-in closed until this migration is
-- applied. This prevents a successful response without a durable version,
-- timestamp and locale record.
--
-- PRE-ASSERTIONS:
--   SELECT COUNT(*) AS account_rows FROM portal_accounts;
--   SELECT COUNT(*) AS consent_columns FROM pragma_table_info('portal_accounts')
--     WHERE name IN ('consent_version', 'consent_at', 'consent_locale');  -- expect 0
--
-- POST-ASSERTIONS:
--   SELECT COUNT(*) FROM portal_accounts;  -- equals account_rows
--   SELECT COUNT(*) AS consent_columns FROM pragma_table_info('portal_accounts')
--     WHERE name IN ('consent_version', 'consent_at', 'consent_locale');  -- expect 3
--   SELECT COUNT(*) FROM portal_accounts WHERE consent_version IS NOT NULL;  -- expect 0
--
-- RECOVERY: this is an append-only schema extension that touches no existing
-- row or column.  If it has to be undone, revert the Worker instead: the
-- column probe makes older code ignore both columns, so leaving them in place
-- is safe and preserves the consent records already captured.

ALTER TABLE portal_accounts ADD COLUMN consent_version TEXT;
ALTER TABLE portal_accounts ADD COLUMN consent_at TEXT;
ALTER TABLE portal_accounts ADD COLUMN consent_locale TEXT;
