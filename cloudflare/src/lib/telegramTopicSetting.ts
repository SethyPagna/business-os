import { getDb } from './db'
import { audit, changedFields } from './audit'
import { bumpVersion } from './cache'
import { broadcast } from '../durable-objects/broadcastHub'
import { isTelegramTopicSettingValue, TELEGRAM_TOPIC_KEYS, type TelegramTopicWriter } from './telegram'
import type { Env } from '../index'

/**
 * The `/settopic` save (lib/telegram.ts topicCommandReply decides WHO may run
 * it; this is only HOW it is stored). It is a Settings save by another door,
 * so it does what `PUT /api/settings` does for these keys, in the same order:
 *   - the same value rule (isTelegramTopicSettingValue, shared with
 *     routes/settings.ts): digits for a topic, empty for the group (General)
 *     -- exactly what clearing the field in Settings stores;
 *   - the same upsert into the generic `settings` table, in one batch;
 *   - the same audit row (entity 'settings', the keys, field-level before and
 *     after), naming the Telegram sender because there is no app session;
 *   - the same `settings` cache-version bump and live broadcast, so an open
 *     Settings screen shows the new topic id instead of overwriting it with
 *     the old one on its next save.
 *
 * Kept out of lib/telegram.ts so that module stays loadable by the pure
 * report tests without the audit/cache/Durable Object imports; the webhook
 * route hands it in (routes/telegram.ts).
 */
export const saveTelegramTopicSetting: TelegramTopicWriter = async (env: Env, save) => {
  const value = save.threadId == null ? '' : String(save.threadId)
  if (!isTelegramTopicSettingValue(value)) throw new Error('Telegram topic ID must be a whole number, or empty for General.')
  const allowed = new Set<string>(TELEGRAM_TOPIC_KEYS)
  const keys = [...new Set(save.keys)].filter((key) => allowed.has(key))
  if (!keys.length) throw new Error('No Telegram topic setting named.')

  const db = getDb(env)
  // sql-bound-params: bounded by construction -- at most one per entry of the
  // fixed TELEGRAM_TOPIC_KEYS list, filtered above.
  const rows = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`)
    .all<{ key: string; value: string }>([...keys])
  const before: Record<string, unknown> = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  const after: Record<string, unknown> = Object.fromEntries(keys.map((key) => [key, value]))

  await db.batch(keys.map((key) => ({
    sql: `INSERT INTO settings (key, value, updated_at) VALUES (@key, @value, CURRENT_TIMESTAMP)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
    params: { key, value },
  })))

  await audit(env, null, save.actor, 'update', 'settings', null,
    { keys, source: 'telegram', command: '/settopic', telegram_user_id: save.telegramUserId || null, chat_id: save.chatId, thread_id: save.threadId },
    changedFields(before, after, { keys }))
  // Best effort, like the settings route's waitUntil: the value is saved; a
  // stale cache version expires on its own TTL.
  await Promise.allSettled([bumpVersion(env, 'settings'), broadcast(env, 'settings', { action: 'update', keys })])
}
