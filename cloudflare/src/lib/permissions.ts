// Fine-grained permission check, ported from backend/src/permissions.ts's
// hasPermissionValue() and backend/src/middleware.ts's admin/merge helpers.
//
// users.permissions and roles.permissions are both stored as JSON strings
// (see migrations/0001_init.sql) -- shape is roughly { all?: boolean,
// products?: boolean, contacts?: boolean, inventory?: boolean, ... }. The
// effective permission set for a user is role.permissions merged with
// user.permissions, with the user-level value winning on key conflicts --
// see getMergedPermissions below. lib/auth.ts's getSessionUser() now joins
// roles so role_code/role_permissions are present on every SessionUser.

export type PermissionUser = {
  permissions?: string | null
  role_permissions?: string | null
  role_code?: string | null
  username?: string | null
} | null | undefined

export function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

// A permission value is normally a plain boolean (Full Access / None). The
// Review Required tier (see progress.md's "Permissions UI redesign" item)
// adds a third possible value, the literal string 'review', but ONLY for
// the section keys listed in REVIEW_TIER_KEYS below -- every other key
// stays strictly boolean. `hasPermission()` below is deliberately strict
// (`=== true`, not just truthy) so that a 'review' string can never be
// silently read as a full grant by a call site that hasn't been updated to
// use getPermissionTier() -- see that function's own comment.
// A permission value is normally a plain boolean (Full / None). Two string
// middle tiers exist, each only for the section keys that opt in:
//   'review' -> writes go to the approval queue (REVIEW_TIER_KEYS)
//   'view'   -> read-only: the page/data is visible but every write is blocked
//               (VIEW_TIER_KEYS). Because hasPermission() is strict `=== true`,
//               a 'view' value already fails every write check that uses it --
//               the only thing getPermissionTier() adds is letting reads /
//               page-access see 'view' as "allowed, not none".
export type PermissionValue = boolean | 'review' | 'view'

export function parsePermissions(user: PermissionUser): Record<string, PermissionValue> {
  return parseJsonObject(user?.permissions) as Record<string, PermissionValue>
}

// Ported from backend/src/middleware.ts's getMergedPermissions(): role
// grants are the baseline, user-level permissions override per-key.
export function getMergedPermissions(user: PermissionUser): Record<string, PermissionValue> {
  const rolePermissions = parseJsonObject(user?.role_permissions)
  const userPermissions = parseJsonObject(user?.permissions)
  return { ...rolePermissions, ...userPermissions } as Record<string, PermissionValue>
}

// Ported from backend/src/middleware.ts's isAdminControlUser(). The
// reserved `admin` username, the `admin` role code, or an explicit
// `permissions.all` grant are all treated as full administrator control --
// used to gate user/role management, backup restore, and other
// destructive-by-default operations beyond the normal per-key permission
// check below.
export function isAdminControlUser(user: PermissionUser): boolean {
  if (!user) return false
  const username = String(user.username || '').trim().toLowerCase()
  const roleCode = String(user.role_code || '').trim().toLowerCase()
  const merged = getMergedPermissions(user)
  return username === 'admin' || roleCode === 'admin' || !!merged.all
}

// Mirrors the original's special-cased aliases for the *settings* sub-
// permissions -- a few settings sub-permissions fall back to the general
// "settings" permission, since routes/settings.ts's single POST endpoint
// doesn't differentiate by key and only ever checks 'settings' itself.
// backup_restore deliberately does NOT fall back from 'backup' (unlike
// those settings sub-keys) -- 'backup' (export, sensitivity: high) and
// 'backup_restore' (restore/reset, sensitivity: critical) are meant to be
// independently grantable, since exporting a backup is safe to hand to
// more people than overwriting the live database is. See routes/backups.ts
// for where this distinction is actually enforced.
// Admin-control users always pass every check below, matching
// backend/src/middleware.ts's hasPermission().
export function hasPermission(user: PermissionUser, key: string | null | undefined): boolean {
  const normalized = String(key || '').trim().toLowerCase()
  if (!normalized) return !!user
  if (isAdminControlUser(user)) return true
  const permissions = getMergedPermissions(user)
  // Strict `=== true`, not a truthy check: `permissions[normalized]` can
  // now legitimately be the string 'review' for a REVIEW_TIER_KEYS section,
  // and 'review' must NOT count as full access here -- callers that need to
  // treat Review Required as "allowed, but queue it" must use
  // getPermissionTier()/isReviewRequired() below instead of this function.
  if (permissions[normalized] === true) return true
  if (normalized === 'drive_credentials' && permissions.settings === true) return true
  if (normalized === 'business_identity' && permissions.settings === true) return true
  if (normalized === 'sales_policy' && permissions.settings === true) return true
  return false
}

