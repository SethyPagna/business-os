'use strict'
/**
 * auth.js
 * Authentication and account-recovery routes.
 *
 * Responsibilities:
 * - Password login (username/email identifier).
 * - OTP 2FA verification and setup lifecycle.
 * - One-time-code login and password reset flows.
 * - Provider-aware auth behavior (local bootstrap password + Supabase sync).
 *
 * Data interconnections:
 * - Reads/writes `users` (password/otp/email verification state).
 * - Reads/writes `verification_codes` (via verification service).
 * - Writes `audit_logs` for auth events.
 */

const express = require('express')
const bcrypt = require('bcryptjs')
const speakeasy = require('speakeasy')
const qrcode = require('qrcode')
const { db } = require('../database')
const { ok, err, audit, logOp, tryParse } = require('../helpers')
const { authToken } = require('../middleware')
const {
  encryptSecret,
  decryptSecret,
  checkRateLimit,
  resetRateLimit,
  checkAbuseLock,
  recordAbuseFailure,
  clearAbuseFailure,
} = require('../security')
const {
  isSupabaseAuthConfigured,
  getSupabaseAuthPublicConfig,
  createOrUpdateAuthUser,
  verifyPasswordWithSupabase,
  updateAuthPassword,
  getAuthUserFromAccessToken,
  buildOauthStartUrl,
} = require('../services/supabaseAuth')
const {
  getVerificationCapabilities,
  normalizeEmail,
  resolveChannel,
  getDestinationForChannel,
  requestVerificationCode,
  verifyCode,
} = require('../services/verification')

const router = express.Router()

const LOGIN_LIMIT_MAX = Math.max(1, Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 8))
const LOGIN_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_LOGIN_WINDOW_MS || 10 * 60 * 1000))
const OTP_LIMIT_MAX = Math.max(1, Number(process.env.AUTH_OTP_MAX_ATTEMPTS || 10))
const OTP_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_OTP_WINDOW_MS || 10 * 60 * 1000))
const CODE_REQUEST_LIMIT_MAX = Math.max(1, Number(process.env.AUTH_CODE_REQUEST_MAX_ATTEMPTS || 5))
const CODE_REQUEST_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_CODE_REQUEST_WINDOW_MS || 15 * 60 * 1000))
const CODE_VERIFY_LIMIT_MAX = Math.max(1, Number(process.env.AUTH_CODE_VERIFY_MAX_ATTEMPTS || 10))
const CODE_VERIFY_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_CODE_VERIFY_WINDOW_MS || 15 * 60 * 1000))
const LOGIN_LOCK_THRESHOLD = Math.max(1, Number(process.env.AUTH_LOGIN_LOCK_THRESHOLD || 12))
const LOGIN_LOCK_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_LOGIN_LOCK_WINDOW_MS || 15 * 60 * 1000))
const LOGIN_LOCK_DURATION_MS = Math.max(1000, Number(process.env.AUTH_LOGIN_LOCK_DURATION_MS || 15 * 60 * 1000))

/**
 * 1. Shared Helpers
 * 1.1 Client identity key for request throttling.
 */
function getClientKey(req, identifier = '') {
  const xForwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const ip = xForwardedFor || req.ip || req.connection?.remoteAddress || 'unknown-ip'
  return `${ip}|${String(identifier || '').trim().toLowerCase()}`
}

/**
 * 1.2 Apply bucketed request rate limiting to an auth route.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{bucket:string,key:string,max:number,windowMs:number,message:string}} options
 * @returns {boolean} true when allowed; false when limited (response already sent)
 */
function applyRateLimit(req, res, { bucket, key, max, windowMs, message }) {
  const result = checkRateLimit(bucket, key, max, windowMs)
  if (result.allowed) return true
  res.setHeader('Retry-After', String(result.retryAfterSeconds))
  err(res, `${message} Try again in ${result.retryAfterSeconds} seconds.`, 429)
  return false
}

/**
 * 1.3 Normalize user-entered login identifier into a lock bucket key.
 * Truncates key length to reduce memory pressure in abuse-lock storage.
 */
function getLoginLockKey(identifier) {
  return String(identifier || '').trim().toLowerCase().slice(0, 160)
}

/**
 * 1.4 Redact a login identifier for audit trails.
 */
