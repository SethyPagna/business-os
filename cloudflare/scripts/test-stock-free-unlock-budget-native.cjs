// Full index, real cookie auth, actual D1 binding attempts and settled background
// work. Consume the existing native world without modifying its business loader.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const worldFile = path.join(__dirname, 'test-intake-full-request-budget.cjs')
const source = fs.readFileSync(worldFile, 'utf8').split(';(async () => {')[0]
const { world } = new Function('require', '__dirname', source + ';return {world};')(require, __dirname)

function legacy(body, variant) {
  // Exact sealed Astra F1 payload, including supplied actors that must be ignored.
  Object.assign(body, { batchId: 'new', freeQuantity: 2, conditionTag: 'broken', unlockPricing: true,
    pricing: { cost_usd: 2, selling_price_usd: 5, barcode: ['match','ui'].includes(variant) ? 'SER-1' : 'DIFFERENT-1' }, userId: 99, actorId: 99 })
}
function stockState(f) {
  return JSON.stringify(Object.fromEntries(['branch_stock', 'branch_batch_stock', 'product_batches', 'inventory_movements', 'damaged_stock_lots']
    .map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
}
function committedState(f) {
  return JSON.stringify(Object.fromEntries(['products', 'branch_stock', 'branch_batch_stock', 'product_batches', 'inventory_movements', 'damaged_stock_lots', 'stock_mutation_receipts', 'product_cost_entries']
    .map(table => [table, f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])))
}
async function invoke(f, tier, cold, trace, headers = {}) {
  const requestId = f.body.client_request_id
  const NativeRequest = globalThis.Request
  if (Object.keys(headers).length) globalThis.Request = class extends NativeRequest {
    constructor(...args) { super(...args); for (const [name,value] of Object.entries(headers)) this.headers.set(name,value) }
  }
  let answer
  try { answer = await f.call(cold) } finally { globalThis.Request = NativeRequest }
  assert.equal(f.body.client_request_id, requestId, 'transport preserves the exact original intent ID')
  assert.ok(answer.physical <= (tier === 'free' ? 50 : 1000), `all actual outer/auth/failed/retry/background attempts fit ${tier}: ${answer.physical}`)
  trace.push({ id: requestId, ...answer })
  console.log('MEASURED ' + JSON.stringify({ tier, ...trace.at(-1) }))
  return answer
}
async function receiptCase({ tier, variant, warm, tails, branch = 1, candidates = 0, untagged = false, healthy = false, omitBranch = false, redirect = false }) {
  const f = await world(tier, warm ? 'add' : 'add-tagged', false, { tailRetries: tails })
  const trace = []
  try {
    if (variant === 'existing') f.sql.exec("INSERT INTO products(id,name,barcode,stock_quantity,cost_price_usd,purchase_price_usd,selling_price_usd,is_active) VALUES(2,'Serum','DIFFERENT-1',0,2,2,3,1); INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0)")
    for (let i = 0; i < candidates; i++) {
      const created = f.sql.prepare('INSERT INTO products(name,barcode,stock_quantity,is_active) VALUES(?,?,0,1)').run('Serum', '12345678' + i)
      f.sql.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(?,1,0)').run(Number(created.lastInsertRowid))
    }
    if (redirect) f.sql.exec("INSERT INTO branches(id,name,is_active,successor_branch_id) VALUES(2,'Retired receiving',0,1)")
    else if (branch === 2) f.sql.exec("INSERT INTO branches(id,name,is_active,is_default) VALUES(2,'Selected warehouse',1,0)")
    if (warm) {
      let warmup = await invoke(f, tier, true, trace)
      if (warmup.status === 503) {
        assert.equal(warmup.body.code, 'stock_request_query_budget_exceeded')
        warmup = await invoke(f, tier, false, trace)
      }
      assert.equal(warmup.status, 200, 'ordinary same-ID warmup succeeds before the fresh legacy intent')
      f.body.client_request_id += '-fresh-warm'
    }
    if (variant === 'ui') {
      const ts = require('typescript'), cache = new Map()
      function frontend(relative) {
        relative = path.posix.normalize(relative)
        if (cache.has(relative)) return cache.get(relative).exports
        const mod = { exports:{} }; cache.set(relative,mod)
        const code = ts.transpileModule(fs.readFileSync(path.join(__dirname,'../../frontend/src/utils',relative),'utf8'), { compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 } }).outputText
        new Function('require','module','exports',code)(name => frontend(path.posix.join(path.posix.dirname(relative),name)),mod,mod.exports)
        return mod.exports
      }
      const line = { key:'ui-control',requestId:f.body.client_request_id,product:f.sql.prepare('SELECT id,name,selling_price_usd FROM products WHERE id=1').get(),mode:'add',quantity:3,freeQuantity:2,unitCost:'2',sellingPrice:'5',conditionTag:'broken',batchChoice:'new',expiryDate:'',reason:'Fixture UI control' }
      const built = frontend('stockSessionDraft.ts').buildStockLineRequest(line,{branchId:branch,receivedDate:'2026-10-08',supplier:{supplierId:null,supplierName:'Fixture Supplier'},paymentStatus:'paid',creditDueDate:'',sessionId:0,canEditPrice:true,reasonFor:()=>line.reason})
      assert.equal(built.body.unlockPricing, undefined, 'fresh current builder remains a distinct genuine control')
      for (const key of Object.keys(f.body)) delete f.body[key]
      Object.assign(f.body,built.body)
    } else legacy(f.body, variant)
    f.body.branchId = redirect ? 2 : branch
    if (omitBranch) delete f.body.branchId
    const headers = redirect ? { 'X-Branch-Redirect':'1' } : {}
    if (untagged) delete f.body.conditionTag
    const id = f.body.client_request_id, before = f.effects(), physicalBefore = stockState(f)
    let saved = await invoke(f, tier, !warm, trace, headers)
    const first = saved
    for (let retry = 0; saved.status === 503 && retry < 2; retry++) {
      assert.equal(saved.body.code, 'stock_request_query_budget_exceeded')
      assert.deepEqual(saved.effects, before, 'capacity refusal precedes physical stock/tag/history effects')
      assert.equal(stockState(f), physicalBefore, 'capacity refusal preserves complete physical ledger rows')
      assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM stock_mutation_receipts WHERE request_id=?').get(id).n, 0, 'unwritten refusal releases only its claim')
      saved = await invoke(f, tier, false, trace, headers)
    }
    if (healthy) assert.equal(first.status, 200, 'sealed healthy warm Free legacy sibling intent must complete, not permanently refuse')
    assert.equal(saved.status, 200, 'same original ID warm retry must complete')
    const target = saved.body.productId
    assert.equal(saved.body.branchId, branch)
    assert.equal(saved.body.freeQuantity, 2)
    assert.equal(saved.body.quantity, 5)
    assert.equal(target, ['match','ui'].includes(variant) ? 1 : 2, 'barcode identity resolves the intended row exactly')
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM products WHERE barcode='DIFFERENT-1'").get().n, ['match','ui'].includes(variant) ? 0 : 1, 'no duplicate sibling on retry')
    const p = f.sql.prepare('SELECT barcode,cost_price_usd,purchase_price_usd,selling_price_usd FROM products WHERE id=?').get(target)
    assert.equal(p.barcode, ['match','ui'].includes(variant) ? 'SER-1' : 'DIFFERENT-1')
    const catalogCost = ['match','ui'].includes(variant) ? 2 : 1.2
    assert.equal(p.cost_price_usd, catalogCost); assert.equal(p.purchase_price_usd, catalogCost); assert.equal(p.selling_price_usd, 5)
    const row = f.sql.prepare('SELECT * FROM stock_mutation_receipts WHERE request_id=?').get(id)
    assert.equal(row.actor_id, 7, 'real authenticated actor overrides userId/actorId99')
    assert.equal(row.written, 1); assert.equal(row.response_status, 200)
    assert.ok(row.completed_at)
    const ledger = f.sql.prepare('SELECT product_id,branch_id,movement_type,quantity,unit_cost_usd,total_cost_usd,user_id,batch_id,free_quantity FROM inventory_movements WHERE id>? ORDER BY id').all(
      JSON.parse(physicalBefore).inventory_movements.at(-1)?.id ?? 0)
    assert.equal(ledger.length, untagged ? 1 : 2)
    for (const movement of ledger) {
      assert.equal(movement.product_id, target); assert.equal(movement.branch_id, branch); assert.equal(movement.user_id, 7)
      assert.equal(movement.batch_id, saved.body.batchId); assert.equal(movement.quantity, 5)
      assert.equal(movement.unit_cost_usd, 1.2); assert.equal(movement.total_cost_usd, 6)
    }
    if (redirect) assert.deepEqual(f.sql.prepare('SELECT addressed_branch_name FROM inventory_movements WHERE id>? ORDER BY id').all(JSON.parse(physicalBefore).inventory_movements.at(-1)?.id ?? 0), ledger.map(() => ({ addressed_branch_name:'Retired receiving' })), 'canonical landing preserves addressed branch in every movement')
    if (!untagged) assert.equal(ledger[1].movement_type,'damage_out')
    assert.equal(ledger[0].movement_type, 'add'); assert.equal(ledger[0].free_quantity, 2)
    assert.equal(ledger[0].total_cost_usd, 6, 'three paid units at2 plus two free units retain six receipt dollars')
    assert.equal(f.sql.prepare('SELECT received_quantity,received_cost_usd,received_branch_id FROM product_batches WHERE id=?').get(saved.body.batchId).received_quantity, 5)
    assert.equal(f.sql.prepare('SELECT received_cost_usd FROM product_batches WHERE id=?').get(saved.body.batchId).received_cost_usd, 6)
    assert.equal(f.sql.prepare('SELECT received_branch_id FROM product_batches WHERE id=?').get(saved.body.batchId).received_branch_id, branch)
    assert.deepEqual(saved.effects, { stock: before.stock + (untagged ? 5 : 0), lots: before.lots + (untagged ? 5 : 0),
      received: before.received + 5, movement: before.movement + (untagged ? 1 : 2), held: before.held + (untagged ? 0 : 5), written: before.written + 1 })
    if (!untagged) {
      const held = f.sql.prepare('SELECT product_id,branch_id,batch_id,condition_tag,quantity_remaining,unit_cost_usd FROM damaged_stock_lots').all()
      assert.deepEqual(held, [{ product_id: target, branch_id: branch, batch_id: saved.body.batchId, condition_tag: 'broken', quantity_remaining: 5, unit_cost_usd:1.2 }])
    }
    const committed = committedState(f)
    const replay = await invoke(f, tier, false, trace, headers)
    assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true)
    assert.equal(replay.body.productId, target); assert.equal(replay.body.batchId, saved.body.batchId)
    assert.equal(committedState(f), committed, 'replay preserves IDs, receipt bytes, stock, cost and complete history')
    f.body.quantity = 4
    const changed = await invoke(f, tier, false, trace, headers)
    assert.equal(changed.status, 409); assert.equal(changed.body.code, 'idempotency_conflict')
    assert.equal(committedState(f), committed, 'changed payload cannot reuse completed identity')
    if (tails) assert.ok(trace.some(answer => answer.failures.length > 0), 'actual injected D1 failure attempts must be observed, not just scheduled')
    return trace
  } finally { f.sql.close() }
}
async function refusedBranch(tier, rawBranch, retired = false) {
  const f = await world(tier,'add',false), trace = []
  try {
    assert.equal((await invoke(f,tier,true,trace)).status,200)
    f.body.client_request_id += '-invalid-branch'
    legacy(f.body,'new'); f.body.branchId = rawBranch
    if (retired) f.sql.exec("INSERT INTO branches(id,name,is_active,successor_branch_id) VALUES(2,'Retired receiving',0,1)")
    const before = committedState(f)
    const answer = await invoke(f,tier,false,trace)
    assert.equal(answer.status,409)
    assert.equal(answer.body.code, retired ? 'branch_redirect_required' : 'receiving_branch_inactive')
    assert.equal(committedState(f),before,'invalid explicit branch refuses catalogue, physical ledger and receipt writes')
  } finally { f.sql.close() }
}
async function deniedIdentity(tier, mode) {
  const f = await world(tier,'add',false), trace = []
  try {
    assert.equal((await invoke(f,tier,true,trace)).status,200)
    f.body.client_request_id += '-denied'
    legacy(f.body,'new')
    const before = committedState(f)
    if (mode === 'missing-id') delete f.body.client_request_id
    const answer = await invoke(f,tier,false,trace,mode === 'unauthenticated' ? { cookie:'' } : {})
    assert.equal(answer.status,mode === 'missing-id' ? 400 : 401)
    if (mode === 'missing-id') assert.equal(answer.body.code,'client_request_id_required')
    assert.equal(committedState(f),before,'identity/auth refusal cannot create catalogue, physical stock or receipt effects')
  } finally { f.sql.close() }
}
async function main() {
  const cases = [{ tier: 'free', variant: 'new', warm: true, tails: false, healthy: true }]
  if (!process.argv.includes('--f1-only')) {
    for (const tier of ['free','paid']) for (const variant of ['new','existing','match']) {
      cases.push({ tier, variant, warm: false, tails: true }, { tier, variant, warm: true, tails: false })
    }
    cases.push({ tier:'free', variant:'existing', warm:true, tails:true, candidates:40 },
      { tier:'free', variant:'new', warm:false, tails:true, branch:2 },
      { tier:'paid', variant:'existing', warm:false, tails:true, branch:2 },
      { tier:'free', variant:'new', warm:false, tails:true, untagged:true },
      { tier:'free',variant:'ui',warm:false,tails:true }, { tier:'paid',variant:'ui',warm:false,tails:true },
      { tier:'free',variant:'new',warm:false,tails:true,omitBranch:true },
      { tier:'paid',variant:'match',warm:false,tails:true,redirect:true })
  }
  let failures = 0
  for (const options of cases) {
    try { await receiptCase(options); console.log('PASS '+JSON.stringify(options)) }
    catch (error) { failures++; console.error('FAIL '+JSON.stringify(options), error) }
  }
  let branchCases = 0
  if (!process.argv.includes('--f1-only')) for (const tier of ['free','paid']) for (const rawBranch of [0,'','not-a-number',1.5,999,2]) {
    branchCases++
    try { await refusedBranch(tier,rawBranch,rawBranch===2); console.log('PASS '+JSON.stringify({tier,refusedBranch:rawBranch})) }
    catch (error) { failures++; console.error('FAIL '+JSON.stringify({tier,refusedBranch:rawBranch}),error) }
  }
  let identityCases = 0
  if (!process.argv.includes('--f1-only')) for (const tier of ['free','paid']) for (const mode of ['missing-id','unauthenticated']) {
    identityCases++
    try { await deniedIdentity(tier,mode); console.log('PASS '+JSON.stringify({tier,mode})) }
    catch (error) { failures++; console.error('FAIL '+JSON.stringify({tier,mode}),error) }
  }
  console.log(`${cases.length+branchCases+identityCases-failures}/${cases.length+branchCases+identityCases} full-index legacy unlock budget cases passed`)
  if (failures) process.exitCode = 1
}
main().catch(error => { console.error(error); process.exitCode = 1 })
