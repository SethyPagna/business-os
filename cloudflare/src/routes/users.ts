import { Hono, type Context } from 'hono'
import { enqueueImageNormalization } from '../lib/imageAudit'
import { currentPasswordHashPrefix, describePasswordHash, hashPassword, isCurrentPasswordHash, passwordPepperStatus, PASSWORD_HASH_ALGORITHM, PASSWORD_HASH_ITERATIONS } from '../lib/passwordHash'
import { getDb } from '../lib/db'
import { buildUserRenameStatements } from '../lib/userIdentity'
import { requireAuth, revokeUserSessions, type SessionUser } from '../lib/auth'
import { audit, changedFields, auditChangeColumns } from '../lib/audit'
import { isAdminControlUser } from '../lib/permissions'
import { isAdminControlGuardAbort, lastAdminRequiredBody, planAdminControlWrite } from '../lib/adminControlGuard'
import { assertUpdatedAtMatch, getExpectedUpdatedAt, writeConflictResponse, WriteConflictError } from '../lib/conflictControl'
import { broadcast } from '../durable-objects/broadcastHub'
import { bumpVersion } from '../lib/cache'
import { getMediaType, buildUniqueStoredName, sanitizeOriginalFileName } from '../lib/fileAssets'
import { isPublicImageFormat, UNSUPPORTED_IMAGE_MESSAGE, validateUploadedBuffer, type DetectedUploadFormat } from '../lib/uploadSecurity'
import { checkRateLimit, getClientIp } from '../lib/rateLimit'
import { CURRENT_PASSWORD_RATE_LIMITED_ERROR, verifyCurrentPassword } from '../lib/currentPasswordGuard'
import { newPasswordProblem, newPasswordProblemError, passwordKnownLeaked, setPasswordMustChange, KNOWN_LEAKED_PASSWORD_CODE, KNOWN_LEAKED_PASSWORD_ERROR } from '../lib/passwordPolicy'
import { isGoogleLinkReady } from '../lib/googleOauth'
import type { Env } from '../index'
import { actorSnapshot } from '../lib/actorSnapshot'

// Ported from backend/src/routes/users.ts. Replaces the previous generic
// CRUD stub in compat.ts (plain insertTableRow/updateTableRow with no
// permission checks at all beyond "logged in", no admin-vs-admin
// management guardrails, no primary-admin guardrails, no duplicate-identity checks,
// and no forced re-login after a password change).
//
// What's intentionally NOT ported, and why:
// - Google/Supabase-linked identity sync (createOrUpdateAuthUser,
//   repairGoogleIdentityForUser, provider-disconnect, auth-methods
//   provider probing). The Docker backend's own isGoogleAuthConfigured()
//   always returns false in this build -- every one of those code paths is
//   already dead in the source we're porting from. (Superseded: the Worker
//   has its own Google OAuth link flow in routes/auth.ts, and auth-methods
//   below now reports it -- see the comment there.)
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

