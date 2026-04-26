'use strict'
/**
 * users.js
 * User/role management and profile security routes.
 *
 * Responsibilities:
 * - Admin-managed user/role lifecycle.
 * - Self-service profile/password updates.
 * - Email contact verification handshake endpoints.
 * - Supabase-linked identity synchronization for provider parity.
 *
 * Access model:
 * - Admin-control users can manage non-admin users.
 * - Users can always manage self profile/security.
 * - Cross-admin management is blocked.
 * - Primary `admin` account has extra protection.
 */
const express = require('express')
const bcrypt = require('bcryptjs')
const { db } = require('../database')
const { ok, err, audit, broadcast } = require('../helpers')
const { authToken, upload, compressUpload, validateUploadedFile } = require('../middleware')
const { registerUploadFromRequest } = require('../fileAssets')
const { checkRateLimit, resetRateLimit } = require('../security')
const {
  isSupabaseAuthConfigured,
  getSupabaseAuthPublicConfig,
  createOrUpdateAuthUser,
  updateAuthPassword,
  setAuthUserActive,
  getAuthUserById,
} = require('../services/supabaseAuth')
const {
  normalizeEmail,
  requestVerificationCode,
  verifyCode,
} = require('../services/verification')

const router = express.Router()
const CONTACT_CODE_REQUEST_LIMIT_MAX = Math.max(1, Number(process.env.AUTH_CODE_REQUEST_MAX_ATTEMPTS || 5))
const CONTACT_CODE_REQUEST_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_CODE_REQUEST_WINDOW_MS || 15 * 60 * 1000))
const CONTACT_CODE_VERIFY_LIMIT_MAX = Math.max(1, Number(process.env.AUTH_CODE_VERIFY_MAX_ATTEMPTS || 10))
const CONTACT_CODE_VERIFY_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.AUTH_CODE_VERIFY_WINDOW_MS || 15 * 60 * 1000))

/**
 * 1. Shared Utilities
 * 1.1 Client identity key for per-route throttling buckets.
 */
function getClientKey(req, identifier = '') {
  const xForwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  const ip = xForwardedFor || req.ip || req.connection?.remoteAddress || 'unknown-ip'
  return `${ip}|${String(identifier || '').trim().toLowerCase()}`
}

function parseJson(value, fallback = {}) {
  try {
    return typeof value === 'string' ? JSON.parse(value || '{}') : (value || fallback)
  } catch (_) {
    return fallback
  }
}

/**
 * 1.2 Permission Helpers
 * 1.2.1 Merge role permissions with user-level permissions (user overrides role).
 */
function getMergedPermissions(row) {
  const userPermissions = parseJson(row?.permissions, {})
  const rolePermissions = parseJson(row?.role_permissions, {})
  return { ...rolePermissions, ...userPermissions }
}

/**
 * 1.2.2 Primary admin is identified by reserved username `admin`.
 */
function isPrimaryAdmin(row) {
  return String(row?.username || '').trim().toLowerCase() === 'admin'
}

/**
 * 1.2.3 Determine whether an account is considered admin-control capable.
 */
function hasAdminControl(row) {
  const merged = getMergedPermissions(row)
  if (merged?.all) return true
  if (String(row?.role_code || '').trim().toLowerCase() === 'admin') return true
  return isPrimaryAdmin(row)
}

/**
 * 1.2.4 Target-management guardrail:
 * - self always allowed
 * - actor must be admin-control for cross-user writes
 * - admin cannot manage peer admin accounts
 */
function canManageTarget(actor, target) {
  if (!actor || !target) return false
  if (Number(actor.id) === Number(target.id)) return true
  if (!hasAdminControl(actor)) return false
  if (hasAdminControl(target)) return false
  return true
}

/**
 * 1.3 Actor Resolution
 * 1.3.1 Resolve actor identity from the signed auth session.
 * User-management routes no longer trust body/query actor metadata.
 */
function getActorFromRequest(req) {
  return req?.user?.id ? req.user : null
}

/**
 * 1.3.2 Admin-only actor requirement for privileged endpoints.
 */
function requireAdminControl(req, res) {
  const actor = getActorFromRequest(req)
  if (!actor || !hasAdminControl(actor)) {
    err(res, 'No permission', 403)
    return null
  }
  return actor
}

