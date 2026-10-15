// RC2-HOTFIX (1 Oct 2026): the Resolve grid's Merge answered 500 in the real Worker
// ("Expression tree is too large (maximum depth 100)") for the simplest pair. The
// plan path's in-transaction fingerprint guard compared every column of a product
// row in one left-leaning AND chain, and D1's SQLite parses with expression depth
// 100 while node:sqlite defaults to 1000, so no earlier test could see it.
//
// Here the route harness runs SQLite at D1's depth (100) and the REAL Resolve
// plan (body.resolve) merges: the plainest pair, fresh stock-in sessions on one
// and both sides, a zero-quantity pair, 30 and 77 lots; a stale reviewed state
// still gets its coded 409; and every statement the merge builds is measured so a
// future wide guard fails here, not in production.
//
// Run (from cloudflare/): node scripts/test-merge-resolve-expr-depth-native.cjs
'use strict'
const assert = require('node:assert/strict')
const { DatabaseSync } = require('node:sqlite')
const { createProductsRouteHarness } = require('./harness/load_products_route.cjs')

const ADMIN = { id: 7, username: 'admin', name: 'Admin', role_code: 'admin', permissions: JSON.stringify({ all: true }) }
const D1_EXPR_DEPTH = 100
// A guard may use most of D1's depth; this much headroom keeps a few added
// columns from tipping a statement over the limit.
const DEPTH_BUDGET = 70

function assertDepthBudget(depth,sql) {
  assert.ok(depth!==null && depth<=DEPTH_BUDGET,`statement needs depth ${depth} (budget ${DEPTH_BUDGET}): ${sql.slice(0,200)}`)
}
async function historyStep(f,id,direction,generation) {
  const app=f.h.load('routes/actionHistory.ts').default
  const response=await app.request(`http://local/${id}/${direction}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({require_applied:true,expected_generation:generation})},{DB:f.h.raw},{waitUntil:p=>p?.catch?.(()=>{}),passThroughOnException(){}})
  return {status:response.status,json:await response.json()}
}
const graphState=f=>JSON.stringify(['products','branch_stock','product_batches','branch_batch_stock','product_cost_entries','action_history','undo_snapshots','audit_logs'].map(table=>f.h.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()))
const fixtureHandles=[]
let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`PASS ${name}`) } catch (error) {
    failed += 1
    console.log(`FAIL ${name}\n${error && error.stack ? error.stack : error}`)
  } finally { while(fixtureHandles.length)fixtureHandles.pop().db.close() }
}

function fixtureWrite(h,write) {
  h.raw.db.exec('BEGIN IMMEDIATE')
  try {
    h.raw.db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
    const value=write()
    h.raw.db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
    h.raw.db.exec('COMMIT')
    assert.equal(h.raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0)
    return value
  } catch(error) {h.raw.db.exec('ROLLBACK');throw error}
}
function fixture() {
  const h = createProductsRouteHarness({ user: ADMIN })
  fixtureHandles.push(h.raw)
  h.setUser(ADMIN)
  assert.equal(h.raw.db.limits.exprDepth, D1_EXPR_DEPTH, 'the harness must parse at D1 depth')
  fixtureWrite(h,()=>h.raw.db.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1), (2, 'Warehouse', 0, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, selling_price_usd, stock_quantity, is_active) VALUES
      (1, 'Gloss One', '8850000000011', 2, 5, 0, 1),
      (2, 'Gloss One', '8850000000011', 3, 5, 0, 1);
  `))
  const statements = []
  const rawPrepare = h.raw.prepare.bind(h.raw)
  h.raw.prepare = (sql) => { statements.push(sql); return rawPrepare(sql) }
  const rawBatch = h.raw.batch.bind(h.raw)
  h.raw.batch = (items) => { for (const item of items) statements.push(item.sql); return rawBatch(items) }
  const sessions = h.load('lib/stockSession.ts')
  const env = { DB: h.raw }
  let counter = 0
  const receive = (lines) => sessions.commitStockSession(env, ADMIN, {
    client_request_id: `req-expr-depth-${String(counter += 1).padStart(4, '0')}`,
    mode: 'stock_in',
    defaults: { branch_id: 1, received_date: '2026-09-29', supplier_name: 'Synthetic Supplier' },
    items: lines.map((line, index) => ({ line_id: `l${counter}-${index}`, kind: 'receive', unit_cost_usd: 3, ...line })),
  })
  return { h, receive, statements }
}

