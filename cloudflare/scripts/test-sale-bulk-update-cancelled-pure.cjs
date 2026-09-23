// G1: a CANCELLED sale refuses every grouped field edit (POST /api/sales/bulk-update).
//
// Owner rule (23 Sep 2026): "add/edit sales customer, driver, delivery fee,
// add item, replace, edit, etc... are able to do in all status except
// cancelled." The single-sale customer route already refuses a cancelled sale
// (test-sale-cancelled-customer-readonly-pure.cjs); the grouped path did not,
// so the Sales page bulk bar could re-point a cancelled sale's customer, driver
// or payment method.
//
// Convention: like every other per-sale refusal on the group paths, the WHOLE
// group is refused and the answer names the offending sales
// (code cancelled_sale_read_only, sale_ids). The Sales page leaves cancelled
// sales out before sending.
//
// DISCRIMINATING: on 0293aeb0 every refusal case below answers 200 and writes;
// the race case (a sale cancelled between the read and the atomic write, on a
// member whose source did not match and so carries no revision guard) also
// commits. The live-status cases are the positive control: a fix that refused
// more than cancelled would fail them.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const recordContract = JSON.parse(fs.readFileSync(path.join(root, '..', 'outputs', 'takeover-20260908', 'f74-sales-records-backend-contract.json'), 'utf8'))
const user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
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

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  sql.exec(`
    INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_methods','["Cash","ABA","Card"]','settings-v1')
      ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at;
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    INSERT INTO customers(id,name,phone,address) VALUES(1,'Old','011','Old road'),(2,'New','022','New road');
    INSERT INTO delivery_contacts(id,name,phone,area,address) VALUES(1,'Driver A','111','A area','A road'),(2,'Driver B','222','B area','B road');
    INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_name,customer_id,customer_name,customer_phone,customer_address,payment_method,payment_details,is_delivery,delivery_contact_id,delivery_contact_name,delivery_contact_phone,delivery_contact_address,updated_at)
    VALUES
      (1,'R1','cancelled',1,'Shop','Cashier',1,'Old','011','Old road','Cash','[{"method":"Cash","amount_usd":5,"amount_khr":0}]',1,1,'Driver A','111','A road','v1'),
      (2,'R2','completed',1,'Shop','Cashier',1,'Old','011','Old road','Cash','[{"method":"Cash","amount_usd":5,"amount_khr":0}]',1,1,'Driver A','111','A road','v1'),
      (3,'R3','awaiting_payment',1,'Shop','Cashier',1,'Old','011','Old road','Cash','[{"method":"Cash","amount_usd":5,"amount_khr":0}]',1,1,'Driver A','111','A road','v1'),
      (4,'R4','awaiting_delivery',1,'Shop','Cashier',1,'Old','011','Old road','ABA','[{"method":"ABA","amount_usd":5,"amount_khr":0}]',1,1,'Driver A','111','A road','v1');
  `)
  let beforeBatch = null
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
      if (beforeBatch) { const fn = beforeBatch; beforeBatch = null; await fn() }
      return sql.transaction(() => statements.map((s) => { const r = sql.prepare(s.text).run(...s.params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } }))()
    },
  } }
  const ctx = { waitUntil() {}, passThroughOnException() {} }
  const call = async (body) => {
    const response = await sales.request('/bulk-update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env, ctx)
    return { status: response.status, body: await response.json() }
  }
  return { sql, call, barrier(fn) { beforeBatch = fn } }
}
const body = (key, ids, action) => ({ client_request_id: key, items: ids.map((id) => ({ id, expected_updated_at: 'v1' })), action })
const state = (f) => JSON.stringify(['sales', 'sale_bulk_operations', 'sale_record_events', 'action_history', 'undo_snapshots', 'audit_logs'].map((t) => f.sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))