function loginIdentifierPreview(identifier) {
  const value = String(identifier || '').trim()
  if (!value) return ''
  if (value.length <= 3) return '*'.repeat(value.length)
  return `${value.slice(0, 3)}***`
}

/**
 * 1.5 Standardized failed-login path:
 * - operation timing log
 * - abuse counter + lock escalation
 * - audit row
 * - HTTP 401 or 429
 */
function rejectLogin(res, t0, lockKey, identifierPreview, reason = 'invalid_credentials') {
  logOp('auth:login', Date.now() - t0, false)
  const lockState = recordAbuseFailure('auth:login_lock', lockKey, {
    threshold: LOGIN_LOCK_THRESHOLD,
    windowMs: LOGIN_LOCK_WINDOW_MS,
    lockMs: LOGIN_LOCK_DURATION_MS,
  })
  audit(null, null, 'login_failed', 'auth', null, {
    identifier: identifierPreview || null,
    reason,
    locked: lockState.locked,
  })
  if (lockState.locked) {
    res.setHeader('Retry-After', String(lockState.retryAfterSeconds))
    return err(res, `Too many failed login attempts. Try again in ${lockState.retryAfterSeconds} seconds.`, 429)
  }
  return err(res, 'Invalid username or password', 401)
}

/**
 * 1.6 Decrypt stored OTP secret for TOTP checks.
 */
function getOtpSecret(user, field = 'otp_secret') {
  return decryptSecret(user?.[field] || '')
}

/**
 * 1.7 Build API-safe user payload:
 * - strips password and otp_secret
 * - merges role permissions + user overrides
 */
function buildUserPayload(user) {
  const {
    password: _pw,
    otp_secret: _sec,
    otp_pending_secret: _pendingSec,
    otp_pending_created_at: _pendingCreatedAt,
    ...safeUser
  } = user
  const userPerms = tryParse(safeUser.permissions, {})
  let mergedPerms = { ...userPerms }
  if (safeUser.role_id) {
    const role = db.prepare('SELECT name, permissions FROM roles WHERE id = ?').get(safeUser.role_id)
    if (role) {
      const rolePerms = tryParse(role.permissions, {})
      mergedPerms = { ...rolePerms, ...userPerms }
      safeUser.role_name = role.name
    }
  }
  return { ...safeUser, permissions: JSON.stringify(mergedPerms) }
}

/**
 * 1.8 Lookup active user by username/email.
 * @param {string} identifier
 * @param {{requireVerifiedContact?: boolean}} options
 */
function findUserByIdentifier(identifier, options = {}) {
  const requireVerifiedContact = !!options.requireVerifiedContact
  const value = String(identifier || '').trim()
  if (!value) return null

  const byUsername = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1 AND deleted_at IS NULL').get(value)
  if (byUsername) return byUsername

  const email = normalizeEmail(value)
  if (email) {
    const byEmail = db.prepare('SELECT * FROM users WHERE lower(trim(email)) = ? AND is_active = 1 AND deleted_at IS NULL').get(email)
    if (byEmail) {
      if (requireVerifiedContact && Number(byEmail.email_verified || 0) !== 1) return null
      return byEmail
    }
  }

  return null
}

/**
 * 1.9 Only supported verification method in this build:
 * - `auto` or `email`
 */
function normalizeVerificationMethod(method) {
  const value = String(method || 'auto').trim().toLowerCase()
  if (value === 'auto' || value === 'email') return value
  return ''
}

function normalizeOauthMode(mode) {
  const value = String(mode || 'login').trim().toLowerCase()
  return value === 'link' ? 'link' : 'login'
}

function isEmailIdentifier(identifier) {
  return !!normalizeEmail(identifier)
}

function getUserById(userId) {
  return db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(userId)
}

function updateLocalUserSupabaseIdentity(userId, authUser = {}) {
  const supabaseUserId = String(authUser?.id || '').trim() || null
  const email = normalizeEmail(authUser?.email || '') || null
  const emailVerified = authUser?.emailConfirmed ? 1 : 0
  db.prepare(`
    UPDATE users
    SET supabase_user_id = COALESCE(NULLIF(?, ''), supabase_user_id),
        email = COALESCE(?, email),
        email_verified = CASE
          WHEN ? = 1 THEN 1
          ELSE email_verified
        END
    WHERE id = ?
  `).run(supabaseUserId, email, emailVerified, userId)
  return getUserById(userId)
}

