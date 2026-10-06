import { getDb } from './db'
import { canonicalizePhone } from './phone'
import { checkRateLimit, sqliteUtcTimestamp } from './rateLimit'
import { portalAbuseKey } from './portalAbuseKey'
import { isMemberCodeCollision, mintMemberCode } from './memberCode'
import { PORTAL_CONSENT_VERSION } from './portalAccounts'
import { verifyPassword } from './passwordHash'
import { customerIsProfileSql, isAnonymousCustomer } from './anonymousCustomer'
import type { Env } from '../index'

// Website member sign-in and sign-up through Telegram, with a PROVEN phone
// (G38 Telegram lane, owner rules of 6 Oct 2026).
//
// The Telegram Login Widget does not give the phone, so the proof comes from
// the customer bot (@LeangCosmeticsBot, its own token PORTAL_TELEGRAM_BOT_TOKEN,
// never the staff alerts bot):
//   1. The website asks the Worker to start. The Worker mints a single-use
//      nonce, stores only its SHA-256, binds it to the browser through the
//      httpOnly cookie bos_portal_tg (also stored as a SHA-256 only), and
//      returns the deep link t.me/<bot>?start=<nonce>.
//   2. The member taps Start. Telegram calls the webhook below with
//      X-Telegram-Bot-Api-Secret-Token = PORTAL_TELEGRAM_WEBHOOK_SECRET. The
//      nonce is bound to that Telegram user, and the bot answers with one
//      request_contact button.
//   3. The shared contact is accepted ONLY when message.contact.user_id equals
//      message.from.id. That equality is the whole phone proof: Telegram sets
//      contact.user_id to the sender's own id only when they share their own
//      contact; a forwarded card, somebody else's contact or a typed number
//      fails it ("cannot pretend otherwise", owner 6 Oct).
//   4. The website polls with the nonce. Only the browser holding the cookie
//      can finish, exactly once: it signs in the member who owns that Telegram
//      identity, or creates a new W- member with the proven phone. It never
//      links to an in-store customer (staff-only, G38 Phase 1) and never takes
//      over an existing phone + password account: that one must sign in with
//      its password first and connect Telegram from inside (purpose 'attach').
//
// Free plan (10 ms CPU, few subrequests): the bot's reply is returned IN the
// webhook response (Telegram executes a `method` object it receives as the
// answer), so the Worker makes no outbound call at all. Hashing is SHA-256 /
// HMAC only; the one password check (attach) is the existing sign-in cost.

export const PORTAL_TELEGRAM_CHALLENGE_TTL_MS = 10 * 60 * 1000
export const PORTAL_TELEGRAM_DEFAULT_BOT_USERNAME = 'LeangCosmeticsBot'
// Telegram accepts 1-256 characters of A-Z a-z 0-9 _ - as a secret_token. We
// require at least 32 so the header cannot be guessed.
export const PORTAL_TELEGRAM_SECRET_PATTERN = /^[A-Za-z0-9_-]{32,256}$/
// Per Telegram user: /start, contacts and stray messages together.
export const PORTAL_TELEGRAM_USER_MAX = 20
export const PORTAL_TELEGRAM_USER_WINDOW_MS = 15 * 60 * 1000
// A deep-link start parameter allows 1-64 of A-Z a-z 0-9 _ -.
const NONCE_BYTES = 24 // 32 base64url characters
const NONCE_PATTERN = /^[A-Za-z0-9_-]{32}$/
const BROWSER_TOKEN_BYTES = 32 // 43 base64url characters
const BROWSER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const NAME_MAX = 80

type PortalTelegramEnv = {
  PORTAL_TELEGRAM_BOT_TOKEN?: string
  PORTAL_TELEGRAM_WEBHOOK_SECRET?: string
  PORTAL_TELEGRAM_BOT_USERNAME?: string
  TELEGRAM_BOT_TOKEN?: string
  BUSINESS_OS_PUBLIC_URL?: string
}

export type PortalTelegramPurpose = 'signin' | 'attach'
export type PortalTelegramLocale = 'en' | 'km'

function bytesToBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBase64Url(byteCount: number): string {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return bytesToBase64Url(bytes)
}

