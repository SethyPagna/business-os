// CUTOVER-LR stock writers: one world for the scripts/test-cutover-lr-*-pure.cjs files.
//
// The REAL route and lib modules run against an in-memory SQLite with every migration applied, through the real
// lib/db.ts D1Compat. Only side channels are replaced: the session (requireAuth), the audit insert, broadcasts,
// KV cache bumps and Telegram sends.
//
// An ORACLE world loads the files CUTOVER-LR changed exactly as they were at eb5dd0ba3 (before this change), so a
// test can prove that while every branch is active the new code writes byte-identical statements.
//
// Branch fixtures follow production ids: 1 = LC Store (formerly Warehouse), 2 = Shop. 'before' = both active (today),
// 'after' = the consolidation's end state (Old Shop disabled, successor 1, all stock moved to LC Store, lot 500
// folded into lot 600), 'orphan' = Old Shop disabled with no successor and no other active branch.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const Database = require('better-sqlite3')
const { sqliteD1Call } = require('./sqlite_d1_bindings.cjs')
const { loadAll } = require('./load_migrations.cjs')

const ORACLE = 'da2004932b4510df0effee0399bc002b14d97372'
const ORACLE_FILES = new Set([
  'routes/inventory.ts', 'routes/batches.ts', 'routes/stockInCommit.ts', 'routes/products.ts', 'routes/reviewQueue.ts', 'routes/shifts.ts',
  'lib/stockLotAdjustment.ts', 'lib/stockSession.ts', 'lib/stockRevert.ts', 'lib/stockInLineEdit.ts', 'lib/productWrites.ts', 'lib/reviewApply.ts',
])
const USER = { id: 71, username: 'owner', name: 'Owner', role: 'admin', permissions: JSON.stringify({ all: true }) }
const executionCtx = { waitUntil(promise) { promise?.catch?.(() => {}) }, passThroughOnException() {} }
const noop = async () => {}

