'use strict'
/**
 * auth.js
 * Authentication and account-recovery routes.
 *
 * Responsibilities:
 * - Password login (username/email identifier).
 * - OTP 2FA verification and setup lifecycle.
 * - OTP-based reset flow and provider-aware account recovery.
 * - Provider-aware auth behavior (local password + owned Google login).
 *
 * Data interconnections:
 * - Reads/writes `users` (password/otp/email verification state).
 * - Reads/writes `verification_codes` (via verification service).
 * - Writes `audit_logs` for auth events.
 */

const express = require('express')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
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
  buildGoogleOauthStartUrl,
  exchangeGoogleOauthCode,
  getGoogleLoginPublicConfig,
  getGoogleUserFromTokens,
  verifyState,
} = require('../services/googleOauth')
const {
  getVerificationCapabilities,
  normalizeEmail,
  normalizePhone,
} = require('../services/verification')
const {
  createAuthSession,
  setAuthSessionCookie,
  clearAuthSessionCookie,
  getPresentedSessionToken,
  getSessionUser,
  revokeAuthSession,
  revokeUserSessions,
  SESSION_ROTATION_GRACE_MS,
} = require('../sessionAuth')
const {
  findOrganizationByLookup,
  getDefaultOrganization,
  getOrganizationContextForUser,
  ensureOrganizationFilesystemLayout,
} = require('../organizationContext')
const { sanitizeSettingsSnapshot } = require('../settingsSnapshot')
const { classifyRequestAccess } = require('../accessControl')
const { PUBLIC_BASE_URL, CLOUDFLARE_PUBLIC_URL, CLOUDFLARE_ADMIN_URL } = require('../config')
const { buildRuntimeDescriptor } = require('../runtimeState')
const { canManageOtpTarget, requiresSelfOtpDisablePassword } = require('../authOtpGuards')

const router = express.Router()

const LOGIN_LIMIT_MAX = Math.max(1, Number(process.env.AUTH_LOGIN_MAX_ATTEMPTS || 8))
const LOGIN_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_LOGIN_WINDOW_MS || 10 * 60 * 1000))
const LOGIN_IP_LIMIT_MAX = Math.max(LOGIN_LIMIT_MAX, Number(process.env.AUTH_LOGIN_IP_MAX_ATTEMPTS || 20))
const LOGIN_IP_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_LOGIN_IP_WINDOW_MS || LOGIN_LIMIT_WINDOW_MS))
const OTP_LIMIT_MAX = Math.max(1, Number(process.env.AUTH_OTP_MAX_ATTEMPTS || 10))
const OTP_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_OTP_WINDOW_MS || 10 * 60 * 1000))
const OTP_IP_LIMIT_MAX = Math.max(OTP_LIMIT_MAX, Number(process.env.AUTH_OTP_IP_MAX_ATTEMPTS || 25))
const OTP_IP_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_OTP_IP_WINDOW_MS || OTP_LIMIT_WINDOW_MS))
const LOGIN_LOCK_THRESHOLD = Math.max(1, Number(process.env.AUTH_LOGIN_LOCK_THRESHOLD || 12))
const LOGIN_LOCK_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_LOGIN_LOCK_WINDOW_MS || 15 * 60 * 1000))
const LOGIN_LOCK_DURATION_MS = Math.max(1000, Number(process.env.AUTH_LOGIN_LOCK_DURATION_MS || 15 * 60 * 1000))
const SERVER_START_TIME = Math.floor(Date.now() / 1000)
const MAX_LOGIN_IDENTIFIER_LENGTH = Math.max(32, Number(process.env.AUTH_MAX_LOGIN_IDENTIFIER_LENGTH || 160))
const MAX_PASSWORD_LENGTH = Math.max(32, Number(process.env.AUTH_MAX_PASSWORD_LENGTH || 4096))

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

function isReasonableCredentialLength(identifier, password) {
  return String(identifier || '').length <= MAX_LOGIN_IDENTIFIER_LENGTH
    && String(password || '').length <= MAX_PASSWORD_LENGTH
}

function normalizeLookupText(value) {
  return String(value || '').trim().toLowerCase()
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim())
}

function buildPublicBaseUrl(req) {
  const proto = String(req?.headers?.['x-forwarded-proto'] || req?.protocol || 'http').split(',')[0].trim() || 'http'
  const host = String(req?.headers?.['x-forwarded-host'] || req?.headers?.host || '').split(',')[0].trim()
  if (!host) return ''
  return `${proto}://${host}`
}

