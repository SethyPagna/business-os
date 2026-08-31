import { Hono, type Context } from 'hono'
import { enqueueImageNormalization } from '../lib/imageAudit'
import bcrypt from 'bcryptjs'
import { getDb } from '../lib/db'
import { cascadeUserRename } from '../lib/userIdentity'
import { requireAuth, revokeUserSessions, type SessionUser } from '../lib/auth'
import { audit } from '../lib/audit'
import { isAdminControlUser } from '../lib/permissions'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { broadcast } from '../durable-objects/broadcastHub'
import { getMediaType, buildUniqueStoredName, sanitizeOriginalFileName } from '../lib/fileAssets'
import { validateUploadedBuffer } from '../lib/uploadSecurity'
import { checkRateLimit, getClientIp } from '../lib/rateLimit'
import { passwordTooShort, passwordMinLengthError } from '../lib/passwordPolicy'
import type { Env } from '../index'

// Ported from backend/src/routes/users.ts. Replaces the previous generic
// CRUD stub in compat.ts (plain insertTableRow/updateTableRow with no
// permission checks at all beyond "logged in", no admin-vs-admin
// protection, no primary-admin guardrails, no duplicate-identity checks,
// and no forced re-login after a password change).
//
// What's intentionally NOT ported, and why:
// - Google/Supabase-linked identity sync (createOrUpdateAuthUser,
//   repairGoogleIdentityForUser, provider-disconnect, auth-methods
//   provider probing). The Docker backend's own isGoogleAuthConfigured()
//   always returns false in this build -- every one of those code paths is
//   already dead in the source we're porting from. Endpoints that only
//   existed to serve that flow (auth-methods, provider-disconnect) are
//   kept as honest stubs returning the same "not configured"/local-only
//   shape the original returns when the feature is off, so the frontend
//   doesn't 404.
// - Avatar upload -- ported below (`POST /users/avatar-upload`), reusing
//   the same R2 object storage + file_assets bookkeeping as
//   routes/files.ts's generic upload endpoint, with the same request shape
//   (`multipart/form-data`, field name `image`) the legacy Docker route
//   used and frontend/src/api/fileTransport.ts's `uploadUserAvatar` still
//   sends to when it has a data: URL (e.g. from the avatar cropper) rather
//   than a plain File object.
// - Organization/organization-group multi-tenant assignment beyond
//   inheriting the creating admin's own org -- this Worker's
//   organizations.ts is a simpler single/few-tenant model than the
//   original's full organizationContext service.

const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
// Scoped to the two path prefixes this router actually owns, NOT '*'.
// See index.ts: this router is mounted at the bare `/api` prefix, so a
// `app.use('*', ...)` here registers as `/api/*` middleware that also runs
// for every other `/api/...` route mounted after it. That is the same leak
// that made the public `/api/organizations/*` login endpoints 401 (fixed in
// lookups.ts/contacts.ts, and previously in compat.ts -- see their
// comments). This router happens to be mounted after those endpoints today,
// so it was not causing that symptom itself, but it is the identical latent
// trap for anything registered below it -- closed here rather than left as
// a hazard for the next route someone adds.
// Exact path + subtree wildcard per prefix -- Hono does not treat a bare
// trailing `*` (`/users*`) as a wildcard, which would silently match
// nothing and leave these routes unauthenticated.
for (const prefix of ['/users', '/roles']) {
  app.use(prefix, requireAuth)
  app.use(`${prefix}/*`, requireAuth)
}

type Ctx = Context<{ Bindings: Env; Variables: { user: SessionUser } }>

function normalizeLookup(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function isValidEmail(value: unknown): boolean {
  if (!value) return true
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim())
}

function normalizePhoneLookup(value: unknown): string {
  return String(value || '').replace(/[^\d+]/g, '')
}

function conflictResult(error: unknown) {
  if (error instanceof WriteConflictError) return writeConflictResponse(error)
  return null
}

type IdentityRow = { id: number }