router.get('/verification-capabilities', (_req, res) => {
  const capabilities = getVerificationCapabilities()
  const supabase = getSupabaseAuthPublicConfig()
  ok(res, {
    ...capabilities,
    supabase_auth: supabase.enabled,
    google_oauth: supabase.googleEnabled,
    facebook_oauth: supabase.facebookEnabled,
    supabase_email_auth: supabase.emailAuthEnabled,
    supabase_magic_link: supabase.magicLinkEnabled,
    supabase_invite: supabase.inviteEnabled,
    supabase_mfa_totp: supabase.mfaTotpEnabled,
  })
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const t0 = Date.now()
  const { username, password, clientTime, deviceTz, deviceName } = req.body || {}
  if (!username || !password) return err(res, 'Username or email and password are required')
  const lockKey = getLoginLockKey(username)
  const lockState = checkAbuseLock('auth:login_lock', lockKey, LOGIN_LOCK_WINDOW_MS)
  if (lockState.locked) {
    res.setHeader('Retry-After', String(lockState.retryAfterSeconds))
    return err(res, `Too many failed login attempts. Try again in ${lockState.retryAfterSeconds} seconds.`, 429)
  }

  const limitKey = getClientKey(req, username)
  if (!applyRateLimit(req, res, {
    bucket: 'auth:login',
    key: limitKey,
    max: LOGIN_LIMIT_MAX,
    windowMs: LOGIN_LIMIT_WINDOW_MS,
    message: 'Too many login attempts.',
  })) return

  const user = findUserByIdentifier(username, { requireVerifiedContact: false })
  if (!user) {
    return rejectLogin(res, t0, lockKey, loginIdentifierPreview(username))
  }

  const hasVerifiedSupabaseIdentity = Number(user.email_verified || 0) === 1
  const useSupabasePassword = !!(
    isSupabaseAuthConfigured()
    && isEmailIdentifier(username)
    && user.supabase_user_id
    && user.email
    && hasVerifiedSupabaseIdentity
  )
  if (useSupabasePassword) {
    const supabaseAuth = await verifyPasswordWithSupabase(user, password)
    if (!supabaseAuth.success) {
      const availabilityError = /unavailable|failed|timed out|request|network/i.test(String(supabaseAuth.error || ''))
      if (availabilityError) return err(res, 'Authentication provider unavailable. Please try again shortly.', 503)
      return rejectLogin(res, t0, lockKey, loginIdentifierPreview(username), 'provider_invalid_credentials')
    }
  } else if (!bcrypt.compareSync(password, user.password)) {
    return rejectLogin(res, t0, lockKey, loginIdentifierPreview(username))
  }

  resetRateLimit('auth:login', limitKey)
  clearAbuseFailure('auth:login_lock', lockKey)
  logOp('auth:login', Date.now() - t0)

  const otpSecret = getOtpSecret(user)
  if (user.otp_enabled && !otpSecret) {
    return err(res, 'Two-factor authentication is unavailable for this account. Please contact admin.', 503)
  }
  if (user.otp_enabled && otpSecret) {
    return ok(res, { otpRequired: true, userId: user.id })
  }

  audit(user.id, user.username, 'login', 'user', user.id, { username }, {
    tableName: 'users',
    recordId: user.id,
    deviceName: deviceName || null,
    deviceTz: deviceTz || null,
    clientTime: clientTime || null,
  })

  ok(res, { user: buildUserPayload(user) })
})

