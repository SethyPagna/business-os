import type { Env } from '../index'
import { canonicalizePhone } from './phone'
import { getPlanLimits, type PlanLimits } from './planTier'

// Pure helpers for the shopper Telegram sign-in: the start token, its keys, the ticket value, update and
// contact rules, the webhook gate decision and the time helpers. No D1, no network, no settings.

export type PortalTelegramEnv = Env & {
  PORTAL_ABUSE_HMAC_SECRET?: string
  PORTAL_ABUSE_HMAC_SECRET_PREVIOUS?: string
  PORTAL_ABUSE_HMAC_SECRET_ROTATED_AT?: string
  PORTAL_TELEGRAM_BOT_TOKEN?: string
  PORTAL_TELEGRAM_WEBHOOK_SECRET?: string
  PORTAL_TELEGRAM_WEBHOOK_CIDRS?: string
}

export type PortalTelegramReplyId =
  | 'R-CONFIRM' | 'R-SHARE' | 'R-JOINED' | 'R-SIGNED-IN' | 'R-USED' | 'R-CAP' | 'R-BUSY' | 'R-LATER' | 'R-STALE' | 'R-PAUSED'
  | 'R-OFF' | 'R-TOO-MANY' | 'R-TERMS' | 'R-OWN-NUMBER' | 'R-PHONE-BAD' | 'R-ANON' | 'R-PHONE-HELD' | 'R-DONE-ALREADY'
  | 'R-WRONG-CODE' | 'R-HELP'

// The storefront language list in index order; S4 owns the order and extends this list.
export const PORTAL_TELEGRAM_LOCALES: readonly string[] = ['en', 'km']

// Telegram's published webhook source ranges: https://core.telegram.org/bots/webhooks#the-short-version
export const DEFAULT_WEBHOOK_CIDRS = '149.154.160.0/20,91.108.4.0/22'

const TOKEN_CHARS = 51
const TOKEN_BYTES = 38
const BODY_BYTES = 22
const MAC_BYTES = 16
const BINDING_BYTES = 16
const CLOCK_LEAD_SECONDS = 5
const ROTATION_FUTURE_MS = 60_000
const KDF_SALT = 'business-os portal-telegram kdf v1'
const START_LABEL = 'portal-telegram-start-v1'
const TICKET_LABEL = 'portal-telegram-ticket-v1'
const TICKET_PREFIX = 'tg1:'
const MAX_TELEGRAM_ID = 2 ** 52 - 1

const encoder = new TextEncoder()

export function b64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Strict: the alphabet only, and the canonical form (no stray bits in the last character).
export function b64urlDecode(text: unknown): Uint8Array | null {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  let binary: string
  try {
    binary = atob(padded)
  } catch {
    return null
  }
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return b64url(out) === text ? out : null
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function bytesOf(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : data
}

export async function sha256Bytes(data: Uint8Array | string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytesOf(data)))
}

// XOR-accumulate over the longer length: the time does not depend on where the bytes differ.
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length
  const longest = Math.max(a.length, b.length)
  for (let i = 0; i < longest; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

// Hash both sides, then compare the two 32-byte digests.
export async function secretsEqual(expected: string, supplied: string): Promise<boolean> {
  const left = await sha256Bytes(expected)
  const right = await sha256Bytes(supplied)
  return sameBytes(left, right)
}

// ---- Keys (section 2.3) ---------------------------------------------------------------------

export async function hkdfSha256(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, lengthBytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, lengthBytes * 8)
  return new Uint8Array(bits)
}

export function botIdFromToken(token: unknown): string | null {
  if (typeof token !== 'string') return null
  const id = token.split(':')[0]
  return /^[1-9][0-9]{4,15}$/.test(id) && token.includes(':') ? id : null
}

export async function deriveTelegramKeyBytes(secret: string, botId: string, kind: 'start' | 'ticket'): Promise<Uint8Array> {
  const label = kind === 'start' ? START_LABEL : TICKET_LABEL
  const info = encoder.encode(`${label}\u0000${botId}`)
  return hkdfSha256(encoder.encode(secret), encoder.encode(KDF_SALT), info, 32)
}

export type TelegramKeys = { start: CryptoKey; ticket: CryptoKey }