async function findUserIdentityConflict(
  c: Ctx,
  input: { username?: string; name?: string; email?: string | null; phoneLookup?: string | null },
  excludeUserId: number | string | null = null,
): Promise<{ field: string; message: string } | null> {
  const db = getDb(c.env)
  const excludeId = Number(excludeUserId || 0) || 0

  const usernameLookup = normalizeLookup(input.username)
  if (usernameLookup) {
    const row = await db.prepare(
      `SELECT id FROM users WHERE lower(trim(username)) = @username AND (@exclude = 0 OR id != @exclude) LIMIT 1`,
    ).get<IdentityRow>({ username: usernameLookup, exclude: excludeId })
    if (row) return { field: 'username', message: 'Username already exists' }
  }

  const nameLookup = normalizeLookup(input.name)
  if (nameLookup) {
    const row = await db.prepare(
      `SELECT id FROM users WHERE lower(trim(name)) = @name AND (@exclude = 0 OR id != @exclude) LIMIT 1`,
    ).get<IdentityRow>({ name: nameLookup, exclude: excludeId })
    if (row) return { field: 'name', message: 'Name already exists' }
  }

  const emailLookup = normalizeLookup(input.email)
  if (emailLookup) {
    const row = await db.prepare(
      `SELECT id FROM users WHERE lower(trim(email)) = @email AND (@exclude = 0 OR id != @exclude) LIMIT 1`,
    ).get<IdentityRow>({ email: emailLookup, exclude: excludeId })
    if (row) return { field: 'email', message: 'Email already exists' }
  }

  if (input.phoneLookup) {
    const row = await db.prepare(
      `SELECT id FROM users WHERE phone_lookup = @phone AND (@exclude = 0 OR id != @exclude) LIMIT 1`,
    ).get<IdentityRow>({ phone: input.phoneLookup, exclude: excludeId })
    if (row) return { field: 'phone', message: 'Phone number already exists' }
  }

  return null
}

type SecurityContextRow = {
  id: number
  username: string
  permissions: string | null
  role_id: number | null
  role_permissions: string | null
  role_code: string | null
}

async function getUserSecurityContext(c: Ctx, id: number | string): Promise<SecurityContextRow | undefined> {
  return getDb(c.env).prepare(`
    SELECT u.id, u.username, u.permissions, u.role_id,
           r.permissions AS role_permissions, r.code AS role_code
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    WHERE u.id = @id AND u.deleted_at IS NULL
  `).get<SecurityContextRow>({ id })
}

function isPrimaryAdmin(row: { username?: string | null } | undefined): boolean {
  return normalizeLookup(row?.username) === 'admin'
}

function canManageTarget(actor: SessionUser, target: SecurityContextRow | undefined): boolean {
  if (!actor || !target) return false
  if (Number(actor.id) === Number(target.id)) return true
  if (!isAdminControlUser(actor)) return false
  if (isAdminControlUser(target)) return false
  return true
}

async function getUserWithRole(c: Ctx, id: number | string) {
  return getDb(c.env).prepare(`
    SELECT u.id, u.username, u.name, u.organization_id, u.organization_group_id, u.phone, u.phone_verified,
           u.email, u.email_verified, u.avatar_path, u.role_id, u.permissions, u.otp_enabled, u.is_active,
           u.deleted_at, u.created_at, u.updated_at, r.name AS role_name, r.permissions AS role_permissions,
           r.code AS role_code, r.is_system AS role_is_system,
           o.name AS organization_name, o.slug AS organization_slug, o.public_id AS organization_public_id,
           g.name AS organization_group_name, g.slug AS organization_group_slug
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN organization_groups g ON g.id = u.organization_group_id
    WHERE u.id = @id
  `).get<Record<string, unknown>>({ id })
}

function sanitizeUserRow(row: Record<string, unknown> | undefined) {
  if (!row) return null
  const rolePermissions = parseJsonSafe(row.role_permissions)
  const userPermissions = parseJsonSafe(row.permissions)
  const merged = { ...rolePermissions, ...userPermissions } as Record<string, boolean>
  const primaryAdmin = isPrimaryAdmin(row as { username?: string })
  const hasAdmin = !!(merged.all || primaryAdmin || normalizeLookup(row.role_code) === 'admin')
  const { role_permissions: _rp, role_code: _rc, ...rest } = row
  return {
    ...rest,
    role_code: row.role_code,
    permissions: JSON.stringify(userPermissions),
    has_admin_access: hasAdmin,
    is_primary_admin: primaryAdmin,
    role_is_system: Number(row.role_is_system || 0) === 1,
  }
}

