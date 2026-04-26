'use strict'

const fs = require('fs')
const crypto = require('crypto')

/**
 * 1. Firebase Auth Service
 * 1.1 Purpose
 * - Wrap Firebase Identity Toolkit calls for login/password/account sync.
 * - Provide public capability metadata for frontend feature gating.
 */

/**
 * 1.2 Primitive Parsers
 */
function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function trim(value) {
  return String(value || '').trim()
}

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n').trim()
}

function parseJsonSafe(value) {
  try { return JSON.parse(value) } catch (_) { return null }
}

/**
 * 1.3 Service Account Resolution
 * 1.3.1 Supports JSON string, file path, base64 JSON, or env key pair fallback.
 */
function loadServiceAccount() {
  const raw = trim(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '')
  if (raw) {
    if (raw.startsWith('{')) {
      const parsed = parseJsonSafe(raw)
      if (parsed) return parsed
    }
    if (fs.existsSync(raw)) {
      try {
        const fileParsed = parseJsonSafe(fs.readFileSync(raw, 'utf8'))
        if (fileParsed) return fileParsed
      } catch (_) {}
    }
    try {
      const decoded = Buffer.from(raw, 'base64').toString('utf8')
      const parsed = parseJsonSafe(decoded)
      if (parsed) return parsed
    } catch (_) {}
  }

  const clientEmail = trim(process.env.FIREBASE_CLIENT_EMAIL || '')
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY || '')
  if (clientEmail && privateKey) {
    return {
      type: 'service_account',
      project_id: trim(process.env.FIREBASE_PROJECT_ID || ''),
      private_key_id: trim(process.env.FIREBASE_PRIVATE_KEY_ID || ''),
      private_key: privateKey,
      client_email: clientEmail,
      client_id: trim(process.env.FIREBASE_CLIENT_ID || ''),
      token_uri: 'https://oauth2.googleapis.com/token',
    }
  }

  return null
}

const FIREBASE_AUTH_ENABLED = truthy(process.env.FIREBASE_AUTH_ENABLED || 'false')
const FIREBASE_API_KEY = trim(process.env.FIREBASE_API_KEY || '')
const FIREBASE_PROJECT_ID = trim(process.env.FIREBASE_PROJECT_ID || '')
const FIREBASE_AUTH_DOMAIN = trim(process.env.FIREBASE_AUTH_DOMAIN || (FIREBASE_PROJECT_ID ? `${FIREBASE_PROJECT_ID}.firebaseapp.com` : ''))
const FIREBASE_WEB_APP_ID = trim(process.env.FIREBASE_WEB_APP_ID || '')
const FIREBASE_WEB_MESSAGING_SENDER_ID = trim(process.env.FIREBASE_WEB_MESSAGING_SENDER_ID || '')
const FIREBASE_WEB_STORAGE_BUCKET = trim(process.env.FIREBASE_WEB_STORAGE_BUCKET || '')
const SERVICE_ACCOUNT = loadServiceAccount()

let cachedAccessToken = ''
let cachedAccessTokenExpiresAt = 0

function isFirebaseAuthConfigured() {
  return !!(FIREBASE_AUTH_ENABLED && FIREBASE_API_KEY && FIREBASE_PROJECT_ID)
}

function isFirebasePhoneVerificationConfigured() {
  return false
}

function hasFirebaseAdminCredentials() {
  return !!(SERVICE_ACCOUNT?.client_email && SERVICE_ACCOUNT?.private_key)
}

