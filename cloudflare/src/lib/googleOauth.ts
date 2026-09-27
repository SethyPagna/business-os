// Workers-native port of backend/src/services/googleOauth.ts.
//
// Same protocol shape as the legacy service (Authorization Code + PKCE,
// HMAC-signed opaque `state`, openid-connect userinfo lookup) rewritten
// against Web Crypto (crypto.subtle) instead of node:crypto, since that's
// the portable primitive already used by lib/auth.ts and
// lib/secretCrypto.ts elsewhere in this Worker.
//
// Credentials/redirects come from Env (wrangler.toml [vars] +
// `wrangler secret put GOOGLE_LOGIN_CLIENT_SECRET`), not process.env --
// there is no process.env in a Worker.

import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import type { Env } from '../index'

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
export const CALLBACK_PATH = '/api/auth/oauth/callback'
export const OAUTH_STATE_TTL_SECONDS = 10 * 60
const OAUTH_STATE_MAX_FUTURE_SKEW_MS = 60 * 1000
const DEFAULT_LOGIN_RETURN_PATH = '/login?auth_mode=login&auth_provider=google'
const DEFAULT_LINK_RETURN_PATH = '/?auth_mode=link&auth_provider=google'

export type GoogleOauthUser = {
  id: string
  sub: string
  email: string
  emailVerified: boolean
  name: string
  picture: string
}

export type OauthStatePayload = {
  provider: 'google'
  mode: 'login' | 'link'
  organization?: string
  currentUserId?: number | null
  returnOrigin: string
  returnPath: string
  // No PKCE code_verifier here: `state` travels in URLs (Google's consent
  // URL, the callback URL, browser history, proxy logs), and a verifier next
  // to the authorization code would let whoever sees that URL redeem the
  // code. The verifier lives in the HttpOnly PKCE cookie instead, bound to
  // this nonce -- see setGooglePkceCookie / matchGooglePkceVerifier.
  nonce: string
  createdAt: number
  // Carried through the signed state (rather than looked up again at the
  // callback) so the callback -- which only receives `code`/`state` from
  // Google's redirect, never anything from the original POST body -- can
  // still run the same admin device-approval gate that POST /login runs.
  // See lib/deviceTrust.ts and the callback's device-trust check.
  deviceId?: string | null
  deviceName?: string | null
}

function trim(value: unknown): string {
  return String(value ?? '').trim()
}

function unique(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = trim(value).replace(/\/$/, '')
    if (!clean || seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}

function base64UrlEncodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecodeToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(value.length + ((4 - (value.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function randomBase64Url(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength))
  return base64UrlEncodeBytes(bytes)
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return base64UrlEncodeBytes(new Uint8Array(digest))
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

async function hmacSignBase64Url(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret)
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)))
  return base64UrlEncodeBytes(signature)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// OAUTH_STATE_SECRET is the dedicated HMAC key for the `state` param; the
// owner should set it (wrangler secret / sync-secrets.cjs). The fallbacks keep
// deployments that predate it signing exactly as before -- the last one
// reuses the OAuth client secret as an HMAC key, which is why it is last.
function getStateSecret(env: Env): string {
  return trim(env.OAUTH_STATE_SECRET) || trim(env.AUTH_SESSION_SECRET || env.GOOGLE_LOGIN_CLIENT_SECRET)
}

async function signState(env: Env, payload: OauthStatePayload): Promise<string> {
  const encoded = base64UrlEncodeBytes(new TextEncoder().encode(JSON.stringify(payload || {})))
  const signature = await hmacSignBase64Url(getStateSecret(env), encoded)
  return `${encoded}.${signature}`
}

function oauthStateKey(nonce: string): string {
  return `oauth-state:google-login:${nonce}`
}

export async function verifyState(env: Env, state: string | undefined): Promise<{ success: boolean; payload?: OauthStatePayload; error?: string }> {
  const [encoded, signature] = trim(state).split('.')
  if (!encoded || !signature) return { success: false, error: 'Invalid OAuth state.' }
  const secret = getStateSecret(env)
  if (!secret) return { success: false, error: 'Google OAuth state signing is not configured.' }
  const expected = await hmacSignBase64Url(secret, encoded)
  if (!timingSafeEqual(signature, expected)) return { success: false, error: 'OAuth state failed verification.' }
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecodeToBytes(encoded))) as OauthStatePayload
    const ageMs = Date.now() - Number(payload.createdAt || 0)
    if (payload.provider !== 'google' || !trim(payload.nonce) || !Number.isFinite(ageMs)) {
      return { success: false, error: 'Invalid OAuth state.' }
    }
    if (ageMs < -OAUTH_STATE_MAX_FUTURE_SKEW_MS || ageMs > OAUTH_STATE_TTL_SECONDS * 1000) {
      return { success: false, error: 'OAuth state expired. Please start Google sign-in again.' }
    }
    const key = oauthStateKey(payload.nonce)
    const remembered = await env.CACHE.get(key)
    if (!remembered || !timingSafeEqual(remembered, signature)) {
      return { success: false, error: 'OAuth state was already used or is no longer valid.' }
    }
    // Consume before exchanging the authorization code. Google's code is
    // one-time too, while this delete also stops callback retries from
    // reaching account-link/session mutation code.
    await env.CACHE.delete(key)
    return { success: true, payload }
  } catch (_) {
    return { success: false, error: 'OAuth state could not be decoded.' }
  }
}

