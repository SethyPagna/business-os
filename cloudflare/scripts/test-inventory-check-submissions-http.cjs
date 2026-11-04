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
  for (const file of ['0259_inventory_check_sessions.sql', '0285_inventory_check_items_latest.sql']) db.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
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
  if (value) db.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches',?)").run(JSON.stringify({ epoch: 1, set_at: '2026-11-03T00:00:00.000Z', set_by: 1, switches: { ic_simple: value } }))
  resetReadSwitchMemo()
}
async function send(route, method, url, body, actor = ADMIN) {
  queries = []
  const tasks = []
  const response = await route.request(`http://local${url}`, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Cookie: `bos_session=token-${actor}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: binding() }, { waitUntil: task => tasks.push(task) })
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

async function main() {
  await check('OFF: the route does not exist and nothing is written', async () => {
    reset()
    for (const form of [undefined, 'off', 'shadow:0.05', 'shadow', 'ON', { state: 'on' }]) {
      setSwitch(form)
      const before = metadata(), stock = physical()
      const response = await submit([line(910001, 5)])
      assert.equal(response.status, 404, JSON.stringify(form)); assert.equal(response.body.code, 'inventory_check_not_available')
      assert.deepEqual(metadata(), before); assert.deepEqual(physical(), stock)
    }
  })

  await check('a submission is recorded whole as a closed session: matching = Done, differing = Issue with its note, stock untouched', async () => {
    reset(); setSwitch('on')
    const stock = physical()
    const response = await submit([line(910001, 5, { seenQuantity: 5, checked: true }), line(910002, 3, { seenQuantity: 5, note: '  Two boxes missing  ' }), line(910004, 9), line(910003, 7)])
    assert.equal(response.status, 201, JSON.stringify(response.body)); assert.equal(response.body.created, true)
    const session = response.body.item
    assert.equal(session.status, 'closed'); assert.equal(session.branch_id, 1); assert.equal(session.created_by, COUNTER)
    assert.deepEqual(session.progress, { total: 4, unstarted: 0, done: 2, issue: 2 })
    assert.equal(session.scope.membership, 'submission')
    const items = db.prepare('SELECT product_id,state,counted_quantity,reason,revision,updated_by,baseline_quantity FROM inventory_check_items ORDER BY product_id').all().map(row => ({ ...row }))
    assert.deepEqual(items, [
      { product_id: 910001, state: 'done', counted_quantity: 5, reason: null, revision: 1, updated_by: COUNTER, baseline_quantity: 5 },
      { product_id: 910002, state: 'issue', counted_quantity: 3, reason: 'Two boxes missing', revision: 1, updated_by: COUNTER, baseline_quantity: 5 },
      { product_id: 910003, state: 'done', counted_quantity: 7, reason: null, revision: 1, updated_by: COUNTER, baseline_quantity: 7 },
      { product_id: 910004, state: 'issue', counted_quantity: 9, reason: 'Count differs from stock', revision: 1, updated_by: COUNTER, baseline_quantity: 5 },
    ])
    assert.deepEqual(physical(), stock, 'a count never moves stock')
    const events = db.prepare('SELECT action,product_id,actor_id,request_id FROM inventory_check_events ORDER BY id').all().map(row => ({ ...row }))
    assert.deepEqual(events.map(event => event.action), ['create', 'observe', 'observe', 'observe', 'observe'])
    assert.equal(new Set(events.map(event => event.request_id)).size, 5)
    const history = await sessions('GET', `/sessions/${session.id}/history?page=1&pageSize=20`)
    assert.equal(history.status, 200); assert.equal(history.body.total, 5)
    assert.ok(history.body.items.every(item => item.actor_id === COUNTER))
    const opened = await sessions('GET', `/sessions/${session.id}`)
    assert.equal(opened.status, 200); assert.equal(opened.body.items.length, 4)
    const listed = await sessions('GET', '/sessions?page=1&pageSize=20')
    assert.equal(listed.body.items[0].id, session.id); assert.equal(listed.body.items[0].status, 'closed')
  })

  await check('the list shows the result at once: status, counted quantity, who and when', async () => {
    reset(); setSwitch('on')
    await submit([line(910001, 5, { checked: true }), line(910002, 3, { note: 'Short' })])
    const rows = (await products('branchId=1&pageSize=12', ADMIN)).body.items
    const byId = id => rows.find(row => row.id === id)
    assert.equal(byId(910001).check_status, 'ok'); assert.equal(byId(910001).check_counted_quantity, 5)
    assert.equal(byId(910002).check_status, 'issue'); assert.equal(byId(910002).check_note, 'Short'); assert.equal(byId(910002).check_by, 'counter-one')
    assert.match(byId(910002).check_at, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(byId(910003).check_status, 'not_checked')
    const summary = (await products('branchId=1&pageSize=12', ADMIN)).body.summary
    assert.equal(summary.ok, 1); assert.equal(summary.issue, 1); assert.equal(summary.in_check, 0)
    assert.deepEqual((await products('branchId=1&checkState=issue')).body.items.map(row => row.id), [910002])
  })

  await check('a replay is the same answer and writes nothing; the same request id with other data is refused', async () => {
    reset(); setSwitch('on')
    const lines = [line(910001, 5), line(910002, 3)]
    const first = await submit(lines)
    const after = metadata(), stock = physical()
    const replay = await submit(lines)
    assert.equal(replay.status, 200); assert.equal(replay.body.created, false); assert.equal(replay.body.receipt.replayed, true); assert.equal(replay.body.item.id, first.body.item.id)
    assert.deepEqual(metadata(), after); assert.deepEqual(physical(), stock)
    const other = await submit([line(910001, 5), line(910002, 4)])
    assert.equal(other.status, 409); assert.equal(other.body.code, 'inventory_check_request_reused')
    assert.deepEqual(metadata(), after)
    const another = await submit([line(910001, 5), line(910002, 3)], { requestId: 'submit-request-02' })
    assert.equal(another.status, 201, 'a new request id is a new submission'); assert.notEqual(another.body.item.id, first.body.item.id)
  })

  await check('a "checked" mark that stock has moved away from is refused for the whole submission', async () => {
    reset(); setSwitch('on')
    db.prepare('UPDATE branch_stock SET quantity=4 WHERE product_id=910002').run()
    db.prepare('UPDATE branch_batch_stock SET quantity=4 WHERE batch_id=910002').run()
    db.prepare('UPDATE products SET stock_quantity=4 WHERE id=910002').run()
    const before = metadata(), stock = physical()
    const response = await submit([line(910001, 5, { checked: true }), line(910002, 5, { checked: true })])
    assert.equal(response.status, 409); assert.equal(response.body.code, 'inventory_check_stock_changed'); assert.deepEqual(response.body.productIds, [910002])
    assert.deepEqual(metadata(), before, 'not even the matching line was recorded'); assert.deepEqual(physical(), stock)
    const typed = await submit([line(910001, 5, { checked: true }), line(910002, 5)])
    assert.equal(typed.status, 201, 'the same count typed, not marked, is recorded as a difference'); assert.equal(typed.body.item.progress.issue, 1)
  })

  await check('a viewer who cannot read stock cannot compare: every line is Done, nothing about stock is revealed, and "checked" is refused', async () => {
    reset(); setSwitch('on')
    const response = await submit([line(910001, 5), line(910002, 99)], {}, BLIND)
    assert.equal(response.status, 201); assert.equal(response.body.item.progress.done, 2); assert.equal(response.body.item.progress.issue, 0)
    assert.equal(JSON.stringify(response.body).includes('baseline'), false)
    assert.equal((await submit([line(910003, 7, { checked: true })], { requestId: 'blind-checked-01' }, BLIND)).status, 400)
    // The differing count is on the books for the admin, whatever the counter could see.
    const stored = db.prepare('SELECT state,counted_quantity FROM inventory_check_items WHERE product_id=910002').get()
    assert.deepEqual({ ...stored }, { state: 'done', counted_quantity: 99 })
  })

  await check('who may submit: the check grant is required; another organization\'s session and a signed-out caller are refused', async () => {
    reset(); setSwitch('on')
    const before = metadata()
    assert.equal((await submit([line(910001, 5)], {}, VIEWER)).status, 403)
    assert.equal((await submit([line(910001, 5)], {}, 0)).status, 401)
    assert.deepEqual(metadata(), before)
    const mine = await submit([line(910001, 5)], { requestId: 'org-one-request-1' }, ADMIN)
    assert.equal(mine.status, 201)
    assert.equal((await sessions('GET', `/sessions/${mine.body.item.id}`, undefined, FOREIGN)).status, 404, 'another organization cannot open it')
    assert.equal((await sessions('GET', '/sessions?page=1&pageSize=20', undefined, FOREIGN)).body.items.length, 0)
  })

  await check('crafted requests: wrong products, duplicates, counts, notes, keys, branch, size', async () => {
    reset(); setSwitch('on')
    const before = metadata(), stock = physical()
    const cases = [
      ['unknown product', [line(999999, 1)], 400, 'inventory_check_product_not_eligible'],
      ['a family header', [line(910090, 1)], 400, 'inventory_check_product_not_eligible'],
      ['duplicate product', [line(910001, 1), line(910001, 2)], 400, 'inventory_check_invalid_id'],
      ['negative count', [line(910001, -1)], 400, 'inventory_check_invalid_quantity'],
      ['text count', [line(910001, '5')], 400, 'inventory_check_invalid_quantity'],
      ['huge count', [line(910001, 1e12)], 400, 'inventory_check_invalid_quantity'],
      ['NaN-like count', [line(910001, null)], 400, 'inventory_check_invalid_quantity'],
      ['negative seen', [line(910001, 1, { seenQuantity: -2 })], 400, 'inventory_check_invalid_quantity'],
      ['long note', [line(910001, 1, { note: 'x'.repeat(501) })], 400, 'inventory_check_invalid_note'],
      ['unknown line key', [{ productId: 910001, countedQuantity: 1, state: 'done' }], 400, 'inventory_check_invalid_request'],
      ['checked not boolean', [line(910001, 5, { checked: 'yes' })], 400, 'inventory_check_invalid_request'],
      ['string product id', [{ productId: '910001', countedQuantity: 1 }], 400, 'inventory_check_invalid_id'],
      ['no lines', [], 400, 'inventory_check_product_ids_required'],
      ['too many lines', Array.from({ length: 501 }, (_, n) => line(920000 + n, 1)), 400, 'inventory_check_product_ids_required'],
    ]
    for (const [name, lines, status, code] of cases) {
      const response = await submit(lines, { requestId: `crafted-${name.replace(/\W+/g, '-')}-1`.slice(0, 60) })
      assert.equal(response.status, status, name); assert.equal(response.body.code, code, name)
    }
    for (const [name, over, code] of [['no branch', { branchId: undefined }, 'inventory_check_invalid_id'], ['closed branch', { branchId: 3 }, 'inventory_check_product_not_eligible'],
      ['bad request id', { requestId: 'short' }, 'inventory_check_request_id_required'], ['long title', { title: 'x'.repeat(121) }, 'inventory_check_invalid_title']]) {
      const response = await submit([line(910001, 5)], over)
      assert.equal(response.body.code, code, name); assert.ok(response.status >= 400, name)
    }
    assert.equal((await sessions('POST', '/submissions', 'not an object')).status, 400)
    assert.deepEqual(metadata(), before); assert.deepEqual(physical(), stock)
  })

  await check('all or nothing: stock that moves between the read and the write aborts the whole submission', async () => {
    reset(); setSwitch('on')
    const before = metadata()
    beforeCommit = () => {
      db.prepare('UPDATE branch_stock SET quantity=6 WHERE product_id=910002').run()
      db.prepare('UPDATE branch_batch_stock SET quantity=6 WHERE batch_id=910002').run()
      db.prepare('UPDATE products SET stock_quantity=6 WHERE id=910002').run()
    }
    const response = await submit([line(910001, 5), line(910002, 5)])
    assert.equal(response.status, 409); assert.equal(response.body.code, 'inventory_check_baseline_changed')
    assert.deepEqual(metadata(), before)
  })

  await check('a submission is final: it cannot be reopened, edited or deleted', async () => {
    reset(); setSwitch('on')
    const made = await submit([line(910001, 5), line(910002, 3)])
    const id = made.body.item.id
    const resume = await sessions('PATCH', `/sessions/${id}`, { action: 'resume', expectedRevision: 0, requestId: 'resume-request-1' })
    assert.equal(resume.status, 409); assert.equal(resume.body.code, 'inventory_check_session_final')
    const edit = await sessions('PATCH', `/sessions/${id}/items/910002`, { state: 'done', expectedRevision: 1, expectedSessionRevision: 0, requestId: 'edit-request-001' })
    assert.equal(edit.status, 409, 'the session is closed, so no line can change')
    assert.throws(() => db.exec('DELETE FROM inventory_check_items'), /inventory_check_history_immutable/)
    assert.throws(() => db.exec('DELETE FROM inventory_check_sessions'), /inventory_check_history_immutable/)
    assert.throws(() => db.exec("UPDATE inventory_check_events SET action='close'"), /inventory_check_history_immutable/)
  })

  await check('submissions and the older session flow live side by side: the old create still works and old sessions are untouched', async () => {
    reset(); setSwitch('on')
    const old = await sessions('POST', '/sessions', { branchId: 1, title: 'Count', productIds: [910005], scope: { membership: 'visible_page' }, requestId: 'old-flow-request-1' }, COUNTER)
    assert.equal(old.status, 201); assert.equal(old.body.item.status, 'open')
    const made = await submit([line(910005, 5)])
    assert.equal(made.status, 201)
    const rows = (await products('branchId=1&pageSize=12')).body.items
    assert.equal(rows.find(row => row.id === 910005).check_status, 'in_check', 'a product still unstarted in an open session reads In check (the one status definition)')
    const closed = await sessions('PATCH', `/sessions/${old.body.item.id}`, { action: 'close', expectedRevision: 0, requestId: 'old-flow-close-01' }, COUNTER)
    assert.equal(closed.status, 200)
    assert.equal((await products('branchId=1&pageSize=12')).body.items.find(row => row.id === 910005).check_status, 'ok', 'once that session is closed the finished submission is the latest check')
    assert.equal((await products(`sessionId=${old.body.item.id}`)).body.items.length, 1)
  })

  console.log(`${groups} groups passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
