// Execute the real Hono routers and permission helpers with a database
// tripwire. Authentication supplies an already authenticated session fixture;
// all other local dependencies load from the production TypeScript source.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { Hono } = require('hono')
const root = path.join(__dirname, '..', 'src')
const cache = new Map()
let user, db, opens, reads, checks = 0
class Tripwire extends Error {}
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }
  cache.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  new Function('require', 'module', 'exports', output)(name => {
    if (name === '../lib/auth') return { requireAuth: async (c, next) => {
      if (!user) return c.json({ error: 'Unauthenticated' }, 401)
      c.set('user', user)
      return next()
    } }
    if (name === '../lib/db' || name === './db') return { getDb: () => { opens++; return db } }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const permissions = load(path.join(root, 'lib/permissions.ts'))
const app = new Hono()
app.onError((error, c) => {
  if (error instanceof Tripwire) return c.json({ tripwire: true }, 598)
  throw error
})
// routes/sales.ts mounts before compat, matching index.ts.
for (const name of ['returns', 'fees', 'reports', 'batches', 'sales']) {
  app.route(`/api/${name}`, load(path.join(root, `routes/${name}.ts`)).default)
}
// Match production mount order: import authority belongs to importJobs.
app.route('/api/import-jobs', load(path.join(root, 'routes/importJobs.ts')).default)
app.route('/api', load(path.join(root, 'routes/compat.ts')).default)
const staff = (role = {}, overrides = {}) => ({
  id: 17, name: 'Employee', username: 'employee', role_code: 'employee',
  role_permissions: JSON.stringify(role), permissions: JSON.stringify(overrides),
})
async function request(url, session, options = {}, fixture) {
  user = session
  opens = reads = 0
  db = fixture || { prepare() { reads++; throw new Tripwire('Data access reached') } }
  // The KV cache-version read is data access too (sales list/stats read it
  // before D1), so it trips the same wire and counts against a denial.
  const env = { CACHE: { get() { reads++; throw new Tripwire('KV reached') } } }
  const response = await app.request(`http://local.test/api${url}`, options, env)
  checks++
  return response
}
async function denied(url, session, method = 'GET') {
  const response = await request(url, session, { method })
  assert.equal(response.status, 403, `${method} ${url} must deny`)
  assert.equal(opens, 0, `${method} ${url} must deny before opening the database`)
  assert.equal(reads, 0, `${method} ${url} must deny before querying`)
}
async function reachesData(url, session, method = 'GET') {
  const response = await request(url, session, { method })
  assert.notEqual(response.status, 403, `${method} ${url} must retain its grant`)
  assert.ok(reads > 0, `${method} ${url} must reach the real read handler, status ${response.status}`)
}
const domains = {
  returns: ['/returns', '/returns/1', '/returns/report', '/returns/damaged-lots?product_id=1', '/returns/receipt-lookup?query=123', '/returns/reason-presets', '/returns/reasons/impact?from=old&to=new', '/reports/business-summary/returns'],
  fees: ['/fees', '/fees/1', '/fees/report', '/fees/labels', '/fees/labels/impact?from=old&to=new', '/fees/labels/type-impact?label=old', '/reports/business-summary/expenses'],
  sales: ['/reports/periods', '/reports/grouped?by=customer', '/reports/grouped?by=product', '/reports/grouped?by=courier', '/reports/business-summary/sales',
    // routes/sales.ts reads share the reports rule: an explicit sales:view false
    // hides the sale list, aggregates, drills, per-sale trails and the export.
    '/sales', '/sales/stats', '/sales/stats-strip?startDate=2026-10-01&endDate=2026-10-01', '/sales/daily-report', '/sales/day-report?date=2026-10-01',
    '/sales/1/records', '/sales/1/amendments', '/sales/export'],
}
const batchUrls = ['/batches/tracked-product-ids', '/batches?productId=1&branchId=1', '/batches/damaged-lots?productId=1']
;(async () => {
  for (const malformed of ['true', 'false', 'review', 'view', 1, {}, [], null, false]) {
    const session = staff({ all: malformed })
    assert.equal(permissions.isAdminControlUser(session), false)
    assert.equal(permissions.getActionTier(session, 'returns', 'view'), 'none')
    for (const urls of Object.values(domains)) for (const url of urls) await denied(url, session)
    for (const url of [...batchUrls, '/transfers', '/system/audit-logs', '/reports/overview']) await denied(url, session)
  }
  assert.deepEqual(permissions.parseJsonObject('[true]'), {})
  for (const raw of ['{broken', 'null', '[true]', 'true', '1']) {
    await denied('/returns', { ...staff(), permissions: raw, role_permissions: raw })
  }
  assert.equal(permissions.isAdminControlUser(staff({ all: true }, { all: false })), false)
  for (const [section, urls] of Object.entries(domains)) {
    const tiers = section === 'sales' ? [true, 'view'] : [true, 'review']
    for (const tier of tiers) for (const url of urls) {
      await reachesData(url, staff({ [section]: tier }))
      await denied(url, staff({ [section]: tier }, { [`${section}:view`]: false }))
      await denied(url, staff({ [section]: tier }, { [`${section}:view`]: false }), 'HEAD')
      // Explicit user true can restore a role-level action revocation.
      await reachesData(url, staff({ [section]: tier, [`${section}:view`]: false }, { [`${section}:view`]: true }))
    }
    await denied('/reports/overview', staff({ [section]: true }, { [`${section}:view`]: false }))
  }
  const revoked = { 'returns:view': false, 'fees:view': false, 'sales:view': false, 'inventory:view': false, 'branches:view': false, 'audit_log:view': false }
  // The username alone no longer grants administrator control (FX-sec).
  assert.equal(permissions.isAdminControlUser({ ...staff({}, revoked), username: ' ADMIN ' }), false)
  for (const admin of [
    { ...staff({}, revoked), role_code: ' AdMiN ' },
    staff({ all: true }, revoked),
  ]) {
    assert.equal(permissions.isAdminControlUser(admin), true)
    for (const urls of Object.values(domains)) for (const url of urls) await reachesData(url, admin)
    await reachesData('/transfers', admin)
    await reachesData('/system/audit-logs', admin)
    await reachesData('/batches/tracked-product-ids', admin)
  }
  for (const url of batchUrls) {
    for (const section of ['inventory', 'sales']) {
      await denied(url, staff({ [section]: true }, { [`${section}:view`]: false }))
      await denied(url, staff({ [section]: true }, { [`${section}:view`]: false }), 'HEAD')
      await reachesData(url, staff({ [section]: true }))
      await reachesData(url, staff({ [section]: true }), 'HEAD')
    }
    for (const alternate of ['pos', 'products_image_only_show_batches']) {
      await reachesData(url, staff({ inventory: true, sales: true, [alternate]: true }, revoked))
    }
    await denied(url, staff({ all: 'true' }))
  }
  // A revoked inventory/sales grant must not unblind the image-only response.
  const batchFixture = { prepare(sql) { return {
    all: async () => [{ id: 1, unit_cost_usd: 25, payment_status: 'credit', credit_due_date: '2026-10-01', quantity: 2 }],
    get: async () => ({ quantity: 2 }),
  } } }
  const batchResponse = await request('/batches?productId=1&branchId=1', staff({ inventory: true, sales: true, products_image_only_show_batches: true }, revoked), {}, batchFixture)
  assert.equal(batchResponse.status, 200)
  const batch = (await batchResponse.json()).batches[0]
  for (const key of ['unit_cost_usd', 'payment_status', 'credit_due_date']) assert.equal(key in batch, false)
  for (const section of ['inventory', 'branches']) for (const tier of [true, 'review']) {
    await denied('/transfers', staff({ [section]: tier }, { [`${section}:view`]: false }))
    await denied('/transfers', staff({ [section]: tier }, { [`${section}:view`]: false }), 'HEAD')
    await reachesData('/transfers', staff({ [section]: tier }))
    const other = section === 'inventory' ? 'branches' : 'inventory'
    await reachesData('/transfers', staff({ [section]: tier, [other]: 'review' }, { [`${section}:view`]: false }))
  }
  for (const tier of [true, 'view']) {
    await denied('/system/audit-logs', staff({ audit_log: tier }, { 'audit_log:view': false }))
    await denied('/system/audit-logs', staff({ audit_log: tier }, { 'audit_log:view': false }), 'HEAD')
    await reachesData('/system/audit-logs', staff({ audit_log: tier }))
  }
  // Overview must return only the independently readable domains. Query
  // tripwires reject any attempt to fetch a revoked domain before serialization.
  for (const [section, key, table] of [['returns', 'returns', 'returns'], ['fees', 'expenses', 'fees']]) {
    const sqls = []
    const fixture = { prepare(sql) {
      sqls.push(sql)
      assert.match(sql, new RegExp(`FROM ${table}\\b`))
      return { get: async () => ({}), all: async () => [] }
    } }
    const response = await request('/reports/overview', staff({ returns: true, fees: true, sales: true }, { ...revoked, [`${section}:view`]: true }), {}, fixture)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.ok(payload[key])
    for (const hidden of ['sales', 'returns', 'expenses'].filter(value => value !== key)) assert.equal(hidden in payload, false)
    assert.ok(sqls.length > 0)
  }
  // routes/sales.ts reads end to end over empty books: Full and View grants get
  // a real 200 body, while an explicit sales:view false (user override on a
  // Full or View role, or set on the role itself) and no grant get 403 before
  // any KV or D1 read. canReadSales once read only the section tier, which let
  // every view-revoked principal below through with a 200.
  {
    const salesReads = ['/sales', '/sales/stats', '/sales/stats-strip?startDate=2026-10-01&endDate=2026-10-01', '/sales/daily-report',
      '/sales/day-report?date=2026-10-01', '/sales/1/records', '/sales/1/amendments', '/sales/export']
    const saleRow = { id: 1, receipt_number: 'R1', sale_status: 'completed', total_usd: 0, created_at: '2026-10-01 00:00:00', updated_at: '2026-10-01 00:00:00' }
    const emptyBooks = { prepare(sql) {
      reads++
      return { get: async () => (/FROM sales WHERE id = \?/.test(sql) ? { ...saleRow } : null), all: async () => [], run: async () => ({}) }
    }, batch: async statements => statements.map(() => ({ results: [] })) }
    const previousCaches = globalThis.caches
    globalThis.caches = { default: { match: async () => undefined, put: async () => {} } }
    const ctx = { waitUntil() {}, passThroughOnException() {} }
    const salesRequest = async (url, session) => {
      user = session
      opens = reads = 0
      db = emptyBooks
      const env = { CACHE: { get: async () => { reads++; return null }, put: async () => {} } }
      const response = await app.request(`http://local.test/api${url}`, {}, env, ctx)
      checks++
      return response
    }
    try {
      for (const url of salesReads) {
        for (const tier of [true, 'view']) {
          const response = await salesRequest(url, staff({ sales: tier }))
          assert.equal(response.status, 200, `GET ${url} must serve sales ${tier} with 200, got ${response.status}`)
          assert.ok(reads > 0, `GET ${url} must reach the real read handler`)
          await response.json()
        }
        for (const session of [
          staff({ sales: true }, { 'sales:view': false }),
          staff({ sales: 'view' }, { 'sales:view': false }),
          staff({ sales: true, 'sales:view': false }),
          staff({}),
        ]) {
          const response = await salesRequest(url, session)
          assert.equal(response.status, 403, `GET ${url} must refuse ${session.role_permissions} + ${session.permissions}, got ${response.status}`)
          assert.equal(opens + reads, 0, `GET ${url} must refuse before any KV or D1 read`)
        }
      }
    } finally {
      if (previousCaches === undefined) delete globalThis.caches
      else globalThis.caches = previousCaches
    }
  }
  // GET revocation must leave create/adjust independently action-gated. Empty
  // payloads reach the real write validator, and never write to a database.
  for (const [section, url, action] of [['returns', '/returns', 'add'], ['fees', '/fees', 'add'], ['inventory', '/batches', 'adjust']]) {
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
    const response = await request(url, staff({ [section]: true }, { [`${section}:view`]: false }), options)
    assert.equal(response.status, section === 'returns' ? 403 : 400,
      `${url} must retain its effective view/write gate ordering`)
    assert.equal(reads, 0)
    const blocked = await request(url, staff({ [section]: true }, { [`${section}:view`]: false, [`${section}:${action}`]: false }), options)
    assert.equal(blocked.status, 403)
    assert.equal(reads, 0)
  }
  // Compat Dashboard has its own independent authority; section revocations
  // must not turn it into a Sales/Inventory page gate.
  await reachesData('/dashboard', staff({ dashboard: true }, revoked))
  await reachesData('/import-jobs', staff({ products: true, product_cost_view: true }, { 'products:view': false }))
  reads = 0
  const hiddenImports = await request('/import-jobs', staff({ products: true }, { 'products:view': false }))
  assert.equal(hiddenImports.status, 200)
  assert.equal(reads, 0, 'financial imports without explicit cost-view grant are not read')
  await reachesData('/system/drive-sync/status', staff({ settings: true }, { 'settings:view': false }))
  assert.equal((await request('/returns', null)).status, 401)
  console.log(`PASS ${checks} real Hono requests: effective read denials, admin matrix, alternate grants, domain isolation and independent writes`)
})().catch(error => { console.error(error); process.exitCode = 1 })
