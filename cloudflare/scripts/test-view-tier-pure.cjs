// Regression lock for the read-only 'view' permission tier (Part 557).
// A VIEW_TIER_KEYS section (Settings) can be granted 'view' -- the page/data
// is visible but every write is refused. The guarantees:
//   - getPermissionTier(user, key) === 'view' for a stored 'view' on a
//     VIEW_TIER key (and 'none' for a non-view key or an admin-less bogus).
//   - hasPermission() (strict === true) still returns FALSE for a 'view'
//     value, so every existing write gate keeps blocking it with no per-route
//     change.
// Replicates the exact logic from cloudflare/src/lib/permissions.ts and also
// source-guards that the two tier-key sets stay in sync front/back.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

let passed = 0
const check = (label, fn) => { fn(); passed++; console.log(`PASS ${label}`) }

// --- replicate the model (kept identical to lib/permissions.ts) -----------
const REVIEW_TIER_KEYS = new Set(['products', 'inventory', 'branches', 'returns', 'fees', 'contacts'])
const VIEW_TIER_KEYS = new Set(['settings', 'sales', 'promotions', 'review', 'audit_log'])
const merged = (u) => ({ ...JSON.parse(u.role_permissions || '{}'), ...JSON.parse(u.permissions || '{}') })
const isAdmin = (u) => {
  const un = String(u.username || '').toLowerCase(); const rc = String(u.role_code || '').toLowerCase()
  return un === 'admin' || rc === 'admin' || !!merged(u).all
}
const hasPermission = (u, key) => {
  if (isAdmin(u)) return true
  return merged(u)[key] === true // STRICT
}
const getPermissionTier = (u, key) => {
  if (isAdmin(u)) return 'full'
  const raw = merged(u)[key]
  if (raw === true) return 'full'
  if (raw === 'review' && REVIEW_TIER_KEYS.has(key)) return 'review'
  if (raw === 'view' && VIEW_TIER_KEYS.has(key)) return 'view'
  return 'none'
}

const viewUser = { username: 'v', role_permissions: JSON.stringify({ settings: 'view' }), permissions: '{}' }
const fullUser = { username: 'f', role_permissions: JSON.stringify({ settings: true }), permissions: '{}' }
const noneUser = { username: 'n', role_permissions: '{}', permissions: '{}' }

check("a 'view' value on Settings -> tier 'view' (page/read allowed)", () => {
  assert.equal(getPermissionTier(viewUser, 'settings'), 'view')
})
check("hasPermission('settings') is FALSE for a view user (writes stay blocked)", () => {
  assert.equal(hasPermission(viewUser, 'settings'), false)
})
check("Full grant reads as tier 'full' AND hasPermission true (writes allowed)", () => {
  assert.equal(getPermissionTier(fullUser, 'settings'), 'full')
  assert.equal(hasPermission(fullUser, 'settings'), true)
})
check("None reads as tier 'none'", () => {
  assert.equal(getPermissionTier(noneUser, 'settings'), 'none')
})
check("'view' on a NON-view key is ignored -> 'none' (no accidental grant)", () => {
  // 'dashboard' is coarse Full/None only -- never a view-tier key.
  const u = { username: 'x', role_permissions: JSON.stringify({ dashboard: 'view' }), permissions: '{}' }
  assert.equal(getPermissionTier(u, 'dashboard'), 'none')
})

// --- Sales view-tier (Part 557 slice 2): reads visible, writes refused -----
const salesViewUser = { username: 'sv', role_permissions: JSON.stringify({ sales: 'view' }), permissions: '{}' }
const salesFullUser = { username: 'sf', role_permissions: JSON.stringify({ sales: true }), permissions: '{}' }
check("Sales 'view' -> tier 'view' (list/stats/reports/export readable)", () => {
  assert.equal(getPermissionTier(salesViewUser, 'sales'), 'view')
})
check("hasPermission('sales') FALSE for a Sales view user (status/customer/import writes stay blocked)", () => {
  assert.equal(hasPermission(salesViewUser, 'sales'), false)
})
check("Full Sales grant -> tier 'full' AND hasPermission true (writes allowed)", () => {
  assert.equal(getPermissionTier(salesFullUser, 'sales'), 'full')
  assert.equal(hasPermission(salesFullUser, 'sales'), true)
})
check("canReadSales() shape: tier !== 'none' for view AND full, but 'none' for no grant", () => {
  // Mirrors routes/sales.ts canReadSales(): getPermissionTier(user,'sales') !== 'none'.
  const canRead = (u) => getPermissionTier(u, 'sales') !== 'none'
  assert.equal(canRead(salesViewUser), true)
  assert.equal(canRead(salesFullUser), true)
  assert.equal(canRead(noneUser), false)
})

// --- source guards: sets in sync, and the value type includes 'view' ------
check("lib/permissions.ts declares VIEW_TIER_KEYS (settings + sales) + handles 'view'", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'permissions.ts'), 'utf8')
  const m = src.match(/export const VIEW_TIER_KEYS = new Set(?:<string>)?\(\[([^\]]*)\]\)/)
  assert.ok(m, 'backend VIEW_TIER_KEYS set literal not found')
  const beKeys = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
  assert.deepEqual(beKeys, [...VIEW_TIER_KEYS].sort(), 'backend VIEW_TIER_KEYS drifted from this test')
  assert.match(src, /raw === 'view' && VIEW_TIER_KEYS\.has\(normalized\)\) return 'view'/)
  assert.match(src, /PermissionValue = boolean \| 'review' \| 'view'/)
})
check("routes/sales.ts read gates use canReadSales() (view-aware) while writes stay strict", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'sales.ts'), 'utf8')
  assert.match(src, /function canReadSales\([\s\S]*getPermissionTier\(user, 'sales'\) !== 'none'/)
  // The two write gates must remain strict hasPermission('sales').
  assert.match(src, /if \(!hasPermission\(user, 'sales'\)\)/)
})