// POST /api/auth/login/request-code
router.post('/login/request-code', async (req, res) => {
  const { identifier, method } = req.body || {}
  if (!identifier) return err(res, 'Username or email is required')
  const normalizedMethod = normalizeVerificationMethod(method)
  if (!normalizedMethod) return err(res, 'Only email verification is supported')

  const limitKey = getClientKey(req, identifier)
  if (!applyRateLimit(req, res, {
    bucket: 'auth:login_code_request',
    key: limitKey,
    max: CODE_REQUEST_LIMIT_MAX,
    windowMs: CODE_REQUEST_LIMIT_WINDOW_MS,
    message: 'Too many verification code requests.',
  })) return

  const user = findUserByIdentifier(identifier, { requireVerifiedContact: true })
  if (!user) {
    return ok(res, { message: 'If the account exists, a verification code has been sent.' })
  }

  const channel = resolveChannel(user, normalizedMethod, { verifiedOnly: true })
  const destination = channel ? getDestinationForChannel(user, channel) : ''
  if (!channel || !destination) {
    return err(res, 'No verified email is available for this account.')
  }

  const result = await requestVerificationCode({
    userId: user.id,
    userName: user.username,
    purpose: 'login_code',
    channel,
    destination,
    meta: { identifier: String(identifier || ''), method: normalizedMethod },
  })
  if (!result.success) return err(res, result.error || 'Failed to send verification code')

  audit(user.id, user.username, 'login_code_request', 'user', user.id, {
    channel,
    destinationMasked: result.destinationMasked,
    delivered: result.delivered,
    provider: result.provider,
  })

  return ok(res, {
    message: 'Verification code sent.',
    channel,
    destination: result.destinationMasked,
    expiresAt: result.expiresAt,
    delivered: result.delivered,
    provider: result.provider,
  })
})

// POST /api/auth/login/verify-code
router.post('/login/verify-code', (req, res) => {
  const { identifier, method, code, clientTime, deviceTz, deviceName } = req.body || {}
  if (!identifier) return err(res, 'Username or email is required')
  if (!code) return err(res, 'Verification code is required')
  const normalizedMethod = normalizeVerificationMethod(method)
  if (!normalizedMethod) return err(res, 'Only email verification is supported')

  const limitKey = getClientKey(req, identifier)
  if (!applyRateLimit(req, res, {
    bucket: 'auth:login_code_verify',
    key: limitKey,
    max: CODE_VERIFY_LIMIT_MAX,
    windowMs: CODE_VERIFY_LIMIT_WINDOW_MS,
    message: 'Too many verification attempts.',
  })) return

  const user = findUserByIdentifier(identifier, { requireVerifiedContact: true })
  if (!user) return err(res, 'Invalid verification request', 400)

  const channel = resolveChannel(user, normalizedMethod, { verifiedOnly: true })
  const destination = channel ? getDestinationForChannel(user, channel) : ''
  if (!channel || !destination) return err(res, 'No verified email is available for this account', 400)

  const verifyResult = verifyCode({
    userId: user.id,
    purpose: 'login_code',
    channel,
    destination,
    code,
    consume: true,
  })
  if (!verifyResult.valid) return err(res, 'Invalid or expired verification code', 401)
  resetRateLimit('auth:login_code_verify', limitKey)

  audit(user.id, user.username, 'login', 'user', user.id, { username: user.username, method: `${channel}_code` }, {
    tableName: 'users',
    recordId: user.id,
    deviceName: deviceName || null,
    deviceTz: deviceTz || null,
    clientTime: clientTime || null,
  })

  return ok(res, { user: buildUserPayload(user) })
})

// POST /api/auth/oauth/start
router.post('/oauth/start', (req, res) => {
  const { provider, mode, redirectTo } = req.body || {}
  const oauthMode = normalizeOauthMode(mode)
  const result = buildOauthStartUrl({
    provider,
    redirectTo,
    queryParams: provider === 'google'
      ? { access_type: 'offline', prompt: 'consent' }
      : {},
  })
  if (!result.success) return err(res, result.error || 'Failed to start OAuth flow', 400)
  ok(res, { url: result.url, mode: oauthMode })
})

