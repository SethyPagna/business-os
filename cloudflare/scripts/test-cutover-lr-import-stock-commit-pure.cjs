// CUTOVER-LR stock-action import writers (lib/stockActionCommit.ts), against an in-memory SQLite with every
// migration applied:
//   * the loophole: applyUnifiedStockAdd had NO in-batch check that its landing branch is active, so a branch
//     disabled between the import's classification and the write (or any caller handing it a disabled id) received
//     stock nobody can sell. Now the batch refuses, nothing is written, and the row says the coded English. The
//     ORACLE (eb5dd0ba3) shows the old writer accepting it;
//   * before the cutover the add batch is the old batch plus exactly that one guard statement, and the sale batch
//     is byte-identical (no redirect, no label);
//   * a column redirected from Old Shop onto LC Store (addressedBranchId): the movement records
//     addressed_branch_name, and Old Shop re-enabled before the write aborts the whole batch (add and sale).
//
// Run (from cloudflare/): node scripts/test-cutover-lr-import-stock-commit-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { execFileSync } = require('node:child_process')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const ORACLE = 'da2004932b4510df0effee0399bc002b14d97372'
const REPO_ROOT = path.join(__dirname, '..', '..')

function loadCommit(oracleSha = null) {
  const cache = new Map()
  function load(rel) {
    if (cache.has(rel)) return cache.get(rel).exports
    const sourcePath = path.join(__dirname, '..', 'src', rel)
    const text = oracleSha && rel === 'lib/stockActionCommit.ts'
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
  return load('lib/stockActionCommit.ts')
}
const fresh = loadCommit()
const old = loadCommit(ORACLE)

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
  raw.exec("INSERT INTO products(id,name,name_normalized,barcode,unit,selling_price_usd,cost_price_usd,stock_quantity,is_active) VALUES(10,'Serum','serum','ABC','pcs',12,4,8,1)")
  raw.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,supplier_name,received_quantity) VALUES(600,10,'lot-a','LOT-A','2026-08-01',1,1,4,'Acme',8)")
  if (state === 'before') {
    raw.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,lot_code,received_at,is_active,batch_number,unit_cost_usd,supplier_name,received_quantity) VALUES(500,10,'lot-b','LOT-B','2026-08-01',1,2,4,'Acme',3)")
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

const plain = (list) => list.map((row) => ({ ...row }))
const ledger = (raw) => ({
  stock: plain(raw.prepare('SELECT product_id, branch_id, quantity FROM branch_stock ORDER BY product_id, branch_id').all()),
  lots: plain(raw.prepare('SELECT batch_id, branch_id, quantity FROM branch_batch_stock ORDER BY batch_id, branch_id').all()),
  movements: plain(raw.prepare('SELECT branch_id, branch_name, addressed_branch_name, movement_type, quantity FROM inventory_movements ORDER BY id').all()),
  commits: raw.prepare('SELECT COUNT(*) n FROM import_stock_action_commits').get().n,
  sales: raw.prepare('SELECT COUNT(*) n FROM sales').get().n,
})
const add = (overrides = {}) => ({
  jobId: 'job-1', rowNumber: 2, productId: 10, productName: 'Serum', branchId: 1, branchName: 'LC Store', quantity: 3,
  date: '2026-09-02', sellingPriceUsd: 12, costPriceUsd: 4, sheetCostPriceUsd: 4, supplierName: 'Acme', ...overrides,
})
const sale = (lineOverrides = {}) => ({
  jobId: 'job-1', saleGroupKey: '2026-09-03|sale', date: '2026-09-03', recordedAt: '2026-10-07T00:00:00.000Z',
  actor: { id: 71, username: 'owner', name: 'Owner' },
  lines: [{ rowNumber: 3, productId: 10, productName: 'Serum', branchId: 1, branchName: 'LC Store', quantity: 2, sellingPriceUsd: 12, costPriceUsd: 4, ...lineOverrides }],
})
const REQUIRED = 'This change is addressed to a disabled branch. Choose the active branch it should go to. Nothing was changed.'
const INVALID = 'The branch chosen for the redirect is not active or cannot take this change. Choose another branch. Nothing was changed.'

let checks = 0
const check = async (name, fn) => { await fn(); checks++; console.log(`PASS ${name}`) }

