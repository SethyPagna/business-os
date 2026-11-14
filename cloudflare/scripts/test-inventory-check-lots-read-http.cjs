'use strict'
// The received dates of ONE product at ONE branch, read on demand by the count popover (GET /api/inventory-checks/lots, ic_lot_counts). Real route, real cookie auth, real stored switch
// row, real SQLite. Proves: closed while the switch is OFF; one product, one request, one batch read; only active batches of THIS branch; the viewer's fields decide; no cost in any payload;
// and the batches it lists are exactly the ones the submission writer accepts (the server re-checks batch + branch identity, a frontend list is never trusted).
//
// Run: node scripts/test-inventory-check-lots-read-http.cjs
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
const planTier = load(path.join(__dirname, '../src/lib/planTier.ts'))
const lots = (query, actor = COUNTER) => send(sessionsRoute, 'GET', `/lots${query ? `?${query}` : ''}`, undefined, actor)
const on = () => setSwitch({ ic_simple: 'on', ic_fix_stock: 'on', ic_lot_counts: 'on' })
const addLot = (id, productId, { received = '2026-10-25', expiry = null, quantity = 3, branch = 1, active = 1, code = null } = {}) => {
  db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,expiry_date,lot_code,is_active) VALUES(?,?,?,?,?,?,?)').run(id, productId, `batch-${id}`, received, expiry, code, active)
  db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,?)').run(id, branch, quantity)
}
const lotSubmit = async (lines, actor = COUNTER) => {
  planTier.__resetPlanTierCacheForTests()
  try { return await send(sessionsRoute, 'POST', '/submissions', { branchId: 1, requestId: 'lots-read-request-1', lines }, actor) } finally { planTier.__resetPlanTierCacheForTests() }
}
const batchReads = response => response.queries.filter(sql => /FROM product_batches/.test(sql))

