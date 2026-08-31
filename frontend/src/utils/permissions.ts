type PermissionMap = Record<string, unknown>

function isPermissionMap(value: unknown): value is PermissionMap {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parsePermissionMap(value: unknown): PermissionMap {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value || '{}')
      return isPermissionMap(parsed) ? parsed : {}
    } catch (_) {
      return {}
    }
  }
  if (isPermissionMap(value)) {
    return value
  }
  return {}
}

// Mirrors cloudflare/src/lib/permissions.ts's own PermissionValue/
// REVIEW_TIER_KEYS/getPermissionTier -- see that file's comments for the
// full reasoning, kept in sync here. A permission value is normally a
// plain boolean (Full Access / None); the Review Required tier adds a
// third possible value, the literal string 'review', but ONLY for the
// section keys in REVIEW_TIER_KEYS below.
export type PermissionValue = boolean | 'review' | 'view'

// Keep in sync with cloudflare/src/lib/permissions.ts's REVIEW_TIER_KEYS
// AND frontend/src/components/users/permissionDefinitions.ts's `tier: true`
// flags. Only add a key here once its write route(s) actually branch on
// getPermissionTier()/maybeQueueForReview() (lib/reviewGate.ts) AND have a
// registered applier in lib/reviewApply.ts -- otherwise picking "Review
// Required" in the UI would silently do nothing (the exact
// looks-wired-but-isn't class this codebase's own QA framework warns
// about), which is worse than not offering the tier at all. Today that's
// true for 'fees' (Part 156), 'branches' (create/update queue directly,
// delete queues with an approval-time re-check, transfer/stock-integrity-
// repair are deliberately Full-Access-only), 'products'
// (create/update/delete all queue), 'inventory' (editing the saved
// reasons list queues, adjust/transfer/move-row are deliberately
// Full-Access-only, same shape as branches), 'returns' (create applies
// directly, edit is Full-Access-only, no delete route exists to wire),
// and 'contacts' (create applies directly, edit silently drops every
// field but name, delete is Full-Access-only) -- Part 159. All six keys
// in this set now have their full gate+applier chain verified against
// source, not just claimed.
//
// 'library' was REMOVED (library view/manage permission split, merge
// session): view is now free for any authenticated user (routes/files.ts's
// GET route has no permission check at all), and every management action
// (upload/download/rename/delete) requires real Full Access -- there is no
// longer a distinct middle tier for this section to grant. This is the
// frontend half of that sync -- the update package that removed 'library'
// from cloudflare/src/lib/permissions.ts's copy claimed this file was
// already updated "in the same session"; it wasn't, so the two files were
// left disagreeing until this fix.
export const REVIEW_TIER_KEYS = new Set<string>(['fees', 'branches', 'products', 'inventory', 'returns', 'contacts'])

// Sections whose middle tier is READ-ONLY 'view' (see cloudflare/src/lib/
// permissions.ts's VIEW_TIER_KEYS -- kept in sync). 'view' means the page is
// visible but every write is blocked; a key belongs to at most ONE of
// REVIEW_/VIEW_TIER_KEYS.
export const VIEW_TIER_KEYS = new Set<string>(['settings', 'sales', 'promotions', 'review'])

export type PermissionTier = 'full' | 'review' | 'view' | 'none'

// Tier-aware read for a single merged-permissions map (already
// role+user-merged -- callers should pass the same merged object
// AppContext.tsx's getPermissions()/getMergedPermissionsRaw() builds, not
// a raw user record). 'review' only ever comes back for a key in
// REVIEW_TIER_KEYS -- a 'review' string stored against any other key
// (e.g. a stale/hand-edited role row) is treated as 'none', matching the
// backend's own strict interpretation in getPermissionTier().
export function getPermissionTierFromMap(merged: PermissionMap, key: string, isAdmin: boolean): PermissionTier {
  const normalized = String(key || '').trim().toLowerCase()
  if (!normalized) return 'none'
  if (isAdmin) return 'full'
  const raw = merged[normalized]
  if (raw === true) return 'full'
  if (raw === 'review' && REVIEW_TIER_KEYS.has(normalized)) return 'review'
  if (raw === 'view' && VIEW_TIER_KEYS.has(normalized)) return 'view'
  return 'none'
}