let requests = 0
async function resolveMerge(f, { keepId = 1, mergeId = 2, stock } = {}) {
  const preview = await f.h.request('GET', `/possible-duplicates/merge-preview?keepId=${keepId}&mergeId=${mergeId}&keep=1`)
  assert.equal(preview.status, 200, JSON.stringify(preview.json))
  const resolve = {
    requestId: `resolve-expr-depth-${requests += 1}-0001`,
    reviewedDigest: preview.json.reviewedDigest,
    steps: [{ mergeId, ...(stock ? { stock } : {}) }],
  }
  return f.h.request('POST', '/possible-duplicates/merge', { keepId, mergeId, keep: true, ...(stock ? { stock } : {}), resolve })
}

const activeIds = (f) => f.h.raw.prepare('SELECT id FROM products WHERE is_active = 1 ORDER BY id').all().map((row) => row.id)
const sessionStatus = (f, id) => f.h.raw.prepare('SELECT status, last_error FROM action_history WHERE id = ?').get([id])

function addLots(f, productId, count) {
  let total = 0
  for (let i = 0; i < count; i += 1) {
    const quantity = (i % 5) + 1
    total += quantity
    fixtureWrite(f.h,()=>f.h.raw.db.prepare(`INSERT INTO product_batches(id, variant_product_id, batch_key, lot_code, received_at, is_active, unit_cost_usd, received_quantity, received_branch_id)
      VALUES(?, ?, ?, ?, '2026-09-01', 1, 3, ?, 1)`).run(productId * 1000 + i, productId, `lot-${productId}-${i}`, `L${productId}-${i}`, quantity))
    fixtureWrite(f.h,()=>f.h.raw.db.prepare('INSERT INTO branch_batch_stock(batch_id, branch_id, quantity) VALUES(?, 1, ?)').run(productId * 1000 + i, quantity))
  }
  fixtureWrite(f.h,()=>f.h.raw.db.prepare('INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(?, 1, ?) ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = quantity + excluded.quantity').run(productId, total))
  fixtureWrite(f.h,()=>f.h.raw.db.prepare('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?').run(total, productId))
  return total
}

// The smallest expression depth at which `sql` still parses, or null above the limit.
function parseDepth(db, sql) {
  const saved = db.limits.exprDepth
  try {
    for (let depth = 10; depth <= D1_EXPR_DEPTH; depth += 2) {
      db.limits.exprDepth = depth
      try { db.prepare(sql); return depth } catch (error) { if (!/Expression tree is too large/.test(String(error))) return depth }
    }
    return null
  } finally { db.limits.exprDepth = saved }
}

