
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
function autoStub() {
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === '__esModule') return true
      if (typeof prop === 'symbol') return undefined
      return () => { throw new Error(`Unwired dependency: ${String(prop)}`) }
    },
  })
}

const moduleCache = new Map()
function loadReal(relPath, overrides = {}) {
  const cacheKey = relPath + '::' + Object.keys(overrides).sort().join(',')
  if (moduleCache.has(cacheKey)) return moduleCache.get(cacheKey)
  const sourcePath = path.join(root, 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8') + (relPath === 'routes/inventory.ts' ? '\nexport { applyStockDelta };' : '')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  const patchedLoad = function (request, parent, isMain) {
    if (request in overrides) return overrides[request]
    if (request.startsWith('.')) {
      if (relPath.startsWith('lib/')) return loadReal(path.posix.normalize(path.posix.join(path.posix.dirname(relPath), request)) + '.ts')
      return autoStub()
    }
    Module._load = originalLoad
    try {
      return originalLoad.call(this, request, parent, isMain)
    } finally {
      Module._load = patchedLoad
    }
  }
  Module._load = patchedLoad
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  moduleCache.set(cacheKey, moduleObj.exports)
  return moduleObj.exports
}
function wrapFlat(rawDb) {
  return {
    raw: rawDb,
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: (params) => stmt.get(params),
        all: (params) => stmt.all(params) ?? [],
        run: (params) => {
          const r = stmt.run(params)
          return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    async batch(items) {
      return rawDb.batch(items)
    },
    async transaction(fn) { return fn(this) },
  }
}

let currentDb = null
const dbOverride = { getDb: () => currentDb }
const moneyMod = loadReal('lib/moneyPrecision.ts')
const batchCodeMod = loadReal('lib/batchCode.ts')
const sqlBindingMod = loadReal('lib/sqlBinding.ts')
const stockConditionMod = loadReal('lib/stockCondition.ts')
const stockReceiptGateMod = loadReal('lib/stockReceiptGate.ts')
const stockReasonMod = loadReal('lib/stockReason.ts')
const actorSnapshotMod = loadReal('lib/actorSnapshot.ts')
const permissionsMod = loadReal('lib/permissions.ts')
const productDetailRuleMod = loadReal('lib/productDetailRule.ts', { './moneyPrecision': moneyMod })
const productIdentityMod = loadReal('lib/productIdentity.ts', {
  './db': dbOverride, './sqlBinding': sqlBindingMod, './productDetailRule': productDetailRuleMod,
})
const movementCostSnapshotMod = loadReal('lib/movementCostSnapshot.ts', { './moneyPrecision': moneyMod })
const receivingBranchMod = loadReal('lib/receivingBranch.ts')
if (process.argv.includes('--wrong-preflight')) receivingBranchMod.requireReceivingBranch = async () => {}
if (process.argv.includes('--wrong-guard')) receivingBranchMod.receivingBranchAssertion = () => ({ sql:'SELECT 1', params:{} })
const acquisitionMod = loadReal('lib/acquisitionCostAccess.ts', { './permissions': permissionsMod })
const schemaMod = loadReal('lib/schemaProbe.ts')
const costMod = loadReal('lib/catalogCostRecompute.ts', { './moneyPrecision': moneyMod })
const stockMathMod = loadReal('lib/stockSessionMath.ts', { './moneyPrecision': moneyMod })
const productBatchesMod = loadReal('lib/productBatches.ts', {
  './receivingBranch': receivingBranchMod, './db': dbOverride, './batchCode': batchCodeMod, './moneyPrecision': moneyMod, './sqlBinding': sqlBindingMod,
})
const stockMutationReceiptMod = loadReal('lib/stockMutationReceipt.ts')
let auditCalls = []
const auditStub = { changedFields: loadReal('lib/audit.ts', { './db': dbOverride }).changedFields, audit: async (...args) => { auditCalls.push(args) } }
const cacheStub = { bumpVersion: async () => {} }
const broadcastStub = { broadcast: async () => {} }
const authStub = { requireAuth: async (c, next) => { await next() } }

const inventoryMod = loadReal('routes/inventory.ts', {
  '../lib/continuousReadWindow': loadReal('lib/continuousReadWindow.ts'),
  '../lib/receivingBranch': receivingBranchMod,
  '../lib/acquisitionCostAccess': acquisitionMod,
  '../lib/catalogCostRecompute': costMod,
  '../lib/schemaProbe': schemaMod,
  '../lib/stockSessionMath': stockMathMod,
  '../lib/db': dbOverride,
  '../lib/auth': authStub,
  '../lib/audit': auditStub,
  '../lib/permissions': permissionsMod,
  '../lib/stockReason': stockReasonMod,
  '../lib/cache': cacheStub,
  '../lib/telegram': { formatStockChangeTelegramLines: () => [], sendTelegramEvent: async () => {} },
  '../durable-objects/broadcastHub': broadcastStub,
  '../lib/productBatches': productBatchesMod,
  '../lib/batchCode': batchCodeMod,
  '../lib/stockReceiptGate': stockReceiptGateMod,
  '../lib/productIdentity': productIdentityMod,
  '../lib/movementCostSnapshot': movementCostSnapshotMod,
  '../lib/actorSnapshot': actorSnapshotMod,
  '../lib/stockMutationReceipt': stockMutationReceiptMod,
  '../lib/moneyPrecision': moneyMod,
  '../lib/stockCondition': stockConditionMod,
})

const batchesMod = loadReal('routes/batches.ts', {
  '../lib/receivingBranch': receivingBranchMod,
  '../lib/acquisitionCostAccess': acquisitionMod,
  '../lib/catalogCostRecompute': costMod,
  '../lib/schemaProbe': schemaMod,
  '../lib/stockSessionMath': stockMathMod,
  '../lib/db': dbOverride,
  '../lib/auth': authStub,
  '../lib/audit': auditStub,
  '../lib/permissions': permissionsMod,
  '../durable-objects/broadcastHub': broadcastStub,
  '../lib/cache': cacheStub,
  '../lib/telegram': { formatStockChangeTelegramLines: () => [], sendTelegramEvent: async () => {} },
  '../lib/productBatches': productBatchesMod,
  '../lib/batchCode': batchCodeMod,
  '../lib/stockReceiptGate': stockReceiptGateMod,
  '../lib/stockReason': stockReasonMod,
  '../lib/actorSnapshot': actorSnapshotMod,
  '../lib/stockMutationReceipt': stockMutationReceiptMod,
  '../lib/moneyPrecision': moneyMod,
})
const planTierMod = loadReal('lib/planTier.ts')
const stockInCommitMod = loadReal('routes/stockInCommit.ts', {
  '../lib/stockSessionMath': stockMathMod,
  '../lib/auth': authStub,
  '../lib/permissions': permissionsMod,
  '../lib/planTier': planTierMod,
  './inventory': inventoryMod,
  './batches': batchesMod,
})
const { runStockInCommit } = stockInCommitMod
// N13: POST /adjust requires a client_request_id; unless a case sets its own (to test a retry), give each call a fresh one.
const { runAdjustAction: runAdjustActionKernelEntry } = inventoryMod
let adjustProbeSeq = 0
const runAdjustAction = (c, body) => runAdjustActionKernelEntry(c, body && !body.client_request_id ? { client_request_id: 'fixture_probe_' + (++adjustProbeSeq) + '_abcdefgh', ...body } : body)
assert.equal(typeof runStockInCommit, 'function', 'routes/stockInCommit.ts exports runStockInCommit')
assert.equal(typeof runAdjustAction, 'function', 'routes/inventory.ts exports runAdjustAction (P4-B extraction)')
assert.equal(typeof batchesMod.runReceiveBatchAction, 'function', 'routes/batches.ts exports runReceiveBatchAction (P4-B extraction)')
function freshDb() {
  const rawDb = openDb(loadAll())
  rawDb.exec(`
    INSERT INTO branches(id, name, is_default, is_active) VALUES(1, 'Shop', 1, 1),(2, 'Warehouse', 0, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, stock_quantity, is_active)
      VALUES(1, 'Serum', 'SER-1', 2, 0, 0, 1);
    INSERT INTO products(id, name, barcode, cost_price_usd, cost_price_khr, stock_quantity, is_active)
      VALUES(2, 'Toner', 'TON-1', 3, 0, 0, 1);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(1, 1, 0);
    INSERT INTO branch_stock(product_id, branch_id, quantity) VALUES(2, 1, 0);
  `)
  return wrapFlat(rawDb)
}
const ADMIN_USER = { id: 1, username: 'admin', name: 'Admin', role_code: 'admin', permissions: '{}' }
const NO_PERM_USER = { id: 2, username: 'cashier', name: 'Cashier', permissions: JSON.stringify({ inventory: false }) }

function makeContext(db, user) {
  let currentUser = user
  currentDb = db
  return {
    env: { DB: {} },
    executionCtx: { waitUntil: (p) => { Promise.resolve(p).catch(() => {}) } },
    get(key) { return key === 'user' ? currentUser : undefined },
    set(key, value) { if (key === 'user') currentUser = value },
    json(obj, status = 200) {
      return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
    },
  }
}

function branchStock(db, productId) {
  const row = db.prepare('SELECT quantity FROM branch_stock WHERE product_id = @productId AND branch_id = 1').get({ productId })
  return row ? row.quantity : 0
}


const receiveBody = { product_id:1, branch_id:1, quantity:5, unit_cost_usd:2, supplier_name:'Acme', payment_status:'paid', received_date:'01/10/2026' }
const adjustBody = { productId:1, branchId:1, type:'add', quantity:5, unitCostUsd:2, supplierName:'Acme', paymentStatus:'paid', reason:'delivery', receivedDate:'01/10/2026' }
const tables = ['products','branch_stock','product_batches','branch_batch_stock','inventory_movements']
function snapshot(db) { return Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])) }
async function refusal(response) {
  const body = await response.json()
  assert.equal(response.status,409,JSON.stringify(body))
  assert.equal(body.code,'receiving_branch_inactive')
}
async function successful(response) {
  const body = await response.json()
  assert.equal(response.status,200,JSON.stringify(body))
  return body
}
function race(db) {
  const batch = db.batch.bind(db)
  let fired=false
  db.batch = async items => {
    if (!fired && items.some(x => /(?:INSERT INTO|UPDATE)\s+(?:product_batches|branch_batch_stock|branch_stock)/i.test(x.sql))) {
      fired=true
      db.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
    }
    return batch(items)
  }
  return () => assert.equal(fired,true,'actual write batch was raced')
}
async function run() {
  if (process.argv.includes('--wrong-preflight')) {
    const db=freshDb(), c=makeContext(db,ADMIN_USER)
    db.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
    const before=snapshot(db)
    await refusal(await runAdjustAction(c,{...adjustBody,unlockPricing:true,pricing:{barcode:'PREFLIGHT-NEGATIVE',cost_usd:3}}))
    assert.deepEqual(snapshot(db),before,'preflight must stop zero-stock sibling creation before the receiving batch')
    return
  }
  if (process.argv.includes('--wrong-guard')) {
    const db=freshDb(), c=makeContext(db,ADMIN_USER), assertRaced=race(db)
    const response=await batchesMod.runReceiveBatchAction(c,receiveBody)
    assertRaced()
    await refusal(response)
    return
  }
  for (const branchId of [1,99,-1,1.5]) {
    const db=freshDb()
    db.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
    const before=snapshot(db)
    await refusal(await batchesMod.runReceiveBatchAction(makeContext(db,ADMIN_USER),{...receiveBody,branch_id:branchId}))
    assert.deepEqual(snapshot(db),before)
  }
  console.log('PASS receive refuses inactive, missing and invalid explicit destinations without business writes')
  for (const body of [adjustBody,{...adjustBody,type:'set'}, {...adjustBody,unlockPricing:true,pricing:{barcode:'NEW-BARCODE',cost_usd:3,selling_price_usd:9}}, {...adjustBody,branchId:'1x'}]) {
    const db=freshDb()
    db.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
    const before=snapshot(db)
    await refusal(await runAdjustAction(makeContext(db,ADMIN_USER),{...body,ordinaryReceiving:false,historicalReceiptReplay:true}))
    assert.deepEqual(snapshot(db),before)
  }
  console.log('PASS adjust, positive legacy Set and new barcode preflight refuse; body flags cannot bypass')
  for (const wire of ['receive','adjust']) {
    const db=freshDb(), c=makeContext(db,ADMIN_USER)
    const body=wire==='receive'?{...receiveBody,client_request_id:'replay_receive_01'}:{...adjustBody,client_request_id:'replay_adjust_001'}
    const send = value => wire==='receive'?batchesMod.runReceiveBatchAction(c,value):runAdjustAction(c,value)
    const original=await successful(await send(body))
    db.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
    const before=snapshot(db)
    const replay=await successful(await send(body))
    assert.deepEqual(replay,{...original,replayed:true})
    const changed=await send({...body,quantity:6})
    assert.equal(changed.status,409)
    assert.equal((await changed.json()).code,'idempotency_conflict')
    assert.deepEqual(snapshot(db),before)
  }
  console.log('PASS real receipt wrapper replays original success after retirement and refuses changed payload')
  for (const variant of ['receive','adjust','set','selected-lot','matched-price']) {
    const db=freshDb(), c=makeContext(db,ADMIN_USER)
    let body={...adjustBody}
    if (variant==='set') body.type='set'
    if (variant==='selected-lot') {
      const seed=await successful(await batchesMod.runReceiveBatchAction(c,receiveBody))
      body={...adjustBody,batchId:seed.batchId,attribution:'correction'}
      delete body.unitCostUsd
    }
    if (variant==='matched-price') body={...adjustBody,unlockPricing:true,pricing:{barcode:'SER-1',selling_price_usd:19}}
    const before=snapshot(db), assertRaced=race(db)
    await refusal(await (variant==='receive'?batchesMod.runReceiveBatchAction(c,{...receiveBody,selling_price_usd:19}):runAdjustAction(c,body)))
    assertRaced()
    assert.deepEqual(snapshot(db),before,variant)
  }
  console.log('PASS real batch races roll back receive, Add, positive Set, selected-lot correction and matched pricing')
  {
    const db=freshDb(), c=makeContext(db,ADMIN_USER), assertRaced=race(db)
    await refusal(await runAdjustAction(c,{...adjustBody,unlockPricing:true,pricing:{barcode:'UNIQUE-NEW',cost_usd:3,selling_price_usd:9}}))
    assertRaced()
    const sibling=db.prepare("SELECT * FROM products WHERE barcode='UNIQUE-NEW'").get()
    assert.ok(sibling)
    assert.equal(sibling.stock_quantity,0)
    for (const table of ['product_batches','branch_batch_stock','inventory_movements']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0)
    assert.equal(db.prepare('SELECT SUM(quantity) AS n FROM branch_stock').get().n,0)
  }
  console.log('PASS late race retains precreated zero-stock sibling honestly; no lot, quantity or receipt movement applied')
  {
    const db=freshDb(), c=makeContext(db,ADMIN_USER)
    db.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
    const before=snapshot(db)
    const results=await runStockInCommit(c,[{key:'r',wire:'receive',body:receiveBody},{key:'a',wire:'adjust',body:{...adjustBody,client_request_id:'commit_line_a_00001'}}])
    assert.deepEqual(results.map(x=>[x.ok,x.code]),[[false,'receiving_branch_inactive'],[false,'receiving_branch_inactive']])
    assert.deepEqual(snapshot(db),before)
    db.raw.exec('UPDATE branches SET is_active=1 WHERE id=1')
    const good=await runStockInCommit(c,[{key:'r',wire:'receive',body:receiveBody},{key:'a',wire:'adjust',body:{...adjustBody,client_request_id:'commit_line_a_00001'}}])
    assert.ok(good.every(x=>x.ok),JSON.stringify(good))
    assert.equal(branchStock(db,1),10)
  }
  console.log('PASS actual aggregate delegates both kernels, retains codes, and ordinary active receipts still apply')
  {
    const db=freshDb(), c=makeContext(db,ADMIN_USER), before=snapshot(db), assertRaced=race(db)
    await assert.rejects(inventoryMod.applyStockDelta(c.env,1,1,2,true),receivingBranchMod.isReceivingBranchError)
    assertRaced()
    assert.deepEqual(snapshot(db),before)
  }
  console.log('PASS private aggregate fallback executes its real SQL guard and leaves both aggregates untouched')
  {
    const db=freshDb(), c=makeContext(db,ADMIN_USER)
    await successful(await batchesMod.runReceiveBatchAction(c,receiveBody))
    await successful(await runAdjustAction(c,{productId:1,branchId:1,type:'remove',quantity:2,reason:'count correction'}))
    const movement=db.prepare("SELECT * FROM inventory_movements WHERE movement_type='remove' ORDER BY id DESC LIMIT 1").get()
    assert.ok(movement)
    db.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
    const revert=loadReal('lib/stockRevert.ts',{'./productBatches':productBatchesMod,'./moneyPrecision':moneyMod,'./stockCondition':stockConditionMod})
    const result=await revert.applyMovementRevert(db,movement,{userId:1,userName:'Admin'})
    assert.equal(result.ok,true,JSON.stringify(result))
    assert.equal(branchStock(db,1),5)
    assert.equal(db.prepare('SELECT SUM(quantity) AS n FROM branch_batch_stock').get().n,5)
    const original=db.prepare("SELECT * FROM inventory_movements WHERE movement_type='add' ORDER BY id LIMIT 1").get()
    assert.equal((await revert.applyMovementRevert(db,original,{userId:1,userName:'Admin'})).ok,true)
    assert.equal(branchStock(db,1),0)
    const counter=db.prepare('SELECT * FROM inventory_movements WHERE reference_id=@ref').get({ref:`revert:${original.id}`})
    assert.equal((await revert.applyMovementRevert(db,counter,{userId:1,userName:'Admin'})).ok,true)
    assert.equal(branchStock(db,1),5)
    const lot=db.prepare('SELECT received_quantity,received_cost_usd,supplier_name FROM product_batches WHERE id=@id').get({id:original.batch_id})
    assert.equal(lot.received_quantity,5)
    assert.equal(lot.received_cost_usd,10)
    assert.equal(lot.supplier_name,'Acme')
  }
  console.log('PASS actual historical removal and receipt inverse chains restore retired-branch stock and money')
  {
    const db=freshDb(), before=snapshot(db)
    db.raw.exec('UPDATE branches SET is_active=0 WHERE id=1')
    await assert.rejects(db.batch([
      {sql:'UPDATE products SET cost_price_usd=19 WHERE id=1',params:{}},
      receivingBranchMod.receivingBranchAssertion(1),
    ]),receivingBranchMod.isReceivingBranchError)
    assert.deepEqual(snapshot(db),before)
  }
  console.log('PASS actual assertion abort rolls back earlier batch writes despite another active branch')
  {
    const db=freshDb(), c=makeContext(db,ADMIN_USER), before=snapshot(db), assertRaced=race(db)
    const body={...receiveBody,client_request_id:'raced_receipt_001'}
    const result=await runStockInCommit(c,[{wire:'receive',body}])
    assertRaced()
    assert.equal(result[0].ok,false)
    assert.equal(result[0].code,'receiving_branch_inactive')
    assert.deepEqual(snapshot(db),before)
    const stored=db.prepare('SELECT written,response_status FROM stock_mutation_receipts WHERE request_id=@id').get({id:body.client_request_id})
    assert.equal(stored.written,1)
    assert.equal(stored.response_status,409)
    const retried=await runStockInCommit(c,[{wire:'receive',body}])
    assert.equal(retried[0].code,'stock_request_partially_applied')
    assert.deepEqual(snapshot(db),before)
  }
  console.log('PASS aggregate race refuses; existing conservative receipt marker survives and retry reports partial, not success')
  assert.equal(receivingBranchMod.isReceivingBranchError(new Error('bad JSON path: unknown')),false)
  assert.equal(receivingBranchMod.isReceivingBranchError(new Error('transport lost')),false)
  console.log('PASS unrelated errors are not misclassified as inactive destinations')
}
run().catch(error => { console.error(error); process.exitCode=1 })