// -- PKCE verifier cookie ----------------------------------------------------
// The browser that STARTED the flow holds the verifier, not the URL. POST
// /oauth/start sets this cookie; GET /oauth/callback must present it, its
// nonce must match the signed state's, and it is cleared on every outcome.
// HttpOnly (no script reads it), Secure, path-scoped to the callback, and as
// short-lived as the state itself. SameSite=Lax, not Strict: Google's redirect
// back to the callback is a cross-site top-level GET, which Strict would drop.
export const GOOGLE_PKCE_COOKIE_NAME = 'bos_google_pkce'
const PKCE_COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'Lax' as const, path: CALLBACK_PATH }

export function setGooglePkceCookie(c: Context, binding: string): void {
  setCookie(c, GOOGLE_PKCE_COOKIE_NAME, binding, { ...PKCE_COOKIE_OPTIONS, maxAge: OAUTH_STATE_TTL_SECONDS })
}

// Reads the cookie and clears it on the response in the same step; the
// callback calls this first, before anything else can return, so the cookie
// is gone whatever the outcome.
export function takeGooglePkceCookie(c: Context): string {
  const raw = trim(getCookie(c, GOOGLE_PKCE_COOKIE_NAME))
  deleteCookie(c, GOOGLE_PKCE_COOKIE_NAME, PKCE_COOKIE_OPTIONS)
  return raw
}

// The verifier, only when the cookie's nonce matches the signed state's
// nonce (constant-time compare).
export function matchGooglePkceVerifier(raw: string, stateNonce: string | undefined): { success: boolean; codeVerifier?: string; error?: string } {
  const restart = 'Please start Google sign-in again from this browser.'
  if (!raw) return { success: false, error: `This browser did not start this Google sign-in. ${restart}` }
  const [cookieNonce, codeVerifier, extra] = raw.split('.')
  const expectedNonce = trim(stateNonce)
  if (extra !== undefined || !cookieNonce || !codeVerifier || !expectedNonce || !timingSafeEqual(cookieNonce, expectedNonce)) {
    return { success: false, error: `Google sign-in could not be matched to this browser. ${restart}` }
  }
  return { success: true, codeVerifier }
}

export function getGoogleLoginOrigins(env: Env): string[] {
  return unique([env.BUSINESS_OS_ADMIN_URL, env.BUSINESS_OS_PUBLIC_URL])
}

export function getGoogleLoginRedirectUris(env: Env): string[] {
  const configured = trim(env.GOOGLE_LOGIN_REDIRECT_URI)
  const derived = getGoogleLoginOrigins(env).map((origin) => `${origin}${CALLBACK_PATH}`)
  return unique([configured, ...derived])
}

function getPrimaryRedirectUri(env: Env): string {
  return trim(env.GOOGLE_LOGIN_REDIRECT_URI) || getGoogleLoginRedirectUris(env)[0] || ''
}

function getDefaultReturnPath(mode: string): string {
  return trim(mode).toLowerCase() === 'link' ? DEFAULT_LINK_RETURN_PATH : DEFAULT_LOGIN_RETURN_PATH
}

export function normalizeReturnTarget(env: Env, input: string | undefined, mode: string): { origin: string; path: string; url: string } {
  const fallbackOrigin = getGoogleLoginOrigins(env)[0] || ''
  const fallbackPath = getDefaultReturnPath(mode)
  const raw = trim(input)
  if (!raw) return { origin: fallbackOrigin, path: fallbackPath, url: `${fallbackOrigin}${fallbackPath}` }
  try {
    const parsed = new URL(raw)
    const allowed = new Set(getGoogleLoginOrigins(env))
    if (!allowed.has(parsed.origin)) return { origin: fallbackOrigin, path: fallbackPath, url: `${fallbackOrigin}${fallbackPath}` }
    const path = `${parsed.pathname || '/'}${parsed.search || ''}${parsed.hash || ''}` || fallbackPath
    return { origin: parsed.origin, path, url: `${parsed.origin}${path}` }
  } catch (_) {
    return { origin: fallbackOrigin, path: fallbackPath, url: `${fallbackOrigin}${fallbackPath}` }
  }
}