function parseJsonSafe(value: unknown): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(String(value))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

async function resolveDefaultOrg(c: Ctx, actor: SessionUser) {
  const db = getDb(c.env)
  const actorRow = await db.prepare('SELECT organization_id, organization_group_id FROM users WHERE id = @id').get<{
    organization_id: number | null
    organization_group_id: number | null
  }>({ id: actor?.id })
  let orgId = actorRow?.organization_id || null
  if (!orgId) {
    const defaultOrg = await db.prepare('SELECT id FROM organizations WHERE is_active = 1 ORDER BY id ASC LIMIT 1').get<{ id: number }>()
    orgId = defaultOrg?.id || null
  }
  let groupId = actorRow?.organization_group_id || null
  if (!groupId && orgId) {
    const defaultGroup = await db.prepare(
      'SELECT id FROM organization_groups WHERE organization_id = @org AND is_active = 1 ORDER BY is_default DESC, id ASC LIMIT 1',
    ).get<{ id: number }>({ org: orgId })
    groupId = defaultGroup?.id || null
  }
  return { orgId, groupId }
}

function mapIdentityErrorMessage(message: string): string | null {
  if (message.includes('idx_users_name_lookup')) return 'Name already exists'
  if (message.includes('idx_users_email_lookup') || message.includes('users.email')) return 'Email already exists'
  if (message.includes('idx_users_phone_lookup') || message.includes('users.phone_lookup')) return 'Phone number already exists'
  if (message.includes('UNIQUE')) return 'Username already exists'
  return null
}

// -- User list + profile --------------------------------------------------

app.get('/users', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  const rows = await getDb(c.env).prepare(`
    SELECT u.id, u.username, u.name, u.organization_id, u.organization_group_id, u.phone, u.phone_verified,
           u.email, u.email_verified, u.avatar_path, u.role_id, u.permissions, u.otp_enabled, u.is_active,
           u.created_at, u.updated_at, r.name AS role_name, r.permissions AS role_permissions,
           r.code AS role_code, r.is_system AS role_is_system,
           o.name AS organization_name, o.slug AS organization_slug, o.public_id AS organization_public_id,
           g.name AS organization_group_name, g.slug AS organization_group_slug
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN organizations o ON o.id = u.organization_id
    LEFT JOIN organization_groups g ON g.id = u.organization_group_id
    WHERE u.deleted_at IS NULL
    ORDER BY u.name, u.username
  `).all<Record<string, unknown>>()
  return c.json(rows.map(sanitizeUserRow))
})

app.get('/users/:id/profile', async (c) => {
  const actor = c.get('user')
  const targetId = Number(c.req.param('id') || 0)
  if (!targetId) return c.json({ success: false, error: 'Invalid user id' }, 400)
  const targetSecurity = await getUserSecurityContext(c, targetId)
  if (!targetSecurity) return c.json({ success: false, error: 'User not found' }, 404)
  if (!canManageTarget(actor, targetSecurity)) return c.json({ success: false, error: 'No permission' }, 403)
  const row = await getUserWithRole(c, targetId)
  if (!row) return c.json({ success: false, error: 'User not found' }, 404)
  return c.json({ success: true, ...sanitizeUserRow(row) })
})

// Google/provider auth is permanently disabled in this backend build (see
// header comment) -- these two report that honestly instead of probing a
// provider that was never configured.
app.get('/users/:id/auth-methods', async (c) => {
  const actor = c.get('user')
  const targetId = Number(c.req.param('id') || 0)
  const targetSecurity = await getUserSecurityContext(c, targetId)
  if (!targetSecurity) return c.json({ success: false, error: 'User not found' }, 404)
  if (!canManageTarget(actor, targetSecurity)) return c.json({ success: false, error: 'No permission' }, 403)
  const user = await getDb(c.env).prepare(
    'SELECT email, email_verified, otp_enabled, is_active FROM users WHERE id = @id',
  ).get<{ email: string | null; email_verified: number; otp_enabled: number; is_active: number }>({ id: targetId })
  if (!user) return c.json({ success: false, error: 'User not found' }, 404)
  return c.json({
    success: true,
    local_password: true,
    email: user.email || '',
    email_verified: Number(user.email_verified || 0) === 1,
    otp_enabled: Number(user.otp_enabled || 0) === 1,
    is_active: Number(user.is_active || 0) === 1,
    google_connected: false,
    google_ready: false,
    linked_providers: [],
    capabilities: { google_auth: false, google_oauth: false, google_email_auth: false, google_mfa_totp: false },
  })
})

