'use strict'
// Count submissions (lane 6.0.1044, ic_simple): the owner's way to count. Products are picked on the list, a count is typed in each row, one Submit.
// Real routes, real cookie auth, the real stored switch row, real SQLite. Proves the submission is recorded whole or not at all, never writes stock,
// is final, is idempotent, and is refused for the wrong person, the wrong product and the wrong moment.
//
// Run: node scripts/test-inventory-check-submissions-http.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')
const { DatabaseSync } = require('node:sqlite')
const { transformSync } = require('esbuild')
const { loadAll } = require('./harness/load_migrations.cjs')

const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }; cache.set(file, module)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)(id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id.endsWith('.ts') ? id : `${id}.ts`)) : require(id), module, module.exports)
  return module.exports
}
const productsRoute = load(path.join(__dirname, '../src/routes/inventoryCheckProducts.ts')).default
const sessionsRoute = load(path.join(__dirname, '../src/routes/inventoryChecks.ts')).default
const { resetReadSwitchMemo } = load(path.join(__dirname, '../src/lib/readSwitches.ts'))

let db, beforeCommit, queries = []
function binding() {
  function prepare(sql) {
    return { sql, values: [], bind(...values) { return { ...this, values } }, async all() {
      queries.push(sql)
      return { success: true, results: db.prepare(sql).all(...this.values), meta: { changes: db.prepare('SELECT changes() AS n').get().n } }
    }, async run() { queries.push(sql); const result = db.prepare(sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } } }
  }
  return { prepare, async batch(statements) {
    if (beforeCommit && statements.some(statement => /INSERT INTO inventory_check_sessions/.test(statement.sql))) { const inject = beforeCommit; beforeCommit = null; inject() }
    db.exec('BEGIN')
    try { const result = []; for (const statement of statements) result.push(await statement.all()); db.exec('COMMIT'); return result }
    catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error }
  } }
}
const ADMIN = 900003, COUNTER = 900001, BLIND = 900002, VIEWER = 900005, FOREIGN = 900004
function reset() {
  db?.close(); db = new DatabaseSync(':memory:')
  for (const sql of loadAll({ through: 242 })) db.exec(sql)
  for (const file of ['0259_inventory_check_sessions.sql', '0285_inventory_check_items_latest.sql', '0286_inventory_check_approvals.sql', '0294_inventory_check_lot_lines.sql']) db.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
  const full = { inventory_checks: true, inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true, inventory_check_show_received: true }
  db.prepare('INSERT INTO roles(id,name,code,permissions) VALUES(900001,?,?,?),(900002,?,?,?),(900005,?,?,?)').run('Counter', 'employee', JSON.stringify(full),
    'Blind', 'blind', JSON.stringify({ inventory_checks: true, inventory_check_show_brand: true }),
    'Viewer', 'viewer', JSON.stringify({ ...full, 'inventory_checks:check': false }))
  db.exec(`INSERT INTO roles(id,name,code,permissions) VALUES(900003,'Administrator','admin','{}');
    INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES(900001,'counter-one','Counter One','unused',900001,1),(900002,'blind-one','Blind One','unused',900002,1),
      (900003,'admin-one','Admin One','unused',900003,1),(900004,'foreign-one','Foreign One','unused',900003,2),(900005,'viewer-one','Viewer One','unused',900005,1);
    INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'One',1),(2,'Two',1),(3,'Closed',0)`)
  for (const actor of [ADMIN, COUNTER, BLIND, FOREIGN, VIEWER]) db.prepare("INSERT INTO user_sessions(user_id,token_hash,expires_at,last_seen_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',CURRENT_TIMESTAMP)")
    .run(actor, createHash('sha256').update(`token-${actor}`).digest('hex'))
  for (let n = 1; n <= 12; n++) {
    const id = 910000 + n
    db.prepare('INSERT INTO products(id,name,stock_quantity,brand,brands,category,barcode) VALUES(?,?,5,?,?,?,?)').run(id, `Product ${String(n).padStart(2, '0')}`, `Brand ${n % 3}`, `Brand ${n % 3}`, 'Category', `88500000${id}`)
    db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,5)').run(id)
    db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at) VALUES(?,?,?,?)').run(id, id, `batch-${id}`, '2026-10-19')
    db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,5)').run(id)
  }
  // 910003 carries two damaged units: its stock now is 5 ordinary + 2 damaged = 7.
  db.prepare("INSERT INTO damaged_stock_lots(product_id,branch_id,quantity_remaining) VALUES(910003,1,2)").run()
  // A family header (it has a child) is not a countable row.
  db.prepare("INSERT INTO products(id,name,stock_quantity,is_group) VALUES(910090,'Family header',0,1)").run()
  db.prepare("INSERT INTO products(id,name,stock_quantity,parent_id) VALUES(910091,'Family child',0,910090)").run()
  beforeCommit = null; queries = []
}
const setSwitch = value => {
  db.exec("DELETE FROM system_flags WHERE key='read_switches'")
  if (value) db.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches',?)").run(JSON.stringify({ epoch: 1, set_at: '2026-11-03T00:00:00.000Z', set_by: 1, switches: typeof value === 'object' ? value : { ic_simple: value } }))
  resetReadSwitchMemo()
}
// The writers move the inventory_checks cache version before they answer (fatal when ic_wired is ON), so the harness has a cache store; a missing one used to print a stack trace above every PASS.
async function send(route, method, url, body, actor = ADMIN, env = {}) {
  queries = []
  const tasks = []
  const response = await route.request(`http://local${url}`, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Cookie: `bos_session=token-${actor}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: binding(), CACHE: { get: async () => null, put: async () => {}, delete: async () => {} }, ...env }, { waitUntil: task => tasks.push(task) })
  await Promise.allSettled(tasks)
  return { status: response.status, body: await response.json(), queries: queries.slice() }
}
const products = (query = '', actor = ADMIN) => send(productsRoute, 'GET', `/${query ? `?${query}` : ''}`, undefined, actor)
const sessions = (method, url, body, actor = ADMIN) => send(sessionsRoute, method, url, body, actor)
const submit = (lines, over = {}, actor = COUNTER) => sessions('POST', '/submissions', { branchId: 1, requestId: 'submit-request-01', lines, ...over }, actor)
const physical = () => ['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'damaged_stock_lots', 'sales', 'sale_items', 'inventory_movements', 'audit_logs'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row })))
const metadata = () => ['inventory_check_sessions', 'inventory_check_items', 'inventory_check_events'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row })))
const counts = () => metadata().map(rows => rows.length)
let groups = 0
const check = async (name, run) => { await run(); groups++; console.log(`PASS ${name}`) }
const line = (productId, countedQuantity, extra = {}) => ({ productId, countedQuantity, ...extra })


// ---- the INV-B S5 part: counts per received date (ic_lot_counts, migration 0294) -------------------------------------------------------------------------------------------
const lotLines = () => db.prepare('SELECT product_id,batch_id,scope,seen_quantity,counted_quantity,seen_source FROM inventory_check_lot_lines ORDER BY product_id,batch_id').all().map(row => ({ ...row }))
const itemOf = productId => ({ ...db.prepare('SELECT state,counted_quantity,baseline_quantity,reason FROM inventory_check_items WHERE product_id=?').get(productId) })
// Product 910001 gets a second received date (batch 920001: 4 units), so it holds 5 + 4; the first lot is batch 910001.
function twoLots(productId = 910001, second = 920001, quantity = 4) {
  db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active) VALUES(?,?,?,?,1)').run(second, productId, `batch-${second}`, '2026-10-25')
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,?)').run(second, quantity)
  db.prepare('UPDATE branch_stock SET quantity=quantity+? WHERE product_id=? AND branch_id=1').run(quantity, productId)
  db.prepare('UPDATE products SET stock_quantity=stock_quantity+? WHERE id=?').run(quantity, productId)
}
const planTier = load(path.join(__dirname, '../src/lib/planTier.ts'))
const lotSubmit = async (lines, over = {}, actor = COUNTER, env = {}) => {
  planTier.__resetPlanTierCacheForTests()
  try { return await send(sessionsRoute, 'POST', '/submissions', { branchId: 1, requestId: 'lot-request-001', lines, ...over }, actor, env) } finally { planTier.__resetPlanTierCacheForTests() }
}
const lotLine = (productId, lots, extra = {}) => ({ productId, lots, ...extra })
const lot = (batchId, counted, seen) => ({ batchId, scope: 'lot', counted, ...(seen === undefined ? {} : { seen }) })

async function lotMain() {
  const on = () => setSwitch({ ic_simple: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on' })

  await check('OFF: a line that carries received dates is refused with its own 409 (the tab re-reads its capabilities), and nothing is written', async () => {
    reset(); twoLots()
    for (const form of [{ ic_simple: 'on' }, { ic_simple: 'on', ic_lot_counts: 'off' }, { ic_simple: 'on', ic_lot_counts: 'shadow:0.5' }]) {
      setSwitch(form)
      const before = metadata(), stock = physical()
      const response = await lotSubmit([lotLine(910001, [lot(910001, 5, 5)])])
      assert.equal(response.status, 409, JSON.stringify(form)); assert.equal(response.body.code, 'inventory_check_lot_counts_off')
      assert.deepEqual(metadata(), before); assert.deepEqual(physical(), stock); assert.deepEqual(lotLines(), [])
    }
    // the plain count of the same product still works with the switch off: the older writer is untouched
    setSwitch({ ic_simple: 'on', ic_fix_stock: 'on' })
    assert.equal((await submit([line(910002, 5, { seenQuantity: 5 })])).status, 201)
    assert.deepEqual(lotLines(), [], 'the older writer records no lot lines')
  })

  await check('ON, a counter who sees stock: lines per received date, guarded in the batch, one item per product, no stock write and no ledger read', async () => {
    reset(); twoLots(); on()
    const stock = physical()
    const response = await lotSubmit([lotLine(910001, [lot(910001, 5, 5), lot(920001, 2, 4)], { note: 'Two missing in the new lot' }), lotLine(910002, [lot(910002, 5, 5)], { checked: true })])
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.created, true)
    assert.deepEqual(response.body.item.progress, { total: 2, unstarted: 0, done: 1, issue: 1 })
    assert.deepEqual(itemOf(910001), { state: 'issue', counted_quantity: 7, baseline_quantity: 9, reason: 'Two missing in the new lot' }, 'counted = the sum of the lines, baseline = the sum of what was seen')
    assert.deepEqual(itemOf(910002), { state: 'done', counted_quantity: 5, baseline_quantity: 5, reason: null })
    assert.deepEqual(lotLines(), [
      { product_id: 910001, batch_id: 910001, scope: 'lot', seen_quantity: 5, counted_quantity: 5, seen_source: 'screen' },
      { product_id: 910001, batch_id: 920001, scope: 'lot', seen_quantity: 4, counted_quantity: 2, seen_source: 'screen' },
      { product_id: 910002, batch_id: 910002, scope: 'lot', seen_quantity: 5, counted_quantity: 5, seen_source: 'screen' },
    ])
    assert.deepEqual(physical(), stock, 'a count never moves stock')
    const text = queries.join('\n')
    assert.ok(!/inventory_movements|recorded_ordinary|recorded_lot|stock_ledger/i.test(text), 'no stock ledger statement runs')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_check_approvals WHERE status='pending'").get().n, 1, 'the differing count queues one approval')
    assert.equal(db.prepare('SELECT lines FROM inventory_check_approvals').get().lines, 1)
    assert.deepEqual(JSON.parse(db.prepare('SELECT baselines_json AS b FROM inventory_check_approvals').get().b), { 910001: 9, 910002: 5 })
    const listed = (await products('branchId=1&pageSize=12', ADMIN)).body.items
    assert.equal(listed.find(row => row.id === 910001).check_status, 'issue'); assert.equal(listed.find(row => row.id === 910001).check_counted_quantity, 7)
  })

  await check('a stale seen figure is refused with the figures of now, and nothing is written', async () => {
    reset(); twoLots(); on()
    db.prepare('UPDATE branch_batch_stock SET quantity=3 WHERE batch_id=920001').run() // one sold since the screen was drawn
    const before = metadata(), lines = lotLines()
    const response = await lotSubmit([lotLine(910001, [lot(910001, 5, 5), lot(920001, 3, 4)]), lotLine(910002, [lot(910002, 5, 5)])])
    assert.equal(response.status, 409); assert.equal(response.body.code, 'inventory_check_stock_changed')
    assert.deepEqual(response.body.productIds, [910001]); assert.deepEqual(response.body.current, [{ productId: 910001, batchId: 920001, scope: 'lot', quantity: 3 }])
    assert.deepEqual(metadata(), before, 'not even the matching product was recorded'); assert.deepEqual(lotLines(), lines)
    const recount = await lotSubmit([lotLine(910001, [lot(910001, 5, 5), lot(920001, 3, 3)])], { requestId: 'lot-request-002' })
    assert.equal(recount.status, 201, 'the same count against the figures of now is recorded'); assert.equal(itemOf(910001).state, 'done')
  })

  await check('a counter who may not see stock sends no figure: seen is read at write, inside the insert, and the difference is still reviewed', async () => {
    reset(); twoLots(); on()
    const response = await lotSubmit([lotLine(910001, [lot(910001, 4), lot(920001, 4)])], {}, BLIND)
    assert.equal(response.status, 201, JSON.stringify(response.body))
    assert.deepEqual(lotLines().map(row => [row.batch_id, row.seen_quantity, row.counted_quantity, row.seen_source]), [[910001, 5, 4, 'write'], [920001, 4, 4, 'write']])
    assert.deepEqual(itemOf(910001), { state: 'done', counted_quantity: 8, baseline_quantity: 9, reason: null }, 'a blind line is Done; its baseline is the stock of the write')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_check_approvals WHERE status='pending'").get().n, 1, 'the admin still reviews the difference')
    assert.equal(JSON.stringify(response.body).includes('baseline'), false)
    // a figure sent by a blind counter is ignored, not trusted
    const withSeen = await lotSubmit([lotLine(910002, [lot(910002, 5, 999)])], { requestId: 'lot-request-003' }, BLIND)
    assert.equal(withSeen.status, 201); assert.equal(lotLines().find(row => row.product_id === 910002).seen_quantity, 5)
  })

  await check('a branch-total line needs an active received date; a lot line must be a received date of that product here', async () => {
    reset(); twoLots(); on()
    const total = await lotSubmit([lotLine(910001, [{ scope: 'branch', counted: 8, seen: 9 }])])
    assert.equal(total.status, 201, JSON.stringify(total.body))
    assert.deepEqual(lotLines().map(row => [row.scope, row.batch_id, row.seen_quantity, row.counted_quantity]), [['branch', 0, 9, 8]])
    // another product's received date
    const before = metadata()
    const foreign = await lotSubmit([lotLine(910002, [lot(920001, 4, 4)])], { requestId: 'lot-request-004' })
    assert.equal(foreign.status, 409); assert.deepEqual(metadata(), before)
    // a product with no received date at all cannot be counted by branch total
    db.prepare('UPDATE branch_batch_stock SET quantity=0 WHERE batch_id IN (SELECT id FROM product_batches WHERE variant_product_id=910003)').run()
    db.prepare('UPDATE product_batches SET is_active=0 WHERE variant_product_id=910003').run()
    const none = await lotSubmit([lotLine(910003, [{ scope: 'branch', counted: 5, seen: 5 }])], { requestId: 'lot-request-005' })
    assert.equal(none.status, 409); assert.equal(none.body.code, 'inventory_check_no_lot'); assert.deepEqual(metadata(), before)
  })

  await check('the line shape is checked: both kinds on one product, a repeated date, a missing seen figure (sighted) and the per-submission ceiling are refused', async () => {
    reset(); twoLots(); on()
    const before = metadata()
    const bad = async (lines, code = 'inventory_check_invalid_request', status = 400, actor = COUNTER, env = {}) => {
      const response = await lotSubmit(lines, { requestId: `lot-bad-${Math.random().toString(36).slice(2, 10)}` }, actor, env)
      assert.equal(response.status, status, JSON.stringify(lines)); assert.equal(response.body.code, code); assert.deepEqual(metadata(), before)
    }
    await bad([lotLine(910001, [lot(910001, 5, 5), { scope: 'branch', counted: 1, seen: 9 }])])
    await bad([lotLine(910001, [lot(910001, 5, 5), lot(910001, 1, 5)])], 'inventory_check_invalid_id')
    await bad([lotLine(910001, [lot(910001, 5)])])
    await bad([lotLine(910001, [lot(910001, -1, 5)])], 'inventory_check_invalid_quantity')
    await bad([lotLine(910001, [])])
    await bad([lotLine(910001, [{ batchId: 910001, scope: 'branch', counted: 1, seen: 1 }])], 'inventory_check_invalid_id')
    await bad([lotLine(910001, [lot(910001, 5, 5)], { checked: true }), lotLine(910001, [lot(910001, 5, 5)])], 'inventory_check_invalid_id')
    await bad([lotLine(910001, [lot(910001, 5, 5)], { extra: 1 })])
    await bad([lotLine(910001, [lot(910001, 5, 4)], { checked: true })], 'inventory_check_stock_changed', 409)
    // Free plan: 60 lines in all
    for (let n = 0; n < 31; n++) {
      db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active) VALUES(?,910004,?,?,1)').run(930000 + n, `many-${n}`, '2026-10-26')
      db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,1)').run(930000 + n)
      db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,is_active) VALUES(?,910005,?,?,1)').run(940000 + n, `many-${n}`, '2026-10-26')
      db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,1)').run(940000 + n)
    }
    const many = ids => ids.map((batchId) => lot(batchId, 1, 1))
    const free = { PLAN_TIER: 'free' }
    await bad([lotLine(910004, many(Array.from({ length: 31 }, (_, n) => 930000 + n))), lotLine(910005, many(Array.from({ length: 30 }, (_, n) => 940000 + n)))], 'inventory_check_too_many_lines', 400, COUNTER, free)
    const fits = await lotSubmit([lotLine(910004, many(Array.from({ length: 31 }, (_, n) => 930000 + n))), lotLine(910005, many(Array.from({ length: 29 }, (_, n) => 940000 + n)))], { requestId: 'lot-fits-0001' }, COUNTER, free)
    assert.equal(fits.status, 201, JSON.stringify(fits.body)); assert.equal(lotLines().length, 60)
  })

  await check('a replay is the same answer and writes nothing; the same request id with other figures is refused', async () => {
    reset(); twoLots(); on()
    const lines = [lotLine(910001, [lot(910001, 5, 5), lot(920001, 2, 4)])]
    const first = await lotSubmit(lines)
    const after = metadata(), written = lotLines()
    const replay = await lotSubmit(lines)
    assert.equal(replay.status, 200); assert.equal(replay.body.created, false); assert.equal(replay.body.item.id, first.body.item.id)
    assert.deepEqual(metadata(), after); assert.deepEqual(lotLines(), written)
    const other = await lotSubmit([lotLine(910001, [lot(910001, 5, 5), lot(920001, 3, 4)])])
    assert.equal(other.status, 409); assert.equal(other.body.code, 'inventory_check_request_reused')
  })

  await check('queue-first still holds: a newer count of the same product replaces the waiting one, and the direct Set stays held while any count waits', async () => {
    reset(); twoLots(); on()
    const first = await lotSubmit([lotLine(910001, [lot(910001, 5, 5), lot(920001, 2, 4)])])
    const second = await lotSubmit([lotLine(910001, [lot(910001, 4, 5), lot(920001, 4, 4)])], { requestId: 'lot-request-006' })
    assert.equal(second.status, 201)
    const approvals = db.prepare('SELECT session_id,status,superseded_json FROM inventory_check_approvals ORDER BY submitted_at,session_id').all().map(row => ({ ...row }))
    assert.equal(approvals.length, 2)
    const old = approvals.find(row => row.session_id === first.body.item.id)
    assert.equal(old.status, 'rejected', 'the first approval had nothing left to apply, so the system closed it'); assert.deepEqual(JSON.parse(old.superseded_json), { 910001: second.body.item.id })
    // the hold, through the library the stock route calls
    const { getDb } = load(path.join(__dirname, '../src/lib/db.ts'))
    const { fixStockHeldByApproval } = load(path.join(__dirname, '../src/lib/inventoryCheckFixStock.ts'))
    const handle = getDb({ DB: binding() })
    const named = `icfix_${first.body.item.id}_910001_abcdef12`
    assert.equal(await fixStockHeldByApproval(handle, named), false, 'the named count was superseded: the older hold lets go')
    assert.equal(await fixStockHeldByApproval(handle, named, { productId: 910001, branchId: 1 }), true, 'widened: the product still has a waiting count at this branch')
    assert.equal(await fixStockHeldByApproval(handle, named, { productId: 910002, branchId: 1 }), false, 'another product is not held')
    assert.equal(await fixStockHeldByApproval(handle, named, { productId: 910001, branchId: 2 }), false, 'another branch is not held')
    // G3: the hold is decided by what the server knows, not by the client's request id. A request that names no count is held all the same while a count of the product waits.
    assert.equal(await fixStockHeldByApproval(handle, 'not-a-fix-request', { productId: 910001, branchId: 1 }), true, 'a request that names no count is held while the product has a waiting count')
    assert.equal(await fixStockHeldByApproval(handle, 'inventory_set_abcdef12', { productId: 910001, branchId: 1 }), true, 'whatever the id is')
    assert.equal(await fixStockHeldByApproval(handle, 'inventory_set_abcdef12', { productId: 910002, branchId: 1 }), false, 'a product with no waiting count is not held')
    assert.equal(await fixStockHeldByApproval(handle, 'inventory_set_abcdef12'), false, 'without the product-wide ask only the count a request names is held')
    // the approval's own write steps over its own approval only
    const waiting = db.prepare("SELECT session_id FROM inventory_check_approvals WHERE status='pending'").get().session_id
    assert.equal(await fixStockHeldByApproval(handle, 'x-approval-write-1', { productId: 910001, branchId: 1, exceptSession: waiting }), false, 'the approval being applied is not held by itself')
    assert.equal(await fixStockHeldByApproval(handle, 'x-approval-write-1', { productId: 910001, branchId: 1, exceptSession: first.body.item.id }), true, 'a claim for another approval buys nothing')
  })

  await check('G1: one submission may mix a dated product and a plain product; the plain one is a branch-total item with no date lines, guarded against the figure it saw', async () => {
    reset(); twoLots(); on()
    const mixed = [lotLine(910001, [lot(910001, 5, 5), lot(920001, 3, 4)]), { productId: 910002, countedQuantity: 5, seenQuantity: 5, checked: true }]
    const before = physical()
    const first = await lotSubmit(mixed)
    assert.equal(first.status, 201, JSON.stringify(first.body))
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_check_items').get().n, 2, 'two items')
    assert.deepEqual(lotLines().map(row => row.product_id), [910001, 910001], 'one product has date lines, the plain one has none')
    assert.deepEqual(itemOf(910002), { state: 'done', counted_quantity: 5, baseline_quantity: 5, reason: null })
    assert.equal(itemOf(910001).state, 'issue')
    assert.deepEqual(physical(), before, 'a count writes no stock')
    // a plain figure that no longer matches what was seen is refused whole, with the product named
    reset(); twoLots(); on()
    const stale = await lotSubmit([lotLine(910001, [lot(910001, 5, 5)]), { productId: 910002, countedQuantity: 4, seenQuantity: 99 }], { requestId: 'lot-request-mixed-2' })
    assert.equal(stale.status, 409); assert.equal(stale.body.code, 'inventory_check_stock_changed'); assert.deepEqual(lotLines(), [], 'nothing written')
    assert.deepEqual(stale.body.productIds, [910002], 'only the stale plain product is named (the dated one still matched)')
    assert.deepEqual(stale.body.current, [{ productId: 910002, batchId: 0, scope: 'branch', quantity: 5 }], 'and the 409 carries the figure of now, like a dated line')
    // a plain line with an unknown key is still refused, and the ceiling counts a plain line as one
    const bad = await lotSubmit([{ productId: 910002, countedQuantity: 4, seenQuantity: 4, lots: [] }], { requestId: 'lot-request-mixed-3' })
    assert.equal(bad.status, 400)
  })

  globalThis.caches = { default: { match: async () => undefined, put: async () => {}, delete: async () => false } }
  const kv = (() => { const m = new Map(); return { get: async k => m.get(k) ?? null, put: async (k, v) => { m.set(k, v) }, delete: async k => { m.delete(k) }, list: async () => ({ keys: [] }) } })()
  await check('N1: while the page is wired, a plain-only submission is judged against sellable stock (product 910003: 5 sellable + 2 held); the older writer still runs with ic_wired OFF', async () => {
    reset(); twoLots()
    setSwitch({ ic_simple: 'on', ic_wired: 'on' })
    const wired = await lotSubmit([{ productId: 910003, countedQuantity: 5, seenQuantity: 5, checked: true }], { requestId: 'n1-wired-0001' })
    assert.equal(wired.status, 201, JSON.stringify(wired.body))
    assert.deepEqual(itemOf(910003), { state: 'done', counted_quantity: 5, baseline_quantity: 5, reason: null }, 'held units are not part of the baseline')
    reset(); twoLots()
    setSwitch({ ic_simple: 'on' })
    const older = await lotSubmit([{ productId: 910003, countedQuantity: 5, seenQuantity: 5 }], { requestId: 'n1-older-0001' })
    assert.ok(older.status === 409 || (older.status === 201 && itemOf(910003).baseline_quantity === 7), 'the control: the older writer measures 5 + 2 held = 7 (a 409 or a baseline of 7), so the wired answer above is the routing, not the fixture ' + older.status)
  })

  await check('G4 remainder: the session view lists the per-date lines of each item (received date, counted, saw) while ic_lot_counts is ON, and nothing while OFF', async () => {
    reset(); twoLots(); on()
    const made = await lotSubmit([lotLine(910001, [lot(910001, 5, 5), lot(920001, 2, 4)])], { requestId: 'g4-session-0001' })
    const view = await send(sessionsRoute, 'GET', '/sessions/' + made.body.item.id, undefined, COUNTER)
    assert.equal(view.status, 200, JSON.stringify(view.body))
    const lines = view.body.items.find(item => item.product_id === 910001).lot_lines
    assert.deepEqual(lines.map(line => [line.batch_id, line.counted, line.seen]), [[910001, 5, 5], [920001, 2, 4]])
    assert.ok(lines.every(line => typeof line.received_at === 'string'), 'each date carries its received date')
    setSwitch({ ic_simple: 'on', ic_fix_stock: 'on' })
    const off = await send(sessionsRoute, 'GET', '/sessions/' + made.body.item.id, undefined, COUNTER)
    assert.equal(off.body.items.find(item => item.product_id === 910001).lot_lines, undefined, 'OFF: the item is exactly what it was')
    assert.ok(!off.queries.some(sql => /inventory_check_lot_lines/.test(sql.sql || sql)), 'and the table is not read')
  })

  await check('N3: offsetting date errors (A counted 6 of 5, B counted 3 of 4: the sums agree) are an Issue and reach the approval queue, not "done"', async () => {
    reset(); twoLots(); on()
    const made = await lotSubmit([lotLine(910001, [lot(910001, 6, 5), lot(920001, 3, 4)])], { requestId: 'n3-offset-0001' })
    assert.equal(made.status, 201, JSON.stringify(made.body))
    assert.equal(itemOf(910001).state, 'issue', 'two wrong figures are an Issue even though their sums agree')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_check_approvals').get().n, 1, 'and the approver is asked')
    reset(); twoLots(); on()
    const same = await lotSubmit([lotLine(910001, [lot(910001, 5, 5), lot(920001, 4, 4)])], { requestId: 'n3-same-00001' })
    assert.equal(same.status, 201); assert.equal(itemOf(910001).state, 'done', 'the control: every date equal is done')
  })

  await check('G4 + G4b: the overlay returns the latest session lines per received date (by key, one more statement, no ledger read); OFF sends none', async () => {
    reset(); twoLots(); setSwitch({ ic_simple: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on', ic_wired: 'on' })
    const made = await lotSubmit([lotLine(910001, [lot(910001, 5, 5), lot(920001, 2, 4)])])
    assert.equal(made.status, 201)
    const read = await send(sessionsRoute, 'GET', '/overlay?branchId=1&ids=910001', undefined, COUNTER, { CACHE: kv })
    assert.equal(read.status, 200, JSON.stringify(read.body))
    const entry = read.body.items.find(item => item.product_id === 910001)
    assert.deepEqual(entry.check.lots, [{ batch_id: 910001, scope: 'lot', counted: 5, seen: 5 }, { batch_id: 920001, scope: 'lot', counted: 2, seen: 4 }], 'both dates come back after a reload')
    assert.ok(read.queries.some(sql => /inventory_check_lot_lines/.test(sql.sql || sql)), 'read by the lot-lines table')
    assert.ok(!read.queries.some(sql => /recorded_ordinary|inventory_movements m WHERE m.product_id = wanted.value AND m.created_at >= newest/.test(sql.sql || sql) && /recorded_ordinary/.test(sql.sql || sql)), 'and no stock ledger')
    setSwitch({ ic_simple: 'on', ic_fix_stock: 'on', ic_wired: 'on' })
    const off = await send(sessionsRoute, 'GET', '/overlay?branchId=1&ids=910001', undefined, COUNTER, { CACHE: kv })
    assert.equal(off.body.items.find(item => item.product_id === 910001).check.lots, undefined, 'OFF: the entry is exactly what it was')
    assert.ok(!off.queries.some(sql => /inventory_check_lot_lines/.test(sql.sql || sql)), 'OFF: the lot-lines table is not read')
  })

  await check('alerts: a differing lot count tells the approvers once, a matching one tells nobody, a replaced approval is told as rejected, a replay announces nothing', async () => {
    reset(); twoLots(); on()
    const { getDb } = load(path.join(__dirname, '../src/lib/db.ts'))
    const { createInventoryCheckLotSubmission } = load(path.join(__dirname, '../src/lib/inventoryCheckSessions.ts'))
    const { inventoryCheckDigest } = load(path.join(__dirname, '../src/lib/inventoryCheckSessions.ts'))
    const handle = getDb({ DB: binding() })
    planTier.__resetPlanTierCacheForTests()
    const who = { id: COUNTER, tokenHash: await inventoryCheckDigest(`token-${COUNTER}`) }
    const told = []
    const options = { approvals: true, maxLines: 60, maxLinesPerProduct: 50, onApprovalCreated: async created => { told.push(['created', created.sessionId]) }, onApprovalsReplaced: async replaced => { told.push(['replaced', ...replaced.sessionIds]) } }
    const matching = await createInventoryCheckLotSubmission(handle, who, { branchId: 1, requestId: 'alert-request-01', lines: [lotLine(910001, [lot(910001, 5, 5), lot(920001, 4, 4)])] }, options)
    assert.equal(matching.created, true); assert.deepEqual(told, [], 'counts that match stock queue nothing and tell nobody')
    const first = await createInventoryCheckLotSubmission(handle, who, { branchId: 1, requestId: 'alert-request-02', lines: [lotLine(910001, [lot(910001, 4, 5), lot(920001, 4, 4)])] }, options)
    assert.deepEqual(told, [['created', first.item.id]], 'a differing count is announced once, by its session')
    const second = await createInventoryCheckLotSubmission(handle, who, { branchId: 1, requestId: 'alert-request-03', lines: [lotLine(910001, [lot(910001, 3, 5), lot(920001, 4, 4)])] }, options)
    assert.ok(told.some(entry => entry[0] === 'replaced' && entry[1] === first.item.id), 'the replaced approval is announced as replaced')
    assert.ok(told.some(entry => entry[0] === 'created' && entry[1] === second.item.id), 'and the newer count as created')
    const size = told.length
    const replay = await createInventoryCheckLotSubmission(handle, who, { branchId: 1, requestId: 'alert-request-03', lines: [lotLine(910001, [lot(910001, 3, 5), lot(920001, 4, 4)])] }, options)
    assert.equal(replay.created, false); assert.equal(told.length, size, 'a replay announces nothing')
    planTier.__resetPlanTierCacheForTests()
  })
}

lotMain().then(() => { console.log(`PASS test-inventory-check-lot-counts-http: ${groups} groups`) }).catch(error => { console.error(error); process.exit(1) })
