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
  const module = { exports: {} }
  cache.set(file, module)
  const source = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs', target: 'es2022' }).code
  new Function('require', 'module', 'exports', source)(id => id.startsWith('.') ? load(path.resolve(path.dirname(file), id.endsWith('.ts') ? id : `${id}.ts`)) : require(id), module, module.exports)
  return module.exports
}
let route
let db, beforeCommit, loseAck, afterCommit, queryTrace = [], batchTrace = [], batchSequence = 0, activeBatch = 0, projectionFailures = 0
function binding() {
  function prepare(sql) {
    return { sql, values: [], bind(...values) { if(values.length>100) throw new Error('D1_ERROR: too many SQL variables'); return { ...this, values } }, async all() {
      const results = db.prepare(sql).all(...this.values)
      queryTrace.push({sql,values:this.values,rows:results.length,batch:activeBatch})
      return { success: true, results, meta: { changes: db.prepare('SELECT changes() AS n').get().n } }
    }, async run() { const result = db.prepare(sql).run(...this.values); queryTrace.push({sql,values:this.values,rows:0,batch:activeBatch}); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } } }
  }
  return { prepare, async batch(statements) {
    batchTrace.push(statements.map(statement=>({sql:statement.sql,values:statement.values})))
    if (statements.some(statement=>statement.sql.includes('post_write_snapshot')) && projectionFailures>0) {
      projectionFailures--; throw new Error('D1_ERROR: network projection read failed')
    }
    const writing = statements.some(statement => /INSERT INTO inventory_check_events/.test(statement.sql))
    if (writing && beforeCommit) { const inject = beforeCommit; beforeCommit = null; inject() }
    db.exec('BEGIN')
    activeBatch = ++batchSequence
    try {
      const result = []
      for (const statement of statements) result.push(await statement.all())
      db.exec('COMMIT')
      if (writing && afterCommit) { const inject = afterCommit; afterCommit = null; inject() }
      if (writing && loseAck) { loseAck = false; throw new Error('Lost commit acknowledgement') }
      return result
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error } finally { activeBatch = 0 }
  } }
}
function reset(schema = true) {
  db?.close(); db = new DatabaseSync(':memory:')
  for (const sql of loadAll({ through: 242 })) db.exec(sql)
  if (schema) db.exec(fs.readFileSync(path.join(__dirname, '../migrations/0259_inventory_check_sessions.sql'), 'utf8'))
  db.exec(`INSERT OR REPLACE INTO roles(id,name,code,permissions) VALUES
    (900001,'Counter','employee','{"inventory":true}'),(900002,'Viewer','viewer','{"inventory":true,"inventory:check":false}'),
    (900003,'Administrator','admin','{}');
    INSERT INTO users(id,username,name,password,role_id,organization_id) VALUES
    (900001,'counter-one','Counter One','unused',900001,1),(900002,'counter-two','Counter Two','unused',900001,1),
    (900003,'viewer','Viewer','unused',900002,1),(900004,'owner','Owner','unused',900003,1);
    INSERT OR IGNORE INTO branches(id,name,is_active) VALUES(1,'One',1),(2,'Two',1);
    INSERT INTO products(id,name,stock_quantity) VALUES(900001,'One product',0),(900002,'Two product',0);
    INSERT INTO product_batches(id,variant_product_id,batch_key,received_at) VALUES(900001,900001,'one','2026-10-01'),(900002,900002,'two','2026-10-01');`)
  for (const actor of [900001,900002,900003,900004]) db.prepare("INSERT INTO user_sessions(user_id,token_hash,expires_at,last_seen_at) VALUES(?,?,'2099-01-01T00:00:00.000Z',CURRENT_TIMESTAMP)").run(actor, createHash('sha256').update(`token-${actor}`).digest('hex'))
  beforeCommit = null; loseAck = false; afterCommit = null; queryTrace=[]; batchTrace=[]; batchSequence=0; activeBatch=0; projectionFailures=0
}
async function request(method, url, body, actor = 900001) {
  queryTrace=[]; batchTrace=[]
  const tasks = []
  const result = await route.request(`http://local${url}`, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Cookie: `bos_session=token-${actor}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: binding() }, { waitUntil: task => tasks.push(task) })
  await Promise.allSettled(tasks)
  return { status: result.status, body: await result.json(), queries:queryTrace.slice(), batches:batchTrace.slice() }
}
const physical = () => ['products','product_batches','branch_stock','branch_batch_stock','damaged_stock_lots','sales','sale_items','returns','return_items','inventory_movements','audit_logs'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
const metadata = () => ['inventory_check_sessions','inventory_check_items','inventory_check_events'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
const create = (requestId = 'create-request-01', productIds = [900001], actor = 900001) => request('POST', '/sessions', { branchId: 1, title: 'Count', productIds, scope: { startDate: '2026-10-01', endDate: '2026-10-19',membership:'visible_page',sessionId:'',state:'',reason:'' }, requestId }, actor)

let groups = 0
async function check(name, run) { await run(); groups++; console.log(`PASS ${name}`) }
// started_at is trigger-protected in production; the fixture lifts the guard only to place sessions on chosen business days, then restores it.
const stamp = (id, started, updated = started) => {
  const guard = db.prepare("SELECT sql FROM sqlite_master WHERE name='inventory_check_sessions_identity'").get().sql
  db.exec('DROP TRIGGER inventory_check_sessions_identity')
  db.prepare('UPDATE inventory_check_sessions SET started_at=?,updated_at=? WHERE id=?').run(started, updated, id)
  db.exec(guard)
}
async function main() {
  route = load(path.join(__dirname, '../src/routes/inventoryChecks.ts')).default
  await check('list carries creator, branch, closed_at, can_edit, status and the progress split', async () => {
    reset()
    const made = await create('list-create-01', [900001, 900002]); const id = made.body.item.id
    await request('PATCH', `/sessions/${id}/items/900001`, { state: 'done', expectedRevision: 0, expectedSessionRevision: 0, requestId: 'list-done-0001' })
    await request('PATCH', `/sessions/${id}`, { action: 'close', expectedRevision: 0, requestId: 'list-close-0001' })
    const own = (await request('GET', '/sessions')).body.items[0]
    assert.equal(own.created_by, 900001); assert.equal(own.creator_name, 'counter-one')
    assert.equal(own.branch_id, 1); assert.equal(own.branch_name, 'One')
    assert.equal(own.status, 'closed'); assert.ok(own.closed_at); assert.ok(own.started_at); assert.equal(own.can_edit, true)
    assert.deepEqual(own.progress, { total: 2, unstarted: 1, done: 1, issue: 0 })
    assert.equal((await request('GET', '/sessions', null, 900002)).body.items[0].can_edit, false)
  })
  await check('creator name follows the history actor_name visibility rule', async () => {
    reset(); const id = (await create()).body.item.id
    const otherView = (await request('GET', '/sessions', null, 900002)).body.items[0]
    assert.equal('creator_name' in otherView, false, 'peer without audit_log must not see staff identity')
    const history = (await request('GET', `/sessions/${id}/history`, null, 900002)).body.items[0]
    assert.equal('actor_name' in history, false)
    assert.equal((await request('GET', '/sessions', null, 900004)).body.items[0].creator_name, 'counter-one')
    assert.equal((await request('GET', `/sessions/${id}/history`, null, 900004)).body.items[0].actor_name, 'counter-one')
    db.exec("UPDATE users SET permissions='{\"audit_log\":true}' WHERE id=900002")
    assert.equal((await request('GET', '/sessions', null, 900002)).body.items[0].creator_name, 'counter-one')
    assert.equal((await request('GET', `/sessions/${id}/history`, null, 900002)).body.items[0].actor_name, 'counter-one')
  })
  await check('status, mine and business-day filters narrow the list and the total counts before pagination', async () => {
    reset()
    const a = (await create('filter-a-000001', [900001], 900001)).body.item.id
    const b = (await create('filter-b-000001', [900002], 900002)).body.item.id
    const c = (await create('filter-c-000001', [900001], 900001)).body.item.id
    await request('PATCH', `/sessions/${c}`, { action: 'close', expectedRevision: 0, requestId: 'filter-close-001' }, 900001)
    // 2026-10-10 17:30Z is 11 Oct 00:30 in Cambodia; 2026-10-11 16:59Z is still 11 Oct; 17:00Z is 12 Oct.
    stamp(a, '2026-10-10T17:30:00.000Z', '2026-10-10T17:30:00.000Z'); stamp(b, '2026-10-11T16:59:00.000Z', '2026-10-11T16:59:00.000Z'); stamp(c, '2026-10-11T17:00:00.000Z', '2026-10-11T17:00:00.000Z')
    const ids = async q => { const r = await request('GET', `/sessions${q}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body }
    assert.deepEqual((await ids('')).items.map(x => x.id), [c, b, a])
    assert.deepEqual((await ids('?status=closed')).items.map(x => x.id), [c])
    assert.deepEqual((await ids('?status=open')).items.map(x => x.id), [b, a])
    assert.deepEqual((await ids('?mine=1')).items.map(x => x.id), [c, a])
    assert.deepEqual((await ids('?startDate=2026-10-11&endDate=2026-10-11')).items.map(x => x.id), [b, a])
    assert.deepEqual((await ids('?startDate=2026-10-12')).items.map(x => x.id), [c])
    assert.deepEqual((await ids('?endDate=2026-10-10')).items.map(x => x.id), [])
    const paged = await ids('?mine=1&status=open&pageSize=1&page=1')
    assert.equal(paged.total, 1); assert.deepEqual(paged.items.map(x => x.id), [a])
    const small = await ids('?pageSize=1&page=2'); assert.equal(small.total, 3); assert.deepEqual(small.items.map(x => x.id), [b])
    assert.equal((await ids('?branchId=2&status=open')).total, 0)
  })
  await check('malformed list filters fail closed with 400', async () => {
    reset(); await create()
    for (const q of ['status=done', 'status=OPEN', 'mine=true', 'mine=2', 'startDate=2026-13-01', 'endDate=2026-02-30', 'startDate=10/11/2026', 'startDate=2026-10-1', 'startDate=2026-10-12&endDate=2026-10-11']) {
      const result = await request('GET', `/sessions?${q}`)
      assert.equal(result.status, 400, q); assert.equal(result.body.code, 'inventory_check_invalid_filter', q)
    }
  })
  await check('history events carry the frozen starting product name, not the live one', async () => {
    reset(); const id = (await create('history-name-01', [900001, 900002])).body.item.id
    await request('PATCH', `/sessions/${id}/items/900002`, { state: 'done', expectedRevision: 0, expectedSessionRevision: 0, requestId: 'history-obs-0001' })
    db.exec("UPDATE products SET name='Renamed later' WHERE id=900002")
    let events = (await request('GET', `/sessions/${id}/history`)).body.items
    assert.equal(events.find(e => e.action === 'observe').product_name, 'Two product')
    assert.equal(events.find(e => e.action === 'create').product_name, null)
    db.exec('DELETE FROM products WHERE id=900002')
    events = (await request('GET', `/sessions/${id}/history`)).body.items
    assert.equal(events.find(e => e.action === 'observe').product_name, 'Two product')
  })
  await check('list and history stay inside the Free statement budget', async () => {
    reset(); const id = (await create()).body.item.id
    const list = await request('GET', '/sessions?status=open&mine=1&startDate=2026-01-01&endDate=2026-12-31')
    const history = await request('GET', `/sessions/${id}/history`)
    console.log(`QUERY_BUDGET list=${list.queries.length} listBatches=${list.batches.length} history=${history.queries.length}`)
    assert.ok(list.queries.length <= 8); assert.ok(history.queries.length <= 8)
  })
  console.log(`PASS ${groups} Inventory session list/history groups`)
  db.close()
}
main().catch(error => { console.error(error); process.exitCode = 1 })