async function main() {
  await check('OFF (the default): the route does not exist, for every switch form, and reads nothing', async () => {
    reset()
    for (const form of [undefined, { ic_simple: 'on' }, { ic_simple: 'on', ic_lot_counts: 'off' }, { ic_simple: 'on', ic_lot_counts: 'shadow:0.5' }]) {
      setSwitch(form)
      const response = await lots('productId=910001&branchId=1')
      assert.equal(response.status, 404, JSON.stringify(form)); assert.equal(response.body.code, 'not_found')
      assert.equal(batchReads(response).length, 0, 'a closed route reads no batch')
    }
  })

  await check('ON: one product, one branch, one batch read; active batches of that branch only, stock first, then earliest expiry', async () => {
    reset(); on()
    addLot(920001, 910001, { received: '2026-10-25', expiry: '2027-05-01', quantity: 4, code: 'LC-9' })
    addLot(920002, 910001, { received: '2026-10-26', expiry: '2026-12-01', quantity: 2 })
    addLot(920003, 910001, { received: '2026-10-27', quantity: 0 })                       // holds 0 here: still listed (units found on it are a count), after the ones holding stock
    addLot(920004, 910001, { received: '2026-10-28', quantity: 0, active: 0 })            // retired batch: never listed
    addLot(920005, 910001, { received: '2026-10-29', quantity: 8, branch: 2 })            // another branch's batch: never listed here
    addLot(920006, 910002, { received: '2026-10-30', quantity: 9 })                       // another product's batch
    const response = await lots('productId=910001&branchId=1')
    assert.equal(response.status, 200, JSON.stringify(response.body))
    assert.deepEqual(response.body.lots.map(row => row.batchId), [920002, 920001, 910001, 920003], 'stock first; earliest expiry first; undated after dated; empty ones last')
    assert.deepEqual(response.body.lots.find(row => row.batchId === 920001), { batchId: 920001, receivedAt: '2026-10-25', expiry: '2027-05-01', lotCode: 'LC-9', batchNumber: null, quantity: 4 })
    assert.equal(response.body.more, undefined)
    assert.equal(batchReads(response).length, 1, 'exactly one batch read')
    const other = await lots('productId=910001&branchId=2')
    assert.deepEqual(other.body.lots.map(row => row.batchId), [920005], 'the other branch lists its own batch only')
  })

  await check('no cost, supplier, price or note exists in the answer, whatever the batch row carries', async () => {
    reset(); on(); addLot(920001, 910001, { quantity: 4 })
    const columns = db.prepare('PRAGMA table_info(product_batches)').all().map(row => row.name)
    for (const column of columns.filter(name => /cost|price|supplier|note/.test(name))) {
      const sample = db.prepare(`SELECT ${column} AS v FROM product_batches WHERE id=920001`).get().v
      db.prepare(`UPDATE product_batches SET ${column}=? WHERE id=920001`).run(typeof sample === 'number' ? 123456.789 : 'SECRET-COST-TEXT')
    }
    const response = await lots('productId=910001&branchId=1')
    const text = JSON.stringify(response.body)
    assert.ok(!/123456|SECRET-COST|cost|price|supplier|note/i.test(text), text)
    assert.deepEqual(Object.keys(response.body.lots[0]).sort(), ['batchId', 'batchNumber', 'expiry', 'lotCode', 'quantity', 'receivedAt'])
    assert.ok(batchReads(response).every(sql => !/cost|price|supplier|notes/i.test(sql)), 'the statement never selects them')
  })

  await check('the viewer decides: no stock field lists nothing; no view right is a 403; bad ids are 400; a repeated key is 400; signed out is 401', async () => {
    reset(); on(); addLot(920001, 910001)
    const blind = await lots('productId=910001&branchId=1', BLIND)
    assert.deepEqual(blind.body.lots, [], 'a blind counter has no batches to count (one total, as always)')
    assert.equal(batchReads(blind).length, 0, 'and none are read for them')
    assert.equal((await lots('productId=910001&branchId=1', VIEWER)).status, 200, 'a viewer who sees stock may read them')
    for (const query of ['', 'productId=910001', 'branchId=1', 'productId=0&branchId=1', 'productId=1.5&branchId=1', 'productId=abc&branchId=1', 'productId=910001&branchId=-1', 'productId=910001&productId=910002&branchId=1']) {
      const response = await lots(query); assert.equal(response.status, 400, query); assert.equal(response.body.code, 'inventory_check_invalid_query', query)
      assert.equal(batchReads(response).length, 0, `a refused request reads nothing (${query})`)
    }
    db.prepare('UPDATE roles SET permissions=? WHERE id=900002').run(JSON.stringify({}))
    assert.equal((await lots('productId=910001&branchId=1', BLIND)).status, 403, 'a role without the Inventory Check right')
    assert.equal((await lots('productId=910001&branchId=1', null)).status, 401, 'signed out')
  })

  await check('only as many batches as one count may carry are listed, and the answer says there are more', async () => {
    reset(); on()
    planTier.__resetPlanTierCacheForTests()
    const limit = planTier.getPlanLimits({}).inventoryCheckLotLinesPerProduct
    for (let n = 1; n <= limit + 3; n++) addLot(930000 + n, 910001, { received: '2026-09-01', quantity: 1 })
    const response = await lots('productId=910001&branchId=1')
    assert.equal(response.body.lots.length, limit); assert.equal(response.body.more, true)
    assert.ok(batchReads(response).every(sql => /LIMIT/.test(sql)), 'cut inside the statement, not after reading them all')
  })

  await check('parity: the listed batches are exactly the ones the writer accepts; a made-up, retired or other-branch batch is refused server-side whatever the page sent', async () => {
    reset(); on()
    addLot(920001, 910001, { quantity: 4 }); addLot(920004, 910001, { quantity: 0, active: 0 }); addLot(920005, 910001, { quantity: 8, branch: 2 }); addLot(920006, 910002, { quantity: 2 })
    db.prepare('UPDATE branch_stock SET quantity=quantity+4 WHERE product_id=910001 AND branch_id=1').run()
    const listed = (await lots('productId=910001&branchId=1')).body.lots
    assert.deepEqual(listed.map(row => row.batchId).sort(), [910001, 920001])
    const lotLine = (productId, batchId, counted, seen) => ({ productId, lots: [{ batchId, scope: 'lot', counted, seen }] })
    const before = counts()
    for (const [batchId, why] of [[920004, 'retired'], [920005, 'another branch'], [920006, 'another product'], [999999, 'unknown']]) {
      const refused = await lotSubmit([lotLine(910001, batchId, 1, 5)])
      assert.equal(refused.status, 409, why); assert.equal(refused.body.code, 'inventory_check_baseline_changed', why)
      assert.deepEqual(counts(), before, `${why}: nothing is written`)
    }
    const stale = await lotSubmit([lotLine(910001, 920001, 3, 99)])
    assert.equal(stale.status, 409); assert.equal(stale.body.code, 'inventory_check_stock_changed', 'a figure the page saw that is no longer the batch quantity is a recount')
    const accepted = await lotSubmit([{ productId: 910001, lots: listed.map(row => ({ batchId: row.batchId, scope: 'lot', counted: row.quantity - 1, seen: row.quantity })) }])
    assert.equal(accepted.status, 201, JSON.stringify(accepted.body))
    const written = db.prepare('SELECT batch_id,seen_quantity,counted_quantity FROM inventory_check_lot_lines ORDER BY batch_id').all().map(row => ({ ...row }))
    assert.deepEqual(written, [{ batch_id: 910001, seen_quantity: 5, counted_quantity: 4 }, { batch_id: 920001, seen_quantity: 4, counted_quantity: 3 }], 'one count line per listed batch, each with the seen figure the list showed')
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inventory_check_sessions').get().n, 1, 'one submission is one session (one atomic write)')
    assert.deepEqual(db.prepare('SELECT quantity FROM branch_batch_stock WHERE batch_id IN (910001,920001) ORDER BY batch_id').all().map(row => row.quantity), [5, 4], 'a count never moves stock')
  })
  console.log(`PASS ${groups} groups`)
}
main().catch(error => { console.error(error); process.exit(1) })