// POST /api/auth/oauth/complete
router.post('/oauth/complete', async (req, res) => {
  const {
    accessToken,
    provider,
    mode,
    currentUserId,
    clientTime,
    deviceTz,
    deviceName,
  } = req.body || {}

  const oauthMode = normalizeOauthMode(mode)
  const normalizedProvider = String(provider || '').trim().toLowerCase()
  const authResult = await getAuthUserFromAccessToken(accessToken)
  if (!authResult.success || !authResult.user) {
    return err(res, authResult.error || 'Failed to verify OAuth session with Supabase', 401)
  }

  const authUser = authResult.user
  const authEmail = normalizeEmail(authUser.email || '')
  if (!authEmail) {
    return err(res, 'The identity provider did not return an email address. Configure email permission and try again.', 400)
  }

  if (oauthMode === 'link') {
    const actorId = Number(currentUserId || 0)
    if (!actorId) return err(res, 'A local user session is required to link an identity.', 401)

    const localUser = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL').get(actorId)
    if (!localUser) return err(res, 'Local account is not available.', 404)
    if (!String(localUser.email || '').trim()) {
      return err(res, 'Add your account email before linking social sign-in.', 400)
    }

    const localEmail = normalizeEmail(localUser.email)
    if (!localEmail || localEmail !== authEmail) {
      return err(res, 'The provider email must match your account email before it can be linked.', 400)
    }

    if (String(localUser.supabase_user_id || '').trim() && String(localUser.supabase_user_id).trim() !== authUser.id) {
      return err(res, 'This account is already linked to a different Supabase identity.', 409)
    }

    const syncedUser = updateLocalUserSupabaseIdentity(localUser.id, authUser)
    audit(localUser.id, localUser.username, 'identity_linked', 'user', localUser.id, {
      provider: normalizedProvider || 'oauth',
      email: authEmail,
      supabase_user_id: authUser.id,
    }, {
      tableName: 'users',
      recordId: localUser.id,
      deviceName: deviceName || null,
      deviceTz: deviceTz || null,
      clientTime: clientTime || null,
    })

    return ok(res, {
      mode: oauthMode,
      provider: normalizedProvider,
      user: buildUserPayload(syncedUser),
    })
  }

  let localUser = db.prepare(`
    SELECT *
    FROM users
    WHERE is_active = 1
      AND deleted_at IS NULL
      AND (
        supabase_user_id = ?
        OR lower(trim(email)) = ?
      )
    ORDER BY CASE WHEN supabase_user_id = ? THEN 0 ELSE 1 END, id ASC
    LIMIT 1
  `).get(authUser.id, authEmail, authUser.id)

  if (!localUser) {
    return err(res, 'No active local account matches this sign-in method yet. Ask an admin to create your account first.', 403)
  }

  localUser = updateLocalUserSupabaseIdentity(localUser.id, authUser)

  const otpSecret = getOtpSecret(localUser)
  if (localUser.otp_enabled && !otpSecret) {
    return err(res, 'Two-factor authentication is unavailable for this account. Please contact admin.', 503)
  }
  if (localUser.otp_enabled && otpSecret) {
    return ok(res, {
      otpRequired: true,
      userId: localUser.id,
      provider: normalizedProvider,
    })
  }

  audit(localUser.id, localUser.username, 'login', 'user', localUser.id, {
    method: normalizedProvider || 'oauth',
    email: authEmail,
    supabase_user_id: authUser.id,
  }, {
    tableName: 'users',
    recordId: localUser.id,
    deviceName: deviceName || null,
    deviceTz: deviceTz || null,
    clientTime: clientTime || null,
  })

  return ok(res, {
    provider: normalizedProvider,
    user: buildUserPayload(localUser),
  })
})

// POST /api/auth/otp/verify
router.post('/otp/verify', (req, res) => {
  const { userId, token, clientTime, deviceTz, deviceName } = req.body || {}
  if (!userId || !token) return err(res, 'userId and token required')

  const limitKey = getClientKey(req, String(userId))
  if (!applyRateLimit(req, res, {
    bucket: 'auth:otp',
    key: limitKey,
    max: OTP_LIMIT_MAX,
    windowMs: OTP_LIMIT_WINDOW_MS,
    message: 'Too many OTP attempts.',
  })) return

  const user = db.prepare(`
    SELECT *
    FROM users
    WHERE id = ?
      AND is_active = 1
      AND deleted_at IS NULL
      AND otp_enabled = 1
      AND otp_secret IS NOT NULL
  `).get(userId)
  if (!user) return err(res, 'Invalid request', 401)
  const otpSecret = getOtpSecret(user)
  if (!otpSecret) return err(res, 'OTP secret is unavailable. Please set up OTP again.', 400)

  const verified = speakeasy.totp.verify({
    secret: otpSecret,
    encoding: 'base32',
    token: String(token).replace(/\s/g, ''),
    window: 1,
  })
  if (!verified) return err(res, 'Invalid OTP code', 401)
  resetRateLimit('auth:otp', limitKey)

  audit(user.id, user.username, 'login', 'user', user.id, { username: user.username, method: 'otp' }, {
    tableName: 'users',
    recordId: user.id,
    deviceName: deviceName || null,
    deviceTz: deviceTz || null,
    clientTime: clientTime || null,
  })

  ok(res, { user: buildUserPayload(user) })
})