/**
 * 1.4 Target Resolution
 * 1.4.1 Lightweight target user security context for permission decisions.
 */
function getUserSecurityContext(id) {
  return db.prepare(`
    SELECT u.id, u.username, u.permissions, u.role_id, r.permissions AS role_permissions, r.code AS role_code
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ? AND u.deleted_at IS NULL
  `).get(id)
}

/**
 * 1.4.2 Shared context loader for contact verification endpoints.
 */
function resolveVerificationContext(req) {
  const targetUserId = Number(req.params.id)
  const actor = getActorFromRequest(req)
  const target = db.prepare('SELECT id, username, phone, phone_verified, email, email_verified FROM users WHERE id = ? AND deleted_at IS NULL').get(targetUserId)
  const targetSecurity = getUserSecurityContext(targetUserId)
  return { targetUserId, actor, target, targetSecurity }
}

function getUserWithRole(id) {
  return db.prepare(`
    SELECT u.id, u.username, u.name, u.phone, u.phone_verified, u.email, u.email_verified, u.avatar_path, u.role_id, u.permissions,
           u.otp_enabled, u.is_active, u.supabase_user_id, u.deleted_at, u.created_at, r.name AS role_name,
           r.permissions AS role_permissions, r.code AS role_code, r.is_system AS role_is_system
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ?
  `).get(id)
}

function sanitizeUserRow(row) {
  if (!row) return null
  const merged = getMergedPermissions(row)
  const userPermissions = parseJson(row.permissions, {})
  const primaryAdmin = isPrimaryAdmin(row)
  const hasAdmin = !!(merged?.all || primaryAdmin || String(row.role_code || '').trim().toLowerCase() === 'admin')
  const { role_permissions: _rolePermissions, role_code: _roleCode, ...rest } = row
  return {
    ...rest,
    permissions: JSON.stringify(userPermissions),
    has_admin_access: hasAdmin,
    is_primary_admin: primaryAdmin,
    role_is_system: Number(row.role_is_system || 0) === 1,
  }
}

function isValidEmail(value) {
  if (!value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())
}

/**
 * 2. User List + Profile Routes
 */
router.get('/users', authToken, (req, res) => {
  const actor = requireAdminControl(req, res)
  if (!actor) return

  const rows = db.prepare(`
    SELECT u.id, u.username, u.name, u.phone, u.phone_verified, u.email, u.email_verified, u.avatar_path, u.role_id, u.permissions,
           u.otp_enabled, u.is_active, u.created_at, r.name AS role_name,
           r.permissions AS role_permissions, r.code AS role_code, r.is_system AS role_is_system
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.deleted_at IS NULL
    ORDER BY u.name, u.username
  `).all()

  res.json(rows.map(sanitizeUserRow))
})

router.get('/users/:id/profile', authToken, (req, res) => {
  const actor = getActorFromRequest(req)
  if (!actor) return err(res, 'No permission', 403)
  const targetId = Number(req.params.id || 0)
  if (!targetId) return err(res, 'Invalid user id', 400)
  const targetSecurity = getUserSecurityContext(targetId)
  if (!targetSecurity) return err(res, 'User not found', 404)
  if (!canManageTarget(actor, targetSecurity)) {
    return err(res, 'No permission', 403)
  }

  const row = getUserWithRole(req.params.id)
  if (!row) return err(res, 'User not found', 404)
  ok(res, sanitizeUserRow(row))
})

