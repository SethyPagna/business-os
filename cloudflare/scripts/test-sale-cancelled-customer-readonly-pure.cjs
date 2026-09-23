// S4-41: a CANCELLED sale is read-only, including its customer.
//
// The owner's rule for sale edits is "add/edit sales customer, driver,
// delivery fee, add item, replace, edit, etc... are able to do in all status
// except cancelled." Every edit surface honoured the "except cancelled" half
// -- amendments (guardSaleAmendment), added lines (guardSaleLineAddition),
// status changes (guardSaleStatusTransition) -- except ONE:
// PATCH /:id/customer had no status check at all. A cancelled sale's buyer
// could still be reassigned, which also rewrites that customer's purchase
// history to include a sale that never happened, and leaves the linked
// return rows pointing at the new customer.
//
// DISCRIMINATING: on the pre-S4-41 route the first case below returns 200 and
// mutates sales.customer_id. The second and third cases exist so the fix
// cannot be "refuse everything" -- a live sale must still be editable, which
// is the owner's actual rule.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')

const root = path.join(__dirname, '..')
const recordContract = JSON.parse(fs.readFileSync(path.join(root, '..', 'outputs', 'takeover-20260908', 'f74-sales-records-backend-contract.json'), 'utf8'))
let user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const cache = new Map()
const actual = new Set([
  'acquisitionCostAccess',
  'saleCustomerAssignmentGuard',
  'actorSnapshot', 'movementBranchName', 'db', 'permissions', 'saleBulkStatus', 'saleBulkUpdate',
  'saleRecordEvents', 'saleTransitions', 'sqlBinding', 'productBatches', 'batchCode', 'salesStatus', 'saleStatusResolution',
  'undoAppliers', 'branchWrites', 'conflictControl', 'searchMatch', 'paymentMethodRegistry', 'contactOptions', 'anonymousCustomer',
  'businessMaintenanceGuard',
])

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
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((file) => file.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  }
  sql.exec(`
    INSERT INTO branches(id,name) VALUES(1,'Shop');
    INSERT INTO customers(id,name,phone,address,membership_number) VALUES
      (1,'Old','011','Old road','OLD-MEMBER'),
      (2,'New','022','New road','NEW-MEMBER');
    INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_name,customer_id,customer_name,customer_phone,customer_address,payment_method,updated_at)
    VALUES
      (1,'R1','cancelled',1,'Shop','Cashier',1,'Old','011','Old road','Cash','sale-1-v1'),
      (2,'R2','completed',1,'Shop','Cashier',1,'Old','011','Old road','Cash','sale-2-v1'),
      (3,'R3','awaiting_payment',1,'Shop','Cashier',1,'Old','011','Old road','Cash','sale-3-v1'),
      (4,'R4','awaiting_delivery',1,'Shop','Cashier',1,'Old','011','Old road','Cash','sale-4-v1');
  `)
  const env = { DB: {
    prepare(text) {
      return { bind(...params) { return {
        text,
        params,
        async first() { return sql.prepare(text).get(...params) || null },
        async all() { return { results: sql.prepare(text).all(...params) } },
        async run() { const result = sql.prepare(text).run(...params); return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } } },
      } } }
    },
    async batch(statements) {
      return sql.transaction(() => statements.map((statement) => {
        const prepared = sql.prepare(statement.text)
        if (prepared.reader) return { results: [prepared.get(...statement.params)], meta: { changes: 0 } }
        const result = prepared.run(...statement.params)
        return { meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } }
      }))()
    },
  } }
  const ctx = { waitUntil() {}, passThroughOnException() {} }
  const call = async (id, body) => {
    const response = await sales.request(`/${id}/customer`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }, env, ctx)
    const text = await response.text()
    let parsed
    try { parsed = JSON.parse(text) } catch { parsed = { error: text } }
    return { status: response.status, body: parsed }
  }
  return { sql, call }
}

let failed = 0
async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const customerOf = (f, id) => f.sql.prepare(`SELECT customer_id,customer_name FROM sales WHERE id=${id}`).get()

;(async () => {
  await runTest('a cancelled sale refuses a customer reassignment', async () => {
    const f = fixture()
    const before = customerOf(f, 1)
    const response = await f.call(1, {
      client_request_id: 'cancelled-customer-1', expected_updated_at: 'sale-1-v1', customerId: 2,
    })
    // The old route answered 200 and moved the sale to customer 2.
    assert.equal(response.status, 400, JSON.stringify(response))
    assert.equal(response.body.code, 'cancelled_sale_read_only')
    assert.deepEqual(customerOf(f, 1), before, 'the cancelled sale must be untouched')
    assert.equal(
      f.sql.prepare("SELECT COUNT(*) n FROM sale_record_events WHERE source_kind='sale_customer'").get().n, 0,
      'a refused edit must not write a record event',
    )
  })

  await runTest('a cancelled sale refuses CLEARING the customer too', async () => {
    const f = fixture()
    const response = await f.call(1, {
      client_request_id: 'cancelled-customer-clear', expected_updated_at: 'sale-1-v1', clearAssignment: true,
    })
    assert.equal(response.status, 400, JSON.stringify(response))
    assert.equal(response.body.code, 'cancelled_sale_read_only')
    assert.equal(customerOf(f, 1).customer_id, 1)
  })

  // The other half of the owner's rule: EVERY other status stays editable.
  // A fix that simply refused more would be its own defect.
  for (const [id, status, requestId] of [[2, 'completed', 'live-completed'], [3, 'awaiting_payment', 'live-awaiting-payment'], [4, 'awaiting_delivery', 'live-awaiting-delivery']]) {
    await runTest(`a ${status} sale still accepts a customer change`, async () => {
      const f = fixture()
      const response = await f.call(id, {
        client_request_id: requestId, expected_updated_at: `sale-${id}-v1`, customerId: 2,
      })
      assert.equal(response.status, 200, JSON.stringify(response))
      assert.equal(customerOf(f, id).customer_id, 2)
      assert.equal(customerOf(f, id).customer_name, 'New')
    })
  }

  if (failed > 0) {
    console.error(`${failed} test(s) failed`)
    process.exit(1)
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