// POST /api/auth/otp/setup
router.post('/otp/setup', authToken, async (req, res) => {
  const { userId } = req.body || {}
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(userId)
  if (!user) return err(res, 'User not found')

  const secret = speakeasy.generateSecret({ name: `BusinessOS (${user.username})`, length: 20 })
  db.prepare(`
    UPDATE users
    SET otp_pending_secret = ?, otp_pending_created_at = datetime('now')
    WHERE id = ?
  `).run(encryptSecret(secret.base32), userId)

  try {
    const qrDataUrl = await qrcode.toDataURL(secret.otpauth_url)
    ok(res, { secret: secret.base32, qrDataUrl, otpAuthUrl: secret.otpauth_url })
  } catch (_) {
    ok(res, { secret: secret.base32, qrDataUrl: null, otpAuthUrl: secret.otpauth_url })
  }
})

// POST /api/auth/otp/confirm
router.post('/otp/confirm', authToken, (req, res) => {
  const { userId, token } = req.body || {}
  if (!userId || !token) return err(res, 'userId and token required')
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(userId)
  if (!user || !user.otp_pending_secret) return err(res, 'OTP not set up')
  const otpSecret = getOtpSecret(user, 'otp_pending_secret')
  if (!otpSecret) return err(res, 'OTP setup secret is unavailable. Please start setup again.', 400)

  const verified = speakeasy.totp.verify({
    secret: otpSecret,
    encoding: 'base32',
    token: String(token).replace(/\s/g, ''),
    window: 1,
  })
  if (!verified) return err(res, 'Invalid code. Check your authenticator app time sync.')

  db.prepare(`
    UPDATE users
    SET otp_secret = otp_pending_secret,
        otp_pending_secret = NULL,
        otp_pending_created_at = NULL,
        otp_enabled = 1
    WHERE id = ?
  `).run(userId)
  audit(userId, user.username, 'update', 'user', userId, { action: 'otp_enabled' })
  ok(res, {})
})

// POST /api/auth/otp/disable
router.post('/otp/disable', authToken, (req, res) => {
  const { userId, password } = req.body || {}
  if (!userId) return err(res, 'userId required')
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND deleted_at IS NULL').get(userId)
  if (!user) return err(res, 'User not found')
  if (password && !bcrypt.compareSync(password, user.password)) return err(res, 'Incorrect password', 401)
  db.prepare(`
    UPDATE users
    SET otp_enabled = 0,
        otp_secret = NULL,
        otp_pending_secret = NULL,
        otp_pending_created_at = NULL
    WHERE id = ?
  `).run(userId)
  audit(userId, user.username, 'update', 'user', userId, { action: 'otp_disabled' })
  ok(res, {})
})

// GET /api/auth/otp/status/:userId
router.get('/otp/status/:userId', authToken, (req, res) => {
  const user = db.prepare('SELECT id, otp_enabled FROM users WHERE id = ? AND deleted_at IS NULL').get(req.params.userId)
  if (!user) return err(res, 'User not found')
  ok(res, { otpEnabled: !!user.otp_enabled })
})