router.get('/users/:id/auth-methods', authToken, async (req, res) => {
  const actor = getActorFromRequest(req)
  if (!actor) return err(res, 'No permission', 403)
  const targetId = Number(req.params.id || 0)
  if (!targetId) return err(res, 'Invalid user id', 400)
  const targetSecurity = getUserSecurityContext(targetId)
  if (!targetSecurity) return err(res, 'User not found', 404)
  if (!canManageTarget(actor, targetSecurity)) {
    return err(res, 'No permission', 403)
  }

  const user = db.prepare(`
    SELECT id, username, email, email_verified, otp_enabled, is_active, deleted_at, supabase_user_id
    FROM users
    WHERE id = ?
  `).get(targetId)
  if (!user) return err(res, 'User not found', 404)

  const providerConfig = getSupabaseAuthPublicConfig()
  let authUser = null
  if (providerConfig.enabled && String(user.supabase_user_id || '').trim()) {
    const result = await getAuthUserById(user.supabase_user_id)
    if (result?.success) authUser = result.user
  }

  ok(res, {
    local_password: true,
    email: user.email || '',
    email_verified: Number(user.email_verified || 0) === 1,
    otp_enabled: Number(user.otp_enabled || 0) === 1,
    is_active: Number(user.is_active || 0) === 1 && !user.deleted_at,
    supabase_connected: !!String(user.supabase_user_id || '').trim(),
    supabase_user_id: String(user.supabase_user_id || '').trim(),
    email_login_enabled: !!String(user.email || '').trim(),
    google_ready: providerConfig.googleEnabled && !!String(user.email || '').trim(),
    facebook_ready: providerConfig.facebookEnabled && !!String(user.email || '').trim(),
    google_linked: !!authUser?.hasGoogle,
    facebook_linked: !!authUser?.hasFacebook,
    linked_providers: Array.isArray(authUser?.providers) ? authUser.providers : [],
    last_sign_in_at: authUser?.lastSignInAt || '',
    capabilities: {
      supabase_auth: providerConfig.enabled,
      google_oauth: providerConfig.googleEnabled,
      facebook_oauth: providerConfig.facebookEnabled,
      supabase_email_auth: providerConfig.emailAuthEnabled,
      supabase_mfa_totp: providerConfig.mfaTotpEnabled,
    },
  })
})

router.post('/users/avatar-upload', authToken, upload.single('image'), validateUploadedFile, compressUpload, (req, res) => {
  if (!req.file) return err(res, 'No image uploaded')
  registerUploadFromRequest(req.file, req.body || {})
    .then((asset) => ok(res, { path: asset.public_path, asset }))
    .catch((error) => err(res, error.message || 'Avatar upload failed'))
})

/**
 * 3. Contact Verification Routes
 * 3.1 Email code request/confirm.
 */
router.post('/users/:id/contact-verification/request', authToken, async (req, res) => {
  const { targetUserId, actor, target, targetSecurity } = resolveVerificationContext(req)

  if (!target) return err(res, 'User not found', 404)
  if (!actor) return err(res, 'Actor not found', 403)
  if (!targetSecurity || !canManageTarget(actor, targetSecurity)) return err(res, 'No permission', 403)

  const channel = String(req.body?.channel || '').trim().toLowerCase()
  if (channel !== 'email') {
    return err(res, 'Only email verification is supported')
  }

  const limitKey = getClientKey(req, `${targetUserId}:${channel}`)
  const limit = checkRateLimit(
    'users:contact_verification_request',
    limitKey,
    CONTACT_CODE_REQUEST_LIMIT_MAX,
    CONTACT_CODE_REQUEST_LIMIT_WINDOW_MS
  )
  if (!limit.allowed) {
    return err(res, `Too many verification code requests. Try again in ${limit.retryAfterSeconds} seconds.`, 429)
  }

  const destination = normalizeEmail(req.body?.value || target.email)

  if (!destination) {
    return err(res, 'Valid email is required')
  }

  const purpose = 'verify_email'
  const requestResult = await requestVerificationCode({
    userId: targetUserId,
    userName: target.username,
    purpose,
    channel,
    destination,
    meta: { requestedBy: actor.id, valueOverride: req.body?.value || '' },
  })

  if (!requestResult.success) {
    return err(res, requestResult.error || 'Failed to send verification code')
  }

  audit(actor.id, actor.name, 'contact_verification_request', 'user', targetUserId, {
    channel,
    destination: requestResult.destinationMasked,
    delivered: requestResult.delivered,
    provider: requestResult.provider,
  })

  ok(res, {
    channel,
    destination: requestResult.destinationMasked,
    expiresAt: requestResult.expiresAt,
    delivered: requestResult.delivered,
    provider: requestResult.provider,
  })
})