export async function portalTelegramSha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Compares every character whatever the input; no early exit on a mismatch.
function sameText(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let different = 0
  for (let index = 0; index < left.length; index += 1) different |= left.charCodeAt(index) ^ right.charCodeAt(index)
  return different === 0
}

export function mintPortalTelegramNonce(): string { return randomBase64Url(NONCE_BYTES) }
export function mintPortalTelegramBrowserToken(): string { return randomBase64Url(BROWSER_TOKEN_BYTES) }
export function isPortalTelegramNonce(value: unknown): value is string { return typeof value === 'string' && NONCE_PATTERN.test(value) }
export function isPortalTelegramBrowserToken(value: unknown): value is string { return typeof value === 'string' && BROWSER_TOKEN_PATTERN.test(value) }

export function portalTelegramBotUsername(env: unknown): string {
  const configured = String((env as PortalTelegramEnv)?.PORTAL_TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '')
  return /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(configured) ? configured : PORTAL_TELEGRAM_DEFAULT_BOT_USERNAME
}

export function portalTelegramDeepLink(env: unknown, nonce: string): string {
  return `https://t.me/${portalTelegramBotUsername(env)}?start=${nonce}`
}

function configuredSecret(env: unknown): string | null {
  const secret = String((env as PortalTelegramEnv)?.PORTAL_TELEGRAM_WEBHOOK_SECRET || '').trim()
  return PORTAL_TELEGRAM_SECRET_PATTERN.test(secret) ? secret : null
}

/** Telegram sign-in is offered only once the owner has set the webhook secret. */
export function portalTelegramEnabled(env: unknown): boolean {
  return configuredSecret(env) !== null
}

// The customer bot's webhook. Its secret is a value of its own: it must never
// be derived from a bot token the way the staff bot's is (sha256-hex of
// TELEGRAM_BOT_TOKEN, lib/telegram.ts), so knowing or deriving either token
// opens nothing here (design §3.1 S11, Phase 3 acceptance). A secret that
// equals a token or the sha256-hex of one is treated as not configured.
export async function isPortalTelegramWebhookRequest(env: unknown, supplied: string | undefined | null): Promise<boolean> {
  const expected = configuredSecret(env)
  if (!expected) return false
  for (const token of [(env as PortalTelegramEnv)?.PORTAL_TELEGRAM_BOT_TOKEN, (env as PortalTelegramEnv)?.TELEGRAM_BOT_TOKEN]) {
    const value = String(token || '').trim()
    if (value && (expected === value || expected === await portalTelegramSha256Hex(value))) return false
  }
  return sameText(expected, String(supplied ?? ''))
}

function nowStamp(now: number): string { return sqliteUtcTimestamp(now) }

// ---------------------------------------------------------------------------
// 1. The website starts.

export type PortalTelegramChallengeStart = { nonce: string; link: string; expiresInSeconds: number }

export async function createPortalTelegramChallenge(env: Env, input: {
  browserToken: string
  purpose: PortalTelegramPurpose
  accountId: number | null
  locale: PortalTelegramLocale
  consentLocale: string | null
  now?: number
}): Promise<PortalTelegramChallengeStart> {
  const now = input.now ?? Date.now()
  const nonce = mintPortalTelegramNonce()
  await getDb(env).prepare(`
    INSERT INTO portal_telegram_challenges (nonce_hash, browser_hash, purpose, account_id, locale, consent_locale, status, expires_at)
    VALUES (@nonce_hash, @browser_hash, @purpose, @account_id, @locale, @consent_locale, 'pending', @expires_at)
  `).run({
    nonce_hash: await portalTelegramSha256Hex(nonce),
    browser_hash: await portalTelegramSha256Hex(input.browserToken),
    purpose: input.purpose,
    account_id: input.purpose === 'attach' ? input.accountId : null,
    locale: input.locale,
    consent_locale: input.consentLocale,
    expires_at: nowStamp(now + PORTAL_TELEGRAM_CHALLENGE_TTL_MS),
  })
  return { nonce, link: portalTelegramDeepLink(env, nonce), expiresInSeconds: Math.round(PORTAL_TELEGRAM_CHALLENGE_TTL_MS / 1000) }
}

export type PortalTelegramRefusal = { ok: false; status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 503; code: string; error: string }

