const assert = require('node:assert/strict')
const f = require('./test-stock-bridge-core-native.cjs')
const { sql, raw, db, load } = f
const env = { DB: raw, PLAN_TIER: 'paid' }
const stock = load('lib/stockActionCommit.ts')
const fold = load('lib/createFold.ts')
const products = load('lib/productWrites.ts')
const imports = load('lib/importEngine.ts')
let checks = 0
async function check(name, run) { await run(); assert.equal(f.permits(), 0); checks++; console.log(`PASS ${name}`) }
async function main() {
  await check('import identity creates nullable cost and branch stock in one admitted batch', async () => {
    const input = { jobId: 'fixture-job', identityKey: 'fixture-key', productName: 'Fixture new' }
    const before = f.counts().calls
    const result = await stock.ensureUnifiedStockProduct(db, input)
    assert.equal(f.counts().calls - before, 1)
    assert.equal(result.created, true)
    assert.equal(sql.prepare('SELECT cost_price_usd FROM products WHERE id=?').get(result.productId).cost_price_usd, null)
    assert.equal(sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=?').get(result.productId).quantity, 0)
    const repeat = await stock.ensureUnifiedStockProduct(db, input)
    assert.equal(repeat.productId, result.productId)
    assert.equal(repeat.created, false)
  })
  await check('import stock groups count both admission statements without splitting a group', async () => {
    const group = [{ sql: 'UPDATE branch_stock SET quantity=quantity WHERE product_id=@id', params: { id: 1001 } }]
    const before = f.counts()
    await imports.runD1BatchGroupsInChunks(db, [group, group], 3, true)
    const after = f.counts()
    assert.equal(after.calls - before.calls, 2)
    assert.equal(after.attempts - before.attempts, 6)
    await assert.rejects(imports.runD1BatchGroupsInChunks(db, [[...group, ...group]], 3, true), /statement_budget_exceeded/)
  })
  await check('create retains completed stock receipt and final product result', async () => {
    const body = { name: 'Fixture create', branch_id: 1, stock_quantity: 2, client_request_id: 'fixture-created-stock' }
    const created = await products.createProductWithInitialStock(env,
      body, {}, undefined, undefined, null,
      { actorId: 7, fingerprint: fold.startingStockFingerprint(body, { branchId: 1, quantity: 2 }) })
    assert.ok(created.id)
    assert.equal(created.item.stock_quantity, 2)
    assert.equal(sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=?').get(created.id).quantity, 2)
    const receipt = sql.prepare("SELECT * FROM stock_mutation_receipts WHERE request_id='fixture-created-stock'").get()
    assert.equal(receipt.written, 1)
    assert.equal(receipt.response_status, 200)
    assert.ok(receipt.completed_at)
    assert.equal(JSON.parse(receipt.response_json).id, created.id)
  })
  await check('approval-only fold admits stock and decision atomically and refuses repeated approval', async () => {
    sql.exec("INSERT INTO pending_actions(id,section,action_type,entity_type,payload_json,summary,status) VALUES(7001,'products','create','product','{}','Fixture','open')")
    const row = sql.prepare('SELECT * FROM pending_actions WHERE id=7001').get()
    const duplicate = sql.prepare('SELECT * FROM products WHERE id=1001').get()
    const options = { approval: { row, reviewer: { reviewedBy: null, reviewedByName: 'Fixture' } }, source: 'review_create_identity_fold', actor: { id: null, name: 'Fixture' } }
    const body = { received_date: '2026-10-15', cost_price_usd: 2 }
    const before = sql.prepare('SELECT stock_quantity FROM products WHERE id=1001').get().stock_quantity
    await fold.foldCreateWithStockInWrite(env, duplicate, duplicate.name, body, { branchId: 1, quantity: 1, landing: null }, options)
    assert.equal(sql.prepare('SELECT status FROM pending_actions WHERE id=7001').get().status, 'approved')
    assert.equal(sql.prepare('SELECT stock_quantity FROM products WHERE id=1001').get().stock_quantity, before + 1)
    const saved = f.state()
    await assert.rejects(fold.foldCreateWithStockInWrite(env, duplicate, duplicate.name, body, { branchId: 1, quantity: 1, landing: null }, options), e => e.code === 'product_create_review_conflict')
    assert.equal(f.state(), saved)
  })
  await check('wrong epoch refuses import identity before product or stock appears', async () => {
    sql.exec("UPDATE system_flags SET value='future' WHERE key='stock_schema_epoch'")
    const before = f.state()
    await assert.rejects(stock.ensureUnifiedStockProduct(db, { jobId: 'blocked', identityKey: 'blocked', productName: 'Blocked' }), e => e.code === 'stock_schema_unavailable')
    assert.equal(f.state(), before)
  })
  console.log(`PASS ${checks} current writer groups on native SQLite`)
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => sql.close())
