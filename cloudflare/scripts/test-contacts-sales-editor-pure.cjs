// CONTACTS-PERM (30 Sep 2026). Owner: Add and Edit imply View for contacts, and an
// employee whose role has customer Add/Edit may pick, add and edit customers from
// the POS and sales flow -- with a record on the sale's records plus the audit log.
//
// This drives the REAL routes/contacts.ts over the migrated schema. Roles are
// built so the right implementation and the plausible wrong ones disagree:
//   addOnly / editOnly   -- View switched OFF but one write left on (implication)
//   noWrites             -- View, Add and Edit all OFF (must stay refused)
//   employee             -- the shipped Employee preset shape (contacts: review)
//   noContacts           -- POS and Sales but no Contacts key (must stay refused)
// Wrong implementations this kills: view read only from its own switch; the sales
// widening applied without a source, without the POS/Sales grant, to suppliers, to
// membership_number/created_at, or to a sale that is not the customer's; a sale
// record written outside the update batch; a role without Add/Edit slipping through.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const src = path.join(__dirname, '..', 'src')
const cache = new Map()
let db
let actor
const waiting = []

function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports
  const mod = { exports: {} }
  cache.set(filename, mod)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  new Function('require', 'module', 'exports', output)((name) => {
    if (name === '../lib/auth') return { requireAuth: async (c, next) => { c.set('user', actor); return next() } }
    if (name === '../lib/db' || name === './db') return { getDb: () => db }
    if (name === '../lib/cache') return { bumpVersion: async () => {}, bumpVersions: async () => {}, getVersionWithFallback: async () => '1', cachedJsonResponse: async (_r, _c, _v, _t, run) => run() }
    if (name === '../durable-objects/broadcastHub') return { broadcast: async () => {} }
    if (name === '../lib/importMaintenanceFence') return { getImportFencedDb: async () => db, isImportMaintenanceFenceError: () => false }
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), `${name}.ts`))
    return require(name)
  }, mod, mod.exports)
  return mod.exports
}

const permissions = load(path.join(src, 'lib/permissions.ts'))
const contacts = load(path.join(src, 'routes/contacts.ts')).default
const executionCtx = { waitUntil(p) { waiting.push(p) }, passThroughOnException() {} }

const staff = (id, role, overrides = {}) => ({
  id, name: `Staff ${id}`, username: `staff${id}`, role_code: 'employee',
  role_permissions: JSON.stringify(role), permissions: JSON.stringify(overrides),
})
const SALES = { pos: true, sales: true }
const ROLES = {
  employee: staff(11, { ...SALES, contacts: 'review', 'contacts:bulk': false, contacts_suppliers: false }),
  addOnly: staff(12, { ...SALES, contacts: true, 'contacts:view': false, 'contacts:edit': false }),
  editOnly: staff(13, { ...SALES, contacts: true, 'contacts:view': false, 'contacts:add': false }),
  noWrites: staff(14, { ...SALES, contacts: true, 'contacts:view': false, 'contacts:add': false, 'contacts:edit': false }),
  noContacts: staff(15, { ...SALES }),
  contactsNoPos: staff(16, { contacts: 'review' }),
  salesViewTier: staff(17, { pos: true, sales: 'view', contacts: 'review' }),
  admin: { id: 1, name: 'Owner', username: 'owner', role_code: 'admin', role_permissions: '{}', permissions: '{}' },
}