router.post('/users/:id/contact-verification/confirm', authToken, (req, res) => {
  const { targetUserId, actor, target, targetSecurity } = resolveVerificationContext(req)

  if (!target) return err(res, 'User not found', 404)
  if (!actor) return err(res, 'Actor not found', 403)
  if (!targetSecurity || !canManageTarget(actor, targetSecurity)) return err(res, 'No permission', 403)

  const channel = String(req.body?.channel || '').trim().toLowerCase()
  const code = String(req.body?.code || '').trim()
  if (channel !== 'email' || !code) {
    return err(res, 'Valid channel and verification code are required')
  }

  const limitKey = getClientKey(req, `${targetUserId}:${channel}`)
  const limit = checkRateLimit(
    'users:contact_verification_confirm',
    limitKey,
    CONTACT_CODE_VERIFY_LIMIT_MAX,
    CONTACT_CODE_VERIFY_LIMIT_WINDOW_MS
  )
  if (!limit.allowed) {
    return err(res, `Too many verification attempts. Try again in ${limit.retryAfterSeconds} seconds.`, 429)
  }

  const destination = normalizeEmail(req.body?.value || target.email)
  if (!destination) return err(res, 'Verification destination is invalid')

  const purpose = 'verify_email'
  const verifyResult = verifyCode({
    userId: targetUserId,
    purpose,
    channel,
    destination,
    code,
    consume: true,
  })
  if (!verifyResult.valid) return err(res, 'Invalid or expired verification code', 401)
  resetRateLimit('users:contact_verification_confirm', limitKey)

  db.prepare('UPDATE users SET email = ?, email_verified = 1 WHERE id = ?').run(destination, targetUserId)

  audit(actor.id, actor.name, 'contact_verification_confirm', 'user', targetUserId, { channel })
  broadcast('users')
  ok(res, sanitizeUserRow(getUserWithRole(targetUserId)))
})

/**
 * 4. User CRUD Routes (Admin Control)
 */
