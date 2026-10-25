-- Receipt and print settings (owner report 25 Oct: one print produced both the 80x50 card and the 80mm receipt).
-- Settings rows only, no customer data; values stay in the encrypted file. Also the latest audit rows touching them.
-- ops:min-rows 0
SELECT 'setting' AS src, key, value, updated_at AS at, NULL AS who FROM settings
WHERE key LIKE 'receipt%' OR key LIKE '%print%'
UNION ALL
SELECT 'audit', action, substr(COALESCE(details, ''), 1, 400), created_at, user_name FROM (
  SELECT action, details, created_at, user_name FROM audit_logs
  WHERE (entity = 'settings' OR action LIKE '%setting%') AND (details LIKE '%print%' OR details LIKE '%receipt%')
  ORDER BY id DESC LIMIT 15
)
ORDER BY src DESC, at DESC
