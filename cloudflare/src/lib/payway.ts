// ABA PayWay dynamic KHQR client, pure. Slice S1 of the online-payment plan.
//
// This module builds and signs requests, parses answers and verifies callbacks. It performs NO I/O: the network is
// a `PaywayTransport` the caller injects, so the same code is driven by a mock in every test. It never logs, and
// no error it raises or returns carries the merchant id, the API key or a signature; failures are fixed words.
//
// Field order is the documented one. A hash is the base64 of a raw HMAC-SHA512 over the listed values joined with
// no separator, and an omitted optional field contributes the empty string. The order is pinned by
// scripts/test-payway-hash-pure.cjs against an independent node:crypto implementation. ABA's PHP sample shows a
// stray `+` in the generate-qr list; add a sandbox test vector there once ABA provides one.

import type { Env } from '../index'

export type PaywayEnvName = 'sandbox' | 'production'
export const PAYWAY_BASE_URLS: Readonly<Record<PaywayEnvName, string>> = Object.freeze({
  sandbox: 'https://checkout-sandbox.payway.com.kh',
  production: 'https://checkout.payway.com.kh',
})
export const PAYWAY_PATHS = Object.freeze({
  generateQr: '/api/payment-gateway/v1/payments/generate-qr',
  checkTransaction: '/api/payment-gateway/v1/payments/check-transaction-2',
  closeTransaction: '/api/payment-gateway/v1/payments/close-transaction',
})
export const PAYWAY_PAYMENT_OPTION = 'abapay_khqr'
/** Required by generate-qr. Smallest colour template; confirm against the sandbox before go-live. */
export const DEFAULT_QR_IMAGE_TEMPLATE = 'template1_color'
export const QR_LIFETIME_MIN_MINUTES = 3
export const QR_LIFETIME_MAX_MINUTES = 120 * 24 * 60
export const KHR_MIN_AMOUNT = 100
export const USD_MIN_AMOUNT = 0.01
export const TRAN_ID_MAX_LENGTH = 20

export type PaywayCredentials = { merchantId: string; apiKey: string; env: PaywayEnvName }

/** Fixed-word failure. `reason` is one of PaywayFailureReason; nothing from the request or the key is ever included. */
export type PaywayFailureReason =
  | 'not_configured' | 'invalid_input' | 'transport_failed' | 'bad_response'
  | 'wrong_hash' | 'domain_not_whitelisted' | 'currency_not_supported' | 'option_not_enabled' | 'limit_exceeded'
  | 'amount_too_small' | 'duplicate_tran_id' | 'rate_limited' | 'not_found' | 'wrong_merchant' | 'declined' | 'unknown'
export class PaywayError extends Error {
  readonly reason: PaywayFailureReason
  constructor(reason: PaywayFailureReason) {
    super(`payway_${reason}`)
    this.name = 'PaywayError'
    this.reason = reason
  }
}

/** Reads the three deployment values once. Returns null unless merchant id and API key are both present. */
export function paywayCredentials(env: Pick<Env, 'PAYWAY_MERCHANT_ID' | 'PAYWAY_API_KEY' | 'PAYWAY_ENV'>): PaywayCredentials | null {
  const merchantId = String(env.PAYWAY_MERCHANT_ID ?? '').trim()
  const apiKey = String(env.PAYWAY_API_KEY ?? '').trim()
  if (!merchantId || !apiKey) return null
  return { merchantId, apiKey, env: env.PAYWAY_ENV === 'production' ? 'production' : 'sandbox' }
}
export const paywayConfigured = (env: Pick<Env, 'PAYWAY_MERCHANT_ID' | 'PAYWAY_API_KEY' | 'PAYWAY_ENV'>): boolean => paywayCredentials(env) !== null

// ---- encoding and signing --------------------------------------------------

const encoder = new TextEncoder()

export function base64OfBytes(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
export const base64Utf8 = (text: string): string => base64OfBytes(encoder.encode(text))
const base64Url = (bytes: Uint8Array): string => base64OfBytes(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function hmac(hash: 'SHA-512' | 'SHA-256', key: Uint8Array | string, message: string): Promise<Uint8Array> {
  const keyBytes = typeof key === 'string' ? encoder.encode(key) : key
  const imported = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(message)))
}
export async function hmacSha512Base64(key: string, message: string): Promise<string> {
  return base64OfBytes(await hmac('SHA-512', key, message))
}