// --- Promotions view-tier (Part 557 slice 4): read rule list, no manage -----
const promoViewUser = { username: 'pv', role_permissions: JSON.stringify({ promotions: 'view' }), permissions: '{}' }
const promoFullUser = { username: 'pf', role_permissions: JSON.stringify({ promotions: true }), permissions: '{}' }
check("Promotions 'view' -> tier 'view' (GET /rules readable)", () => {
  assert.equal(getPermissionTier(promoViewUser, 'promotions'), 'view')
})
check("hasPermission('promotions') FALSE for a Promotions view user (create/edit/delete stay blocked)", () => {
  assert.equal(hasPermission(promoViewUser, 'promotions'), false)
})
check("Full Promotions grant -> tier 'full' AND hasPermission true (manage allowed)", () => {
  assert.equal(getPermissionTier(promoFullUser, 'promotions'), 'full')
  assert.equal(hasPermission(promoFullUser, 'promotions'), true)
})
check("routes/promotions.ts: GET /rules uses requireReadKey (view-aware); writes keep requireKey", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'promotions.ts'), 'utf8')
  assert.match(src, /const requireReadKey =[\s\S]*getPermissionTier\(c\.get\('user'\), key\) === 'none'/)
  assert.match(src, /app\.get\('\/rules', requireReadKey\('promotions'\)/)
  assert.match(src, /app\.post\('\/rules', requireKey\('promotions'\)/)
  assert.match(src, /app\.put\('\/rules\/:id', requireKey\('promotions'\)/)
  assert.match(src, /app\.delete\('\/rules\/:id', requireKey\('promotions'\)/)
})

// --- Review view-tier (Part 557 slice 5): watch the queue, no approve/reject -
const reviewViewUser = { username: 'rv', role_permissions: JSON.stringify({ review: 'view' }), permissions: '{}' }
const reviewFullUser = { username: 'rf', role_permissions: JSON.stringify({ review: true }), permissions: '{}' }
check("Review 'view' -> tier 'view' (pending queue readable)", () => {
  assert.equal(getPermissionTier(reviewViewUser, 'review'), 'view')
})
check("hasPermission('review') FALSE for a Review view user (approve/reject stay blocked)", () => {
  assert.equal(hasPermission(reviewViewUser, 'review'), false)
})
check("Full Review grant -> tier 'full' AND hasPermission true (approve/reject allowed)", () => {
  assert.equal(getPermissionTier(reviewFullUser, 'review'), 'full')
  assert.equal(hasPermission(reviewFullUser, 'review'), true)
})
check("routes/reviewQueue.ts: reader middleware is tier-aware; approve/reject re-check strict", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'reviewQueue.ts'), 'utf8')
  assert.match(src, /getPermissionTier\(user, 'review'\) === 'none'\) return c\.json\(\{ error: 'Forbidden' \}, 403\)/)
  // Both writes individually re-check strict hasPermission('review').
  const strictWrites = src.match(/if \(!hasPermission\(user, 'review'\)\) return c\.json\(\{ error: 'Forbidden' \}, 403\)/g) || []
  assert.ok(strictWrites.length >= 2, `expected >=2 strict review write gates, found ${strictWrites.length}`)
})

// --- audit_log OWN-scoped view tier (Part 557 slice 7) ---------------------
const auditViewUser = { username: 'av', role_permissions: JSON.stringify({ audit_log: 'view' }), permissions: '{}' }
const auditFullUser = { username: 'af', role_permissions: JSON.stringify({ audit_log: true }), permissions: '{}' }
check("audit_log 'view' -> tier 'view' (own-scoped read)", () => {
  assert.equal(getPermissionTier(auditViewUser, 'audit_log'), 'view')
})
check("hasPermission('audit_log') FALSE for a view user (purge + all-users read stay blocked)", () => {
  // The retention purge + legacy deleted-sales ledger keep strict
  // denyUnless('audit_log') = hasPermission === true, which a view value fails.
  assert.equal(hasPermission(auditViewUser, 'audit_log'), false)
})
check("Full audit_log grant -> tier 'full' AND hasPermission true (all users + purge)", () => {
  assert.equal(getPermissionTier(auditFullUser, 'audit_log'), 'full')
  assert.equal(hasPermission(auditFullUser, 'audit_log'), true)
})
check("routes/compat.ts: audit-logs read is tier-aware + own-scopes view (userId=self)", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')
  assert.match(src, /const tier = getPermissionTier\(user, 'audit_log'\)/)
  assert.match(src, /const ownOnly = tier === 'view'/)
  assert.match(src, /userId: ownOnly \? String\(user\?\.id \?\? ''\) : c\.req\.query\('userId'\)/)
  // Purge + deleted-sales ledger stay strict (Full only).
  assert.match(src, /app\.delete\('\/system\/audit-logs\/retention'[\s\S]*?denyUnless\(c, 'audit_log'\)/)
})
check('frontend utils/permissions.ts VIEW_TIER_KEYS matches the backend', () => {
  const feSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'permissions.ts'), 'utf8')
  const m = feSrc.match(/export const VIEW_TIER_KEYS = new Set<string>\(\[([^\]]*)\]\)/)
  assert.ok(m, 'frontend VIEW_TIER_KEYS set literal not found')
  const feKeys = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
  assert.deepEqual(feKeys, [...VIEW_TIER_KEYS].sort(), 'frontend/backend VIEW_TIER_KEYS drifted')
})

console.log(`\nALL ${passed} CHECKS PASSED`)
