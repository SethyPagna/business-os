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
const passThroughEdgeCache = {
  cachedJsonResponse: async (_request, _ctx, _version, _ttl, producer) => producer(),
  getVersionWithFallback: async () => '0',
  bumpVersion: async () => {},
  bumpVersions: async () => {},
}
const isContactsRouter = filename => path.basename(filename) === 'contacts.ts' && path.basename(path.dirname(filename)) === 'routes'
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
    if (name === '../lib/db' || name === './db') return {
      getDb: () => { opens++; return db },
      getImportFencedDb: async () => { opens++; return db },
    }
    if (name === '../lib/cache' && isContactsRouter(filename)) return passThroughEdgeCache
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}
const permissions = load(path.join(root, 'lib/permissions.ts'))
const frontendRoot = path.join(__dirname, '..', '..', 'frontend', 'src')
const frontendCache = new Map()
function loadFrontend(filename) {
  if (frontendCache.has(filename)) return frontendCache.get(filename).exports
  const mod = { exports: {} }
  frontendCache.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  new Function('require', 'module', 'exports', output)(name => (name === 'react' ? {} : loadFrontend(path.resolve(path.dirname(filename), name))), mod, mod.exports)
  return mod.exports
}
const { effectivePermissions } = loadFrontend(path.join(frontendRoot, 'utils/permissions.ts'))
const { getHubDestinations } = loadFrontend(path.join(frontendRoot, 'components/shared/hubNavigation.ts'))
const showsSuppliersTab = session => getHubDestinations('contacts', effectivePermissions(session)).some(destination => destination.id === 'suppliers')
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
app.route('/api', load(path.join(root, 'routes/contacts.ts')).default)
app.route('/api', load(path.join(root, 'routes/compat.ts')).default)
const staff = (role = {}, overrides = {}) => ({
  id: 17, name: 'Employee', username: 'employee', role_code: 'employee',
  role_permissions: JSON.stringify(role), permissions: JSON.stringify(overrides),
})
async function request(url, session, options = {}, fixture) {
  user = session
  opens = reads = 0
  db = fixture || { prepare() { reads++; throw new Tripwire('Data access reached') } }
  const response = await app.request(`http://local.test/api${url}`, options, {}, { waitUntil() {}, passThroughOnException() {} })
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
  // Contacts "View and search" off hides the whole directory and every
  // supplier ledger; the till and Sales pickers keep their own grants.
  const directoryReads = [
    '/customers', '/customers?page=1&pageSize=20', '/customers?ids=1', '/customers?fields=picker', '/customers?fields=names',
    '/suppliers?page=1', '/suppliers?fields=picker', '/delivery-contacts', '/delivery-contacts?fields=picker', '/delivery-contacts?fields=names',
    ...['customers', 'suppliers', 'delivery-contacts'].flatMap(prefix => [
      `/${prefix}/1/rename-impact?to=Renamed`, `/${prefix}/check-duplicate?name=Dara`, `/${prefix}/duplicates`, `/${prefix}/bulk-delete-jobs/job-1`,
    ]),
    '/suppliers/1/purchases', '/suppliers/reports/stock-in-invoices', '/suppliers/reports/stock-in-invoice-lines?supplier_key=none&day=none',
    '/suppliers/reports/ap-invoices', '/customers/reports/ar-invoices', '/customers/link-conflicts', '/customers/points-summary',
  ]
  const financialHistoryNeedsFullTier = '/customers/reports/ar-invoices'
  const contactsRole = tier => ({ contacts: tier, contacts_suppliers: true })
  const contactsAdmin = { ...staff({}, { 'contacts:view': false }), role_code: 'admin' }
  for (const url of directoryReads) {
    for (const tier of [true, 'review']) {
      const viewOff = staff(contactsRole(tier), { 'contacts:view': false })
      await denied(url, viewOff)
      await denied(url, viewOff, 'HEAD')
      if (tier === 'review' && url === financialHistoryNeedsFullTier) continue
      await reachesData(url, staff(contactsRole(tier)))
      await reachesData(url, staff({ ...contactsRole(tier), 'contacts:view': false }, { 'contacts:view': true }))
    }
    await reachesData(url, contactsAdmin)
  }
  const salesPicker = '/customers?fields=sales_picker&search=Dara'
  const membership = '/customers/membership/M-1'
  for (const role of [{ pos: true, contacts: 'review' }, { sales: 'view', contacts: 'review' }, { pos: true }]) {
    await reachesData(salesPicker, staff(role, { 'contacts:view': false }))
  }
  await reachesData(membership, staff({ pos: true, contacts: 'review' }, { 'contacts:view': false }))
  await denied(salesPicker, staff(contactsRole(true), { 'contacts:view': false }))
  await denied(membership, staff(contactsRole(true), { 'contacts:view': false }))
  // Supplier names (id + name) feed the product form and supplier returns.
  for (const role of [contactsRole(true), { contacts: 'review' }]) {
    await reachesData('/suppliers?fields=names', staff(role, { 'contacts:view': false }))
  }
  await denied('/suppliers?fields=names', staff({ products: true }))
  const emptyContact = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }
  for (const prefix of ['/customers', '/suppliers', '/delivery-contacts']) {
    const response = await request(prefix, staff(contactsRole(true), { 'contacts:view': false }), emptyContact)
    assert.equal(response.status, 400, `POST ${prefix} keeps its own add gate when view is off`)
    assert.equal(reads, 0)
    const blocked = await request(prefix, staff(contactsRole(true), { 'contacts:view': false, 'contacts:add': false }), emptyContact)
    assert.equal(blocked.status, 403)
    assert.equal(reads, 0)
  }
  // The Suppliers tab hosts the stock-in report: the screen offers it exactly when the Worker serves it.
  const stockInReport = '/suppliers/reports/stock-in-invoices'
  const suppliersRole = { contacts: true, contacts_suppliers: true }
  const parity = { shown: 0, hidden: 0 }
  for (const session of [
    staff(suppliersRole),
    staff({ ...suppliersRole, contacts: 'review' }),
    staff({ ...suppliersRole, 'contacts:view': false }, { 'contacts:view': true }),
    { ...staff({}, { 'contacts:view': false }), role_code: 'admin' },
    staff({ all: true }, { 'contacts:view': false }),
    staff(suppliersRole, { 'contacts:view': false }),
    staff({ ...suppliersRole, contacts: 'review' }, { 'contacts:view': false }),
    staff({ ...suppliersRole, pos: true, contacts: 'review' }, { 'contacts:view': false }),
    staff({ contacts: true }),
    staff({ contacts_suppliers: true }),
    staff(suppliersRole, { contacts: false }),
    staff(suppliersRole, { contacts_suppliers: false }),
  ]) {
    const shown = showsSuppliersTab(session)
    const response = await request(stockInReport, session)
    parity[shown ? 'shown' : 'hidden']++
    assert.equal(reads > 0, shown, `stock-in report for role ${session.role_permissions} + ${session.permissions}: screen ${shown ? 'shows' : 'hides'} it, Worker answered ${response.status}`)
  }
  assert.deepEqual(parity, { shown: 5, hidden: 7 })
  assert.equal((await request('/returns', null)).status, 401)
  console.log(`PASS ${checks} real Hono requests: effective read denials, admin matrix, alternate grants, domain isolation and independent writes`)
})().catch(error => { console.error(error); process.exitCode = 1 })
