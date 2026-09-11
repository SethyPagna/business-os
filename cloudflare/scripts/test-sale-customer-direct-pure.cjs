// Direct sale-customer assignment through the real Hono route and SQLite transactions.
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
  'saleCustomerAssignmentGuard',
  'actorSnapshot', 'movementBranchName', 'db', 'permissions', 'saleBulkStatus', 'saleBulkUpdate',
  'saleRecordEvents', 'saleTransitions', 'sqlBinding', 'productBatches', 'batchCode', 'salesStatus',
  'undoAppliers', 'branchWrites', 'conflictControl', 'searchMatch', 'paymentMethodRegistry', 'contactOptions', 'anonymousCustomer',
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
    if (name.endsWith('/cache')) return { bumpVersion: async () => {}, getVersionWithFallback: async () => 0 }
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
      (2,'New','022','New road','NEW-MEMBER'),
      (3,'No member','033','Third road',NULL);
    INSERT INTO sales(id,receipt_number,sale_status,branch_id,branch_name,cashier_name,customer_id,customer_name,customer_phone,customer_address,payment_method,updated_at)
    VALUES
      (1,'R1','completed',1,'Shop','Cashier',NULL,NULL,NULL,NULL,'Cash','sale-1-v1'),
      (2,'R2','completed',1,'Shop','Cashier',1,'Old','011','Old road','Cash','sale-2-v1'),
      (3,'R3','completed',1,'Shop','Cashier',99,'Missing snapshot',NULL,NULL,'Cash','sale-3-v1');
    INSERT INTO returns(id,return_number,sale_id,customer_id,customer_name,updated_at)
    VALUES(1,'RET1',1,NULL,NULL,'ret-v1');
  `)
  let beforeBatch = null
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
      if (beforeBatch) { const barrier = beforeBatch; beforeBatch = null; await barrier() }
      return sql.transaction(() => statements.map((statement) => {
        const result = sql.prepare(statement.text).run(...statement.params)
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
  return { sql, call, barrier(fn) { beforeBatch = fn } }
}

function request(overrides = {}) {
  return { client_request_id: 'customer-request-1', expected_updated_at: 'sale-1-v1', customerId: 2, ...overrides }
}

async function run() {
  let f = fixture()
  const assigned = await f.call(1, request())
  assert.equal(assigned.status, 200, JSON.stringify(assigned))
  assert.deepEqual(Object.keys(assigned.body).sort(), ['id', 'updated_at'])
  assert.deepEqual(f.sql.prepare('SELECT customer_id,customer_name,customer_phone,customer_address,updated_at FROM sales WHERE id=1').get(), {
    customer_id: 2, customer_name: 'New', customer_phone: '022', customer_address: 'New road', updated_at: assigned.body.updated_at,
  })
  assert.deepEqual(f.sql.prepare('SELECT customer_id,customer_name,updated_at FROM returns WHERE id=1').get(), {
    customer_id: 2, customer_name: 'New', updated_at: assigned.body.updated_at,
  })
  const event = f.sql.prepare("SELECT * FROM sale_record_events WHERE source_kind='sale_customer'").get()
  assert.equal(event.kind, 'customer_changed')
  assert.equal(event.source_id, 'actor:1:request:customer-request-1')
  assert.deepEqual(JSON.parse(event.response_json), assigned.body)
  const changes = JSON.parse(event.changes_json)
  assert.deepEqual(changes.map((change) => change.field), ['customer', 'membership'])
  assert.deepEqual(changes[0].before, { state: 'known_none' })
  assert.deepEqual(changes[0].after, { state: 'known_value', value: { id: 2, name: 'New' } })
  assert.deepEqual(changes[1].before, { state: 'known_none' })
  assert.equal(changes[1].after.value.number, 'NEW-MEMBER')
  assert.ok(!event.changes_json.includes('022') && !event.changes_json.includes('New road'))
  console.log('PASS General assignment writes one changed-only private-safe event with exact linked return snapshot')

  f.sql.prepare("UPDATE customers SET name='Changed later',membership_number='LATER' WHERE id=2").run()
  f.sql.prepare("UPDATE sales SET notes='mutable after success' WHERE id=1").run()
  const replay = await f.call(1, request())
  assert.deepEqual(replay, assigned)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sale_record_events WHERE source_kind='sale_customer'").get().n, 1)
  assert.equal((await f.call(2, request({ expected_updated_at: 'sale-2-v1' }))).status, 409)
  user = { ...user, id: 2, username: 'other' }
  const otherActor = await f.call(2, request({ expected_updated_at: 'sale-2-v1' }))
  assert.equal(otherActor.status, 200, JSON.stringify(otherActor))
  user = { ...user, id: 1, username: 'admin' }
  console.log('PASS exact retry precedes mutable reads; key reuse is target-bound and actor-scoped')

  f = fixture()
  const initial = JSON.stringify(f.sql.prepare('SELECT * FROM sales WHERE id=1').get())
  assert.equal((await f.call(1, { expected_updated_at: 'sale-1-v1', customerId: 2 })).status, 400)
  assert.equal((await f.call(1, request({ client_request_id: 'missing-version', expected_updated_at: undefined }))).status, 400)
  assert.equal((await f.call(1, request({ client_request_id: 'stale', expected_updated_at: 'stale' }))).status, 409)
  assert.equal(JSON.stringify(f.sql.prepare('SELECT * FROM sales WHERE id=1').get()), initial)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sale_record_events WHERE source_kind='sale_customer'").get().n, 0)
  console.log('PASS missing request/version and stale versions are typed non-mutating failures')

  f = fixture()
  const noOp = await f.call(2, request({ client_request_id: 'same-target', expected_updated_at: 'sale-2-v1', customerId: 1 }))
  assert.equal(noOp.status, 200)
  assert.deepEqual(noOp.body, { id: 2, updated_at: 'sale-2-v1' })
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sale_record_events WHERE source_kind='sale_customer'").get().n, 0)
  console.log('PASS identical assignment is a true no-op and creates no vague record')

  f = fixture()
  f.barrier(() => f.sql.prepare("UPDATE customers SET membership_number='RACED' WHERE id=2").run())
  const raced = await f.call(1, request({ client_request_id: 'target-race' }))
  assert.equal(raced.status, 409, JSON.stringify(raced))
  assert.equal(f.sql.prepare('SELECT customer_id FROM sales WHERE id=1').get().customer_id, null)
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sale_record_events WHERE source_kind='sale_customer'").get().n, 0)
  console.log('PASS target identity and membership are guarded in the commit batch')

  f = fixture()
  const missingSource = await f.call(3, request({ client_request_id: 'missing-source', expected_updated_at: 'sale-3-v1', customerId: 3 }))
  assert.equal(missingSource.status, 200, JSON.stringify(missingSource))
  const missingChanges = JSON.parse(f.sql.prepare("SELECT changes_json FROM sale_record_events WHERE sale_id=3").get().changes_json)
  assert.deepEqual(missingChanges.find((change) => change.field === 'membership').before, { state: 'unknown' })
  assert.deepEqual(missingChanges.find((change) => change.field === 'membership').after, { state: 'known_none' })
  console.log('PASS missing historical source membership stays unknown without current-profile fabrication')
  const guardDb = { prepare: sql => ({
    get: async params => f.sql.prepare(sql).get(params || {}),
    all: async params => f.sql.prepare(sql).all(params || {}),
  }) }
  await assert.rejects(() => load('lib/saleCustomerAssignmentGuard.ts').prepareCustomerAssignments(guardDb, [{ id: 3, sourceId: 3, targetId: 99 }]), error => error.statusCode === 409,
    'the replay guard must never restore a deleted destination')
  for (const [label, setup] of [
    ['usd', 'UPDATE sales SET total_usd=50 WHERE id=3'],
    ['khr', 'UPDATE sales SET total_khr=205000 WHERE id=3'],
    ['redemption', 'UPDATE sales SET membership_points_redeemed=100 WHERE id=3'],
    ['refund', "INSERT INTO returns(id,return_number,sale_id,customer_id,total_refund_usd) VALUES(9,'ORPHAN-REFUND',3,99,50)"],
    ['other-return-account', "INSERT INTO returns(id,return_number,sale_id,customer_id,total_refund_usd) VALUES(9,'OTHER-ACCOUNT',3,1,0)"],
  ]) {
    f=fixture();f.sql.exec(setup)
    const before=JSON.stringify(['sales','returns','sale_record_events','sale_write_revisions'].map(table=>f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
    const result=await f.call(3,request({client_request_id:'orphan-'+label,expected_updated_at:'sale-3-v1',customerId:3}))
    assert.equal(result.status,409,JSON.stringify(result))
    assert.equal(JSON.stringify(['sales','returns','sale_record_events','sale_write_revisions'].map(table=>f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())),before)
  }
  console.log('PASS orphan repair is zero-value/source-only; earned, redeemed, refund and mismatched-return cases stay unchanged; deleted replay target rejected')

  f = fixture()
  f.sql.prepare('UPDATE customers SET is_anonymous=1 WHERE id=1').run()
  const clearMarkedGeneral = await f.call(2, request({ client_request_id: 'clear-marked-general', expected_updated_at: 'sale-2-v1', clearAssignment: true, customerId: undefined }))
  assert.deepEqual(clearMarkedGeneral, { status: 200, body: { id: 2, updated_at: 'sale-2-v1' } })
  assert.equal(f.sql.prepare('SELECT customer_id FROM sales WHERE id=2').get().customer_id, 1, 'semantic General clear preserves the historical marked id')
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sale_record_events WHERE source_kind='sale_customer'").get().n, 0)
  const markedGeneral = await f.call(2, request({ client_request_id: 'marked-general', expected_updated_at: 'sale-2-v1', customerId: 3 }))
  assert.equal(markedGeneral.status, 200, JSON.stringify(markedGeneral))
  const markedChanges = JSON.parse(f.sql.prepare("SELECT changes_json FROM sale_record_events WHERE sale_id=2").get().changes_json)
  assert.deepEqual(markedChanges.find((change) => change.field === 'customer').before, { state: 'known_none' })
  assert.equal(markedChanges.some((change) => change.field === 'membership'), false, 'unchanged absent membership must not be displayed')
  const anonymousTarget = await f.call(3, request({ client_request_id: 'anonymous-target', expected_updated_at: 'sale-3-v1', customerId: 1 }))
  assert.equal(anonymousTarget.status, 400, JSON.stringify(anonymousTarget))
  assert.equal(anonymousTarget.body.code, 'anonymous_customer_immutable')
  console.log('PASS direct assignment treats a marked source as General and rejects it as a target')

  f = fixture()
  f.sql.exec("CREATE TRIGGER reject_customer_event BEFORE INSERT ON sale_record_events WHEN NEW.source_kind='sale_customer' BEGIN SELECT RAISE(ABORT,'event rejected'); END;")
  const beforeFailure = JSON.stringify(['sales', 'returns', 'sale_record_events'].map((table) => f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
  const rejected = await f.call(1, request({ client_request_id: 'event-failure' }))
  assert.equal(rejected.status, 500, JSON.stringify(rejected))
  assert.equal(JSON.stringify(['sales', 'returns', 'sale_record_events'].map((table) => f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())), beforeFailure)
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM sale_bulk_guards').get().n, 0)
  console.log('PASS event failure rolls back sale and linked return snapshots with no leaked guard')
}

run().catch((error) => { console.error(error); process.exit(1) })
