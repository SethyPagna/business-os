'use strict'
/**
 * users.js
 * User/role management and profile security routes.
 *
 * Responsibilities:
 * - Admin-managed user/role lifecycle.
 * - Self-service profile/password updates.
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
const { authToken, upload, compressUpload, validateUploadedFile, routeRateLimit, getAuditActor } = require('../middleware')
const { registerUploadFromRequest } = require('../fileAssets')
const {
  isSupabaseAuthConfigured,
  getSupabaseAuthPublicConfig,
  createOrUpdateAuthUser,
  updateAuthPassword,
  setAuthUserActive,
  getAuthUserById,
  findAuthUserByEmail,
  verifyPasswordWithSupabase,
  unlinkAuthIdentity,
} = require('../services/supabaseAuth')
const { normalizeEmail, normalizePhone } = require('../services/verification')
const {
  getDefaultOrganization,
  getDefaultOrganizationGroup,
  getOrganizationContextForUser,
} = require('../organizationContext')
const { assertUpdatedAtMatch, getExpectedUpdatedAt, sendWriteConflict } = require('../conflictControl')
const { revokeUserSessions } = require('../sessionAuth')

const router = express.Router()

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

function normalizeLookupText(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizePhoneLookup(value) {
  return normalizePhone(value || '')
}

function findUserIdentityConflict({ username, name, email, phoneLookup, supabaseUserId }, excludeUserId = null) {
  const excludeId = Number(excludeUserId || 0) || 0
  const usernameLookup = normalizeLookupText(username)
  if (usernameLookup) {
    const row = db.prepare(`
      SELECT id
      FROM users
      WHERE lower(trim(username)) = ?
        AND (? = 0 OR id != ?)
      LIMIT 1
    `).get(usernameLookup, excludeId, excludeId)
    if (row) return { field: 'username', message: 'Username already exists' }
  }

  const nameLookup = normalizeLookupText(name)
  if (nameLookup) {
    const row = db.prepare(`
      SELECT id
      FROM users
      WHERE lower(trim(name)) = ?
        AND (? = 0 OR id != ?)
      LIMIT 1
    `).get(nameLookup, excludeId, excludeId)
    if (row) return { field: 'name', message: 'Name already exists' }
  }

  const emailLookup = normalizeEmail(email || '')
  if (emailLookup) {
    const row = db.prepare(`
      SELECT id
      FROM users
      WHERE lower(trim(email)) = ?
        AND (? = 0 OR id != ?)
      LIMIT 1
    `).get(emailLookup, excludeId, excludeId)
    if (row) return { field: 'email', message: 'Email already exists' }
  }

  if (phoneLookup) {
    const row = db.prepare(`
      SELECT id
      FROM users
      WHERE phone_lookup = ?
        AND (? = 0 OR id != ?)
      LIMIT 1
    `).get(phoneLookup, excludeId, excludeId)
    if (row) return { field: 'phone', message: 'Phone number already exists' }
  }

  const providerUserId = String(supabaseUserId || '').trim()
  if (providerUserId) {
    const row = db.prepare(`
      SELECT id
      FROM users
      WHERE supabase_user_id = ?
        AND (? = 0 OR id != ?)
      LIMIT 1
    `).get(providerUserId, excludeId, excludeId)
    if (row) return { field: 'supabase_user_id', message: 'This Google account is already linked to another user' }
  }

  return null
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
    SELECT u.id, u.username, u.permissions, u.role_id, u.organization_id, u.organization_group_id,
           r.permissions AS role_permissions, r.code AS role_code
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = ? AND u.deleted_at IS NULL
  `).get(id)
}

function getUserWithRole(id) {
  return db.prepare(`
    SELECT u.id, u.username, u.name, u.organization_id, u.organization_group_id, u.phone, u.phone_verified, u.email, u.email_verified, u.avatar_path, u.role_id, u.permissions,
           u.otp_enabled, u.is_active, u.supabase_user_id, u.deleted_at, u.created_at, u.updated_at, r.name AS role_name,
           r.permissions AS role_permissions, r.code AS role_code, r.is_system AS role_is_system,
           o.name AS organization_name, o.slug AS organization_slug, o.public_id AS organization_public_id,
           g.name AS organization_group_name, g.slug AS organization_group_slug
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN organization_groups g ON g.id = u.organization_group_id
    WHERE u.id = ?
  `).get(id)
}

function syncLocalEmailVerification(userId, authUser) {
  if (!authUser?.emailConfirmed) return
  const existing = db.prepare('SELECT id, email, email_verified, supabase_user_id FROM users WHERE id = ?').get(userId)
  if (!existing) return
  const localEmail = normalizeEmail(existing.email || '')
  const authEmail = normalizeEmail(authUser.email || '')
  const emailConflict = authEmail
    ? db.prepare('SELECT id FROM users WHERE id != ? AND lower(trim(email)) = ? LIMIT 1').get(userId, authEmail)
    : null
  const shouldReplaceEmail = !emailConflict && (!localEmail || (authEmail && localEmail === authEmail))
  db.prepare(`
    UPDATE users
    SET email = CASE
          WHEN ? = 1 THEN COALESCE(?, email)
          ELSE email
        END,
        email_verified = CASE
          WHEN ? = 1 THEN 1
          ELSE email_verified
        END,
        supabase_user_id = COALESCE(NULLIF(?, ''), supabase_user_id)
    WHERE id = ?
  `).run(
    shouldReplaceEmail ? 1 : 0,
    shouldReplaceEmail ? (authEmail || null) : null,
    shouldReplaceEmail ? 1 : 0,
    String(authUser.id || '').trim() || null,
    userId,
  )
}

async function repairSupabaseIdentityForUser(user) {
  if (!user || !isSupabaseAuthConfigured()) return { user, authUser: null }

  const currentId = String(user.supabase_user_id || '').trim()
  if (currentId) {
    const byId = await getAuthUserById(currentId)
    if (byId?.success && byId.user) {
      if (byId.user.emailConfirmed && Number(user.email_verified || 0) !== 1) {
        syncLocalEmailVerification(user.id, byId.user)
        const refreshed = getUserWithRole(user.id) || user
        return { user: refreshed, authUser: byId.user }
      }
      return { user, authUser: byId.user }
    }
  }

  const email = normalizeEmail(user.email || '')
  if (!email) return { user, authUser: null }
  const byEmail = await findAuthUserByEmail(email)
  if (!byEmail?.success || !byEmail.user?.id) return { user, authUser: null }

  db.prepare('UPDATE users SET supabase_user_id = ? WHERE id = ?').run(String(byEmail.user.id).trim(), user.id)
  if (byEmail.user.emailConfirmed && Number(user.email_verified || 0) !== 1) {
    syncLocalEmailVerification(user.id, byEmail.user)
  }
  const refreshed = getUserWithRole(user.id) || getUserSecurityContext(user.id) || user
  return { user: refreshed, authUser: byEmail.user }
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

function getAuthIdentityList(authUser) {
  if (Array.isArray(authUser?.raw?.identities)) return authUser.raw.identities
  if (Array.isArray(authUser?.identities)) return authUser.identities
  return []
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim())
}

function resolveAuthIdentityUuid(identity) {
  const candidates = [
    identity?.identity_id,
    identity?.id,
  ]
  const match = candidates.find((value) => isUuid(value))
  return match ? String(match).trim() : ''
}

function buildAuthMethodsPayload(user, authUser, providerConfig) {
  const identities = getAuthIdentityList(authUser)
  const providerList = Array.isArray(authUser?.providers) ? authUser.providers : []
  const hasEmailIdentity = providerList.includes('email')
  return {
    local_password: true,
    email: user.email || '',
    email_verified: Number(user.email_verified || 0) === 1,
    otp_enabled: Number(user.otp_enabled || 0) === 1,
    is_active: Number(user.is_active || 0) === 1 && !user.deleted_at,
    supabase_connected: !!String(user.supabase_user_id || '').trim(),
    supabase_user_id: String(user.supabase_user_id || '').trim(),
    email_login_enabled: !!String(user.email || '').trim(),
    google_ready: providerConfig.googleEnabled,
    google_linked: !!authUser?.hasGoogle,
    linked_providers: providerList,
    linked_identity_count: identities.length,
    email_identity_ready: hasEmailIdentity,
    can_disconnect_google: !!authUser?.hasGoogle && identities.length > 1,
    last_sign_in_at: authUser?.lastSignInAt || '',
    capabilities: {
      supabase_auth: providerConfig.enabled,
      google_oauth: providerConfig.googleEnabled,
      supabase_email_auth: providerConfig.emailAuthEnabled,
      supabase_mfa_totp: providerConfig.mfaTotpEnabled,
    },
  }
}

/**
 * 2. User List + Profile Routes
 */