function base64Url(value) {
  return Buffer
    .from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function buildGoogleServiceJwt() {
  if (!hasFirebaseAdminCredentials()) {
    return { success: false, error: 'Firebase service account credentials are not configured.' }
  }
  try {
    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'RS256', typ: 'JWT' }
    const claim = {
      iss: SERVICE_ACCOUNT.client_email,
      sub: SERVICE_ACCOUNT.client_email,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
      scope: 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform',
    }
    const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(claim))}`
    const signer = crypto.createSign('RSA-SHA256')
    signer.update(unsigned)
    signer.end()
    const signature = signer.sign(SERVICE_ACCOUNT.private_key)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '')
    return { success: true, jwt: `${unsigned}.${signature}` }
  } catch (error) {
    return { success: false, error: error?.message || 'Failed to sign Firebase service token.' }
  }
}

async function getGoogleAccessToken() {
  if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt) {
    return { success: true, token: cachedAccessToken }
  }

  const signed = buildGoogleServiceJwt()
  if (!signed.success) return { success: false, error: signed.error }

  try {
    const body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signed.jwt,
    })
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) {
      return {
        success: false,
        error: json?.error_description || json?.error || `OAuth token request failed (${response.status})`,
      }
    }
    const token = trim(json?.access_token || '')
    const expiresInSeconds = Number(json?.expires_in || 3600)
    if (!token) return { success: false, error: 'OAuth token response missing access_token.' }
    cachedAccessToken = token
    cachedAccessTokenExpiresAt = Date.now() + Math.max(60, expiresInSeconds - 60) * 1000
    return { success: true, token }
  } catch (error) {
    return { success: false, error: error?.message || 'OAuth token request failed.' }
  }
}

function normalizeProviderError(errorCode, fallback = '') {
  const code = String(errorCode || '').trim().toUpperCase()
  if (!code) return fallback || 'Firebase authentication request failed.'
  if (code.includes('INVALID_PASSWORD') || code.includes('EMAIL_NOT_FOUND') || code.includes('INVALID_LOGIN_CREDENTIALS')) {
    return 'Invalid username or password'
  }
  if (code.includes('USER_DISABLED')) return 'User account is inactive'
  if (code.includes('TOO_MANY_ATTEMPTS_TRY_LATER') || code.includes('TOO_MANY_ATTEMPTS')) {
    return 'Too many attempts. Please try again shortly.'
  }
  if (code.includes('EMAIL_EXISTS')) return 'Email is already registered in authentication provider.'
  if (code.includes('WEAK_PASSWORD')) return 'Password must be at least 6 characters for Firebase authentication.'
  if (code.includes('INSUFFICIENT_PERMISSION')) return 'Firebase admin permission is missing or invalid.'
  if (code.includes('PROJECT_NOT_FOUND')) return 'Firebase project was not found.'
  return fallback || `Firebase auth error: ${code}`
}

function parseResponseData(text) {
  try { return text ? JSON.parse(text) : null } catch (_) { return { raw: text } }
}

async function callFirebasePublic(path, body = {}) {
  if (!isFirebaseAuthConfigured()) {
    return { ok: false, status: 0, error: 'Firebase auth is not configured.', data: null }
  }
  try {
    const url = `https://identitytoolkit.googleapis.com/v1/${path}?key=${encodeURIComponent(FIREBASE_API_KEY)}`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    })
    const text = await response.text()
    const data = parseResponseData(text)
    if (!response.ok) {
      const providerCode = data?.error?.message || data?.error || ''
      return {
        ok: false,
        status: response.status,
        error: normalizeProviderError(providerCode, `Firebase request failed (${response.status})`),
        providerCode,
        data,
      }
    }
    return { ok: true, status: response.status, error: '', providerCode: '', data }
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || 'Firebase request failed.', providerCode: '', data: null }
  }
}

async function callFirebaseAdmin(path, body = {}) {
  if (!isFirebaseAuthConfigured()) {
    return { ok: false, status: 0, error: 'Firebase auth is not configured.', data: null }
  }
  const access = await getGoogleAccessToken()
  if (!access.success) return { ok: false, status: 0, error: access.error || 'Firebase admin auth failed.', data: null }

  try {
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(FIREBASE_PROJECT_ID)}${path}?key=${encodeURIComponent(FIREBASE_API_KEY)}`
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access.token}`,
      },
      body: JSON.stringify(body || {}),
    })
    const text = await response.text()
    const data = parseResponseData(text)
    if (!response.ok) {
      const providerCode = data?.error?.message || data?.error || ''
      return {
        ok: false,
        status: response.status,
        error: normalizeProviderError(providerCode, `Firebase admin request failed (${response.status})`),
        providerCode,
        data,
      }
    }
    return { ok: true, status: response.status, error: '', providerCode: '', data }
  } catch (error) {
    return { ok: false, status: 0, error: error?.message || 'Firebase admin request failed.', providerCode: '', data: null }
  }
}

function normalizeEmail(value) {
  const email = trim(value || '').toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''
}

function normalizeE164(value) {
  const cleaned = trim(value || '').replace(/[^\d+]/g, '')
  if (!cleaned.startsWith('+')) return ''
  const digits = cleaned.slice(1)
  if (digits.length < 8 || digits.length > 15) return ''
  return `+${digits}`
}

function getFirebaseAuthPublicConfig() {
  const enabled = isFirebaseAuthConfigured()
  return {
    enabled,
    projectId: FIREBASE_PROJECT_ID || '',
    hasApiKey: !!FIREBASE_API_KEY,
    hasAdminCredentials: hasFirebaseAdminCredentials(),
    phoneEnabled: false,
    web: null,
  }
}