/** Compares without an early exit on the first differing byte. A length difference is folded into the result. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let diff = left.length ^ right.length
  const length = Math.max(left.length, right.length)
  for (let i = 0; i < length; i += 1) diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return diff === 0
}

/** UTC `YYYYMMDDHHmmss`. */
export function reqTime(now: Date): string {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new PaywayError('invalid_input')
  return now.toISOString().slice(0, 19).replace(/[-:T]/g, '')
}

// ---- amounts ---------------------------------------------------------------

/** USD as a 2-decimal string (at least 0.01, whole cents only); KHR as an integer of at least 100. */
export function amountString(amount: number, currency: 'USD' | 'KHR'): string {
  if (!Number.isFinite(amount)) throw new PaywayError('invalid_input')
  if (currency === 'KHR') {
    if (!Number.isInteger(amount) || amount < KHR_MIN_AMOUNT) throw new PaywayError('invalid_input')
    return String(amount)
  }
  if (currency !== 'USD') throw new PaywayError('invalid_input')
  const cents = Math.round(amount * 100)
  if (Math.abs(amount * 100 - cents) > 1e-6 || cents < 1) throw new PaywayError('invalid_input')
  return (cents / 100).toFixed(2)
}

// ---- request builders ------------------------------------------------------

export type QrItem = { name: string; quantity: number; price: number }
export type GenerateQrInput = {
  now: Date
  tranId: string
  amount: number
  currency: 'USD' | 'KHR'
  lifetimeMinutes: number
  callbackUrl?: string
  returnDeeplink?: string
  items?: QrItem[]
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  purchaseType?: string
  customFields?: string
  returnParams?: string
  payout?: string
  qrImageTemplate?: string
}
export type PaywayRequest = { path: string; body: Record<string, string | number> }

/** The values hashed for generate-qr, in the documented order. Exported so the test pins the order. */
export const GENERATE_QR_HASH_FIELDS = Object.freeze([
  'req_time', 'merchant_id', 'tran_id', 'amount', 'items', 'first_name', 'last_name', 'email', 'phone',
  'purchase_type', 'payment_option', 'callback_url', 'return_deeplink', 'currency', 'custom_fields',
  'return_params', 'payout', 'lifetime', 'qr_image_template',
] as const)

export function validTranId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= TRAN_ID_MAX_LENGTH && /^[A-Z0-9]+$/.test(value)
}

export async function buildGenerateQr(input: GenerateQrInput, credentials: PaywayCredentials): Promise<PaywayRequest> {
  if (!validTranId(input.tranId)) throw new PaywayError('invalid_input')
  if (!Number.isInteger(input.lifetimeMinutes) || input.lifetimeMinutes < QR_LIFETIME_MIN_MINUTES || input.lifetimeMinutes > QR_LIFETIME_MAX_MINUTES) {
    throw new PaywayError('invalid_input')
  }
  const fields: Record<(typeof GENERATE_QR_HASH_FIELDS)[number], string> = {
    req_time: reqTime(input.now),
    merchant_id: credentials.merchantId,
    tran_id: input.tranId,
    amount: amountString(input.amount, input.currency),
    items: input.items && input.items.length ? base64Utf8(JSON.stringify(input.items.map((item) => ({ name: item.name, quantity: item.quantity, price: item.price })))) : '',
    first_name: input.firstName ?? '',
    last_name: input.lastName ?? '',
    email: input.email ?? '',
    phone: input.phone ?? '',
    purchase_type: input.purchaseType ?? '',
    payment_option: PAYWAY_PAYMENT_OPTION,
    callback_url: input.callbackUrl ? base64Utf8(input.callbackUrl) : '',
    return_deeplink: input.returnDeeplink ? base64Utf8(input.returnDeeplink) : '',
    currency: input.currency,
    custom_fields: input.customFields ?? '',
    return_params: input.returnParams ?? '',
    payout: input.payout ?? '',
    lifetime: String(input.lifetimeMinutes),
    qr_image_template: input.qrImageTemplate ?? DEFAULT_QR_IMAGE_TEMPLATE,
  }
  const hash = await hmacSha512Base64(credentials.apiKey, GENERATE_QR_HASH_FIELDS.map((name) => fields[name]).join(''))
  const body: Record<string, string | number> = { hash }
  for (const name of GENERATE_QR_HASH_FIELDS) if (fields[name] !== '') body[name] = fields[name]
  return { path: PAYWAY_PATHS.generateQr, body }
}

async function buildTranIdRequest(path: string, now: Date, tranId: string, credentials: PaywayCredentials): Promise<PaywayRequest> {
  if (!validTranId(tranId)) throw new PaywayError('invalid_input')
  const time = reqTime(now)
  const hash = await hmacSha512Base64(credentials.apiKey, `${time}${credentials.merchantId}${tranId}`)
  return { path, body: { req_time: time, merchant_id: credentials.merchantId, tran_id: tranId, hash } }
}
export const buildCheckTransaction = (now: Date, tranId: string, credentials: PaywayCredentials) =>
  buildTranIdRequest(PAYWAY_PATHS.checkTransaction, now, tranId, credentials)
