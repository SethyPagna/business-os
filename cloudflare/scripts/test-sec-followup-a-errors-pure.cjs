// Raw error text must not reach a signed-in caller (security review a77883c78, should-fix 5): a D1/driver/runtime error names
// tables and SQL. Real Hono routes (sales, action history) over SQLite carrying every migration; the D1 failure is the
// shape the Worker really sees ("D1_ERROR: ...: SQLITE_..."). Run (from cloudflare/): node scripts/test-sec-followup-a-errors-pure.cjs
const productStockGuard = require('./harness/product_stock_guard.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
const { sqliteD1Call } = require('./harness/sqlite_d1_bindings.cjs')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
const recordContract = JSON.parse(fs.readFileSync(path.join(root, '..', 'outputs', 'takeover-20260908', 'f74-sales-records-backend-contract.json'), 'utf8'))
const user = { id: 1, name: 'Admin', username: 'admin', role_code: 'admin', permissions: { all: true } }
const cache = new Map()
const actual = new Set(['stockTransaction', 'acquisitionCostAccess', 'courierCostAccess', 'actorSnapshot', 'businessDateWindow', 'businessMaintenanceGuard', 'movementBranchName', 'db', 'permissions', 'saleBulkStatus', 'saleBulkUpdate', 'saleRecordEvents', 'saleTransitions', 'saleTotals', 'sqlBinding', 'productBatches', 'batchCode', 'salesStatus', 'saleStatusResolution', 'financialPrecision', 'undoAppliers', 'branchWrites', 'branchRoles', 'branchRoleGuards', 'branchEffect', 'conflictControl', 'searchMatch', 'returnRefundSplit', 'failureText', 'stockMovementReplay', 'saleCustomerAssignmentGuard', 'loyaltyEligibility', 'customerPointsReturn', 'anonymousCustomer', 'paymentMethodRegistry', 'contactOptions'])
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const mod = { exports: {} }; cache.set(rel, mod)
  const output = ts.transpileModule(fs.readFileSync(path.join(root, 'src', rel), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const req = (name) => {
    if (name.endsWith('/productStockGuard')) return productStockGuard
    if (name === 'hono') return require(name)
    if (name.endsWith('/auth')) return { requireAuth: async (c, next) => { c.set('user', user); return next() } }
    if (name.endsWith('/cache')) return { bumpVersion: async () => {}, bumpVersions: async () => {}, getVersionWithFallback: async () => 0 }
    if (name.endsWith('/broadcastHub')) return { broadcast: async () => {} }
    if (name.endsWith('/audit')) return { audit: async () => {} }
    if (name.endsWith('/telegram')) return { formatSaleTelegramLines: () => [], formatSaleStatusTelegramLines: () => [], sendTelegramEvent: async () => {}, telegramMoney: () => '' }
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

const D1_TEXT = 'D1_ERROR: no such table: audit_logs_archive: SQLITE_ERROR'
const LEAKS = /D1_ERROR|SQLITE|audit_logs|UNIQUE constraint|no such table|branches/i

function fixture() {
  const sql = new Database(':memory:')
  sql.pragma('foreign_keys = OFF')
  for (const file of fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) sql.exec(fs.readFileSync(path.join(root, 'migrations', file), 'utf8'))
  seedStockFixture(sql, () => sql.exec("INSERT INTO branches(id,name) VALUES(1,'Shop'),(2,'Warehouse'); INSERT INTO products(id,name,stock_quantity) VALUES(1,'A',100); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(1,1,100)"))
  let failStatement = null, failRead = null
  const env = { DB: {
    prepare(text) {
      return { bind(...params) {
        const guard = () => { if (failRead && failRead.test(text)) throw new Error(D1_TEXT) }
        return { text, params,
          async first() { guard(); return sqliteD1Call(sql.prepare(text), 'get', params) || null },
          async all() { guard(); return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
          async run() { guard(); const r = sqliteD1Call(sql.prepare(text), 'run', params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } } }
      } }
    },
    async batch(statements) {
      return sql.transaction(() => statements.map((s) => { if (failStatement && s.text.includes(failStatement)) throw new Error(D1_TEXT); const r = sqliteD1Call(sql.prepare(s.text), 'run', s.params); return { meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } } }))()
    },
  } }
  const ctx = { waitUntil() {}, passThroughOnException() {} }
  const send = async (app, url, body, method = 'POST') => {
    const response = await app.request(url, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) }, env, ctx)
    const text = await response.text()
    let parsed; try { parsed = JSON.parse(text) } catch { parsed = { error: text } }
    return { status: response.status, body: parsed, text }
  }
  return { sql, send, failStatement(text) { failStatement = text }, failRead(pattern) { failRead = pattern } }
}

const sales = load('routes/sales.ts').default
const history = load('routes/actionHistory.ts').default
const { authoredFailureMessage } = load('lib/failureText.ts')
const { UndoConflictError } = load('lib/undoAppliers.ts')
const { SaleBulkError } = load('lib/saleBulkStatus.ts')

const quiet = async (fn) => { const original = console.error; const logged = []; console.error = (...args) => logged.push(args); try { return [await fn(), logged] } finally { console.error = original } }
let checks = 0
const failures = []
// A red base should name every half that fails, so a failure is recorded and the next check still runs.
async function check(name, fn) {
  try { await fn(); checks += 1; console.log(`PASS ${name}`) } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}`)
    console.log(`     ${String(error.message).split('\n').slice(0, 3).join(' | ')}`)
  }
}

async function main() {
  await check('classifier: an operator sentence travels, D1/driver/runtime text does not', () => {
    class SqliteError extends Error { constructor(message) { super(message); this.name = 'SqliteError'; this.code = 'SQLITE_ERROR' } }
    for (const authored of [
      new UndoConflictError('This branch was edited after this change, so it can no longer be undone. Nothing was changed.'),
      new SaleBulkError('Not fully paid: R1.', 400, { code: 'insufficient_payment_for_status' }),
      new Error('The branch this action changed no longer exists, so it cannot be reversed.'),
      Object.assign(new Error('Another tab replayed this.'), { statusCode: 409 }),
      Object.assign(new Error('Stock moved.'), { code: 'undo_record_changed' }),
      new Error('The quantity exceeded what is on hand.'),
    ]) assert.equal(authoredFailureMessage(authored), authored.message)
    for (const raw of [
      new Error(D1_TEXT), new Error('D1_ERROR: no such table: branches: SQLITE_ERROR'), new Error('NOT NULL constraint failed: branches.name'),
      new Error('D1 DB storage operation exceeded timeout which caused object to be reset.'), new Error('internal error; reference = 0a1b2c3d'),
      new TypeError("Cannot read properties of undefined (reading 'id')"), new RangeError('Invalid array length'), new SyntaxError('Unexpected token'),
      new SqliteError('no such table: sales'), Object.assign(new Error('boom'), { code: 'ERR_SQLITE_ERROR' }), new Error(''), new Error('x'.repeat(401)),
      new Error('line one\n    at handler (/src/routes/sales.ts:12:3)'), 'a thrown string', null, undefined,
    ]) assert.equal(authoredFailureMessage(raw), null, String(raw && raw.message || raw))
  })

  await check('sales /bulk-status: a D1 failure answers fixed text and a code, the detail goes to the log', async () => {
    const f = fixture()
    seedStockFixture(f.sql, () => f.sql.exec("INSERT INTO sales(id,receipt_number,sale_status,branch_id,updated_at) VALUES(1,'R1','awaiting_payment',1,'same-second'); INSERT INTO sale_items(id,sale_id,product_id,product_name,quantity,branch_id) VALUES(1,1,1,'A',2,1)"))
    const request = { client_request_id: 'sec-followup-a-1', target_status: 'completed', items: f.sql.prepare('SELECT id,sale_status expected_status,updated_at expected_updated_at FROM sales ORDER BY id').all() }
    f.failStatement('INSERT INTO audit_logs')
    const [res, logged] = await quiet(() => f.send(sales, '/bulk-status', request))
    assert.equal(res.status, 500, JSON.stringify(res.body))
    assert.equal(res.body.error, 'Failed to change the sale status.')
    assert.equal(res.body.code, 'sale_bulk_status_failed')
    assert.doesNotMatch(res.text, LEAKS)
    assert.ok(logged.some((line) => String(line[1]?.message || line[1]).includes('D1_ERROR')), 'the detail is in the server log')
    f.failStatement(null)
    // controls: a refusal the library worded is kept (409 stale), a bad body is a 400, and the same request then succeeds
    const stale = await f.send(sales, '/bulk-status', { ...request, client_request_id: 'sec-followup-a-2', items: request.items.map((item) => ({ ...item, expected_status: 'cancelled' })) })
    assert.ok([400, 409].includes(stale.status), JSON.stringify(stale))
    assert.ok(stale.body.error && stale.body.error !== 'Failed to change the sale status.', 'an authored refusal keeps its own sentence: ' + JSON.stringify(stale.body))
    const bad = await f.send(sales, '/bulk-status', '{not json')
    assert.equal(bad.status, 400)
    assert.equal(bad.body.error, 'The request body must be valid JSON.')
    assert.doesNotMatch(bad.text, /Unexpected token|position/)
    assert.equal((await f.send(sales, '/bulk-status', request)).status, 200, 'control: nothing else changed')
  })

  await check('sales /bulk-update: the same rule', async () => {
    const f = fixture()
    seedStockFixture(f.sql, () => f.sql.exec(`
      INSERT INTO settings(key,value,updated_at) VALUES('pos_payment_methods','["Cash","ABA","Card"]','settings-v1') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
      INSERT INTO sales(id,receipt_number,sale_status,branch_id,payment_method,payment_details,payment_currency,exchange_rate,amount_paid_usd,amount_paid_khr,updated_at)
        VALUES(1,'R1','completed',1,'Cash','[{"method":"Cash","amount_usd":2.5,"amount_khr":0}]','USD',4100,2.5,0,'same-second')`))
    const request = { client_request_id: 'sec-followup-a-3', items: [{ id: 1, expected_updated_at: 'same-second' }], action: { kind: 'payment_method', source: 'Cash', target: 'Card' } }
    f.failStatement('INSERT INTO audit_logs')
    const [res, logged] = await quiet(() => f.send(sales, '/bulk-update', request))
    assert.equal(res.status, 500, JSON.stringify(res.body))
    assert.equal(res.body.error, 'Failed to update the sales.')
    assert.equal(res.body.code, 'sale_bulk_update_failed')
    assert.doesNotMatch(res.text, LEAKS)
    assert.ok(logged.some((line) => String(line[1]?.message || line[1]).includes('D1_ERROR')))
    f.failStatement(null)
    assert.equal((await f.send(sales, '/bulk-update', request)).status, 200, 'control: the same request succeeds once the fault clears')
  })

  await check('sales: no 500 path interpolates the raw error message any more', () => {
    const source = fs.readFileSync(path.join(root, 'src', 'routes', 'sales.ts'), 'utf8')
    assert.doesNotMatch(source, /error: `Failed to [^`]*\$\{(?:\(error as Error\)\.message|message)\b/, 'a "Failed to ...: <detail>" 500')
    assert.doesNotMatch(source, /return c\.json\(\{ error: \(error as Error\)\.message, \.\.\.\(error instanceof SaleBulkError/, 'the bulk handlers echo the message')
    for (const code of ['sale_items_write_failed', 'sale_add_items_failed', 'sale_delivery_failed', 'sale_delivery_cost_failed', 'sale_delivery_fee_failed', 'sale_amend_failed', 'sale_bulk_status_failed', 'sale_bulk_update_failed']) {
      assert.ok(source.includes(`'${code}'`), code)
    }
  })

  const branchPayload = (fields) => JSON.stringify({ applier: 'branch.update', id: 1, fields })
  const addHistory = (f, id, undo) => f.sql.prepare("INSERT INTO action_history(id,scope,entity,entity_id,label,reversible,status,undo_payload,redo_payload,created_by_id) VALUES(?, 'global','branch','1','Edit branch',1,'undoable',?,?,1)").run(id, undo, undo)

  await check('action history undo: a D1 failure answers fixed text + code and stores the same text in last_error', async () => {
    const f = fixture()
    addHistory(f, 10, branchPayload({ name: 'Old' }))
    f.failRead(/FROM branches/i)
    const [res, logged] = await quiet(() => f.send(history, '/10/undo', { require_applied: true }))
    assert.equal(res.status, 500, JSON.stringify(res.body))
    assert.equal(res.body.error, 'Failed to undo this action')
    assert.equal(res.body.code, 'action_replay_failed')
    assert.doesNotMatch(res.text, LEAKS)
    const stored = f.sql.prepare('SELECT last_error, status FROM action_history WHERE id=10').get()
    assert.equal(stored.last_error, 'Failed to undo this action', 'last_error is the fixed text, not the driver message')
    assert.equal(stored.status, 'undoable', 'a failed undo leaves the action retryable')
    assert.ok(logged.some((line) => String(line[1]?.message || line[1]).includes('D1_ERROR')))
  })

  await check('action history undo: an authored plain-Error sentence still reaches the operator (and is what last_error holds)', async () => {
    const f = fixture()
    addHistory(f, 11, JSON.stringify({ applier: 'branch.update', id: 999, fields: { name: 'Old' } }))
    const res = await f.send(history, '/11/undo', { require_applied: true })
    assert.equal(res.status, 500)
    assert.equal(res.body.error, 'The branch this action changed no longer exists, so it cannot be reversed.')
    assert.equal(res.body.code, undefined, 'an authored sentence carries no replay-failed code')
    assert.equal(f.sql.prepare('SELECT last_error FROM action_history WHERE id=11').get().last_error, res.body.error)
  })

  await check('stock revert preview: a D1 failure is fixed text, a refusal keeps its sentence and code', async () => {
    const f = fixture()
    const missing = await f.send(history, '/movements/999/revert-preview', undefined, 'GET')
    assert.equal(missing.status, 404, JSON.stringify(missing.body))
    assert.ok(missing.body.error && missing.body.error !== 'Unable to preview this stock action.', 'control: an authored refusal is kept')
    f.failRead(/inventory_movements/i)
    const [res, logged] = await quiet(() => f.send(history, '/movements/1/revert-preview', undefined, 'GET'))
    assert.equal(res.status, 500, JSON.stringify(res.body))
    assert.equal(res.body.error, 'Unable to preview this stock action.')
    assert.equal(res.body.code, 'action_replay_failed')
    assert.doesNotMatch(res.text, LEAKS)
    assert.ok(logged.length > 0)
  })

  console.log(`\n${checks} checks passed, ${failures.length} failed`)
  if (failures.length) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
