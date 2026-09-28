// SCAN1 F2, loyalty half (28 Sep 2026). POST /api/customers/:id/points had NO
// dedupe: the Loyalty page raced the POST against a 12 s UI timer, the POST
// committed after the timer said "try again", and the retry added the points a
// second time. The page now sends one client_request_id per award intent
// (frontend/tests/writeRetryIdempotencyWiring.test.ts); this file proves the
// Worker half on the REAL route over the real migration chain:
//   * the same id + same body is replayed, not re-applied (kills "no dedupe");
//   * the same id + different body is refused 409 (kills "id alone decides");
//   * a different id with the same body IS a second award (kills a
//     same-content-within-a-window heuristic, which would swallow a real
//     second award);
//   * no id (an older client) keeps the old behaviour;
//   * a retry that races past the replay check still cannot insert: the
//     receipt is checked again INSIDE the write batch (kills "pre-check only");
//   * the receipt (the award's own audit row) records the committed ledger id.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')

function load(file, dependencies = {}) {
  const filename = path.join(root, 'src', file)
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  const module = { exports: {} }
  new Function('require', 'exports', 'module', output)((name) => {
    if (name in dependencies) return dependencies[name]
    if (name.startsWith('.')) return {}
    return require(name)
  }, module.exports, module)
  return module.exports
}

const ADMIN = { id: 1, username: 'owner', name: 'Owner Full Name', role_code: 'admin', role_permissions: '{}', permissions: '{}' }
const OTHER_ADMIN = { id: 2, username: 'manager', name: 'Manager', role_code: 'admin', role_permissions: '{}', permissions: '{}' }

function freshDb() {
  const db = openDb(loadAll())
  db.prepare("INSERT INTO users (id, username, name, password) VALUES (1, 'owner', 'Owner Full Name', 'x'), (2, 'manager', 'Manager', 'x')").run()
  db.prepare("INSERT INTO customers (id, name, phone, membership_number, is_anonymous) VALUES (5, 'Dara', '012', 'LC-5', 0), (6, 'Walk-in', NULL, NULL, 1)").run()
  return db
}

let db
let actor = ADMIN
let hidePrecheck = 0
// The route's own getDb(), with an optional blind spot: while hidePrecheck > 0
// the stand-alone receipt lookup reads nothing, exactly what a concurrent retry
// sees when its twin has not committed yet.
const routeDb = {
  prepare(sql) {
    const stmt = db.prepare(sql)
    if (hidePrecheck > 0 && /^\s*SELECT/i.test(sql) && sql.includes("'$.request.id'")) {
      hidePrecheck -= 1
      return { get: async () => undefined, all: async () => [], run: async () => ({ meta: {} }), bind() { return this } }
    }
    return stmt
  },
  batch: (items) => db.batch(items),
}
const permissions = load('lib/permissions.ts')
const contactsApp = load('routes/contacts.ts', {
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', actor); return next() } },
  '../lib/db': { getDb: () => routeDb },
  '../lib/audit': load('lib/audit.ts', { './db': { getDb: () => routeDb } }),
  '../lib/permissions': permissions,
  '../lib/actorSnapshot': load('lib/actorSnapshot.ts'),
  '../lib/anonymousCustomer': load('lib/anonymousCustomer.ts'),
  '../durable-objects/broadcastHub': { broadcast: async () => {} },
  '../lib/cache': { bumpVersion: async () => {}, bumpVersions: async () => {} },
}).default

const executionCtx = { waitUntil() {}, passThroughOnException() {} }
async function award(customerId, body) {
  const response = await contactsApp.request(`/customers/${customerId}/points`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clientTime: new Date().toISOString(), deviceName: 'Chrome on Windows', deviceTz: 'Asia/Phnom_Penh', ...body }),
  }, {}, executionCtx)
  return { status: response.status, body: await response.json() }
}
const ledgerRows = (customerId = 5) => db.prepare('SELECT id, points, note, created_by_id, created_by_name FROM loyalty_point_adjustments WHERE customer_id = @customerId ORDER BY id').all({ customerId })
const receipts = () => db.prepare("SELECT user_id, user_name, entity_id, details FROM audit_logs WHERE action = 'award_points' ORDER BY id").all()

const ID_A = 'loyalty_points_0f7d4c2e-5a8b-4c1d-9e2f-3a4b5c6d7e8f'
const ID_B = 'loyalty_points_9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'