const refuse = (status: PortalTelegramRefusal['status'], code: string, error: string): PortalTelegramRefusal => ({ ok: false, status, code, error })

// The fresh password check that must precede connecting Telegram to an
// existing phone + password account (owner rule: no takeover by a phone
// match). Called with the signed-in member's own account id only.
export async function checkPortalTelegramAttachPassword(env: Env, accountId: number, password: unknown): Promise<{ ok: true } | PortalTelegramRefusal> {
  const db = getDb(env)
  const account = await db.prepare(`
    SELECT a.password_hash, a.phone,
      EXISTS (SELECT 1 FROM portal_login_identities i WHERE i.account_id = a.id AND i.provider = 'telegram') AS has_telegram
    FROM portal_accounts a WHERE a.id = @id AND a.status = 'active' LIMIT 1
  `).get<{ password_hash: string | null; phone: string | null; has_telegram: number }>({ id: accountId })
  if (!account) return refuse(401, 'portal_unauthenticated', 'Not signed in')
  if (Number(account.has_telegram) === 1) return refuse(409, 'telegram_already_attached', 'This account is already connected to Telegram.')
  if (!account.password_hash || !account.phone) return refuse(409, 'telegram_attach_unavailable', 'This account cannot connect Telegram this way. Please contact us.')
  const text = String(password ?? '')
  if (!text) return refuse(400, 'password_required', 'Please enter your password.')
  const verdict = await verifyPassword(text, account.password_hash, env)
  if (!verdict.ok) return refuse(401, 'invalid_credentials', 'The password is not correct.')
  return { ok: true }
}

// ---------------------------------------------------------------------------
// 2-3. The bot webhook.

type TelegramUser = { id?: unknown; is_bot?: unknown; first_name?: unknown; last_name?: unknown }
type TelegramContact = { user_id?: unknown; phone_number?: unknown; first_name?: unknown; last_name?: unknown }
type TelegramMessage = { chat?: { id?: unknown; type?: unknown }; from?: TelegramUser; text?: unknown; contact?: TelegramContact }
export type PortalTelegramUpdate = { message?: TelegramMessage } | null | undefined

export type PortalTelegramReply = {
  method: 'sendMessage'
  chat_id: string
  text: string
  reply_markup: Record<string, unknown>
}

function telegramUserId(value: unknown): string | null {
  const number = typeof value === 'string' && /^\d{1,16}$/.test(value) ? Number(value) : value
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 ? String(number) : null
}

// Control characters, zero-width and bidi overrides: a name is shown to staff.
const INVISIBLE_OR_CONTROL = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g

