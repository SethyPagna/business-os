// CUTOVER-LR dated stock count (owner ruling 6 Oct 2026): a count addressed to the disabled "Old Shop" is never
// silently moved to its successor. The REAL lib/datedStockCountResolve.ts (POST /dated-stock-count/resolve),
// lib/datedStockCountRoute.ts (/preview and /apply build the plan) and lib/datedStockCountApply.ts (the one atomic
// write batch) run against an in-memory SQLite with every migration applied. The route handlers live in
// routes/inventory.ts; they pass X-Branch-Redirect as `redirectTarget` and answer the refusals with 409.
//
//   * before the cutover: resolve output, the plan and every write statement are byte-identical to eb5dd0ba3
//     (ORACLE: the dated-count files and the import authority loaded exactly as they were), rows identical;
//   * after the cutover with no target: resolve refuses branch_redirect_required, and a plan whose entry names the
//     disabled branch is the coded 409 -- nothing resolved, nothing planned, nothing written;
//   * an invalid target (the disabled branch itself, an unknown id): branch_redirect_target_invalid;
//   * a confirmed target: the count lands on LC Store, the movement records addressed_branch_name, Old Shop rows
//     stay 0 in both ledgers, and the batch re-proves the pair (a branch re-enabled between plan and write aborts);
//   * the oracle on the post-cutover world shows the defect: the old resolve mapped "shop" to LC Store unasked.
//
// Run (from cloudflare/): node scripts/test-cutover-lr-import-dated-count-pure.cjs

const assert = require('node:assert/strict')
function withoutProductAdmission(value) {
  const normalize = sql => sql.replace(/@[A-Za-z_]+|\?[0-9]*/g, '?').replace(/\s+/g, ' ').trim()
  const allowed = normalize(require('./harness/product_stock_guard.cjs').productStockGuardStatement([1], 'active').sql)
  const walk = entry => {
    if (Array.isArray(entry)) return entry.map(walk).filter(v => v !== undefined)
    let statement = entry
    if (typeof entry === 'string') { try { statement = JSON.parse(entry) } catch {} }
    if (statement && typeof statement.sql === 'string' && statement.sql.includes('$[product_has_stock]')) {
      const single = normalize("SELECT CASE WHEN EXISTS(SELECT 1 FROM products WHERE id=@productId AND is_active IS NOT 1) THEN json_extract('[]','$[product_has_stock]') ELSE 1 END")
      const batch = normalize("SELECT CASE WHEN EXISTS(SELECT 1 FROM product_batches pb JOIN products p ON p.id=pb.variant_product_id WHERE pb.id=@batchId AND p.is_active IS NOT 1) THEN json_extract('[]','$[product_has_stock]') ELSE 1 END")
      assert.ok([allowed, single, batch].includes(normalize(statement.sql)), 'only exact active-product admission guards may differ from historical SQL: '+statement.sql)
      const bound = Array.isArray(statement.params) ? statement.params[0] : statement.params.productIds
      const ids = bound === undefined ? [Number(statement.params.productId ?? statement.params.batchId)] : (typeof bound === 'number' ? [bound] : JSON.parse(bound))
      assert.ok(ids.length && ids.every(id => Number.isSafeInteger(id) && id > 0), 'guard names real product identities')
      return undefined
    }
    return entry
  }
  return walk(value)
}

const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const ORACLE = 'da2004932b4510df0effee0399bc002b14d97372'
const ORACLE_FILES = new Set([
  'lib/datedStockCountResolve.ts', 'lib/datedStockCountRoute.ts', 'lib/datedStockCountApply.ts', 'lib/datedStockCountImport.ts',
  'lib/importBranchAuthority.ts',
])
const REPO_ROOT = path.join(__dirname, '..', '..')

