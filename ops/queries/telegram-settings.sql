-- Telegram delivery settings (owner report: messages not landing in forum
-- topics). Non-secret keys only: the bot token is never selected. Values stay
-- in the encrypted file.
-- ops:min-rows 0
SELECT key, value, updated_at FROM settings
WHERE key IN (
  'telegram_automation_enabled', 'telegram_chat_id', 'telegram_language',
  'telegram_sales_enabled', 'telegram_status_enabled', 'telegram_returns_enabled', 'telegram_fees_enabled',
  'telegram_stock_in_enabled', 'telegram_stock_out_enabled', 'telegram_shift_overview_enabled',
  'telegram_summary_sales_enabled', 'telegram_summary_cashiers_enabled', 'telegram_summary_products_enabled',
  'telegram_summary_returns_enabled', 'telegram_summary_expenses_enabled', 'telegram_summary_compare_enabled',
  'telegram_topic_shift', 'telegram_topic_sales', 'telegram_topic_status', 'telegram_topic_returns',
  'telegram_topic_expenses', 'telegram_topic_stock', 'telegram_topic_reports', 'telegram_topic_alerts'
)
ORDER BY key
