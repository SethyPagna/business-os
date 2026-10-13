-- Storefront sign-up switch: whether a saved value exists and what it is.
-- One settings key only; no other settings, names or contact details.
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(*) FROM settings WHERE key = 'customer_portal_signup_enabled') AS row_exists,
  (SELECT value FROM settings WHERE key = 'customer_portal_signup_enabled') AS saved_value,
  (SELECT updated_at FROM settings WHERE key = 'customer_portal_signup_enabled') AS saved_at,
  datetime('now') AS checked_at_utc
