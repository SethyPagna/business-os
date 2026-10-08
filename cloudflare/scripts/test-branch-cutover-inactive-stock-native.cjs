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
harness._compile(source.slice(0, boundary).replace('openDb(loadAll())', "openDb(require('./harness/historical_product_stock.cjs').historicalMigrations())").replace('const overrides = {', "const overrides = { './db': { getDb: env => env.DB },") + '\nmodule.exports={fixture,request,postSale,app,executionCtx,load,USER,setUser(value){currentUser=value}};', file)
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
  const fold = (f) => async (dup, keeper, approved) => {
    require('./harness/historical_product_stock.cjs').installCurrentStockGuards(f.raw)
    await products.foldDuplicateProductInto({ DB: f.route }, f.route, actor, { id: keeper.id, name: keeper.name }, { id: dup.id, name: dup.name, image_path: dup.image_path },
      new Map([[1, 'Shop']]), 'branch cutover: inactive product holding stock', 'merge', undefined, { operationId: crypto.randomUUID() }, approved ? { follows: true } : undefined)
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

  // The production pair (rehearsal, 7 Oct 2026): the exact-identity rule cannot match them (a hyphen), the owner approved the fold.
  const realPair = () => {
    const { f, one } = world()
    f.raw.exec(`INSERT INTO products(id,name,sku,barcode,stock_quantity,selling_price_usd,cost_price_usd,is_active) VALUES
        (7091,'Colourpop Shadow Stix-Angel Vibes','CP-OLD',NULL,2,6,3,0),(1529,'Colourpop Shadow Stix Angel Vibes','CP-NEW','0',0,6,3,1);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(7091,1,2);
      INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,unit_cost_usd,received_branch_id,received_quantity,is_active,batch_number)
        VALUES(58916,7091,'cp-lot','CPL','2026-09-02',3,1,2,1,58916);
      INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(58916,1,2)`)
    f.raw.prepare('DELETE FROM branch_stock WHERE product_id=30').run([]); f.raw.prepare('DELETE FROM branch_batch_stock WHERE batch_id=900').run([])
    f.raw.prepare('UPDATE products SET stock_quantity=0 WHERE id=30').run([])
    return { f, one }
  }
  await check('7091 -> 1529 without the approval is refused (exact identity does not match); the auto rules are not loosened', async () => {
    const { f } = realPair()
    const plan = await inactive.readInactiveStockPlan(f.route)
    assert.deepEqual(plan.refuse.map(r => [r.id, r.reason]), [[7091, 'no_active_twin']])
    assert.deepEqual(plan.fold, [])
  })
  await check('7091 -> 1529 with the owner approval is folded through the same merge, with its audit row; 7091 stays inactive with 0 everywhere', async () => {
    const { f, one } = realPair()
    const approved = inactive.parseApprovedFolds([{ dup: 7091, keeper: 1529 }])
    const plan = await inactive.readInactiveStockPlan(f.route, approved)
    assert.deepEqual(plan.refuse, [])
    assert.deepEqual(plan.fold.map(i => [i.dup.id, i.keeper.id, i.approved]), [[7091, 1529, true]])
    await inactive.applyInactiveStockPlan(f.route, plan, { operationId: 'op-approved', actorId: 7, actorName: 'operator' }, fold(f))
    assert.equal(one('SELECT is_active a FROM products WHERE id=7091').a, 0)
    assert.equal(one('SELECT COALESCE(SUM(quantity),0) q FROM branch_stock WHERE product_id=7091').q, 0)
    assert.equal(one('SELECT quantity q FROM branch_stock WHERE product_id=1529 AND branch_id=1').q, 2)
    assert.equal(one('SELECT variant_product_id v FROM product_batches WHERE id=58916').v, 1529)
    assert.equal(one('SELECT stock_quantity q FROM products WHERE id=1529').q, 2)
    const audit = one("SELECT details FROM audit_logs WHERE action='branch_cutover_approved_fold'")
    assert.deepEqual([JSON.parse(audit.details).note, JSON.parse(audit.details).dup, JSON.parse(audit.details).keeper, JSON.parse(audit.details).operationId], ['owner-approved fold 7 Oct 2026', 7091, 1529, 'op-approved'])
  })
  await check('an approval is validated, never trusted: a different real barcode, a different name, an inactive or group keeper, a dup with no stock, and a conflicting exact twin are all refused', async () => {
    const { f } = realPair()
    f.raw.exec(`INSERT INTO products(id,name,sku,barcode,stock_quantity,cost_price_usd,is_active,is_group) VALUES
      (7100,'Real Barcode Lip','RB-OLD','8801234567890',1,1,0,0),(7101,'Real Barcode Lip','RB-DIFF','8809999999999',0,1,1,0),(7102,'Real-Barcode Lip','RB-SAME','8801234567890',0,1,1,0),
      (7103,'Other Name','ON','8801234567890',0,1,1,0),(7104,'Real Barcode Lip','RB-INACTIVE','8801234567890',0,1,0,0),(7105,'Real Barcode Lip','RB-GROUP','8801234567890',0,1,1,1),
      (7106,'Exact Twin','ET-OLD','5551234567',1,1,0,0),(7107,'Exact Twin','ET-NEW','5551234567',0,1,1,0),(7108,'Exact-Twin','ET-OTHER','5551234567',0,1,1,0);
      INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(7100,1,1),(7106,1,1)`)
    const reasons = async (pairs) => (await inactive.readInactiveStockPlan(f.route, inactive.parseApprovedFolds(pairs))).refuse.filter(r => ![7106, 30, 7091].includes(r.id)).map(r => [r.id, r.reason])
    assert.deepEqual(await reasons([{ dup: 7100, keeper: 7101 }]), [[7100, 'approved_barcode_differs']])
    assert.deepEqual(await reasons([{ dup: 7100, keeper: 7103 }]), [[7100, 'approved_name_differs']])
    assert.deepEqual(await reasons([{ dup: 7100, keeper: 7104 }]), [[7100, 'approved_keeper_not_active']])
    assert.deepEqual(await reasons([{ dup: 7100, keeper: 7105 }]), [[7100, 'approved_keeper_is_group']])
    assert.deepEqual(await reasons([{ dup: 7100, keeper: 999999 }]), [[7100, 'approved_keeper_missing']])
    assert.deepEqual(await reasons([{ dup: 7100, keeper: 7102 }]), [], 'the same barcode and the same words fold (punctuation only differs)')
    assert.deepEqual((await reasons([{ dup: 5, keeper: 7102 }])).filter(r => r[0] === 5), [[5, 'approved_dup_not_inactive_with_stock']], 'a dup that is not an inactive stocked product')
    const conflict = (await inactive.readInactiveStockPlan(f.route, [{ dup: 7106, keeper: 7108 }])).refuse.find(r => r.id === 7106)
    assert.equal(conflict && conflict.reason, 'approved_keeper_conflicts_with_exact_twin', 'an approval cannot redirect a product that has an exact twin')
    const same = await inactive.readInactiveStockPlan(f.route, [{ dup: 7106, keeper: 7107 }])
    assert.deepEqual(same.fold.filter(i => i.dup.id === 7106).map(i => [i.keeper.id, i.approved]), [[7107, undefined]], 'approving the exact twin changes nothing: it stays an automatic fold')
    for (const bad of [[{ dup: 1, keeper: 1 }], [{ dup: 'a', keeper: 2 }], [{ dup: 1, keeper: 2 }, { dup: 1, keeper: 3 }], 'x', Array.from({ length: 51 }, (_, i) => ({ dup: i + 1, keeper: i + 100 }))]) {
      assert.throws(() => inactive.parseApprovedFolds(bad), error => error.capability === 'approved_folds_invalid')
    }
    assert.deepEqual(inactive.parseApprovedFolds(undefined), [])
  })

  // ---- F1: an approved pair is idempotent across a crash (REAL fold) -------------------------------------------------------------------------
  await check('F1 crash after the fold commits but before the capture page is saved: the resume treats the approved pair as done instead of refusing', async () => {
    const { f, one } = realPair()
    const approved = inactive.parseApprovedFolds([{ dup: 7091, keeper: 1529 }])
    const plan = await inactive.readInactiveStockPlan(f.route, approved, 'op-crash')
    let folds = 0
    // the process dies right after the merge committed: the capture save never happens
    await assert.rejects(inactive.applyInactiveStockPlan(f.route, plan, { operationId: 'op-crash', actorId: 7, actorName: 'operator' },
      async (dup, keeper, isApproved) => { await fold(f)(dup, keeper, isApproved); folds++; throw new Error('isolate died after the fold') }), /isolate died/)
    assert.equal(folds, 1)
    assert.equal(one('SELECT quantity q FROM branch_stock WHERE product_id=1529 AND branch_id=1').q, 2, 'the merge really committed')
    // the old behaviour (no run id): refused with approved_dup_not_inactive_with_stock -- the defect
    assert.deepEqual((await inactive.readInactiveStockPlan(f.route, approved)).refuse.map(r => r.reason), ['approved_dup_not_inactive_with_stock'])
    // the resume: this run's audit row says it is done
    const resumed = await inactive.readInactiveStockPlan(f.route, approved, 'op-crash')
    assert.deepEqual([resumed.refuse, resumed.fold], [[], []])
    assert.equal(one("SELECT count(*) n FROM audit_logs WHERE action='branch_cutover_approved_fold'").n, 1)
    // another run's approval is NOT satisfied by this run's record
    assert.deepEqual((await inactive.readInactiveStockPlan(f.route, approved, 'op-other')).refuse.map(r => r.reason), ['approved_dup_not_inactive_with_stock'])
  })
  await check('F1 crash after the audit row but before the merge: the resume folds once, the audit row is not duplicated', async () => {
    const { f, one } = realPair()
    const approved = inactive.parseApprovedFolds([{ dup: 7091, keeper: 1529 }])
    for (let attempt = 0; attempt < 2; attempt++) {
      const plan = await inactive.readInactiveStockPlan(f.route, approved, 'op-early')
      assert.equal(plan.fold.length, 1)
      if (attempt === 0) await assert.rejects(inactive.applyInactiveStockPlan(f.route, plan, { operationId: 'op-early', actorId: 7, actorName: 'operator' }, async () => { throw new Error('died before the merge') }), /died before/)
      else await inactive.applyInactiveStockPlan(f.route, plan, { operationId: 'op-early', actorId: 7, actorName: 'operator' }, fold(f))
    }
    assert.equal(one("SELECT count(*) n FROM audit_logs WHERE action='branch_cutover_approved_fold'").n, 1)
    assert.equal(one('SELECT quantity q FROM branch_stock WHERE product_id=1529 AND branch_id=1').q, 2)
  })
  await check('F1 the exact-twin control resumes too (its dup simply has no stock any more)', async () => {
    const { f } = world()
    const plan = await inactive.readInactiveStockPlan(f.route, [], 'op-exact')
    await inactive.applyInactiveStockPlan(f.route, plan, { operationId: 'op-exact', actorId: 7, actorName: 'operator' }, fold(f))
    const resumed = await inactive.readInactiveStockPlan(f.route, [], 'op-exact')
    assert.deepEqual([resumed.refuse.length, resumed.fold.length], [0, 0])
  })

  // ---- F2: the post-check excuses exactly the lots this run's folds re-pointed (REAL fold) -------------------------------------------------------
  const postChecks = fs.readFileSync(path.join(__dirname, '..', '..', 'ops', 'queries', 'branch-cutover-post-checks.sql'), 'utf8')
  const batchesChangedOff = (f) => {
    const row = f.raw.prepare(postChecks).get([])
    return row ? row.batches_changed_off : null
  }
  await check('F2 batches_changed_off: the lot a real exact fold and a real approved fold re-pointed is excused; an unrelated changed lot and a fold without its run record are not', async () => {
    for (const mode of ['approved', 'exact']) {
      const { f } = mode === 'approved' ? realPair() : world()
      f.raw.exec("UPDATE product_batches SET updated_at='2020-01-01 00:00:00'")
      f.raw.exec("INSERT INTO branches(id,name,is_active) SELECT 1,'W',1 WHERE NOT EXISTS(SELECT 1 FROM branches WHERE id=1)")
      f.raw.exec("INSERT INTO users(id,username,password,name,organization_id,permissions,is_active) SELECT 7,'operator','x','Op',1,'{}',1 WHERE NOT EXISTS(SELECT 1 FROM users WHERE id=7)")
      f.raw.prepare(`INSERT INTO branch_cutovers(operation_id,begin_request_id,actor_id,organization_id,control_incarnation,maintenance_token,source_branch_id,target_branch_id,intent_json,intent_digest,
        source_preimage_json,target_preimage_json,maintenance_flag_json,capture_digest,snapshot_digest,verification_digest,created_at,updated_at)
        VALUES('00000000-0000-4000-8000-0000000000aa','req-post-1',7,'1','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',2,1,'{}',?,'{"id":2,"name":"Shop"}','{"id":1,"name":"LC"}','{}',?,?,?,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`)
        .run(['a'.repeat(64), 'b'.repeat(64), 'b'.repeat(64), 'b'.repeat(64)])
      const approved = mode === 'approved' ? inactive.parseApprovedFolds([{ dup: 7091, keeper: 1529 }]) : []
      const plan = await inactive.readInactiveStockPlan(f.route, approved, '00000000-0000-4000-8000-0000000000aa')
      await inactive.applyInactiveStockPlan(f.route, plan, { operationId: '00000000-0000-4000-8000-0000000000aa', actorId: 7, actorName: 'operator' }, fold(f))
      const moved = mode === 'approved' ? 58916 : 900
      assert.ok(f.raw.prepare('SELECT updated_at u FROM product_batches WHERE id=?').get([moved]).u > '2026-01-01', mode + ': the real fold touched the lot')
      assert.equal(batchesChangedOff(f), 0, mode + ': excused through the run record')
      const audits = f.raw.prepare("SELECT id,details FROM audit_logs WHERE action IN ('branch_cutover_inactive_fold','branch_cutover_approved_fold')").all([])
      assert.equal(audits.length, 1); assert.deepEqual(JSON.parse(audits[0].details).batchIds, [moved])
      // control: the same fold with no run record is what the check must still catch
      f.raw.prepare('DELETE FROM audit_logs WHERE id=?').run([audits[0].id])
      assert.equal(batchesChangedOff(f), 1, mode + ': without the record the re-pointed lot reads 1')
      f.raw.prepare("INSERT INTO audit_logs(action,entity,entity_id,details) VALUES('branch_cutover_inactive_fold','product',1,?)").run([JSON.stringify({ operationId: 'op-someone-else', batchIds: [moved] })])
      assert.equal(batchesChangedOff(f), 1, mode + ': a record of another run excuses nothing')
      f.raw.prepare("INSERT INTO audit_logs(action,entity,entity_id,details) VALUES('branch_cutover_inactive_fold','product',1,?)").run([JSON.stringify({ operationId: '00000000-0000-4000-8000-0000000000aa', batchIds: [moved] })])
      assert.equal(batchesChangedOff(f), 0)
      // tamper: an unrelated lot changed since begin is still caught
      const other = f.raw.prepare('SELECT id FROM product_batches WHERE id<>? ORDER BY id LIMIT 1').get([moved]).id
      f.raw.prepare("UPDATE product_batches SET updated_at=datetime('now') WHERE id=?").run([other])
      assert.equal(batchesChangedOff(f), 1, mode + ': an unrelated changed lot still reads 1')
    }
  })

  // ---- F5: groups --------------------------------------------------------------------------------------------------------------------------
  await check('F5 an inactive group product holding stock is listed and refused (the guard counts it, so the census must too)', async () => {
    const { f } = world()
    f.raw.exec("INSERT INTO products(id,name,sku,stock_quantity,cost_price_usd,is_active,is_group) VALUES(50,'A group','GRP',5,1,0,1)")
    const plan = await inactive.readInactiveStockPlan(f.route)
    assert.deepEqual(plan.refuse.filter(r => r.id === 50).map(r => r.reason), ['inactive_group_product_holds_stock'])
    assert.equal(f.raw.prepare(`SELECT ${inactive.INACTIVE_STOCKED_ANYWHERE_SQL} AS g`).get().g, 1, 'the guard sees the same product')
  })

  console.log(`${checks} branch cutover inactive-stock native checks passed`)
})().catch(error => { console.error(error); process.exitCode = 1 })
