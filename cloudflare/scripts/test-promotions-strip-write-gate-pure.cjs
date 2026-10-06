// Owner ruling, 6 Oct 2026 (release security review P2-1): the storefront ANNOUNCEMENT STRIP cards
// are public website content, including an outside https link. Their four writes (POST /, PUT /:id,
// PUT /reorder/all, DELETE /:id) were behind the `products` section, which the planned Employee
// role now holds, so an Employee could publish a phishing card. They now need a Website Editor
// grant (posts & promos, or portal config) or full Settings; reads keep the products gate.
//
// Drives the REAL routes/promotions.ts and the REAL lib/permissions.ts (the earlier route tests stub
// hasPermission to true, which is why they could never see this). Each refusal is paired with the
// allowed path, and every refusal also proves the card table is unchanged.
//
// Run (from cloudflare/): node scripts/test-promotions-strip-write-gate-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const base = openDb(loadAll())
const routeDb = {
  prepare(sql) {
    const stmt = base.prepare(sql)
    return {
      get: async (params) => stmt.get(params),
      all: async (params) => stmt.all(params) ?? [],
      run: async (params) => {
        const info = stmt.run(params)
        return { changes: info.meta.changes, lastInsertRowid: Number(info.meta.last_row_id) }
      },
    }
  },
  async batch(items) { return base.batch(items) },
}
const state = { user: null }
const overrides = {
  '../lib/db': { getDb: () => routeDb },
  './db': { getDb: () => routeDb },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); return next() } },
  '../lib/cache': { bumpVersion: async () => {} },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../index': {},
}
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(SRC, rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}
const app = load('routes/promotions.ts').default
const ctx = { waitUntil() {}, passThroughOnException() {} }

// The role rows. EMPLOYEE_AFTER_5 is the one-row update proposed in MERGEPERM-REPORT section 5
// (Products Full, every other Products action off, no Website Editor grant); MANAGER_LIVE is the
// production Manager row read on 6 Oct 2026; the seed is read from the source, not copied.
const coreSource = fs.readFileSync(path.join(SRC, 'lib/coreDataInvariants.ts'), 'utf8').split('\r\n').join('\n')
const seedStart = coreSource.indexOf('const DEFAULT_ROLE_PERMISSIONS')
const seedOpen = coreSource.indexOf('= {', seedStart) + 2
const SEED = new Function('return ' + coreSource.slice(seedOpen, coreSource.indexOf('\n}\n', seedOpen) + 2))()
const EMPLOYEE_AFTER_5 = {
  pos: true, contacts: 'review', returns: true, fees: 'review', sales: true, products: true,
  'products:add': false, 'products:delete': false, 'products:bulk_delete': false, 'products:variant': false,
  'products:import': false, 'products:import_replace_all': false, 'products:export': false,
  'products:merge_duplicates': false, 'products:zero_qty_cleanup': false, 'products:manage_lookups': false,
  'products:price': false, 'products:history': false, product_cost_view: false, product_cost_edit: false,
  'sales:export': false, 'sales:import': false, 'sales:bulk': false, 'returns:bulk': false, 'returns:export': false, receipt_settings: true,
}
const MANAGER_LIVE = { pos: true, products: true, inventory: true, sales: true, contacts: true, customer_portal: true, audit_log: true, returns: true, receipt_settings: true }
const as = (role, rolePermissions, own = {}) => ({ id: 31, username: role, name: role, role_code: role, role_permissions: JSON.stringify(rolePermissions), permissions: JSON.stringify(own) })
const USERS = {
  allowed: {
    'admin': as('admin', { all: true }),
    'live Manager (customer_portal)': as('manager', MANAGER_LIVE),
    'Employee + portal_posts (posts & promos)': as('employee', EMPLOYEE_AFTER_5, { portal_posts: true }),
    'Employee + customer_portal (portal config)': as('employee', EMPLOYEE_AFTER_5, { customer_portal: true }),
    'Employee + full Settings': as('employee', EMPLOYEE_AFTER_5, { settings: true }),
  },
  refused: {
    'Employee after the section 5 update': as('employee', EMPLOYEE_AFTER_5),
    'seeded Employee': as('employee', SEED.employee),
    'Manager-like role without any Website Editor grant': as('manager', { products: true, inventory: true }),
    'Employee + only the FAQ grant': as('employee', EMPLOYEE_AFTER_5, { portal_faq: true }),
    'Employee + only the About grant': as('employee', EMPLOYEE_AFTER_5, { portal_about: true }),
  },
}