// True only when every piece a link/sign-in round trip needs is present:
// the client id (consent URL), the client secret (code exchange), a state
// signing secret and a redirect URI. `getGoogleLoginPublicConfig().enabled`
// only checks the client id, so a deployment missing the secret would offer a
// Connect button whose callback can never succeed. My Profile's Google card
// reads this through GET /users/:id/auth-methods.
export function isGoogleLinkReady(env: Env): boolean {
  return !!trim(env.GOOGLE_LOGIN_CLIENT_ID)
    && !!trim(env.GOOGLE_LOGIN_CLIENT_SECRET)
    && !!getStateSecret(env)
    && !!getPrimaryRedirectUri(env)
}

export function getGoogleLoginPublicConfig(env: Env) {
  const clientId = trim(env.GOOGLE_LOGIN_CLIENT_ID)
  return {
    enabled: !!clientId,
    clientId,
    hasClientSecret: !!trim(env.GOOGLE_LOGIN_CLIENT_SECRET),
    provider: 'google',
    callbackPath: CALLBACK_PATH,
    authorizedJavaScriptOrigins: getGoogleLoginOrigins(env),
    authorizedRedirectUris: getGoogleLoginRedirectUris(env),
  }
}

export async function buildGoogleOauthStartUrl(
  env: Env,
  options: { mode?: string; organization?: string; currentUserId?: number | null; returnTo?: string; deviceId?: string | null; deviceName?: string | null },
): Promise<{ success: boolean; error?: string; url?: string; mode?: string; pkceBinding?: string }> {
  const clientId = trim(env.GOOGLE_LOGIN_CLIENT_ID)
  if (!clientId) return { success: false, error: 'Google login client ID is not configured.' }
  if (!getStateSecret(env)) return { success: false, error: 'Google OAuth state signing is not configured.' }
  const mode = trim(options.mode).toLowerCase() === 'link' ? 'link' : 'login'
  const codeVerifier = randomBase64Url(32)
  const nonce = randomBase64Url(16)
  const redirectUri = getPrimaryRedirectUri(env)
  if (!redirectUri) return { success: false, error: 'Google login redirect URI is not configured.' }
  const returnTarget = normalizeReturnTarget(env, options.returnTo, mode)
  const state = await signState(env, {
    provider: 'google',
    mode: mode as 'login' | 'link',
    organization: trim(options.organization),
    currentUserId: Number(options.currentUserId || 0) || null,
    returnOrigin: returnTarget.origin,
    returnPath: returnTarget.path,
    nonce,
    createdAt: Date.now(),
    deviceId: trim(options.deviceId) || null,
    deviceName: trim(options.deviceName) || null,
  })
  await env.CACHE.put(oauthStateKey(nonce), state.split('.')[1], { expirationTtl: OAUTH_STATE_TTL_SECONDS })
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', await sha256Base64Url(codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', mode === 'link' ? 'consent' : 'select_account')
  // The caller must hand pkceBinding to setGooglePkceCookie on its response.
  return { success: true, url: url.toString(), mode, pkceBinding: `${nonce}.${codeVerifier}` }
}

export async function exchangeGoogleOauthCode(
  env: Env,
  code: string | undefined,
  pkce: { codeVerifier?: string },
): Promise<{ success: boolean; error?: string; tokens?: Record<string, unknown> }> {
  const codeValue = trim(code)
  if (!codeValue) return { success: false, error: 'Google OAuth code is required.' }
  // Every code this app requests is PKCE-bound (S256 challenge at start), so
  // never attempt a redemption without the verifier.
  if (!trim(pkce?.codeVerifier)) return { success: false, error: 'Google sign-in verifier is missing. Please start again.' }
  const clientSecret = trim(env.GOOGLE_LOGIN_CLIENT_SECRET)
  if (!clientSecret) return { success: false, error: 'Google login client secret is not configured.' }
  const body = new URLSearchParams()
  body.set('client_id', trim(env.GOOGLE_LOGIN_CLIENT_ID))
  body.set('client_secret', clientSecret)
  body.set('code', codeValue)
  body.set('grant_type', 'authorization_code')
  body.set('redirect_uri', getPrimaryRedirectUri(env))
  body.set('code_verifier', trim(pkce.codeVerifier))
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = await response.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
  if (!response.ok) {
    return { success: false, error: String(payload.error_description || payload.error || 'Google token exchange failed.') }
  }
  return { success: true, tokens: payload }
}

export async function getGoogleUserFromTokens(tokens: Record<string, unknown>): Promise<{ success: boolean; error?: string; user?: GoogleOauthUser }> {
  const accessToken = trim(tokens.access_token)
  if (!accessToken) return { success: false, error: 'Google access token is missing.' }
  const response = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } })
  const user = await response.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
  if (!response.ok || !user.sub) return { success: false, error: String(user.error_description || user.error || 'Google user lookup failed.') }
  return {
    success: true,
    user: {
      id: String(user.sub || ''),
      sub: String(user.sub || ''),
      email: trim(user.email).toLowerCase(),
      emailVerified: user.email_verified === true || user.email_verified === 'true',
      name: trim(user.name),
      picture: trim(user.picture),
    },
  }
}