app.post('/users/:id/provider-disconnect', (c) => c.json({ success: false, error: 'Google sign-in is not enabled on this deployment.' }, 400))

app.post('/users/:id/contact-verification/request', (c) => c.json({ success: false, error: 'Email verification is disabled in this build. Use password sign-in instead.' }, 410))
app.post('/users/:id/contact-verification/confirm', (c) => c.json({ success: false, error: 'Email verification is disabled in this build. Use password sign-in instead.' }, 410))

// Same reasoning as routes/files.ts: no `sharp` in a Worker isolate, so the
// frontend compresses/resizes with Canvas before sending (see
// frontend/src/utils/imageCompression.ts), targeting 180KB. This is a
// tight safety-net ceiling (1MB, not the old 4MB), not the primary size
// control -- an avatar that genuinely ran the compression plan never
// lands anywhere near 1MB.
const MAX_AVATAR_UPLOAD_BYTES = 1 * 1024 * 1024

app.post('/users/avatar-upload', async (c) => {
  const user = c.get('user')
  const rateLimit = await checkRateLimit(c.env, 'users:avatar_upload', `${getClientIp(c.req.raw)}:${user?.id || 'anon'}`, 20, 5 * 60 * 1000)
  if (!rateLimit.allowed) return c.json({ error: 'Too many avatar uploads.' }, 429)

  const form = await c.req.formData().catch(() => null)
  const file = form?.get('image')
  if (!(file instanceof File)) return c.json({ error: 'No image uploaded' }, 400)
  if (file.size === 0) return c.json({ error: 'Uploaded file is empty' }, 400)

  const originalName = sanitizeOriginalFileName(file.name || 'avatar.jpg')
  const mimeType = file.type || 'image/jpeg'
  const mediaType = getMediaType(mimeType, originalName)
  if (mediaType !== 'image') return c.json({ error: 'Avatar must be an image file' }, 400)

  const buffer = new Uint8Array(await file.arrayBuffer())
  try {
    validateUploadedBuffer(buffer, mimeType, originalName)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
  if (buffer.byteLength > MAX_AVATAR_UPLOAD_BYTES) {
    return c.json({ error: 'Avatar image is too large to save (over 1MB after your browser attempted to compress it). Please try again, or pick a smaller image.' }, 400)
  }

  const storedName = buildUniqueStoredName(originalName)
  const objectKey = `uploads/${storedName}`
  await c.env.ASSETS.put(objectKey, buffer, { httpMetadata: { contentType: mimeType } })
  // K3: same on-upload normalization every other image entry point gets.
  await enqueueImageNormalization(c.env, objectKey)

  const publicPath = `/uploads/${storedName}`
  const db = getDb(c.env)
  const insert = await db.prepare(`
    INSERT INTO file_assets (
      original_name, stored_name, public_path, mime_type, media_type, byte_size,
      source, created_by_id, created_by_name, optimization_status
    ) VALUES (@original_name, @stored_name, @public_path, @mime_type, 'image', @byte_size,
      'avatar', @created_by_id, @created_by_name, 'not_applicable_no_sharp')
  `).run({
    original_name: originalName,
    stored_name: storedName,
    public_path: publicPath,
    mime_type: mimeType,
    byte_size: buffer.byteLength,
    created_by_id: user?.id ?? null,
    created_by_name: user?.name ?? null,
  })

  const asset = await db.prepare('SELECT * FROM file_assets WHERE id = ?').get([insert.lastInsertRowid])
  c.executionCtx.waitUntil(broadcast(c.env, 'files', { action: 'upload', id: insert.lastInsertRowid }))
  return c.json({ path: publicPath, asset })
})

// -- User CRUD (admin control) --------------------------------------------

app.post('/users', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const username = String(body.username || '').trim()
  const password = String(body.password || '').trim()
  const name = String(body.name || username).trim()
  const email = String(body.email || '').trim().toLowerCase() || null
  if (!username || !password) return c.json({ success: false, error: 'Username and password required' }, 400)
  if (passwordTooShort(password)) return c.json({ success: false, error: passwordMinLengthError() }, 400)
  if (!isValidEmail(email)) return c.json({ success: false, error: 'Valid email required' }, 400)
  const roleId = Number(body.role_id)
  if (!Number.isInteger(roleId) || roleId <= 0) {
    return c.json({ success: false, error: 'A role is required when creating a user' }, 400)
  }

  const phone = String(body.phone || '').trim() || null
  const phoneLookup = phone ? normalizePhoneLookup(phone) : null
  const conflict = await findUserIdentityConflict(c, { username, name, email, phoneLookup })
  if (conflict) return c.json({ success: false, error: conflict.message }, 409)

  try {
    const { orgId, groupId } = await resolveDefaultOrg(c, actor)
    const hash = bcrypt.hashSync(password, 10)
    const db = getDb(c.env)
    const role = await db.prepare('SELECT id FROM roles WHERE id = @id LIMIT 1').get<{ id: number }>({ id: roleId })
    if (!role) return c.json({ success: false, error: 'Selected role no longer exists' }, 400)
    const result = await db.prepare(`
      INSERT INTO users (
        username, name, organization_id, organization_group_id, phone, phone_lookup, phone_verified,
        email, email_verified, avatar_path, password, permissions, role_id, is_active
      ) VALUES (@username, @name, @org, @group, @phone, @phone_lookup, 0, @email, 0, @avatar, @password, @permissions, @role_id, @is_active)
    `).run({
      username, name, org: orgId, group: groupId, phone, phone_lookup: phoneLookup,
      email, avatar: String(body.avatar_path || '').trim() || null, password: hash,
      permissions: JSON.stringify(body.permissions || {}), role_id: roleId,
      is_active: body.is_active == null ? 1 : body.is_active,
    })
    const createdId = result.lastInsertRowid
    await audit(c.env, actor?.id ?? null, actor?.name ?? null, 'create', 'user', createdId, { username, name, roleId })
    c.executionCtx.waitUntil(broadcast(c.env, 'users', { action: 'create', id: createdId }))
    return c.json({ success: true, id: createdId })
  } catch (error) {
    const message = String((error as Error)?.message || '')
    return c.json({ success: false, error: mapIdentityErrorMessage(message) || message || 'Failed to create user' }, 500)
  }
})

