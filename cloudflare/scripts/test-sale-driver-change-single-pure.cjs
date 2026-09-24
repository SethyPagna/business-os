// G3: ONE sale's existing driver is changed or cleared from its detail screen.
//
// Before G3 the single-sale screen could only ADD a driver to a counter sale
// (PATCH /:id/amend kind delivery_added, which refuses a sale that is already
// a delivery); an existing driver could only be changed through the Sales
// page's group Driver action. The detail screen now sends that same group
// request with ONE sale (POST /api/sales/bulk-update, kind delivery_contact),
// so a single change carries exactly the group path's before/after record
// event, permission checks and Undo. This file pins that contract through the
// real Hono routes on SQLite:
//
//   - change and clear work on a Completed, Not Paid and awaiting-delivery sale,
//     each writing one driver_changed record with the before/after driver;
//   - Undo restores the previous driver and records the undo;
//   - the grants are the group path's (sales:bulk + sales:amend);
//   - a cancelled sale is refused (owner rule: every status except cancelled).
//
// DISCRIMINATING: on 0293aeb0 the cancelled case answers 200 and re-points the
// cancelled sale's driver.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const recordContract = JSON.parse(fs.readFileSync(path.join(root, '..', 'outputs', 'takeover-20260908', 'f74-sales-records-backend-contract.json'), 'utf8'))
const ADMIN = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
let user = ADMIN
const cache = new Map()
const actual = new Set(['businessMaintenanceGuard', 'acquisitionCostAccess', 'saleCustomerAssignmentGuard', 'actorSnapshot', 'anonymousCustomer', 'movementBranchName', 'db', 'permissions', 'saleBulkStatus', 'saleBulkUpdate', 'saleRecordEvents', 'saleTransitions', 'sqlBinding', 'productBatches', 'batchCode', 'salesStatus', 'saleStatusResolution', 'undoAppliers', 'branchWrites', 'conflictControl', 'searchMatch', 'paymentMethodRegistry', 'contactOptions'])
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }
  cache.set(rel, mod)
  const source = fs.readFileSync(path.join(root, 'src', rel), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = (name) => {
    if (name === 'hono') return require(name)
    if (name.endsWith('/auth')) return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (name.endsWith('/cache')) return { bumpVersion: async () => {}, bumpVersions: async () => {}, getVersionWithFallback: async () => 0 }
    if (name.endsWith('/broadcastHub')) return { broadcast: async () => {} }
    if (name.endsWith('/audit')) return { audit: async () => {} }
    if (rel.endsWith('saleRecordEvents.ts') && name === './saleRecords') return { SALE_RECORD_FIELDS: recordContract.fields, SALE_RECORD_KINDS: recordContract.kinds }
    if (name.startsWith('.')) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), name)) + '.ts'
      if (actual.has(path.posix.basename(name))) return load(target)
      return {}
    }
    return require(name)
  }
  new Function('require', 'module', 'exports', output)(req, mod, mod.exports)
  return mod.exports
}
const sales = load('routes/sales.ts').default
const history = load('routes/actionHistory.ts').default

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  sql.exec(`
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    INSERT INTO delivery_contacts(id,name,phone,area,address) VALUES(1,'Driver A','111','A area','A road'),(2,'Driver B','222','B area','B road');
    INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_name,payment_method,is_delivery,delivery_contact_id,delivery_contact_name,delivery_contact_phone,delivery_contact_address,updated_at)
    VALUES
      (1,'R1','cancelled',1,'Shop','Cashier','Cash',1,1,'Driver A','111','A road','v1'),
      (2,'R2','completed',1,'Shop','Cashier','Cash',1,1,'Driver A','111','A road','v1'),
      (3,'R3','awaiting_payment',1,'Shop','Cashier','Cash',1,1,'Driver A','111','A road','v1'),
      (4,'R4','awaiting_delivery',1,'Shop','Cashier','Cash',1,1,'Driver A','111','A road','v1');
  `)
  const env = { DB: {
    prepare(text) {
      return { bind(...params) { return {
        text, params,
        async first() { return sql.prepare(text).get(...params) || null },
        async all() { return { results: sql.prepare(text).all(...params) } },
        async run() { const r = sql.prepare(text).run(...params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } },
      } } }
    },
    async batch(statements) {
      return sql.transaction(() => statements.map((s) => { const r = sql.prepare(s.text).run(...s.params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } }))()
    },
  } }
  const ctx = { waitUntil() {}, passThroughOnException() {} }
  const call = async (app, url, body) => {
    const response = await app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env, ctx)
    return { status: response.status, body: await response.json() }
  }
  return { sql, call }
}
// Exactly the body the detail screen sends (Sales.tsx changeSaleDriver).
const single = (key, id, sourceId, targetId) => ({ client_request_id: key, items: [{ id, expected_updated_at: 'v1' }], action: { kind: 'delivery_contact', source_id: sourceId, target_id: targetId } })
const driverOf = (f, id) => f.sql.prepare('SELECT delivery_contact_id id,delivery_contact_name name,delivery_contact_phone phone,delivery_contact_address address FROM sales WHERE id=?').get(id)
const events = (f, id) => f.sql.prepare("SELECT kind,via,changes_json FROM sale_record_events WHERE sale_id=? AND source_kind='sale_bulk_update' ORDER BY generation").all(id)
  .map((row) => ({ kind: row.kind, via: row.via, changes: JSON.parse(row.changes_json) }))
