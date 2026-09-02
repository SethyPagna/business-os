import { Hono } from 'hono'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { hasPermission } from '../lib/permissions'
import { configureTelegramWebhook, getTelegramStatus, handleTelegramWebhook, isTelegramWebhookRequest, sendTelegramTest, sendTelegramTodaySummary } from '../lib/telegram'
import type { Env } from '../index'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

// Telegram's webhook must be public: Telegram cannot present a Business OS
// session cookie. Its secret header is verified before parsing or replying;
// command handlers then apply the tighter manager-user AND manager-chat
// allowlists stored in Settings.
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
    await audit(c.env, user.id, user.name || user.username, 'test', 'telegram', null, { target: 'configured_chat' })
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Telegram test failed' }, 400)
  }
})

app.post('/today-summary', async (c) => {
  try {
    await sendTelegramTodaySummary(c.env)
    const user = c.get('user')
    await audit(c.env, user.id, user.name || user.username, 'send', 'telegram_summary', null, { range: 'today' })
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Telegram summary failed' }, 400)
  }
})

app.post('/connect-commands', async (c) => {
  try {
    await configureTelegramWebhook(c.env)
    const user = c.get('user')
    await audit(c.env, user.id, user.name || user.username, 'connect', 'telegram_webhook', null)
    return c.json({ success: true })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Telegram commands could not be connected' }, 400)
  }
})

export default app
