// The stock-in invoice report must keep naming a retired branch (SCAN2 BP-2).
//
// Once Shop is retired (is_active = 0), its past receipts still exist. The
// group rows carry only branch ids, so the report's branch list is the only
// label source: an active-only list made every Shop group read "#2" while the
// line detail (LEFT JOIN branches, no filter) still said "Shop", and the
// branch filter lost its Shop option. A retired branch nobody received into
// stays out of the filter.
//
// Drives the REAL routes/contacts.ts over a migrated in-memory database.
//
// Run (from cloudflare/): node scripts/test-stock-in-report-retired-branch-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC_DIR = path.join(__dirname, '..', 'src')
const raw = openDb(loadAll())
const db = {
  prepare(sql) {
    const statement = raw.prepare(sql)
    return {
      get: async (params) => statement.get(params) ?? null,
      all: async (params) => statement.all(params) ?? [],
      run: async (params) => statement.run(params),
    }
  },
}
const owner = {
  id: 1, username: 'owner', name: 'Owner', role_code: 'admin',
  role_permissions: '{}', permissions: '{}',
}
const seams = {
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', owner); return next() } },
  '../lib/db': { getDb: () => db, getImportFencedDb: async () => db },
  './db': { getDb: () => db, getImportFencedDb: async () => db },
  '../lib/cache': {
    cachedJsonResponse: async (_request, _ctx, _version, _ttl, producer) => producer(),
    getVersionWithFallback: async () => '0',
    bumpVersion: async () => {},
    bumpVersions: async () => {},
  },
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
}
const modules = new Map()
function load(filename) {
  if (modules.has(filename)) return modules.get(filename).exports
  const mod = { exports: {} }
  modules.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  new Function('require', 'module', 'exports', output)((name) => {
    if (Object.prototype.hasOwnProperty.call(seams, name)) return seams[name]
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const contacts = load(path.join(SRC_DIR, 'routes', 'contacts.ts')).default
const executionCtx = { waitUntil() {}, passThroughOnException() {} }
async function get(url) {
  const response = await contacts.request(`http://local.test${url}`, { method: 'GET' }, {}, executionCtx)
  assert.equal(response.status, 200, `GET ${url} answered ${response.status}`)
  return response.json()
}

raw.exec(`
  DELETE FROM branches;
  INSERT INTO branches (id, name, is_active) VALUES
    (1, 'Store', 1), (2, 'Shop', 0), (3, 'Old kiosk', 0), (4, 'Pop-up', 1);
  INSERT INTO products (id, name, barcode, is_active) VALUES (101, 'Serum', 'S1', 1);
  INSERT INTO suppliers (id, name) VALUES (7, 'Srey Now');
  INSERT INTO product_batches (id, variant_product_id, batch_key, received_at, is_active, supplier_id, supplier_name,
    unit_cost_usd, payment_status, received_quantity, received_branch_id, received_cost_usd) VALUES
    (1, 101, 'K1', '2026-08-20', 1, 7, 'Srey Now', 2.5, 'paid', 10, 2, 25),
    (2, 101, 'K2', '2026-09-20', 1, 7, 'Srey Now', 2.5, 'paid', 4, 1, 10);
`)

let passed = 0
function pass(label) { passed += 1; console.log(`PASS ${label}`) }

;(async () => {
  const report = await get('/suppliers/reports/stock-in-invoices')
  const branches = report.meta.branches
  const byId = new Map(branches.map((branch) => [Number(branch.id), branch]))

  assert.equal(byId.get(2)?.name, 'Shop', 'a retired branch with receipts keeps its name in the report branch list')
  assert.equal(Number(byId.get(2)?.is_active), 0, 'the retired branch is marked inactive so the filter can say so')
  pass('retired branch with receipts is listed, marked inactive')

  for (const [id, name] of [[1, 'Store'], [4, 'Pop-up']]) {
    assert.equal(byId.get(id)?.name, name, `active branch ${name} stays listed even with no receipts`)
    assert.equal(Number(byId.get(id)?.is_active), 1)
  }
  pass('every active branch stays listed')

  assert.equal(byId.has(3), false, 'a retired branch nobody received into is not offered')
  pass('retired branch without receipts is left out')

  assert.deepEqual(branches.map((branch) => Number(branch.id)), [1, 2, 4], 'branches keep id order')
  pass('branch list keeps id order')

  const shopGroup = report.invoices.find((group) => group.received_day === '2026-08-20')
  assert.ok(shopGroup, 'the Shop receipt is an invoice group')
  const groupLabels = String(shopGroup.branch_ids).split(',').map((id) => byId.get(Number(id))?.name)
  const lines = await get(`/suppliers/reports/stock-in-invoice-lines?supplier_key=${encodeURIComponent(shopGroup.supplier_key)}&day=2026-08-20`)
  assert.deepEqual(groupLabels, [lines.lines[0].received_branch_name], 'the group header and its line detail name the same branch')
  assert.deepEqual(groupLabels, ['Shop'])
  pass('group header label matches the line detail ("Shop", not "#2")')

  const filtered = await get('/suppliers/reports/stock-in-invoices?branch_id=2')
  assert.deepEqual(filtered.invoices.map((group) => group.received_day), ['2026-08-20'], 'the Shop filter still finds past Shop receipts')
  pass('filtering by the retired branch finds its receipts')

  console.log(`\n${passed} checks passed`)
})().catch((error) => { console.error(error); process.exitCode = 1 })