let failed = 0
async function runTest(name, fn) {
  try {
    db = freshDb()
    actor = ADMIN
    hidePrecheck = 0
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

;(async () => {
  await runTest('a retry with the same id and body replays the committed award instead of adding it twice', async () => {
    const first = await award(5, { points: 25, note: 'Birthday', client_request_id: ID_A })
    assert.equal(first.status, 201)
    const retry = await award(5, { points: 25, note: 'Birthday', client_request_id: ID_A })
    assert.equal(retry.status, 200, JSON.stringify(retry.body))
    assert.equal(retry.body.replayed, true)
    assert.equal(retry.body.id, first.body.id, 'the replay names the ORIGINAL ledger row')
    assert.equal(ledgerRows().length, 1, 'one award, not two')
    assert.equal(receipts().length, 1, 'one audit row, not two')
  })

  await runTest('the receipt is the award\'s own audit row: committed ledger id, username snapshot, request identity', async () => {
    const first = await award(5, { points: 25, note: 'Birthday', client_request_id: ID_A })
    const [row] = ledgerRows()
    assert.equal(row.id, first.body.id)
    assert.equal(row.created_by_name, 'owner', 'actorSnapshot: the USERNAME, never the full name')
    const [receipt] = receipts()
    const details = JSON.parse(receipt.details)
    assert.equal(details.adjustmentId, row.id, 'the audit row carries the ledger row the batch just wrote')
    assert.equal(details.customerName, 'Dara')
    assert.equal(details.membershipNumber, 'LC-5')
    assert.equal(details.points, 25)
    assert.equal(details.note, 'Birthday')
    assert.equal(details.request.id, ID_A)
    assert.deepEqual(JSON.parse(details.request.canonical), { customer_id: 5, points: 25, note: 'Birthday' })
    assert.equal(receipt.user_id, 1)
    assert.equal(receipt.user_name, 'owner')
    assert.equal(Number(receipt.entity_id), 5)
    // Column parity with lib/audit.ts's audit(), which the no-id path still uses.
    await award(5, { points: 1, note: 'Legacy' })
    const [receiptRow, legacyRow] = db.prepare("SELECT user_id, user_name, action, entity, entity_id, table_name, record_id, old_value, new_value = details AS new_is_details, device_name, device_tz FROM audit_logs WHERE action = 'award_points' ORDER BY id").all()
    assert.deepEqual({ ...receiptRow }, { ...legacyRow }, 'the receipt row is shaped exactly like an audit() row')
  })

  await runTest('the same id with different values is refused, never silently replayed or applied', async () => {
    await award(5, { points: 25, note: 'Birthday', client_request_id: ID_A })
    const changed = await award(5, { points: 50, note: 'Birthday', client_request_id: ID_A })
    assert.equal(changed.status, 409)
    assert.equal(changed.body.code, 'idempotency_conflict')
    const otherCustomer = await award(7, { points: 25, note: 'Birthday', client_request_id: ID_A })
    assert.equal(otherCustomer.status, 409, 'an id is one award, whichever customer the retry names')
    assert.equal(ledgerRows().length, 1)
  })

  await runTest('a different id with the same values is a genuine second award', async () => {
    assert.equal((await award(5, { points: 25, note: 'Birthday', client_request_id: ID_A })).status, 201)
    assert.equal((await award(5, { points: 25, note: 'Birthday', client_request_id: ID_B })).status, 201)
    assert.equal(ledgerRows().length, 2)
    assert.equal(receipts().length, 2)
  })

  await runTest('the identity is per actor, like every other receipt', async () => {
    assert.equal((await award(5, { points: 25, note: 'Birthday', client_request_id: ID_A })).status, 201)
    actor = OTHER_ADMIN
    assert.equal((await award(5, { points: 25, note: 'Birthday', client_request_id: ID_A })).status, 201)
    assert.equal(ledgerRows().length, 2)
  })

  await runTest('an older client that sends no id keeps the previous behaviour (and its audit row)', async () => {
    assert.equal((await award(5, { points: 10, note: 'Legacy' })).status, 201)
    assert.equal((await award(5, { points: 10, note: 'Legacy' })).status, 201)
    assert.equal(ledgerRows().length, 2)
    const rows = receipts()
    assert.equal(rows.length, 2)
    assert.equal(JSON.parse(rows[0].details).adjustmentId, ledgerRows()[0].id)
    assert.equal(JSON.parse(rows[0].details).request, undefined)
  })

  await runTest('an id that was sent but is unusable is refused rather than run unprotected', async () => {
    const bad = await award(5, { points: 10, note: 'x', client_request_id: 'bad id!' })
    assert.equal(bad.status, 400)
    assert.equal(bad.body.code, 'invalid_client_request_id')
    assert.equal((await award(5, { points: 10, note: 'x', client_request_id: 42 })).status, 400)
    assert.equal(ledgerRows().length, 0)
  })

  await runTest('a retry that races past the replay check still cannot insert a second award', async () => {
    const first = await award(5, { points: 25, note: 'Birthday', client_request_id: ID_A })
    hidePrecheck = 1
    const raced = await award(5, { points: 25, note: 'Birthday', client_request_id: ID_A })
    assert.equal(hidePrecheck, 0, 'the blind spot was consumed by the route\'s pre-check')
    assert.equal(raced.status, 200, JSON.stringify(raced.body))
    assert.equal(raced.body.replayed, true)
    assert.equal(raced.body.id, first.body.id)
    assert.equal(ledgerRows().length, 1, 'the in-batch receipt check held')
    assert.equal(receipts().length, 1)
  })

  await runTest('permissions and the anonymous-customer guard still come first', async () => {
    actor = { id: 3, username: 'cashier', role_code: 'employee', role_permissions: JSON.stringify({ contacts: true }), permissions: '{}' }
    assert.equal((await award(5, { points: 25, client_request_id: ID_A })).status, 403)
    actor = ADMIN
    assert.equal((await award(6, { points: 25, client_request_id: ID_A })).status, 409)
    assert.equal(ledgerRows(6).length, 0)
    assert.equal(receipts().length, 0)
  })

  if (failed) {
    console.error(`${failed} loyalty award idempotency test(s) failed`)
    process.exit(1)
  }
  console.log('loyalty award idempotency: all cases pass')
})()
