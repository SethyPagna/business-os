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
let db, beforeCommit, loseAck
function binding() {
  function prepare(sql) {
    return { sql, values: [], bind(...values) { if(values.length>100) throw new Error('D1_ERROR: too many SQL variables'); return { ...this, values } }, async all() {
      const results = db.prepare(sql).all(...this.values)
      return { success: true, results, meta: { changes: db.prepare('SELECT changes() AS n').get().n } }
    }, async run() { const result = db.prepare(sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } } } }
  }
  return { prepare, async batch(statements) {
    const writing = statements.some(statement => /INSERT INTO inventory_check_events/.test(statement.sql))
    if (writing && beforeCommit) { const inject = beforeCommit; beforeCommit = null; inject() }
    db.exec('BEGIN')
    try {
      const result = []
      for (const statement of statements) result.push(await statement.all())
      db.exec('COMMIT')
      if (writing && loseAck) { loseAck = false; throw new Error('Lost commit acknowledgement') }
      return result
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error }
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
  beforeCommit = null; loseAck = false
}
async function request(method, url, body, actor = 900001) {
  const tasks = []
  const result = await route.request(`http://local${url}`, { method, headers: { 'Content-Type': 'application/json', ...(actor ? { Cookie: `bos_session=token-${actor}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, { DB: binding() }, { waitUntil: task => tasks.push(task) })
  await Promise.allSettled(tasks)
  return { status: result.status, body: await result.json() }
}
const physical = () => ['products','product_batches','branch_stock','branch_batch_stock','damaged_stock_lots','sales','sale_items','returns','return_items','inventory_movements','audit_logs'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
const metadata = () => ['inventory_check_sessions','inventory_check_items','inventory_check_events'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
const create = (requestId = 'create-request-01', productIds = [900001], actor = 900001) => request('POST', '/sessions', { branchId: 1, title: 'Count', productIds, scope: { startDate: '2026-10-01', endDate: '2026-10-19',membership:'visible_page',sessionId:'',state:'',reason:'' }, requestId }, actor)
let groups = 0
async function check(name, run) { await run(); groups++; console.log(`PASS ${name}`) }
async function main() {
  await check('schema migration preserves explicit role choices, inserts only missing Employee defaults and refuses malformed permissions', async () => {
    for (const permissions of ['{"inventory_checks":false,"inventory_check_show_stock":false,"inventory_check_show_cost":true,"other":7}','{}','[]','broken']) {
      db?.close(); db=new DatabaseSync(':memory:')
      for(const sql of loadAll({through:242})) db.exec(sql)
      db.exec("INSERT INTO roles(id,name,code,permissions) VALUES(900001,'Employee','employee','{}'),(900002,'Other','other','{\"keep\":true}')")
      db.prepare("UPDATE roles SET permissions=? WHERE code='employee'").run(permissions)
      const other=db.prepare("SELECT id,permissions FROM roles WHERE code<>'employee' ORDER BY id").all()
      const users=db.prepare('SELECT id,permissions FROM users ORDER BY id').all()
      const sql=fs.readFileSync(path.join(__dirname,'../migrations/0259_inventory_check_sessions.sql'),'utf8')
      assert.equal(sql.includes('\r'),false,'migration must have LF line endings')
      if(['[]','broken'].includes(permissions)) {
        assert.throws(()=>db.exec(sql),/inventory_checks_role_permissions_invalid/)
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='inventory_check_sessions'").get().n,0)
        assert.equal(db.prepare("SELECT permissions FROM roles WHERE code='employee'").get().permissions,permissions)
      } else {
        db.exec(sql)
        const role=JSON.parse(db.prepare("SELECT permissions FROM roles WHERE code='employee'").get().permissions)
        for(const [key,value] of Object.entries(JSON.parse(permissions))) assert.equal(role[key],value)
        if(permissions==='{}') { assert.equal(role.inventory_checks,true); assert.equal(role.inventory_check_show_cost,false); assert.equal(role.inventory_check_show_stock,true) }
        assert.deepEqual(db.prepare("SELECT id,permissions FROM roles WHERE code<>'employee' ORDER BY id").all(),other)
        assert.deepEqual(db.prepare('SELECT id,permissions FROM users ORDER BY id').all(),users)
      }
    }
  })
  route = load(path.join(__dirname, '../src/routes/inventoryChecks.ts')).default
  await check('real authenticated session routes fail closed without a cookie or additive schema', async () => {
    reset(false)
    assert.equal((await request('GET','/sessions',null,0)).status,401)
    assert.equal((await request('GET','/sessions')).status,503)
  })
  await check('frozen zero baseline, explicit membership, done/issue/clear and immutable metadata history leave business ledgers unchanged', async () => {
    reset(); const before = physical(); const made = await create(); assert.equal(made.status,201)
    const id = made.body.item.id
    let detail = await request('GET',`/sessions/${id}`)
    assert.equal(detail.body.items[0].baseline_quantity,0)
    let saved = await request('PATCH',`/sessions/${id}/items/900001`,{state:'done',counted_quantity:0,expectedRevision:0,expectedSessionRevision:0,requestId:'save-request-01'})
    assert.equal(saved.status,200); assert.equal(saved.body.item.counted_quantity,0)
    saved = await request('PATCH',`/sessions/${id}/items/900001`,{state:'issue',counted_quantity:2,reason:'Missing label',expectedRevision:1,expectedSessionRevision:0,requestId:'save-request-02'})
    assert.equal(saved.status,200); assert.equal(saved.body.item.reason,'Missing label')
    saved = await request('PATCH',`/sessions/${id}/items/900001`,{state:'unstarted',expectedRevision:2,expectedSessionRevision:0,requestId:'save-request-03'})
    assert.equal(saved.body.item.revision,3); assert.equal(saved.body.item.counted_quantity,null)
    assert.equal((await request('GET',`/sessions/${id}/history`)).body.total,4)
    assert.throws(()=>db.exec('DELETE FROM inventory_check_events'),/immutable/)
    assert.throws(()=>db.exec('UPDATE inventory_check_items SET baseline_quantity=9'),/immutable/)
    assert.deepEqual(physical(),before)
  })
  await check('all permitted staff view all sessions, only creator or current admin edits, viewer cannot create', async () => {
    reset(); const made = await create(); const id = made.body.item.id
    assert.equal((await request('GET','/sessions',null,900002)).body.items.length,1)
    assert.equal((await request('GET',`/sessions/${id}`,null,900003)).status,200)
    const body={state:'done',expectedRevision:0,expectedSessionRevision:0,requestId:'other-edit-01'}
    assert.equal((await request('PATCH',`/sessions/${id}/items/900001`,body,900002)).status,403)
    assert.equal((await create('viewer-create-01',[900001],900003)).status,403)
    assert.equal((await request('PATCH',`/sessions/${id}/items/900001`,body,900004)).status,200)
  })
  await check('same-row/session CAS, late close and permission/session revocation refuse atomically', async () => {
    reset(); const id=(await create()).body.item.id
    const patch={state:'done',expectedRevision:0,expectedSessionRevision:0,requestId:'race-edit-01'}
    assert.equal((await request('PATCH',`/sessions/${id}/items/900001`,patch)).status,200)
    assert.equal((await request('PATCH',`/sessions/${id}/items/900001`,{...patch,requestId:'stale-edit-01'})).status,409)
    beforeCommit=()=>db.exec(`UPDATE inventory_check_sessions SET status='closed',revision=revision+1 WHERE id='${id}'`)
    assert.equal((await request('PATCH',`/sessions/${id}/items/900001`,{...patch,expectedRevision:1,requestId:'late-close-01'})).status,409)
    const reopened=await request('PATCH',`/sessions/${id}`,{action:'resume',expectedRevision:1,requestId:'resume-request-01'})
    assert.equal(reopened.status,200)
    let before=metadata(); beforeCommit=()=>db.exec("UPDATE users SET permissions='{\"inventory\":false}' WHERE id=900001")
    assert.equal((await request('PATCH',`/sessions/${id}/items/900001`,{...patch,expectedRevision:1,expectedSessionRevision:2,requestId:'revoke-edit-01'})).status,403)
    assert.deepEqual(metadata(),before)
    db.exec("UPDATE users SET permissions='{}' WHERE id=900001")
    before=metadata(); beforeCommit=()=>db.exec('UPDATE user_sessions SET revoked_at=CURRENT_TIMESTAMP WHERE user_id=900001')
    assert.equal((await request('PATCH',`/sessions/${id}/items/900001`,{...patch,expectedRevision:1,expectedSessionRevision:2,requestId:'revoke-token-01'})).status,403)
    assert.deepEqual(metadata(),before)
  })
  await check('lost ACK retries reconcile one immutable receipt and reject changed reuse', async () => {
    reset(); const id=(await create()).body.item.id; const body={state:'done',expectedRevision:0,expectedSessionRevision:0,requestId:'lost-ack-edit-01'}
    loseAck=true; const first=await request('PATCH',`/sessions/${id}/items/900001`,body)
    assert.ok([200,503].includes(first.status))
    const replay=await request('PATCH',`/sessions/${id}/items/900001`,body)
    assert.equal(replay.status,200); assert.equal(replay.body.receipt.replayed,true)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inventory_check_events WHERE action='observe'").get().n,1)
    assert.equal((await request('PATCH',`/sessions/${id}/items/900001`,{...body,state:'issue',reason:'Changed'})).status,409)
  })
  await check('current stock drift is separate from frozen baseline and a racing create cannot freeze a stale starting-now snapshot', async () => {
    reset(); const id=(await create()).body.item.id
    db.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(900001,1,5); UPDATE products SET stock_quantity=5 WHERE id=900001')
    const detail=await request('GET',`/sessions/${id}`)
    assert.equal(detail.body.items[0].baseline_quantity,0); assert.equal(detail.body.items[0].current_quantity,5); assert.equal(detail.body.items[0].stock_changed,true)
    assert.equal((await request('PATCH',`/sessions/${id}/items/900001`,{state:'done',counted_quantity:4,expectedRevision:0,expectedSessionRevision:0,requestId:'mismatch-count-01'})).body.code,'inventory_check_count_requires_issue')
    assert.equal((await request('PATCH',`/sessions/${id}/items/900001`,{state:'issue',counted_quantity:4,reason:'Count differs',expectedRevision:0,expectedSessionRevision:0,requestId:'mismatch-issue-01'})).status,200)
    const before=metadata(); beforeCommit=()=>db.exec('UPDATE branch_stock SET quantity=6 WHERE product_id=900001; UPDATE products SET stock_quantity=6 WHERE id=900001')
    assert.equal((await create('racing-create-01')).status,409); assert.deepEqual(metadata(),before)
  })
  await check('branch-only, lot-only, damaged-only and cache-only baselines preserve null/known distinctions', async () => {
    for(const [kind,seed,quantity] of [['branch','INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(900001,1,4)',4],['lot','INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900001,1,4)',null],['damaged','INSERT INTO damaged_stock_lots(product_id,branch_id,quantity,quantity_remaining) VALUES(900001,1,4,4)',4],['cache','UPDATE products SET stock_quantity=4 WHERE id=900001',null]]) {
      reset(); db.exec(seed); const before=physical(); const made=await create(); assert.equal(made.status,201,kind)
      assert.equal((await request('GET',`/sessions/${made.body.item.id}`)).body.items[0].baseline_quantity,quantity,kind)
      assert.deepEqual(physical(),before)
    }
  })
  await check('hidden system stock permits blind own counts without an inference oracle and omits other-session counts; cohort and phantom membership enforced', async () => {
    reset(); const id=(await create()).body.item.id
    db.exec("UPDATE users SET permissions='{\"inventory_check_show_stock\":false}' WHERE id=900001")
    let item=(await request('GET',`/sessions/${id}`)).body.items[0]
    for(const key of ['baseline_quantity','current_quantity','stock_changed','baseline','current_stock']) assert.equal(key in item,false,key)
    const blind={state:'done',counted_quantity:37,expectedRevision:0,expectedSessionRevision:0,requestId:'blind-count-01'}
    let saved=await request('PATCH',`/sessions/${id}/items/900001`,blind)
    assert.equal(saved.status,200); assert.equal(saved.body.item.counted_quantity,37)
    saved=await request('PATCH',`/sessions/${id}/items/900001`,blind)
    assert.equal(saved.body.receipt.replayed,true); assert.equal(saved.body.item.counted_quantity,37)
    assert.equal((await request('GET',`/sessions/${id}/history`)).body.items[0].after.counted_quantity,37)
    db.exec("UPDATE users SET permissions='{\"inventory_check_show_stock\":false}' WHERE id=900002")
    item=(await request('GET',`/sessions/${id}`,null,900002)).body.items[0]
    assert.equal('counted_quantity' in item,false)
    assert.equal('counted_quantity' in (await request('GET',`/sessions/${id}/history`,null,900002)).body.items[0].after,false)
    db.exec("UPDATE products SET is_group=1 WHERE id=900001; UPDATE products SET parent_id=900001,name='One product' WHERE id=900002; UPDATE product_batches SET received_at='2025-01-01' WHERE id=900002")
    assert.equal((await create('header-create-01',[900001])).status,400)
    assert.equal((await create('outside-cohort-01',[900002])).status>=400,true)
  })
  console.log(`PASS ${groups} actual authenticated HTTP/SQLite Inventory session groups`)
  db.close()
}
main().catch(error=>{console.error(error);process.exitCode=1})
