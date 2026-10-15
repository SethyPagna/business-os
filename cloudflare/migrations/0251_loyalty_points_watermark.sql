-- Reset existing loyalty without rewriting business history. AUTOINCREMENT IDs
-- distinguish creation from editable dates, approvals and later payments.
-- system_flags survives restore and cannot be edited through Settings.
-- Reapplying preserves the checkpoint, subsequent earnings and switch choice.
INSERT INTO settings (key, value, updated_at)
SELECT 'loyalty_points_enabled', 'false', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM system_flags WHERE key = 'loyalty_points_reset')
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

INSERT OR IGNORE INTO system_flags (key, value, updated_at)
SELECT 'loyalty_points_reset', json_object(
  'version', 1,
  'reset_at', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  'sales', (SELECT COALESCE(MAX(id), 0) FROM sales),
  'returns', (SELECT COALESCE(MAX(id), 0) FROM returns),
  'submissions', (SELECT COALESCE(MAX(id), 0) FROM customer_share_submissions),
  'adjustments', (SELECT COALESCE(MAX(id), 0) FROM loyalty_point_adjustments)
), CURRENT_TIMESTAMP;

INSERT INTO audit_logs (action, entity, details, table_name, record_id, new_value)
SELECT 'reset_data', 'system', json_object('section', 'loyalty', 'migration', '0251', 'checkpoint', json(value)),
  'system_flags', 'loyalty_points_reset', value
FROM system_flags WHERE key = 'loyalty_points_reset'
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs WHERE action = 'reset_data' AND entity = 'system'
      AND table_name = 'system_flags' AND record_id = 'loyalty_points_reset'
  );