async function createOrUpdateAuthUser(localUser, password = '') {
  if (!isFirebaseAuthConfigured()) return { success: false, skipped: true, reason: 'not_configured' }
  if (!hasFirebaseAdminCredentials()) {
    return { success: false, error: 'Firebase admin credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON.' }
  }

  const email = normalizeEmail(localUser?.email)
  if (!email) return { success: false, skipped: true, reason: 'missing_email' }

  const firebaseUserId = trim(localUser?.firebase_user_id || '')
  const candidatePassword = String(password || '')
  const payload = {
    email,
    emailVerified: Number(localUser?.email_verified || 0) === 1,
    displayName: trim(localUser?.name || localUser?.username || ''),
    disableUser: !(Number(localUser?.is_active || 0) === 1) || !!localUser?.deleted_at,
  }

  if (firebaseUserId) {
    const updatePayload = { localId: firebaseUserId, ...payload }
    if (candidatePassword) {
      if (candidatePassword.length < 6) {
        return { success: false, error: 'Password must be at least 6 characters for Firebase authentication.' }
      }
      updatePayload.password = candidatePassword
    }
    const result = await callFirebaseAdmin('/accounts:update', updatePayload)
    if (!result.ok) return { success: false, error: result.error }
    return { success: true, userId: firebaseUserId, created: false }
  }

  if (!candidatePassword) return { success: false, skipped: true, reason: 'missing_password' }
  if (candidatePassword.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters for Firebase authentication.' }
  }

  const result = await callFirebaseAdmin('/accounts', { ...payload, password: candidatePassword })
  if (!result.ok) return { success: false, error: result.error }
  return { success: true, userId: trim(result?.data?.localId || ''), created: true }
}

async function updateAuthPassword(firebaseUserId, newPassword) {
  if (!isFirebaseAuthConfigured()) return { success: false, skipped: true, reason: 'not_configured' }
  if (!hasFirebaseAdminCredentials()) {
    return { success: false, error: 'Firebase admin credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON.' }
  }

  const userId = trim(firebaseUserId || '')
  if (!userId) return { success: false, skipped: true, reason: 'missing_user_id' }
  const password = String(newPassword || '')
  if (!password) return { success: false, skipped: true, reason: 'missing_password' }
  if (password.length < 6) {
    return { success: false, error: 'Password must be at least 6 characters for Firebase authentication.' }
  }

  const result = await callFirebaseAdmin('/accounts:update', { localId: userId, password })
  if (!result.ok) return { success: false, error: result.error }
  return { success: true }
}

async function setAuthUserActive(firebaseUserId, isActive) {
  if (!isFirebaseAuthConfigured()) return { success: false, skipped: true, reason: 'not_configured' }
  if (!hasFirebaseAdminCredentials()) {
    return { success: false, error: 'Firebase admin credentials are not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON.' }
  }

  const userId = trim(firebaseUserId || '')
  if (!userId) return { success: false, skipped: true, reason: 'missing_user_id' }
  const result = await callFirebaseAdmin('/accounts:update', { localId: userId, disableUser: !isActive })
  if (!result.ok) return { success: false, error: result.error }
  return { success: true }
}

async function verifyPasswordWithFirebase(localUser, password) {
  if (!isFirebaseAuthConfigured()) return { success: false, skipped: true, reason: 'not_configured' }
  const email = normalizeEmail(localUser?.email)
  if (!email) return { success: false, skipped: true, reason: 'missing_email' }
  const result = await callFirebasePublic('accounts:signInWithPassword', {
    email,
    password: String(password || ''),
    returnSecureToken: true,
  })
  if (!result.ok) return { success: false, error: result.error, providerCode: result.providerCode || '' }

  const returnedUserId = trim(result?.data?.localId || '')
  if (trim(localUser?.firebase_user_id || '') && returnedUserId && trim(localUser.firebase_user_id) !== returnedUserId) {
    return { success: false, error: 'Authentication account mismatch. Please contact admin.' }
  }

  return { success: true, userId: returnedUserId || trim(localUser?.firebase_user_id || '') }
}

module.exports = {
  isFirebaseAuthConfigured,
  isFirebasePhoneVerificationConfigured,
  getFirebaseAuthPublicConfig,
  createOrUpdateAuthUser,
  updateAuthPassword,
  setAuthUserActive,
  verifyPasswordWithFirebase,
  normalizeE164,
}