let failed = 0
async function runTest(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const ACTIONS = [
  ['customer', { kind: 'customer', source_id: 1, target_id: 2 }],
  ['driver', { kind: 'delivery_contact', source_id: 1, target_id: 2 }],
  ['driver clear', { kind: 'delivery_contact', source_id: 1, target_id: null }],
  ['payment method', { kind: 'payment_method', source: 'Cash', target: 'Card' }],
]

;(async () => {
  for (const [label, action] of ACTIONS) {
    await runTest(`a group with a cancelled sale refuses the ${label} edit and writes nothing`, async () => {
      const f = fixture()
      const before = state(f)
      const response = await f.call(body(`cancelled-${label.replace(/\W/g, '-')}`, [1, 2], action))
      assert.equal(response.status, 400, JSON.stringify(response))
      assert.equal(response.body.code, 'cancelled_sale_read_only')
      assert.deepEqual(response.body.sale_ids, [1])
      assert.equal(state(f), before, 'nothing in the group may change')
    })
  }

  await runTest('a single cancelled sale refuses a customer-name edit (the one-sale detail path)', async () => {
    const f = fixture()
    const before = state(f)
    const response = await f.call(body('cancelled-name-1', [1], { kind: 'customer_name', name: 'Renamed' }))
    assert.equal(response.status, 400, JSON.stringify(response))
    assert.equal(response.body.code, 'cancelled_sale_read_only')
    assert.equal(state(f), before)
  })

  await runTest('a cancelled sale whose source does not match still refuses the group', async () => {
    const f = fixture()
    // Sale 1 pays by Cash, so an ABA -> Card change would only "skip" it; a
    // cancelled sale is refused regardless, so the page must leave it out.
    const response = await f.call(body('cancelled-mismatch-1', [1, 4], { kind: 'payment_method', source: 'ABA', target: 'Card' }))
    assert.equal(response.status, 400, JSON.stringify(response))
    assert.equal(response.body.code, 'cancelled_sale_read_only')
    assert.equal(f.sql.prepare('SELECT payment_method FROM sales WHERE id=4').get().payment_method, 'ABA')
  })

  await runTest('a sale cancelled between the read and the write refuses the group atomically', async () => {
    const f = fixture()
    // Sale 4 pays by ABA, so the Cash -> Card change skips it (no revision
    // guard). Cancelling it after the read must still refuse the whole group.
    let afterCancel
    f.barrier(() => { f.sql.prepare("UPDATE sales SET sale_status='cancelled' WHERE id=4").run(); afterCancel = state(f) })
    const response = await f.call(body('cancelled-race-1', [2, 4], { kind: 'payment_method', source: 'Cash', target: 'Card' }))
    assert.equal(response.status, 409, JSON.stringify(response))
    assert.equal(response.body.code, 'cancelled_sale_read_only')
    assert.deepEqual(response.body.sale_ids, [4])
    assert.equal(state(f), afterCancel, 'the live sale in the group must not change either')
  })

  // Positive control: every other status stays editable, with a record event.
  for (const [label, action, field] of [['driver', { kind: 'delivery_contact', source_id: 1, target_id: 2 }, 'delivery_contact_id'], ['customer', { kind: 'customer', source_id: 1, target_id: 2 }, 'customer_id']]) {
    await runTest(`completed, Not Paid and awaiting-delivery sales still accept a grouped ${label} edit`, async () => {
      const f = fixture()
      const response = await f.call(body(`live-${label}-1`, [2, 3, 4], action))
      assert.equal(response.status, 200, JSON.stringify(response))
      assert.equal(response.body.changedCount, 3)
      assert.deepEqual(f.sql.prepare(`SELECT ${field} v FROM sales WHERE id IN (2,3,4) ORDER BY id`).all().map((r) => r.v), [2, 2, 2])
      assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sale_record_events WHERE source_kind='sale_bulk_update'").get().n, 3)
    })
  }

  if (failed) { console.error(`${failed} test(s) failed`); process.exit(1) }
})().catch((error) => { console.error(error); process.exit(1) })