function freshDb() {
  const fresh = openDb(loadAll())
  fresh.prepare("INSERT INTO users (id, username, name, password) VALUES (1,'owner','Owner','x'),(11,'staff11','Staff 11','x'),(12,'staff12','Staff 12','x'),(13,'staff13','Staff 13','x')").run()
  fresh.prepare("INSERT INTO customers (id, name, phone, email, address, notes, gender, membership_number, is_anonymous, created_at) VALUES (5,'Dara','012 345 678','d' || char(64) || 'old.test','Old street','old note','Female','LC-5',0,'2025-01-01 00:00:00'),(6,'Sokha','098 765 432',NULL,NULL,NULL,NULL,'LC-6',0,'2025-02-02 00:00:00')").run()
  fresh.prepare("INSERT INTO suppliers (id, name, phone) VALUES (1,'Acme','011 111 111')").run()
  fresh.prepare("INSERT INTO sales (id, receipt_number, customer_id, customer_name, total_usd, total_khr) VALUES (21,'R-21',5,'Dara',3,12000),(22,'R-22',6,'Sokha',4,16000)").run()
  return fresh
}

async function call(method, url, session, body) {
  actor = session
  waiting.length = 0
  const response = await contacts.request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, {}, executionCtx)
  await Promise.all(waiting)
  const text = await response.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch (_) { json = text }
  return { status: response.status, body: json }
}
const customer = (id = 5) => db.prepare('SELECT * FROM customers WHERE id = @id').get({ id })
const saleEvents = (saleId) => db.prepare('SELECT * FROM sale_record_events WHERE sale_id = @saleId ORDER BY occurred_at, id').all({ saleId })
const auditRows = (entity, id) => db.prepare('SELECT * FROM audit_logs WHERE entity = @entity AND CAST(entity_id AS REAL) = CAST(@id AS REAL) ORDER BY id').all({ entity, id: String(id) })

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    db = freshDb()
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