const KEY_MEMO_MAX = 4
const keyMemo = new Map<string, Promise<TelegramKeys>>()

export function deriveTelegramKeys(secret: string, botId: string): Promise<TelegramKeys> {
  const memoKey = `${secret}\u0000${botId}`
  const hit = keyMemo.get(memoKey)
  if (hit) return hit
  const made = (async () => {
    const hmac = { name: 'HMAC', hash: 'SHA-256' }
    const start = await crypto.subtle.importKey('raw', await deriveTelegramKeyBytes(secret, botId, 'start'), hmac, false, ['sign'])
    const ticket = await crypto.subtle.importKey('raw', await deriveTelegramKeyBytes(secret, botId, 'ticket'), hmac, false, ['sign'])
    return { start, ticket }
  })()
  if (keyMemo.size >= KEY_MEMO_MAX) keyMemo.clear()
  keyMemo.set(memoKey, made)
  made.catch(() => keyMemo.delete(memoKey))
  return made
}

type KeySet = 'current' | 'previous'

function usableSecret(value: unknown): string | null {
  return typeof value === 'string' && value.length >= 32 ? value : null
}

async function keysFor(env: PortalTelegramEnv, which: KeySet): Promise<TelegramKeys | null> {
  const botId = botIdFromToken(env.PORTAL_TELEGRAM_BOT_TOKEN)
  const current = usableSecret(env.PORTAL_ABUSE_HMAC_SECRET)
  if (!botId || !current) return null
  if (which === 'current') return deriveTelegramKeys(current, botId)
  const previous = usableSecret(env.PORTAL_ABUSE_HMAC_SECRET_PREVIOUS)
  if (!previous || previous === current) return null
  return deriveTelegramKeys(previous, botId)
}

async function hmacSign(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data))
}

// ---- The start token (section 2.2) ----------------------------------------------------------

export type StartTokenFields = {
  locale: number
  termsAccepted: boolean
  ageConfirmed: boolean
  code: number
  binding: Uint8Array
}

// b = the first 16 bytes of SHA-256(S), S = the 32 random bytes of cookie S.
export async function startBinding(cookieS: Uint8Array): Promise<Uint8Array> {
  return (await sha256Bytes(cookieS)).slice(0, BINDING_BYTES)
}

export function parseCookieS(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value.length !== 43) return null
  const bytes = b64urlDecode(value)
  return bytes && bytes.length === 32 ? bytes : null
}

const FLAG_TERMS = 1 << 3
const FLAG_AGE = 1 << 4
const FLAG_RESERVED = 0xf000

export async function mintStartToken(env: PortalTelegramEnv, fields: StartTokenFields, nowMs: number = Date.now()): Promise<string | null> {
  const { locale, code } = fields
  if (!Number.isInteger(locale) || locale < 0 || locale >= PORTAL_TELEGRAM_LOCALES.length) return null
  if (!Number.isInteger(code) || code < 10 || code > 99) return null
  if (fields.binding.length !== BINDING_BYTES) return null
  const keys = await keysFor(env, 'current')
  if (!keys) return null
  const flags = locale | (fields.termsAccepted ? FLAG_TERMS : 0) | (fields.ageConfirmed ? FLAG_AGE : 0) | (code << 5)
  const expiry = Math.floor(nowMs / 1000) + getPlanLimits(env).portalTelegramTokenTtlSeconds
  const bytes = new Uint8Array(TOKEN_BYTES)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, flags)
  view.setUint32(2, expiry)
  bytes.set(fields.binding, 6)
  const mac = await hmacSign(keys.start, bytes.subarray(0, BODY_BYTES))
  bytes.set(mac.subarray(0, MAC_BYTES), BODY_BYTES)
  return b64url(bytes)
}

export type VerifiedStartToken = {
  locale: string
  termsAccepted: boolean
  ageConfirmed: boolean
  code: number
  expiry: number
  startedAtSeconds: number
  binding: Uint8Array
  firstMacByte: number
  bytes: Uint8Array
  keySet: KeySet
}

function parseRotatedAt(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?Z$/.exec(value)
  if (!match) return null
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number)
  const ms = Date.UTC(year, month - 1, day, hour, minute, second)
  const check = new Date(ms)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null
  return ms + (match[7] ? Number(match[7].padEnd(3, '0')) : 0)
}

