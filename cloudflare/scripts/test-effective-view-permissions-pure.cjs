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
for (const name of ['returns', 'fees', 'reports', 'batches']) {
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
  const response = await app.request(`http://local.test/api${url}`, options, {})
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
  sales: ['/reports/periods', '/reports/grouped?by=customer', '/reports/grouped?by=product', '/reports/grouped?by=courier', '/reports/business-summary/sales'],
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
  for (const admin of [
    { ...staff({}, revoked), username: ' ADMIN ' },
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
  // GET revocation must leave create/adjust independently action-gated. Empty
  // payloads reach the real write validator, and never write to a database.
  for (const [section, url, action] of [['returns', '/returns', 'add'], ['fees', '/fees', 'add'], ['inventory', '/batches', 'adjust']]) {
    const options = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
    const response = await request(url, staff({ [section]: true }, { [`${section}:view`]: false }), options)
    assert.equal(response.status, 400, `${url} must reach write validation`)
    assert.equal(reads, 0)
    const blocked = await request(url, staff({ [section]: true }, { [`${section}:view`]: false, [`${section}:${action}`]: false }), options)
    assert.equal(blocked.status, 403)
    assert.equal(reads, 0)
  }
  // Compat Dashboard has its own independent authority; section revocations
  // must not turn it into a Sales/Inventory page gate.
  await reachesData('/dashboard', staff({ dashboard: true }, revoked))
  await reachesData('/import-jobs', staff({ products: true }, { 'products:view': false }))
  await reachesData('/system/drive-sync/status', staff({ settings: true }, { 'settings:view': false }))
  assert.equal((await request('/returns', null)).status, 401)
  console.log(`PASS ${checks} real Hono requests: effective read denials, admin matrix, alternate grants, domain isolation and independent writes`)
})().catch(error => { console.error(error); process.exitCode = 1 })
