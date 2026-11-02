-- d1-usage-mix-14d: stock movements per Cambodia day and type over 14 days,
-- plus one summary row (type '~summary') of devices seen in the last day and
-- Inventory Check sessions in 14 days. Sizes the Free read budget. Counts only.
-- ops:min-rows 1
-- ops:max-rows-read 3094
SELECT date(created_at, '+7 hours') AS d, movement_type AS kind, COUNT(*) AS n
FROM inventory_movements
WHERE created_at >= datetime('now', '-14 days')
GROUP BY d, kind
UNION ALL
SELECT 'last-1d', '~summary-devices', COUNT(*)
FROM user_sessions
WHERE revoked_at IS NULL AND expires_at > datetime('now')
  AND last_seen_at > datetime('now', '-1 day')
UNION ALL
SELECT 'last-14d', '~summary-inventory-checks', COUNT(*)
FROM inventory_check_sessions
WHERE started_at >= datetime('now', '-14 days')
ORDER BY 1, 2;