const A = { state: 'known_value', value: { id: 1, name: 'Driver A', phone: '111', address: 'A road' } }
const B = { state: 'known_value', value: { id: 2, name: 'Driver B', phone: '222', address: 'B road' } }
const NONE = { state: 'known_none' }

let failed = 0
async function runTest(name, fn) {
  try { user = ADMIN; await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

;(async () => {
  for (const [id, status] of [[2, 'completed'], [3, 'awaiting_payment'], [4, 'awaiting_delivery']]) {
    await runTest(`a ${status} sale's driver is changed on its own, with a before/after record and Undo`, async () => {
      const f = fixture()
      const changed = await f.call(sales, '/bulk-update', single(`single-driver-${id}`, id, 1, 2))
      assert.equal(changed.status, 200, JSON.stringify(changed))
      assert.equal(changed.body.changedCount, 1)
      assert.deepEqual(driverOf(f, id), { id: 2, name: 'Driver B', phone: '222', address: 'B road' })
      assert.deepEqual(events(f, id), [{ kind: 'driver_changed', via: 'apply', changes: [{ field: 'driver', before: A, after: B }] }])
      const row = f.sql.prepare("SELECT status,json_extract(undo_payload,'$.applier') applier FROM action_history WHERE id=?").get(changed.body.actionHistoryId)
      assert.deepEqual(row, { status: 'undoable', applier: 'sale.fields.bulk' })
      const undone = await f.call(history, `/${changed.body.actionHistoryId}/undo`, { require_applied: true, expected_generation: 0 })
      assert.equal(undone.status, 200, JSON.stringify(undone))
      assert.deepEqual(driverOf(f, id), { id: 1, name: 'Driver A', phone: '111', address: 'A road' })
      assert.deepEqual(events(f, id).map((e) => e.via), ['apply', 'undo'])
    })
  }

  await runTest('a sale\'s driver is cleared on its own, recorded as driver -> none', async () => {
    const f = fixture()
    const cleared = await f.call(sales, '/bulk-update', single('single-driver-clear', 2, 1, null))
    assert.equal(cleared.status, 200, JSON.stringify(cleared))
    assert.deepEqual(driverOf(f, 2), { id: null, name: null, phone: null, address: null })
    assert.deepEqual(events(f, 2), [{ kind: 'driver_changed', via: 'apply', changes: [{ field: 'driver', before: A, after: NONE }] }])
    // A cleared delivery can be given a driver again the same way (source none).
    const set = await f.call(sales, '/bulk-update', { ...single('single-driver-set', 2, null, 2), items: [{ id: 2, expected_updated_at: f.sql.prepare('SELECT updated_at FROM sales WHERE id=2').get().updated_at }] })
    assert.equal(set.status, 200, JSON.stringify(set))
    assert.equal(set.body.changedCount, 1)
    assert.equal(driverOf(f, 2).id, 2)
  })

  await runTest('a cancelled sale\'s driver cannot be changed or cleared', async () => {
    const f = fixture()
    for (const [key, target] of [['cancelled-driver-change', 2], ['cancelled-driver-clear', null]]) {
      const refused = await f.call(sales, '/bulk-update', single(key, 1, 1, target))
      assert.equal(refused.status, 400, JSON.stringify(refused))
      assert.equal(refused.body.code, 'cancelled_sale_read_only')
    }
    assert.deepEqual(driverOf(f, 1), { id: 1, name: 'Driver A', phone: '111', address: 'A road' })
    assert.deepEqual(events(f, 1), [])
  })

  await runTest('the single change needs the group path\'s grants (sales:bulk + sales:amend)', async () => {
    const f = fixture()
    user = { id: 2, name: 'Amender', role_code: 'user', permissions: JSON.stringify({ sales: true, 'sales:amend': true, 'sales:bulk': false }) }
    const denied = await f.call(sales, '/bulk-update', single('no-bulk-grant', 2, 1, 2))
    assert.equal(denied.status, 403, JSON.stringify(denied))
    assert.equal(driverOf(f, 2).id, 1)
  })

  if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
})().catch((error) => { console.error(error); process.exit(1) })