router.get('/users', authToken, (req, res) => {
  const actor = requireAdminControl(req, res)
  if (!actor) return

  const rows = db.prepare(`
    SELECT u.id, u.username, u.name, u.organization_id, u.organization_group_id, u.phone, u.phone_verified, u.email, u.email_verified, u.avatar_path, u.role_id, u.permissions,
           u.otp_enabled, u.is_active, u.created_at, u.updated_at, r.name AS role_name,
           r.permissions AS role_permissions, r.code AS role_code, r.is_system AS role_is_system,
           o.name AS organization_name, o.slug AS organization_slug, o.public_id AS organization_public_id,
           g.name AS organization_group_name, g.slug AS organization_group_slug
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN organization_groups g ON g.id = u.organization_group_id
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

  let row = getUserWithRole(req.params.id)
  if (!row) return err(res, 'User not found', 404)

  repairSupabaseIdentityForUser(row)
    .then((result) => ok(res, sanitizeUserRow(result?.user || row)))
    .catch(() => ok(res, sanitizeUserRow(row)))
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
  let resolvedUser = user
  if (providerConfig.enabled) {
    const repaired = await repairSupabaseIdentityForUser(user)
    resolvedUser = repaired?.user || user
    authUser = repaired?.authUser || null
  }

  ok(res, buildAuthMethodsPayload(resolvedUser, authUser, providerConfig))
})

router.post('/users/:id/provider-disconnect', authToken, async (req, res) => {
  const actor = getActorFromRequest(req)
  if (!actor) return err(res, 'No permission', 403)
  const targetId = Number(req.params.id || 0)
  if (!targetId) return err(res, 'Invalid user id', 400)
  if (Number(actor.id || 0) !== targetId) {
    return err(res, 'You can only disconnect sign-in providers from your own account.', 403)
  }

  const provider = String(req.body?.provider || '').trim().toLowerCase()
  const currentPassword = String(req.body?.currentPassword || '')
  if (provider !== 'google') {
    return err(res, 'Unsupported provider', 400)
  }
  if (!currentPassword) {
    return err(res, 'Current password required', 400)
  }

  const user = db.prepare(`
    SELECT id, username, name, organization_id, organization_group_id, email, email_verified, otp_enabled, is_active, deleted_at, supabase_user_id, password
    FROM users
    WHERE id = ? AND deleted_at IS NULL
  `).get(targetId)
  if (!user) return err(res, 'User not found', 404)
  if (!user.is_active) return err(res, 'User account is inactive', 400)
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return err(res, 'Current password is incorrect', 401)
  }
  if (!isSupabaseAuthConfigured()) {
    return err(res, 'Supabase auth is not configured.', 400)
  }
  const repaired = await repairSupabaseIdentityForUser(user)
  const resolvedUser = repaired?.user || user
  if (!String(resolvedUser.supabase_user_id || '').trim()) {
    return err(res, 'This account is not ready for provider disconnect yet.', 400)
  }

  const providerConfig = getSupabaseAuthPublicConfig()
  if (provider === 'google' && !providerConfig.googleEnabled) return err(res, 'Google sign-in is not enabled in Supabase yet.', 400)
  const provisionResult = await createOrUpdateAuthUser(resolvedUser, currentPassword)
  if (!provisionResult.success && !provisionResult.skipped) {
    return err(res, provisionResult.error || 'Failed to prepare the Supabase account for provider changes.')
  }

  const signInResult = await verifyPasswordWithSupabase(resolvedUser, currentPassword)
  if (!signInResult.success || !signInResult.accessToken) {
    return err(res, signInResult.error || 'Unable to verify the Supabase account password for provider disconnect.', 400)
  }

  let authResult = await getAuthUserById(resolvedUser.supabase_user_id)
  if (!authResult?.success || !authResult.user) {
    return err(res, authResult?.error || 'Unable to load linked sign-in providers from Supabase.', 400)
  }

  const identitiesBefore = getAuthIdentityList(authResult.user)
  const providerIdentity = identitiesBefore.find((identity) => String(identity?.provider || identity?.identity_data?.provider || '').trim().toLowerCase() === provider)
  const providerIdentityId = resolveAuthIdentityUuid(providerIdentity)
  if (!providerIdentityId) {
    return err(res, 'That provider is not currently linked to this account.', 400)
  }
  if (identitiesBefore.length < 2) {
    return err(res, 'Add another sign-in method before disconnecting this provider.', 400)
  }

  const unlinkResult = await unlinkAuthIdentity(signInResult.accessToken, providerIdentityId)
  if (!unlinkResult.success) {
    return err(res, unlinkResult.error || 'Failed to disconnect the selected sign-in provider.', 400)
  }

  authResult = await getAuthUserById(resolvedUser.supabase_user_id)
  if (!authResult?.success || !authResult.user) {
    return err(res, authResult?.error || 'Provider was disconnected, but the refreshed auth state could not be loaded.', 502)
  }

  audit(actor.id, actor.name, 'identity_unlinked', 'user', targetId, {
    provider,
    email: String(resolvedUser.email || '').trim().toLowerCase() || null,
    supabase_user_id: String(resolvedUser.supabase_user_id || '').trim() || null,
  })
  broadcast('users')

  ok(res, {
    provider,
    methods: buildAuthMethodsPayload(resolvedUser, authResult.user, providerConfig),
  })
})

router.post('/users/avatar-upload', authToken, routeRateLimit({ name: 'users:avatar_upload', max: 20, windowMs: 5 * 60 * 1000, message: 'Too many avatar uploads.' }), upload.single('image'), validateUploadedFile, compressUpload, (req, res) => {
  if (!req.file) return err(res, 'No image uploaded')
  registerUploadFromRequest(req.file, getAuditActor(req))
    .then((asset) => ok(res, { path: asset.public_path, asset }))
    .catch((error) => err(res, error.message || 'Avatar upload failed'))
})

/**
 * 3. Retired Contact Verification Routes
 * Email-code verification is intentionally retired in favor of OTP and
 * provider sign-in. Keep the endpoints predictable for stale clients.
 */
router.post('/users/:id/contact-verification/request', authToken, (_req, res) => {
  err(res, 'Email verification is disabled in this build. Use OTP, Google, or password sign-in instead.', 410)
})

router.post('/users/:id/contact-verification/confirm', authToken, (_req, res) => {
  err(res, 'Email verification is disabled in this build. Use OTP, Google, or password sign-in instead.', 410)
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
    const normalizedUsername = username.trim()
    const normalizedName = (name || username).trim()
    const normalizedPhone = String(phone || '').trim() || null
    const normalizedPhoneLookup = normalizePhoneLookup(normalizedPhone)
    const normalizedEmail = String(email || '').trim().toLowerCase() || null
    const conflict = findUserIdentityConflict({
      username: normalizedUsername,
      name: normalizedName,
      email: normalizedEmail,
      phoneLookup: normalizedPhoneLookup,
    })
    if (conflict) return err(res, conflict.message, 409)
    const actorOrg = getOrganizationContextForUser(actor.id)
    const defaultOrg = getDefaultOrganization()
    const resolvedOrgId = Number(actorOrg?.organization_id || defaultOrg?.id || 0) || null
    const defaultGroup = resolvedOrgId ? getDefaultOrganizationGroup(resolvedOrgId) : null
    const resolvedGroupId = Number(actorOrg?.organization_group_id || defaultGroup?.id || 0) || null
    const result = db.prepare(`
      INSERT INTO users (
        username, name, organization_id, organization_group_id, phone, phone_lookup, phone_verified, email, email_verified,
        avatar_path, password, permissions, role_id, is_active
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      normalizedUsername,
      normalizedName,
      resolvedOrgId,
      resolvedGroupId,
      normalizedPhone,
      normalizedPhoneLookup || null,
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
      SELECT id, username, name, organization_id, organization_group_id, email, email_verified, phone, phone_verified, supabase_user_id, is_active
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
    const message = String(e?.message || '')
    if (message.includes('idx_users_name_lookup')) return err(res, 'Name already exists', 409)
    if (message.includes('idx_users_email_lookup') || message.includes('users.email')) return err(res, 'Email already exists', 409)
    if (message.includes('idx_users_phone_lookup') || message.includes('users.phone_lookup')) return err(res, 'Phone number already exists', 409)
    if (message.includes('idx_users_supabase_user_id') || message.includes('users.supabase_user_id')) return err(res, 'This Google account is already linked to another user', 409)
    err(res, message.includes('UNIQUE') ? 'Username already exists' : (message || 'Failed to create user'))
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
    const existing = db.prepare('SELECT id, username, name, permissions, phone, phone_verified, email, email_verified, supabase_user_id, deleted_at, is_active, updated_at FROM users WHERE id = ?').get(req.params.id)
    const existingSecurity = getUserSecurityContext(req.params.id)
    const adminRole = db.prepare(`SELECT id FROM roles WHERE lower(trim(code)) = 'admin' LIMIT 1`).get()
    if (!existing) return err(res, 'User not found', 404)
    if (!existingSecurity) return err(res, 'User not found', 404)
    assertUpdatedAtMatch('user', existing, getExpectedUpdatedAt(req.body || {}))
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
    const normalizedUsername = username.trim()
    const normalizedName = (name || username).trim()
    const nextPhone = String(phone || '').trim() || null
    const nextPhoneLookup = normalizePhoneLookup(nextPhone)
    const nextEmail = String(email || '').trim().toLowerCase() || null
    const phoneChanged = String(existing.phone || '') !== String(nextPhone || '')
    const emailChanged = String(existing.email || '') !== String(nextEmail || '')
    const nextPhoneVerified = 0
    const nextEmailVerified = nextEmail ? (emailChanged ? 0 : Number(existing.email_verified || 0)) : 0
    const conflict = findUserIdentityConflict({
      username: normalizedUsername,
      name: normalizedName,
      email: nextEmail,
      phoneLookup: nextPhoneLookup,
      supabaseUserId: existing.supabase_user_id,
    }, existing.id)
    if (conflict) return err(res, conflict.message, 409)

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
      SET username = ?, name = ?, phone = ?, phone_lookup = ?, phone_verified = ?, email = ?, email_verified = ?, avatar_path = ?, permissions = ?, role_id = ?, is_active = ?, deleted_at = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      normalizedUsername,
      normalizedName,
      nextPhone,
      nextPhoneLookup || null,
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
        db.prepare('UPDATE users SET supabase_user_id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(synced.userId, updatedUser.id)
        updatedUser.supabase_user_id = synced.userId
      }
      if (updatedUser.supabase_user_id) {
        await setAuthUserActive(updatedUser.supabase_user_id, !!updatedUser.is_active && !markDeleted)
      }
    }

    audit(userId || actor.id, userName || actor.name, 'update', 'user', req.params.id)
    broadcast('users')
    ok(res, sanitizeUserRow(getUserWithRole(req.params.id)))
  } catch (e) {
    if (e?.name === 'WriteConflictError') return sendWriteConflict(res, e)
    const message = String(e?.message || '')
    if (message.includes('idx_users_name_lookup')) return err(res, 'Name already exists', 409)
    if (message.includes('idx_users_email_lookup') || message.includes('users.email')) return err(res, 'Email already exists', 409)
    if (message.includes('idx_users_phone_lookup') || message.includes('users.phone_lookup')) return err(res, 'Phone number already exists', 409)
    if (message.includes('idx_users_supabase_user_id') || message.includes('users.supabase_user_id')) return err(res, 'This Google account is already linked to another user', 409)
    err(res, message.includes('UNIQUE') ? 'Username already exists' : (message || 'Failed to update user'))
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
    const normalizedUsername = username.trim()
    const normalizedName = (name || username).trim()
    const nextPhone = String(phone || '').trim() || null
    const nextPhoneLookup = normalizePhoneLookup(nextPhone)
    const nextEmail = String(email || '').trim().toLowerCase() || null
    const phoneChanged = String(user.phone || '') !== String(nextPhone || '')
    const emailChanged = String(user.email || '') !== String(nextEmail || '')
    const nextPhoneVerified = 0
    const nextEmailVerified = nextEmail
      ? (emailChanged ? 0 : Number(user.email_verified || 0))
      : 0
    const conflict = findUserIdentityConflict({
      username: normalizedUsername,
      name: normalizedName,
      email: nextEmail,
      phoneLookup: nextPhoneLookup,
      supabaseUserId: user.supabase_user_id,
    }, user.id)
    if (conflict) return err(res, conflict.message, 409)

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
      SET username = ?, name = ?, phone = ?, phone_lookup = ?, phone_verified = ?, email = ?, email_verified = ?, avatar_path = ?, supabase_user_id = COALESCE(NULLIF(?, ''), supabase_user_id), updated_at = datetime('now')
      WHERE id = ?
    `).run(
      normalizedUsername,
      normalizedName,
      nextPhone,
      nextPhoneLookup || null,
      nextPhoneVerified,
      nextEmail,
      nextEmailVerified,
      String(avatar_path || '').trim() || null,
      supabaseUserId,
      req.params.id,
    )

    audit(userId || actor.id, userName || actor.name, 'update', 'user', req.params.id, {
      mode: 'profile',
      email_changed: emailChanged,
      email_verification_reset: !!(emailChanged && nextEmail),
      previous_email: user.email || null,
      next_email: nextEmail,
      previous_email_verified: Number(user.email_verified || 0) === 1,
      next_email_verified: Number(nextEmailVerified || 0) === 1,
    })
    broadcast('users')
    ok(res, sanitizeUserRow(getUserWithRole(req.params.id)))
  } catch (e) {
    const message = String(e?.message || '')
    if (message.includes('idx_users_name_lookup')) {
      return err(res, 'Name already exists', 409)
    }
    if (message.includes('UNIQUE constraint failed: users.email')) {
      return err(res, 'Email already exists', 409)
    }
    if (message.includes('idx_users_email_lookup')) {
      return err(res, 'Email already exists', 409)
    }
    if (message.includes('idx_users_phone_lookup') || message.includes('users.phone_lookup')) {
      return err(res, 'Phone number already exists', 409)
    }
    if (message.includes('idx_users_supabase_user_id') || message.includes('users.supabase_user_id')) {
      return err(res, 'This Google account is already linked to another user', 409)
    }
    if (message.includes('UNIQUE')) {
      return err(res, 'Username already exists', 409)
    }
    err(res, message || 'Failed to update profile')
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
  db.prepare('UPDATE users SET password = ?, supabase_user_id = COALESCE(NULLIF(?, \'\'), supabase_user_id), updated_at = datetime(\'now\') WHERE id = ?')
    .run(hash, supabaseUserId, req.params.id)
  revokeUserSessions(req.params.id)
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
  db.prepare('UPDATE users SET password = ?, supabase_user_id = COALESCE(NULLIF(?, \'\'), supabase_user_id), updated_at = datetime(\'now\') WHERE id = ?')
    .run(hash, supabaseUserId, req.params.id)
  revokeUserSessions(req.params.id)
  audit(userId || actor.id, userName || actor.name, 'reset_password', 'user', req.params.id)
  ok(res, {})
})

/**
 * 6. Role CRUD Routes (Admin Control)
 */
router.get('/roles', authToken, (req, res) => {
  const actor = requireAdminControl(req, res)
  if (!actor) return
  res.json(db.prepare(`
    SELECT id, name, code, is_system, permissions, created_at, updated_at
    FROM roles
    ORDER BY is_system DESC, name
  `).all())
})

router.post('/roles', authToken, (req, res) => {
  const { name, permissions } = req.body || {}
  const actor = requireAdminControl(req, res)
  if (!actor) return
  const normalizedName = String(name || '').trim()
  if (!normalizedName) return err(res, 'Name required')
  if (normalizedName.toLowerCase() === 'admin') return err(res, 'Admin role is reserved', 400)
  try {
    const result = db.prepare('INSERT INTO roles (name, code, is_system, permissions) VALUES (?,?,?,?)')
      .run(normalizedName, null, 0, JSON.stringify(permissions || {}))
    audit(actor.id, actor.name, 'create', 'role', result.lastInsertRowid, { name: normalizedName })
    broadcast('roles')
    ok(res, { id: result.lastInsertRowid })
  } catch (_) {
    err(res, 'Role already exists')
  }
})

router.put('/roles/:id', authToken, (req, res) => {
  const { name, permissions } = req.body || {}
  const actor = requireAdminControl(req, res)
  if (!actor) return
  const existingRole = db.prepare('SELECT id, code, is_system, updated_at FROM roles WHERE id = ?').get(req.params.id)
  if (!existingRole) return err(res, 'Role not found', 404)
  try {
    assertUpdatedAtMatch('role', existingRole, getExpectedUpdatedAt(req.body || {}))
    if (Number(existingRole.is_system || 0) === 1 || String(existingRole.code || '').trim().toLowerCase() === 'admin') {
      return err(res, 'System roles cannot be edited', 403)
    }
    const normalizedName = String(name || '').trim()
    if (!normalizedName) return err(res, 'Name required')
    if (normalizedName.toLowerCase() === 'admin') return err(res, 'Admin role is reserved', 400)
    db.prepare('UPDATE roles SET name = ?, permissions = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(normalizedName, JSON.stringify(permissions || {}), req.params.id)
    audit(actor.id, actor.name, 'update', 'role', req.params.id, { name: normalizedName })
    broadcast('roles')
    ok(res, db.prepare(`
      SELECT id, name, code, is_system, permissions, created_at, updated_at
      FROM roles
      WHERE id = ?
    `).get(req.params.id))
  } catch (error) {
    if (error?.name === 'WriteConflictError') return sendWriteConflict(res, error)
    const message = String(error?.message || '')
    return err(res, message.includes('UNIQUE') ? 'Role already exists' : (message || 'Failed to update role'))
  }
})

router.delete('/roles/:id', authToken, (req, res) => {
  const actor = requireAdminControl(req, res)
  if (!actor) return
  const existingRole = db.prepare('SELECT id, code, is_system, updated_at FROM roles WHERE id = ?').get(req.params.id)
  if (!existingRole) return err(res, 'Role not found', 404)
  try {
    assertUpdatedAtMatch('role', existingRole, getExpectedUpdatedAt(req.body || {}))
  } catch (error) {
    return sendWriteConflict(res, error)
  }
  if (Number(existingRole.is_system || 0) === 1 || String(existingRole.code || '').trim().toLowerCase() === 'admin') {
    return err(res, 'System roles cannot be deleted', 403)
  }
  const assignedUsers = db.prepare('SELECT COUNT(*) AS n FROM users WHERE role_id = ? AND deleted_at IS NULL').get(req.params.id)
  if (Number(assignedUsers?.n || 0) > 0) return err(res, 'Role still has assigned users', 400)
  db.prepare('DELETE FROM roles WHERE id = ?').run(req.params.id)
  audit(actor.id, actor.name, 'delete', 'role', req.params.id)
  broadcast('roles')
  ok(res, {})
})

module.exports = router
