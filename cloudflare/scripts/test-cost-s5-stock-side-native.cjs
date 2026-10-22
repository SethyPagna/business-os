// Release 3, slice S5 (owner, 14 Oct 2026): the stock side stops pricing an unknown cost from the catalog.
//   "if cost is 0$ then it is 0 for loss. if it is none, it should also be unknown. flag it."
// A recorded $0 stays 0; a missing cost is NULL (unknown) and is never today's catalog price, another lot's cost,
// or a blend. This file drives the real kernels against the real migration chain:
//   - lib/stockRevert.ts      revert of a declared free-goods receipt keeps the lot's recorded $0
//   - lib/damagedLotActions   dispose / restore of a held lot with no cost is unknown, KHR never invented
//   - lib/stockActionCommit   imported product create, receipt movement columns, lot received-money running sum
//   - source shape            no catalog fallback is passed to the movement-cost resolver any more
// The /adjust, /move-row and valuation cases are in test-adjust-received-date-pure.cjs; the transfer cases are in
// test-transfer-cost-snapshot-native.cjs; the resolver itself is in test-movement-cost-snapshot-pure.cjs.
//
// Run (from cloudflare/): node scripts/test-cost-s5-stock-side-native.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { withProductStockGuard } = require('./harness/product_stock_guard.cjs')

const cloudflareRoot = path.join(__dirname, '..')
const read = (relative) => fs.readFileSync(path.join(cloudflareRoot, 'src', relative), 'utf8').replace(/\r\n/g, '\n')
let checks = 0
async function check(name, fn) {
  await fn()
  checks += 1
  console.log(`PASS ${name}`)
}

function compileTs(file, stubs = {}) {
  const sourcePath = path.join(cloudflareRoot, 'src', 'lib', file)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.')) {
      const dependency = path.resolve(path.dirname(sourcePath), request.endsWith('.ts') ? request : `${request}.ts`)
      return compileTs(path.relative(path.join(cloudflareRoot, 'src', 'lib'), dependency), stubs)
    }
    return require(request)
  }
  new Function('exports', 'require', 'module', output)(moduleObj.exports, withProductStockGuard(localRequire), moduleObj)
  return moduleObj.exports
}

// ---- the real revert kernel + its import graph, compiled once ---------------------------------------------------
const tscVersion = execSync('npx tsc --version', { cwd: cloudflareRoot, encoding: 'utf8' }).trim()
const ignoreConfigFlag = /^Version\s+(?:[6-9]|\d{2,})\./.test(tscVersion) ? ' --ignoreConfig' : ''
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-s5-'))
try {
  execSync(
    `npx tsc "${path.join(cloudflareRoot, 'src', 'lib', 'stockRevert.ts')}" --outDir "${tmpDir}" --rootDir "${path.join(cloudflareRoot, 'src', 'lib')}" ` +
      `--module commonjs --target es2022 --moduleResolution node --esModuleInterop --skipLibCheck --noEmitOnError false${ignoreConfigFlag}`,
    { cwd: cloudflareRoot, stdio: 'pipe' },
  )
} catch (err) {
  if (!fs.existsSync(path.join(tmpDir, 'stockRevert.js'))) throw err
}
const revert = require(path.join(tmpDir, 'stockRevert.js'))
const FREE_GOODS_NOTE = 'Free goods (no cost)'
const actor = { userId: 7, userName: 'tester' }
const redirectNone = () => null

function beginStockSeed(db) {
  db.exec('BEGIN IMMEDIATE')
  db.exec("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'")
}

function finishStockSeed(db) {
  db.exec("DELETE FROM system_flags WHERE key='stock_transaction_permit'")
  db.exec('COMMIT')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM system_flags WHERE key='stock_transaction_permit'").get({}).n, 0)
  assert.throws(() => db.prepare('UPDATE products SET stock_quantity=stock_quantity+1 WHERE id=1').run({}), /stock_transaction_required/)
}