export const buildCloseTransaction = (now: Date, tranId: string, credentials: PaywayCredentials) =>
  buildTranIdRequest(PAYWAY_PATHS.closeTransaction, now, tranId, credentials)

// ---- response parsers ------------------------------------------------------

const QR_STATUS_REASONS: Readonly<Record<string, PaywayFailureReason>> = Object.freeze({
  '1': 'wrong_hash', '6': 'domain_not_whitelisted', '102': 'domain_not_whitelisted', '12': 'currency_not_supported',
  '23': 'option_not_enabled', '44': 'limit_exceeded', '47': 'amount_too_small', '403': 'duplicate_tran_id', '429': 'rate_limited',
})
const CHECK_STATUS_REASONS: Readonly<Record<string, PaywayFailureReason>> = Object.freeze({
  '5': 'wrong_hash', '6': 'not_found', '8': 'wrong_merchant', '429': 'rate_limited',
})

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
function statusCodeOf(json: unknown): string | null {
  if (!isRecord(json) || !isRecord(json.status)) return null
  const code = json.status.code
  if (typeof code === 'number' && Number.isFinite(code)) return String(code)
  if (typeof code === 'string' && /^\d{1,4}$/.test(code.trim())) return String(Number(code.trim()))
  return null
}
const optionalText = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= max ? value : null
function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return null
}

export type ParsedQr = { ok: true; qrString: string; deeplink: string | null } | { ok: false; reason: PaywayFailureReason }
/** The raw `qrImage` is deliberately dropped: it can be half a megabyte and the page draws the QR from `qrString`. */
export function parseQrResponse(json: unknown): ParsedQr {
  const code = statusCodeOf(json)
  if (code === null) return { ok: false, reason: 'bad_response' }
  if (code !== '0') return { ok: false, reason: QR_STATUS_REASONS[code] ?? 'unknown' }
  const body = json as Record<string, unknown>
  const qrString = optionalText(body.qrString, 2000)
  if (!qrString) return { ok: false, reason: 'bad_response' }
  return { ok: true, qrString, deeplink: optionalText(body.abapay_deeplink, 2000) }
}

export type CheckState = 'approved' | 'pending' | 'declined' | 'refunded' | 'cancelled'
export type ParsedCheck =
  | {
    ok: true
    state: CheckState
    originalAmount: number | null
    totalAmount: number | null
    discountAmount: number | null
    paymentAmount: number | null
    refundAmount: number | null
    paymentCurrency: string | null
    apv: string | null
    transactionDate: string | null
  }
  | { ok: false; reason: PaywayFailureReason }
const CHECK_STATES: Readonly<Record<string, CheckState>> = Object.freeze({
  '0': 'approved', '2': 'pending', '3': 'declined', '4': 'refunded', '7': 'cancelled',
})
export function parseCheckResponse(json: unknown): ParsedCheck {
  const code = statusCodeOf(json)
  if (code === null) return { ok: false, reason: 'bad_response' }
  if (code !== '0') return { ok: false, reason: CHECK_STATUS_REASONS[code] ?? 'unknown' }
  const data = (json as Record<string, unknown>).data
  if (!isRecord(data)) return { ok: false, reason: 'bad_response' }
  const statusCode = numberOrNull(data.payment_status_code)
  const state = statusCode === null ? undefined : CHECK_STATES[String(statusCode)]
  if (!state) return { ok: false, reason: 'bad_response' }
  return {
    ok: true,
    state,
    originalAmount: numberOrNull(data.original_amount),
    totalAmount: numberOrNull(data.total_amount),
    discountAmount: numberOrNull(data.discount_amount),
    paymentAmount: numberOrNull(data.payment_amount),
    refundAmount: numberOrNull(data.refund_amount),
    paymentCurrency: optionalText(data.payment_currency, 8),
    apv: optionalText(data.apv, 64),
    transactionDate: optionalText(data.transaction_date, 40),
  }
}

export type ParsedClose = { ok: true } | { ok: false; reason: PaywayFailureReason }
export function parseCloseResponse(json: unknown): ParsedClose {
  const code = statusCodeOf(json)
  if (code === null) return { ok: false, reason: 'bad_response' }
  return code === '0' ? { ok: true } : { ok: false, reason: CHECK_STATUS_REASONS[code] ?? 'unknown' }
}

