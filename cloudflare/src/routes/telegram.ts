import { Hono } from 'hono'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission } from '../lib/permissions'
import { configureTelegramWebhook, getTelegramStatus, handleTelegramWebhook, isTelegramWebhookRequest, sendTelegramTest, sendTelegramTodaySummary } from '../lib/telegram'
import type { Env } from '../index'
import { actorSnapshot } from '../lib/actorSnapshot'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

// Telegram's webhook must be public: Telegram cannot present a Business OS
// session cookie. Its secret header is verified before parsing or replying;
// handleTelegramWebhook then applies the chat allow-list held in the
// `telegram_chat_id` setting (comma-separated), and answers an unapproved
// chat with a refusal that carries no shop data.
//
// There is deliberately NO per-USER check: a Telegram user id has no link to
// a Business OS account, so it would be a second list to keep by hand with no
// stronger guarantee than "which chat is this". The chat IS the boundary, so
// the approved chat must be an owner DM or a manager-only group -- never a
// staff-wide alerts group.
app.post('/webhook', async (c) => {
  if (!(await isTelegramWebhookRequest(c.env, c.req.header('X-Telegram-Bot-Api-Secret-Token')))) return c.json({ error: 'Unauthorized' }, 401)
  const update = await c.req.json().catch(() => null)
  if (update) await handleTelegramWebhook(c.env, update)
  return c.json({ ok: true })
})

app.use('*', requireAuth)
app.use('*', async (c, next) => {
  if (!hasPermission(c.get('user'), 'settings')) return c.json({ error: 'Settings permission is required' }, 403)
  await next()
})

app.get('/status', async (c) => c.json(await getTelegramStatus(c.env)))

app.post('/test', async (c) => {
  try {
    await sendTelegramTest(c.env)
    const user = c.get('user')
    await audit(c.env, user.id, actorSnapshot(user), 'test', 'telegram', null, { target: 'configured_chat' })
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Telegram test failed' }, 400)
  }
})

app.post('/today-summary', async (c) => {
  try {
    await sendTelegramTodaySummary(c.env)
    const user = c.get('user')
    await audit(c.env, user.id, actorSnapshot(user), 'send', 'telegram_summary', null, { range: 'today' })
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Telegram summary failed' }, 400)
  }
})

app.post('/connect-commands', async (c) => {
  try {
    await configureTelegramWebhook(c.env)
    const user = c.get('user')
    await audit(c.env, user.id, actorSnapshot(user), 'connect', 'telegram_webhook', null)
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Telegram commands could not be connected' }, 400)
  }
})

export default app
