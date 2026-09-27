-- Deploy pre-check: is the shop still trading? The close time varies (always
-- after 20:00 Cambodia), so a release waits until open_today is 0. One row of
-- counts and timestamps only: no names, cash or notes.
-- ops:min-rows 1
-- ops:max-rows 1
SELECT
  (SELECT COUNT(*) FROM shift_sessions
    WHERE closed_at IS NULL AND cancelled_at IS NULL
      AND business_date = date('now', '+7 hours')) AS open_today,
  (SELECT COUNT(*) FROM shift_sessions
    WHERE closed_at IS NULL AND cancelled_at IS NULL
      AND business_date < date('now', '+7 hours')) AS open_older,
  (SELECT MAX(opened_at) FROM shift_sessions
    WHERE closed_at IS NULL AND cancelled_at IS NULL) AS newest_open_at,
  (SELECT MAX(COALESCE(strftime('%Y-%m-%d %H:%M:%S', closed_at), closed_at))
    FROM shift_sessions) AS last_closed_at,
  (SELECT MAX(COALESCE(strftime('%Y-%m-%d %H:%M:%S', created_at), created_at))
    FROM sales) AS last_sale_at,
  datetime('now') AS checked_at_utc