;(async () => {
  await test('helper: Add or Edit implies View; only all three off removes it (admin control unchanged)', async () => {
    const tier = (s) => permissions.getActionTier(s, 'contacts', 'view')
    assert.equal(tier(ROLES.addOnly), 'full', 'Add on, Edit off, View off -> View implied')
    assert.equal(tier(ROLES.editOnly), 'full', 'Edit on, Add off, View off -> View implied')
    assert.equal(tier(ROLES.employee), 'review')
    assert.equal(tier(ROLES.noWrites), 'none', 'View, Add and Edit all off -> no View')
    assert.equal(tier(ROLES.noContacts), 'none')
    assert.equal(permissions.isActionBlocked(ROLES.addOnly, 'contacts', 'view'), false)
    assert.equal(permissions.isActionBlocked(ROLES.noWrites, 'contacts', 'view'), true)
    assert.equal(permissions.isActionBlocked(ROLES.addOnly, 'contacts', 'add'), false)
    assert.equal(permissions.isActionBlocked(ROLES.addOnly, 'contacts', 'edit'), true, 'Edit itself stays off')
    assert.equal(permissions.getActionTier(ROLES.addOnly, 'contacts', 'delete'), 'full', 'delete is not touched by the implication')
    assert.equal(permissions.getActionTier(ROLES.addOnly, 'inventory', 'view'), 'none', 'the implication is contacts-only')
    const productsViewOff = staff(30, { products: true, 'products:view': false })
    assert.equal(permissions.getActionTier(productsViewOff, 'products', 'view'), 'none', 'other sections keep an honest View switch')
  })

  await test('Add-only role (View off) reads the directory and the customer it just added', async () => {
    const list = await call('GET', '/customers?page=1&pageSize=20', ROLES.addOnly)
    assert.equal(list.status, 200, `Add implies View: list must be served, got ${list.status}`)
    const added = await call('POST', '/customers', ROLES.addOnly, { name: 'Bopha', phone: '077 000 111', source: 'pos' })
    assert.equal(added.status, 200, JSON.stringify(added.body))
    const reread = await call('GET', `/customers?ids=${added.body.id}&fields=sales_picker`, ROLES.addOnly)
    assert.equal(reread.status, 200)
    const search = await call('GET', '/customers?search=Bopha', ROLES.addOnly)
    assert.equal(search.status, 200)
  })

  await test('Edit-only role (View off) can view; Edit-only cannot add', async () => {
    assert.equal((await call('GET', '/customers?page=1&pageSize=20', ROLES.editOnly)).status, 200)
    const refused = await call('POST', '/customers', ROLES.editOnly, { name: 'Nope' })
    assert.equal(refused.status, 403)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM customers WHERE name = 'Nope'").get().n, 0)
    const edited = await call('PUT', '/customers/5', ROLES.editOnly, { name: 'Dara', notes: 'edit-only note' })
    assert.equal(edited.status, 200, JSON.stringify(edited.body))
    assert.equal(customer().notes, 'edit-only note')
  })

  await test('CONTROL: a role with View, Add and Edit all off stays refused everywhere', async () => {
    assert.equal((await call('GET', '/customers?page=1&pageSize=20', ROLES.noWrites)).status, 403, 'read')
    assert.equal((await call('POST', '/customers', ROLES.noWrites, { name: 'Nope', source: 'pos' })).status, 403, 'add')
    assert.equal((await call('PUT', '/customers/5', ROLES.noWrites, { name: 'Dara', phone: '000', source: 'pos' })).status, 403, 'edit')
    assert.equal(customer().phone, '012 345 678')
    assert.equal(auditRows('customer', 5).length, 0)
  })

  await test('CONTROL: a role without the Contacts key cannot add or edit even with POS and Sales', async () => {
    assert.equal((await call('POST', '/customers', ROLES.noContacts, { name: 'Nope', source: 'pos' })).status, 403)
    assert.equal((await call('PUT', '/customers/5', ROLES.noContacts, { name: 'Dara', phone: '000', source: 'sale', sale_id: 21 })).status, 403)
    assert.equal(customer().phone, '012 345 678')
    assert.equal(saleEvents(21).length, 0)
  })

  await test('employee edits the customer details from the POS: sales-safe columns saved, audit row written', async () => {
    const response = await call('PUT', '/customers/5', ROLES.employee, {
      name: 'Dara', phone: '012 999 888', email: 'dara-new.test', address: 'New street', notes: 'new note', gender: 'Male',
      source: 'pos',
    })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    const row = customer()
    assert.equal(row.phone, '012 999 888')
    assert.equal(row.email, 'dara-new.test')
    assert.equal(row.notes, 'new note')
    assert.equal(row.gender, 'Male')
    const audit = auditRows('customer', 5)
    assert.equal(audit.length, 1, 'exactly one audit row for the edit')
    assert.equal(audit[0].action, 'update')
    assert.equal(audit[0].user_id, 11, 'actor recorded')
    const details = JSON.parse(audit[0].details)
    assert.equal(details.source, 'pos')
    const before = JSON.parse(audit[0].old_value)
    const after = JSON.parse(audit[0].new_value)
    assert.equal(before.phone, '012 345 678')
    assert.equal(after.phone, '012 999 888')
    assert.equal(before.notes, 'old note')
    assert.equal(after.notes, 'new note')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sale_record_events').get().n, 0, 'a POS edit has no sale yet: no sale record')
  })

  await test('DISCRIMINATOR: without a source the Review-tier edit stays name-only', async () => {
    const response = await call('PUT', '/customers/5', ROLES.employee, { name: 'Dara', phone: '012 999 888', notes: 'sneaky' })
    assert.equal(response.status, 200)
    assert.equal(customer().phone, '012 345 678', 'phone not widened without the sales source')
    assert.equal(customer().notes, 'old note')
  })

  await test('source pos/sale needs the POS/Sales grant at Full: a Contacts-only role and a View-tier Sales role are refused', async () => {
    const noPos = await call('PUT', '/customers/5', ROLES.contactsNoPos, { name: 'Dara', phone: '000', source: 'pos' })
    assert.equal(noPos.status, 403)
    const noSales = await call('PUT', '/customers/5', ROLES.contactsNoPos, { name: 'Dara', phone: '000', source: 'sale', sale_id: 21 })
    assert.equal(noSales.status, 403)
    const viewTier = await call('PUT', '/customers/5', ROLES.salesViewTier, { name: 'Dara', phone: '000', source: 'sale', sale_id: 21 })
    assert.equal(viewTier.status, 403, 'a read-only Sales tier does not edit customers')
    assert.equal(customer().phone, '012 345 678')
    assert.equal(saleEvents(21).length, 0)
  })

  await test('editing from a sale writes the sale record in the same batch and the audit row names the sale', async () => {
    const response = await call('PUT', '/customers/5', ROLES.employee, { name: 'Dara', phone: '012 999 888', notes: 'new note', source: 'sale', sale_id: 21 })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    const events = saleEvents(21)
    assert.equal(events.length, 1)
    assert.equal(events[0].source_kind, 'sale_customer')
    assert.equal(events[0].kind, 'customer_changed')
    assert.equal(events[0].actor_id, 11)
    assert.equal(events[0].actor_username, 'staff11')
    const changes = JSON.parse(events[0].changes_json)
    assert.equal(changes.length, 1)
    assert.equal(changes[0].field, 'customer_details')
    assert.deepEqual(changes[0].before.value, { phone: '012 345 678', notes: 'old note' })
    assert.deepEqual(changes[0].after.value, { phone: '012 999 888', notes: 'new note' })
    const audit = auditRows('customer', 5)
    assert.equal(audit.length, 1)
    const details = JSON.parse(audit[0].details)
    assert.equal(details.source, 'sale')
    assert.equal(details.sale_id, 21)
    assert.equal(saleEvents(22).length, 0, 'the other sale is untouched')
  })

  await test('a sale that is not this customer\'s is refused and nothing is written (atomic)', async () => {
    const response = await call('PUT', '/customers/5', ROLES.employee, { name: 'Dara', phone: '000', source: 'sale', sale_id: 22 })
    assert.ok([400, 404, 409].includes(response.status), `got ${response.status}`)
    assert.equal(customer().phone, '012 345 678')
    assert.equal(saleEvents(22).length, 0)
    assert.equal(auditRows('customer', 5).length, 0)
    const missing = await call('PUT', '/customers/5', ROLES.employee, { name: 'Dara', phone: '000', source: 'sale', sale_id: 9999 })
    assert.ok([400, 404, 409].includes(missing.status))
    const noSaleId = await call('PUT', '/customers/5', ROLES.employee, { name: 'Dara', phone: '000', source: 'sale' })
    assert.equal(noSaleId.status, 400)
    assert.equal(customer().phone, '012 345 678')
  })

  await test('a save that changes nothing writes no sale record', async () => {
    const response = await call('PUT', '/customers/5', ROLES.employee, { name: 'Dara', notes: 'old note', source: 'sale', sale_id: 21 })
    assert.equal(response.status, 200)
    assert.equal(saleEvents(21).length, 0)
  })

  await test('undo: replaying the previous values through the same source restores them and records again', async () => {
    await call('PUT', '/customers/5', ROLES.employee, { name: 'Dara', phone: '012 999 888', source: 'sale', sale_id: 21 })
    const undo = await call('PUT', '/customers/5', ROLES.employee, { name: 'Dara', phone: '012 345 678', source: 'sale', sale_id: 21 })
    assert.equal(undo.status, 200, JSON.stringify(undo.body))
    assert.equal(customer().phone, '012 345 678')
    assert.equal(saleEvents(21).length, 2)
    assert.equal(auditRows('customer', 5).length, 2)
  })

  await test('the sales editor cannot change identity, joined date or balance/loyalty/credit fields', async () => {
    const response = await call('PUT', '/customers/5', ROLES.employee, {
      name: 'Dara', notes: 'n', source: 'pos',
      membership_number: 'LC-HACK', created_at: '2020-01-01 00:00:00',
      points_balance: 9999, points_earned: 9999, loyalty_points: 9999, credit_limit: 9999,
      opening_balance: 9999, outstanding_balance_usd: 0, balance: 1, is_anonymous: 1,
    })
    assert.equal(response.status, 200)
    const row = customer()
    assert.equal(row.membership_number, 'LC-5')
    assert.equal(row.created_at, '2025-01-01 00:00:00')
    assert.equal(row.is_anonymous, 0)
    for (const column of ['points_balance', 'points_earned', 'loyalty_points', 'credit_limit', 'opening_balance', 'balance']) {
      assert.ok(!(column in row) || row[column] == null || row[column] === 0, `${column} unchanged`)
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loyalty_point_adjustments').get().n, 0)
    const points = await call('POST', '/customers/5/points', ROLES.employee, { points: 50 })
    assert.equal(points.status, 403, 'awarding points stays administrator-only')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM loyalty_point_adjustments').get().n, 0)
  })

  await test('the sales editor gets no delete, merge, bulk, supplier or delivery-contact power', async () => {
    assert.equal((await call('DELETE', '/customers/6', ROLES.employee)).status, 403)
    assert.ok(customer(6), 'customer 6 still exists')
    assert.equal((await call('POST', '/customers/merge', ROLES.employee, { keep_id: 5, merge_ids: [6] })).status, 403)
    assert.equal((await call('POST', '/customers/bulk-delete-jobs', ROLES.employee, { ids: [6] })).status, 403)
    for (const [method, url] of [
      ['POST', '/customers/duplicates/dismiss'], ['POST', '/customers/duplicates/undismiss'],
      ['POST', '/customers/link-conflicts/relink'], ['POST', '/customers/link-conflicts/resolve-missing'],
      ['POST', '/customers/5/portal-reset'], ['POST', '/customers/gender-restoration/apply'],
      ['GET', '/customers/reports/ar-invoices'],
    ]) {
      assert.equal((await call(method, url, ROLES.employee, method === 'POST' ? {} : undefined)).status, 403, `${method} ${url}`)
    }
    assert.equal((await call('GET', '/suppliers', ROLES.employee)).status, 403)
    assert.equal((await call('PUT', '/suppliers/1', ROLES.employee, { name: 'Acme', phone: '000', source: 'pos' })).status, 403)
    assert.equal(db.prepare("SELECT phone FROM suppliers WHERE id = 1").get().phone, '011 111 111')
    const delivery = await call('POST', '/delivery-contacts', ROLES.employee, { name: 'Driver', source: 'pos' })
    assert.ok(delivery.status === 400 || delivery.status === 403, `source applies to customers only, got ${delivery.status}`)
    const unknown = await call('PUT', '/customers/5', ROLES.employee, { name: 'Dara', notes: 'x', source: 'import' })
    assert.equal(unknown.status, 400, 'an unknown source is refused, not ignored')
    assert.equal(customer().notes, 'old note')
  })

  await test('adding a customer from the POS: audit row carries the source; joined date cannot be backdated', async () => {
    const response = await call('POST', '/customers', ROLES.employee, {
      name: 'Bopha', phone: '077 000 111', source: 'pos', created_at: '2001-01-01 00:00:00',
    })
    assert.equal(response.status, 200, JSON.stringify(response.body))
    const id = response.body.id
    assert.notEqual(customer(id).created_at, '2001-01-01 00:00:00')
    const audit = auditRows('customer', id)
    assert.equal(audit.length, 1)
    assert.equal(audit[0].action, 'create')
    assert.equal(audit[0].user_id, 11)
    assert.equal(JSON.parse(audit[0].details).source, 'pos')
  })

  await test('admin editing with a source keeps its full column set (not narrowed by the sales scope)', async () => {
    const response = await call('PUT', '/customers/5', ROLES.admin, { name: 'Dara', notes: 'admin note', source: 'pos' })
    assert.equal(response.status, 200)
    assert.equal(customer().notes, 'admin note')
  })

  console.log(`${passed} passed, ${failed} failed`)
  if (failed) process.exitCode = 1
})()