router.post('/users', authToken, async (req, res) => {
  const {
    username,
    name,
    phone,
    email,
    avatar_path,
    password,
    permissions,
    role_id,
    is_active,
    userId,
    userName,
  } = req.body || {}

  const actor = requireAdminControl(req, res)
  if (!actor) return
  if (!username?.trim() || !password) return err(res, 'Username and password required')
  if (!isValidEmail(email)) return err(res, 'Valid email required')
  if (isSupabaseAuthConfigured() && String(email || '').trim() && String(password || '').length < 6) {
    return err(res, 'Password must be at least 6 characters when Supabase auth is enabled for email login.')
  }

  try {
    const hash = bcrypt.hashSync(password, 10)
    const normalizedPhone = String(phone || '').trim() || null
    const normalizedEmail = String(email || '').trim().toLowerCase() || null
    const result = db.prepare(`
      INSERT INTO users (
        username, name, phone, phone_verified, email, email_verified,
        avatar_path, password, permissions, role_id, is_active
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      username.trim(),
      (name || username).trim(),
      normalizedPhone,
      0,
      normalizedEmail,
      0,
      String(avatar_path || '').trim() || null,
      hash,
      JSON.stringify(permissions || {}),
      role_id || null,
      is_active ?? 1,
    )

    const createdId = Number(result.lastInsertRowid)
    const createdUser = db.prepare(`
      SELECT id, username, name, email, email_verified, phone, phone_verified, supabase_user_id, is_active
      FROM users WHERE id = ?
    `).get(createdId)

    if (isSupabaseAuthConfigured() && createdUser?.email) {
      const synced = await createOrUpdateAuthUser(createdUser, String(password))
      if (!synced.success && !synced.skipped) {
        db.prepare('DELETE FROM users WHERE id = ?').run(createdId)
        return err(res, synced.error || 'Failed to provision authentication account')
      }
      if (synced.success && synced.userId) {
        db.prepare('UPDATE users SET supabase_user_id = ? WHERE id = ?').run(synced.userId, createdId)
      }
      if (synced.success && synced.userId && !createdUser.is_active) {
        await setAuthUserActive(synced.userId, false)
      }
    }

    audit(userId || actor.id, userName || actor.name, 'create', 'user', createdId, { username: username.trim() })
    broadcast('users')
    ok(res, { id: createdId })
  } catch (e) {
    err(res, e?.message?.includes('UNIQUE') ? 'Username already exists' : (e?.message || 'Failed to create user'))
  }
})

router.put('/users/:id', authToken, async (req, res) => {
  const {
    username,
    name,
    phone,
    email,
    avatar_path,
    permissions,
    role_id,
    is_active,
    userId,
    userName,
    delete_user,
  } = req.body || {}

  const actor = requireAdminControl(req, res)
  if (!actor) return
  if (!username?.trim()) return err(res, 'Username required')
  if (!isValidEmail(email)) return err(res, 'Valid email required')

  try {
    const existing = db.prepare('SELECT id, username, name, permissions, phone, phone_verified, email, email_verified, supabase_user_id, deleted_at, is_active FROM users WHERE id = ?').get(req.params.id)
    const existingSecurity = getUserSecurityContext(req.params.id)
    const adminRole = db.prepare(`SELECT id FROM roles WHERE lower(trim(code)) = 'admin' LIMIT 1`).get()
    if (!existing) return err(res, 'User not found', 404)
    if (!existingSecurity) return err(res, 'User not found', 404)
    if (existing.deleted_at) return err(res, 'User is deleted', 400)
    if (!canManageTarget(actor, existingSecurity)) return err(res, 'Cannot modify another admin account', 403)
    if (isPrimaryAdmin(existingSecurity) && String(username || '').trim().toLowerCase() !== 'admin') {
      return err(res, 'Primary admin username cannot be changed', 400)
    }
    if (isPrimaryAdmin(existingSecurity) && adminRole && Number(role_id || adminRole.id) !== Number(adminRole.id)) {
      return err(res, 'Primary admin role cannot be changed', 400)
    }

    let nextPermissions = permissions || {}
    if (permissions === undefined) nextPermissions = parseJson(existing.permissions, {})
    const nextPhone = String(phone || '').trim() || null
    const nextEmail = String(email || '').trim().toLowerCase() || null
    const phoneChanged = String(existing.phone || '') !== String(nextPhone || '')
    const emailChanged = String(existing.email || '') !== String(nextEmail || '')
    const nextPhoneVerified = 0
    const nextEmailVerified = nextEmail ? (emailChanged ? 0 : Number(existing.email_verified || 0)) : 0

    const markDeleted = !!delete_user
    const nextIsActive = markDeleted ? 0 : (is_active ?? Number(existing.is_active || 0))
    if (isPrimaryAdmin(existingSecurity) && (markDeleted || Number(nextIsActive) === 0)) {
      return err(res, 'Primary admin account cannot be deactivated or deleted', 400)
    }
    if (isSupabaseAuthConfigured() && existing.supabase_user_id && !nextEmail) {
      return err(res, 'Email is required for Supabase-linked accounts.')
    }
    db.prepare(`
      UPDATE users
      SET username = ?, name = ?, phone = ?, phone_verified = ?, email = ?, email_verified = ?, avatar_path = ?, permissions = ?, role_id = ?, is_active = ?, deleted_at = ?
      WHERE id = ?
    `).run(
      username.trim(),
      (name || username).trim(),
      nextPhone,
      nextPhoneVerified,
      nextEmail,
      nextEmailVerified,
      String(avatar_path || '').trim() || null,
      JSON.stringify(nextPermissions),
      role_id || null,
      nextIsActive,
      markDeleted ? new Date().toISOString() : null,
      req.params.id,
    )

    const updatedUser = db.prepare(`
      SELECT id, username, name, email, email_verified, phone, phone_verified, supabase_user_id, is_active
      FROM users WHERE id = ?
    `).get(req.params.id)

    if (isSupabaseAuthConfigured() && (updatedUser?.supabase_user_id || updatedUser?.email)) {
      const synced = await createOrUpdateAuthUser(updatedUser, '')
      if (!synced.success && !synced.skipped) {
        return err(res, synced.error || 'Failed to sync authentication account')
      }
      if (synced.success && synced.userId && !updatedUser.supabase_user_id) {
        db.prepare('UPDATE users SET supabase_user_id = ? WHERE id = ?').run(synced.userId, updatedUser.id)
        updatedUser.supabase_user_id = synced.userId
      }
      if (updatedUser.supabase_user_id) {
        await setAuthUserActive(updatedUser.supabase_user_id, !!updatedUser.is_active && !markDeleted)
      }
    }

    audit(userId || actor.id, userName || actor.name, 'update', 'user', req.params.id)
    broadcast('users')
    ok(res, {})
  } catch (e) {
    err(res, e?.message?.includes('UNIQUE') ? 'Username already exists' : (e?.message || 'Failed to update user'))
  }
})

/**
 * 5. Self-Service Profile + Password Routes
 */
router.put('/users/:id/profile', authToken, async (req, res) => {
  const {
    username,
    name,
    phone,
    email,
    avatar_path,
    currentPassword,
    adminOverride,
    userId,
    userName,
  } = req.body || {}

  if (!username?.trim()) return err(res, 'Username required')
  if (!isValidEmail(email)) return err(res, 'Valid email required')

  const actor = getActorFromRequest(req)
  if (!actor) return err(res, 'No permission', 403)
  const actorCanManage = hasAdminControl(actor)
  const targetSecurity = getUserSecurityContext(req.params.id)
  if (!targetSecurity) return err(res, 'User not found', 404)
  if (!canManageTarget(actor, targetSecurity)) return err(res, 'No permission', 403)
  if (adminOverride && !actorCanManage) return err(res, 'No permission', 403)

  const user = db.prepare('SELECT id, username, name, password, phone, phone_verified, email, email_verified, supabase_user_id, is_active, deleted_at FROM users WHERE id = ? AND deleted_at IS NULL').get(req.params.id)
  if (!user) return err(res, 'User not found', 404)
  if (isPrimaryAdmin(targetSecurity) && String(username || '').trim().toLowerCase() !== 'admin') {
    return err(res, 'Primary admin username cannot be changed', 400)
  }

  if (!adminOverride) {
    if (!currentPassword) return err(res, 'Current password required', 400)
    if (!bcrypt.compareSync(currentPassword, user.password)) return err(res, 'Current password is incorrect', 401)
  }

  try {
    const nextPhone = String(phone || '').trim() || null
    const nextEmail = String(email || '').trim().toLowerCase() || null
    const phoneChanged = String(user.phone || '') !== String(nextPhone || '')
    const emailChanged = String(user.email || '') !== String(nextEmail || '')
    const nextPhoneVerified = 0
    const nextEmailVerified = nextEmail
      ? (adminOverride ? 1 : (emailChanged ? 0 : Number(user.email_verified || 0)))
      : 0
    if (isSupabaseAuthConfigured() && user.supabase_user_id && !nextEmail) {
      return err(res, 'Email is required for Supabase-linked accounts.')
    }

    let supabaseUserId = String(user.supabase_user_id || '').trim()
    const providerEnabled = isSupabaseAuthConfigured()
    if (providerEnabled && (supabaseUserId || nextEmail)) {
      const syncCandidate = {
        id: user.id,
        username: username.trim(),
        name: (name || username).trim(),
        email: nextEmail,
        email_verified: nextEmailVerified,
        phone: nextPhone,
        phone_verified: nextPhoneVerified,
        supabase_user_id: supabaseUserId,
        is_active: Number(user.is_active || 0),
        deleted_at: user.deleted_at || null,
      }
      const provisioningPassword = !supabaseUserId && nextEmail && !adminOverride
        ? String(currentPassword || '')
        : ''
      const syncResult = await createOrUpdateAuthUser(syncCandidate, provisioningPassword)
      if (!syncResult.success && !syncResult.skipped) {
        return err(res, syncResult.error || 'Failed to sync profile with Supabase authentication.')
      }
      if (syncResult.success && syncResult.userId && !supabaseUserId) {
        supabaseUserId = String(syncResult.userId)
      }
    }

    db.prepare(`
      UPDATE users
      SET username = ?, name = ?, phone = ?, phone_verified = ?, email = ?, email_verified = ?, avatar_path = ?, supabase_user_id = COALESCE(NULLIF(?, ''), supabase_user_id)
      WHERE id = ?
    `).run(
      username.trim(),
      (name || username).trim(),
      nextPhone,
      nextPhoneVerified,
      nextEmail,
      nextEmailVerified,
      String(avatar_path || '').trim() || null,
      supabaseUserId,
      req.params.id,
    )

    audit(userId || actor.id, userName || actor.name, 'update', 'user', req.params.id, { mode: 'profile' })
    broadcast('users')
    ok(res, sanitizeUserRow(getUserWithRole(req.params.id)))
  } catch (e) {
    err(res, e?.message?.includes('UNIQUE') ? 'Username already exists' : (e?.message || 'Failed to update profile'))
  }
})

router.post('/users/:id/change-password', authToken, async (req, res) => {
  const { currentPassword, newPassword, adminOverride, userId, userName } = req.body || {}
  if (!newPassword) return err(res, 'New password required')

  const actor = getActorFromRequest(req)
  if (!actor) return err(res, 'No permission', 403)
  const actorCanManage = hasAdminControl(actor)
  const targetSecurity = getUserSecurityContext(req.params.id)
  if (!targetSecurity) return err(res, 'User not found', 404)
  if (!canManageTarget(actor, targetSecurity)) return err(res, 'No permission', 403)

  const user = db.prepare('SELECT id, username, name, email, email_verified, phone, phone_verified, password, is_active, deleted_at, supabase_user_id FROM users WHERE id = ?').get(req.params.id)
  if (!user) return err(res, 'User not found', 404)
  if (user.deleted_at || !user.is_active) return err(res, 'User account is inactive', 400)

  const allowAdminOverride = !!adminOverride && actorCanManage
  if (!allowAdminOverride) {
    if (!currentPassword) return err(res, 'Current password required', 400)
    if (!bcrypt.compareSync(currentPassword, user.password)) return err(res, 'Current password is incorrect', 401)
  }

  let supabaseUserId = String(user.supabase_user_id || '').trim()
  const shouldUseSupabase = isSupabaseAuthConfigured() && (supabaseUserId || user.email)
  if (shouldUseSupabase && String(newPassword).length < 6) {
    return err(res, 'Password must be at least 6 characters when Supabase auth is enabled.')
  }
  if (shouldUseSupabase && !supabaseUserId && user.email) {
    const provision = await createOrUpdateAuthUser(user, newPassword)
    if (!provision.success && !provision.skipped) return err(res, provision.error || 'Failed to provision Supabase authentication.')
    if (provision.success && provision.userId) supabaseUserId = String(provision.userId)
  }
  if (shouldUseSupabase && supabaseUserId) {
    const sync = await updateAuthPassword(supabaseUserId, newPassword)
    if (!sync.success && !sync.skipped) return err(res, sync.error || 'Failed to sync password to auth provider')
  }
  const hash = bcrypt.hashSync(newPassword, 10)
  db.prepare('UPDATE users SET password = ?, supabase_user_id = COALESCE(NULLIF(?, \'\'), supabase_user_id) WHERE id = ?')
    .run(hash, supabaseUserId, req.params.id)
  audit(userId || actor.id, userName || actor.name, 'reset_password', 'user', req.params.id, { mode: allowAdminOverride ? 'admin' : 'self_service' })
  ok(res, {})
})

router.post('/users/:id/reset-password', authToken, async (req, res) => {
  const { newPassword, userId, userName } = req.body || {}
  const actor = requireAdminControl(req, res)
  if (!actor) return
  if (!newPassword) return err(res, 'New password required')

  const target = db.prepare('SELECT id, username, name, email, email_verified, phone, phone_verified, is_active, deleted_at, supabase_user_id FROM users WHERE id = ?').get(req.params.id)
  const targetSecurity = getUserSecurityContext(req.params.id)
  if (!target) return err(res, 'User not found', 404)
  if (!targetSecurity) return err(res, 'User not found', 404)
  if (!canManageTarget(actor, targetSecurity)) return err(res, 'Cannot reset another admin account password', 403)
  if (target.deleted_at || !target.is_active) return err(res, 'User account is inactive', 400)

  let supabaseUserId = String(target.supabase_user_id || '').trim()
  const shouldUseSupabase = isSupabaseAuthConfigured() && (supabaseUserId || target.email)
  if (shouldUseSupabase && String(newPassword).length < 6) {
    return err(res, 'Password must be at least 6 characters when Supabase auth is enabled.')
  }
  if (shouldUseSupabase && !supabaseUserId && target.email) {
    const provision = await createOrUpdateAuthUser(target, newPassword)
    if (!provision.success && !provision.skipped) return err(res, provision.error || 'Failed to provision Supabase authentication.')
    if (provision.success && provision.userId) supabaseUserId = String(provision.userId)
  }
  if (shouldUseSupabase && supabaseUserId) {
    const sync = await updateAuthPassword(supabaseUserId, newPassword)
    if (!sync.success && !sync.skipped) return err(res, sync.error || 'Failed to sync password to auth provider')
  }
  const hash = bcrypt.hashSync(newPassword, 10)
  db.prepare('UPDATE users SET password = ?, supabase_user_id = COALESCE(NULLIF(?, \'\'), supabase_user_id) WHERE id = ?')
    .run(hash, supabaseUserId, req.params.id)
  audit(userId || actor.id, userName || actor.name, 'reset_password', 'user', req.params.id)
  ok(res, {})
})

/**
 * 6. Role CRUD Routes (Admin Control)
 */
router.get('/roles', authToken, (req, res) => {
  const actor = requireAdminControl(req, res)
  if (!actor) return
  res.json(db.prepare('SELECT * FROM roles ORDER BY is_system DESC, name').all())
})

router.post('/roles', authToken, (req, res) => {
  const { name, permissions, userId, userName } = req.body || {}
  const actor = requireAdminControl(req, res)
  if (!actor) return
  const normalizedName = String(name || '').trim()
  if (!normalizedName) return err(res, 'Name required')
  if (normalizedName.toLowerCase() === 'admin') return err(res, 'Admin role is reserved', 400)
  try {
    const result = db.prepare('INSERT INTO roles (name, code, is_system, permissions) VALUES (?,?,?,?)')
      .run(normalizedName, null, 0, JSON.stringify(permissions || {}))
    audit(userId || actor.id, userName || actor.name, 'create', 'role', result.lastInsertRowid, { name: normalizedName })
    broadcast('roles')
    ok(res, { id: result.lastInsertRowid })
  } catch (_) {
    err(res, 'Role already exists')
  }
})

router.put('/roles/:id', authToken, (req, res) => {
  const { name, permissions, userId, userName } = req.body || {}
  const actor = requireAdminControl(req, res)
  if (!actor) return
  const existingRole = db.prepare('SELECT id, code, is_system FROM roles WHERE id = ?').get(req.params.id)
  if (!existingRole) return err(res, 'Role not found', 404)
  if (Number(existingRole.is_system || 0) === 1 || String(existingRole.code || '').trim().toLowerCase() === 'admin') {
    return err(res, 'System roles cannot be edited', 403)
  }
  const normalizedName = String(name || '').trim()
  if (!normalizedName) return err(res, 'Name required')
  if (normalizedName.toLowerCase() === 'admin') return err(res, 'Admin role is reserved', 400)
  db.prepare('UPDATE roles SET name = ?, permissions = ? WHERE id = ?')
    .run(normalizedName, JSON.stringify(permissions || {}), req.params.id)
  audit(userId || actor.id, userName || actor.name, 'update', 'role', req.params.id, { name: normalizedName })
  broadcast('roles')
  ok(res, {})
})

router.delete('/roles/:id', authToken, (req, res) => {
  const userId = req.body?.userId || req.query?.userId
  const userName = req.body?.userName || req.query?.userName
  const actor = requireAdminControl(req, res)
  if (!actor) return
  const existingRole = db.prepare('SELECT id, code, is_system FROM roles WHERE id = ?').get(req.params.id)
  if (!existingRole) return err(res, 'Role not found', 404)
  if (Number(existingRole.is_system || 0) === 1 || String(existingRole.code || '').trim().toLowerCase() === 'admin') {
    return err(res, 'System roles cannot be deleted', 403)
  }
  const assignedUsers = db.prepare('SELECT COUNT(*) AS n FROM users WHERE role_id = ? AND deleted_at IS NULL').get(req.params.id)
  if (Number(assignedUsers?.n || 0) > 0) return err(res, 'Role still has assigned users', 400)
  db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id)
  audit(userId || actor.id, userName || actor.name, 'delete', 'role', req.params.id)
  broadcast('roles')
  ok(res, {})
})

module.exports = router
