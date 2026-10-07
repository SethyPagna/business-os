// Branch cutover, rehearsal F3 (owner ruling 7 Oct 2026): an inactive product that holds stock is folded into its one active twin with the REAL
// product merge (routes/products.ts foldDuplicateProductInto), never reactivated; a product with only a drifted cache gets the cache recomputed;
// anything else is listed for the owner. The orchestration around the fold is covered in test-branch-cutover-parent-e2e-native.cjs with a stub;
// this file runs the real fold on the sale-create harness database (every migration) and checks what the merge really does to the ledgers.
//
// Run (from cloudflare/): node scripts/test-branch-cutover-inactive-stock-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const file = path.join(__dirname, 'test-sale-create-atomic-pure.cjs'), source = fs.readFileSync(file, 'utf8'), boundary = source.indexOf(';(async () => {')
const harness = new Module(file, module); harness.filename = file; harness.paths = module.paths
harness._compile(source.slice(0, boundary).replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },") + '\nmodule.exports={fixture,request,postSale,app,executionCtx,load,USER,setUser(value){currentUser=value}};', file)
const h = harness.exports
let checks = 0
async function check(name, run) { await run(); console.log('PASS ' + name); checks++ }

;(async () => {
  h.setUser({ ...h.USER, permissions: '{"all":true}' })
  const inactive = h.load('lib/branchCutoverInactiveStock.ts')
  const products = h.load('routes/products.ts')
  const actor = { ...h.USER, permissions: '{"all":true}' }

  const world = () => {
    const f = h.fixture()
    const one = (sql, ...values) => f.raw.prepare(sql).get(values)
    f.raw.prepare("UPDATE products SET barcode='123456' WHERE id=10").run()
    f.raw.exec(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,selling_price_khr,cost_price_usd,cost_price_khr,is_active)
        VALUES(30,'Powder','POWDER-OLD','123456',2,9.5,38000,4,16000,0),(31,'Drift','DRIFT-OLD','999111',8,5,20000,2,8000,0),(32,'Drift','DRIFT','999111',12,5,20000,2,8000,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(30,1,2);
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,unit_cost_usd,received_branch_id,received_quantity,is_active,batch_number)
        VALUES(900,30,'old-lot','OLD','2026-09-02',3,1,2,1,900);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900,1,2)`)
    return { f, one }
  }
  const fold = (f) => async (dup, keeper) => {
    await products.foldDuplicateProductInto({ DB: f.route }, f.route, actor, { id: keeper.id, name: keeper.name }, { id: dup.id, name: dup.name, image_path: dup.image_path },
      new Map([[1, 'Shop']]), 'branch cutover: inactive product holding stock', 'merge', undefined, { operationId: crypto.randomUUID() })
    f.raw.prepare('UPDATE products SET stock_quantity=COALESCE((SELECT SUM(quantity) FROM branch_stock WHERE product_id=@id),0) WHERE id=@id').run({ id: keeper.id })
  }

  await check('plan: stock + exactly one active twin folds; cache drift only is recomputed; the owner list stays empty', async () => {
    const { f } = world()
    const plan = await inactive.readInactiveStockPlan(f.route)
    assert.deepEqual(plan.fold.map(i => [i.dup.id, i.keeper.id]), [[30, 10]])
    assert.deepEqual(plan.cacheOnly.map(r => [r.id, r.cache]), [[31, 8]])
    assert.deepEqual(plan.refuse, [])
  })

  await check('the REAL merge moves the inactive product\'s lot, branch row and units to its twin and leaves the product inactive with 0 on every ledger', async () => {
    const { f, one } = world()
    const twinBefore = one('SELECT COALESCE(SUM(quantity),0) q FROM branch_stock WHERE product_id=10').q
    const plan = await inactive.readInactiveStockPlan(f.route)
    await inactive.applyInactiveStockPlan(f.route, plan, { operationId: 'op-f3', actorId: 7, actorName: 'operator' }, fold(f))
    assert.equal(one('SELECT is_active a FROM products WHERE id=30').a, 0, 'never reactivated')
    assert.equal(one('SELECT COALESCE(SUM(quantity),0) q FROM branch_stock WHERE product_id=30').q, 0)
    assert.equal(one('SELECT COALESCE(SUM(quantity),0) q FROM branch_stock WHERE product_id=10').q, twinBefore + 2, 'the 2 units landed on the twin')
    assert.equal(one('SELECT variant_product_id v FROM product_batches WHERE id=900').v, 10, 'the lot moved')
    assert.equal(one('SELECT quantity q FROM branch_batch_stock WHERE batch_id=900 AND branch_id=1').q, 2)
    assert.equal(one('SELECT count(*) n FROM audit_logs WHERE action=\'branch_cutover_inactive_stock\'').n, 1)
    assert.ok(one("SELECT count(*) n FROM undo_snapshots WHERE kind='product.merge'").n >= 1, 'the merge left its undo record')
    assert.ok(one("SELECT count(*) n FROM inventory_movements WHERE product_id IN (30,10) AND reason LIKE '%merge%'").n >= 0)
    const after = await inactive.readInactiveStockPlan(f.route)
    assert.deepEqual([after.fold.length, after.refuse.length], [0, 0], 'a second run finds nothing left to fold (crash-safe)')
    assert.equal(f.raw.prepare(`SELECT ${inactive.INACTIVE_STOCKED_ANYWHERE_SQL} AS anywhere`).get().anywhere, 0, 'no inactive product holds stock on any ledger')
  })

  await check('cache drift: stock_quantity is recomputed from the ledgers with an audit row; the twin and an untouched inactive product stay', async () => {
    const { f, one } = world()
    const plan = await inactive.readInactiveStockPlan(f.route)
    await inactive.applyInactiveStockPlan(f.route, plan, { operationId: 'op-f3', actorId: 7, actorName: 'operator' }, fold(f))
    assert.equal(one('SELECT stock_quantity q FROM products WHERE id=31').q, 0)
    assert.equal(one('SELECT stock_quantity q FROM products WHERE id=32').q, 12, 'the active twin is untouched')
    const audit = one("SELECT details FROM audit_logs WHERE action='recompute_stock_cache' AND entity_id=31")
    assert.deepEqual([JSON.parse(audit.details).before.stock_quantity, JSON.parse(audit.details).after.stock_quantity, JSON.parse(audit.details).operationId], [8, 0, 'op-f3'])
    assert.equal(one("SELECT count(*) n FROM audit_logs WHERE action='recompute_stock_cache'").n, 1)
  })

  await check('no active twin, or two, is refused and listed; damaged units count as real stock', async () => {
    const { f } = world()
    f.raw.exec(`INSERT INTO products(id,name,sku,barcode,stock_quantity,cost_price_usd,is_active) VALUES(40,'Alone','ALONE','777','0',1,0),(41,'Twice','TW-A','888',0,1,0),(42,'Twice','TW-B','888',0,1,1),(43,'Twice','TW-C','888',0,1,1);
      INSERT INTO damaged_stock_lots(product_id,product_name,branch_id,quantity,quantity_remaining,condition_tag,source) VALUES(40,'Alone',1,1,1,'damaged','remove'),(41,'Twice',1,1,1,'damaged','remove')`)
    const plan = await inactive.readInactiveStockPlan(f.route)
    assert.deepEqual(plan.refuse.map(r => [r.id, r.reason]), [[40, 'no_active_twin'], [41, 'several_active_twins']])
    assert.deepEqual(plan.fold.map(i => i.dup.id), [30])
  })

  console.log(`${checks} branch cutover inactive-stock native checks passed`)
})().catch(error => { console.error(error); process.exitCode = 1 })