async function main() {
  await check('the loophole: an add to a disabled branch is refused in-batch, nothing written (the pre-change writer accepted it)', async () => {
    const w = world('after')
    const before = ledger(w.raw)
    await assert.rejects(() => fresh.applyUnifiedStockAdd(w.db, add({ branchId: 2, branchName: 'Old Shop' })), (error) => error.message === REQUIRED)
    assert.deepEqual(ledger(w.raw), before, 'no journal row, no lot, no stock, no movement')
    const control = world('after')
    await old.applyUnifiedStockAdd(control.db, add({ branchId: 2, branchName: 'Old Shop' }))
    assert.equal(control.raw.prepare('SELECT quantity FROM branch_stock WHERE product_id = 10 AND branch_id = 2').get().quantity, 3, 'control: the old writer put 3 units on the disabled Old Shop')
  })

  await check('the loophole, raced: the landing branch disabled between the pre-read and the batch rolls the whole add back', async () => {
    const w = world('before')
    const before = ledger(w.raw)
    w.setBeforeBatch((raw) => raw.exec('UPDATE branches SET is_active = 0 WHERE id = 2'))
    await assert.rejects(() => fresh.applyUnifiedStockAdd(w.db, add({ branchId: 2, branchName: 'Shop' })), (error) => error.message === REQUIRED)
    assert.deepEqual(ledger(w.raw), before)
  })

  await check('before the cutover: the add batch is the old batch plus exactly the landing guard; the sale batch is byte-identical', async () => {
    const results = []
    for (const subject of [fresh, old]) {
      const w = world('before')
      await subject.applyUnifiedStockAdd(w.db, add({ branchId: 2, branchName: 'Shop', addressedBranchName: null }))
      await subject.applyUnifiedStockSale(w.db, sale({ branchId: 2, branchName: 'Shop' }))
      results.push({ capture: w.capture, ledger: ledger(w.raw) })
    }
    const [now, then] = results
    assert.deepEqual(now.ledger, then.ledger, 'identical rows')
    const [addNow, saleNow] = now.capture
    const [addThen, saleThen] = then.capture
    const guards = addNow.filter((text) => /landing_branch_guard/.test(text))
    assert.equal(guards.length, 1)
    assert.deepEqual(addNow.filter((text) => !/landing_branch_guard/.test(text)), addThen, 'add: otherwise byte-identical')
    assert.deepEqual(saleNow, saleThen, 'sale: byte-identical')
  })

  await check('a column redirected from Old Shop onto LC Store: the add movement is labelled; Old Shop re-enabled before the write aborts it', async () => {
    const w = world('after')
    await fresh.applyUnifiedStockAdd(w.db, add({ addressedBranchName: 'Shop', addressedBranchId: 2 }))
    const after = ledger(w.raw)
    assert.deepEqual(after.movements, [{ branch_id: 1, branch_name: 'LC Store', addressed_branch_name: 'Shop', movement_type: 'add', quantity: 3 }])
    assert.deepEqual(after.stock, [{ product_id: 10, branch_id: 1, quantity: 11 }, { product_id: 10, branch_id: 2, quantity: 0 }])
    assert.equal(after.lots.filter((lot) => lot.branch_id === 2).length, 0)
    const raced = world('after')
    const before = ledger(raced.raw)
    raced.setBeforeBatch((raw) => raw.exec('UPDATE branches SET is_active = 1, successor_branch_id = NULL WHERE id = 2'))
    await assert.rejects(() => fresh.applyUnifiedStockAdd(raced.db, add({ addressedBranchName: 'Shop', addressedBranchId: 2 })), (error) => error.message === INVALID)
    raced.raw.exec('UPDATE branches SET is_active = 0, successor_branch_id = 1 WHERE id = 2')
    assert.deepEqual(ledger(raced.raw), before)
  })

  await check('a sale line redirected from Old Shop: the movement is labelled; Old Shop re-enabled before the write aborts the receipt', async () => {
    const w = world('after')
    await fresh.applyUnifiedStockSale(w.db, sale({ addressedBranchName: 'Shop', addressedBranchId: 2 }))
    const after = ledger(w.raw)
    assert.deepEqual(after.movements, [{ branch_id: 1, branch_name: 'LC Store', addressed_branch_name: 'Shop', movement_type: 'sale', quantity: -2 }])
    assert.equal(after.sales, 1)
    assert.equal(w.raw.prepare('SELECT COUNT(*) n FROM import_stock_action_guards').get().n, 0, 'the redirect guard row is cleared with the others')
    const raced = world('after')
    const before = ledger(raced.raw)
    raced.setBeforeBatch((raw) => raw.exec('UPDATE branches SET is_active = 1, successor_branch_id = NULL WHERE id = 2'))
    await assert.rejects(() => fresh.applyUnifiedStockSale(raced.db, sale({ addressedBranchName: 'Shop', addressedBranchId: 2 })))
    raced.raw.exec('UPDATE branches SET is_active = 0, successor_branch_id = 1 WHERE id = 2')
    assert.deepEqual(ledger(raced.raw), before, 'no sale, no stock change')
  })

  console.log(`\n${checks} checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