function revertFixture() {
  const db = openDb(loadAll())
  beginStockSeed(db)
  db.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Main Store', 1)`).run({})
  db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active) VALUES (1, 'Sample Balm', 'SB-1', 'pcs', 5, 1)`).run({})
  db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 5)`).run({})
  return db
}
const lotCosts = (db, id) => ({ ...db.prepare('SELECT unit_cost_usd, received_cost_usd, received_quantity, is_active FROM product_batches WHERE id = @id').get({ id }) })
async function revertTwice(db, movementId) {
  finishStockSeed(db)
  const first = await revert.applyMovementRevert(db, await db.prepare('SELECT * FROM inventory_movements WHERE id = @id').get({ id: movementId }), actor, redirectNone)
  assert.equal(first.ok, true, first.error)
  const counter = await db.prepare('SELECT * FROM inventory_movements WHERE reference_id = @ref').get({ ref: `revert:${movementId}` })
  const second = await revert.applyMovementRevert(db, counter, actor, redirectNone)
  assert.equal(second.ok, true, second.error)
  return { first, second, counter }
}

async function main() {
  await check('revert of a declared free-goods receipt, then its own revert, leaves the lot at a recorded $0 (not NULL/unknown)', async () => {
    const db = revertFixture()
    db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, supplier_name,
        unit_cost_usd, payment_status, received_quantity, received_branch_id, received_cost_usd)
      VALUES (801, 1, '10012026', '10012026', '2026-10-01', 1, 1, 'Acme Supply', 0, 'paid', 5, 1, 0)`).run({})
    db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (801, 1, 5)`).run({})
    db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity,
        unit_cost_usd, total_cost_usd, reason, user_name, created_at, batch_id)
      VALUES (9001, 1, 'Sample Balm', 1, 'Main Store', 'add', 5, 0, 0, 'Sample box. ${FREE_GOODS_NOTE}', 'tester', '2026-10-01 09:00:00', 801)`).run({})
    const { counter, second } = await revertTwice(db, 9001)
    assert.equal(second.revertType, 'add')
    assert.deepEqual(lotCosts(db, 801), { unit_cost_usd: 0, received_cost_usd: 0, received_quantity: 5, is_active: 1 },
      'the receipt was free: re-receiving it records $0 on the lot, not an unknown cost')
    const reReceipt = await db.prepare('SELECT unit_cost_usd, total_cost_usd FROM inventory_movements WHERE reference_id = @ref').get({ ref: `revert:${counter.id}` })
    assert.deepEqual({ ...reReceipt }, { unit_cost_usd: 0, total_cost_usd: 0 }, 'the counter-movement copies the recorded $0 verbatim')
  })

  await check('control: a 0/0 row that never declared free goods (a dated count) does NOT turn the lot into a recorded $0', async () => {
    const db = revertFixture()
    db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number,
        unit_cost_usd, received_quantity, received_branch_id, received_cost_usd)
      VALUES (802, 1, '10022026', '10022026', '2026-10-02', 1, 1, NULL, 5, 1, NULL)`).run({})
    db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (802, 1, 5)`).run({})
    db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity,
        unit_cost_usd, total_cost_usd, reason, user_name, created_at, batch_id)
      VALUES (9002, 1, 'Sample Balm', 1, 'Main Store', 'add', 5, 0, 0, 'Dated stock count', 'tester', '2026-10-02 09:00:00', 802)`).run({})
    await revertTwice(db, 9002)
    assert.equal(lotCosts(db, 802).unit_cost_usd, null, 'an unproven 0/0 row never recorded a cost')
    assert.equal(lotCosts(db, 802).received_cost_usd, null)
  })

  await check('control: a priced receipt keeps its price through revert and its own revert', async () => {
    const db = revertFixture()
    db.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number,
        unit_cost_usd, received_quantity, received_branch_id, received_cost_usd)
      VALUES (803, 1, '10032026', '10032026', '2026-10-03', 1, 1, 4, 5, 1, 20)`).run({})
    db.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (803, 1, 5)`).run({})
    db.prepare(`INSERT INTO inventory_movements (id, product_id, product_name, branch_id, branch_name, movement_type, quantity,
        unit_cost_usd, total_cost_usd, reason, user_name, created_at, batch_id)
      VALUES (9003, 1, 'Sample Balm', 1, 'Main Store', 'add', 5, 4, 20, 'Stock in', 'tester', '2026-10-03 09:00:00', 803)`).run({})
    await revertTwice(db, 9003)
    assert.deepEqual(lotCosts(db, 803), { unit_cost_usd: 4, received_cost_usd: 20, received_quantity: 5, is_active: 1 })
  })

  // ---- held-lot plans (lib/damagedLotActions.ts) ------------------------------------------------------------
  const damaged = compileTs('damagedLotActions.ts', {
    './productBatches': { incrementBatchStockStatement: () => ({ sql: 'SELECT 1', params: {} }) },
    './returnsStock': { createDamagedLotStatement: () => ({ sql: 'SELECT 1', params: {} }) },
    './movementCostSnapshot': compileTs('movementCostSnapshot.ts', { './moneyPrecision': compileTs('moneyPrecision.ts') }),
    './sqlBinding': compileTs('sqlBinding.ts'),
    './stockCondition': compileTs('stockCondition.ts'),
    './productStockGuard': { productStockGuardStatement: () => ({ sql: 'SELECT 1', params: {} }) },
  })
  const movementParams = (plan) => plan[plan.length - 1].params
  const change = (takes) => ({ productId: 1, productName: 'Balm', branchId: 1, branchName: 'Main', tag: 'damaged', takes, reason: 'binned', actor: { userId: 1, userName: 'u' },
    // What the route used to read from the catalog and hand over. It must not price anything now.
    fallbackUnitCostUsd: 9, fallbackUnitCostKhr: 36000 })

  await check('dispose of a held lot with no cost is an UNKNOWN write_off even when a catalog price is on hand; a recorded cost and a recorded $0 are kept', async () => {
    const unknown = movementParams(damaged.planDisposeTagged(change([{ lotId: 1, batchId: 5, quantity: 3, unitCostUsd: null }])))
    assert.deepEqual([unknown.unitCostUsd, unknown.unitCostKhr, unknown.totalCostUsd, unknown.totalCostKhr], [null, null, null, null])
    const known = movementParams(damaged.planDisposeTagged(change([{ lotId: 1, batchId: 5, quantity: 3, unitCostUsd: 4 }])))
    assert.deepEqual([known.unitCostUsd, known.unitCostKhr, known.totalCostUsd, known.totalCostKhr], [4, null, 12, null])
    const zero = movementParams(damaged.planDisposeTagged(change([{ lotId: 1, batchId: 5, quantity: 3, unitCostUsd: 0 }])))
    assert.deepEqual([zero.unitCostUsd, zero.unitCostKhr, zero.totalCostUsd, zero.totalCostKhr], [0, null, 0, null], 'a recorded $0 is data, not absence')
  })

  await check('dispose spanning held lots {4, none} is one UNKNOWN movement, not a blend with the catalog price', async () => {
    const mixed = movementParams(damaged.planDisposeTagged(change([
      { lotId: 1, batchId: 5, quantity: 2, unitCostUsd: 4 }, { lotId: 2, batchId: 6, quantity: 1, unitCostUsd: null },
    ])))
    assert.deepEqual([mixed.unitCostUsd, mixed.totalCostUsd], [null, null])
    const restore = movementParams(damaged.planRestoreTagged(change([{ lotId: 2, batchId: 6, quantity: 1, unitCostUsd: null }])))
    assert.deepEqual([restore.unitCostUsd, restore.totalCostUsd], [null, null], 'restore of an unknown-cost held lot is unknown too')
  })

  // ---- stockActionCommit: imported product create, receipt movement columns, lot received-money running sum ------
  const moneyPrecision = compileTs('moneyPrecision.ts')
  const sqlBinding = compileTs('sqlBinding.ts')
  const batchCode = compileTs('batchCode.ts')
  const branchRoles = compileTs('branchRoles.ts')
  const subject = (db) => compileTs('stockActionCommit.ts', {
    './productBatches': compileTs('productBatches.ts', { './receivingBranch': compileTs('receivingBranch.ts'), './batchCode': batchCode, './moneyPrecision': moneyPrecision, './sqlBinding': sqlBinding }),
    './moneyPrecision': moneyPrecision,
    './db': {},
    './batchCode': batchCode,
    './searchMatch': compileTs('searchMatch.ts'),
    './stockReceiptGate': compileTs('stockReceiptGate.ts'),
    './branchRoleGuards': compileTs('branchRoleGuards.ts', { './branchRoles': branchRoles }),
    './branchEffect': compileTs('branchEffect.ts', { './branchRoles': branchRoles, './sqlBinding': sqlBinding, './db': {} }),
    './saleCreationSnapshot': compileTs('saleCreationSnapshot.ts', {
      './actorSnapshot': compileTs('actorSnapshot.ts'),
      './saleMoneyPrecision': compileTs('saleMoneyPrecision.ts', { './moneyPrecision': moneyPrecision }),
    }),
    './catalogCostRecompute': { recomputeCatalogCost: async () => null, catalogCostRecomputeStatement: () => ({ sql: 'SELECT 1 WHERE 1=1', params: {} }), costMirrorSql: (cost) => `COALESCE(${cost}, 0)` },
  })

  await check('imported product create with no cost is NULL (cost_price_usd and _khr), a typed $0 stays 0', async () => {
    const db = openDb(loadAll())
    const commit = subject(db)
    const blank = await commit.ensureUnifiedStockProduct(db, { jobId: 'job-s5', identityKey: 'blank', productName: 'Blank cost' })
    const zero = await commit.ensureUnifiedStockProduct(db, { jobId: 'job-s5', identityKey: 'zero', productName: 'Typed zero', costPriceUsd: 0 })
    const priced = await commit.ensureUnifiedStockProduct(db, { jobId: 'job-s5', identityKey: 'priced', productName: 'Priced', costPriceUsd: 3.5 })
    const read = (id) => ({ ...db.prepare('SELECT cost_price_usd, cost_price_khr FROM products WHERE id = @id').get({ id }) })
    assert.deepEqual(read(blank.productId), { cost_price_usd: null, cost_price_khr: null })
    assert.deepEqual(read(zero.productId), { cost_price_usd: 0, cost_price_khr: null })
    assert.deepEqual(read(priced.productId), { cost_price_usd: 3.5, cost_price_khr: null })
  })

  async function importAdd(db, commit, productId, extra) {
    finishStockSeed(db)
    return commit.applyUnifiedStockAdd(db, {
      jobId: 'job-s5-add', rowNumber: 2 + Math.floor(Math.random() * 1e6), productId, productName: 'Balm', branchId: 1, branchName: 'Main Store',
      quantity: 3, date: '10/05/2026', supplierName: 'Acme Supply', sellingPriceUsd: 9, costPriceUsd: 4, sheetCostPriceUsd: 4, ...extra,
    })
  }
  const addFixture = () => {
    const db = openDb(loadAll())
    beginStockSeed(db)
    db.prepare(`INSERT INTO branches (id, name, is_active) VALUES (1, 'Main Store', 1)`).run({})
    db.prepare(`INSERT INTO products (id, name, barcode, unit, stock_quantity, is_active, cost_price_usd) VALUES (1, 'Balm', 'B-1', 'pcs', 0, 1, 9)`).run({})
    db.prepare(`INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (1, 1, 0)`).run({})
    return db
  }

  await check('imported receipt writes all four movement cost columns: USD as entered, KHR NULL (never the DEFAULT 0)', async () => {
    const db = addFixture()
    await importAdd(db, subject(db), 1, {})
    const movement = db.prepare("SELECT unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr FROM inventory_movements WHERE movement_type = 'add'").get({})
    assert.deepEqual({ ...movement }, { unit_cost_usd: 4, unit_cost_khr: null, total_cost_usd: 12, total_cost_khr: null })
    const free = addFixture()
    await importAdd(free, subject(free), 1, { costPriceUsd: 0, sheetCostPriceUsd: 0, freeGoods: true })
    const freeMovement = free.prepare("SELECT unit_cost_usd, unit_cost_khr, total_cost_usd, total_cost_khr FROM inventory_movements WHERE movement_type = 'add'").get({})
    assert.deepEqual({ ...freeMovement }, { unit_cost_usd: 0, unit_cost_khr: null, total_cost_usd: 0, total_cost_khr: null }, 'declared free goods: a recorded $0')
    assert.deepEqual({ ...free.prepare('SELECT unit_cost_usd, received_cost_usd FROM product_batches').get({}) }, { unit_cost_usd: 0, received_cost_usd: 0 })
  })

  await check('lot received money: a priced top-up on a lot whose earlier receipt had no recorded money stays UNKNOWN (NULL); known + known sums; a brand-new lot starts known', async () => {
    // A lot with units received but no money recorded (an earlier unknown receipt): adding a priced receipt must not
    // make its spend "known" by counting only the new part.
    const unknownFirst = addFixture()
    unknownFirst.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, supplier_name,
        unit_cost_usd, received_quantity, received_branch_id, received_cost_usd)
      VALUES (701, 1, 'lot-701', 'lot-701', '2026-10-05', 1, 1, 'Acme Supply', 4, 5, 1, NULL)`).run({})
    unknownFirst.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (701, 1, 5)').run({})
    await importAdd(unknownFirst, subject(unknownFirst), 1, { batchLabel: 'lot-701' })
    const afterUnknown = unknownFirst.prepare('SELECT received_quantity, received_cost_usd FROM product_batches WHERE id = 701').get({})
    assert.deepEqual({ ...afterUnknown }, { received_quantity: 8, received_cost_usd: null }, 'unknown first receipt + 3 x $4: spend stays unknown, not $12')

    const knownFirst = addFixture()
    knownFirst.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number, supplier_name,
        unit_cost_usd, received_quantity, received_branch_id, received_cost_usd)
      VALUES (702, 1, 'lot-702', 'lot-702', '2026-10-05', 1, 1, 'Acme Supply', 4, 5, 1, 20)`).run({})
    knownFirst.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (702, 1, 5)').run({})
    await importAdd(knownFirst, subject(knownFirst), 1, { batchLabel: 'lot-702' })
    assert.deepEqual({ ...knownFirst.prepare('SELECT received_quantity, received_cost_usd FROM product_batches WHERE id = 702').get({}) }, { received_quantity: 8, received_cost_usd: 32 }, 'known + known: 5 x $4 + 3 x $4')

    const fresh = addFixture()
    await importAdd(fresh, subject(fresh), 1, {})
    assert.deepEqual({ ...fresh.prepare('SELECT received_quantity, received_cost_usd FROM product_batches').get({}) }, { received_quantity: 3, received_cost_usd: 12 }, 'a brand-new lot has no earlier receipt to be unknown about')
  })

  // ---- source shape: the catalog fallback is gone from every S5 writer -------------------------------------------
  await check('source shape: no S5 file passes a catalog fallback to the movement-cost resolver or reads catalog cost to price a movement', async () => {
    for (const file of ['lib/movementCostSnapshot.ts', 'routes/inventory.ts', 'lib/damagedLotActions.ts', 'lib/transferOperation.ts', 'lib/stockRevert.ts', 'lib/stockActionCommit.ts']) {
      assert.doesNotMatch(read(file), /fallbackUnitCost(Usd|Khr)/, `${file} still names a fallback unit cost`)
    }
    assert.doesNotMatch(read('routes/inventory.ts'), /productCostSnapshot/, 'inventory.ts still snapshots the catalog cost for movements')
    assert.doesNotMatch(read('lib/transferOperation.ts'), /sourceProduct!?\.cost_price/, 'transferOperation.ts still reads the catalog cost')
    assert.doesNotMatch(read('lib/stockActionCommit.ts'), /COALESCE\(p\.cost_price_usd, 0\)/, 'stockActionCommit.ts still prices imported sale lines from the catalog')
    assert.doesNotMatch(read('routes/inventory.ts'), /NULLIF\(p\.purchase_price_(usd|khr), 0\)/, 'inventory.ts valuation still treats a recorded $0 as missing')
  })

  await check('source shape: the stock-value and COGS unknown counts reach both inventory stats responses', async () => {
    const source = read('routes/inventory.ts')
    assert.equal((source.match(/stock_value_unknown_products: familyStats\.stock_value_unknown_products/g) || []).length, 2, '/products stats and /stats both forward the unknown-product count')
    assert.equal((source.match(/stock_value_unknown_quantity: familyStats\.stock_value_unknown_quantity/g) || []).length, 2)
    assert.match(source, /cogs_unknown_lines: Number\(row\.cogs_unknown_lines \|\| 0\)/)
    assert.match(source, /stock_value_unknown: Number\(metric\.stock_value_unknown\) === 1/)
  })

  console.log(`\n${checks} S5 stock-side check(s) passed.`)
}

main().catch((error) => { console.error(error); process.exit(1) })
