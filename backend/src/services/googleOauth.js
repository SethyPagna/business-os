'use strict'

const crypto = require('crypto')
const {
  CLOUDFLARE_ADMIN_URL,
  CLOUDFLARE_PUBLIC_URL,
  DEFAULT_GOOGLE_LOGIN_CLIENT_ID,
  GOOGLE_LOGIN_CLIENT_ID,
  GOOGLE_LOGIN_CLIENT_SECRET,
  GOOGLE_LOGIN_REDIRECT_URI,
  PUBLIC_BASE_URL,
} = require('../config')

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
const CALLBACK_PATH = '/api/auth/oauth/callback'
const LOCAL_ORIGIN = 'http://localhost:4000'
const STATIC_ORIGINS = [
  'https://admin.leangcosmetics.dpdns.org',
  'https://leangcosmetics.dpdns.org',
  LOCAL_ORIGIN,
]

function trim(value) {
  return String(value || '').trim()
}

function unique(values = []) {
  return Array.from(new Set(values.map((value) => trim(value).replace(/\/$/, '')).filter(Boolean)))
}

function getGoogleLoginOrigins() {
  return unique([
    CLOUDFLARE_ADMIN_URL,
    CLOUDFLARE_PUBLIC_URL,
    PUBLIC_BASE_URL,
    ...STATIC_ORIGINS,
  ])
}

function getGoogleLoginRedirectUris() {
  const configured = trim(GOOGLE_LOGIN_REDIRECT_URI)
  return unique([
    configured,
    ...getGoogleLoginOrigins().map((origin) => `${origin}${CALLBACK_PATH}`),
  ])
}

function getPrimaryRedirectUri() {
  return trim(GOOGLE_LOGIN_REDIRECT_URI) || getGoogleLoginRedirectUris()[0] || `${LOCAL_ORIGIN}${CALLBACK_PATH}`
}

function base64url(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input || ''), 'utf8')
  return bytes.toString('base64url')
}

function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('base64url')
}

function getStateSecret() {
  return trim(process.env.AUTH_SESSION_SECRET || process.env.SYNC_TOKEN || GOOGLE_LOGIN_CLIENT_SECRET || 'business-os-google-login-state')
}

function signState(payload) {
  const encoded = base64url(JSON.stringify(payload || {}))
  const signature = crypto.createHmac('sha256', getStateSecret()).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

function verifyState(state) {
  const [encoded, signature] = String(state || '').split('.')
  if (!encoded || !signature) return { success: false, error: 'Invalid OAuth state.' }
  const expected = crypto.createHmac('sha256', getStateSecret()).update(encoded).digest('base64url')
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return { success: false, error: 'OAuth state failed verification.' }
  }
  try {
    return { success: true, payload: JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) }
  } catch (_) {
    return { success: false, error: 'OAuth state could not be decoded.' }
  }
}

function getGoogleLoginPublicConfig() {
  const clientId = trim(GOOGLE_LOGIN_CLIENT_ID || DEFAULT_GOOGLE_LOGIN_CLIENT_ID)
  return {
    enabled: !!clientId,
    clientId,
    hasClientSecret: !!GOOGLE_LOGIN_CLIENT_SECRET,
    provider: 'google',
    callbackPath: CALLBACK_PATH,
    authorizedJavaScriptOrigins: getGoogleLoginOrigins(),
    authorizedRedirectUris: getGoogleLoginRedirectUris(),
  }
}

function buildGoogleOauthStartUrl(options = {}) {
  const clientId = trim(options.clientId || GOOGLE_LOGIN_CLIENT_ID || DEFAULT_GOOGLE_LOGIN_CLIENT_ID)
  if (!clientId) return { success: false, error: 'Google login client ID is not configured.' }
  const mode = trim(options.mode).toLowerCase() === 'link' ? 'link' : 'login'
  const codeVerifier = trim(options.codeVerifier) || crypto.randomBytes(32).toString('base64url')
  const redirectUri = trim(options.redirectUri) || getPrimaryRedirectUri()
  const state = signState({
    provider: 'google',
    mode,
    organization: trim(options.organization),
    currentUserId: Number(options.currentUserId || 0) || null,
    codeVerifier,
    nonce: trim(options.stateNonce) || crypto.randomBytes(16).toString('base64url'),
    createdAt: Date.now(),
  })
  const url = new URL(GOOGLE_AUTH_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'openid email profile')
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', sha256Base64Url(codeVerifier))
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', mode === 'link' ? 'consent' : 'select_account')
  return { success: true, url: url.toString(), mode, state, codeVerifier, redirectUri }
}

async function exchangeGoogleOauthCode(code, statePayload = {}) {
  const codeValue = trim(code)
  if (!codeValue) return { success: false, error: 'Google OAuth code is required.' }
  if (!GOOGLE_LOGIN_CLIENT_SECRET) return { success: false, error: 'Google login client secret is not configured.' }
  const body = new URLSearchParams()
  body.set('client_id', trim(GOOGLE_LOGIN_CLIENT_ID || DEFAULT_GOOGLE_LOGIN_CLIENT_ID))
  body.set('client_secret', GOOGLE_LOGIN_CLIENT_SECRET)
  body.set('code', codeValue)
  body.set('grant_type', 'authorization_code')
  body.set('redirect_uri', getPrimaryRedirectUri())
  if (statePayload.codeVerifier) body.set('code_verifier', String(statePayload.codeVerifier))
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    return { success: false, error: payload.error_description || payload.error || 'Google token exchange failed.' }
  }
  return { success: true, tokens: payload }
}

async function getGoogleUserFromTokens(tokens = {}) {
  const accessToken = trim(tokens.access_token)
  if (!accessToken) return { success: false, error: 'Google access token is missing.' }
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const user = await response.json().catch(() => ({}))
  if (!response.ok || !user.sub) return { success: false, error: user.error_description || user.error || 'Google user lookup failed.' }
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

module.exports = {
  CALLBACK_PATH,
  buildGoogleOauthStartUrl,
  exchangeGoogleOauthCode,
  getGoogleLoginOrigins,
  getGoogleLoginPublicConfig,
  getGoogleLoginRedirectUris,
  getGoogleUserFromTokens,
  verifyState,
}
