import { Hono } from 'hono'
import { requireAuth, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { isAdminControlUser } from '../lib/permissions'
import { getTelegramStatus, handleTelegramWebhook, isTelegramWebhookRequest, sendTelegramTest, sendTelegramTodaySummary, TelegramError } from '../lib/telegram'
import { connectTelegramCommands, registerTelegramCommandMenu, type MenuResult } from '../lib/telegramCommandMenu'
import { saveTelegramTopicSetting } from '../lib/telegramTopicSetting'
import type { Env } from '../index'
import { actorSnapshot } from '../lib/actorSnapshot'

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

function errorBody(error: unknown, fallback: string): { error: string; code?: string } {
  if (error instanceof TelegramError) return { error: error.message, code: error.code }
  return { error: error instanceof Error ? error.message : fallback }
}

function errorLabel(error: unknown): string {
  if (error instanceof TelegramError) return error.code
  return error instanceof Error ? error.name : 'unknown'
}

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
  // `/settopic` writes a setting; it is gated inside (alerts chat + group
  // admin) and stored through the settings-equivalent writer handed in here.
  if (update) {
    // Always 200: a non-2xx makes Telegram deliver the update again, and a /settopic whose save already
    // happened would run twice. The log names the error's code, never the update, a chat id or the token.
    try {
      await handleTelegramWebhook(c.env, update, { saveTopics: saveTelegramTopicSetting, waitUntil: (work) => c.executionCtx.waitUntil(work) })
    } catch (error) {
      console.warn(`[telegram] webhook update failed: ${errorLabel(error)}`)
    }
  }
  return c.json({ ok: true })
})

app.use('*', requireAuth)
// Settings shows Telegram to administrators only; the API matches it.
app.use('*', async (c, next) => {
  if (!isAdminControlUser(c.get('user'))) return c.json({ error: 'Administrator access required.' }, 403)
  await next()
})

app.get('/status', async (c) => c.json(await getTelegramStatus(c.env)))

app.post('/test', async (c) => {
  try {
    await sendTelegramTest(c.env)
  } catch (error) {
    return c.json(errorBody(error, 'Telegram test failed'), 400)
  }
  // The test message was sent: a menu that could not be set is a warning, not a failed test.
  const { menu } = await registerTelegramCommandMenu(c.env).catch((): MenuResult => ({ menu: 'failed', failed: ['alerts'] }))
  const user = c.get('user')
  await audit(c.env, user.id, actorSnapshot(user), 'test', 'telegram', null, { target: 'configured_chat', menu })
  return c.json({ success: true, menu })
})

app.post('/today-summary', async (c) => {
  try {
    await sendTelegramTodaySummary(c.env)
    const user = c.get('user')
    await audit(c.env, user.id, actorSnapshot(user), 'send', 'telegram_summary', null, { range: 'today' })
    return c.json({ success: true })
  } catch (error) {
    return c.json(errorBody(error, 'Telegram summary failed'), 400)
  }
})

app.post('/connect-commands', async (c) => {
  let result: MenuResult
  try {
    result = await connectTelegramCommands(c.env)
  } catch (error) {
    return c.json(errorBody(error, 'Telegram commands could not be connected'), 400)
  }
  const user = c.get('user')
  await audit(c.env, user.id, actorSnapshot(user), 'connect', 'telegram_webhook', null, { menu: result.menu, failed: result.failed })
  if (result.menu === 'failed') return c.json({ error: 'Telegram did not accept the command menu for the alerts chat.', code: 'telegram_menu_failed' }, 400)
  return c.json({ success: true, menu: result.menu })
})

export default app