function cleanName(...parts: unknown[]): string {
  return parts
    .map((part) => String(part ?? ''))
    .join(' ')
    .replace(INVISIBLE_OR_CONTROL, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
}

type BotText = Record<PortalTelegramLocale, string>
// Customer-facing words say "Leang Cosmetics" (owner rule). KM first: the
// storefront's default language.
const BOT_TEXT = {
  welcome: {
    km: 'សួស្តីពី Leang Cosmetics។ ដើម្បីចូលគណនីលើគេហទំព័ររបស់យើង សូមបើក {site} ចុច "គណនី" រួចចុច "បន្តជាមួយ Telegram"។',
    en: 'Hello from Leang Cosmetics. To sign in to our website, open {site}, tap "Account", then "Continue with Telegram".',
  },
  linkDead: {
    km: 'តំណចូលគណនីនេះផុតកំណត់ ឬត្រូវបានប្រើរួចហើយ។ សូមចាប់ផ្តើមម្តងទៀតនៅលើគេហទំព័រ។',
    en: 'This sign-in link has expired or was already used. Please start again on the website.',
  },
  // Owner ruling, 6 Oct 2026 ("warn + short link", wording revised the same
  // day to name the button): the relay warning, word for word, in EN and KM,
  // ahead of every share-phone request. The website shows the SAME text while
  // it waits (frontend pack key portal_telegram_warning); the signin test
  // fails if the two ever differ.
  relayWarning: {
    km: 'សូមចែករំលែកលេខរបស់អ្នកជាមួយបូតរបស់យើង លុះត្រាតែអ្នកទើបតែបានចុច "បន្តជាមួយ Telegram" នៅលើ leangbeauty.com។ យើងនឹងមិនដែលសុំឱ្យអ្នកចែករំលែកវា ដោយហេតុផលផ្សេងទៀតឡើយ។',
    en: 'Only share your number with our bot if you just pressed Continue with Telegram on leangbeauty.com. We will never ask you to share it for any other reason.',
  },
  askContact: {
    km: 'ការចូលគណនីគេហទំព័រ Leang Cosmetics។\nសូមចុច "ចែករំលែកលេខទូរស័ព្ទរបស់ខ្ញុំ" ខាងក្រោម ដើម្បីបញ្ជាក់ថានេះជាលេខរបស់អ្នក។ យើងប្រើវាសម្រាប់តែគណនីគេហទំព័ររបស់អ្នកប៉ុណ្ណោះ។',
    en: 'Leang Cosmetics website sign-in.\nTap "Share my phone number" below to confirm this is your number. We use it only for your website account.',
  },
  shareButton: {
    km: 'ចែករំលែកលេខទូរស័ព្ទរបស់ខ្ញុំ',
    en: 'Share my phone number',
  },
  ownContactOnly: {
    km: 'សូមចុចប៊ូតុង "ចែករំលែកលេខទូរស័ព្ទរបស់ខ្ញុំ"។ យើងទទួលយកតែលេខ Telegram ផ្ទាល់ខ្លួនរបស់អ្នកប៉ុណ្ណោះ។ លេខដែលបានបញ្ជូនបន្ត ឬវាយបញ្ចូល មិនអាចប្រើបានទេ។',
    en: 'Please tap the "Share my phone number" button. Only your own Telegram number is accepted; a forwarded or typed contact cannot be used.',
  },
  nothingWaiting: {
    km: 'មិនមានការចូលគណនីគេហទំព័រកំពុងរង់ចាំទេ។ សូមចាប់ផ្តើមម្តងទៀតនៅលើគេហទំព័រ។',
    en: 'No website sign-in is waiting. Please start again on the website.',
  },
  phoneUnreadable: {
    km: 'យើងមិនអាចអានលេខទូរស័ព្ទនោះបានទេ។ សូមចាប់ផ្តើមម្តងទៀតនៅលើគេហទំព័រ។',
    en: 'We could not read that phone number. Please start again on the website.',
  },
  done: {
    km: 'សូមអរគុណ។ លេខទូរស័ព្ទរបស់អ្នកត្រូវបានបញ្ជាក់។ សូមត្រឡប់ទៅគេហទំព័រវិញ ដើម្បីបញ្ចប់ការចូលគណនី។',
    en: 'Thank you. Your phone number is confirmed. Go back to the website to finish signing in.',
  },
  tooMany: {
    km: 'សារច្រើនពេក។ សូមរង់ចាំប៉ុន្មាននាទី រួចព្យាយាមម្តងទៀត។',
    en: 'Too many messages. Please wait a few minutes and try again.',
  },
} satisfies Record<string, BotText>

function siteName(env: unknown): string {
  try {
    const host = new URL(String((env as PortalTelegramEnv)?.BUSINESS_OS_PUBLIC_URL || '')).hostname
    if (host) return host
  } catch { /* fall through */ }
  return 'leangbeauty.com'
}

function botText(env: unknown, text: BotText, locale: PortalTelegramLocale | 'both'): string {
  const site = siteName(env)
  const pick = locale === 'both' ? `${text.km}\n\n${text.en}` : text[locale]
  return pick.replace(/\{site\}/g, site)
}

// Every message that carries the share-phone button: the relay warning first,
// then the request, in both languages (the asked-for one first). No path
// offers the button without it (test-portal-telegram-signin-pure.cjs).
function contactPrompt(env: unknown, text: BotText, locale: PortalTelegramLocale): string {
  const order: PortalTelegramLocale[] = locale === 'en' ? ['en', 'km'] : ['km', 'en']
  return order.map((language) => `${BOT_TEXT.relayWarning[language]}\n\n${text[language]}`).join('\n\n')
    .replace(/\{site\}/g, siteName(env))
}

const REMOVE_KEYBOARD = { remove_keyboard: true }

function contactKeyboard(locale: PortalTelegramLocale): Record<string, unknown> {
  return {
    keyboard: [[{ text: BOT_TEXT.shareButton[locale], request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  }
}

function reply(chatId: string, text: string, markup: Record<string, unknown> = REMOVE_KEYBOARD): PortalTelegramReply {
  return { method: 'sendMessage', chat_id: chatId, text, reply_markup: markup }
}

function asLocale(value: unknown): PortalTelegramLocale {
  return value === 'en' ? 'en' : 'km'
}

// Returns the bot's answer, to be sent back as the webhook response body, or
// null when there is nothing to say. Writes only through a challenge row the
// website created; never creates an account (that happens on the website,
// for the browser that holds the cookie).
export async function handlePortalTelegramUpdate(env: Env, update: PortalTelegramUpdate, now: number = Date.now()): Promise<PortalTelegramReply | null> {
  const message = update && typeof update === 'object' ? update.message : undefined
  if (!message || typeof message !== 'object') return null
  const from = message.from
  const tgId = telegramUserId(from?.id)
  // request_contact keyboards exist only in a private chat, whose id is the
  // user's own id. Groups, channels and other bots are ignored.
  if (!tgId || from?.is_bot === true || message.chat?.type !== 'private' || telegramUserId(message.chat?.id) !== tgId) return null

  const userKey = await portalAbuseKey(env, 'portal:telegram:user', tgId)
  if (!userKey) return null
  const rate = await checkRateLimit(env, 'portal:telegram:user', userKey, PORTAL_TELEGRAM_USER_MAX, PORTAL_TELEGRAM_USER_WINDOW_MS)
  if (!rate.allowed) return reply(tgId, botText(env, BOT_TEXT.tooMany, 'both'))

  if (message.contact && typeof message.contact === 'object') return handleContact(env, tgId, from as TelegramUser, message.contact, now)
  const text = String(message.text ?? '').trim()
  const start = /^\/start(?:@[A-Za-z0-9_]+)?(?:\s+(\S+))?\s*$/.exec(text)
  if (start) return handleStart(env, tgId, start[1] ?? '', now)
  return reply(tgId, botText(env, BOT_TEXT.welcome, 'both'))
}

async function handleStart(env: Env, tgId: string, payload: string, now: number): Promise<PortalTelegramReply> {
  // /start alone, or a parameter that is not one of our nonces: a friendly
  // bilingual pointer to the website, and nothing is read or written.
  if (!isPortalTelegramNonce(payload)) return reply(tgId, botText(env, BOT_TEXT.welcome, 'both'))
  const db = getDb(env)
  const stamp = nowStamp(now)
  const row = await db.prepare(`
    SELECT id, status, telegram_user_id, locale, expires_at
    FROM portal_telegram_challenges WHERE nonce_hash = @nonce_hash LIMIT 1
  `).get<{ id: number; status: string; telegram_user_id: string | null; locale: string; expires_at: string }>({ nonce_hash: await portalTelegramSha256Hex(payload) })
  if (!row) return reply(tgId, botText(env, BOT_TEXT.linkDead, 'both'))
  const locale = asLocale(row.locale)
  // A link forwarded to a second Telegram user stays with the first one.
  if (row.expires_at <= stamp || row.status === 'consumed' || (row.telegram_user_id != null && row.telegram_user_id !== tgId)) {
    return reply(tgId, botText(env, BOT_TEXT.linkDead, locale))
  }
  if (row.status === 'verified') return reply(tgId, botText(env, BOT_TEXT.done, locale))
  const bound = await db.prepare(`
    UPDATE portal_telegram_challenges SET status = 'started', telegram_user_id = @tg
    WHERE id = @id AND status IN ('pending', 'started')
      AND (telegram_user_id IS NULL OR telegram_user_id = @tg)
      AND expires_at > @now
  `).run({ id: row.id, tg: tgId, now: stamp })
  if (Number(bound.changes) !== 1) return reply(tgId, botText(env, BOT_TEXT.linkDead, locale))
  return reply(tgId, contactPrompt(env, BOT_TEXT.askContact, locale), contactKeyboard(locale))
}

async function handleContact(env: Env, tgId: string, from: TelegramUser, contact: TelegramContact, now: number): Promise<PortalTelegramReply> {
  const db = getDb(env)
  const stamp = nowStamp(now)
  const row = await db.prepare(`
    SELECT id, locale FROM portal_telegram_challenges
    WHERE telegram_user_id = @tg AND status = 'started' AND expires_at > @now
    ORDER BY id DESC LIMIT 1
  `).get<{ id: number; locale: string }>({ tg: tgId, now: stamp })
  if (!row) return reply(tgId, botText(env, BOT_TEXT.nothingWaiting, 'both'))
  const locale = asLocale(row.locale)
  // THE PHONE PROOF (see the file header). Nothing is written on a refusal;
  // the button is offered again.
  if (telegramUserId(contact.user_id) !== tgId) {
    return reply(tgId, contactPrompt(env, BOT_TEXT.ownContactOnly, locale), contactKeyboard(locale))
  }
  const phone = canonicalizePhone(contact.phone_number)
  if (!phone || phone.length < 6 || phone.length > 20) return reply(tgId, botText(env, BOT_TEXT.phoneUnreadable, locale))
  const name = cleanName(contact.first_name, contact.last_name) || cleanName(from.first_name, from.last_name)
  const verified = await db.prepare(`
    UPDATE portal_telegram_challenges SET status = 'verified', phone = @phone, telegram_name = @name
    WHERE id = @id AND status = 'started' AND telegram_user_id = @tg AND expires_at > @now
  `).run({ id: row.id, tg: tgId, phone, name: name || null, now: stamp })
  if (Number(verified.changes) !== 1) return reply(tgId, botText(env, BOT_TEXT.linkDead, locale))
  return reply(tgId, botText(env, BOT_TEXT.done, locale))
}

// ---------------------------------------------------------------------------
// 4-5. The website polls and finishes.

export type PortalTelegramPollResult =
  | { ok: true; kind: 'waiting'; stage: 'pending' | 'started' }
  | { ok: true; kind: 'signed_in'; accountId: number; created: boolean }
  | { ok: true; kind: 'attached'; accountId: number }
  | PortalTelegramRefusal

const NOT_FOUND = refuse(404, 'telegram_challenge_not_found', 'This sign-in was not found. Please start again.')
const USED = refuse(409, 'telegram_challenge_used', 'This sign-in was already used. Please start again.')
const EXPIRED = refuse(410, 'telegram_challenge_expired', 'This sign-in expired. Please start again.')
const PHONE_HAS_ACCOUNT = refuse(409, 'telegram_phone_has_account',
  'This phone number already has an account. Sign in with your phone number and password, then connect Telegram from your account.')
const ALREADY_ATTACHED = refuse(409, 'telegram_already_attached', 'This Telegram account or this website account is already connected. Please contact us if this is wrong.')
const ACCOUNT_UNAVAILABLE = refuse(409, 'telegram_account_unavailable', 'This account cannot be used. Please contact us.')
const SUSPENDED = refuse(403, 'portal_account_suspended', 'This account is paused. Please contact us.')

type ChallengeRow = {
  id: number
  browser_hash: string
  purpose: string
  account_id: number | null
  consent_locale: string | null
  status: string
  telegram_user_id: string | null
  phone: string | null
  telegram_name: string | null
  expires_at: string
}

export async function pollPortalTelegramChallenge(env: Env, input: {
  nonce: unknown
  browserToken: unknown
  // Read only for an attach: the member must still be signed in to the same
  // account in this browser ("a fresh password check in the same session").
  sessionAccountId: () => Promise<number | null>
  now?: number
}): Promise<PortalTelegramPollResult> {
  if (!isPortalTelegramNonce(input.nonce) || !isPortalTelegramBrowserToken(input.browserToken)) return NOT_FOUND
  const now = input.now ?? Date.now()
  const stamp = nowStamp(now)
  const db = getDb(env)
  const browserHash = await portalTelegramSha256Hex(input.browserToken)
  const row = await db.prepare(`
    SELECT id, browser_hash, purpose, account_id, consent_locale, status, telegram_user_id, phone, telegram_name, expires_at
    FROM portal_telegram_challenges WHERE nonce_hash = @nonce_hash LIMIT 1
  `).get<ChallengeRow>({ nonce_hash: await portalTelegramSha256Hex(input.nonce) })
  // Another browser that learned the nonce gets the same answer as a nonce
  // that never existed: it learns nothing about the sign-in it does not own.
  if (!row || !sameText(row.browser_hash, browserHash)) return NOT_FOUND
  if (row.status === 'consumed') return USED
  if (row.expires_at <= stamp) return EXPIRED
  if (row.status === 'pending' || row.status === 'started') return { ok: true, kind: 'waiting', stage: row.status }
  if (row.status !== 'verified' || !row.telegram_user_id || !row.phone) return NOT_FOUND

  // Single use, whatever happens next: the compare-and-set lets exactly one
  // request through, and the proven phone leaves the row with it.
  const consumed = await db.prepare(`
    UPDATE portal_telegram_challenges SET status = 'consumed', consumed_at = @now, phone = NULL
    WHERE id = @id AND status = 'verified' AND browser_hash = @browser_hash AND expires_at > @now
  `).run({ id: row.id, browser_hash: browserHash, now: stamp })
  if (Number(consumed.changes) !== 1) return USED

  if (row.purpose === 'attach') {
    const sessionAccount = await input.sessionAccountId()
    if (row.account_id == null || sessionAccount !== Number(row.account_id)) {
      return refuse(401, 'portal_unauthenticated', 'Please sign in again, then connect Telegram.')
    }
    return attachTelegram(env, Number(row.account_id), row.telegram_user_id, row.phone)
  }
  return signInWithTelegram(env, {
    tgId: row.telegram_user_id,
    phone: row.phone,
    name: row.telegram_name,
    consentLocale: String(row.consent_locale || 'und').slice(0, 16),
  })
}

type IdentityAccount = {
  account_id: number
  status: string
  contact_id: number | null
  contact_exists: number | null
  is_anonymous: number | null
}

async function signInWithTelegram(env: Env, input: { tgId: string; phone: string; name: string | null; consentLocale: string }): Promise<PortalTelegramPollResult> {
  const db = getDb(env)
  const owner = await db.prepare(`
    SELECT i.account_id, a.status, a.contact_id, c.id AS contact_exists, c.is_anonymous
    FROM portal_login_identities i
    JOIN portal_accounts a ON a.id = i.account_id
    LEFT JOIN customers c ON c.id = a.contact_id
    WHERE i.provider = 'telegram' AND i.subject_key = @tg
    LIMIT 1
  `).get<IdentityAccount>({ tg: input.tgId })

  if (owner) {
    // The Telegram identity IS the credential: sign in the member it belongs
    // to, on the same terms as a password sign-in (lib/portalAccounts.ts).
    if (owner.status === 'suspended') return SUSPENDED
    const contactEligible = owner.contact_id == null || (owner.contact_exists != null && !isAnonymousCustomer(owner))
    if (owner.status !== 'active' || !contactEligible) return ACCOUNT_UNAVAILABLE
    const results = await db.batch([
      {
        sql: `UPDATE portal_accounts
          SET consent_version = @version, consent_at = CURRENT_TIMESTAMP, consent_locale = @locale,
              last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE id = @id AND status = 'active'
            AND (contact_id IS NULL OR EXISTS (SELECT 1 FROM customers WHERE id = portal_accounts.contact_id AND ${customerIsProfileSql()}))`,
        params: { id: owner.account_id, version: PORTAL_CONSENT_VERSION, locale: input.consentLocale },
      },
      {
        sql: `UPDATE portal_login_identities SET last_used_at = CURRENT_TIMESTAMP
          WHERE provider = 'telegram' AND subject_key = @tg`,
        params: { tg: input.tgId },
      },
    ])
    if (Number(results[0]?.meta?.changes ?? 0) !== 1) return ACCOUNT_UNAVAILABLE
    return { ok: true, kind: 'signed_in', accountId: Number(owner.account_id), created: false }
  }

  // No member has this Telegram yet. A phone that already belongs to a
  // website account is NEVER taken over by proving the phone: that member
  // signs in with their password and connects Telegram from inside.
  const holder = await db.prepare('SELECT id FROM portal_accounts WHERE phone = @phone LIMIT 1').get<{ id: number }>({ phone: input.phone })
  if (holder) return PHONE_HAS_ACCOUNT

  // A new W- member with the proven phone and no password. Never linked to a
  // customer here (staff-only, G38 Phase 1).
  const name = cleanName(input.name) || 'Member'
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const memberCode = mintMemberCode()
    try {
      await db.batch([
        {
          sql: `INSERT INTO portal_accounts (
              name, phone, password_hash, member_code, status, link_version,
              consent_version, consent_at, consent_locale, last_seen_at
            ) VALUES (
              @name, @phone, NULL, @member_code, 'active', 0,
              @version, CURRENT_TIMESTAMP, @locale, CURRENT_TIMESTAMP
            )`,
          params: { name, phone: input.phone, member_code: memberCode, version: PORTAL_CONSENT_VERSION, locale: input.consentLocale },
        },
        {
          sql: `INSERT INTO portal_login_identities (account_id, provider, subject_key, verified_at, last_used_at)
            SELECT id, 'telegram', @tg, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM portal_accounts WHERE member_code = @member_code`,
          params: { tg: input.tgId, member_code: memberCode },
        },
      ])
    } catch (error) {
      if (isMemberCodeCollision(error)) continue
      const message = error instanceof Error ? error.message : String(error)
      if (/UNIQUE constraint failed/i.test(message) && /portal_accounts\.phone/i.test(message)) return PHONE_HAS_ACCOUNT
      if (/UNIQUE constraint failed/i.test(message) && /portal_login_identities/i.test(message)) {
        return refuse(409, 'telegram_signin_conflict', 'Please start again.')
      }
      throw error
    }
    const created = await db.prepare('SELECT id FROM portal_accounts WHERE member_code = @member_code LIMIT 1').get<{ id: number }>({ member_code: memberCode })
    if (!created) throw new Error('portal_telegram_member_missing')
    return { ok: true, kind: 'signed_in', accountId: Number(created.id), created: true }
  }
  throw new Error('Could not mint a unique member code')
}

async function attachTelegram(env: Env, accountId: number, tgId: string, phone: string): Promise<PortalTelegramPollResult> {
  const db = getDb(env)
  const account = await db.prepare(`
    SELECT a.phone, a.status,
      (SELECT i.subject_key FROM portal_login_identities i WHERE i.account_id = a.id AND i.provider = 'telegram' LIMIT 1) AS telegram_subject
    FROM portal_accounts a WHERE a.id = @id LIMIT 1
  `).get<{ phone: string | null; status: string; telegram_subject: string | null }>({ id: accountId })
  if (!account || account.status !== 'active') return ACCOUNT_UNAVAILABLE
  if (account.telegram_subject != null) return account.telegram_subject === tgId ? { ok: true, kind: 'attached', accountId } : ALREADY_ATTACHED
  // The proven phone must be this account's own phone.
  if (account.phone !== phone) {
    return refuse(409, 'telegram_phone_mismatch', 'Your Telegram phone number is not the phone number on this account.')
  }
  try {
    const inserted = await db.prepare(`
      INSERT INTO portal_login_identities (account_id, provider, subject_key, verified_at, last_used_at)
      SELECT @id, 'telegram', @tg, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      WHERE EXISTS (SELECT 1 FROM portal_accounts WHERE id = @id AND status = 'active' AND phone = @phone)
    `).run({ id: accountId, tg: tgId, phone })
    if (Number(inserted.changes) !== 1) return ACCOUNT_UNAVAILABLE
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(error instanceof Error ? error.message : String(error))) return ALREADY_ATTACHED
    throw error
  }
  return { ok: true, kind: 'attached', accountId }
}

// ---------------------------------------------------------------------------
// The signed-in member's own sign-in methods (storefront profile).

export async function portalTelegramMethods(env: Env, accountId: number): Promise<{ telegram: boolean; password: boolean }> {
  const row = await getDb(env).prepare(`
    SELECT a.password_hash IS NOT NULL AND a.phone IS NOT NULL AS has_password,
      EXISTS (SELECT 1 FROM portal_login_identities i WHERE i.account_id = a.id AND i.provider = 'telegram') AS has_telegram
    FROM portal_accounts a WHERE a.id = @id LIMIT 1
  `).get<{ has_password: number; has_telegram: number }>({ id: accountId })
  return { telegram: Number(row?.has_telegram) === 1, password: Number(row?.has_password) === 1 }
}
