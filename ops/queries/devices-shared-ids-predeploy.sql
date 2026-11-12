-- devices-shared-ids-predeploy: counts only, no names, ids or IPs. Runs before the B7 device release (no cookie column yet).
--   shared_ids_any / shared_ids_approved  device ids that rows from two or more accounts carry (any status / approved)
--   shared_ids_live_session               of those approved shared ids, how many have a live session on two or more of their accounts
--   rows_on_shared_ids                    trusted_devices rows that sit on a shared id
-- ops:min-rows 1
-- ops:max-rows 1
-- ops:max-rows-read 50000
SELECT
  (SELECT COUNT(*) FROM (SELECT device_id FROM trusted_devices GROUP BY device_id HAVING COUNT(DISTINCT user_id) >= 2)) AS shared_ids_any,
  (SELECT COUNT(*) FROM (SELECT device_id FROM trusted_devices WHERE status = 'approved' GROUP BY device_id HAVING COUNT(DISTINCT user_id) >= 2)) AS shared_ids_approved,
  (SELECT COUNT(*) FROM (
     SELECT s.device_id FROM user_sessions s
       JOIN trusted_devices t ON t.device_id = s.device_id AND t.user_id = s.user_id AND t.status = 'approved'
      WHERE s.revoked_at IS NULL AND s.expires_at > datetime('now')
      GROUP BY s.device_id HAVING COUNT(DISTINCT s.user_id) >= 2)) AS shared_ids_live_session,
  (SELECT COUNT(*) FROM trusted_devices WHERE device_id IN (
     SELECT device_id FROM trusted_devices GROUP BY device_id HAVING COUNT(DISTINCT user_id) >= 2)) AS rows_on_shared_ids;