// POST /api/auth/password-reset/request
router.post('/password-reset/request', async (req, res) => {
  const { identifier, method } = req.body || {}
  if (!identifier) return err(res, 'Username or email is required')
  const normalizedMethod = normalizeVerificationMethod(method)
  if (!normalizedMethod) return err(res, 'Only email verification is supported')

  const limitKey = getClientKey(req, identifier)
  if (!applyRateLimit(req, res, {
    bucket: 'auth:password_reset_request',
    key: limitKey,
    max: CODE_REQUEST_LIMIT_MAX,
    windowMs: CODE_REQUEST_LIMIT_WINDOW_MS,
    message: 'Too many verification code requests.',
  })) return

  const user = findUserByIdentifier(identifier, { requireVerifiedContact: true })
  if (!user) {
    return ok(res, { message: 'If the account exists, a verification code has been sent.' })
  }

  const channel = resolveChannel(user, normalizedMethod, { verifiedOnly: true })
  const destination = channel ? getDestinationForChannel(user, channel) : ''
  if (!channel) {
    return err(res, 'No email is available for this account. Add one from My Profile first.')
  }
  if (!destination) {
    return err(res, 'No valid verified email destination is available for this account')
  }

  const result = await requestVerificationCode({
    userId: user.id,
    userName: user.username,
    purpose: 'password_reset',
    channel,
    destination,
    meta: { identifier: String(identifier || ''), method: normalizedMethod },
  })
  if (!result.success) return err(res, result.error || 'Failed to send verification code')

  audit(user.id, user.username, 'password_reset_request', 'user', user.id, {
    channel,
    destinationMasked: result.destinationMasked,
    delivered: result.delivered,
    provider: result.provider,
  })

  return ok(res, {
    message: 'Verification code sent.',
    channel,
    destination: result.destinationMasked,
    expiresAt: result.expiresAt,
    delivered: result.delivered,
    provider: result.provider,
  })
})

// POST /api/auth/password-reset/complete
router.post('/password-reset/complete', async (req, res) => {
  const { identifier, method, code, newPassword } = req.body || {}
  if (!identifier) return err(res, 'Username or email is required')
  if (!code) return err(res, 'Verification code is required')
  if (!newPassword || String(newPassword).length < 4) return err(res, 'New password must be at least 4 characters')
  const normalizedMethod = normalizeVerificationMethod(method)
  if (!normalizedMethod) return err(res, 'Only email verification is supported')

  const limitKey = getClientKey(req, identifier)
  if (!applyRateLimit(req, res, {
    bucket: 'auth:password_reset_verify',
    key: limitKey,
    max: CODE_VERIFY_LIMIT_MAX,
    windowMs: CODE_VERIFY_LIMIT_WINDOW_MS,
    message: 'Too many verification attempts.',
  })) return

  const user = findUserByIdentifier(identifier, { requireVerifiedContact: true })
  if (!user) return err(res, 'Invalid verification request', 400)
  const useSupabaseProvider = !!(isSupabaseAuthConfigured() && (user.supabase_user_id || user.email))
  if (useSupabaseProvider && String(newPassword).length < 6) {
    return err(res, 'New password must be at least 6 characters when Supabase auth is enabled.')
  }

  const channel = resolveChannel(user, normalizedMethod, { verifiedOnly: true })
  const destination = channel ? getDestinationForChannel(user, channel) : ''
  if (!channel || !destination) return err(res, 'No verified email is available for this account', 400)
  const verifyResult = verifyCode({
    userId: user.id,
    purpose: 'password_reset',
    channel,
    destination,
    code,
    consume: true,
  })
  if (!verifyResult.valid) return err(res, 'Invalid or expired verification code', 401)
  resetRateLimit('auth:password_reset_verify', limitKey)

  let supabaseUserId = String(user.supabase_user_id || '').trim()
  if (isSupabaseAuthConfigured() && !supabaseUserId && user.email) {
    const provision = await createOrUpdateAuthUser(user, newPassword)
    if (!provision.success && !provision.skipped) return err(res, provision.error || 'Failed to provision Supabase authentication.')
    if (provision.success && provision.userId) supabaseUserId = String(provision.userId)
  }

  if (isSupabaseAuthConfigured() && supabaseUserId) {
    const sync = await updateAuthPassword(supabaseUserId, newPassword)
    if (!sync.success && !sync.skipped) return err(res, sync.error || 'Failed to sync password to auth provider')
  }
  const hash = bcrypt.hashSync(String(newPassword), 10)
  db.prepare('UPDATE users SET password = ?, supabase_user_id = COALESCE(NULLIF(?, \'\'), supabase_user_id) WHERE id = ?')
    .run(hash, supabaseUserId, user.id)

  audit(user.id, user.username, 'password_reset_complete', 'user', user.id, {
    channel,
    destination: destination ? `${channel}:verified` : channel,
  })

  return ok(res, { message: 'Password reset successfully.' })
})

module.exports = router
