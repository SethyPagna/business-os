-- Who changed a Telegram topic setting, when, and through which door, for a topic that "changes by itself";
-- a row counts only when its field-level diff has a topic KEY, and no value or details column is selected.
-- ops:min-rows 0
-- ops:max-rows 50
SELECT id, created_at, user_name,
  CASE WHEN details LIKE '%"source":"telegram"%' THEN 'telegram-settopic'
       WHEN user_name = 'ops:settings-upsert' THEN 'ops-task'
       ELSE 'settings-save' END AS door
FROM audit_logs
WHERE entity = 'settings'
  AND (new_value GLOB '*[{,]"telegram_topic_*' OR old_value GLOB '*[{,]"telegram_topic_*')
ORDER BY id DESC
LIMIT 50