// ---- injected transport ----------------------------------------------------

export type PaywayTransport = (request: { url: string; body: Record<string, string | number> }) => Promise<{ status: number; json: unknown }>

async function send(transport: PaywayTransport, credentials: PaywayCredentials, request: PaywayRequest): Promise<unknown> {
  let answer: { status: number; json: unknown }
  try {
    answer = await transport({ url: `${PAYWAY_BASE_URLS[credentials.env]}${request.path}`, body: request.body })
  } catch {
    // The thrown value can echo the URL or headers; it is dropped on purpose.
    throw new PaywayError('transport_failed')
  }
  if (answer.status === 429) return { status: { code: 429 } }
  if (answer.status >= 500) throw new PaywayError('transport_failed')
  return answer.json
}
export async function generateQr(transport: PaywayTransport, credentials: PaywayCredentials, input: GenerateQrInput): Promise<ParsedQr> {
  return parseQrResponse(await send(transport, credentials, await buildGenerateQr(input, credentials)))
}
export async function checkTransaction(transport: PaywayTransport, credentials: PaywayCredentials, now: Date, tranId: string): Promise<ParsedCheck> {
  return parseCheckResponse(await send(transport, credentials, await buildCheckTransaction(now, tranId, credentials)))
}
export async function closeTransaction(transport: PaywayTransport, credentials: PaywayCredentials, now: Date, tranId: string): Promise<ParsedClose> {
  return parseCloseResponse(await send(transport, credentials, await buildCloseTransaction(now, tranId, credentials)))
}

// ---- callbacks -------------------------------------------------------------

/** Values of the body in ascending key order, joined with no separator; arrays and objects JSON-encoded, null as empty. */
export function callbackSigningString(body: Record<string, unknown>): string {
  return Object.keys(body).sort().map((key) => {
    const value = body[key]
    if (value === null || value === undefined) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }).join('')
}
/** Header `X-PayWay-HMAC-SHA512`: base64 HMAC-SHA512 of the signing string. The key is whichever ABA names for callbacks. */
export async function verifyCallbackSignature(body: Record<string, unknown>, header: string | null | undefined, key: string): Promise<boolean> {
  if (!header || !key || !isRecord(body)) return false
  return constantTimeEqual(await hmacSha512Base64(key, callbackSigningString(body)), header.trim())
}

async function callbackKey(appEncryptionKey: string): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(appEncryptionKey), 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('business-os/payway'), info: encoder.encode('callback-url-v1') },
    material, 256,
  ))
}
async function callbackToken(appEncryptionKey: string, tranId: string): Promise<string> {
  return base64Url(await hmac('SHA-256', await callbackKey(appEncryptionKey), tranId))
}
/** The per-order callback URL: only ABA receives it. Null without APP_ENCRYPTION_KEY. */
export async function callbackUrlFor(env: Pick<Env, 'APP_ENCRYPTION_KEY'>, origin: string, tranId: string): Promise<string | null> {
  const key = String(env.APP_ENCRYPTION_KEY ?? '')
  if (!key || !validTranId(tranId) || !/^https:\/\/[^/?#\s]+$/.test(origin)) return null
  return `${origin}/api/payway/callback?t=${tranId}&s=${await callbackToken(key, tranId)}`
}
/** No D1 read is needed to refuse a forged callback: the token is a pure function of the tran id and the key. */
export async function verifyCallbackToken(env: Pick<Env, 'APP_ENCRYPTION_KEY'>, tranId: unknown, token: unknown): Promise<boolean> {
  const key = String(env.APP_ENCRYPTION_KEY ?? '')
  if (!key || !validTranId(tranId) || typeof token !== 'string' || !token) return false
  return constantTimeEqual(await callbackToken(key, tranId), token)
}

// ---- transaction ids -------------------------------------------------------

const TRAN_ID_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/**
 * `prefix` (up to 4 of [A-Z0-9], the organisation) plus random characters, 20 in all by default. `random` is injected
 * so the function stays pure; uniqueness is enforced by the table's UNIQUE index, not assumed.
 */
export function makeTranId(prefix: string, random: Uint8Array, length = TRAN_ID_MAX_LENGTH): string {
  const clean = String(prefix || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4)
  if (!Number.isInteger(length) || length < clean.length + 8 || length > TRAN_ID_MAX_LENGTH) throw new PaywayError('invalid_input')
  const body = length - clean.length
  if (random.length < body) throw new PaywayError('invalid_input')
  let out = clean
  for (let i = 0; i < body; i += 1) out += TRAN_ID_ALPHABET[random[i] & 31]
  return out
}
