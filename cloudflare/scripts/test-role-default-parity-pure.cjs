// The seeded role permissions have ONE definition (lib/roleDefaults.ts). This pins:
//   - coreDataInvariants.ts seeds from it and does not carry a second copy;
//   - the admin-only GET /api/roles/defaults serves exactly that object (deep-equal), and refuses everyone else;
//   - the Employee default says what the owner decided (5 Oct, 16 Sep, 19-20 Oct 2026): product details visible and
//     editable without cost, price or supplier, no physical-stock writer grant, Contacts Full, no Dashboard.
//
// Run (from cloudflare/scripts): node test-role-default-parity-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')

const SRC = path.join(__dirname, '..', 'src')
let user = null
const inert = new Proxy(function () {}, { get: () => inert, apply: () => undefined })
function load(rel, stubs = {}) {
  const full = path.join(SRC, rel)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: full,
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', '__filename', '__dirname', code)((request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return request.startsWith('.') ? inert : require(request)
  }, mod, mod.exports, full, path.dirname(full))
  return mod.exports
}

const permissions = load('lib/permissions.ts', { './db': inert })
const { DEFAULT_ROLE_PERMISSIONS: SEED } = load('lib/roleDefaults.ts')
const usersRoutes = load('routes/users.ts', {
  '../lib/auth': { requireAuth: async (c, next) => { if (!user) return c.json({ error: 'Unauthenticated' }, 401); c.set('user', user); return next() } },
  '../lib/permissions': permissions,
  '../lib/roleDefaults': load('lib/roleDefaults.ts'),
}).default
const app = new Hono()
app.route('/api', usersRoutes)

const asUser = (role, own = {}) => ({ id: 31, username: role, name: role, role_code: role, role_permissions: JSON.stringify(SEED[role] || {}), permissions: JSON.stringify(own) })
let failed = 0
async function check(name, fn) {
  try { await fn(); console.log('PASS ' + name) } catch (error) { failed += 1; console.log('FAIL ' + name + '\n  ' + String(error && error.stack || error).split('\n').slice(0, 8).join('\n  ')) }
}

async function main() {
  await check('GET /api/roles/defaults serves exactly the constant the seed uses', async () => {
    user = { id: 1, username: 'admin', name: 'Admin', role_code: 'admin', permissions: '{}' }
    const res = await app.request('/api/roles/defaults', { method: 'GET' }, {}, { waitUntil() {} })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body.defaults, JSON.parse(JSON.stringify(SEED)), 'the route is not a second copy')
    assert.deepEqual(Object.keys(body.defaults).sort(), ['admin', 'employee', 'manager'])
  })

  await check('GET /api/roles/defaults is admin-only: Employee, Manager and anonymous are refused', async () => {
    for (const who of [asUser('employee'), asUser('manager', { products: true }), null]) {
      user = who
      const res = await app.request('/api/roles/defaults', { method: 'GET' }, {}, { waitUntil() {} })
      assert.equal(res.status, who ? 403 : 401, who ? who.username : 'anonymous')
    }
  })

  await check('coreDataInvariants.ts seeds from roleDefaults.ts and holds no second copy', () => {
    const core = fs.readFileSync(path.join(SRC, 'lib', 'coreDataInvariants.ts'), 'utf8')
    assert.match(core, /from '\.\/roleDefaults'/)
    assert.doesNotMatch(core, /const DEFAULT_ROLE_PERMISSIONS/)
    assert.match(core, /\['Employee', 'employee', 0, DEFAULT_ROLE_PERMISSIONS\.employee\]/)
    assert.match(core, /\['Manager', 'manager', 0, DEFAULT_ROLE_PERMISSIONS\.manager\]/)
    assert.deepEqual(SEED.admin, { all: true })
    assert.deepEqual(SEED.manager, {})
  })

  await check('the Employee default: details visible and editable, never cost, price or supplier; no stock writer; Contacts Full; no Dashboard', () => {
    const e = SEED.employee
    assert.equal(e.products, true)
    for (const key of ['products:price', 'products:supplier', 'product_cost_view', 'product_cost_edit']) assert.equal(e[key], false, key)
    assert.equal(Object.hasOwn(e, 'inventory'), false, 'no inventory key: an Employee never writes physical stock')
    assert.equal(Object.keys(e).some((key) => key.startsWith('inventory:')), false, 'no inventory action grants either')
    assert.equal(e.contacts, true, 'Contacts is Full (owner, 20 Oct 2026)')
    assert.equal(permissions.getPermissionTier(asUser('employee'), 'contacts'), 'full')
    assert.equal(Object.hasOwn(e, 'dashboard') && e.dashboard !== false, false, 'Dashboard is off by default (owner, 20 Oct 2026)')
    assert.equal(permissions.getPermissionTier(asUser('employee'), 'dashboard'), 'none')
    assert.equal(e.receipt_settings, true)
    assert.equal(e.inventory_checks, true)
    for (const field of ['price', 'barcode', 'category', 'brand', 'stock', 'received', 'sales', 'customers']) assert.equal(e['inventory_check_show_' + field], true, field)
    assert.equal(e.inventory_check_show_cost, false)
    assert.equal(e['products:history'], false, 'history sub-pages stay off (5 Oct 2026)')
    const emp = asUser('employee')
    for (const action of ['view', 'edit', 'image']) assert.equal(permissions.getActionTier(emp, 'products', action), 'full', action)
    for (const action of ['price', 'supplier']) assert.equal(permissions.getActionTier(emp, 'products', action), 'none', action)
    // Narrowing only: a role stored before the switch existed (key absent) keeps working.
    const { 'products:supplier': _drop, ...legacy } = SEED.employee
    assert.equal(permissions.getActionTier({ ...emp, role_permissions: JSON.stringify(legacy) }, 'products', 'supplier'), 'full')
  })

  console.log(failed ? '\n' + failed + ' check(s) failed' : '\nall checks passed')
  process.exitCode = failed ? 1 : 0
}
main().catch((error) => { console.error(error); process.exitCode = 1 })