function makeWorld(oracleSha = null, { user = USER } = {}) {
  const cache = new Map()
  const partial = {
    'lib/auth.ts': { requireAuth: async (c, next) => { c.set('user', user); return next() } },
    'lib/audit.ts': { audit: noop },
    'durable-objects/broadcastHub.ts': { broadcast: noop },
    'lib/cache.ts': { bumpVersion: noop, bumpVersions: noop, getVersionWithFallback: async () => '0', cachedJsonResponse: async (_r, _c, _k, _t, loader) => loader() },
    'lib/telegram.ts': { sendTelegramEvent: async () => false, sendTelegramShiftReport: async () => false, scheduleTelegramShiftOverview: async () => ({}), sendReturnTelegramEvent: async () => false },
  }
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(__dirname, '..', '..', 'src', rel)
    const text = oracleSha && ORACLE_FILES.has(rel)
      ? execFileSync('git', ['show', `${oracleSha}:cloudflare/src/${rel}`], { cwd: path.join(__dirname, '..', '..', '..'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      : fs.readFileSync(sourcePath, 'utf8')
    const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    if (partial[rel]) mod.exports = Object.assign({}, mod.exports, partial[rel])
    return mod.exports
  }
  return { load }
}

let template = null
function migratedDb() {
  if (!template) {
    const seed = new Database(':memory:')
    seed.pragma('foreign_keys = OFF')
    for (const migration of loadAll()) seed.exec(migration)
    template = seed.serialize()
    seed.close()
  }
  const db = new Database(template)
  db.pragma('foreign_keys = OFF')
  return db
}

// The D1 binding lib/db.ts wraps. `capture` collects every write in order: each batch as one entry, each
// non-SELECT prepare().run() as a one-statement entry.
function binding(sql, capture = null) {
  return {
    prepare(text) {
      return {
        bind(...params) {
          return {
            text, params,
            async first() { return sqliteD1Call(sql.prepare(text), 'get', params) || null },
            async all() { return { results: sqliteD1Call(sql.prepare(text), 'all', params) } },
            async run() {
              if (capture && !/^\s*(SELECT|WITH)\b/i.test(text)) capture.push([{ sql: text, params }])
              const r = sqliteD1Call(sql.prepare(text), 'run', params)
              return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
            },
          }
        },
      }
    },
    async batch(statements) {
      if (capture) capture.push(statements.map((statement) => ({ sql: statement.text, params: statement.params })))
      return sql.transaction(() => statements.map((statement) => {
        const stmt = sql.prepare(statement.text)
        if (stmt.reader) return { results: sqliteD1Call(stmt, 'all', statement.params), meta: { changes: 0, last_row_id: 0 } }
        const r = sqliteD1Call(stmt, 'run', statement.params)
        return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
      }))()
    },
  }
}

// The release made client_request_id mandatory on stock-changing writes (N13); the oracle world predates it and ignores
// the field, so one fresh id per call keeps both worlds answering the same request.
// The counter is per database, so the oracle and the new world number the same request alike (the statement lists compare equal).
const requestSerials = new WeakMap()
const NEEDS_REQUEST_ID = new RegExp('/(adjust|tagged-lots/(dispose|restore))$')
function withRequestId(db, method, url, body) {
  if (method !== 'POST' || !NEEDS_REQUEST_ID.test(String(url).split('?')[0]) || !body || typeof body !== 'object' || Array.isArray(body) || body.client_request_id) return body
  const serial = (requestSerials.get(db) || 0) + 1
  requestSerials.set(db, serial)
  return { ...body, client_request_id: `lr_world_${String(serial).padStart(8, '0')}` }
}

async function call(app, db, method, url, body, { redirect = null, capture = null, headers = {} } = {}) {
  body = withRequestId(db, method, url, body)
  const response = await app.request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(redirect == null ? {} : { 'x-branch-redirect': String(redirect) }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, { DB: binding(db, capture) }, executionCtx)
  const text = await response.text()
  let json; try { json = JSON.parse(text) } catch { json = { error: text } }
  return { status: response.status, body: json }
}

// Products 10 (lots 500 at Shop, 600 at LC Store, both received 2026-09-01) and 20 (lot 700 at LC Store only).
function build(state) {
  const db = migratedDb()
  db.exec('DELETE FROM branches')
  if (state === 'before') {
    db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Warehouse',0,1)").run()
    db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Shop',1,1)").run()
  } else {
    db.prepare("INSERT INTO branches(id,name,role,canonical_key,is_default,is_active) VALUES(1,'LC Store','shop','warehouse',1,1)").run()
    db.prepare("INSERT INTO branches(id,name,role,canonical_key,is_default,is_active,successor_branch_id) VALUES(2,'Old Shop','shop','shop',0,0,?)").run([state === 'orphan' ? null : 1])
  }
  db.prepare(`INSERT INTO suppliers(id,name) VALUES(5,'Acme')`).run()
  db.prepare(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
              VALUES(10,'Powder','POWDER','8850001',15,9.5,38000,4,16000,1),(20,'Cream','CREAM','8850002',6,7,28000,3,12000,1)`).run()
  db.prepare(`INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,expiry_date,received_at,is_active,batch_number,unit_cost_usd,supplier_id,supplier_name,received_quantity,received_cost_usd)
              VALUES(500,10,'2026-09-01','POWDER-S','2027-06-01','2026-09-01',1,1,4,5,'Acme',10,40),
                    (600,10,'2026-09-01#2','POWDER-W','2027-06-01','2026-09-01',1,2,4,5,'Acme',5,20),
                    (700,20,'2026-09-02','CREAM-W',NULL,'2026-09-02',1,1,3,5,'Acme',6,18)`).run()
  if (state === 'before') {
    db.exec(`INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,2,10),(10,1,5),(20,1,6);
             INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,2,10),(600,1,5),(700,1,6);`)
  } else {
    db.exec(`INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,2,0),(10,1,15),(20,1,6);
             INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(500,2,0),(600,1,15),(700,1,6);`)
    db.prepare("INSERT INTO audit_logs(user_name,action,entity,entity_id,details) VALUES('op','branch_cutover_lot_fold','product_batch','600',?)")
      .run([JSON.stringify({ operationId: 'op-1', productId: 10, survivorBatchId: 600, foldedBatchIds: [500], branchId: 1 })])
  }
  return db
}

const LEDGER_TABLES = ['branch_stock', 'branch_batch_stock', 'products', 'product_batches', 'inventory_movements', 'damaged_stock_lots',
  'stock_session_operations', 'stock_session_members', 'stock_lot_adjustment_operations', 'action_history', 'shift_sessions']
const ledger = (db) => JSON.stringify(LEDGER_TABLES.map((table) => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
const plain = (value) => JSON.parse(JSON.stringify(value))
const oldShop = (db) => plain(db.prepare(`SELECT 'branch_stock' t, product_id k, quantity FROM branch_stock WHERE branch_id=2
  UNION ALL SELECT 'branch_batch_stock', batch_id, quantity FROM branch_batch_stock WHERE branch_id=2 ORDER BY 1,2`).all())
const movements = (db, since = 0) => plain(db.prepare(`SELECT product_id, branch_id, branch_name, addressed_branch_name, movement_type, quantity, batch_id
  FROM inventory_movements WHERE id > ? ORDER BY id`).all([since]))
const maxMovement = (db) => Number(db.prepare('SELECT COALESCE(MAX(id),0) n FROM inventory_movements').get().n)
const qty = (db, table, key, id, branch) => db.prepare(`SELECT quantity FROM ${table} WHERE ${key}=? AND branch_id=?`).get([id, branch])?.quantity ?? null

const scrub = (text) => text
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
  .replace(/\d{4}-\d{2}-\d{2}[ T][\d:.]+Z?/g, '<ts>')
  .replace(/"request_digest":"[0-9a-f]{64}"/g, '"request_digest":"<digest>"')
  // A shift code carries the opening minute (S-<yyyymmdd>-<HHMM>-<cashier>); the oracle and the current run can
  // straddle a minute boundary, which is clock noise, not a behaviour change.
  .replace(/\bS-\d{8}-\d{4}-/g, 'S-<date>-<hhmm>-')
  // stock-lot-0193 (not LR) reworded the dated Set movement reason after the eb5dd0ba3 oracle: "Set received date to 7"
  // became "Set received 2026-09-01 from 10 to 7". Same row, same quantity; only the wording differs.
  .replace(/Set received (?:date|\d{4}-\d{2}-\d{2}(?: from \d+)?) to (\d+)/g, 'Set received <lot> to $1')
const normalised = (capture) => scrub(JSON.stringify(capture))

function assertComposedWrites(current, previous, db) {
  const receipt = (s) => /stock_mutation_receipts/.test(s.sql)
  const movement = (s) => /INSERT INTO inventory_movements/.test(s.sql)
  const cost = (s) => /UPDATE products SET\s+cost_price_usd/.test(s.sql)
  const physical = (s) => /(?:INSERT INTO|UPDATE) branch_(?:batch_)?stock/.test(s.sql)
  const writes = current.flat(), oldWrites = previous.flat()
  const business = (rows) => rows.filter(s => !receipt(s) && !movement(s) && !cost(s))
  assert.equal(normalised(business(writes)), normalised(business(oldWrites)), 'same ordered business guards, stock metadata, quantities and history statements')
  assert.equal(normalised(writes.filter(cost)), normalised(oldWrites.filter(cost)), 'same catalog cost expression and bindings')
  assert.equal(writes.filter(movement).length, oldWrites.filter(movement).length, 'same movement count; complete movement values are compared in the ledger')
  const batch = current.find(rows => rows.some(physical))
  assert.ok(batch, 'stock effects are captured in a transaction')
  const guard = s => /^(?:SELECT CASE|INSERT INTO stock_session_guards|DELETE FROM stock_session_guards)/i.test(s.sql.trim())
  assert.deepEqual(batch.filter(guard), writes.filter(guard), 'mandatory business guards share the physical stock transaction')
  const completion = writes.find(s => /UPDATE stock_mutation_receipts SET response_status/.test(s.sql))
  if (!completion) return
  const marks = batch.filter(s => /UPDATE stock_mutation_receipts SET written=1/.test(s.sql))
  if (!marks.length) {
    const unchangedGroups = rows => rows.map(group => group.filter(s => !receipt(s))).filter(group => group.length)
    assert.equal(normalised(unchangedGroups(current)), normalised(unchangedGroups(previous)), 'legacy explicit-lot path retains its existing transaction grouping')
    assert.ok(writes.some(s => /UPDATE stock_mutation_receipts SET written=1/.test(s.sql)))
    return
  }
  assert.equal(marks.length, 1, 'required written receipt shares the stock transaction')
  assert.ok(batch.some(movement), 'movement shares the stock transaction')
  if (writes.some(cost)) {
    assert.ok(batch.some(cost), 'catalog cost shares the intake transaction')
    assert.ok(batch.findIndex(movement) < batch.findIndex(cost), 'intake history precedes derived catalog cost')
  }
  assert.ok(current.indexOf(batch) < current.findIndex(rows => rows.includes(completion)), 'receipt completion follows the atomic stock transaction')
  const rows = db.prepare('SELECT written,completed_at,response_status FROM stock_mutation_receipts').all()
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0].written, rows[0].response_status], [1, 200])
  assert.ok(rows[0].completed_at, 'receipt is durably completed')
}


// The redirect refusal for Old Shop (2) with LC Store (1) as its successor and only target.
const REDIRECT = (requested = null) => ({ addressed_branch_id: 2, addressed_branch_name: 'Old Shop', successor_branch_id: 1, successor_branch_name: 'LC Store', targets: [{ id: 1, name: 'LC Store' }], requested_target_id: requested })

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }
function done() { console.log(`${passed} checks passed`) }

// The three answers every writer gives on the post-cutover world, each proven to write nothing: no header, the
// disabled branch itself as the target, an unknown branch as the target.
async function assertRefusals(db, send, label) {
  const before = ledger(db)
  const asked = await send(null)
  assert.equal(asked.status, 409, `${label}: no header: ${JSON.stringify(asked.body)}`)
  assert.equal(asked.body.code, 'branch_redirect_required', `${label}: ${JSON.stringify(asked.body)}`)
  assert.deepEqual(asked.body.redirect, REDIRECT(null), `${label}: the refusal carries the disabled branch, its successor and the targets`)
  assert.equal(ledger(db), before, `${label}: the refusal writes nothing`)
  for (const target of [2, 99]) {
    const bad = await send(target)
    assert.equal(bad.status, 409, `${label}: target ${target}: ${JSON.stringify(bad.body)}`)
    assert.equal(bad.body.code, 'branch_redirect_target_invalid', `${label}: target ${target}`)
    assert.deepEqual(bad.body.redirect, REDIRECT(target))
    assert.equal(ledger(db), before, `${label}: an invalid target ${target} writes nothing`)
  }
}

// Deactivates the confirmed target the moment the first write batch starts (after every read and plan), so the
// in-batch guard is what refuses. Returns a binding for app.request.
function raceBinding(db, onFirstBatch) {
  const inner = binding(db)
  let fired = false
  return {
    prepare: (text) => inner.prepare(text),
    async batch(statements) {
      if (!fired) { fired = true; onFirstBatch() }
      return inner.batch(statements)
    },
  }
}
async function callWith(app, dbBinding, method, url, body, redirect) {
  body = withRequestId(dbBinding, method, url, body)
  const response = await app.request(url, {
    method, headers: { 'content-type': 'application/json', ...(redirect == null ? {} : { 'x-branch-redirect': String(redirect) }) },
    body: JSON.stringify(body),
  }, { DB: dbBinding }, executionCtx)
  const text = await response.text()
  let json; try { json = JSON.parse(text) } catch { json = { error: text } }
  return { status: response.status, body: json }
}

module.exports = {
  ORACLE, USER, makeWorld, migratedDb, binding, call, callWith, raceBinding, build, ledger, plain, oldShop, movements, maxMovement, qty,
  normalised, assertComposedWrites, REDIRECT, check, done, assertRefusals,
}