// Re-entering a current password (change password, profile save; Google
// unlink in routes/auth.ts) goes through lib/currentPasswordGuard.ts: an
// atomic reserve-then-release allowance that counts wrong passwords only,
// keyed per session (own account) or per actor+target (an admin on someone
// else), so nobody else can lock a user out of their own password change.
// A wrong password answers 400, never 401 -- the client reads a 401 on an
// authenticated /api path as a possibly dead session and signs out.
async function refuseWrongCurrentPassword(c: Ctx, userId: number | string, currentPassword: string, passwordHash: string): Promise<Response | null> {
  const actor = c.get('user')
  const verdict = await verifyCurrentPassword(c, { actorId: actor?.id ?? userId, targetId: userId }, currentPassword, passwordHash)
  if (verdict.ok) return null
  if (verdict.rateLimited) {
    return c.json({
      success: false,
      error: CURRENT_PASSWORD_RATE_LIMITED_ERROR,
      code: 'current_password_rate_limited',
      retryAfterSeconds: verdict.retryAfterSeconds,
    }, 429)
  }
  return c.json({ success: false, error: 'Current password is incorrect', code: 'incorrect_password' }, 400)
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

// The name "admin" is reserved (FX-sec, 27 Sep 2026). It used to be an
// administrator credential by itself (lib/permissions.ts); that is gone, but
// the name still reads as the seeded root account everywhere (is_primary_admin,
// the seed/reseed lookup in lib/coreDataInvariants.ts), so nobody may take it.
// The row that already holds it keeps it. Every username writer -- create,
// admin edit, self-service profile -- runs through here.
function refuseReservedUsername(c: Ctx, username: string, currentUsername: string | null): Response | null {
  if (normalizeLookup(username) !== 'admin') return null
  if (currentUsername != null && normalizeLookup(currentUsername) === 'admin') return null
  return c.json({ success: false, error: 'The username "admin" is reserved.', code: 'username_reserved' }, 400)
}

// users.avatar_path is rendered as <img src> on every avatar surface, so a
// new value must name a stored IMAGE in the file library -- the same rule as
// PUT /users/:id/avatar below. Applied to every form writer (create, admin
// edit, profile save), which used to store any string they were sent.
// `undefined` = the key was absent: keep the current value. The value the
// account already has is accepted unchanged, so the forms (which always send
// the current value back) never block an unrelated edit on an older path.
type AvatarDecision = { ok: true; value: string | null } | { ok: false; response: Response }
async function resolveAvatarWrite(c: Ctx, raw: unknown, currentPath: string | null): Promise<AvatarDecision> {
  const current = String(currentPath || '').trim() || null
  if (raw === undefined) return { ok: true, value: current }
  const next = String(raw ?? '').trim()
  if (!next) return { ok: true, value: null }
  if (next === current) return { ok: true, value: current }
  const asset = await getDb(c.env).prepare(
    "SELECT id FROM file_assets WHERE public_path = @path AND media_type = 'image' LIMIT 1",
  ).get<{ id: number }>({ path: next })
  if (asset) return { ok: true, value: next }
  return { ok: false, response: c.json({ success: false, error: 'That image is not in the file library.', code: 'avatar_not_in_library' }, 400) }
}

function canManageTarget(actor: SessionUser, target: SecurityContextRow | undefined): boolean {
  if (!actor || !target) return false
  if (Number(actor.id) === Number(target.id)) return true
  if (!isAdminControlUser(actor)) return false
  // Admins are allowed to manage other admin accounts (role/status/profile
  // fields/password reset). The seeded primary-admin account remains the one
  // protected peer-admin target so a secondary admin cannot lock out the
  // recovery/root account. Self-service for that account still works above.
  // Per explicit user decision (Sep 1 2026): admins may manage other admin
  // accounts including the seeded primary-admin account -- no account is
  // protected from peer-admin management. isPrimaryAdmin() is still used
  // for informational display (is_primary_admin) only, never as a gate.
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
  // Same rule as lib/permissions.ts's isAdminControlUser: never the name.
  const hasAdmin = !!(merged.all === true || normalizeLookup(row.role_code) === 'admin')
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

// Order-independent text of a permission map. Unlike the audit diff's
// canonical form it keeps `true` and `1` apart: a strict permission check
// treats them differently.
function sortedJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(sortedJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${sortedJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
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

// Sign-in methods for My Profile. This used to be a hard-coded stub that
// always answered "Google not connected, not ready" (and named the flag
// google_connected while the profile reads google_linked), so the Connect /
// Disconnect Google buttons could never appear even though the real link
// flow exists in routes/auth.ts (POST /auth/oauth/start mode:'link' -> signed
// single-use state carrying the signed-in user id -> GET /auth/oauth/callback
// records google_subject on that user, refusing a Google identity already
// linked to another user -> POST /auth/oauth/unlink behind the current
// password). This now reports the stored link and whether this deployment
// has everything the round trip needs.
app.get('/users/:id/auth-methods', async (c) => {
  const actor = c.get('user')
  const targetId = Number(c.req.param('id') || 0)
  const targetSecurity = await getUserSecurityContext(c, targetId)
  if (!targetSecurity) return c.json({ success: false, error: 'User not found' }, 404)
  if (!canManageTarget(actor, targetSecurity)) return c.json({ success: false, error: 'No permission' }, 403)
  const user = await getDb(c.env).prepare(
    'SELECT email, email_verified, otp_enabled, is_active, google_subject, google_email, google_linked_at FROM users WHERE id = @id',
  ).get<{
    email: string | null; email_verified: number; otp_enabled: number; is_active: number
    google_subject: string | null; google_email: string | null; google_linked_at: string | null
  }>({ id: targetId })
  if (!user) return c.json({ success: false, error: 'User not found' }, 404)
  const googleLinked = !!String(user.google_subject || '').trim()
  const googleReady = isGoogleLinkReady(c.env)
  return c.json({
    success: true,
    local_password: true,
    email: user.email || '',
    email_verified: Number(user.email_verified || 0) === 1,
    otp_enabled: Number(user.otp_enabled || 0) === 1,
    is_active: Number(user.is_active || 0) === 1,
    google_linked: googleLinked,
    // Legacy name for the same fact; kept so an older cached client still reads it.
    google_connected: googleLinked,
    google_email: googleLinked ? (user.google_email || '') : '',
    google_linked_at: googleLinked ? (user.google_linked_at || null) : null,
    google_ready: googleReady,
    linked_providers: googleLinked ? ['google'] : [],
    capabilities: { google_auth: googleReady, google_oauth: googleReady, google_email_auth: false, google_mfa_totp: false },
  })
})

// Google is disconnected through POST /api/auth/oauth/unlink (password
// re-check, own account only); there is no other provider to disconnect.
app.post('/users/:id/provider-disconnect', (c) => c.json({ success: false, error: 'Use Disconnect Google in My Profile. No other sign-in provider is supported.' }, 400))

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
  const claimedMimeType = file.type || 'image/jpeg'
  const mediaType = getMediaType(claimedMimeType, originalName)
  if (mediaType !== 'image') return c.json({ error: 'Avatar must be an image file' }, 400)

  // S-uploads (compliance audit P1-2): avatars land under the public
  // uploads/ prefix, so the stored content-type and extension are the ones
  // detected from the bytes (JPEG/PNG/WebP/GIF/AVIF only), never the
  // client's File.type or file-name suffix.
  const buffer = new Uint8Array(await file.arrayBuffer())
  let detected: DetectedUploadFormat
  try {
    detected = validateUploadedBuffer(buffer, claimedMimeType, originalName)
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
  if (!isPublicImageFormat(detected)) return c.json({ error: UNSUPPORTED_IMAGE_MESSAGE }, 400)
  const mimeType = detected.mime
  if (buffer.byteLength > MAX_AVATAR_UPLOAD_BYTES) {
    return c.json({ error: 'Avatar image is too large to save (over 1MB after your browser attempted to compress it). Please try again, or pick a smaller image.' }, 400)
  }

  const storedName = buildUniqueStoredName(originalName, detected.extension)
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
    created_by_name: actorSnapshot(user),
  })

  const asset = await db.prepare('SELECT * FROM file_assets WHERE id = ?').get([insert.lastInsertRowid])
  c.executionCtx.waitUntil(broadcast(c.env, 'files', { action: 'upload', id: insert.lastInsertRowid }))
  return c.json({ path: publicPath, asset })
})

// -- Profile photo set / remove --------------------------------------------
//
// POST /users/avatar-upload above only STORES the image; nothing wrote it to
// users.avatar_path except a full "Save profile", which asks a non-admin for
// their current password. My Profile announced "Avatar uploaded" after the
// store alone, so the photo silently vanished on the next load unless the
// person also saved the whole form. These two routes make the photo its own
// action: the account owner (or an admin who can manage them) sets or
// removes it directly -- the same trust level as uploading it.
//
// Neither route ever deletes the photo it moves off (U-profile3, 27 Sep
// 2026). Both used to delete the old R2 object and its file_assets row when
// their own reference count found no other user; that count missed a
// promotion, setting, product or other avatar pointing at the same file as
// `uploads/NAME`, `/uploads/NAME?v=3` or an absolute URL, and deleted a photo
// still on show. Owner rule: nothing may be lost. The old photo stays in the
// Library, where an admin can delete it under the Library's in-use check
// (lib/uploadReferences.ts, the one reference rule).

function auditAvatarChange(c: Ctx, targetId: number, before: string | null, after: string | null) {
  const actor = c.get('user')
  return audit(c.env, actor?.id ?? null, actor?.name ?? null, 'update', 'user', targetId, { mode: 'avatar' }, changedFields(
    { avatar_path: before },
    { avatar_path: after },
  ))
}

// PUT /users/:id/avatar { avatar_path } -- the path must name a stored IMAGE
// in the file library (a fresh avatar upload or a picked library image).
app.put('/users/:id/avatar', async (c) => {
  const actor = c.get('user')
  const targetId = Number(c.req.param('id') || 0)
  if (!targetId) return c.json({ success: false, error: 'Invalid user id' }, 400)
  const targetSecurity = await getUserSecurityContext(c, targetId)
  if (!targetSecurity) return c.json({ success: false, error: 'User not found' }, 404)
  if (!canManageTarget(actor, targetSecurity)) return c.json({ success: false, error: 'No permission' }, 403)
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const avatarPath = String(body.avatar_path || '').trim()
  if (!avatarPath) return c.json({ success: false, error: 'Choose an image first' }, 400)
  const db = getDb(c.env)
  const asset = await db.prepare(
    "SELECT id FROM file_assets WHERE public_path = @path AND media_type = 'image' LIMIT 1",
  ).get<{ id: number }>({ path: avatarPath })
  if (!asset) return c.json({ success: false, error: 'That image is not in the file library.' }, 400)
  const current = await db.prepare('SELECT avatar_path FROM users WHERE id = @id AND deleted_at IS NULL').get<{ avatar_path: string | null }>({ id: targetId })
  if (!current) return c.json({ success: false, error: 'User not found' }, 404)
  const previousPath = String(current.avatar_path || '').trim()
  // Re-setting the photo the account already has changes nothing: no write,
  // no audit row.
  if (previousPath === avatarPath) {
    return c.json({ success: true, changed: false, ...sanitizeUserRow(await getUserWithRole(c, targetId)) })
  }
  await db.prepare('UPDATE users SET avatar_path = @path, updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({ path: avatarPath, id: targetId })
  // The audit row carries the old path, so the replaced photo -- which stays
  // in the Library -- can always be found and put back.
  await auditAvatarChange(c, targetId, previousPath || null, avatarPath)
  c.executionCtx.waitUntil(broadcast(c.env, 'users', { action: 'update', id: targetId }))
  return c.json({ success: true, changed: true, ...sanitizeUserRow(await getUserWithRole(c, targetId)) })
})

// DELETE /users/:id/avatar -- clears this account's pointer only. The photo
// itself stays in the Library (see the note above PUT).
app.delete('/users/:id/avatar', async (c) => {
  const actor = c.get('user')
  const targetId = Number(c.req.param('id') || 0)
  if (!targetId) return c.json({ success: false, error: 'Invalid user id' }, 400)
  const targetSecurity = await getUserSecurityContext(c, targetId)
  if (!targetSecurity) return c.json({ success: false, error: 'User not found' }, 404)
  if (!canManageTarget(actor, targetSecurity)) return c.json({ success: false, error: 'No permission' }, 403)
  const db = getDb(c.env)
  const current = await db.prepare('SELECT avatar_path FROM users WHERE id = @id AND deleted_at IS NULL').get<{ avatar_path: string | null }>({ id: targetId })
  if (!current) return c.json({ success: false, error: 'User not found' }, 404)
  const previousPath = String(current.avatar_path || '').trim()
  if (!previousPath) return c.json({ success: true, removed: false, ...sanitizeUserRow(await getUserWithRole(c, targetId)) })

  await db.prepare('UPDATE users SET avatar_path = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({ id: targetId })
  await auditAvatarChange(c, targetId, previousPath, null)
  c.executionCtx.waitUntil(broadcast(c.env, 'users', { action: 'update', id: targetId }))
  return c.json({ success: true, removed: true, ...sanitizeUserRow(await getUserWithRole(c, targetId)) })
})

// -- User CRUD (admin control) --------------------------------------------

app.post('/users', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  const name = String(body.name || username).trim()
  const email = String(body.email || '').trim().toLowerCase() || null
  if (!username || !password) return c.json({ success: false, error: 'Username and password required' }, 400)
  const passwordProblem = newPasswordProblem(password)
  if (passwordProblem) return c.json({ success: false, error: newPasswordProblemError(passwordProblem), code: passwordProblem }, 400)
  if (await passwordKnownLeaked(password, c.env)) return c.json({ success: false, error: KNOWN_LEAKED_PASSWORD_ERROR, code: KNOWN_LEAKED_PASSWORD_CODE }, 400)
  if (!isValidEmail(email)) return c.json({ success: false, error: 'Valid email required' }, 400)
  const roleId = Number(body.role_id)
  if (!Number.isInteger(roleId) || roleId <= 0) {
    return c.json({ success: false, error: 'A role is required when creating a user' }, 400)
  }

  const reserved = refuseReservedUsername(c, username, null)
  if (reserved) return reserved
  const phone = String(body.phone || '').trim() || null
  const phoneLookup = phone ? normalizePhoneLookup(phone) : null
  const conflict = await findUserIdentityConflict(c, { username, name, email, phoneLookup })
  if (conflict) return c.json({ success: false, error: conflict.message }, 409)
  const avatar = await resolveAvatarWrite(c, body.avatar_path, null)
  if (!avatar.ok) return avatar.response

  try {
    const { orgId, groupId } = await resolveDefaultOrg(c, actor)
    const hash = await hashPassword(password, c.env)
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
      email, avatar: avatar.value, password: hash,
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
    'SELECT id, username, name, permissions, phone, email, avatar_path, role_id, deleted_at, is_active, updated_at FROM users WHERE id = @id',
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
  const reserved = refuseReservedUsername(c, username, String(existing.username ?? ''))
  if (reserved) return reserved

  const name = String(body.name || username).trim()
  const phone = String(body.phone || '').trim() || null
  const phoneLookup = phone ? normalizePhoneLookup(phone) : null
  const conflict = await findUserIdentityConflict(c, { username, name, email, phoneLookup }, id)
  if (conflict) return c.json({ success: false, error: conflict.message }, 409)
  const avatar = await resolveAvatarWrite(c, body.avatar_path, (existing.avatar_path as string | null) ?? null)
  if (!avatar.ok) return avatar.response

  const markDeleted = !!body.delete_user
  const nextIsActive = markDeleted ? 0 : (body.is_active ?? Number(existing.is_active || 0))
  const nextPermissions = body.permissions === undefined ? parseJsonSafe(existing.permissions) : body.permissions
  // Never leave zero active administrators (FX-sec2, lib/adminControlGuard.ts).
  const adminGuard = await planAdminControlWrite(db, { user: { id, roleId: body.role_id || null, permissions: JSON.stringify(nextPermissions), active: Number(nextIsActive) === 1 } })
  if ('refusal' in adminGuard) return c.json(adminGuard.refusal, 409)

  try {
    const updateUserStatement = {
      sql: `
      UPDATE users SET username = @username, name = @name, phone = @phone, phone_lookup = @phone_lookup,
        phone_verified = 0, email = @email, email_verified = CASE WHEN @email IS NULL THEN 0 ELSE email_verified END,
        avatar_path = @avatar, permissions = @permissions, role_id = @role_id, is_active = @is_active,
        deleted_at = @deleted_at, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `,
      params: {
      username, name, phone, phone_lookup: phoneLookup, email,
      avatar: avatar.value,
      permissions: JSON.stringify(nextPermissions), role_id: body.role_id || null,
      is_active: nextIsActive, deleted_at: markDeleted ? new Date().toISOString() : null, id,
      },
    }
    // The account id is the source of truth: when the username changes, propagate
    // it to every denormalized snapshot (cashier_name, movement user_name, etc.)
    // so the whole system reflects the new name rather than keeping stale copies.
    const usernameChanged = String(existing.username ?? '').trim() !== username
    const renameScope = String(body.__rename_cascade || '').trim().toLowerCase()
    if (usernameChanged && renameScope !== 'carry' && renameScope !== 'record_only') {
      return c.json({ success: false, error: 'Choose whether to update linked live records or rename only this user.', code: 'rename_choice_required' }, 409)
    }
    await db.batch([
      updateUserStatement,
      adminGuard.guard,
      ...(usernameChanged && renameScope === 'carry' ? buildUserRenameStatements(Number(id), username) : []),
    ])
    // Deactivation must kill the currently-issued sessions as well. Otherwise
    // an old cookie becomes valid again if the account is re-enabled before
    // that session expires, which defeats the meaning of an admin disable.
    if (Number(nextIsActive) === 0) {
      // Revoke ALL (no keep): a disabled account keeps no session, even if
      // an admin somehow deactivates themself.
      await revokeUserSessions(c.env, Number(id))
    }
    // An account edit changes who can do what; recording only "user #4 was
    // updated" makes the Audit Log unable to answer the one question it is
    // there for. Record the account fields that actually moved -- never the
    // password hash, session tokens or an avatar blob (changedFields drops
    // those key shapes outright).
    await audit(c.env, actor?.id ?? null, actor?.name ?? null, 'update', 'user', id, null, changedFields(
      {
        username: existing.username,
        name: existing.name,
        phone: existing.phone,
        email: existing.email,
        role_id: existing.role_id,
        is_active: Number(existing.is_active || 0),
        deleted: existing.deleted_at ? 1 : 0,
        permissions: parseJsonSafe(existing.permissions),
      },
      {
        username,
        name,
        phone,
        email,
        role_id: body.role_id || null,
        is_active: Number(nextIsActive || 0),
        deleted: markDeleted ? 1 : 0,
        permissions: nextPermissions,
      },
    ))
    if (usernameChanged && renameScope === 'carry') {
      await Promise.all([bumpVersion(c.env, 'sales'), bumpVersion(c.env, 'returns')])
    }
    c.executionCtx.waitUntil(broadcast(c.env, 'users', { action: 'update', id }))
    return c.json({ success: true, ...sanitizeUserRow(await getUserWithRole(c, id)) })
  } catch (error) {
    if (isAdminControlGuardAbort(error)) return c.json(lastAdminRequiredBody(), 409)
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
    'SELECT id, username, name, password, phone, email, avatar_path, phone_verified, email_verified, deleted_at, is_active, updated_at FROM users WHERE id = @id AND deleted_at IS NULL',
  ).get<Record<string, unknown>>({ id: targetId })
  if (!user) return c.json({ success: false, error: 'User not found' }, 404)
  try {
    assertUpdatedAtMatch('user', user, getExpectedUpdatedAt(body))
  } catch (error) {
    const result = conflictResult(error)
    if (result) return c.json(result.body, result.status)
    throw error
  }
  if (!adminOverride) {
    const currentPassword = String(body.currentPassword || '')
    if (!currentPassword) return c.json({ success: false, error: 'Current password required' }, 400)
    // Rate limited, 400 not 401 -- see refuseWrongCurrentPassword.
    const refused = await refuseWrongCurrentPassword(c, targetId, currentPassword, String(user.password || ''))
    if (refused) return refused
  }

  const reserved = refuseReservedUsername(c, username, String(user.username ?? ''))
  if (reserved) return reserved

  const name = String(body.name || username).trim()
  const phone = String(body.phone || '').trim() || null
  const phoneLookup = phone ? normalizePhoneLookup(phone) : null
  const conflict = await findUserIdentityConflict(c, { username, name, email, phoneLookup }, targetId)
  if (conflict) return c.json({ success: false, error: conflict.message }, 409)
  const avatar = await resolveAvatarWrite(c, body.avatar_path, (user.avatar_path as string | null) ?? null)
  if (!avatar.ok) return avatar.response

  try {
    const updateProfileStatement = {
      sql: `
      UPDATE users SET username = @username, name = @name, phone = @phone, phone_lookup = @phone_lookup,
        phone_verified = 0, email = @email, email_verified = CASE WHEN @email IS NULL THEN 0 ELSE email_verified END,
        avatar_path = @avatar, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `,
      params: { username, name, phone, phone_lookup: phoneLookup, email, avatar: avatar.value, id: targetId },
    }
    // Propagate a username change to every denormalized snapshot (see the admin
    // PUT above) -- same id-is-source-of-truth rule on the self-service path.
    const usernameChanged = String(user.username ?? '').trim() !== username
    const renameScope = String(body.__rename_cascade || '').trim().toLowerCase()
    if (usernameChanged && renameScope !== 'carry' && renameScope !== 'record_only') {
      return c.json({ success: false, error: 'Choose whether to update linked live records or rename only this user.', code: 'rename_choice_required' }, 409)
    }
    await db.batch([
      updateProfileStatement,
      ...(usernameChanged && renameScope === 'carry' ? buildUserRenameStatements(Number(targetId), username) : []),
    ])
    // Every column this UPDATE writes is diffed, not just the four identity
    // fields: an avatar change alone used to produce a row that said nothing
    // changed. phone_lookup is left out as a derived restatement of phone;
    // the two *_verified flags are in because the statement resets them.
    const nextAvatarPath = updateProfileStatement.params.avatar
    await audit(c.env, actor?.id ?? null, actor?.name ?? null, 'update', 'user', targetId, { mode: 'profile' }, changedFields(
      {
        username: user.username,
        name: user.name,
        phone: user.phone,
        email: user.email,
        avatar_path: user.avatar_path,
        phone_verified: Number(user.phone_verified || 0),
        email_verified: Number(user.email_verified || 0),
      },
      {
        username,
        name,
        phone,
        email,
        avatar_path: nextAvatarPath,
        phone_verified: 0,
        email_verified: email === null ? 0 : Number(user.email_verified || 0),
      },
    ))
    if (usernameChanged && renameScope === 'carry') {
      await Promise.all([bumpVersion(c.env, 'sales'), bumpVersion(c.env, 'returns')])
    }
    c.executionCtx.waitUntil(broadcast(c.env, 'users', { action: 'update', id: targetId }))
    return c.json({ success: true, ...sanitizeUserRow(await getUserWithRole(c, targetId)) })
  } catch (error) {
    const message = String((error as Error)?.message || '')
    return c.json({ success: false, error: mapIdentityErrorMessage(message) || message || 'Failed to update profile' }, 500)
  }
})

async function handlePasswordChange(c: Ctx, options: { requireCurrent: boolean; requireAdminControl: boolean; requireSelf: boolean; allowInactive: boolean }) {
  const actor = c.get('user')
  const targetId = c.req.param('id') || ''
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const newPassword = String(body.newPassword || body.new_password || '')
  if (!newPassword) return c.json({ success: false, error: 'New password required' }, 400)
  const passwordProblem = newPasswordProblem(newPassword)
  if (passwordProblem) return c.json({ success: false, error: newPasswordProblemError(passwordProblem), code: passwordProblem }, 400)
  if (await passwordKnownLeaked(newPassword, c.env)) return c.json({ success: false, error: KNOWN_LEAKED_PASSWORD_ERROR, code: KNOWN_LEAKED_PASSWORD_CODE }, 400)

  if (options.requireAdminControl && !isAdminControlUser(actor)) {
    return c.json({ success: false, error: 'No permission' }, 403)
  }
  if (options.requireSelf && Number(actor?.id || 0) !== Number(targetId || 0)) {
    return c.json({ success: false, error: 'Use the administrator password-reset action for another account' }, 403)
  }
  const targetSecurity = await getUserSecurityContext(c, targetId)
  if (!targetSecurity) return c.json({ success: false, error: 'User not found' }, 404)
  if (!canManageTarget(actor, targetSecurity)) return c.json({ success: false, error: 'Cannot manage another admin account' }, 403)

  const db = getDb(c.env)
  const user = await db.prepare('SELECT id, password, is_active, deleted_at FROM users WHERE id = @id').get<{
    id: number; password: string; is_active: number; deleted_at: string | null
  }>({ id: targetId })
  if (!user) return c.json({ success: false, error: 'User not found' }, 404)
  if (user.deleted_at) return c.json({ success: false, error: 'User account is deleted' }, 400)
  if (!options.allowInactive && !user.is_active) return c.json({ success: false, error: 'User account is inactive' }, 400)

  const adminReset = options.requireAdminControl
  if (options.requireCurrent) {
    const currentPassword = String(body.currentPassword || '')
    if (!currentPassword) return c.json({ success: false, error: 'Current password required' }, 400)
    // Rate limited, 400 not 401 -- see refuseWrongCurrentPassword.
    const refused = await refuseWrongCurrentPassword(c, user.id, currentPassword, String(user.password || ''))
    if (refused) return refused
  }

  const hash = await hashPassword(newPassword, c.env)
  await db.prepare('UPDATE users SET password = @password, updated_at = CURRENT_TIMESTAMP WHERE id = @id').run({ password: hash, id: targetId })
  // A new password that is not publicly known ends a forced change.
  await setPasswordMustChange(db, targetId, false)
  // An administrator's reset answers any pending "ask an administrator"
  // recovery request for this account (S-auth4c, migration 0203).
  if (adminReset) await resolvePasswordResetRequests(db, targetId, Number(actor?.id || 0) || null, 'resolved')
  // Changing YOUR OWN password keeps the session that made the change and
  // signs out every other device. Resetting SOMEONE ELSE's password signs out
  // all of theirs -- the actor's own sessions are a different user_id and are
  // never touched either way.
  const changingOwnPassword = Number(actor?.id || 0) === Number(targetId || 0)
  await revokeUserSessions(c.env, targetId, { keepCurrentSessionOf: changingOwnPassword ? c : null })
  await audit(c.env, actor?.id ?? null, actor?.name ?? null, 'reset_password', 'user', targetId, {
    mode: adminReset ? 'admin' : 'self_service',
  })
  return c.json({ success: true })
}

app.post('/users/:id/change-password', (c) => handlePasswordChange(c, { requireCurrent: true, requireAdminControl: false, requireSelf: true, allowInactive: false }))
app.post('/users/:id/reset-password', (c) => handlePasswordChange(c, { requireCurrent: false, requireAdminControl: true, requireSelf: false, allowInactive: true }))

// -- Password reset by administrator approval (S-auth4c) ----------------------
//
// Requests are recorded by the public POST /api/auth/password-reset/admin-request
// (routes/auth.ts). Administrators see the pending ones here and answer each
// with the existing reset-password action above (which resolves it) or
// dismiss it. Before migration 0203 there is no table: the list is empty and
// nothing fails.
async function resolvePasswordResetRequests(db: ReturnType<typeof getDb>, userId: number | string, actorId: number | null, status: 'resolved' | 'dismissed', requestId?: number): Promise<number> {
  try {
    const result = await db.prepare(`
      UPDATE password_reset_requests
      SET status = @status, resolved_by = @actor_id, resolved_at = CURRENT_TIMESTAMP
      WHERE user_id = @user_id AND status = 'pending'
        AND (@request_id IS NULL OR id = @request_id)
    `).run({ status, actor_id: actorId, user_id: Number(userId), request_id: requestId ?? null })
    return Number((result as { changes?: number; meta?: { changes?: number } })?.changes ?? (result as { meta?: { changes?: number } })?.meta?.changes ?? 0)
  } catch (error) {
    if (/no such table/i.test(String((error as Error)?.message || error))) return 0
    throw error
  }
}

app.get('/users/password-reset-requests', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  try {
    const rows = await getDb(c.env).prepare(`
      SELECT q.id, q.user_id, q.requested_at, q.device_name, u.username, u.name
      FROM password_reset_requests q
      JOIN users u ON u.id = q.user_id
      WHERE q.status = 'pending' AND u.deleted_at IS NULL
      ORDER BY q.requested_at DESC, q.id DESC
      LIMIT 50
    `).all<{ id: number; user_id: number; requested_at: string; device_name: string | null; username: string; name: string | null }>()
    return c.json({ success: true, requests: rows })
  } catch (error) {
    if (/no such table/i.test(String((error as Error)?.message || error))) return c.json({ success: true, requests: [] })
    throw error
  }
})

app.post('/users/password-reset-requests/:requestId/dismiss', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  const requestId = Number(c.req.param('requestId'))
  if (!Number.isSafeInteger(requestId) || requestId <= 0) return c.json({ success: false, error: 'Request not found' }, 404)
  const db = getDb(c.env)
  let request: { user_id: number } | undefined
  try {
    request = await db.prepare("SELECT user_id FROM password_reset_requests WHERE id = @id AND status = 'pending'").get<{ user_id: number }>({ id: requestId })
  } catch (error) {
    if (!/no such table/i.test(String((error as Error)?.message || error))) throw error
  }
  if (!request) return c.json({ success: false, error: 'Request not found' }, 404)
  const changed = await resolvePasswordResetRequests(db, request.user_id, Number(actor?.id || 0) || null, 'dismissed', requestId)
  if (!changed) return c.json({ success: false, error: 'Request not found' }, 404)
  await audit(c.env, actor?.id ?? null, actor?.name ?? null, 'password_reset_admin_request_dismissed', 'user', request.user_id, { requestId })
  return c.json({ success: true })
})

// E6 (5 Oct 2026): the Workers Free readiness check for password hashes.
// Before the plan move every ACTIVE staff account should hold a current
// PBKDF2 hash: a legacy bcrypt check costs far more CPU than Free allows, and
// a staff sign-in rewrites the hash the first time it succeeds. The scheme is
// read from each stored hash's own prefix (no version column). With the
// PASSWORD_PEPPER secret set, "current" also means peppered with the current
// pepper version, and pepperConfigured says whether it is set (never its
// value). Administrators only; answers counts and the names of staff still
// to sign in -- never a hash, never a customer.
app.get('/users/password-hash-status', async (c) => {
  const actor = c.get('user')
  if (!isAdminControlUser(actor)) return c.json({ success: false, error: 'No permission' }, 403)
  const db = getDb(c.env)
  const rows = await db.prepare('SELECT id, username, name, is_active, password FROM users WHERE deleted_at IS NULL ORDER BY id')
    .all<{ id: number; username: string; name: string | null; is_active: number; password: string | null }>()
  const pepper = passwordPepperStatus(c.env)
  const staff = { total: 0, current: 0, legacyBcrypt: 0, otherPbkdf2: 0, unknown: 0, activeLegacyBcrypt: 0, unpeppered: 0 }
  const pending: Array<{ id: number; username: string; name: string | null; isActive: boolean; scheme: string }> = []
  for (const row of rows) {
    staff.total += 1
    const hash = describePasswordHash(row.password)
    if (hash.scheme === 'pbkdf2-sha256' && hash.pepperVersion === 0) staff.unpeppered += 1
    if (isCurrentPasswordHash(row.password, c.env)) { staff.current += 1; continue }
    const scheme = hash.scheme
    if (scheme === 'bcrypt') {
      staff.legacyBcrypt += 1
      if (row.is_active) staff.activeLegacyBcrypt += 1
    } else if (scheme === 'pbkdf2-sha256') staff.otherPbkdf2 += 1
    else staff.unknown += 1
    pending.push({ id: row.id, username: row.username, name: row.name, isActive: Boolean(row.is_active), scheme })
  }
  // Storefront accounts: counts only, one aggregate row. Null before the
  // portal_accounts migration has run.
  // The unpeppered current prefix is also the start of a peppered hash at the
  // same count, so "current" excludes '$p=' when no pepper is configured.
  let portal: { total: number; current: number; legacy_bcrypt: number; unpeppered: number } | null = null
  try {
    portal = await db.prepare(`
      SELECT COUNT(*) AS total,
             COALESCE(SUM(CASE WHEN substr(password_hash, 1, length(@currentPrefix)) = @currentPrefix
                                AND (@peppered = 1 OR instr(password_hash, '$p=') = 0) THEN 1 ELSE 0 END), 0) AS current,
             COALESCE(SUM(CASE WHEN substr(password_hash, 1, 4) IN ('$2a$', '$2b$', '$2y$') THEN 1 ELSE 0 END), 0) AS legacy_bcrypt,
             COALESCE(SUM(CASE WHEN substr(password_hash, 1, 15) = '$pbkdf2-sha256$' AND instr(password_hash, '$p=') = 0 THEN 1 ELSE 0 END), 0) AS unpeppered
      FROM portal_accounts
    `).get<{ total: number; current: number; legacy_bcrypt: number; unpeppered: number }>({ currentPrefix: currentPasswordHashPrefix(c.env), peppered: pepper.configured ? 1 : 0 }) ?? null
  } catch (error) {
    if (!/no such table/i.test(String((error as Error)?.message || error))) throw error
  }
  return c.json({
    success: true,
    target: { algorithm: PASSWORD_HASH_ALGORITHM, iterations: PASSWORD_HASH_ITERATIONS, pepperVersion: pepper.version },
    pepperConfigured: pepper.configured,
    staff: { ...staff, readyForFree: staff.activeLegacyBcrypt === 0, pending },
    portal: portal
      ? { total: Number(portal.total || 0), current: Number(portal.current || 0), legacyBcrypt: Number(portal.legacy_bcrypt || 0), unpeppered: Number(portal.unpeppered || 0) }
      : null,
  })
})

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
  const existingRole = await db.prepare('SELECT id, name, code, is_system, permissions, created_at, updated_at FROM roles WHERE id = @id').get<{
    id: number; name: string; code: string | null; is_system: number; permissions: string | null; created_at: string | null; updated_at: string | null
  }>({ id })
  if (!existingRole) return c.json({ success: false, error: 'Role not found' }, 404)
  const expectedUpdatedAt = getExpectedUpdatedAt(body)
  try {
    assertUpdatedAtMatch('role', existingRole, expectedUpdatedAt)
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
    const permissions = JSON.stringify(body.permissions || {})
    // Nothing to save: the same name and the same grants (key order is not a
    // difference; `true` and `1` ARE, since permission checks are strict).
    // Writing anyway moved updated_at -- so another admin's open editor then
    // reported a conflict -- added an audit row with an empty diff, and the
    // `roles` broadcast makes every other tab refetch its session and
    // permissions.
    if (name === existingRole.name && sortedJson(parseJsonSafe(existingRole.permissions)) === sortedJson(parseJsonSafe(permissions))) {
      return c.json({ success: true, unchanged: true, ...existingRole })
    }
    // A custom role with `all` makes its holders administrators (FX-sec2).
    const adminGuard = await planAdminControlWrite(db, { role: { id, permissions } })
    if ('refusal' in adminGuard) return c.json(adminGuard.refusal, 409)
    const updatedAt = new Date().toISOString()
    const details = JSON.stringify({ name })
    // A role IS its permission set, so the row has to carry the permissions
    // that moved, not just the role's name. Built here (not after the batch)
    // so the before/after is committed atomically with the UPDATE it describes.
    const roleChangeColumns = auditChangeColumns(changedFields(
      { name: existingRole.name, permissions: parseJsonSafe(existingRole.permissions) },
      { name, permissions: parseJsonSafe(permissions) },
    ))
    const results = await db.batch([{
      sql: `UPDATE roles
            SET name = @name, permissions = @permissions, updated_at = @updated_at
            WHERE id = @id
              AND updated_at IS @observed_updated_at
              AND name IS @observed_name
              AND code IS @observed_code
              AND is_system IS @observed_is_system
              AND permissions IS @observed_permissions`,
      params: {
        id, name, permissions, updated_at: updatedAt,
        observed_updated_at: existingRole.updated_at,
        observed_name: existingRole.name,
        observed_code: existingRole.code,
        observed_is_system: existingRole.is_system,
        observed_permissions: existingRole.permissions,
      },
    }, {
      // changes() is the preceding guarded UPDATE's affected-row count. A
      // lost race therefore cannot create an audit row, while an audit
      // failure aborts this D1 batch and rolls the role update back.
      sql: `INSERT INTO audit_logs (
              user_id, user_name, action, entity, entity_id, details,
              table_name, record_id, old_value, new_value, device_name, device_tz
            )
            SELECT @user_id,
              COALESCE((SELECT NULLIF(trim(username), '') FROM users WHERE id = @user_id), @user_name),
              'update', 'role', @id, @details, 'role', @id, @old_value, @new_value,
              (SELECT device_name FROM user_sessions WHERE user_id = @user_id AND revoked_at IS NULL ORDER BY last_seen_at DESC, id DESC LIMIT 1),
              (SELECT device_tz FROM user_sessions WHERE user_id = @user_id AND revoked_at IS NULL ORDER BY last_seen_at DESC, id DESC LIMIT 1)
            WHERE changes() = 1`,
      params: { user_id: actor?.id ?? null, user_name: actorSnapshot(actor), id, details, ...roleChangeColumns },
    }, adminGuard.guard])
    const firstResult = results[0] as { changes?: number; meta?: { changes?: number } } | undefined
    const updatedRows = Number(firstResult?.meta?.changes ?? firstResult?.changes ?? 0)
    if (updatedRows !== 1) {
      const currentRole = await db.prepare(
        'SELECT id, name, code, is_system, permissions, created_at, updated_at FROM roles WHERE id = @id',
      ).get<Record<string, unknown>>({ id })
      const conflict = new WriteConflictError('role', currentRole || null, expectedUpdatedAt, currentRole ? 'updated' : 'deleted')
      const result = writeConflictResponse(conflict)
      return c.json(result.body, result.status)
    }
    c.executionCtx.waitUntil(broadcast(c.env, 'roles', { action: 'update', id }))
    return c.json({ success: true, ...(await db.prepare(
      'SELECT id, name, code, is_system, permissions, created_at, updated_at FROM roles WHERE id = @id',
    ).get({ id })) })
  } catch (error) {
    if (isAdminControlGuardAbort(error)) return c.json(lastAdminRequiredBody(), 409)
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
  // The client sends the version it holds in the JSON body (apiFetch sends a
  // body on DELETE too); the query string is the fallback, as in lookups.ts.
  // Until 22 Sep 2026 only the query string was read, so the check never ran.
  const query = Object.fromEntries(new URL(c.req.url).searchParams)
  const bodyForConflict = await c.req.json<Record<string, unknown>>().catch(() => query)
  try {
    assertUpdatedAtMatch('role', existingRole, getExpectedUpdatedAt(bodyForConflict))
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
