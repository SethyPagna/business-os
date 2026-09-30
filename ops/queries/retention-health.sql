-- retention-health: are the scheduled clean-ups (index.ts scheduled()) running
-- and keeping up? For each retained table: when its sweep last ran, and the
-- oldest row it still holds, next to the window the code promises
-- (lib/audit.ts 21d default, lib/importRetention.ts, lib/ephemeralRetention.ts).
-- An oldest row far past its window means that sweep is stalled (action_history
-- past 180d is the known FK stall, KNOWN-90).
-- Timestamps only, no counts of business rows. One row, scalar sub-queries.
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT value FROM settings WHERE key = 'audit_log_retention_last_run') AS audit_last_run,
  (SELECT value FROM settings WHERE key = 'audit_log_retention_days') AS audit_days_setting,
  (SELECT MIN(created_at) FROM audit_logs) AS audit_oldest,
  (SELECT value FROM settings WHERE key = 'import_retention_last_run') AS import_last_run,
  (SELECT value FROM settings WHERE key = 'import_summary_retention_days') AS import_summary_days_setting,
  (SELECT MIN(created_at) FROM import_jobs WHERE status IN ('completed', 'completed_with_errors', 'failed', 'cancelled')) AS import_terminal_oldest,
  (SELECT COUNT(*) FROM import_jobs WHERE status IN ('completed', 'completed_with_errors', 'failed', 'cancelled') AND details_pruned_at IS NULL AND COALESCE(finished_at, updated_at) < datetime('now', '-2 days')) AS import_unpruned_over_2d,
  (SELECT value FROM settings WHERE key = 'ephemeral_retention_last_run') AS ephemeral_last_run,
  (SELECT MIN(created_at) FROM rate_limit_events) AS rate_limit_oldest,
  (SELECT MIN(created_at) FROM verification_codes) AS verification_oldest,
  (SELECT MIN(created_at) FROM ai_response_logs) AS ai_log_oldest,
  (SELECT MIN(created_at) FROM action_history) AS action_history_oldest,
  (SELECT COUNT(*) FROM action_history WHERE created_at < datetime('now', '-180 days')) AS action_history_past_window,
  (SELECT MIN(created_at) FROM user_sessions WHERE revoked_at IS NOT NULL OR expires_at < datetime('now')) AS dead_user_session_oldest,
  (SELECT MIN(created_at) FROM portal_sessions WHERE revoked_at IS NOT NULL OR expires_at < datetime('now')) AS dead_portal_session_oldest,
  (SELECT MIN(revoked_at) FROM trusted_devices WHERE revoked_at IS NOT NULL) AS revoked_device_oldest,
  (SELECT MIN(updated_at) FROM login_lockouts) AS login_lockout_oldest,
  (SELECT last_run_at FROM image_audit_state WHERE id = 1) AS image_audit_last_run;