app.put('/users/:id', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  const id = c.req.param('id')
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const username = String(body.username || '').trim()
  if (!username) return c.json({ success: false, error: 'Username required' }, 400)
  const email = String(body.email || '').trim().toLowerCase() || null
  if (!isValidEmail(email)) return c.json({ success: false, error: 'Valid email required' }, 400)

  const db = getDb(c.env)
  const existing = await db.prepare(
    'SELECT id, username, permissions, phone, email, deleted_at, is_active, updated_at FROM users WHERE id = @id',
  ).get<Record<string, unknown>>({ id })
  const existingSecurity = await getUserSecurityContext(c, id)
  if (!existing || !existingSecurity) return c.json({ success: false, error: 'User not found' }, 404)
  try {
    assertUpdatedAtMatch('user', existing, getExpectedUpdatedAt(body))
  } catch (error) {
    const result = conflictResult(error)
    if (result) return c.json(result.body, result.status)
    throw error
  }
  if (existing.deleted_at) return c.json({ success: false, error: 'User is deleted' }, 400)
  if (!canManageTarget(actor, existingSecurity)) return c.json({ success: false, error: 'Cannot modify another admin account' }, 403)

  const adminRole = await db.prepare(`SELECT id FROM roles WHERE lower(trim(code)) = 'admin' LIMIT 1`).get<{ id: number }>()
  if (isPrimaryAdmin(existingSecurity) && normalizeLookup(username) !== 'admin') {
    return c.json({ success: false, error: 'Primary admin username cannot be changed' }, 400)
  }
  if (isPrimaryAdmin(existingSecurity) && adminRole && Number(body.role_id || adminRole.id) !== Number(adminRole.id)) {
    return c.json({ success: false, error: 'Primary admin role cannot be changed' }, 400)
  }

  const name = String(body.name || username).trim()
  const phone = String(body.phone || '').trim() || null
  const phoneLookup = phone ? normalizePhoneLookup(phone) : null
  const conflict = await findUserIdentityConflict(c, { username, name, email, phoneLookup }, id)
  if (conflict) return c.json({ success: false, error: conflict.message }, 409)

  const markDeleted = !!body.delete_user
  const nextIsActive = markDeleted ? 0 : (body.is_active ?? Number(existing.is_active || 0))
  if (isPrimaryAdmin(existingSecurity) && (markDeleted || Number(nextIsActive) === 0)) {
    return c.json({ success: false, error: 'Primary admin account cannot be deactivated or deleted' }, 400)
  }
  const nextPermissions = body.permissions === undefined ? parseJsonSafe(existing.permissions) : body.permissions

  try {
    await db.prepare(`
      UPDATE users SET username = @username, name = @name, phone = @phone, phone_lookup = @phone_lookup,
        phone_verified = 0, email = @email, email_verified = CASE WHEN @email IS NULL THEN 0 ELSE email_verified END,
        avatar_path = @avatar, permissions = @permissions, role_id = @role_id, is_active = @is_active,
        deleted_at = @deleted_at, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({
      username, name, phone, phone_lookup: phoneLookup, email,
      avatar: String(body.avatar_path || '').trim() || null,
      permissions: JSON.stringify(nextPermissions), role_id: body.role_id || null,
      is_active: nextIsActive, deleted_at: markDeleted ? new Date().toISOString() : null, id,
    })
    // The account id is the source of truth: when the username changes, propagate
    // it to every denormalized snapshot (cashier_name, movement user_name, etc.)
    // so the whole system reflects the new name rather than keeping stale copies.
    if (String(existing.username ?? '').trim() !== username) {
      await cascadeUserRename(db, Number(id), username)
    }
    await audit(c.env, actor?.id ?? null, actor?.name ?? null, 'update', 'user', id)
    c.executionCtx.waitUntil(broadcast(c.env, 'users', { action: 'update', id }))
    return c.json({ success: true, ...sanitizeUserRow(await getUserWithRole(c, id)) })
  } catch (error) {
    const message = String((error as Error)?.message || '')
    return c.json({ success: false, error: mapIdentityErrorMessage(message) || message || 'Failed to update user' }, 500)
  }
})

// -- Self-service profile + password ---------------------------------------

app.put('/users/:id/profile', async (c) => {
  const actor = c.get('user')
  const targetId = c.req.param('id')
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const username = String(body.username || '').trim()
  if (!username) return c.json({ success: false, error: 'Username required' }, 400)
  const email = String(body.email || '').trim().toLowerCase() || null
  if (!isValidEmail(email)) return c.json({ success: false, error: 'Valid email required' }, 400)

  const actorCanManage = isAdminControlUser(actor)
  const targetSecurity = await getUserSecurityContext(c, targetId)
  if (!targetSecurity) return c.json({ success: false, error: 'User not found' }, 404)
  if (!canManageTarget(actor, targetSecurity)) return c.json({ success: false, error: 'No permission' }, 403)
  const adminOverride = !!body.adminOverride
  if (adminOverride && !actorCanManage) return c.json({ success: false, error: 'No permission' }, 403)

  const db = getDb(c.env)
  const user = await db.prepare(
    'SELECT id, username, name, password, phone, email, deleted_at, is_active, updated_at FROM users WHERE id = @id AND deleted_at IS NULL',
  ).get<Record<string, unknown>>({ id: targetId })
  if (!user) return c.json({ success: false, error: 'User not found' }, 404)
  try {
    assertUpdatedAtMatch('user', user, getExpectedUpdatedAt(body))
  } catch (error) {
    const result = conflictResult(error)
    if (result) return c.json(result.body, result.status)
    throw error
  }
  if (isPrimaryAdmin(targetSecurity) && normalizeLookup(username) !== 'admin') {
    return c.json({ success: false, error: 'Primary admin username cannot be changed' }, 400)
  }
  if (!adminOverride) {
    const currentPassword = String(body.currentPassword || '')
    if (!currentPassword) return c.json({ success: false, error: 'Current password required' }, 400)
    if (!bcrypt.compareSync(currentPassword, String(user.password || ''))) {
      return c.json({ success: false, error: 'Current password is incorrect' }, 401)
    }
  }

  const name = String(body.name || username).trim()
  const phone = String(body.phone || '').trim() || null
  const phoneLookup = phone ? normalizePhoneLookup(phone) : null
  const conflict = await findUserIdentityConflict(c, { username, name, email, phoneLookup }, targetId)
  if (conflict) return c.json({ success: false, error: conflict.message }, 409)

  try {
    await db.prepare(`
      UPDATE users SET username = @username, name = @name, phone = @phone, phone_lookup = @phone_lookup,
        phone_verified = 0, email = @email, email_verified = CASE WHEN @email IS NULL THEN 0 ELSE email_verified END,
        avatar_path = @avatar, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ username, name, phone, phone_lookup: phoneLookup, email, avatar: String(body.avatar_path || '').trim() || null, id: targetId })
    // Propagate a username change to every denormalized snapshot (see the admin
    // PUT above) -- same id-is-source-of-truth rule on the self-service path.
    if (String(user.username ?? '').trim() !== username) {
      await cascadeUserRename(db, Number(targetId), username)
    }
    await audit(c.env, actor?.id ?? null, actor?.name ?? null, 'update', 'user', targetId, { mode: 'profile' })
    return c.json({ success: true, ...sanitizeUserRow(await getUserWithRole(c, targetId)) })
  } catch (error) {
    const message = String((error as Error)?.message || '')
    return c.json({ success: false, error: mapIdentityErrorMessage(message) || message || 'Failed to update profile' }, 500)
  }
})

