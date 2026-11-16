-- stock-state-census-low-stock-settings-20261116: stock-state design Phase 0, the low-stock settings keys and their writers' footprint
-- (design section 1.4: the other writers of the settings table were never checked for these keys).
--   raw_* / *_updated_at   the stored text of low_stock_alert_enabled, low_stock_threshold_mode and low_stock_threshold_default
--                          (a flag, a mode word and a whole number: no personal data) and when each row last changed
--   extra_lowstock_keys    settings rows whose key looks like a low-stock key but is none of the three (an alias a writer made)
--   keys_with_odd_value    of the three keys, how many hold text the Worker's resolver reads differently from a plain value:
--                          padded with spaces, upper case, or a threshold that is not a whole number
--   settings_rows          context: size of the settings table
--   audit_settings_14d     audit rows 'update' on entity 'settings' in the last 14 days (the validated POST /api/settings
--                          writer audits; an import, review or restore writer does not)
--   audit_lowstock_14d     of those, rows whose details name a low-stock key
--   audit_lowstock_last    the newest such row's time
-- Counts and timestamps; the audit details are only matched, never printed. Never a write. One row.
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 100000
WITH a AS MATERIALIZED (
  SELECT created_at, details
  FROM audit_logs INDEXED BY idx_audit_logs_action_created
  WHERE action = 'update' AND created_at >= datetime('now', '-14 days') AND entity = 'settings'
)
SELECT
  (SELECT value FROM settings WHERE key = 'low_stock_alert_enabled') AS raw_enabled,
  (SELECT updated_at FROM settings WHERE key = 'low_stock_alert_enabled') AS enabled_updated_at,
  (SELECT value FROM settings WHERE key = 'low_stock_threshold_mode') AS raw_mode,
  (SELECT updated_at FROM settings WHERE key = 'low_stock_threshold_mode') AS mode_updated_at,
  (SELECT value FROM settings WHERE key = 'low_stock_threshold_default') AS raw_threshold,
  (SELECT updated_at FROM settings WHERE key = 'low_stock_threshold_default') AS threshold_updated_at,
  (SELECT COUNT(*) FROM settings WHERE key LIKE '%low%stock%'
     AND key NOT IN ('low_stock_alert_enabled', 'low_stock_threshold_mode', 'low_stock_threshold_default')) AS extra_lowstock_keys,
  (SELECT COUNT(*) FROM settings WHERE key IN ('low_stock_alert_enabled', 'low_stock_threshold_mode', 'low_stock_threshold_default')
     AND (value <> trim(value)
          OR (key <> 'low_stock_threshold_default' AND value <> lower(value))
          OR (key = 'low_stock_threshold_default' AND trim(value) GLOB '*[^0-9]*'))) AS keys_with_odd_value,
  (SELECT COUNT(*) FROM settings) AS settings_rows,
  (SELECT COUNT(*) FROM a) AS audit_settings_14d,
  (SELECT COUNT(*) FROM a WHERE details LIKE '%low_stock%') AS audit_lowstock_14d,
  (SELECT MAX(created_at) FROM a WHERE details LIKE '%low_stock%') AS audit_lowstock_last
