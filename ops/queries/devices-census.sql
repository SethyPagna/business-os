-- devices-census: counts only, no names, ids or IPs. Run before and after the device-approval release (cap 5, device cookie, shop devices).
--   approved_total            approved trusted_devices rows
--   approved_bad_shape        approved rows whose device_id is outside [A-Za-z0-9_-]{8,100}, the shape the Worker now accepts; such a row can never
--                             match again, so its owner starts a new pending request at the next sign-in
--   pending_now               rows waiting for an administrator
--   accounts_at_or_over_5     accounts holding 5 or more approved devices (the cap; a sixth waits for a replace)
--   pending_prompts_14d       login_device_pending audit rows in the last 14 days (audit rows older than the retention window are gone)
--   shop_devices_active       devices currently marked as shop devices (0 before migration 0304 is applied is an error: the table must exist)
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 1000
SELECT
  (SELECT COUNT(*) FROM trusted_devices WHERE status = 'approved') AS approved_total,
  (SELECT COUNT(*) FROM trusted_devices WHERE status = 'approved'
     AND (length(device_id) < 8 OR length(device_id) > 100 OR device_id GLOB '*[^A-Za-z0-9_-]*')) AS approved_bad_shape,
  (SELECT COUNT(*) FROM trusted_devices WHERE status = 'pending') AS pending_now,
  (SELECT COUNT(*) FROM (SELECT user_id FROM trusted_devices WHERE status = 'approved' GROUP BY user_id HAVING COUNT(*) >= 5)) AS accounts_at_or_over_5,
  (SELECT COUNT(*) FROM audit_logs WHERE action = 'login_device_pending' AND created_at >= datetime('now', '-14 days')) AS pending_prompts_14d,
  (SELECT COUNT(*) FROM shop_devices WHERE unmarked_at IS NULL) AS shop_devices_active;