function makeWorld(oracleSha = null) {
  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(__dirname, '..', 'src', rel)
    const text = oracleSha && ORACLE_FILES.has(rel)
      ? execFileSync('git', ['show', `${oracleSha}:cloudflare/src/${rel}`], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      : fs.readFileSync(sourcePath, 'utf8')
    const output = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: sourcePath }).outputText
    const mod = { exports: {} }
    cache.set(rel, mod)
    const localRequire = (request) => {
      if (!request.startsWith('.')) return require(request)
      const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
      return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
    }
    new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
    return mod.exports
  }
  return {
    resolve: load('lib/datedStockCountResolve.ts'),
    route: load('lib/datedStockCountRoute.ts'),
    apply: load('lib/datedStockCountApply.ts'),
  }
}
const fresh = makeWorld()
const old = makeWorld(ORACLE)

let migrations = null
function world(state) {
  migrations ||= loadAll()
  const db = openDb(migrations)
  const raw = db.db
  raw.exec('DELETE FROM branches')
  if (state === 'before') {
    raw.exec("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Warehouse',1,1),(2,'Shop',0,1)")
  } else {
    raw.exec("INSERT INTO branches(id,name,is_default,is_active,role,canonical_key) VALUES(1,'LC Store',1,1,'shop','warehouse')")
    raw.exec("INSERT INTO branches(id,name,is_default,is_active,role,canonical_key,successor_branch_id) VALUES(2,'Old Shop',0,0,'shop','shop',1)")
  }
  raw.exec("INSERT INTO products(id,name,name_normalized,barcode,sku,unit,selling_price_usd,cost_price_usd,stock_quantity,is_active) VALUES(10,'Serum','serum','ABC','SER-1','pcs',12,4,8,1)")
  raw.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,received_quantity) VALUES(600,10,'lot-a','LOT-A','2026-08-01',1,1,4,5)")
  if (state === 'before') {
    raw.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,received_quantity) VALUES(500,10,'lot-b','LOT-B','2026-08-01',1,2,4,3)")
    raw.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,5),(10,2,3)')
    raw.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(600,1,5),(500,2,3)')
  } else {
    raw.exec('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,8),(10,2,0)')
    raw.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(600,1,8)')
  }
  const capture = []
  const batch = db.batch.bind(db)
  let beforeBatch = null
  db.batch = async (statements) => {
    capture.push(statements.map((statement) => JSON.stringify({ sql: statement.sql, params: statement.params })))
    if (beforeBatch) { const hook = beforeBatch; beforeBatch = null; hook(raw) }
    return batch(statements)
  }
  return { db, raw, capture, setBeforeBatch(hook) { beforeBatch = hook } }
}

const ACTOR = { userId: 71, userName: 'Owner' }
const plain = (list) => list.map((row) => ({ ...row }))
const rows = (raw) => ({
  branchStock: plain(raw.prepare('SELECT product_id, branch_id, quantity FROM branch_stock ORDER BY product_id, branch_id').all()),
  lots: plain(raw.prepare('SELECT batch_id, branch_id, quantity FROM branch_batch_stock ORDER BY batch_id, branch_id').all()),
  batches: plain(raw.prepare('SELECT id, variant_product_id, batch_key, is_active, received_quantity FROM product_batches ORDER BY id').all()),
  movements: plain(raw.prepare('SELECT product_id, branch_id, branch_name, addressed_branch_name, movement_type, quantity, reason, batch_id FROM inventory_movements ORDER BY id').all()),
  products: plain(raw.prepare('SELECT id, stock_quantity FROM products ORDER BY id').all()),
})
const sheet = [
  { rowNumber: 1, date: '2026-09-05', branchName: 'Shop', sku: 'SER-1', count: 4 },
  { rowNumber: 2, date: '2026-09-05', branchName: 'Warehouse', sku: 'SER-1', count: 3 },
]

let checks = 0
const check = async (name, fn) => { await fn(); checks++; console.log(`PASS ${name}`) }

