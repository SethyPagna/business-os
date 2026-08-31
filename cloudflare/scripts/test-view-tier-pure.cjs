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
const VIEW_TIER_KEYS = new Set(['settings', 'sales', 'promotions'])
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
check('frontend utils/permissions.ts VIEW_TIER_KEYS matches the backend', () => {
  const feSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'permissions.ts'), 'utf8')
  const m = feSrc.match(/export const VIEW_TIER_KEYS = new Set<string>\(\[([^\]]*)\]\)/)
  assert.ok(m, 'frontend VIEW_TIER_KEYS set literal not found')
  const feKeys = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
  assert.deepEqual(feKeys, [...VIEW_TIER_KEYS].sort(), 'frontend/backend VIEW_TIER_KEYS drifted')
})

console.log(`\nALL ${passed} CHECKS PASSED`)
