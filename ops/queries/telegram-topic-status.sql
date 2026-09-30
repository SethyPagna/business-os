-- Telegram set-up of this deployment as flags and counts only (no topic id, chat id or token selected);
-- each flag must decide exactly as lib/telegram.ts does, pinned by test-ops-telegram-topic-queries-pure.cjs.
-- ops:min-rows 1
-- ops:max-rows 1
WITH ws(chars) AS (
  SELECT char(9, 10, 11, 12, 13, 32, 160, 5760, 8192, 8193, 8194, 8195, 8196, 8197, 8198, 8199, 8200, 8201, 8202, 8232, 8233, 8239, 8287, 12288, 65279)
), t AS (
  SELECT s.key, TRIM(COALESCE(CAST(s.value AS TEXT), ''), ws.chars) AS v
  FROM settings AS s, ws
  WHERE s.key IN (
    'telegram_topic_shift', 'telegram_topic_sales', 'telegram_topic_status', 'telegram_topic_returns',
    'telegram_topic_expenses', 'telegram_topic_stock', 'telegram_topic_reports', 'telegram_topic_alerts'
  )
), topic AS (
  SELECT key, (v <> '' AND v NOT GLOB '*[^0-9]*' AND CAST(v AS INTEGER) BETWEEN 1 AND 9007199254740991) AS is_set
  FROM t
), walk(pos, token, done, rest) AS (
  SELECT 0, '', NULL,
    replace(replace(COALESCE((SELECT CAST(value AS TEXT) FROM settings WHERE key = 'telegram_chat_id'), ''), '<', ''), '>', '') || ','
  UNION ALL
  SELECT pos + 1,
    CASE WHEN instr((SELECT chars FROM ws) || ',;', substr(rest, 1, 1)) > 0 THEN '' ELSE token || substr(rest, 1, 1) END,
    CASE WHEN instr((SELECT chars FROM ws) || ',;', substr(rest, 1, 1)) > 0 THEN token ELSE NULL END,
    substr(rest, 2)
  FROM walk
  WHERE rest <> ''
), kept AS (
  SELECT pos, substr(done, 1, 40) AS entry
  FROM walk
  WHERE done IS NOT NULL AND done <> ''
), valid AS (
  SELECT pos, entry
  FROM kept
  WHERE (entry GLOB '[0-9]*' OR entry GLOB '-[0-9]*') AND substr(entry, 2) NOT GLOB '*[^0-9]*'
)
SELECT
  (SELECT COUNT(*) > 0 FROM valid) AS chat_configured,
  COALESCE((SELECT entry GLOB '-*' FROM valid ORDER BY pos LIMIT 1), 0) AS alerts_chat_is_group,
  (SELECT COUNT(*) FROM valid) AS approved_chats,
  COALESCE((SELECT is_set FROM topic WHERE key = 'telegram_topic_shift'), 0) AS topic_shift,
  COALESCE((SELECT is_set FROM topic WHERE key = 'telegram_topic_sales'), 0) AS topic_sales,
  COALESCE((SELECT is_set FROM topic WHERE key = 'telegram_topic_status'), 0) AS topic_status,
  COALESCE((SELECT is_set FROM topic WHERE key = 'telegram_topic_returns'), 0) AS topic_returns,
  COALESCE((SELECT is_set FROM topic WHERE key = 'telegram_topic_expenses'), 0) AS topic_expenses,
  COALESCE((SELECT is_set FROM topic WHERE key = 'telegram_topic_stock'), 0) AS topic_stock,
  COALESCE((SELECT is_set FROM topic WHERE key = 'telegram_topic_reports'), 0) AS topic_reports,
  COALESCE((SELECT is_set FROM topic WHERE key = 'telegram_topic_alerts'), 0) AS topic_alerts
