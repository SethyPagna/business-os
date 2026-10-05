import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import type { SessionUser } from '../lib/auth'
import { checkRateLimit, getClientNetworkKey } from '../lib/rateLimit'
import { portalAbuseKey } from '../lib/portalAbuseKey'
import { requireJsonSameOriginCredentialPost } from '../lib/requestBodyGuard'
import { consentGiven, loadPortalMemberView, PORTAL_CONSENT_VERSION } from '../lib/portalAccounts'
import { createPortalSession, getPortalAccountState, setPortalCookie } from '../lib/portalSession'
import {
  checkPortalTelegramAttachPassword,
  createPortalTelegramChallenge,
  handlePortalTelegramUpdate,
  isPortalTelegramBrowserToken,
  isPortalTelegramWebhookRequest,
  mintPortalTelegramBrowserToken,
  pollPortalTelegramChallenge,
  portalTelegramEnabled,
  portalTelegramMethods,
  PORTAL_TELEGRAM_CHALLENGE_TTL_MS,
} from '../lib/portalTelegram'
import type { Env } from '../index'

// Telegram sign-in for website members (lib/portalTelegram.ts has the flow).
// index.ts mounts it at /api/portal, so every path here is under /api/portal/
// and is reachable on the storefront host (lib/publicHostGate.ts) as well as
// the admin host. The staff bot's webhook (/api/telegram/webhook,
// routes/telegram.ts) is a different route with a different secret and is
// not touched by anything here.

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()

// The browser binding. httpOnly so page script never sees it, Strict and
// scoped to these routes so no other request carries it.
const BROWSER_COOKIE = 'bos_portal_tg'
const BROWSER_COOKIE_PATH = '/api/portal/auth/telegram'
const BROWSER_COOKIE_MAX_AGE_SECONDS = Math.round(PORTAL_TELEGRAM_CHALLENGE_TTL_MS / 1000) + 5 * 60

// Per network: each start writes one row. Twenty per 15 minutes is far above
// what a family behind one router needs and far below a flood.
export const PORTAL_TELEGRAM_START_MAX = 20
export const PORTAL_TELEGRAM_START_WINDOW_MS = 15 * 60 * 1000
// Per account: the attach start carries a password check.
export const PORTAL_TELEGRAM_ATTACH_MAX = 5
export const PORTAL_TELEGRAM_ATTACH_WINDOW_MS = 15 * 60 * 1000

const UNAVAILABLE = { error: 'Telegram sign-in is not available right now.', code: 'telegram_unavailable' }
const CONSENT_REQUIRED_KEY = 'portal_consent_required'

// The customer bot's webhook. Refused before the body is parsed or anything
// is read from D1 when the secret header is missing or wrong (or the Worker
// has no secret, or the secret is derived from a bot token); index.ts only
// bounds the body to 64 KB first (lib/requestBodyGuard.ts). It is exempt from
// the storefront's JSON + same-origin rule: it is server to server and the
// secret header is its authentication. After that it always answers 200: a
// non-2xx makes Telegram deliver the update again. The bot's reply rides in
// the response body, so no request leaves the Worker.
app.post('/telegram/webhook', async (c) => {
  if (!(await isPortalTelegramWebhookRequest(c.env, c.req.header('X-Telegram-Bot-Api-Secret-Token')))) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const update = await c.req.json().catch(() => null)
  try {
    const answer = await handlePortalTelegramUpdate(c.env, update)
    if (answer) return c.json(answer)
  } catch (error) {
    // The code only: never the update, a phone, a chat id or a token.
    console.warn(`[portal-telegram] update failed: ${error instanceof Error ? error.name : 'unknown'}`)
  }
  return c.json({ ok: true })
})

// Whether to show "Continue with Telegram": on once the owner has set
// PORTAL_TELEGRAM_WEBHOOK_SECRET. Env only, no D1; the browser may keep it a minute.
// G38 E5 (login CSRF): start and poll sign a browser in, so they are
// same-origin JSON only (415 credential_json_required, 403
// credential_origin_refused), exactly like the portal's own /auth/* writes.
// Registered before the handlers; GETs pass. The webhook above is not under
// /auth: Telegram sends neither header, and its secret is its authentication.
app.use('/auth/*', requireJsonSameOriginCredentialPost)

app.get('/auth/telegram/status', (c) => {
  c.header('Cache-Control', 'public, max-age=60')
  return c.json({ available: portalTelegramEnabled(c.env) })
})