export function hasAnyPermission(user: PermissionUser, keys: string[]): boolean {
  for (const key of keys) {
    if (hasPermission(user, key)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Three-tier permission model (progress.md "Permissions UI redesign").
// Only the sections below have ever been decided to carry a genuine middle
// tier; every other permission key (pos, users, backup, settings, sales,
// security_settings, drive_credentials, backup_restore,
// destructive_delete, business_identity, sales_policy, customer_portal,
// audit_log, review, all) stays Full Access / None only, per the explicit
// per-section decisions recorded in progress.md. Keep this set in sync with
// `frontend/src/components/users/permissionDefinitions.ts`'s `tier: true`
// flags -- the frontend control shows a 3-way toggle only for keys in both
// places.
// 'library' was REMOVED (library view/manage permission split, chat
// session): view is now free for any authenticated user (routes/files.ts's
// GET route has no permission check at all), and every management action
// (upload/download/rename/delete) requires real Full Access -- there is no
// longer a distinct middle tier for this section to grant, so keeping
// 'library' here would let getPermissionTier() return 'review' for a
// legacy review-tier grant that behaves identically to 'none' everywhere
// it's actually checked (hasFullLibraryAccess() only ever compares against
// 'full'). Matches frontend/src/utils/permissions.ts's own REVIEW_TIER_KEYS,
// which already had 'library' removed in the same session -- this file was
// the one half of that sync the incoming update package missed.
export const REVIEW_TIER_KEYS = new Set([
  'products',
  'inventory',
  'branches',
  'returns',
  'fees',
  'contacts',
])

// Sections whose middle tier is READ-ONLY ('view'): the page and its data are
// visible, but every write is blocked. Used for coarse admin-ish areas that
// have no approval-queue workflow but genuinely benefit from a see-but-don't-
// touch grant (an auditor / trainee role). Keep in sync with the frontend's
// own VIEW_TIER_KEYS. A key belongs to at most ONE of REVIEW_/VIEW_TIER_KEYS.
export const VIEW_TIER_KEYS = new Set([
  'settings',
  'sales',
  'promotions',
  'review',
  // audit_log's middle tier is OWN-scoped, not merely read-only: view = see
  // only your own audit entries, full = see everyone's (+ purge retention).
  // See routes/compat.ts's /system/audit-logs handler.
  'audit_log',
])

export type PermissionTier = 'full' | 'review' | 'view' | 'none'

// The tier-aware read every Review-Required-gated write route should use
// instead of hasPermission() for a REVIEW_TIER_KEYS section: 'full' means
// apply the write directly (same as hasPermission() === true today), 'none'
// means 403 (same as hasPermission() === false today), and 'review' is the
// new case -- the route should queue a pending_actions row
// (lib/pendingActions.ts / lib/reviewGate.ts) instead of writing, per each
// section's own allowed-directly-vs-review rules documented in
// progress.md and in each route file's own comments.
export function getPermissionTier(user: PermissionUser, key: string | null | undefined): PermissionTier {
  const normalized = String(key || '').trim().toLowerCase()
  if (!normalized) return 'none'
  if (isAdminControlUser(user)) return 'full'
  const permissions = getMergedPermissions(user)
  const raw = permissions[normalized]
  if (raw === true) return 'full'
  if (raw === 'review' && REVIEW_TIER_KEYS.has(normalized)) return 'review'
  if (raw === 'view' && VIEW_TIER_KEYS.has(normalized)) return 'view'
  return 'none'
}

export function isReviewRequired(user: PermissionUser, key: string | null | undefined): boolean {
  return getPermissionTier(user, key) === 'review'
}

// ---------------------------------------------------------------------------
// Per-ACTION overrides
// ---------------------------------------------------------------------------
// A tier answers "how much of Products may this role touch". An admin
// frequently wants the next level down -- "everything except Delete", "no
// Export" -- without inventing a whole new tier for each combination.
//
// An override is stored alongside the ordinary keys under a namespaced
// `section:action` key, e.g. `{ products: true, "products:delete": false }`.
// Older records simply have none, and unknown keys were always ignored, so
// this is backward compatible in both directions.
//
// DELIBERATELY ONE-WAY: an override can only ever REMOVE an action the tier
// already granted. It can never grant one the tier withholds.
//
// That is not timidity, it is what keeps this safe to enforce. Widening
// would mean every route learning to accept "your tier says no, but an
// override says yes", and any route that forgot would silently disagree
// with the UI -- the app would show a button that 403s, or worse, gate a
// write in the UI that the API still performs. Narrowing has no such
// failure mode: a route that has not yet been wired is simply no MORE
// permissive than it was before this existed, which is exactly the
// direction a permission bug should fail in.
//
// `isAdminControlUser` is checked first and is never narrowed -- an admin
// locking themselves out of their own controls via a stray override would
// be unrecoverable from inside the app.

/** Storage key for one action override. */
export function actionOverrideKey(section: string, action: string): string {
  return `${String(section || '').trim().toLowerCase()}:${String(action || '').trim().toLowerCase()}`
}

/**
 * True when this role has explicitly had `section:action` switched off.
 *
 * Only an explicit `false` counts. An absent key, `true`, or any other
 * value means "no opinion" and leaves the tier's own answer standing --
 * so a typo in an override key can never accidentally block something.
 */
export function isActionBlocked(user: PermissionUser, section: string, action: string): boolean {
  if (isAdminControlUser(user)) return false
  const permissions = getMergedPermissions(user)
  return permissions[actionOverrideKey(section, action)] === false
}

/**
 * The single call a route should make when it wants both the tier answer
 * and any per-action narrowing applied: returns the effective tier for THIS
 * action, which is the section tier unless the action has been switched
 * off, in which case it is 'none'.
 *
 * Using this in place of getPermissionTier() at an action's own route keeps
 * the existing 'none' -> 403 / 'review' -> queue branches working unchanged;
 * the route does not need to learn a new outcome shape.
 */
export function getActionTier(user: PermissionUser, section: string, action: string): PermissionTier {
  const tier = getPermissionTier(user, section)
  if (tier === 'none') return 'none'
  return isActionBlocked(user, section, action) ? 'none' : tier
}

// ---------------------------------------------------------------------------
// Action-history permission/sensitivity mapping, ported verbatim (data
// only, no Node dependencies) from backend/src/permissions.ts. Used by
// routes/actionHistory.ts to decide who can read/record/undo a given
// action-history row without ever exposing another user's sensitive
// (backup/restore/user/role/security) history to someone who merely has
// the generic `audit_log` permission.
// ---------------------------------------------------------------------------

export const SENSITIVE_PERMISSION_KEYS = new Set([
  'all',
  'users',
  'backup_restore',
  'drive_credentials',
  'security_settings',
  'business_identity',
  'sales_policy',
  'destructive_delete',
])

export const ENTITY_PERMISSION_MAP = new Map<string, string>([
  ['product', 'products'],
  ['products', 'products'],
  ['category', 'products'],
  ['categories', 'products'],
  ['unit', 'products'],
  ['units', 'products'],
  ['supplier', 'contacts'],
  ['suppliers', 'contacts'],
  ['customer', 'contacts'],
  ['customers', 'contacts'],
  ['contact', 'contacts'],
  ['contacts', 'contacts'],
  ['delivery_contact', 'contacts'],
  ['delivery_contacts', 'contacts'],
  ['inventory', 'inventory'],
  ['stock', 'inventory'],
  ['stock_transfer', 'inventory'],
  ['branch', 'branches'],
  ['branches', 'branches'],
  ['sale', 'sales'],
  ['sales', 'sales'],
  ['return', 'returns'],
  ['returns', 'returns'],
  ['portal', 'customer_portal'],
  ['customer_portal', 'customer_portal'],
  ['setting', 'settings'],
  ['settings', 'settings'],
  ['file', 'library'],
  ['files', 'library'],
  ['backup', 'backup'],
  ['restore', 'backup_restore'],
  ['reset', 'backup_restore'],
  ['user', 'users'],
  ['users', 'users'],
  ['role', 'users'],
  ['roles', 'users'],
  ['import', 'products'],
  ['imports', 'products'],
  // The announcement strip ('promotion' entity) manages under the legacy
  // products gate; G1's rule engine ('promotion_rule') under the
  // Promotions page's own key -- mirrors routes/promotions.ts's gates.
  ['promotion', 'products'],
  ['promotions', 'products'],
  ['promotion_rule', 'promotions'],
  ['promotion_rules', 'promotions'],
])

export const SENSITIVE_ENTITY_KEYS = new Set([
  'backup',
  'restore',
  'reset',
  'user',
  'users',
  'role',
  'roles',
  'security',
  'drive_credentials',
])

function normalizeKey(value: unknown): string {
  return String(value || '').trim().toLowerCase()
}

function isSensitivePermissionKey(key: unknown): boolean {
  return SENSITIVE_PERMISSION_KEYS.has(normalizeKey(key))
}

export function permissionForActionHistory(input: { entity?: unknown; scope?: unknown } = {}): string {
  const entityKey = normalizeKey(input.entity)
  const scopeKey = normalizeKey(input.scope)
  return (
    ENTITY_PERMISSION_MAP.get(entityKey)
    || ENTITY_PERMISSION_MAP.get(scopeKey)
    || (scopeKey && scopeKey !== 'global' ? scopeKey : '')
  )
}

export function isSensitiveActionHistory(input: { entity?: unknown; scope?: unknown; payload?: Record<string, unknown> | null } = {}): boolean {
  const entityKey = normalizeKey(input.entity)
  const scopeKey = normalizeKey(input.scope)
  if (SENSITIVE_ENTITY_KEYS.has(entityKey) || SENSITIVE_ENTITY_KEYS.has(scopeKey)) return true
  const permission = permissionForActionHistory(input)
  if (isSensitivePermissionKey(permission)) return true
  const payload = input.payload
  if (payload && typeof payload === 'object') {
    const explicitSensitivity = normalizeKey((payload as Record<string, unknown>).sensitivity || (payload as Record<string, unknown>).permissionSensitivity)
    if (explicitSensitivity === 'critical' || explicitSensitivity === 'sensitive') return true
    const explicitPermission = normalizeKey((payload as Record<string, unknown>).permission || (payload as Record<string, unknown>).permissionKey)
    if (explicitPermission && isSensitivePermissionKey(explicitPermission)) return true
  }
  return false
}