function resolvePasswordResetRedirect(req, redirectTo) {
  const candidates = [
    redirectTo,
    process.env.PASSWORD_RESET_REDIRECT_TO,
    CLOUDFLARE_ADMIN_URL,
    PUBLIC_BASE_URL,
    CLOUDFLARE_PUBLIC_URL,
    buildPublicBaseUrl(req),
    'http://localhost:4000',
  ]
  return candidates.find((value) => isHttpUrl(value)) || ''
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

function requireOtpActor(req, res) {
  if (req?.user?.id) return req.user
  err(res, 'Please sign in again to continue.', 401)
  return null
}

function getOtpTargetUser(userId) {
  return db.prepare(`
    SELECT u.*, r.permissions AS role_permissions, r.code AS role_code
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ? AND u.deleted_at IS NULL
    LIMIT 1
  `).get(userId)
}

/**
 * 1.7 Build API-safe user payload:
 * - strips password and otp_secret
 * - merges role permissions + user overrides
 */
function buildUserPayload(user) {
  const {
    password: _pw,
    phone_lookup: _phoneLookup,
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
  const organizationContext = getOrganizationContextForUser(safeUser.id)
  return {
    ...safeUser,
    ...(organizationContext || {}),
    permissions: JSON.stringify(mergedPerms),
  }
}

/**
 * 1.8 Lookup active user by username/name/email/phone.
 * @param {string} identifier
 * @param {{requireVerifiedContact?: boolean}} options
 */
function resolveOrganizationLookup(value) {
  const input = String(value || '').trim()
  if (!input) return getDefaultOrganization() || null
  return findOrganizationByLookup(input) || null
}

function findUserByIdentifier(identifier, options = {}) {
  const requireVerifiedContact = !!options.requireVerifiedContact
  const organizationId = Number(options.organizationId || 0) || 0
  const value = String(identifier || '').trim()
  if (!value) return null

  const byUsername = db.prepare(`
    SELECT *
    FROM users
    WHERE username = ?
      AND is_active = 1
      AND deleted_at IS NULL
      AND (? = 0 OR organization_id = ?)
  `).get(value, organizationId, organizationId)
  if (byUsername) return byUsername

  const email = normalizeEmail(value)
  if (email) {
    const byEmail = db.prepare(`
      SELECT *
      FROM users
      WHERE lower(trim(email)) = ?
        AND is_active = 1
        AND deleted_at IS NULL
        AND (? = 0 OR organization_id = ?)
    `).get(email, organizationId, organizationId)
    if (byEmail) {
      if (requireVerifiedContact && Number(byEmail.email_verified || 0) !== 1) return null
      return byEmail
    }
  }

  const phoneLookup = normalizePhone(value)
  if (phoneLookup) {
    const byPhone = db.prepare(`
      SELECT *
      FROM users
      WHERE phone_lookup = ?
        AND is_active = 1
        AND deleted_at IS NULL
        AND (? = 0 OR organization_id = ?)
    `).get(phoneLookup, organizationId, organizationId)
    if (byPhone) return byPhone
  }

  const lookup = normalizeLookupText(value)
  const byUsernameLookup = db.prepare(`
    SELECT *
    FROM users
    WHERE lower(trim(username)) = ?
      AND is_active = 1
      AND deleted_at IS NULL
      AND (? = 0 OR organization_id = ?)
  `).get(lookup, organizationId, organizationId)
  if (byUsernameLookup) return byUsernameLookup

  const byName = db.prepare(`
    SELECT *
    FROM users
    WHERE lower(trim(name)) = ?
      AND is_active = 1
      AND deleted_at IS NULL
      AND (? = 0 OR organization_id = ?)
  `).get(lookup, organizationId, organizationId)
  if (byName) return byName

  return null
}

function getExactActiveUserById(userId, organizationId = 0) {
  const id = Number(userId || 0)
  const orgId = Number(organizationId || 0) || 0
  if (!id) return null
  return db.prepare(`
    SELECT *
    FROM users
    WHERE id = ?
      AND is_active = 1
      AND deleted_at IS NULL
      AND (? = 0 OR organization_id = ?)
    LIMIT 1
  `).get(id, orgId, orgId)
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

function getSettingsSnapshot() {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const settings = {}
  rows.forEach((row) => {
    settings[row.key] = row.value
  })
  return sanitizeSettingsSnapshot(settings)
}

function getBootstrapSystemSnapshot(req, organizationPublicId = '') {
  const access = classifyRequestAccess(req)
  const hostUiAvailable = process.platform === 'win32' && !!req?.user?.id
  const runtime = {
    ...buildRuntimeDescriptor(organizationPublicId),
    serverStartTime: String(SERVER_START_TIME),
  }
  return {
    syncServerUrl: PUBLIC_BASE_URL || CLOUDFLARE_PUBLIC_URL || null,
    adminServerUrl: CLOUDFLARE_ADMIN_URL || null,
    requiresToken: access.tokenRequired,
    hasConfiguredToken: access.hasConfiguredToken,
    accessMode: access.mode,
    tokenAccepted: access.tokenValid,
    hostUiAvailable,
    serverStartTime: SERVER_START_TIME,
    runtime,
    security: {
      remoteAccessProvider: access.remoteAccessProvider || 'cloudflare',
      host: access.host || null,
      remoteAddress: access.remoteAddress || null,
      mode: access.mode,
      publicRemote: access.publicRemote,
      tokenRequired: access.tokenRequired,
      hasConfiguredToken: access.hasConfiguredToken,
      tokenProvided: access.tokenProvided,
      hostUiAvailable,
    },
  }
}

function buildAuthenticatedBootstrap(req, userId) {
  const actor = getUserById(userId)
  if (!actor) return null

  const user = buildUserPayload(actor)
  const organizationContext = getOrganizationContextForUser(actor.id)
  const organization = organizationContext?.organization_id ? {
    id: organizationContext.organization_id,
    name: organizationContext.organization_name,
    slug: organizationContext.organization_slug,
    public_id: organizationContext.organization_public_id,
  } : null
  const group = organizationContext?.organization_group_id ? {
    id: organizationContext.organization_group_id,
    name: organizationContext.organization_group_name,
    slug: organizationContext.organization_group_slug,
  } : null

  return {
    user,
    settings: getSettingsSnapshot(),
    organizationCreationEnabled: false,
    organization,
    group,
    storage: organization ? ensureOrganizationFilesystemLayout(organization) : null,
    system: getBootstrapSystemSnapshot(req, organization?.public_id || ''),
  }
}

function generateTemporaryAuthPassword() {
  return crypto.randomBytes(18).toString('base64url')
}

function issueAuthSession(req, userId, details = {}) {
  return createAuthSession(userId, {
    sessionDuration: details.sessionDuration,
    deviceName: details.deviceName || null,
    deviceTz: details.deviceTz || null,
    clientTime: details.clientTime || null,
    ip: String(req.ip || req.socket?.remoteAddress || '').trim() || null,
    userAgent: String(req.headers['user-agent'] || '').trim() || null,
  })
}

function updateLocalUserGoogleIdentity(userId, googleUser = {}) {
  const googleSubject = String(googleUser?.sub || googleUser?.id || '').trim() || null
  const email = normalizeEmail(googleUser?.email || '') || null
  const emailVerified = googleUser?.emailVerified ? 1 : 0
  const existing = getUserById(userId)
  const localEmail = normalizeEmail(existing?.email || '')
  const emailConflict = email
    ? db.prepare('SELECT id FROM users WHERE id != ? AND lower(trim(email)) = ? LIMIT 1').get(userId, email)
    : null
  const shouldReplaceEmail = !emailConflict && (!localEmail || (email && localEmail === email))
  db.prepare(`
    UPDATE users
    SET google_subject = COALESCE(NULLIF(?, ''), google_subject),
        google_email = COALESCE(?, google_email),
        google_email_verified = CASE WHEN ? = 1 THEN 1 ELSE google_email_verified END,
        google_linked_at = CURRENT_TIMESTAMP,
        email = CASE
          WHEN ? = 1 THEN COALESCE(?, email)
          ELSE email
        END,
        email_verified = CASE
          WHEN ? = 1 AND ? = 1 THEN 1
          ELSE email_verified
        END
    WHERE id = ?
  `).run(googleSubject, email, emailVerified, shouldReplaceEmail ? 1 : 0, shouldReplaceEmail ? email : null, shouldReplaceEmail ? emailVerified : 0, shouldReplaceEmail ? 1 : 0, userId)
  return getUserById(userId)
}

router.get('/verification-capabilities', (_req, res) => {
  const googleLogin = getGoogleLoginPublicConfig()
  ok(res, {
    ...getVerificationCapabilities(),
    email: false,
    sms: false,
    google_oauth: googleLogin.enabled,
    google_login: googleLogin,
    facebook_oauth: false,
    google_email_auth: false,
  })
})

router.get('/bootstrap', authToken, (req, res) => {
  const actorId = Number(req.user?.id || 0)
  if (!actorId) return err(res, 'Please sign in again to continue.', 401)
  const payload = buildAuthenticatedBootstrap(req, actorId)
  if (!payload) return err(res, 'Unable to build session bootstrap.', 404)
  return ok(res, payload)
})

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const t0 = Date.now()
  const { username, password, organization, clientTime, deviceTz, deviceName, sessionDuration } = req.body || {}
  if (!username || !password) return err(res, 'Username, name, email, or phone number and password are required')
  if (!isReasonableCredentialLength(username, password)) {
    return rejectLogin(res, t0, getLoginLockKey(username), loginIdentifierPreview(username), 'invalid_credential_shape')
  }
  const lockKey = getLoginLockKey(username)
  const lockState = checkAbuseLock('auth:login_lock', lockKey, LOGIN_LOCK_WINDOW_MS)
  if (lockState.locked) {
    res.setHeader('Retry-After', String(lockState.retryAfterSeconds))
    return err(res, `Too many failed login attempts. Try again in ${lockState.retryAfterSeconds} seconds.`, 429)
  }

  const ipLimitKey = getClientKey(req, 'login-ip')
  if (!applyRateLimit(req, res, {
    bucket: 'auth:login_ip',
    key: ipLimitKey,
    max: LOGIN_IP_LIMIT_MAX,
    windowMs: LOGIN_IP_LIMIT_WINDOW_MS,
    message: 'Too many login attempts from this network.',
  })) return

  const limitKey = getClientKey(req, username)
  if (!applyRateLimit(req, res, {
    bucket: 'auth:login',
    key: limitKey,
    max: LOGIN_LIMIT_MAX,
    windowMs: LOGIN_LIMIT_WINDOW_MS,
    message: 'Too many login attempts.',
  })) return

  const organizationRecord = resolveOrganizationLookup(organization)
  if (!organizationRecord || !organizationRecord.is_active) {
    return rejectLogin(res, t0, lockKey, loginIdentifierPreview(username), 'invalid_organization_or_credentials')
  }

  const user = findUserByIdentifier(username, {
    requireVerifiedContact: false,
    organizationId: organizationRecord.id,
  })
  if (!user) {
    return rejectLogin(res, t0, lockKey, loginIdentifierPreview(username))
  }

  const localPasswordMatches = bcrypt.compareSync(password, user.password)
  if (!localPasswordMatches) {
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

  const session = issueAuthSession(req, user.id, { sessionDuration, deviceName, deviceTz, clientTime })
  setAuthSessionCookie(req, res, session)
  ok(res, { user: buildUserPayload(user), sessionExpiresAt: session.expiresAt, authMode: 'cookie' })
})

// POST /api/auth/oauth/start
router.post('/oauth/start', (req, res) => {
  const { provider, mode, organization } = req.body || {}
  if (String(provider || 'google').trim().toLowerCase() !== 'google') {
    return err(res, 'Only Google login is supported.', 400)
  }
  const oauthMode = normalizeOauthMode(mode)
  let currentUserId = 0
  if (oauthMode === 'link') {
    const sessionUser = getSessionUser(req)
    if (!sessionUser?.id) return err(res, 'Please sign in before linking Google.', 401)
    currentUserId = Number(sessionUser.id || 0) || 0
  }
  const result = buildGoogleOauthStartUrl({
    mode: oauthMode,
    organization,
    currentUserId,
  })
  if (!result.success) return err(res, result.error || 'Failed to start OAuth flow', 400)
  ok(res, { url: result.url, mode: oauthMode })
})

async function completeGoogleLogin(req, res, googleUser, statePayload = {}, details = {}) {
  const oauthMode = normalizeOauthMode(statePayload.mode || details.mode)
  const organizationRecord = resolveOrganizationLookup(statePayload.organization || details.organization)
  if (String(statePayload.organization || details.organization || '').trim() && !organizationRecord) {
    return err(res, 'Organization not found', 404)
  }
  const googleSubject = String(googleUser?.sub || googleUser?.id || '').trim()
  const googleEmail = normalizeEmail(googleUser?.email || '')
  if (!googleSubject) return err(res, 'Google identity did not include a subject.', 401)

  const linkedToOtherUser = db.prepare(`
    SELECT id
    FROM users
    WHERE google_subject = ?
      AND (? = 0 OR id != ?)
      AND deleted_at IS NULL
    LIMIT 1
  `).get(googleSubject, Number(statePayload.currentUserId || 0), Number(statePayload.currentUserId || 0))

  if (oauthMode === 'link') {
    const actorId = Number(statePayload.currentUserId || details.currentUserId || 0)
    if (!actorId) return err(res, 'A local user session is required to link Google.', 401)
    if (linkedToOtherUser) return err(res, 'This Google account is already linked to another user.', 409)
    const localUser = db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1 AND deleted_at IS NULL').get(actorId)
    if (!localUser) return err(res, 'Local account is not available.', 404)
    const syncedUser = updateLocalUserGoogleIdentity(localUser.id, googleUser)
    audit(localUser.id, localUser.username, 'identity_linked', 'user', localUser.id, {
      provider: 'google',
      email: googleEmail,
      google_subject: googleSubject,
    }, {
      tableName: 'users',
      recordId: localUser.id,
      deviceName: details.deviceName || null,
      deviceTz: details.deviceTz || null,
      clientTime: details.clientTime || null,
    })
    return ok(res, { mode: oauthMode, provider: 'google', user: buildUserPayload(syncedUser) })
  }

  const requestedOrgId = Number(organizationRecord?.id || 0) || 0
  let localUser = db.prepare(`
    SELECT *
    FROM users
    WHERE google_subject = ?
      AND is_active = 1
      AND deleted_at IS NULL
      AND (? = 0 OR organization_id = ?)
    LIMIT 1
  `).get(googleSubject, requestedOrgId, requestedOrgId)

  if (!localUser) {
    return err(res, 'No active local account is linked to this Google account yet. Sign in with password or OTP first, then link Google from My Profile.', 403)
  }

  localUser = updateLocalUserGoogleIdentity(localUser.id, googleUser)
  const otpSecret = getOtpSecret(localUser)
  if (localUser.otp_enabled && !otpSecret) {
    return err(res, 'Two-factor authentication is unavailable for this account. Please contact admin.', 503)
  }
  if (localUser.otp_enabled && otpSecret) {
    return ok(res, { otpRequired: true, userId: localUser.id, provider: 'google' })
  }

  audit(localUser.id, localUser.username, 'login', 'user', localUser.id, {
    method: 'google',
    email: googleEmail,
    google_subject: googleSubject,
  }, {
    tableName: 'users',
    recordId: localUser.id,
    deviceName: details.deviceName || null,
    deviceTz: details.deviceTz || null,
    clientTime: details.clientTime || null,
  })

  const session = issueAuthSession(req, localUser.id, details)
  setAuthSessionCookie(req, res, session)
  return ok(res, {
    provider: 'google',
    user: buildUserPayload(localUser),
    sessionExpiresAt: session.expiresAt,
    authMode: 'cookie',
  })
}

router.get('/oauth/callback', async (req, res) => {
  const { code, state } = req.query || {}
  const stateResult = verifyState(state)
  if (!stateResult.success) return err(res, stateResult.error, 400)
  const tokenResult = await exchangeGoogleOauthCode(code, stateResult.payload)
  if (!tokenResult.success) return err(res, tokenResult.error || 'Google login failed.', 401)
  const userResult = await getGoogleUserFromTokens(tokenResult.tokens)
  if (!userResult.success) return err(res, userResult.error || 'Google profile lookup failed.', 401)
  return completeGoogleLogin(req, res, userResult.user, stateResult.payload, {
    sessionDuration: 'session',
    deviceName: 'Google OAuth',
    userAgent: String(req.headers['user-agent'] || ''),
  })
})

// POST /api/auth/oauth/complete
router.post('/oauth/complete', async (req, res) => {
  return err(res, 'Use the Google OAuth callback to complete sign-in.', 400)
})

router.post('/oauth/unlink', authToken, (req, res) => {
  const { currentPassword } = req.body || {}
  const actorId = Number(req.user?.id || 0)
  if (!actorId) return err(res, 'Please sign in again to continue.', 401)
  const user = getUserById(actorId)
  if (!user) return err(res, 'User not found.', 404)
  if (!currentPassword || !bcrypt.compareSync(String(currentPassword), user.password)) {
    return err(res, 'Current password is required to unlink Google.', 403)
  }
  db.prepare(`
    UPDATE users
    SET google_subject = NULL,
        google_email = NULL,
        google_email_verified = 0,
        google_linked_at = NULL
    WHERE id = ?
  `).run(actorId)
  audit(actorId, user.username, 'identity_unlinked', 'user', actorId, { provider: 'google' })
  return ok(res, { user: buildUserPayload(getUserById(actorId)) })
})

// POST /api/auth/otp/verify
router.post('/otp/verify', (req, res) => {
  const { userId, token, clientTime, deviceTz, deviceName, sessionDuration } = req.body || {}
  if (!userId || !token) return err(res, 'userId and token required')

  if (!applyRateLimit(req, res, {
    bucket: 'auth:otp_ip',
    key: getClientKey(req, 'otp-ip'),
    max: OTP_IP_LIMIT_MAX,
    windowMs: OTP_IP_LIMIT_WINDOW_MS,
    message: 'Too many OTP attempts from this network.',
  })) return

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

  const session = issueAuthSession(req, user.id, { sessionDuration, deviceName, deviceTz, clientTime })
  setAuthSessionCookie(req, res, session)
  ok(res, { user: buildUserPayload(user), sessionExpiresAt: session.expiresAt, authMode: 'cookie' })
})

router.post('/logout', (req, res) => {
  const token = getPresentedSessionToken(req)
  if (token) revokeAuthSession(token)
  clearAuthSessionCookie(req, res)
  ok(res, { success: true })
})

// POST /api/auth/session-duration
router.post('/session-duration', authToken, (req, res) => {
  const { sessionDuration, clientTime, deviceTz, deviceName } = req.body || {}
  const user = req.user
  if (!user?.id) return err(res, 'Please sign in again to continue.', 401)

  const currentToken = getPresentedSessionToken(req)
  const session = issueAuthSession(req, user.id, {
    sessionDuration,
    clientTime,
    deviceTz,
    deviceName,
  })
  setAuthSessionCookie(req, res, session)

  if (currentToken) {
    // Keep the previous session alive briefly so in-flight HTTP requests and the
    // old websocket can hand off cleanly to the new token instead of bouncing
    // the user back to login.
    revokeAuthSession(currentToken, { graceMs: SESSION_ROTATION_GRACE_MS })
  }

  audit(user.id, user.username, 'session_duration_updated', 'user', user.id, {
    sessionDuration: String(sessionDuration || 'session').trim().toLowerCase() || 'session',
  }, {
    tableName: 'users',
    recordId: user.id,
    deviceName: deviceName || null,
    deviceTz: deviceTz || null,
    clientTime: clientTime || null,
  })

  ok(res, {
    sessionExpiresAt: session.expiresAt,
    authMode: 'cookie',
  })
})

// POST /api/auth/otp/setup
router.post('/otp/setup', authToken, async (req, res) => {
  const actor = requireOtpActor(req, res)
  if (!actor) return
  const { userId } = req.body || {}
  const user = getOtpTargetUser(userId)
  if (!user) return err(res, 'User not found')
  if (!canManageOtpTarget(actor, user)) return err(res, 'No permission', 403)

  const secret = speakeasy.generateSecret({ name: `BusinessOS (${user.username})`, length: 20 })
  db.prepare(`
    UPDATE users
    SET otp_pending_secret = ?, otp_pending_created_at = CURRENT_TIMESTAMP
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
  const actor = requireOtpActor(req, res)
  if (!actor) return
  const { userId, token } = req.body || {}
  if (!userId || !token) return err(res, 'userId and token required')
  const user = getOtpTargetUser(userId)
  if (!user || !user.otp_pending_secret) return err(res, 'OTP not set up')
  if (!canManageOtpTarget(actor, user)) return err(res, 'No permission', 403)
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
  audit(actor.id, actor.username || actor.name, 'update', 'user', userId, {
    action: 'otp_enabled',
    target_user: user.username,
  })
  ok(res, {})
})

// POST /api/auth/otp/disable
router.post('/otp/disable', authToken, (req, res) => {
  const actor = requireOtpActor(req, res)
  if (!actor) return
  const { userId, password } = req.body || {}
  if (!userId) return err(res, 'userId required')
  const user = getOtpTargetUser(userId)
  if (!user) return err(res, 'User not found')
  if (!canManageOtpTarget(actor, user)) return err(res, 'No permission', 403)
  if (requiresSelfOtpDisablePassword(actor, user, password)) return err(res, 'Password required', 400)
  if (Number(actor.id) === Number(user.id) && !bcrypt.compareSync(password, user.password)) return err(res, 'Incorrect password', 401)
  db.prepare(`
    UPDATE users
    SET otp_enabled = 0,
        otp_secret = NULL,
        otp_pending_secret = NULL,
        otp_pending_created_at = NULL
    WHERE id = ?
  `).run(userId)
  audit(actor.id, actor.username || actor.name, 'update', 'user', userId, {
    action: 'otp_disabled',
    target_user: user.username,
  })
  ok(res, {})
})

// GET /api/auth/otp/status/:userId
router.get('/otp/status/:userId', authToken, (req, res) => {
  const actor = requireOtpActor(req, res)
  if (!actor) return
  const user = getOtpTargetUser(req.params.userId)
  if (!user) return err(res, 'User not found')
  if (!canManageOtpTarget(actor, user)) return err(res, 'No permission', 403)
  ok(res, { otpEnabled: !!user.otp_enabled })
})

// POST /api/auth/password-reset/otp
router.post('/password-reset/otp', async (req, res) => {
  const { identifier, organization, otp, newPassword } = req.body || {}
  if (!identifier) return err(res, 'Username or email is required')
  if (!otp) return err(res, 'OTP code is required')
  if (!newPassword || String(newPassword).length < 4) return err(res, 'New password must be at least 4 characters')

  const limitKey = getClientKey(req, identifier)
  if (!applyRateLimit(req, res, {
    bucket: 'auth:password_reset_otp',
    key: limitKey,
    max: OTP_LIMIT_MAX,
    windowMs: OTP_LIMIT_WINDOW_MS,
    message: 'Too many OTP reset attempts.',
  })) return

  const organizationRecord = resolveOrganizationLookup(organization)
  const user = findUserByIdentifier(identifier, {
    requireVerifiedContact: false,
    organizationId: Number(organizationRecord?.id || 0),
  })
  if (!user) return err(res, 'Invalid reset request', 400)
  if (!Number(user.otp_enabled || 0)) return err(res, 'Invalid reset request', 400)

  const otpSecret = getOtpSecret(user)
  if (!otpSecret) return err(res, 'Invalid reset request', 400)

  const verified = speakeasy.totp.verify({
    secret: otpSecret,
    encoding: 'base32',
    token: String(otp).replace(/\s/g, ''),
    window: 1,
  })
  if (!verified) return err(res, 'Invalid OTP code', 401)
  resetRateLimit('auth:password_reset_otp', limitKey)

  const hash = bcrypt.hashSync(String(newPassword), 10)
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, user.id)
  revokeUserSessions(user.id)

  audit(user.id, user.username, 'password_reset_complete', 'user', user.id, {
    method: 'otp',
  })

  return ok(res, { message: 'Password reset successfully.' })
})

// POST /api/auth/password-reset/email
router.post('/password-reset/email', async (req, res) => {
  const { identifier, organization } = req.body || {}
  if (!identifier) return err(res, 'Username, name, email, or phone is required')

  const limitKey = getClientKey(req, `email-reset:${identifier}`)
  if (!applyRateLimit(req, res, {
    bucket: 'auth:password_reset_email',
    key: limitKey,
    max: 4,
    windowMs: 5 * 60 * 1000,
    message: 'Too many password reset requests.',
  })) return

  const organizationRecord = resolveOrganizationLookup(organization)
  const user = findUserByIdentifier(identifier, {
    requireVerifiedContact: false,
    organizationId: Number(organizationRecord?.id || 0),
  })
  if (!user || !user.email) {
    return ok(res, { message: 'If this account can receive recovery email, reset instructions have been sent.' })
  }

  audit(user.id, user.username, 'password_reset_requested', 'user', user.id, {
    method: 'email',
    recovery_url: resolvePasswordResetRedirect(req),
  })
  return ok(res, { message: 'If this account can receive recovery email, reset instructions have been sent.' })
})

// POST /api/auth/password-reset/complete
router.post('/password-reset/complete', async (_req, res) => {
  return err(res, 'Email recovery links are handled by Business OS OTP/password reset. Request a new OTP reset or ask an admin to reset the password.', 400)
})

module.exports = router