app.post('/auth/telegram/start', async (c) => {
  c.header('Cache-Control', 'no-store')
  if (!portalTelegramEnabled(c.env)) return c.json(UNAVAILABLE, 503)
  const ipKey = await portalAbuseKey(c.env, 'portal:telegram:start', getClientNetworkKey(c.req.raw))
  if (!ipKey) return c.json({ error: 'Portal privacy protection is not configured.', code: 'portal_privacy_unavailable' }, 503)
  const window = await checkRateLimit(c.env, 'portal:telegram:start', ipKey, PORTAL_TELEGRAM_START_MAX, PORTAL_TELEGRAM_START_WINDOW_MS)
  if (!window.allowed) {
    c.header('Retry-After', String(window.retryAfterSeconds))
    return c.json({ error: `Too many attempts. Try again in ${window.retryAfterSeconds} seconds.`, code: 'rate_limited' }, 429)
  }
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const purpose = body.mode === 'attach' ? 'attach' : 'signin'
  const locale = body.locale === 'en' ? 'en' : 'km'
  let accountId: number | null = null

  if (purpose === 'attach') {
    // Connecting Telegram to an existing account: signed in here, AND the
    // password typed again now. A phone match alone never joins accounts.
    const state = await getPortalAccountState(c)
    if (state.status === 'reconsent_required') {
      return c.json({ error: 'Please agree to the current policies to continue.', code: CONSENT_REQUIRED_KEY, consentVersion: PORTAL_CONSENT_VERSION }, 428)
    }
    if (!state.account) return c.json({ error: 'Not signed in', code: 'portal_unauthenticated' }, 401)
    const attempts = await checkRateLimit(c.env, 'portal:telegram:attach', `account:${state.account.id}`, PORTAL_TELEGRAM_ATTACH_MAX, PORTAL_TELEGRAM_ATTACH_WINDOW_MS)
    if (!attempts.allowed) {
      c.header('Retry-After', String(attempts.retryAfterSeconds))
      return c.json({ error: `Too many attempts. Try again in ${attempts.retryAfterSeconds} seconds.`, code: 'rate_limited' }, 429)
    }
    const check = await checkPortalTelegramAttachPassword(c.env, state.account.id, body.password)
    if (!check.ok) return c.json({ error: check.error, code: check.code }, check.status)
    accountId = state.account.id
  } else if (!consentGiven(body.consent)) {
    return c.json({ error: 'Please agree to the Terms & Conditions and the Privacy Policy to continue.', code: 'consent_required' }, 400)
  }

  // One binding per browser, reused across tabs while it lives.
  const existing = getCookie(c, BROWSER_COOKIE)
  const browserToken = isPortalTelegramBrowserToken(existing) ? existing : mintPortalTelegramBrowserToken()
  const challenge = await createPortalTelegramChallenge(c.env, {
    browserToken,
    purpose,
    accountId,
    locale,
    consentLocale: purpose === 'signin' ? String(body.consentLocale || locale).slice(0, 16) : null,
  })
  setCookie(c, BROWSER_COOKIE, browserToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: BROWSER_COOKIE_PATH,
    maxAge: BROWSER_COOKIE_MAX_AGE_SECONDS,
  })
  return c.json({ ok: true, nonce: challenge.nonce, link: challenge.link, expiresInSeconds: challenge.expiresInSeconds })
})

// Cheap while waiting: one indexed read. The storefront polls with backoff
// for about two minutes and again when the tab becomes visible.
app.post('/auth/telegram/poll', async (c) => {
  c.header('Cache-Control', 'no-store')
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const result = await pollPortalTelegramChallenge(c.env, {
    nonce: body.nonce,
    browserToken: getCookie(c, BROWSER_COOKIE),
    sessionAccountId: async () => {
      const state = await getPortalAccountState(c)
      return state.account ? state.account.id : null
    },
  })
  if (!result.ok) return c.json({ error: result.error, code: result.code }, result.status)
  if (result.kind === 'waiting') return c.json({ status: 'waiting', stage: result.stage })
  if (result.kind === 'attached') {
    return c.json({ status: 'attached', account: await loadPortalMemberView(c.env, result.accountId) })
  }
  const session = await createPortalSession(c.env, result.accountId)
  setPortalCookie(c, session.token, session.expiresAt)
  return c.json({ status: 'signed_in', created: result.created, account: await loadPortalMemberView(c.env, result.accountId) })
})

// The profile's "Sign-in methods": whether Telegram is connected, and whether
// this account can connect it (it has a phone and a password to re-check).
app.get('/account/telegram', async (c) => {
  c.header('Cache-Control', 'no-store')
  const state = await getPortalAccountState(c)
  if (state.status === 'reconsent_required') {
    return c.json({ error: 'Please agree to the current policies to continue.', code: CONSENT_REQUIRED_KEY, consentVersion: PORTAL_CONSENT_VERSION }, 428)
  }
  if (!state.account) return c.json({ error: 'Not signed in', code: 'portal_unauthenticated' }, 401)
  const methods = await portalTelegramMethods(c.env, state.account.id)
  return c.json({ available: portalTelegramEnabled(c.env), connected: methods.telegram, canConnect: methods.password && !methods.telegram })
})

export default app