let seq = 0
const rid = () => `gate_${String(++seq).padStart(6, '0')}_abcdefgh`
async function send(user, method, url, body) {
  state.user = user
  const res = await app.request(url, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
  }, {}, ctx)
  return { status: res.status, body: await res.json().catch(() => null) }
}
const cards = () => JSON.stringify(base.prepare('SELECT * FROM promotions ORDER BY id').all())
function seedCards() {
  base.exec('DELETE FROM promotions; DELETE FROM audit_logs;')
  base.prepare("INSERT INTO promotions (title, link_type, is_active, sort_order, updated_at) VALUES ('One', 'none', 1, 0, '2026-10-01 00:00:00')").run()
  base.prepare("INSERT INTO promotions (title, link_type, is_active, sort_order, updated_at) VALUES ('Two', 'none', 1, 1, '2026-10-01 00:00:00')").run()
  return base.prepare('SELECT id, updated_at FROM promotions ORDER BY id').all()
}
const fresh = (id) => base.prepare('SELECT id, updated_at FROM promotions WHERE id = ?').get([id])
const WRITES = (rows) => [
  ['POST /', () => ['POST', '/', { title: 'Visit evil', link_type: 'url', link_url: 'https://evil.example', is_active: 1, client_request_id: rid() }]],
  ['PUT /:id', () => ['PUT', `/${rows[0].id}`, { title: 'Renamed', link_type: 'none', is_active: 1, client_request_id: rid(), expected_updated_at: fresh(rows[0].id).updated_at }]],
  ['PUT /reorder/all', () => ['PUT', '/reorder/all', { order: [rows[1].id, rows[0].id], client_request_id: rid() }]],
  ['DELETE /:id', () => ['DELETE', `/${rows[0].id}`, { client_request_id: rid(), expected_updated_at: fresh(rows[0].id).updated_at }]],
]

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  await check('the live shapes are what the report says (Employee has Products, no Website Editor grant)', async () => {
    assert.equal(EMPLOYEE_AFTER_5.products, true)
    for (const key of ['portal_posts', 'customer_portal', 'settings']) assert.equal(key in EMPLOYEE_AFTER_5, false, key)
    assert.equal(SEED.employee.customer_portal, undefined)
  })

  for (const [label, user] of Object.entries(USERS.refused)) {
    await check(`REFUSED ${label}: all four card writes are 403 and the cards are untouched`, async () => {
      const rows = seedCards()
      const before = cards()
      for (const [name, make] of WRITES(rows)) {
        const [method, url, body] = make()
        const res = await send(user, method, url, body)
        assert.equal(res.status, 403, `${name}: ${JSON.stringify(res.body)}`)
        assert.equal(cards(), before, `${name} changed a card`)
      }
      assert.equal(base.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE entity = 'promotion'").get().n, 0)
    })
  }

  for (const [label, user] of Object.entries(USERS.allowed)) {
    await check(`ALLOWED ${label}: create, edit, reorder and delete all succeed`, async () => {
      const rows = seedCards()
      for (const [name, make] of WRITES(rows)) {
        const [method, url, body] = make()
        const res = await send(user, method, url, body)
        assert.equal(res.status, 200, `${name}: ${JSON.stringify(res.body)}`)
      }
    })
  }

  await check('reads keep the products gate: the Employee (Products) can list the cards, a role without Products cannot', async () => {
    seedCards()
    assert.equal((await send(as('employee', EMPLOYEE_AFTER_5), 'GET', '/')).status, 200)
    assert.equal((await send(as('manager', { customer_portal: true }), 'GET', '/')).status, 403)
  })

  console.log(`${passed} checks passed`)
}
main().catch((error) => { console.error(error); process.exit(1) })