export async function verifyStartToken(env: PortalTelegramEnv, token: unknown, nowMs: number = Date.now()): Promise<VerifiedStartToken | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{51}$/.test(token) || token.length !== TOKEN_CHARS) return null
  const bytes = b64urlDecode(token)
  if (!bytes || bytes.length !== TOKEN_BYTES) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const flags = view.getUint16(0)
  if ((flags & FLAG_RESERVED) !== 0) return null
  const localeIndex = flags & 7
  if (localeIndex >= PORTAL_TELEGRAM_LOCALES.length) return null
  const code = (flags >> 5) & 0x7f
  if (code < 10 || code > 99) return null
  const expiry = view.getUint32(2)
  const ttl = getPlanLimits(env).portalTelegramTokenTtlSeconds
  const nowSeconds = Math.floor(nowMs / 1000)
  if (!(nowSeconds < expiry && expiry <= nowSeconds + ttl + CLOCK_LEAD_SECONDS)) return null

  const body = bytes.subarray(0, BODY_BYTES)
  const mac = bytes.subarray(BODY_BYTES, TOKEN_BYTES)
  let keySet: KeySet | null = null
  const currentKeys = await keysFor(env, 'current')
  if (!currentKeys) return null
  if (sameBytes((await hmacSign(currentKeys.start, body)).subarray(0, MAC_BYTES), mac)) keySet = 'current'
  if (!keySet) {
    const rotatedAt = parseRotatedAt(env.PORTAL_ABUSE_HMAC_SECRET_ROTATED_AT)
    const previousKeys = rotatedAt === null ? null : await keysFor(env, 'previous')
    if (previousKeys && rotatedAt !== null && rotatedAt <= nowMs + ROTATION_FUTURE_MS && nowMs <= rotatedAt + ttl * 1000 && expiry * 1000 <= rotatedAt + ttl * 1000) {
      if (sameBytes((await hmacSign(previousKeys.start, body)).subarray(0, MAC_BYTES), mac)) keySet = 'previous'
    }
  }
  if (!keySet) return null
  return {
    locale: PORTAL_TELEGRAM_LOCALES[localeIndex],
    termsAccepted: (flags & FLAG_TERMS) !== 0,
    ageConfirmed: (flags & FLAG_AGE) !== 0,
    code,
    expiry,
    startedAtSeconds: expiry - ttl,
    binding: bytes.slice(6, 22),
    firstMacByte: mac[0],
    bytes: bytes.slice(),
    keySet,
  }
}

// The poll: the browser's cookie S must hash to the token's b.
export async function cookieMatchesBinding(verified: Pick<VerifiedStartToken, 'binding'>, cookieS: Uint8Array): Promise<boolean> {
  return sameBytes(await startBinding(cookieS), verified.binding)
}

// ---- The ticket value (section 2.6) ---------------------------------------------------------

export async function ticketValue(env: PortalTelegramEnv, verified: Pick<VerifiedStartToken, 'bytes' | 'keySet'>): Promise<string | null> {
  const keys = await keysFor(env, verified.keySet)
  if (!keys) return null
  return TICKET_PREFIX + bytesToHex(await hmacSign(keys.ticket, verified.bytes))
}

export function isTicketValue(value: unknown): boolean {
  return typeof value === 'string' && value.length === 68 && value.startsWith(TICKET_PREFIX) && /^[0-9a-f]{64}$/.test(value.slice(4))
}

// ---- Number matching: an aid only (section 2.7) ---------------------------------------------

export function matchOptions(code: number, firstMacByte: number): number[] {
  const base = [code, 10 + ((code - 10 + 31) % 90), 10 + ((code - 10 + 62) % 90)]
  const turn = firstMacByte % 3
  return [0, 1, 2].map((i) => base[(i + turn) % 3])
}

export function isCorrectChoice(code: number, firstMacByte: number, choice: number): boolean {
  if (!Number.isInteger(choice) || choice < 0 || choice > 2) return false
  return matchOptions(code, firstMacByte)[choice] === code
}

// ---- The callback data (section 2.5) --------------------------------------------------------