async function main() {
  await check('DISCRIMINATING: the plainest pair (no stock, no session) merges through the Resolve plan at D1 depth', async () => {
    const f = fixture()
    const res = await resolveMerge(f)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(activeIds(f), [1])
    assert.equal(f.h.raw.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'merge_duplicate'").get().n, 1)
  })

  await check('a fresh stock-in session on the discarded side, the kept side, and both sides: each merges and closes its Undo', async () => {
    for (const [label, receipts] of [['dup', [[2, 4]]], ['keeper', [[1, 4]]], ['both', [[1, 4], [2, 3]]]]) {
      const f = fixture()
      const made = []
      for (const [productId, quantity] of receipts) made.push(await f.receive([{ product_id: productId, quantity }]))
      const res = await resolveMerge(f, { stock: 'merge' })
      assert.equal(res.status, 200, `${label}: ${JSON.stringify(res.json)}`)
      assert.deepEqual(activeIds(f), [1], label)
      for (const receipt of made) assert.equal(sessionStatus(f, receipt.actionHistoryId).status, 'recorded', `${label}: the session Undo is closed`)
      const units = f.h.raw.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM branch_stock WHERE product_id = 1').get().n
      assert.equal(units, receipts.reduce((sum, [, quantity]) => sum + quantity, 0), `${label}: no stock lost`)
    }
  })

  await check('a pair whose discarded side holds quantity 0 after a session merges', async () => {
    const f = fixture()
    const made = await f.receive([{ product_id: 2, quantity: 4 }])
    fixtureWrite(f.h,()=>f.h.raw.db.exec('UPDATE branch_stock SET quantity = 0 WHERE product_id = 2; UPDATE branch_batch_stock SET quantity = 0; UPDATE products SET stock_quantity = 0 WHERE id = 2'))
    const res = await resolveMerge(f)
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.deepEqual(activeIds(f), [1])
    assert.equal(sessionStatus(f, made.actionHistoryId).status, 'recorded')
  })

  for (const lots of [30, 77]) {
    await check(`a discarded product with ${lots} lots merges through the Resolve plan and every unit lands on the keeper`, async () => {
      const f = fixture()
      const units = addLots(f, 2, lots)
      const res = await resolveMerge(f, { stock: 'merge' })
      assert.equal(res.status, 200, JSON.stringify(res.json))
      assert.deepEqual(activeIds(f), [1])
      assert.equal(f.h.raw.prepare('SELECT COALESCE(SUM(quantity), 0) AS n FROM branch_stock WHERE product_id = 1').get().n, units)
      const lotUnits = f.h.raw.prepare(`SELECT COALESCE(SUM(bbs.quantity), 0) AS n FROM branch_batch_stock bbs
        JOIN product_batches pb ON pb.id = bbs.batch_id WHERE pb.variant_product_id = 1`).get().n
      assert.equal(lotUnits, units, 'the lot ledger agrees with the shelf')
    })
  }

  for(const mutation of ['none','last_lot','raw_pce','unrelated'])await check(`77-lot replay retains typed complete graph, mutation=${mutation}`,async()=>{
    const f=fixture(),units=addLots(f,2,77)
    fixtureWrite(f.h,()=>{
      f.h.raw.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,cost_khr,source,baseline_batch_id) VALUES(2,0,NULL,'manual',0)").run()
      f.h.raw.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,cost_khr,source,baseline_batch_id) VALUES(2,?,NULL,'manual',0)").run(7.123456789012345)
    })
    const merged=await resolveMerge(f,{stock:'merge'});assert.equal(merged.status,200,JSON.stringify(merged.json))
    const history=f.h.raw.prepare("SELECT h.id,s.payload_json FROM action_history h JOIN undo_snapshots s ON s.id=CAST(json_extract(h.undo_payload,'$.snapshot_id') AS INTEGER) WHERE s.kind='product.merge' ORDER BY h.id DESC LIMIT 1").get()
    assert.ok(history)
    const reversal=JSON.parse(history.payload_json),prepared=await f.h.load('lib/undoAppliers.ts').prepareAtomicMergeGraphReceipt(f.h.db,reversal)
    const bytes=Buffer.byteLength(prepared.graph.sql,'utf8'),bindings=Object.keys(prepared.graph.params).length
    assert.ok(bytes<=65536);assert.ok(bindings<=85);assert.equal(bytes,prepared.graph.sql.length,'generated receipt SQL is ASCII; length equals UTF8 bytes')
    assert.ok(JSON.parse(prepared.graph.params.mergeGraphBindings).includes(2076),'the saved77th lot remains in exact receipt scope')
    console.log('RECEIPT '+JSON.stringify({mutation,sqlBytes:bytes,bindings,inputBytes:Buffer.byteLength(JSON.stringify(prepared.graph.params),'utf8'),stateBytes:Buffer.byteLength(reversal.costReviewState.graph_state,'utf8')}))
    const productRevision=()=>f.h.raw.prepare("SELECT revision FROM stock_session_revisions WHERE entity_type='product' AND entity_key='1'").get().revision
    const revision=productRevision()
    if(mutation==='last_lot')fixtureWrite(f.h,()=>f.h.raw.db.prepare("UPDATE product_batches SET notes='late77thlot' WHERE id=2076").run())
    if(mutation==='raw_pce')fixtureWrite(f.h,()=>{
      const row=f.h.raw.prepare('SELECT id,cost_usd FROM product_cost_entries ORDER BY id DESC LIMIT 1').get()
      assert.equal(row.cost_usd,7.123456789012345)
      f.h.raw.db.prepare('UPDATE product_cost_entries SET cost_usd=? WHERE id=?').run(7.123456789012346,row.id)
      assert.equal(f.h.raw.prepare('SELECT cost_usd FROM product_cost_entries WHERE id=?').get([row.id]).cost_usd,7.123456789012346)
    })
    if(mutation==='unrelated')fixtureWrite(f.h,()=>{
      f.h.raw.db.prepare("INSERT INTO products(id,name,cost_price_usd,is_active) VALUES(3,'Unrelated typed control',NULL,1)").run()
      f.h.raw.db.prepare("INSERT INTO product_cost_entries(product_id,cost_usd,cost_khr,source,baseline_batch_id) VALUES(3,0,NULL,'manual',0)").run()
    })
    assert.equal(productRevision(),revision,'mutation does not advance the keeper revision')
    const before=graphState(f),undo=await historyStep(f,history.id,'undo',0)
    if(['last_lot','raw_pce'].includes(mutation)){
      assert.equal(undo.status,409,JSON.stringify(undo.json));assert.equal(graphState(f),before)
    }else{
      assert.equal(undo.status,200,JSON.stringify(undo.json))
      assert.equal(f.h.raw.prepare('SELECT SUM(quantity) n FROM branch_stock WHERE product_id=2').get().n,units)
      const redo=await historyStep(f,history.id,'redo',1);assert.equal(redo.status,200,JSON.stringify(redo.json))
      assert.equal(f.h.raw.prepare('SELECT SUM(quantity) n FROM branch_stock WHERE product_id=1').get().n,units)
      assert.equal(f.h.raw.prepare('SELECT COUNT(*) n FROM product_batches WHERE variant_product_id=1 AND unit_cost_usd=3').get().n,77)
      assert.equal(f.h.raw.prepare('SELECT cost_usd FROM product_cost_entries ORDER BY id DESC LIMIT 1').get().cost_usd,mutation==='unrelated'?0:7.123456789012345)
      if(mutation==='unrelated'){assert.equal(f.h.raw.prepare('SELECT cost_price_usd FROM products WHERE id=3').get().cost_price_usd,null);assert.equal(f.h.raw.prepare('SELECT cost_usd FROM product_cost_entries WHERE product_id=3').get().cost_usd,0)}
    }
    assert.equal(f.h.raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n,0)
  })

  await check('a reviewed state that went stale still gets the coded 409 and writes nothing', async () => {
    const f = fixture()
    await f.receive([{ product_id: 2, quantity: 4 }])
    const preview = await f.h.request('GET', '/possible-duplicates/merge-preview?keepId=1&mergeId=2&keep=1')
    const resolve = { requestId: 'resolve-expr-depth-stale-1', reviewedDigest: preview.json.reviewedDigest, steps: [{ mergeId: 2, stock: 'merge' }] }
    fixtureWrite(f.h,()=>f.h.raw.db.exec("UPDATE products SET selling_price_usd = 6 WHERE id = 2"))
    const before = JSON.stringify(f.h.raw.prepare('SELECT * FROM products ORDER BY id').all())
    const res = await f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge', keep: true, resolve })
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json.code, 'merge_state_conflict')
    assert.equal(JSON.stringify(f.h.raw.prepare('SELECT * FROM products ORDER BY id').all()), before)
    assert.deepEqual(activeIds(f), [1, 2])
  })

  await check('a change made between the review read and the atomic guard (a lot added) is the same coded 409 from the in-transaction guard', async () => {
    const f = fixture()
    addLots(f, 2, 3)
    const preview = await f.h.request('GET', '/possible-duplicates/merge-preview?keepId=1&mergeId=2&keep=1')
    const resolve = { requestId: 'resolve-expr-depth-race-1', reviewedDigest: preview.json.reviewedDigest, steps: [{ mergeId: 2, stock: 'merge' }] }
    fixtureWrite(f.h,()=>f.h.raw.db.exec(`INSERT INTO product_batches(id, variant_product_id, batch_key, received_at, is_active, unit_cost_usd, received_quantity)
      VALUES(99999, 2, 'late-lot', '2026-09-02', 1, 3, 1)`))
    const res = await f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId: 2, stock: 'merge', keep: true, resolve })
    assert.equal(res.status, 409, JSON.stringify(res.json))
    assert.equal(res.json.code, 'merge_state_conflict')
    assert.deepEqual(activeIds(f), [1, 2])
  })

  await check('every statement the merge and resolve paths built parses within the depth budget (measured, worst-case fixture)', async () => {
    const f = fixture()
    await f.receive([{ product_id: 1, quantity: 4 }])
    await f.receive([{ product_id: 2, quantity: 3 }])
    addLots(f, 2, 77)
    f.statements.length = 0
    const res = await resolveMerge(f, { stock: 'merge' })
    assert.equal(res.status, 200, JSON.stringify(res.json))
    assert.ok(f.statements.length > 50, 'the fixture ran the whole fold')
    let worst = { depth: 0, sql: '' }
    for (const sql of new Set(f.statements)) {
      const depth = parseDepth(f.h.raw.db, sql)
      assert.notEqual(depth, null, `a statement exceeds D1's expression depth ${D1_EXPR_DEPTH}: ${sql.slice(0, 160)}`)
      if (depth > worst.depth) worst = { depth, sql }
    }
    console.log(`  deepest statement parses at depth ${worst.depth}: ${worst.sql.replace(/\s+/g, ' ').slice(0, 90)}`)
    assertDepthBudget(worst.depth,worst.sql)
  })

  await check('a four-product group with differing costs, prices and lots merges step by step at D1 depth within the budget', async () => {
    const f = fixture()
    fixtureWrite(f.h,()=>f.h.raw.db.exec(`INSERT INTO products(id, name, barcode, cost_price_usd, selling_price_usd, stock_quantity, is_active) VALUES
      (3, 'Gloss One', '8850000000012', 4, 6.1234, 0, 1), (4, 'Gloss One', '8850000000013', 5, 7, 0, 1)`))
    await f.receive([{ product_id: 1, quantity: 4 }])
    addLots(f, 3, 12)
    const groupIds = '1,2,3,4'
    const preview = await f.h.request('GET', `/possible-duplicates/merge-preview?keepId=1&mergeId=2&keep=1&groupIds=${groupIds}`)
    assert.equal(preview.status, 200, JSON.stringify(preview.json))
    const resolve = { requestId: 'resolve-expr-depth-group-0001', reviewedDigest: preview.json.reviewedDigest, steps: [2, 3, 4].map((mergeId) => ({ mergeId, stock: 'merge' })) }
    f.statements.length = 0
    for (const mergeId of [2, 3, 4]) {
      const res = await f.h.request('POST', '/possible-duplicates/merge', { keepId: 1, mergeId, keep: true, stock: 'merge', resolve })
      assert.equal(res.status, 200, `step ${mergeId}: ${JSON.stringify(res.json)}`)
    }
    assert.deepEqual(activeIds(f), [1])
    let worst = 0
    for (const sql of new Set(f.statements)) {
      const depth = parseDepth(f.h.raw.db, sql)
      assert.notEqual(depth, null, `a group-step statement exceeds D1's expression depth: ${sql.slice(0, 160)}`)
      worst = Math.max(worst, depth)
    }
    console.log(`  deepest group-step statement parses at depth ${worst}`)
    assertDepthBudget(worst,'group steps')
  })

  await check('CONTROL: the old left-leaning chain of a products row is over D1 depth; the balanced join of 200 terms is not', async () => {
    const f = fixture()
    const { joinBalanced } = f.h.load('lib/undoAppliers.ts')
    const terms = (n) => Array.from({ length: n }, (_, i) => `live."c${i}" IS json_extract(saved.value,'$.c${i}')`)
    const probe = new DatabaseSync(':memory:')
    probe.exec('CREATE TABLE live(x)')
    probe.limits.exprDepth = D1_EXPR_DEPTH
    const columns = Array.from({ length: 200 }, (_, i) => `1 AS c${i}`).join(',')
    const wrapped = (condition) => `WITH live AS (SELECT ${columns}) SELECT 1 FROM json_each(@rows) saved WHERE NOT EXISTS(SELECT 1 FROM live WHERE ${condition})`
    assert.throws(() => probe.prepare(wrapped(terms(51).join(' AND '))), /Expression tree is too large/, 'the control must fail: 51 columns is a products row')
    assert.doesNotThrow(() => probe.prepare(wrapped(joinBalanced(terms(200), 'AND'))))
    assert.equal(joinBalanced(['a'], 'AND'), 'a')
    assert.equal(joinBalanced(['a', 'b', 'c'], 'OR'), '((a OR b) OR c)')
    const tooDeep='SELECT '+'abs('.repeat(74)+'1'+')'.repeat(74)
    const depth=parseDepth(probe,tooDeep)
    assert.ok(depth>DEPTH_BUDGET && depth<D1_EXPR_DEPTH)
    assert.throws(()=>assertDepthBudget(depth,tooDeep),/budget 70/)
  })

  console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed')
  if (failed) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
