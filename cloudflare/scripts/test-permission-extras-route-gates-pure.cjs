// Backend enforcement for every key whose implicit Settings-Full / Inventory-Full grant was removed (lane 6.0.967,
// owner 21-23 Oct 2026: Full = main access only; extras are separate and consistent everywhere).
// For each gate: Settings Full (or Inventory Full) ALONE is refused; the specific key alone is allowed; admin is allowed.
// Migration 0270 materializes the old implicit grants, so no principal loses access (see the oracle tests).
//
// Run: node scripts/test-permission-extras-route-gates-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SRC = path.join(__dirname, '..', 'src')
let passed = 0
const failures = []
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failures.push(name); console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`) }
}

// A callable, chainable stub: any property or call returns itself, so a route file's top-level wiring loads.
function deepStub() {
  const fn = function () { return proxy }
  const proxy = new Proxy(fn, { get: (_t, key) => (key === 'then' ? undefined : key === Symbol.toPrimitive ? () => '' : proxy), apply: () => proxy })
  return proxy
}

const cache = new Map()
function load(rel, stubs = {}) {
  const key = rel
  if (cache.has(key)) return cache.get(key).exports
  const full = path.join(SRC, rel)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: full,
  }).outputText
  const mod = { exports: {} }
  cache.set(key, mod)
  new Function('require', 'module', 'exports', code)((request) => {
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    const asTs = resolved.endsWith('.ts') ? resolved : `${resolved}.ts`
    if (['lib/permissions.ts'].includes(asTs)) return load(asTs)
    return stubs[request] || deepStub()
  }, mod, mod.exports)
  return mod.exports
}
// lib/permissions.ts needs a './db' import only for types and helpers the gates below do not use.
const permissions = load('lib/permissions.ts', { './db': {} })
void permissions

const u = (perms, role = null) => ({ id: 1, username: 'u', name: 'U', permissions: JSON.stringify(perms), role_code: role, role_permissions: null })
const admin = u({}, 'admin')
const settingsFull = u({ settings: true })

function loadRoute(rel) { return load(rel) }

async function main() {
  const settingsRoute = loadRoute('routes/settings.ts')
  await check('settings: every bucket key needs its own grant; Settings Full alone is refused', () => {
    const { settingsPermissionRefusal, settingsBucketPermissionFor } = settingsRoute
    const samples = { business_identity: 'business_name', sales_policy: 'sale_amendment_window_minutes', receipt_settings: 'receipt_template', portal_posts: null, portal_faq: null, portal_about: null, customer_portal: 'customer_portal_theme' }
    for (const [bucket, key] of Object.entries(samples)) {
      if (!key) continue
      assert.equal(settingsBucketPermissionFor(key), bucket, `${key} belongs to ${bucket}`)
      assert.ok(settingsPermissionRefusal(settingsFull, [key]), `${bucket}: Settings Full alone is refused`)
      assert.equal(settingsPermissionRefusal(u({ [bucket]: true }), [key]), null, `${bucket}: its own grant saves it`)
      assert.equal(settingsPermissionRefusal(admin, [key]), null, `${bucket}: admin saves it`)
      assert.ok(settingsPermissionRefusal(u({ [bucket]: true }), [key, 'some_plain_setting_key']), 'a bucket grant does not open the non-bucket keys')
    }
    assert.equal(settingsPermissionRefusal(settingsFull, ['some_plain_setting_key']), null, 'Settings Full still saves a non-bucket key (its main access)')
    assert.match(String(settingsPermissionRefusal(settingsFull, ['business_name'])), /requires Business identity access/)
    assert.doesNotMatch(String(settingsPermissionRefusal(settingsFull, ['business_name'])), /full Settings/i)
  })

  await check('portal: submission moderation needs customer_portal; Settings Full alone is refused', () => {
    const { canManagePortalSubmissions } = loadRoute('routes/portal.ts')
    assert.equal(canManagePortalSubmissions(settingsFull), false)
    assert.equal(canManagePortalSubmissions(u({ customer_portal: true })), true)
    assert.equal(canManagePortalSubmissions(admin), true)
  })

  await check('files: library management needs Library Full; Settings Full alone is refused, View is not enough', () => {
    const { hasFullLibraryAccess } = loadRoute('routes/files.ts')
    assert.equal(hasFullLibraryAccess(settingsFull), false)
    assert.equal(hasFullLibraryAccess(u({ library: 'view' })), false)
    assert.equal(hasFullLibraryAccess(u({ library: true })), true)
    assert.equal(hasFullLibraryAccess(admin), true)
  })

  await check('lib/permissions.ts: hasPermission is strict, so Settings Full implies none of the removed fallbacks', () => {
    for (const key of ['drive_credentials', 'business_identity', 'sales_policy', 'receipt_settings', 'portal_posts', 'portal_faq', 'portal_about', 'customer_portal', 'ai_providers', 'library']) {
      assert.equal(permissions.hasPermission(settingsFull, key), false, `${key} is not implied by Settings Full`)
      assert.equal(permissions.hasPermission(u({ [key]: true }), key), true, `${key} stored true is held`)
      assert.equal(permissions.hasPermission(admin, key), true, `${key} admin`)
    }
    assert.equal(permissions.hasPermission(u({ drive_credentials: 'true' }), 'drive_credentials'), false, 'only a boolean true counts')
    assert.ok(permissions.SENSITIVE_PERMISSION_KEYS.has('ai_providers'), 'ai_providers is a sensitive key')
  })

  await check('ai: provider routes demand ai_providers (HTTP), Settings Full alone gets 403', async () => {
    let current = settingsFull
    const aiStubs = {
      '../lib/db': { getDb: () => ({ prepare: () => ({ all: async () => [], get: async () => null, run: async () => ({ changes: 0 }) }) }) },
      '../lib/auth': { requireAuth: async (c, next) => { c.set('user', current); return next() } },
      '../lib/audit': { audit: async () => {} },
      '../lib/rateLimit': { checkRateLimit: async () => ({ allowed: true }), getClientIp: () => '203.0.113.9' },
    }
    cache.delete('routes/ai.ts')
    const app = load('routes/ai.ts', aiStubs).default
    const ask = async () => (await app.request('/providers', { method: 'GET' }, { DB: {} }, { waitUntil() {}, passThroughOnException() {} })).status
    assert.equal(await ask(), 403, 'Settings Full alone')
    current = u({ settings: true, drive_credentials: true, library: true }); assert.equal(await ask(), 403, 'Drive and Library grants do not open AI keys')
    current = u({ ai_providers: true }); assert.notEqual(await ask(), 403, 'ai_providers alone')
    current = admin; assert.notEqual(await ask(), 403, 'admin')
  })

  const src = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')
  await check('compat/system/promotions: Drive control and diagnostics ask drive_credentials; the strip asks its two grants, never settings', () => {
    const compat = src('routes/compat.ts')
    assert.equal((compat.match(/denyUnless\(c, 'drive_credentials'\)/g) || []).length, 4, 'Drive connect, disconnect, preferences and forget')
    assert.equal((compat.match(/denyUnless\(c, 'backup', 'drive_credentials'\)/g) || []).length, 6, 'Drive status, sync jobs, system jobs, integration doctor')
    assert.doesNotMatch(compat, /denyUnless\(c, '(?:backup', ')?settings'\)/, 'compat.ts no longer accepts the Settings grant')
    assert.match(src('routes/system.ts'), /!hasPermission\(user, 'backup'\) && !hasPermission\(user, 'drive_credentials'\)/)
    assert.doesNotMatch(src('routes/system.ts'), /hasPermission\(user, 'settings'\)/)
    assert.match(src('routes/promotions.ts'), /const WEBSITE_EDITOR_STRIP_KEYS = \['portal_posts', 'customer_portal'\]/)
    assert.doesNotMatch(src('routes/runtime.ts') + src('routes/ai.ts') + src('routes/files.ts') + src('routes/portal.ts'), /hasPermission\(user, 'settings'\)\s*\|\||\|\|\s*hasPermission\(user, 'settings'\)/, 'no route ORs Settings in beside a specific grant')
  })

  await check('inventory count sessions: Inventory Full or Review no longer opens counting or its fields (lib/inventoryCheckAccess.ts, real module)', () => {
    const acquisition = (() => { const m = { exports: {} }; const full = path.join(SRC, 'lib/acquisitionCostAccess.ts'); const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; new Function('require', 'module', 'exports', code)(() => permissions, m, m.exports); return m.exports })()
    const full = path.join(SRC, 'lib/inventoryCheckAccess.ts')
    const m = { exports: {} }
    new Function('require', 'module', 'exports', ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)((r) => (r === './permissions' ? permissions : acquisition), m, m.exports)
    const access = m.exports.getInventoryCheckAccess
    const everyField = Object.fromEntries(['price', 'barcode', 'category', 'brand', 'stock', 'received', 'sales', 'customers', 'cost'].map((f) => [`inventory_check_show_${f}`, true]))
    for (const inventory of [true, 'review']) {
      const a = access(u({ inventory, ...everyField }))
      assert.equal(a.canView, false); assert.equal(a.canCheck, false)
      assert.ok(Object.values(a.fields).every((v) => v === false))
    }
    const own = access(u({ inventory_checks: true, inventory_check_show_stock: true }))
    assert.equal(own.canView, true); assert.equal(own.canCheck, true); assert.equal(own.fields.stock, true); assert.equal(own.fields.price, false)
    assert.equal(access(admin).canView, true)
  })

  if (failures.length) { console.log(`\n${failures.length} check(s) FAILED`); process.exit(1) }
  console.log(`\n${passed} checks passed: permission extras route gates`)
}
main().catch((e) => { console.error(e); process.exit(1) })