export function parseCallbackData(data: unknown): { token: string; choice: 0 | 1 | 2 } | null {
  if (typeof data !== 'string') return null
  const match = /^c([A-Za-z0-9_-]{51})([012])$/.exec(data)
  return match ? { token: match[1], choice: Number(match[2]) as 0 | 1 | 2 } : null
}

// ---- Updates (sections 5.4 and 5.5) ---------------------------------------------------------

export type ClassifiedUpdate =
  | { kind: 'ignore' }
  | { kind: 'start'; fromId: number; token: string; languageCode: string | null }
  | { kind: 'contact'; fromId: number; languageCode: string | null; contact: { userId: unknown; phoneNumber: unknown } }
  | { kind: 'help'; fromId: number; languageCode: string | null }
  | { kind: 'callback'; callbackId: string; fromId: number; token: string; choice: 0 | 1 | 2; languageCode: string | null }
  | { kind: 'stale'; callbackId: string }

const IGNORE: ClassifiedUpdate = { kind: 'ignore' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validSender(from: unknown): from is Record<string, unknown> & { id: number } {
  return isRecord(from) && typeof from.id === 'number' && Number.isSafeInteger(from.id) && from.id >= 1 && from.id <= MAX_TELEGRAM_ID && from.is_bot !== true
}

function languageOf(from: Record<string, unknown>): string | null {
  return typeof from.language_code === 'string' ? from.language_code.slice(0, 16) : null
}

export function classifyUpdate(body: unknown): ClassifiedUpdate {
  if (!isRecord(body) || typeof body.update_id !== 'number' || !Number.isSafeInteger(body.update_id)) return IGNORE
  const hasMessage = body.message !== undefined
  const hasCallback = body.callback_query !== undefined
  if (hasMessage === hasCallback) return IGNORE
  return hasMessage ? classifyMessage(body.message) : classifyCallback(body.callback_query)
}

function classifyMessage(message: unknown): ClassifiedUpdate {
  if (!isRecord(message) || !isRecord(message.chat) || message.chat.type !== 'private') return IGNORE
  const from = message.from
  if (!validSender(from) || message.chat.id !== from.id) return IGNORE
  const languageCode = languageOf(from)
  if (isRecord(message.contact)) {
    return { kind: 'contact', fromId: from.id, languageCode, contact: { userId: message.contact.user_id, phoneNumber: message.contact.phone_number } }
  }
  const start = typeof message.text === 'string' ? /^\/start ([A-Za-z0-9_-]{51})$/.exec(message.text) : null
  if (start) return { kind: 'start', fromId: from.id, token: start[1], languageCode }
  return { kind: 'help', fromId: from.id, languageCode }
}

function classifyCallback(query: unknown): ClassifiedUpdate {
  if (!isRecord(query) || typeof query.id !== 'string' || query.id.length < 1 || query.id.length > 64) return IGNORE
  const stale: ClassifiedUpdate = { kind: 'stale', callbackId: query.id }
  const from = query.from
  if (!validSender(from)) return stale
  const message = query.message
  if (!isRecord(message) || query.inline_message_id !== undefined) return stale
  if (!isRecord(message.chat) || message.chat.type !== 'private' || message.chat.id !== from.id) return stale
  const parsed = parseCallbackData(query.data)
  if (!parsed) return stale
  return { kind: 'callback', callbackId: query.id, fromId: from.id, token: parsed.token, choice: parsed.choice, languageCode: languageOf(from) }
}

// ---- Contacts (section 5.6) -----------------------------------------------------------------

export type ContactVerdict = { ok: true; phone: string } | { ok: false; reply: 'R-OWN-NUMBER' | 'R-PHONE-BAD' | 'R-ANON' }

export function contactVerdict(fromId: number, contact: { userId: unknown; phoneNumber: unknown }): ContactVerdict {
  const userId = contact.userId
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId !== fromId) return { ok: false, reply: 'R-OWN-NUMBER' }
  const phoneNumber = contact.phoneNumber
  if (typeof phoneNumber !== 'string' || phoneNumber.length > 32 || !/^[0-9+ ()-]+$/.test(phoneNumber)) return { ok: false, reply: 'R-PHONE-BAD' }
  const digits = phoneNumber.replace(/\D/g, '')
  if (digits.startsWith('888')) return { ok: false, reply: 'R-ANON' }
  const phone = canonicalizePhone(digits)
  return phone ? { ok: true, phone } : { ok: false, reply: 'R-PHONE-BAD' }
}