async function handlePasswordChange(c: Ctx, options: { requireCurrent: boolean; requireAdminControl: boolean }) {
  const actor = c.get('user')
  const targetId = c.req.param('id') || ''
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const newPassword = String(body.newPassword || body.new_password || '').trim()
  if (!newPassword) return c.json({ success: false, error: 'New password required' }, 400)
  if (passwordTooShort(newPassword)) return c.json({ success: false, error: passwordMinLengthError() }, 400)

  if (options.requireAdminControl) {
    if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  }
  const targetSecurity = await getUserSecurityContext(c, targetId)
  if (!targetSecurity) return c.json({ success: false, error: 'User not found' }, 404)
  if (!canManageTarget(actor, targetSecurity)) return c.json({ success: false, error: 'Cannot manage another admin account' }, 403)

  const db = getDb(c.env)
  const user = await db.prepare('SELECT id, password, is_active, deleted_at FROM users WHERE id = @id').get<{
    id: number; password: string; is_active: number; deleted_at: string | null
  }>({ id: targetId })
  if (!user) return c.json({ success: false, error: 'User not found' }, 404)
  if (user.deleted_at || !user.is_active) return c.json({ success: false, error: 'User account is inactive' }, 400)

  const allowAdminOverride = options.requireAdminControl || (!!body.adminOverride && isAdminControlUser(actor))
  if (options.requireCurrent && !allowAdminOverride) {
    const currentPassword = String(body.currentPassword || '')
    if (!currentPassword) return c.json({ success: false, error: 'Current password required' }, 400)
    if (!bcrypt.compareSync(currentPassword, user.password)) return c.json({ success: false, error: 'Current password is incorrect' }, 401)
  }

  const hash = bcrypt.hashSync(newPassword, 10)
  await db.prepare('UPDATE users SET password = @password, updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({ password: hash, id: targetId })
  await revokeUserSessions(c.env, targetId)
  await audit(c.env, actor?.id ?? null, actor?.name ?? null, 'reset_password', 'user', targetId, {
    mode: allowAdminOverride ? 'admin' : 'self_service',
  })
  return c.json({ success: true })
}

app.post('/users/:id/change-password', (c) => handlePasswordChange(c, { requireCurrent: true, requireAdminControl: false }))
app.post('/users/:id/reset-password', (c) => handlePasswordChange(c, { requireCurrent: false, requireAdminControl: true }))

// -- Role CRUD (admin control) ---------------------------------------------

app.get('/roles', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  const rows = await getDb(c.env).prepare(
    `SELECT id, name, code, is_system, permissions, created_at, updated_at FROM roles ORDER BY is_system DESC, lower(name) ASC`,
  ).all()
  return c.json(rows)
})

