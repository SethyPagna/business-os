const { withProductStockGuard } = require('./harness/product_stock_guard.cjs')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
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
//   - the grant is the delivery cost's, sales:amend alone (sales:bulk stays the
//     multi-sale switch);
//   - a cancelled sale is refused (owner rule: every status except cancelled);
//   - G1: outside the sale edit window a non-admin is refused with the window
//     code (the delivery-cost edit's rule); an admin and a sale inside the window pass;
//   - G2: a driver contact deleted after the sale was saved does not block a
//     change or a clear, and Undo restores the snapshot;
//   - G3: a delivery expense linked to the sale and the old driver moves to the
//     new driver in the same write (and back on Undo); other expense types and
//     other sales' expenses stay;
//   - G6: the audit row names the sale and receipt and the driver before and after.
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
const actual = new Set(['businessMaintenanceGuard', 'acquisitionCostAccess','courierCostAccess', 'saleCustomerAssignmentGuard','customerPointsReturn', 'actorSnapshot', 'anonymousCustomer', 'movementBranchName', 'db', 'permissions', 'saleBulkStatus', 'saleBulkUpdate', 'saleRecordEvents', 'saleTransitions', 'sqlBinding', 'productBatches', 'batchCode', 'salesStatus', 'saleStatusResolution', 'undoAppliers', 'branchWrites', 'conflictControl', 'saleAmendments', 'productStockGuard', 'searchMatch', 'paymentMethodRegistry', 'contactOptions','failureText'])
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
  new Function('require', 'module', 'exports', output)(withProductStockGuard(req), mod, mod.exports)
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
        async first() { return sqliteD1Call(sql.prepare(text), 'get', params) || null },
        async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
        async run() { const r = sqliteD1Call(sql.prepare(text), 'run', params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } },
      } } }
    },
    async batch(statements) {
      return sql.transaction(() => statements.map((s) => { const r = sqliteD1Call(sql.prepare(s.text), 'run', s.params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } }))()
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
      assert.deepEqual(row, { status: 'undoable', applier: 'sale.delivery.single' })
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

  await runTest('the single change needs sales:amend, and sales:bulk alone is not enough', async () => {
    const f = fixture()
    user = { id: 2, name: 'Bulk only', role_code: 'user', permissions: JSON.stringify({ sales: true, 'sales:amend': false, 'sales:bulk': true }) }
    const denied = await f.call(sales, '/bulk-update', single('no-amend-grant', 2, 1, 2))
    assert.equal(denied.status, 403, JSON.stringify(denied))
    assert.equal(driverOf(f, 2).id, 1)
    user = { id: 3, name: 'Amender', role_code: 'user', permissions: JSON.stringify({ sales: true, 'sales:amend': true, 'sales:bulk': false }) }
    const allowed = await f.call(sales, '/bulk-update', single('amend-grant', 2, 1, 2))
    assert.equal(allowed.status, 200, JSON.stringify(allowed))
    assert.equal(driverOf(f, 2).id, 2)
  })

  const setWindow = (f, minutes) => f.sql.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('sale_amendment_window_minutes',?)").run(String(minutes))
  const amendOnly = { id: 3, name: 'Amender', role_code: 'user', permissions: JSON.stringify({ sales: true, 'sales:amend': true, 'sales:bulk': false }) }
  const feeDriver = (f, id) => f.sql.prepare('SELECT delivery_contact_id d FROM fees WHERE id=?').get(9000 + id).d

  await runTest('G1: outside the sale edit window an amend-only user is refused with the window code; an admin and a sale inside the window pass', async () => {
    const f = fixture()
    setWindow(f, 60)
    f.sql.prepare("UPDATE sales SET created_at=datetime('now','-2 hours') WHERE id=2").run()
    f.sql.prepare("UPDATE sales SET created_at=datetime('now','-5 minutes') WHERE id=3").run()
    user = amendOnly
    const refused = await f.call(sales, '/bulk-update', single('window-refused', 2, 1, 2))
    assert.equal(refused.status, 400, JSON.stringify(refused))
    assert.equal(refused.body.code, 'window')
    assert.deepEqual(refused.body.sale_ids, [2])
    assert.equal(driverOf(f, 2).id, 1)
    assert.deepEqual(events(f, 2), [])
    const cleared = await f.call(sales, '/bulk-update', single('window-refused-clear', 2, 1, null))
    assert.equal(cleared.body.code, 'window', 'clearing is a driver edit too')
    const inside = await f.call(sales, '/bulk-update', single('window-inside', 3, 1, 2))
    assert.equal(inside.status, 200, JSON.stringify(inside))
    assert.equal(driverOf(f, 3).id, 2)
    user = ADMIN
    const admin = await f.call(sales, '/bulk-update', single('window-admin', 2, 1, 2))
    assert.equal(admin.status, 200, JSON.stringify(admin))
    assert.equal(driverOf(f, 2).id, 2)
  })

  await runTest('G1: a returned sale is never refused by the returns rule (23 Sep: editable in every status except cancelled)', async () => {
    const f = fixture()
    setWindow(f, 0)
    f.sql.prepare("UPDATE sales SET sale_status='returned' WHERE id=2").run()
    user = amendOnly
    const allowed = await f.call(sales, '/bulk-update', single('returned-allowed', 2, 1, 2))
    assert.equal(allowed.status, 200, JSON.stringify(allowed))
  })

  await runTest('G2: a deleted source driver contact does not block changing or clearing the driver, and Undo restores it', async () => {
    const f = fixture()
    f.sql.prepare('DELETE FROM delivery_contacts WHERE id=1').run()
    const changed = await f.call(sales, '/bulk-update', single('deleted-source-change', 2, 1, 2))
    assert.equal(changed.status, 200, JSON.stringify(changed))
    assert.deepEqual(driverOf(f, 2), { id: 2, name: 'Driver B', phone: '222', address: 'B road' })
    assert.deepEqual(events(f, 2), [{ kind: 'driver_changed', via: 'apply', changes: [{ field: 'driver', before: A, after: B }] }])
    const undone = await f.call(history, '/' + changed.body.actionHistoryId + '/undo', { require_applied: true, expected_generation: 0 })
    assert.equal(undone.status, 200, JSON.stringify(undone))
    assert.deepEqual(driverOf(f, 2), { id: 1, name: 'Driver A', phone: '111', address: 'A road' })
    const cleared = await f.call(sales, '/bulk-update', single('deleted-source-clear', 4, 1, null))
    assert.equal(cleared.status, 200, JSON.stringify(cleared))
    assert.equal(driverOf(f, 4).id, null)
  })

  const feeFixture = () => {
    const f = fixture()
    f.sql.exec("INSERT INTO fees(id,fee_type,label,amount_usd,fee_date,sale_id,delivery_contact_id) VALUES (9001,'delivery','Courier',1.5,'2026-11-09',2,1),(9002,'other','Box',0.5,'2026-11-09',2,1),(9003,'delivery','Courier',1.5,'2026-11-09',3,1),(9004,'delivery','Courier',1.5,'2026-11-09',2,2)")
    return f
  }
  await runTest('G3: the delivery expense linked to the sale and the old driver moves to the new driver, with Undo; other types and other sales stay', async () => {
    const f = feeFixture()
    const changed = await f.call(sales, '/bulk-update', single('fee-move', 2, 1, 2))
    assert.equal(changed.status, 200, JSON.stringify(changed))
    assert.equal(changed.body.movedExpenseCount, 1)
    assert.equal(feeDriver(f, 1), 2, 'the delivery expense follows the delivery')
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM fees WHERE sale_id=2 AND delivery_contact_id=1 AND fee_type='delivery'").get().n, 0)
    assert.equal(feeDriver(f, 2), 1, 'a non-delivery expense stays')
    assert.equal(feeDriver(f, 3), 1, "another sale's expense stays")
    assert.equal(feeDriver(f, 4), 2)
    const undone = await f.call(history, '/' + changed.body.actionHistoryId + '/undo', { require_applied: true, expected_generation: 0 })
    assert.equal(undone.status, 200, JSON.stringify(undone))
    assert.equal(feeDriver(f, 1), 1, 'Undo moves the expense back')
    assert.equal(feeDriver(f, 4), 2, 'an expense that was already on the new driver is not pulled back')
    const redone = await f.call(history, '/' + changed.body.actionHistoryId + '/redo', { require_applied: false, expected_generation: 1 })
    assert.equal(redone.status, 200, JSON.stringify(redone))
    assert.equal(feeDriver(f, 1), 2)
  })

  await runTest('G3: the review preview lists the delivery expenses that would move, writes nothing, and obeys the same refusals', async () => {
    const f = feeFixture()
    f.sql.prepare('UPDATE fees SET label=? WHERE id=9001').run('Courier run')
    const tables = ['sales', 'fees', 'audit_logs', 'action_history', 'sale_bulk_operations', 'sale_record_events', 'undo_snapshots']
    const state = () => JSON.stringify(tables.map((t) => f.sql.prepare('SELECT * FROM ' + t + ' ORDER BY rowid').all()))
    const before = state()
    const preview = await f.call(sales, '/bulk-update', { ...single('preview-1', 2, 1, 2), preview: true })
    assert.equal(preview.status, 200, JSON.stringify(preview))
    assert.equal(preview.body.preview, true)
    assert.deepEqual(preview.body.movedExpenses, [{ id: 9001, sale_id: 2, label: 'Courier run' }])
    assert.ok(!/amount|usd|khr/i.test(JSON.stringify(preview.body.movedExpenses)), 'the preview names the expense, never its amount')
    assert.equal(state(), before, 'a preview writes nothing')
    // The same request id can then be used for the real write: the preview did not consume it.
    const real = await f.call(sales, '/bulk-update', single('preview-1', 2, 1, 2))
    assert.equal(real.status, 200, JSON.stringify(real))
    assert.equal(real.body.movedExpenseCount, 1)
    const g = fixture()
    g.sql.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES('sale_amendment_window_minutes','60')").run()
    g.sql.prepare("UPDATE sales SET created_at=datetime('now','-2 hours') WHERE id=2").run()
    user = amendOnly
    const refused = await g.call(sales, '/bulk-update', { ...single('preview-2', 2, 1, 2), preview: true })
    assert.equal(refused.body.code, 'window', 'a preview is refused where the write would be')
  })

  await runTest('G3: the preview shows expense labels and the count only to a caller who may view expenses', async () => {
    const f = feeFixture()
    f.sql.prepare('UPDATE fees SET label=? WHERE id=9001').run('Courier run')
    user = amendOnly
    const hidden = await f.call(sales, '/bulk-update', { ...single('preview-hide', 2, 1, 2), preview: true })
    assert.equal(hidden.status, 200, JSON.stringify(hidden))
    assert.deepEqual(hidden.body.movedExpenses, [], 'no labels for an amend-only caller')
    assert.equal(hidden.body.movedExpenseCount, 0)
    assert.ok(!JSON.stringify(hidden.body).includes('Courier run'))
    user = { id: 4, name: 'Amend and view', role_code: 'user', permissions: JSON.stringify({ sales: true, 'sales:amend': true, fees: true }) }
    const shown = await f.call(sales, '/bulk-update', { ...single('preview-show', 2, 1, 2), preview: true })
    assert.deepEqual(shown.body.movedExpenses, [{ id: 9001, sale_id: 2, label: 'Courier run' }])
    assert.equal(shown.body.movedExpenseCount, 1)
    // The write itself still moves the expense whoever asks: only the review's detail is gated.
    user = amendOnly
    const real = await f.call(sales, '/bulk-update', single('preview-hide', 2, 1, 2))
    assert.equal(real.status, 200, JSON.stringify(real))
    assert.equal(feeDriver(f, 1), 2)
  })

  await runTest('G3: clearing the driver unlinks the delivery expense, and Undo links it back', async () => {
    const f = feeFixture()
    const cleared = await f.call(sales, '/bulk-update', single('fee-clear', 2, 1, null))
    assert.equal(cleared.status, 200, JSON.stringify(cleared))
    assert.equal(feeDriver(f, 1), null)
    assert.equal(feeDriver(f, 2), 1)
    await f.call(history, '/' + cleared.body.actionHistoryId + '/undo', { require_applied: true, expected_generation: 0 })
    assert.equal(feeDriver(f, 1), 1)
  })

  await runTest('G6: the audit row names the sale, the receipt and the driver before and after, never the courier cost', async () => {
    const f = feeFixture()
    f.sql.prepare('UPDATE sales SET delivery_actual_cost_usd=7.77 WHERE id=2').run()
    const changed = await f.call(sales, '/bulk-update', single('audit-single', 2, 1, 2))
    assert.equal(changed.status, 200, JSON.stringify(changed))
    const rows = f.sql.prepare("SELECT entity_id,record_id,details FROM audit_logs WHERE action='sale_fields_bulk'").all()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].entity_id, '2')
    assert.equal(rows[0].record_id, '2')
    const details = JSON.parse(rows[0].details)
    assert.equal(details.kind, 'sale.delivery.single')
    assert.equal(details.receipt_number, 'R2')
    assert.equal(details.before.name, 'Driver A')
    assert.equal(details.after.name, 'Driver B')
    assert.equal(details.expenses_moved, 1)
    assert.ok(!/7\.77|cost/i.test(rows[0].details), 'no courier cost in the audit row')
  })

  await runTest('G5: the history row carries the receipt and both names for the History bar', async () => {
    const f = fixture()
    const changed = await f.call(sales, '/bulk-update', single('history-single', 2, 1, 2))
    const row = f.sql.prepare('SELECT label,undo_payload,redo_payload FROM action_history WHERE id=?').get(changed.body.actionHistoryId)
    const payload = JSON.parse(row.undo_payload)
    assert.equal(payload.applier, 'sale.delivery.single')
    assert.equal(payload.receipt_number, 'R2')
    assert.equal(payload.before_name, 'Driver A')
    assert.equal(payload.after_name, 'Driver B')
    assert.equal(row.label, 'Driver of #R2: Driver A -> Driver B')
    assert.equal(JSON.parse(row.redo_payload).after_name, 'Driver B')
  })

  if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
})().catch((error) => { console.error(error); process.exit(1) })