// ---- The webhook gate (sections 5.1 to 5.3) -------------------------------------------------

export type WebhookRange = { base: number; bits: number }

const MAX_CIDR_ENTRIES = 16
const MAX_CIDR_ADDRESSES = 65_536

function parseIpv4(text: unknown): number | null {
  if (typeof text !== 'string') return null
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (!match) return null
  let value = 0
  for (const part of match.slice(1)) {
    const octet = Number(part)
    if (String(octet) !== part || octet > 255) return null
    value = value * 256 + octet
  }
  return value
}

export function parseWebhookCidrs(raw: unknown): WebhookRange[] | null {
  const text = typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_WEBHOOK_CIDRS
  const entries = text.split(',').map((entry) => entry.trim())
  if (entries.length > MAX_CIDR_ENTRIES) return null
  const ranges: WebhookRange[] = []
  let total = 0
  for (const entry of entries) {
    const match = /^([0-9.]+)\/(\d{1,2})$/.exec(entry)
    if (!match) return null
    const base = parseIpv4(match[1])
    const bits = Number(match[2])
    if (base === null || String(bits) !== match[2] || bits < 16 || bits > 32) return null
    const size = 2 ** (32 - bits)
    if (base % size !== 0) return null
    total += size
    ranges.push({ base, bits })
  }
  return total <= MAX_CIDR_ADDRESSES ? ranges : null
}

export function ipv4InRanges(ip: unknown, ranges: WebhookRange[] | null): boolean {
  const value = parseIpv4(ip)
  if (value === null || !ranges) return false
  return ranges.some(({ base, bits }) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)))
}

// Donor rules: 32 to 256 URL-safe characters, and never a bot token or the SHA-256 hex of one.
async function configuredWebhookSecret(env: PortalTelegramEnv): Promise<string | null> {
  const secret = env.PORTAL_TELEGRAM_WEBHOOK_SECRET
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) return null
  for (const token of [env.PORTAL_TELEGRAM_BOT_TOKEN, env.TELEGRAM_BOT_TOKEN]) {
    if (typeof token !== 'string' || !token) continue
    if (secret === token || secret === bytesToHex(await sha256Bytes(token))) return null
  }
  return secret
}

export async function webhookSecretConfigured(env: PortalTelegramEnv): Promise<boolean> {
  return (await configuredWebhookSecret(env)) !== null
}

export type WebhookGateResult = { ok: true } | { ok: false; status: 401 | 405 }

// Method, then address (CF-Connecting-IP only), then secret. Pure: no D1, no settings.
export async function isAuthenticWebhookRequest(env: PortalTelegramEnv, method: string, headers: { get(name: string): string | null }): Promise<WebhookGateResult> {
  if (method !== 'POST') return { ok: false, status: 405 }
  const ranges = parseWebhookCidrs(env.PORTAL_TELEGRAM_WEBHOOK_CIDRS)
  if (!ranges || !ipv4InRanges(headers.get('CF-Connecting-IP'), ranges)) return { ok: false, status: 401 }
  const expected = await configuredWebhookSecret(env)
  if (expected === null) return { ok: false, status: 401 }
  const supplied = headers.get('X-Telegram-Bot-Api-Secret-Token') ?? ''
  return (await secretsEqual(expected, supplied)) ? { ok: true } : { ok: false, status: 401 }
}

// ---- Time (section 1.3) ---------------------------------------------------------------------

// The five poll gaps in order; the poll repeats the last one (section 3.6).
export function pollScheduleMs(limits: PlanLimits): readonly number[] {
  return [limits.portalTelegramPollDelay1Ms, limits.portalTelegramPollDelay2Ms, limits.portalTelegramPollDelay3Ms, limits.portalTelegramPollDelay4Ms, limits.portalTelegramPollDelay5Ms]
}

export function portalNowIso(ms: number = Date.now()): string {
  return new Date(ms).toISOString()
}

export function secondsAgoModifier(n: number): string {
  if (!Number.isInteger(n) || n < 1) throw new Error('secondsAgoModifier needs an integer of at least 1')
  return `-${n} seconds`
}