app.post('/roles', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const name = String(body.name || '').trim()
  if (!name) return c.json({ success: false, error: 'Name required' }, 400)
  if (normalizeLookup(name) === 'admin') return c.json({ success: false, error: 'Admin role is reserved' }, 400)
  try {
    const db = getDb(c.env)
    const result = await db.prepare('INSERT INTO roles (name, code, is_system, permissions) VALUES (@name, NULL, 0, @permissions)').run({
      name, permissions: JSON.stringify(body.permissions || {}),
    })
    await audit(c.env, actor?.id ?? null, actor?.name ?? null, 'create', 'role', result.lastInsertRowid, { name })
    c.executionCtx.waitUntil(broadcast(c.env, 'roles', { action: 'create', id: result.lastInsertRowid }))
    return c.json({ success: true, id: result.lastInsertRowid })
  } catch (_error) {
    return c.json({ success: false, error: 'Role already exists' }, 409)
  }
})

app.put('/roles/:id', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  const id = c.req.param('id')
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const db = getDb(c.env)
  const existingRole = await db.prepare('SELECT id, code, is_system, updated_at FROM roles WHERE id = @id').get<{
    id: number; code: string | null; is_system: number; updated_at: string | null
  }>({ id })
  if (!existingRole) return c.json({ success: false, error: 'Role not found' }, 404)
  try {
    assertUpdatedAtMatch('role', existingRole, getExpectedUpdatedAt(body))
  } catch (error) {
    const result = conflictResult(error)
    if (result) return c.json(result.body, result.status)
    throw error
  }
  if (Number(existingRole.is_system || 0) === 1 || normalizeLookup(existingRole.code) === 'admin') {
    return c.json({ success: false, error: 'System roles cannot be edited' }, 403)
  }
  const name = String(body.name || '').trim()
  if (!name) return c.json({ success: false, error: 'Name required' }, 400)
  if (normalizeLookup(name) === 'admin') return c.json({ success: false, error: 'Admin role is reserved' }, 400)
  try {
    await db.prepare('UPDATE roles SET name = @name, permissions = @permissions, updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({
      name, permissions: JSON.stringify(body.permissions || {}), id,
    })
    await audit(c.env, actor?.id ?? null, actor?.name ?? null, 'update', 'role', id, { name })
    c.executionCtx.waitUntil(broadcast(c.env, 'roles', { action: 'update', id }))
    return c.json({ success: true, ...(await db.prepare(
      'SELECT id, name, code, is_system, permissions, created_at, updated_at FROM roles WHERE id = @id',
    ).get({ id })) })
  } catch (error) {
    const message = String((error as Error)?.message || '')
    return c.json({ success: false, error: message.includes('UNIQUE') ? 'Role already exists' : (message || 'Failed to update role') }, 500)
  }
})