async function main() {
  await check('before the cutover: resolve, plan and the apply batch are byte-identical to eb5dd0ba3, and the rows match', async () => {
    const results = []
    for (const subject of [fresh, old]) {
      const w = world('before')
      const resolved = await subject.resolve.resolveDatedStockCountRows(w.db, sheet, { redirectTarget: 1 })
      const entries = subject.route.parseDatedStockCountEntries({ entries: resolved.resolved.map((row) => ({ ...row, addressedBranchId: 2 })) })
      const built = await subject.route.buildDatedStockCountPlan(w.db, entries.entries, { redirectTarget: 1 })
      assert.ok(built.plan, JSON.stringify(built))
      await subject.apply.applyDatedStockCountPlan(w.db, built.plan, ACTOR)
      results.push({ resolved, entries, plan: built.plan, writes: w.capture, rows: rows(w.raw) })
    }
    const [now, then] = results
    assert.deepEqual(now.resolved, then.resolved, 'resolve: identical (the target, even when sent, is never read)')
    // The parser now reads an optional addressedBranchId (provenance from /resolve); with nothing disabled the plan
    // never uses it (the plan comparison below), and the rest of each entry is exactly what it was.
    assert.deepEqual(now.entries.entries.map(({ addressedBranchId, ...rest }) => rest), then.entries.entries, 'parsed entries')
    assert.deepEqual(now.plan, then.plan, 'plan: identical, no branchRedirects key')
    assert.deepEqual(withoutProductAdmission(now.writes), withoutProductAdmission(then.writes), 'every non-admission write statement byte-identical')
    assert.deepEqual(now.rows, then.rows)
    assert.equal(now.rows.movements.length, 2, 'control: the count really wrote (Shop 3->4, Warehouse 5->3)')
  })

  await check('after the cutover, no target: resolve refuses branch_redirect_required with the redirect detail; nothing is resolved', async () => {
    const w = world('after')
    const before = rows(w.raw)
    await assert.rejects(() => fresh.resolve.resolveDatedStockCountRows(w.db, sheet), (error) => {
      assert.equal(error.code, 'branch_redirect_required')
      assert.equal(error.statusCode, 409)
      assert.deepEqual(error.body.redirect, {
        addressed_branch_id: 2, addressed_branch_name: 'Old Shop', successor_branch_id: 1, successor_branch_name: 'LC Store',
        targets: [{ id: 1, name: 'LC Store' }], requested_target_id: null,
      })
      return true
    })
    assert.equal(w.capture.length, 0)
    assert.deepEqual(rows(w.raw), before)
  })

  await check('after the cutover, an entry naming the disabled branch: preview/apply plan is the coded 409; nothing is written', async () => {
    const w = world('after')
    const before = rows(w.raw)
    const entry = { date: '2026-09-05', productId: 10, branchId: 2, count: 4 }
    const refused = await fresh.route.buildDatedStockCountPlan(w.db, [entry])
    assert.deepEqual([refused.status, refused.code, refused.redirect?.addressed_branch_id, refused.redirect?.requested_target_id], [409, 'branch_redirect_required', 2, null])
    assert.equal(refused.error, 'This change is addressed to a disabled branch. Choose the active branch it should go to. Nothing was changed.')
    for (const target of [2, 99]) {
      const invalid = await fresh.route.buildDatedStockCountPlan(w.db, [entry], { redirectTarget: target })
      assert.deepEqual([invalid.status, invalid.code, invalid.redirect?.requested_target_id], [409, 'branch_redirect_target_invalid', target])
      await assert.rejects(() => fresh.resolve.resolveDatedStockCountRows(w.db, sheet, { redirectTarget: target }), (error) => error.code === 'branch_redirect_target_invalid')
    }
    assert.equal(w.capture.length, 0)
    assert.deepEqual(rows(w.raw), before)
  })

  await check('after the cutover, confirmed target: the counts land on LC Store (the movement addressed to Old Shop), Old Shop stays 0, both ledgers agree', async () => {
    const w = world('after')
    const resolved = await fresh.resolve.resolveDatedStockCountRows(w.db, sheet, { redirectTarget: 1 })
    assert.deepEqual(resolved.unresolved, [])
    assert.deepEqual(resolved.resolved.map((row) => [row.branchId, row.count, row.addressedBranchId, row.addressedBranchName, row.mergedRowNumbers]),
      [[1, 7, 2, 'Shop', [2]]], 'shop 4 + warehouse 3 = ONE count of 7 at LC Store, addressed to Shop')
    // The client sends the resolved rows back as entries; the addressed provenance rides along.
    const { entries } = fresh.route.parseDatedStockCountEntries({ entries: resolved.resolved })
    const built = await fresh.route.buildDatedStockCountPlan(w.db, entries)
    assert.ok(built.plan, JSON.stringify(built))
    assert.deepEqual(built.plan.branchRedirects, [{ addressed: 2, effect: 1, sells: 0 }])
    await fresh.apply.applyDatedStockCountPlan(w.db, built.plan, ACTOR)
    const after = rows(w.raw)
    assert.deepEqual(after.movements.map((m) => [m.branch_id, m.addressed_branch_name, m.movement_type, m.quantity]), [[1, 'Old Shop', 'remove', 1]], '8 on hand -> count 7: one remove at LC Store, addressed to Old Shop')
    assert.deepEqual(after.branchStock, [{ product_id: 10, branch_id: 1, quantity: 7 }, { product_id: 10, branch_id: 2, quantity: 0 }])
    assert.equal(after.lots.reduce((sum, lot) => sum + (lot.branch_id === 1 ? lot.quantity : 0), 0), 7, 'lot ledger = branch_stock at LC Store')
    assert.equal(after.lots.filter((lot) => lot.branch_id === 2).length, 0, 'no lot row at Old Shop')
    assert.ok(w.capture.flat().some((text) => /branch_redirect_guard/.test(text)), 'the write batch re-proves the pair')
  })

  await check('after the cutover, an entry naming Old Shop directly with a confirmed target plans and writes at LC Store', async () => {
    const w = world('after')
    const built = await fresh.route.buildDatedStockCountPlan(w.db, [{ date: '2026-09-05', productId: 10, branchId: 2, count: 10 }], { redirectTarget: 1 })
    assert.ok(built.plan, JSON.stringify(built))
    assert.deepEqual(built.plan.movementsToCreate.map((m) => [m.branchId, m.addressedBranchName, m.movementType, m.quantity]), [[1, 'Old Shop', 'add', 2]])
    await fresh.apply.applyDatedStockCountPlan(w.db, built.plan, ACTOR)
    const after = rows(w.raw)
    assert.equal(after.movements.filter((m) => m.branch_id === 2).length, 0)
    assert.deepEqual(after.branchStock.find((row) => row.branch_id === 1).quantity, 10)
  })

  await check('the in-batch guard: Old Shop re-enabled between plan and write rolls the whole batch back', async () => {
    const w = world('after')
    const built = await fresh.route.buildDatedStockCountPlan(w.db, [{ date: '2026-09-05', productId: 10, branchId: 2, count: 10 }], { redirectTarget: 1 })
    const before = rows(w.raw)
    w.setBeforeBatch((raw) => raw.exec('UPDATE branches SET is_active = 1, successor_branch_id = NULL WHERE id = 2'))
    await assert.rejects(() => fresh.apply.applyDatedStockCountPlan(w.db, built.plan, ACTOR))
    w.raw.exec('UPDATE branches SET is_active = 0, successor_branch_id = 1 WHERE id = 2')
    assert.deepEqual(rows(w.raw), before, 'nothing written')
  })

  await check('control -- the pre-change resolve maps "shop" to LC Store with no confirmation (the silent redirect this removes)', async () => {
    const w = world('after')
    const resolved = await old.resolve.resolveDatedStockCountRows(w.db, sheet)
    assert.deepEqual(resolved.resolved.map((row) => row.branchId), [1])
    const stale = await old.route.buildDatedStockCountPlan(w.db, [{ date: '2026-09-05', productId: 10, branchId: 2, count: 4 }])
    assert.deepEqual([stale.status, stale.code], [400, undefined], 'and an entry naming Old Shop was the uncoded 400')
  })

  console.log(`\n${checks} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
