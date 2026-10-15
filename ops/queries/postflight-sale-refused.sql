-- Release 2e postflight, review checklist item 5: refused sale creations.
-- READ-ONLY: one row of counts, no reasons, receipts, names or free text.
-- audit_logs rows with action = 'sale_refused' (entity sale_creation, written
-- by routes/sales.ts; a repeat of the same refusal inside the collapse window
-- bumps details.count on one row instead of adding a row).
--   refused_rows_total / refused_rows_since_2e   audit rows, all time / at or
--       after 2026-10-14T15:33:00Z (audit_logs.created_at is UTC 'YYYY-MM-DD HH:MM:SS')
--   refused_attempts_total / _since_2e   the same rows weighted by details.count
--       (a row with no count is one attempt)
--   sales_created_since_2e   sales rows created at or after the same instant
--       (sales.created_at normalised to UTC; ISO and 'YYYY-MM-DD HH:MM:SS' forms)
--   checked_at_utc           when this ran
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(*) FROM audit_logs WHERE action = 'sale_refused') AS refused_rows_total,
  (SELECT COUNT(*) FROM audit_logs WHERE action = 'sale_refused' AND created_at >= '2026-10-14 15:33:00') AS refused_rows_since_2e,
  (SELECT COALESCE(SUM(CASE WHEN json_valid(details) THEN COALESCE(json_extract(details, '$.count'), 1) ELSE 1 END), 0)
    FROM audit_logs WHERE action = 'sale_refused') AS refused_attempts_total,
  (SELECT COALESCE(SUM(CASE WHEN json_valid(details) THEN COALESCE(json_extract(details, '$.count'), 1) ELSE 1 END), 0)
    FROM audit_logs WHERE action = 'sale_refused' AND created_at >= '2026-10-14 15:33:00') AS refused_attempts_since_2e,
  (SELECT COUNT(*) FROM sales
    WHERE COALESCE(strftime('%Y-%m-%d %H:%M:%S', created_at), created_at) >= '2026-10-14 15:33:00') AS sales_created_since_2e,
  datetime('now') AS checked_at_utc