app.delete('/roles/:id', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  const id = c.req.param('id')
  const db = getDb(c.env)
  const existingRole = await db.prepare('SELECT id, code, is_system, updated_at FROM roles WHERE id = @id').get<{
    id: number; code: string | null; is_system: number; updated_at: string | null
  }>({ id })
  if (!existingRole) return c.json({ success: false, error: 'Role not found' }, 404)
  try {
    assertUpdatedAtMatch('role', existingRole, getExpectedUpdatedAt(Object.fromEntries(new URL(c.req.url).searchParams)))
  } catch (error) {
    const result = conflictResult(error)
    if (result) return c.json(result.body, result.status)
    throw error
  }
  if (Number(existingRole.is_system || 0) === 1 || normalizeLookup(existingRole.code) === 'admin') {
    return c.json({ success: false, error: 'System roles cannot be deleted' }, 403)
  }
  const assignedUsers = await db.prepare('SELECT COUNT(*) AS n FROM users WHERE role_id = @id AND deleted_at IS NULL').get<{ n: number }>({ id })
  if (Number(assignedUsers?.n || 0) > 0) return c.json({ success: false, error: 'Role still has assigned users' }, 400)
  await db.prepare('DELETE FROM roles WHERE id = @id').run({ id })
  await audit(c.env, actor?.id ?? null, actor?.name ?? null, 'delete', 'role', id)
  c.executionCtx.waitUntil(broadcast(c.env, 'roles', { action: 'delete', id }))
  return c.json({ success: true })
})

export default app
