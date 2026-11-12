-- devices-census-predeploy: counts only, no names, ids or IPs. Runs before migration 0304 (no shop_devices table yet).
--   approved_bad_shape  approved rows whose device_id is outside [A-Za-z0-9_-]{8,100}, the shape the next release accepts
--   accounts_at_or_over_3 / _5  accounts holding that many approved devices
--   pending_prompts_14d / accounts_prompted_14d  login_device_pending audit rows in the last 14 days
--   new_rows_14d_same_ua_ip  new rows in 14 days whose account already has an approved row with the same user agent and IP (same device, new id)
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 20000
SELECT
  (SELECT COUNT(*) FROM trusted_devices WHERE status = 'approved') AS approved_total,
  (SELECT COUNT(*) FROM trusted_devices WHERE status = 'approved'
     AND (length(device_id) < 8 OR length(device_id) > 100 OR device_id GLOB '*[^A-Za-z0-9_-]*')) AS approved_bad_shape,
  (SELECT COUNT(*) FROM trusted_devices WHERE status = 'pending') AS pending_now,
  (SELECT COUNT(*) FROM (SELECT user_id FROM trusted_devices WHERE status = 'approved' GROUP BY user_id HAVING COUNT(*) >= 3)) AS accounts_at_or_over_3,
  (SELECT COUNT(*) FROM (SELECT user_id FROM trusted_devices WHERE status = 'approved' GROUP BY user_id HAVING COUNT(*) >= 5)) AS accounts_at_or_over_5,
  (SELECT COUNT(*) FROM audit_logs WHERE action = 'login_device_pending' AND created_at >= datetime('now', '-14 days')) AS pending_prompts_14d,
  (SELECT COUNT(DISTINCT user_id) FROM audit_logs WHERE action = 'login_device_pending' AND created_at >= datetime('now', '-14 days')) AS accounts_prompted_14d,
  (SELECT COUNT(*) FROM trusted_devices n WHERE n.requested_at >= datetime('now', '-14 days')) AS new_rows_14d,
  (SELECT COUNT(*) FROM trusted_devices n WHERE n.requested_at >= datetime('now', '-14 days') AND EXISTS (
     SELECT 1 FROM trusted_devices o WHERE o.user_id = n.user_id AND o.id <> n.id AND o.status = 'approved'
       AND o.user_agent = n.user_agent AND n.first_ip IN (o.first_ip, o.last_ip))) AS new_rows_14d_same_ua_ip;
