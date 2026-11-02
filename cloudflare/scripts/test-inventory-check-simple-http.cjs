'use strict'
// ic_simple over HTTP (lane 6.0.1044): the real routes, real cookie auth, the real stored switch row. Proves that OFF is the old contract,
// that ON answers the owner's shape with a closed query, and that sessions (old scope keys, create, foreign organization) keep working.
//
// Run: node scripts/test-inventory-check-simple-http.cjs
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

let db, readHook, queries, hits = 0
function binding() {
  function prepare(sql) {
    return { sql, values: [], bind(...values) { return { ...this, values } }, async all() {
      queries.push(sql)
      if (readHook && sql.includes(readHook.when)) { const hook = readHook; hits++; if (!hook.sticky) readHook = null; hook.run() }
      return { success: true, results: db.prepare(sql).all(...this.values), meta: { changes: db.prepare('SELECT changes() AS n').get().n } }
    }, async run() { queries.push(sql); const result = db.prepare(sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } } }
  }
  return { prepare, async batch(statements) {
    db.exec('BEGIN')
    try { const result = []; for (const statement of statements) result.push(await statement.all()); db.exec('COMMIT'); return result }
    catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error }
  } }
}
const ADMIN = 900003, COUNTER = 900001, BLIND = 900002, FOREIGN = 900004
function reset() {
  db?.close(); db = new DatabaseSync(':memory:')
  for (const sql of loadAll({ through: 242 })) db.exec(sql)
  for (const file of ['0259_inventory_check_sessions.sql', '0285_inventory_check_items_latest.sql']) db.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'))
  const full = { inventory: false, inventory_checks: true, inventory_check_show_stock: true, inventory_check_show_barcode: true, inventory_check_show_brand: true, inventory_check_show_category: true,
    inventory_check_show_received: true, inventory_check_show_sales: true, inventory_check_show_customers: true, inventory_check_show_price: true, contacts: true }
  db.prepare('INSERT INTO roles(id,name,code,permissions) VALUES(900001,?,?,?),(900002,?,?,?)').run('Counter', 'employee', JSON.stringify({ ...full, inventory_checks_check: true }),
    'Blind', 'blind', JSON.stringify({ inventory_checks: true, inventory_check_show_brand: true }))
  db.exec(`INSERT INTO roles(id,name,code,permissions) VALUES(900003,'Administrator','admin','{}');
    INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES(900001,'counter-one','Counter One','unused',900001,1),(900002,'blind-one','Blind One','unused',900002,1),
      (900003,'admin-one','Admin One','unused',900003,1),(900004,'foreign-one','Foreign One','unused',900003,2);
    INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'One',1),(2,'Two',1)`)
  for (const actor of [ADMIN, COUNTER, BLIND, FOREIGN]) db.prepare("INSERT INTO user_sessions(user_id,token_hash,expires_at,last_seen_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',CURRENT_TIMESTAMP)")
    .run(actor, createHash('sha256').update(`token-${actor}`).digest('hex'))
  for (let n = 1; n <= 25; n++) {
    const id = 910000 + n
    db.prepare('INSERT INTO products(id,name,stock_quantity,brand,brands,category,selling_price_usd,cost_price_usd,barcode) VALUES(?,?,5,?,?,?,9,4,?)').run(id, `Product ${String(n).padStart(2, '0')}`, `Brand ${n % 3}`, `Brand ${n % 3}`, 'Category', `885000000${id}`)
    db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,5)').run(id)
    db.prepare('INSERT INTO product_batches(id,variant_product_id,batch_key,received_at) VALUES(?,?,?,?)').run(id, id, `batch-${id}`, '2026-10-19')
    db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,1,5)').run(id)
  }
  db.prepare("INSERT INTO customers(id,name) VALUES(900001,'Customer One')").run()
  db.prepare("INSERT INTO sales(id,receipt_number,customer_id,customer_name,created_at,sale_status,subtotal_usd,total_usd) VALUES(910001,'r-1',900001,'Customer One','2026-10-19T00:00:00.000Z','completed',3,3)").run()
  db.prepare('INSERT INTO sale_items(sale_id,product_id,branch_id,quantity,total_usd,total_khr,cost_price_usd,cost_price_khr) VALUES(910001,910001,1,3,3,0,0,0)').run()
  const session = (id, org, branch, creator, status, scope = '{}') => db.prepare("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,status,scope_json,started_at,updated_at) VALUES(?,?,?,?,?,?,?,'2026-10-19T01:00:00.000Z','2026-10-19T01:00:00.000Z')").run(id, org, branch, creator, `Count ${id}`, status, scope)
  const item = (id, product, branch, state, count, reason, by, at) => db.prepare("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,reason,updated_by,updated_at) VALUES(?,?,?,?,5,'{}',?,?,?,?,?)")
    .run(id, product, branch, JSON.stringify({ id: product, name: `Product ${product - 910000}`, unit: null, parent_id: null, is_group: 0 }), state, count, reason, by, at)
  session('own', 1, 1, COUNTER, 'open'); session('foreign', 2, 1, FOREIGN, 'open')
  session('legacy', 1, 1, ADMIN, 'closed', JSON.stringify({ startDate: '2026-10-01', endDate: '2026-10-19', sortBy: 'qty_sold', customerRanking: '1', membership: 'visible_page', searchFields: 'name' }))
  item('own', 910001, 1, 'issue', 2, 'Two on shelf', COUNTER, '2026-10-20T01:00:00.000Z'); item('own', 910002, 1, 'done', 5, null, COUNTER, '2026-10-20T01:00:00.000Z'); item('own', 910003, 1, 'unstarted', null, null, null, null)
  item('foreign', 910004, 1, 'issue', 1, 'Foreign issue', FOREIGN, '2026-10-21T01:00:00.000Z')
  item('legacy', 910005, 1, 'done', 5, null, ADMIN, '2026-10-05T01:00:00.000Z'); item('legacy', 910006, 1, 'issue', 3, 'Legacy issue', ADMIN, '2026-10-05T02:00:00.000Z')
  readHook = null; queries = []
}
const setSwitch = value => {
  db.exec("DELETE FROM system_flags WHERE key='read_switches'")
  if (value !== undefined) db.prepare("INSERT INTO system_flags(key,value) VALUES('read_switches',?)").run(typeof value === 'string' ? value : JSON.stringify({ epoch: 1, switches: { ic_simple: { state: value.state } } }))
}
const ON = { state: 'on' }
async function send(route, method, url, body, actor = ADMIN) {
  queries = []
  const tasks = []
  const response = await route.request(`http://local${url}`, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Cookie: `bos_session=token-${actor}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: binding() }, { waitUntil: task => tasks.push(task) })
  await Promise.allSettled(tasks)
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control'), queries: queries.slice() }
}
const products = (query = '', actor = ADMIN) => send(productsRoute, 'GET', `/${query ? `?${query}` : ''}`, undefined, actor)
const sessions = (method, url, body, actor = ADMIN) => send(sessionsRoute, method, url, body, actor)
const physical = () => ['products', 'product_batches', 'branch_stock', 'branch_batch_stock', 'damaged_stock_lots', 'sales', 'sale_items', 'inventory_movements'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row })))
const metadata = () => ['inventory_check_sessions', 'inventory_check_items', 'inventory_check_events'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(row => ({ ...row })))
let groups = 0
const check = async (name, run) => { await run(); groups++; console.log(`PASS ${name}`) }

async function main() {
  await check('OFF in every form (no row, off, shadow, garbage, unreadable table) is the old contract: stats, rankings, issues, dates and customerRanking all work', async () => {
    reset()
    const forms = [undefined, { state: 'off' }, { state: 'shadow' }, 'not json', '[]', JSON.stringify({ switches: { ic_simple: { state: 'ON' } } }), JSON.stringify({ switches: { ic_simple: true } })]
    let reference
    for (const form of forms) {
      setSwitch(form)
      const read = await products('state=issue&branchId=1&pageSize=1')
      assert.equal(read.status, 200); assert.match(read.cache, /no-store/)
      assert.ok(read.body.stats && read.body.rankings && read.body.issues, `old shape for ${JSON.stringify(form)}`)
      assert.equal(read.body.simple, undefined)
      reference ??= JSON.stringify(read.body)
      assert.equal(JSON.stringify(read.body), reference, 'identical bytes whatever the off form')
    }
    setSwitch(undefined)
    assert.equal((await products('startDate=2026-10-01&endDate=2026-10-19&customerRanking=1')).status, 200)
    assert.equal((await products('sortBy=qty_sold')).status, 200)
    setSwitch(ON)
    hits = 0
    readHook = { when: 'SELECT value FROM system_flags WHERE key = ?', sticky: true, run: () => { throw new Error('D1_ERROR: simulated switch read failure') } }
    const unreadable = await products('state=issue&pageSize=1')
    assert.ok(hits >= 1, 'the switch read really ran and failed'); readHook = null
    assert.equal(unreadable.status, 200); assert.equal(JSON.stringify(unreadable.body), reference, 'a failing switch read falls back to the old path')
  })

  await check('ON answers the owner\'s shape; the old financial keys, stats and rankings are gone for every role', async () => {
    reset(); setSwitch(ON)
    const before = physical(), metaBefore = metadata()
    for (const actor of [ADMIN, COUNTER, BLIND]) {
      const read = await products('branchId=1&pageSize=25', actor)
      assert.equal(read.status, 200, `status for ${actor}`); assert.match(read.cache, /no-store/); assert.equal(read.body.simple, true)
      assert.equal(read.body.total, 25); assert.equal(read.body.totalPages, 1)
      for (const key of ['stats', 'rankings', 'issues']) assert.equal(Object.hasOwn(read.body, key), false, key)
      assert.deepEqual(read.body.summary, { in_check: 1, ok: 2, issue: 2, not_checked: 20, total: 25 })
      const text = JSON.stringify(read.body)
      for (const word of ['qty_sold', 'customer_count', 'unique_customer_count', 'selling_price', 'cost_price', 'wholesale', 'cost_needs_review']) assert.equal(text.includes(word), false, `${word} for ${actor}`)
    }
    const admin = (await products('branchId=1&pageSize=25')).body.items
    assert.deepEqual(admin.slice(0, 4).map(row => row.check_status), ['issue', 'ok', 'in_check', 'not_checked'])
    assert.equal(admin[0].check_note, 'Two on shelf'); assert.equal(admin[0].check_counted_quantity, 2); assert.equal(admin[0].check_by, 'counter-one')
    const blind = (await products('branchId=1&pageSize=25', BLIND)).body.items
    assert.equal(blind[0].check_note, 'Two on shelf', 'the note is for every viewer'); assert.equal(Object.hasOwn(blind[0], 'check_counted_quantity'), false, 'no stock field and not the creator')
    assert.equal(Object.hasOwn(blind[0], 'check_by'), false, 'staff names follow the identity rule'); assert.ok(blind[0].check_at, 'the time is always shown')
    const creator = (await products('branchId=1&pageSize=25', COUNTER)).body.items
    assert.equal(creator[0].check_counted_quantity, 2); assert.equal(creator[0].check_by, 'counter-one', 'a viewer sees their own name')
    assert.deepEqual(physical(), before, 'no business data written'); assert.deepEqual(metadata(), metaBefore, 'no check data written')
  })

  await check('ON refuses the removed parameters with 400 (route-level ones included) and keeps the hidden-field 403', async () => {
    reset(); setSwitch(ON)
    for (const query of ['startDate=2026-10-01', 'endDate=2026-10-02', 'createdFrom=2026-10-01%2000:00:00', 'customerRanking=1', 'customerRanking=0', 'state=issue', 'state=unstarted&sessionId=own', 'reason=x', 'sortBy=qty_sold',
      'sortBy=customer_count', 'sortBy=received_date', 'sortBy=price', 'sortBy=cost', 'barcode=1', 'groupState=group', 'initial=A', 'searchFields=name', 'checkState=bogus', 'summary=2']) {
      const read = await products(query)
      assert.equal(read.status, 400, query); assert.equal(read.body.code, 'inventory_check_invalid_query', query)
    }
    assert.equal((await products('stockState=in_stock', BLIND)).status, 403); assert.equal((await products('sortBy=stock', BLIND)).status, 403)
    assert.equal((await products('', 0)).status, 401)
    assert.equal((await products('page=1&page=2')).status, 400, 'a repeated parameter')
    assert.equal((await products('sessionId=bad%20id')).status, 400)
    // The default request an old bundle sends (no dates, name sort, empty fields skipped) is answered.
    assert.equal((await products('branchId=1&sortBy=name&sortDirection=asc&page=1&pageSize=20')).status, 200)
  })

  await check('ON session view: its own cohort, branch forced from the session, foreign and unknown sessions refused, old-scope sessions still open', async () => {
    reset(); setSwitch(ON)
    const own = await products('sessionId=own&pageSize=100')
    assert.equal(own.status, 200); assert.deepEqual(own.body.items.filter(row => row.checkable).map(row => row.id), [910001, 910002, 910003])
    assert.ok(own.body.items.every(row => !Object.hasOwn(row, 'check_status'))); assert.equal(Object.hasOwn(own.body, 'summary'), false)
    assert.equal((await products('sessionId=own&branchId=2')).status, 400, 'a branch that is not the session\'s')
    assert.equal((await products('sessionId=own&branchId=1')).status, 200)
    assert.deepEqual((await products('sessionId=own&checkState=issue')).body.items.filter(row => row.checkable).map(row => row.id), [910001])
    assert.equal((await products('sessionId=own&checkState=not_checked')).status, 400)
    const foreign = await products('sessionId=foreign', ADMIN); assert.equal(foreign.status, 404); assert.equal(foreign.body.code, 'inventory_check_session_not_found')
    assert.equal((await products('sessionId=foreign', FOREIGN)).status, 200, 'its own organization may open it')
    assert.equal((await products('sessionId=missing')).status, 404)
    const legacy = await products('sessionId=legacy&pageSize=100')
    assert.equal(legacy.status, 200); assert.deepEqual(legacy.body.items.filter(row => row.checkable).map(row => row.id), [910005, 910006])
    const list = await sessions('GET', '/sessions?page=1&pageSize=20'); assert.equal(list.status, 200)
    const old = list.body.items.find(row => row.id === 'legacy'); assert.ok(old, 'the old-scope session is listed'); assert.equal(old.scope.startDate, '2026-10-01')
    const opened = await sessions('GET', '/sessions/legacy'); assert.equal(opened.status, 200); assert.equal(opened.body.items.length, 2)
    assert.equal((await sessions('GET', '/sessions/legacy/history?page=1&pageSize=20')).status, 200)
  })

  await check('ON: a role change during the read is refused, never answered with the old role\'s data', async () => {
    reset(); setSwitch(ON)
    readHook = { when: 'AS category_facets', run: () => db.prepare("UPDATE roles SET permissions=? WHERE id=900001").run(JSON.stringify({ inventory_checks: true })) }
    const read = await products('branchId=1', COUNTER)
    assert.equal(read.status, 403); assert.equal(read.body.code, 'inventory_check_authority_changed')
  })

  await check('session create follows the switch: ON takes the closed scope and the check-status filter, OFF keeps the old scope', async () => {
    reset(); setSwitch(ON)
    const create = (requestId, productIds, scope, actor = COUNTER) => sessions('POST', '/sessions', { branchId: 1, title: 'Count', productIds, scope, requestId }, actor)
    const base = { membership: 'visible_page', sessionId: '', state: '', reason: '' }
    const dated = await create('create-dated-01', [910010], { ...base, startDate: '2026-10-01' })
    assert.equal(dated.status, 400, 'ON refuses a dated scope'); assert.equal(dated.body.code, 'inventory_check_invalid_query')
    const summary = await create('create-summary-1', [910010], { ...base, summary: '1' })
    assert.equal(summary.status, 400); assert.equal(summary.body.code, 'inventory_check_invalid_scope')
    const forged = await create('create-forged-01', [910010], { ...base, checkState: 'issue' })
    assert.equal(forged.status, 400); assert.equal(forged.body.code, 'inventory_check_product_not_eligible', 'a product that is not an Issue cannot claim the Issue scope')
    const issue = await create('create-issue-001', [910001], { ...base, checkState: 'issue', sortBy: 'name', pageSize: 20 })
    assert.equal(issue.status, 201); assert.equal(issue.body.item.scope.checkState, 'issue'); assert.equal(issue.body.item.progress.total, 1)
    const plain = await create('create-plain-001', [910010, 910011], { ...base, query: 'Product' })
    assert.equal(plain.status, 201)
    setSwitch(undefined)
    const old = await create('create-old-00001', [910012], { ...base, startDate: '2026-10-01', endDate: '2026-10-19' })
    assert.equal(old.status, 201, 'OFF still takes the old scope keys')
    assert.equal((await create('create-old-bad-1', [910013], { ...base, checkState: 'issue' })).status, 400, 'OFF does not know checkState')
  })

  await check('ON read cost: a page step reads no check counts and no financial table; the OFF path reads them', async () => {
    reset(); setSwitch(ON)
    const first = await products('branchId=1&pageSize=10'), step = await products('branchId=1&pageSize=10&page=2&summary=0')
    const text = read => read.queries.join('\n')
    assert.ok(text(first).includes('open_check') && !text(step).includes('obs AS MATERIALIZED'))
    for (const word of ['sale_items', 'FROM sales', 'customers', 'buyers', 'ledger AS']) { assert.equal(text(first).includes(word), false, word); assert.equal(text(step).includes(word), false, word) }
    assert.equal(step.body.total, first.body.total)
    setSwitch(undefined)
    assert.ok((await products('branchId=1&pageSize=10')).queries.join('\n').includes('ledger AS'), 'positive control: OFF still reads the ledger')
  })

  await check('parity: every field the owner keeps is byte-identical ON and OFF for the same cohort, order, page and total', async () => {
    // Product, barcode, brand, category, stock now (with damaged units and the consistency flag), next expiry, image and the family fields.
    const KEPT = ['id', 'name', 'barcode', 'sku', 'brand', 'category', 'unit', 'quantity', 'damaged_quantity', 'stock_consistent', 'next_expiry_date', 'image_path', 'is_group', 'parent_id', 'checkable']
    reset()
    db.prepare("UPDATE products SET unit='box', image_path='img/p.png' WHERE id IN (910002,910003)").run()
    db.prepare("UPDATE branch_stock SET quantity=2 WHERE product_id=910005 AND branch_id=1").run()
    db.prepare("UPDATE branch_batch_stock SET quantity=2 WHERE batch_id=910005 AND branch_id=1").run()
    db.prepare("UPDATE products SET stock_quantity=2 WHERE id=910005").run()
    db.prepare("INSERT INTO damaged_stock_lots(product_id,branch_id,quantity_remaining) VALUES(910004,1,2)").run()
    db.prepare("UPDATE product_batches SET expiry_date='2027-03-15' WHERE id=910006").run()
    const pick = row => Object.fromEntries(KEPT.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]))
    const queriesToCompare = ['branchId=1&pageSize=25', 'branchId=1&pageSize=10&page=2', 'branchId=1&pageSize=25&sortBy=stock&sortDirection=desc', 'branchId=1&pageSize=25&sortBy=stock&sortDirection=asc',
      'branchId=1&pageSize=25&query=Product%2012', 'branchId=1&pageSize=25&stockState=low_stock', 'branchId=1&pageSize=25&stockState=in_stock', 'branchId=1&pageSize=25&brand=Brand%201', 'pageSize=25']
    let compared = 0, refused = 0
    for (const actor of [ADMIN, COUNTER, BLIND]) for (const query of queriesToCompare) {
      setSwitch(undefined)
      const off = await products(query, actor)
      setSwitch(ON)
      const on = await products(query.includes('page=2') ? `${query}&summary=0` : query, actor)
      if (off.status === 403) { assert.equal(on.status, 403, `a hidden-field request is refused ON as it is OFF: ${query} for ${actor}`); refused++; continue }
      assert.equal(off.status, 200); assert.equal(on.status, 200)
      assert.equal(on.body.total, off.body.total, `total: ${query} for ${actor}`)
      assert.deepEqual(on.body.items.map(row => row.id), off.body.items.map(row => row.id), `same rows in the same order: ${query} for ${actor}`)
      on.body.items.forEach((row, index) => {
        const reference = pick(off.body.items[index])
        assert.deepEqual(pick(row), reference, `kept fields of ${row.id}: ${query} for ${actor}`)
        for (const key of Object.keys(reference)) assert.equal(Object.hasOwn(row, key), true, `${key} survives for ${row.id}`)
        compared++
      })
    }
    assert.ok(compared >= 150, `a real comparison, not an empty one (${compared} rows)`)
    assert.ok(refused >= 1, 'positive control: the blind viewer really was refused stock sorting and filtering on both paths')
    const withUnit = (await products('branchId=1&pageSize=25')).body.items.find(row => row.id === 910002)
    assert.equal(withUnit.unit, 'box'); assert.equal(withUnit.image_path, 'img/p.png')
    const damaged = (await products('branchId=1&pageSize=25')).body.items.find(row => row.id === 910004)
    assert.equal(damaged.damaged_quantity, 2, 'positive control: the damaged chip figure is in the compared set')
  })

  console.log(`${groups} groups passed`)
}
main().catch(error => { console.error(error); process.exit(1) })
