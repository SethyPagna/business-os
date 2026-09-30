// FX-stock F2 (2026-09-28): a dated stock count apply and every re-apply
// must leave the lot ledger (branch_batch_stock) equal to branch_stock --
// at EVERY step, not only after the happy path.
//
// The till reads the lot total and the server enforces branch_stock, so a
// fork between them is a till that shows stock the server refuses to sell
// (or hides stock it would sell). R-stock+returns found the fork on
// 39146f46: a re-apply reversed the superseded movement IN FULL on the
// aggregate but FLOORED AT ZERO on its lot, so once a sale had drawn units
// from the lot the count created, sum(lots) stayed above branch_stock for
// good (D03 branch 8 / lots 11, H04 8 / 9, H07 the till offers 1 unit the
// server refuses).
//
// End to end through the REAL buildDatedStockCountPlan (what POST
// /inventory/dated-stock-count/apply calls) and applyDatedStockCountPlan,
// with receipts through the real receiveBatchStock, sales through the real
// FIFO allocation the till uses (readFifoLotAvailability + allocateAcrossLots
// + planRemoveStockFromBatch, strict on both ledgers) and reverts through the
// real applyMovementRevert, all transpiled, on the real migration chain.
//
// Every step asserts: sum(lots) == branch_stock, products.stock_quantity ==
// SUM(branch_stock), and after a count the stock equals the file's latest
// count. The seeded random walk at the end drives receipts, FIFO sales,
// counts, re-applies, corrected re-uploads, soft-deleted empty lots and
// ledger reverts in random order, so a future split in any of them fails
// here even if no named scenario covers it.
//
// Run (from cloudflare/): node scripts/test-dated-stock-count-lot-parity-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')
const cache = new Map()
function loadReal(abs) {
  if (cache.has(abs)) return cache.get(abs).exports
  const source = fs.readFileSync(abs, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: abs,
  })
  const mod = new Module(abs, module)
  mod.filename = abs
  mod.paths = Module._nodeModulePaths(path.dirname(abs))
  cache.set(abs, mod)
  const parentRequire = mod.require.bind(mod)
  mod.require = (id) => {
    if (id.startsWith('.')) {
      let target = path.resolve(path.dirname(abs), id)
      if (!target.endsWith('.ts')) target += '.ts'
      if (fs.existsSync(target)) return loadReal(target)
    }
    return parentRequire(id)
  }
  mod._compile(outputText, abs)
  return mod.exports
}
const lib = (name) => loadReal(path.join(SRC, 'lib', `${name}.ts`))
const { buildDatedStockCountPlan } = lib('datedStockCountRoute')
const { applyDatedStockCountPlan, DatedStockCountConflictError } = lib('datedStockCountApply')
const { receiveBatchStock, readFifoLotAvailability, allocateAcrossLots, planRemoveStockFromBatch } = lib('productBatches')
const { applyMovementRevert } = lib('stockRevert')

const SHOP = 1

// FX-stock4 E1: the REAL product merge fold (routes/products.ts
// foldDuplicateProductInto -- every merge entry point calls it), loaded the
// way test-merge-duplicates-stock-choice-pure.cjs loads it: the route file
// transpiled, its router/auth/audit dependencies stubbed, the lot and
// identity libs it folds with loaded for real.
const moneyPrecision = require('../src/lib/moneyPrecision.ts')
function loadWithStubs(relPath, stubs) {
  const abs = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(abs, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: path.basename(abs),
  })
  const permissive = () => new Proxy(function () {}, {
    get: (_t, prop) => (prop === 'default' ? permissive() : function () { return undefined }),
    apply: () => undefined,
    construct: () => ({}),
  })
  const original = Module._load
  Module._load = (request, parent, isMain) => {
    if (['./moneyPrecision', '../lib/moneyPrecision', './moneyPrecision.ts', '../lib/moneyPrecision.ts'].includes(request)) return moneyPrecision
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    if (request.startsWith('.') || request === 'hono') return permissive()
    return original.call(Module, request, parent, isMain)
  }
  const mod = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, require, mod, abs, path.dirname(abs))
  } finally {
    Module._load = original
  }
  return mod.exports
}
class FakeHono {
  get() { return this } post() { return this } put() { return this } patch() { return this }
  delete() { return this } use() { return this } on() { return this } all() { return this }
  route() { return this } onError() { return this } notFound() { return this }
}
function foldAdapter(rawDb) {
  return {
    prepare(sql) {
      const st = rawDb.prepare(sql)
      return {
        get: (p) => st.get(p == null ? {} : p),
        all: (p) => st.all(p == null ? {} : p),
        run: (p) => { const r = st.run(p == null ? {} : p); return { changes: Number(r.meta?.changes ?? 0), lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
      }
    },
    batch: (stmts) => {
      if (!stmts.every(({ sql }) => /^\s*(?:SELECT|WITH|PRAGMA)\b/i.test(sql))) return rawDb.batch(stmts)
      return Promise.resolve(stmts.map(({ sql, params }) => ({ success: true, results: rawDb.prepare(sql).all(params == null ? {} : params) })))
    },
  }
}
function loadFold(rawDb) {
  const adapter = foldAdapter(rawDb)
  const real = (rel, stubs = {}) => loadWithStubs(path.join('lib', rel), stubs)
  const actorSnapshot = real('actorSnapshot.ts')
  const detailRule = real('productDetailRule.ts')
  const sqlBinding = real('sqlBinding.ts')
  const productIdentity = real('productIdentity.ts', { './db': {}, './sqlBinding': sqlBinding, './productDetailRule': detailRule })
  const productMerge = real('productMerge.ts')
  const productMergeSnapshot = real('productMergeSnapshot.ts', { './db': {} })
  const catalogCost = real('catalogCostRecompute.ts', { './db': {} })
  const undoAppliers = real('undoAppliers.ts', {
    './actorSnapshot': actorSnapshot, './catalogCostRecompute': catalogCost,
    '../index': {}, './auth': {}, './db': { getDb: () => adapter }, './audit': { audit: async () => {} },
    '../durable-objects/broadcastHub': { broadcast: async () => {} },
    './branchWrites': { branchUpdateStatements: () => [] },
    './permissions': { getActionTier: () => 'full', getPermissionTier: () => 'full' },
  })
  const products = loadWithStubs(path.join('routes', 'products.ts'), {
    '../lib/actorSnapshot': actorSnapshot, hono: { Hono: FakeHono },
    '../lib/db': { getDb: () => adapter }, '../lib/audit': { audit: async () => {} },
    '../lib/undoAppliers': undoAppliers, '../lib/productDetailRule': detailRule, '../lib/productIdentity': productIdentity,
    '../lib/productMerge': productMerge, '../lib/productMergeSnapshot': productMergeSnapshot,
    '../lib/sqlBinding': sqlBinding, '../lib/catalogCostRecompute': catalogCost,
  })
  return (keeperId, dupId, disposition = 'merge') => products.foldDuplicateProductInto(
    {}, adapter, { id: 42, username: 'reviewer', name: 'Reviewer' },
    { id: keeperId, name: 'Twin Gel' }, { id: dupId, name: 'Twin Gel', image_path: null },
    new Map([[1, 'Shop'], [2, 'Warehouse']]), 'FX-stock4 lot parity', disposition,
  )
}

function freshDb() {
  const rawDb = openDb(loadAll())
  const db = {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      return {
        get: (params) => stmt.get(params),
        all: (params) => stmt.all(params) ?? [],
        run: (params) => { const r = stmt.run(params); return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) } },
      }
    },
    async batch(items) { return rawDb.batch(items) },
    async batchOnce(items) { return rawDb.batch(items) },
    async transaction(fn) { return fn(this) },
  }
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (1, 'Shop', 1, 1)").run()
  rawDb.prepare("INSERT INTO branches (id, name, is_active, is_default) VALUES (2, 'Warehouse', 1, 0)").run()
  return { rawDb, db }
}

function addProduct(rawDb, productId) {
  rawDb.prepare("INSERT INTO products (id, name, is_active, stock_quantity) VALUES (@id, 'Gel ' || @id, 1, 0)").run({ id: productId })
}

// Two rows of one item (same name, same barcode): what every merge path folds.
function addTwin(rawDb, productId) {
  rawDb.prepare(`INSERT INTO products (id, name, barcode, selling_price_usd, selling_price_khr, cost_price_usd, cost_price_khr, stock_quantity, is_active)
    VALUES (@id, 'Twin Gel', '8859199', 5, 20500, 2, 8200, 0, 1)`).run({ id: productId })
}

// A supplier receipt, through the same helper Inventory > Adjust > Add uses.
async function receive(db, productId, quantity, date, unitCostUsd = null) {
  await receiveBatchStock(db, { productId, branchId: SHOP, quantity, receivedDate: date, unitCostUsd })
}

function branchQty(rawDb, productId) {
  return Number(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = @p AND branch_id = 1').get({ p: productId })?.quantity ?? 0)
}

// A till sale: the server refuses more than branch_stock holds; otherwise
// FIFO across the lots the till shows, strict on the lot AND the branch.
async function sell(db, rawDb, productId, quantity) {
  const lots = await readFifoLotAvailability(db, productId, SHOP)
  const lotTotal = lots.reduce((sum, lot) => sum + lot.available, 0)
  const available = branchQty(rawDb, productId)
  if (quantity > available) return { ok: false, available, lotTotal }
  const { takes, uncovered } = allocateAcrossLots(lots, quantity)
  const statements = []
  for (const take of takes) {
    statements.push(...planRemoveStockFromBatch({ batchId: take.batchId, productId, branchId: SHOP, quantity: take.quantity }).statements)
  }
  if (uncovered > 0) {
    statements.push(
      { sql: 'UPDATE branch_stock SET quantity = quantity - @q WHERE product_id = @p AND branch_id = 1', params: { q: uncovered, p: productId } },
      { sql: 'UPDATE products SET stock_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM branch_stock WHERE product_id = @p) WHERE id = @p', params: { p: productId } },
    )
  }
  await db.batch(statements)
  return { ok: true, available, lotTotal }
}

function entriesFor(productId, pairs) {
  return pairs.map(([date, count]) => ({ date, productId, branchId: SHOP, count }))
}

async function applyCount(db, productId, pairs) {
  const built = await buildDatedStockCountPlan(db, entriesFor(productId, pairs))
  if ('error' in built) throw new Error(built.error)
  return applyDatedStockCountPlan(db, built.plan)
}

function latestCount(pairs) {
  return [...pairs].sort((a, b) => a[0].localeCompare(b[0])).at(-1)[1]
}

function ledger(rawDb, productId) {
  const lots = rawDb.prepare(`
    SELECT pb.id, substr(pb.received_at, 1, 10) AS date, pb.is_active AS active, COALESCE(bbs.quantity, 0) AS quantity
    FROM product_batches pb
    LEFT JOIN branch_batch_stock bbs ON bbs.batch_id = pb.id AND bbs.branch_id = 1
    WHERE pb.variant_product_id = @p ORDER BY pb.received_at, pb.id`).all({ p: productId })
  return {
    branch: branchQty(rawDb, productId),
    lotSum: lots.reduce((sum, lot) => sum + Number(lot.quantity), 0),
    lots: lots.map((lot) => `${lot.date}=${lot.quantity}${lot.active ? '' : '(inactive)'}`).join(' '),
    product: Number(rawDb.prepare('SELECT stock_quantity FROM products WHERE id = @p').get({ p: productId }).stock_quantity),
    branchSum: Number(rawDb.prepare('SELECT COALESCE(SUM(quantity), 0) AS q FROM branch_stock WHERE product_id = @p').get({ p: productId }).q),
    hiddenPositive: rawDb.prepare(`SELECT COUNT(*) AS n FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id = bbs.batch_id
      WHERE pb.variant_product_id = @p AND bbs.quantity > 0 AND pb.is_active IS NOT 1`).get({ p: productId }).n,
  }
}

// The invariant, asserted after every step.
function assertParity(rawDb, productId, label) {
  const s = ledger(rawDb, productId)
  assert.strictEqual(s.lotSum, s.branch, `${label}: sum(lots) ${s.lotSum} != branch_stock ${s.branch} [${s.lots}]`)
  assert.strictEqual(s.product, s.branchSum, `${label}: products.stock_quantity ${s.product} != SUM(branch_stock) ${s.branchSum}`)
  assert.strictEqual(s.hiddenPositive, 0, `${label}: positive stock on an inactive lot [${s.lots}]`)
  return s
}

// A scenario is a list of [label, action, expected] steps; the invariant is
// checked after every step and `expected` (branch / lots / lotSum) on top.
// `others` are products that must keep the invariant too (a merged-away twin).
async function runSteps(rawDb, productId, steps, others = []) {
  for (const [label, action, expected] of steps) {
    const result = await action()
    for (const other of others) assertParity(rawDb, other, `${label} [product ${other}]`)
    const s = assertParity(rawDb, productId, label)
    if (expected) {
      for (const [key, value] of Object.entries(expected)) {
        const actual = key in s ? s[key] : result?.[key]
        assert.deepStrictEqual(actual, value, `${label}: ${key} expected ${JSON.stringify(value)}, got ${JSON.stringify(actual)} [${s.lots}]`)
      }
    }
  }
}

let passed = 0
let failed = 0
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); passed += 1 } catch (err) { console.log(`FAIL ${name}`); console.log(`  ${err.message.split('\n')[0]}`); failed += 1 }
}

async function main() {
  await test('a FIFO sale drains the lot the count created, then the same file is re-applied: branch 10, lots 10 (39146f46: lots 11)', async () => {
    const { rawDb, db } = freshDb()
    const P = 1
    addProduct(rawDb, P)
    const COUNT = [['2026-08-16', 10]]
    await runSteps(rawDb, P, [
      ['receipt 7 @08-01', () => receive(db, P, 7, '2026-08-01'), { branch: 7, lots: '2026-08-01=7' }],
      ['count 08-16 = 10', () => applyCount(db, P, COUNT), { branch: 10, lots: '2026-08-01=7 2026-08-16=3' }],
      ['FIFO sale 8 (old lot 7 + count lot 1)', () => sell(db, rawDb, P, 8), { branch: 2, lots: '2026-08-01=0 2026-08-16=2' }],
      ['same file re-applied', () => applyCount(db, P, COUNT), { branch: 10, lotSum: 10 }],
      ['same file re-applied again', () => applyCount(db, P, COUNT), { branch: 10, lotSum: 10 }],
      ['sale 10 (everything)', () => sell(db, rawDb, P, 10), { branch: 0, lotSum: 0 }],
      ['sale 1 more is refused, and the till shows none either', () => sell(db, rawDb, P, 1), { ok: false, available: 0, lotTotal: 0 }],
    ])
  })

  await test('refuter scenario D: count dated before its lot, the sale drains the count lot first, re-applied twice (D03 was branch 8 / lots 11)', async () => {
    const { rawDb, db } = freshDb()
    const P = 105
    addProduct(rawDb, P)
    const COUNT = [['2026-08-25', 8]]
    await runSteps(rawDb, P, [
      ['receipt 5 @09-01', () => receive(db, P, 5, '2026-09-01', 1), { branch: 5 }],
      ['D01 count 08-25 = 8', () => applyCount(db, P, COUNT), { branch: 8, lots: '2026-08-25=3 2026-09-01=5' }],
      ['D02 FIFO sale 6', () => sell(db, rawDb, P, 6), { branch: 2, lots: '2026-08-25=0 2026-09-01=2' }],
      ['D03 same count re-applied', () => applyCount(db, P, COUNT), { branch: 8, lotSum: 8 }],
      ['D05 re-applied once more', () => applyCount(db, P, COUNT), { branch: 8, lotSum: 8 }],
    ])
  })

  await test('refuter scenario H: H04 re-apply 8/8 (was 8/9), H05 corrected 7/7 (was 7/8), H06 sell out 0/0, H07 refused with no phantom lot unit', async () => {
    const { rawDb, db } = freshDb()
    const P = 107
    addProduct(rawDb, P)
    await runSteps(rawDb, P, [
      ['H01 receipt 5 @09-01', () => receive(db, P, 5, '2026-09-01', 1), { branch: 5 }],
      ['H02 count 09-26 = 8', () => applyCount(db, P, [['2026-09-26', 8]]), { branch: 8, lots: '2026-09-01=5 2026-09-26=3' }],
      ['H03 FIFO sale 6 (old lot 5 + count lot 1)', () => sell(db, rawDb, P, 6), { branch: 2, lots: '2026-09-01=0 2026-09-26=2' }],
      ['H04 same count file re-applied', () => applyCount(db, P, [['2026-09-26', 8]]), { branch: 8, lotSum: 8 }],
      ['H05 corrected re-upload = 7', () => applyCount(db, P, [['2026-09-26', 7]]), { branch: 7, lotSum: 7 }],
      ['H06 sale 7 (sell everything)', () => sell(db, rawDb, P, 7), { branch: 0, lotSum: 0 }],
      ['H07 sale 1: refused, the till shows 0 too', () => sell(db, rawDb, P, 1), { ok: false, available: 0, lotTotal: 0 }],
    ])
  })

  await test('a later receipt, then a corrected count equal to the baseline (no new movement): the sold-from-count units come off another lot, 3/3', async () => {
    const { rawDb, db } = freshDb()
    const P = 2
    addProduct(rawDb, P)
    await runSteps(rawDb, P, [
      ['receipt 7 @08-01', () => receive(db, P, 7, '2026-08-01'), { branch: 7 }],
      ['count 08-16 = 10', () => applyCount(db, P, [['2026-08-16', 10]]), { branch: 10 }],
      ['FIFO sale 9', () => sell(db, rawDb, P, 9), { branch: 1, lots: '2026-08-01=0 2026-08-16=1' }],
      ['receipt 5 @09-01', () => receive(db, P, 5, '2026-09-01'), { branch: 6 }],
      ['corrected count 08-16 = 3', () => applyCount(db, P, [['2026-08-16', 3]]), { branch: 3, lotSum: 3 }],
      ['re-applied', () => applyCount(db, P, [['2026-08-16', 3]]), { branch: 3, lotSum: 3 }],
      ['back up to 10', () => applyCount(db, P, [['2026-08-16', 10]]), { branch: 10, lotSum: 10 }],
    ])
  })

  await test('a later receipt, then a corrected count below the baseline (a drain): 2/2, stable on re-apply', async () => {
    const { rawDb, db } = freshDb()
    const P = 3
    addProduct(rawDb, P)
    await runSteps(rawDb, P, [
      ['receipt 7 @08-01', () => receive(db, P, 7, '2026-08-01'), { branch: 7 }],
      ['count 08-16 = 10', () => applyCount(db, P, [['2026-08-16', 10]]), { branch: 10 }],
      ['FIFO sale 9', () => sell(db, rawDb, P, 9), { branch: 1 }],
      ['receipt 5 @09-01', () => receive(db, P, 5, '2026-09-01'), { branch: 6 }],
      ['corrected count 08-16 = 2', () => applyCount(db, P, [['2026-08-16', 2]]), { branch: 2, lotSum: 2 }],
      ['re-applied', () => applyCount(db, P, [['2026-08-16', 2]]), { branch: 2, lotSum: 2 }],
    ])
  })

  await test('a lot the prior count drained was soft-deleted when empty: the re-apply puts its units back on it, 2/2 (39146f46: lots 5)', async () => {
    const { rawDb, db } = freshDb()
    const P = 4
    addProduct(rawDb, P)
    await runSteps(rawDb, P, [
      ['receipt 5 @09-01', () => receive(db, P, 5, '2026-09-01'), { branch: 5 }],
      ['count 09-05 = 0 (drains it)', () => applyCount(db, P, [['2026-09-05', 0]]), { branch: 0, lots: '2026-09-01=0' }],
      ['empty lot soft-deleted', () => rawDb.prepare('UPDATE product_batches SET is_active = 0 WHERE variant_product_id = @p').run({ p: P }), { lots: '2026-09-01=0(inactive)' }],
      ['corrected count 09-05 = 2', () => applyCount(db, P, [['2026-09-05', 2]]), { branch: 2, lotSum: 2 }],
      ['re-applied', () => applyCount(db, P, [['2026-09-05', 2]]), { branch: 2, lotSum: 2 }],
    ])
  })

  await test('a two-date series (receipt then drain) sold across both lots, re-applied, then corrected: parity at every step', async () => {
    const { rawDb, db } = freshDb()
    const P = 5
    addProduct(rawDb, P)
    const SERIES = [['2026-08-16', 10], ['2026-08-20', 6]]
    await runSteps(rawDb, P, [
      ['receipt 7 @08-01', () => receive(db, P, 7, '2026-08-01'), { branch: 7 }],
      ['series 08-16 = 10, 08-20 = 6', () => applyCount(db, P, SERIES), { branch: 6, lots: '2026-08-01=3 2026-08-16=3' }],
      ['FIFO sale 5', () => sell(db, rawDb, P, 5), { branch: 1, lots: '2026-08-01=0 2026-08-16=1' }],
      ['series re-applied', () => applyCount(db, P, SERIES), { branch: 6, lotSum: 6 }],
      ['corrected series 08-16 = 9, 08-20 = 4', () => applyCount(db, P, [['2026-08-16', 9], ['2026-08-20', 4]]), { branch: 4, lotSum: 4 }],
      ['only 08-16 = 1 re-uploaded (08-20 stays in the ledger)', () => applyCount(db, P, [['2026-08-16', 1]]), { branch: 1, lotSum: 1 }],
    ])
  })

  await test('reversal: a ledger revert of the count, then the re-apply lands once; a second revert is refused', async () => {
    const { rawDb, db } = freshDb()
    const P = 6
    addProduct(rawDb, P)
    const COUNT = [['2026-08-16', 10]]
    let movement = null
    await runSteps(rawDb, P, [
      ['receipt 7 @08-01', () => receive(db, P, 7, '2026-08-01'), { branch: 7 }],
      ['count 08-16 = 10', () => applyCount(db, P, COUNT), { branch: 10 }],
      ['revert the count movement', async () => {
        movement = rawDb.prepare("SELECT * FROM inventory_movements WHERE product_id = @p AND reason = 'Dated stock count import'").get({ p: P })
        const result = await applyMovementRevert(db, movement, { userId: 1, userName: 'Admin' })
        assert.ok(result.ok, JSON.stringify(result))
        // The count lot received 3; the Revert takes the stock back and keeps
        // what was recorded as received (owner, 30 Sep 2026), so the empty lot
        // stays like any sold-out lot.
      }, { branch: 7, lots: '2026-08-01=7 2026-08-16=0' }],
      ['revert again: refused, nothing moves', async () => {
        const result = await applyMovementRevert(db, movement, { userId: 1, userName: 'Admin' })
        assert.strictEqual(result.code, 'already_reverted')
      }, { branch: 7 }],
      ['count re-applied after the revert', () => applyCount(db, P, COUNT), { branch: 10, lotSum: 10 }],
      ['FIFO sale 9', () => sell(db, rawDb, P, 9), { branch: 1 }],
      ['re-applied after the sale', () => applyCount(db, P, COUNT), { branch: 10, lotSum: 10 }],
    ])
  })

  await test('double apply of one plan after a count-lot sale: the second is refused (409), nothing moves, parity holds', async () => {
    const { rawDb, db } = freshDb()
    const P = 7
    addProduct(rawDb, P)
    const COUNT = [['2026-08-16', 10]]
    await receive(db, P, 7, '2026-08-01')
    await applyCount(db, P, COUNT)
    await sell(db, rawDb, P, 8)
    const built = await buildDatedStockCountPlan(db, entriesFor(P, COUNT))
    await applyDatedStockCountPlan(db, built.plan)
    const after = assertParity(rawDb, P, 'first apply')
    assert.strictEqual(after.branch, 10)
    await assert.rejects(() => applyDatedStockCountPlan(db, built.plan), (err) => err instanceof DatedStockCountConflictError)
    assert.deepStrictEqual(assertParity(rawDb, P, 'second apply refused'), after)
  })

  await test('a sale lands between plan and apply and the plan no longer fits the lots: refused (409), nothing written; a fresh plan lands 4/4', async () => {
    const { rawDb, db } = freshDb()
    const P = 8
    addProduct(rawDb, P)
    await receive(db, P, 7, '2026-08-01')
    await applyCount(db, P, [['2026-08-16', 10]])
    const stale = await buildDatedStockCountPlan(db, entriesFor(P, [['2026-08-16', 4]]))
    await sell(db, rawDb, P, 10)
    const before = assertParity(rawDb, P, 'sold out')
    await assert.rejects(() => applyDatedStockCountPlan(db, stale.plan), (err) => err instanceof DatedStockCountConflictError)
    assert.deepStrictEqual(assertParity(rawDb, P, 'stale plan refused'), before)
    await applyCount(db, P, [['2026-08-16', 4]])
    const s = assertParity(rawDb, P, 'fresh plan')
    assert.deepStrictEqual({ branch: s.branch, lotSum: s.lotSum }, { branch: 4, lotSum: 4 })
  })

  await test('two branches in one file: an inactive lot loaded for its Shop provenance does not join the Warehouse count (its received units stay 5)', async () => {
    const { rawDb, db } = freshDb()
    const P = 9
    addProduct(rawDb, P)
    const WAREHOUSE = 2
    const warehouse = () => ({
      branch: Number(rawDb.prepare('SELECT quantity FROM branch_stock WHERE product_id = @p AND branch_id = 2').get({ p: P })?.quantity ?? 0),
      lotSum: Number(rawDb.prepare(`SELECT COALESCE(SUM(bbs.quantity), 0) AS q FROM branch_batch_stock bbs JOIN product_batches pb ON pb.id = bbs.batch_id
        WHERE pb.variant_product_id = @p AND bbs.branch_id = 2`).get({ p: P }).q),
    })
    const supplierLot = () => rawDb.prepare('SELECT id, received_quantity AS received, is_active AS active FROM product_batches WHERE variant_product_id = @p ORDER BY id LIMIT 1').get({ p: P })
    await receive(db, P, 5, '2026-09-01', 1)
    const lotId = supplierLot().id
    // The supplier lot once held stock at the Warehouse too: a zero row there.
    rawDb.prepare('INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (@id, 2, 0)').run({ id: lotId })
    await applyCount(db, P, [['2026-09-05', 0]])
    rawDb.prepare('UPDATE product_batches SET is_active = 0 WHERE id = @id').run({ id: lotId })
    const file = [
      { date: '2026-09-05', productId: P, branchId: SHOP, count: 2 },
      { date: '2026-09-01', productId: P, branchId: WAREHOUSE, count: 3 },
    ]
    for (const label of ['both branches counted', 're-applied']) {
      const built = await buildDatedStockCountPlan(db, file)
      await applyDatedStockCountPlan(db, built.plan)
      const shop = assertParity(rawDb, P, label)
      assert.deepStrictEqual({ branch: shop.branch, lotSum: shop.lotSum }, { branch: 2, lotSum: 2 }, `${label}: Shop [${shop.lots}]`)
      assert.deepStrictEqual(warehouse(), { branch: 3, lotSum: 3 }, `${label}: Warehouse`)
      // The Shop re-apply puts 2 back on the supplier lot (it drained it);
      // the Warehouse receipt must not top up that inactive, costed lot.
      assert.deepStrictEqual({ received: supplierLot().received, active: supplierLot().active }, { received: 5, active: 1 }, `${label}: supplier lot`)
    }
  })

  await test('legacy untracked stock (branch_stock with no lots): the settlement cannot be covered, every lot lands on 0 and lots never exceed branch_stock', async () => {
    const { rawDb, db } = freshDb()
    const P = 10
    addProduct(rawDb, P)
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@p, 1, 5)').run({ p: P })
    rawDb.prepare('UPDATE products SET stock_quantity = 5 WHERE id = @p').run({ p: P })
    const check = (label, expected) => {
      const s = ledger(rawDb, P)
      assert.ok(s.lotSum <= s.branch, `${label}: sum(lots) ${s.lotSum} > branch_stock ${s.branch} [${s.lots}]`)
      assert.strictEqual(s.product, s.branchSum, `${label}: rollup`)
      assert.strictEqual(s.hiddenPositive, 0, `${label}: positive stock on an inactive lot`)
      assert.deepStrictEqual({ branch: s.branch, lotSum: s.lotSum }, expected, `${label} [${s.lots}]`)
    }
    check('legacy 5, no lots', { branch: 5, lotSum: 0 })
    await applyCount(db, P, [['2026-08-16', 8]])
    check('count 08-16 = 8 (a lot of 3 on top of 5 untracked)', { branch: 8, lotSum: 3 })
    await receive(db, P, 2, '2026-09-01')
    check('receipt 2 @09-01', { branch: 10, lotSum: 5 })
    await sell(db, rawDb, P, 5)
    check('FIFO sale 5 empties both lots', { branch: 5, lotSum: 0 })
    await applyCount(db, P, [['2026-08-16', 0]])
    check('corrected count 08-16 = 0', { branch: 0, lotSum: 0 })
    await applyCount(db, P, [['2026-08-16', 0]])
    check('re-applied', { branch: 0, lotSum: 0 })
    // The re-apply reverses the prior run's removal of 2. No lot covered
    // that removal (it came out of untracked stock), so its reversal puts
    // the 2 back as untracked, exactly as they left; only this run's +2
    // lands on a lot. Branch +4, lots +2: the gap is the 2 untracked units
    // restored, and lots never exceed branch_stock.
    await applyCount(db, P, [['2026-08-16', 4]])
    check('corrected up to 4', { branch: 4, lotSum: 2 })
  })

  // The route loads a lot the superseded provenance names even when it is
  // inactive (or has no stock row left at the branch), WITH its own date:
  // the re-apply's FIFO drain must then walk it in date order. Without the
  // load the plan still reverses it (parity holds) but dateless, so it
  // sorts first and the drain empties the wrong lot.
  for (const variant of ['inactive, zero row kept', 'inactive, stock row gone']) {
    await test(`a re-apply drains FIFO by the real date of a superseded lot that is ${variant}: 09-01 first, 09-10 keeps 2`, async () => {
      const { rawDb, db } = freshDb()
      const P = variant.endsWith('kept') ? 11 : 12
      addProduct(rawDb, P)
      const lotOn = (date) => rawDb.prepare('SELECT id FROM product_batches WHERE variant_product_id = @p AND received_at LIKE @d').get({ p: P, d: `${date}%` }).id
      await runSteps(rawDb, P, [
        ['receipt 2 @09-01', () => receive(db, P, 2, '2026-09-01'), { branch: 2 }],
        ['receipt 3 @09-10', () => receive(db, P, 3, '2026-09-10'), { branch: 5 }],
        ['count 09-12 = 0 drains both', () => applyCount(db, P, [['2026-09-12', 0]]), { branch: 0, lots: '2026-09-01=0 2026-09-10=0' }],
        [`09-10 lot ${variant}`, () => {
          const id = lotOn('2026-09-10')
          rawDb.prepare('UPDATE product_batches SET is_active = 0 WHERE id = @id').run({ id })
          if (variant.endsWith('gone')) rawDb.prepare('DELETE FROM branch_batch_stock WHERE batch_id = @id').run({ id })
        }, { branch: 0 }],
        ['receipt 4 @09-15', () => receive(db, P, 4, '2026-09-15'), { branch: 4 }],
        // Reversal: 09-01 +2, 09-10 +3, baseline 9; the count's -3 drains
        // 09-01 (2) then 09-10 (1), oldest first.
        ['corrected count 09-12 = 6', () => applyCount(db, P, [['2026-09-12', 6]]), { branch: 6, lots: '2026-09-01=0 2026-09-10=2 2026-09-15=4' }],
        ['re-applied', () => applyCount(db, P, [['2026-09-12', 6]]), { branch: 6, lots: '2026-09-01=0 2026-09-10=2 2026-09-15=4' }],
      ])
    })
  }

  await test('no lots at all: a sale between plan and apply leaves too little for the plan\'s removal: refused (409), nothing written; a fresh plan lands 4', async () => {
    const { rawDb, db } = freshDb()
    const P = 13
    addProduct(rawDb, P)
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@p, 1, 10)').run({ p: P })
    rawDb.prepare('UPDATE products SET stock_quantity = 10 WHERE id = @p').run({ p: P })
    const stale = await buildDatedStockCountPlan(db, entriesFor(P, [['2026-08-16', 4]]))
    await sell(db, rawDb, P, 8)
    const before = ledger(rawDb, P)
    assert.deepStrictEqual({ branch: before.branch, lotSum: before.lotSum }, { branch: 2, lotSum: 0 })
    // The plan removes 6 from a branch that now holds 2: never clamped to 0.
    await assert.rejects(() => applyDatedStockCountPlan(db, stale.plan), (err) => err instanceof DatedStockCountConflictError)
    assert.deepStrictEqual(ledger(rawDb, P), before, 'nothing written')
    await applyCount(db, P, [['2026-08-16', 4]])
    const after = ledger(rawDb, P)
    assert.deepStrictEqual({ branch: after.branch, product: after.product }, { branch: 4, product: 4 })
  })

  // FX-stock4 E1 (R-stock3, new vs production c5b28762 on 8b8d6f449): a
  // dated count drained a twin's lot, a merge folded the twin into the
  // keeper, and the keeper's count for that date was re-applied. The count
  // movement now belongs to the keeper but its provenance still names the
  // twin's lot, so the re-apply reversed the drain onto the MERGED-AWAY
  // product's lot (reactivating it) and the keeper's lots fell short of its
  // branch_stock: keeper branch 9 / lots 7, twin lot 2. Every unit must land
  // on the keeper's lots, and the twin must hold nothing.
  const lotReceived = (rawDb, productId) => rawDb.prepare(`SELECT substr(received_at, 1, 10) AS date, received_quantity AS received
    FROM product_batches WHERE variant_product_id = @p ORDER BY received_at, id`).all({ p: productId }).map((r) => `${r.date}:${r.received}`).join(' ')
  for (const disposition of ['merge', 'write_off']) {
    await test(`E1 (${disposition}): a count drained the twin's lot, the twin is folded away, the keeper's count for that date re-applied at 9: keeper 9/9, twin 0 (8b8d6f449: lots 7, twin lot 2)`, async () => {
      const { rawDb, db } = freshDb()
      const K = 103
      const D = 104
      addTwin(rawDb, K)
      addTwin(rawDb, D)
      const fold = loadFold(rawDb)
      const folded = disposition === 'merge' ? 7 : 5
      await runSteps(rawDb, K, [
        ['receive keeper 5 @09-01', () => receive(db, K, 5, '2026-09-01'), { branch: 5, lots: '2026-09-01=5' }],
        ['receive twin 6 @09-01 (same lot key)', () => receive(db, D, 6, '2026-09-01'), { branch: 5 }],
        ['count twin 09-10 = 2 (drains its lot by 4)', () => applyCount(db, D, [['2026-09-10', 2]]), { branch: 5 }],
        [`fold the twin into the keeper (${disposition})`, () => fold(K, D, disposition), { branch: folded, lots: `2026-09-01=${folded}` }],
        ['keeper count 09-10 = 9', () => applyCount(db, K, [['2026-09-10', 9]]), { branch: 9, lotSum: 9, lots: '2026-09-01=9' }],
        ['re-applied', () => applyCount(db, K, [['2026-09-10', 9]]), { branch: 9, lotSum: 9 }],
        ['corrected 09-10 = 5', () => applyCount(db, K, [['2026-09-10', 5]]), { branch: 5, lotSum: 5 }],
        ['corrected 09-10 = 12', () => applyCount(db, K, [['2026-09-10', 12]]), { branch: 12, lotSum: 12 }],
        ['sell 12', () => sell(db, rawDb, K, 12), { branch: 0, lotSum: 0 }],
        ['sale 1 refused, the till shows none either', () => sell(db, rawDb, K, 1), { ok: false, available: 0, lotTotal: 0 }],
      ], [D])
      const twin = ledger(rawDb, D)
      assert.deepStrictEqual({ branch: twin.branch, lotSum: twin.lotSum }, { branch: 0, lotSum: 0 }, `the merged-away twin holds nothing [${twin.lots}]`)
      assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM product_batches WHERE variant_product_id = @p AND is_active = 1').get({ p: D }).n, 0, 'no twin lot reactivated')
    })
  }

  await test('E1: the keeper holds two lots on the twin\'s date at different costs: the reversal goes back on the lot the fold put the twin\'s units in (same key), not the first lot of that date', async () => {
    const { rawDb, db } = freshDb()
    const K = 116
    const D = 117
    addTwin(rawDb, K)
    addTwin(rawDb, D)
    const fold = loadFold(rawDb)
    await runSteps(rawDb, K, [
      ['receive keeper 5 @09-01 at $1 (lot A)', () => receive(db, K, 5, '2026-09-01', 1), { branch: 5 }],
      ['receive keeper 3 @09-01 at $2 (lot B)', () => receive(db, K, 3, '2026-09-01', 2), { branch: 8, lots: '2026-09-01=5 2026-09-01=3' }],
      ['receive twin 6 @09-01 at $2 (lot B\'s key)', () => receive(db, D, 6, '2026-09-01', 2), { branch: 8 }],
      ['count twin 09-10 = 2 (drains its lot by 4)', () => applyCount(db, D, [['2026-09-10', 2]]), { branch: 8 }],
      ['fold the twin into the keeper: its 2 join lot B', () => fold(K, D, 'merge'), { branch: 10, lots: '2026-09-01=5 2026-09-01=5' }],
      // The drain of 4 goes back on lot B (9); the count's -2 then drains FIFO
      // from lot A (3). The same-date fallback would have put the 4 on lot A.
      ['keeper count 09-10 = 12', () => applyCount(db, K, [['2026-09-10', 12]]), { branch: 12, lots: '2026-09-01=3 2026-09-01=9' }],
      ['re-applied', () => applyCount(db, K, [['2026-09-10', 12]]), { branch: 12, lots: '2026-09-01=3 2026-09-01=9' }],
    ], [D])
  })

  await test('E1 mirror: the count RECEIVED onto the twin\'s lot, folded, recounted 30 / 20 / 10: parity every step, the receipt un-received from the lot that recorded it', async () => {
    const { rawDb, db } = freshDb()
    const K = 105
    const D = 106
    addTwin(rawDb, K)
    addTwin(rawDb, D)
    const fold = loadFold(rawDb)
    await runSteps(rawDb, K, [
      ['receive keeper 20 @09-01', () => receive(db, K, 20, '2026-09-01'), { branch: 20 }],
      ['receive twin 6 @09-01', () => receive(db, D, 6, '2026-09-01'), { branch: 20 }],
      ['count twin 09-01 = 9 (+3 onto its lot)', () => applyCount(db, D, [['2026-09-01', 9]]), { branch: 20 }],
      ['fold the twin into the keeper', () => fold(K, D, 'merge'), { branch: 29, lots: '2026-09-01=29' }],
      ['keeper count 09-01 = 30', () => applyCount(db, K, [['2026-09-01', 30]]), { branch: 30, lotSum: 30 }],
      ['corrected 09-01 = 20', () => applyCount(db, K, [['2026-09-01', 20]]), { branch: 20, lotSum: 20 }],
      ['corrected 09-01 = 10', () => applyCount(db, K, [['2026-09-01', 10]]), { branch: 10, lotSum: 10 }],
    ], [D])
    // The twin's lot recorded 6 received + the count's 3; the count is gone,
    // so its lot is back to its supplier's 6. The keeper's lot keeps its own 20.
    assert.strictEqual(lotReceived(rawDb, D), '2026-09-01:6', 'twin lot received')
    assert.strictEqual(lotReceived(rawDb, K), '2026-09-01:20', 'keeper lot received')
  })

  await test('E1 write-off, the keeper has no lot with the twin\'s key: the reversal lands on a keeper lot (oldest), drain and receipt flavours, parity every step', async () => {
    for (const flavour of ['drain', 'receipt']) {
      const { rawDb, db } = freshDb()
      const K = flavour === 'drain' ? 107 : 109
      const D = K + 1
      addTwin(rawDb, K)
      addTwin(rawDb, D)
      const fold = loadFold(rawDb)
      const date = flavour === 'drain' ? '2026-09-10' : '2026-09-01'
      await runSteps(rawDb, K, [
        [`${flavour}: receive keeper 5 @09-05`, () => receive(db, K, 5, '2026-09-05'), { branch: 5 }],
        [`${flavour}: receive twin 6 @09-01`, () => receive(db, D, 6, '2026-09-01'), { branch: 5 }],
        [`${flavour}: count twin ${date}`, () => applyCount(db, D, [[date, flavour === 'drain' ? 2 : 9]]), { branch: 5 }],
        [`${flavour}: write the twin off`, () => fold(K, D, 'write_off'), { branch: 5, lots: '2026-09-05=5' }],
        [`${flavour}: keeper count ${date} = 9`, () => applyCount(db, K, [[date, 9]]), { branch: 9, lotSum: 9 }],
        [`${flavour}: re-applied`, () => applyCount(db, K, [[date, 9]]), { branch: 9, lotSum: 9 }],
        [`${flavour}: corrected to 3`, () => applyCount(db, K, [[date, 3]]), { branch: 3, lotSum: 3 }],
      ], [D])
    }
  })

  await test('E1 chain: a twin folded into a second twin, that one folded into the keeper, then the keeper recounts the first twin\'s date: 10/10, both twins hold nothing', async () => {
    const { rawDb, db } = freshDb()
    const [K, B, A] = [111, 112, 113]
    for (const id of [K, B, A]) addTwin(rawDb, id)
    const fold = loadFold(rawDb)
    await runSteps(rawDb, K, [
      ['receive 3 each @09-01', async () => { for (const id of [K, B, A]) await receive(db, id, 3, '2026-09-01') }, { branch: 3 }],
      ['count the first twin 09-10 = 1', () => applyCount(db, A, [['2026-09-10', 1]]), { branch: 3 }],
      ['fold it into the second twin', () => fold(B, A, 'merge'), { branch: 3 }],
      ['fold the second twin into the keeper', () => fold(K, B, 'merge'), { branch: 7, lots: '2026-09-01=7' }],
      // The first twin's drain of 2 goes back on the keeper's 09-01 lot (7 + 2);
      // the count's own +1 is a receipt dated 09-10.
      ['keeper count 09-10 = 10', () => applyCount(db, K, [['2026-09-10', 10]]), { branch: 10, lotSum: 10, lots: '2026-09-01=9 2026-09-10=1' }],
      ['re-applied', () => applyCount(db, K, [['2026-09-10', 10]]), { branch: 10, lotSum: 10 }],
    ], [A, B])
  })

  await test('E1, keeper with only untracked stock, twin written off: the reversal has no keeper lot to land on, so it stays untracked -- never on the twin, lots never above branch', async () => {
    const { rawDb, db } = freshDb()
    const K = 114
    const D = 115
    addTwin(rawDb, K)
    addTwin(rawDb, D)
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@p, 1, 5)').run({ p: K })
    rawDb.prepare('UPDATE products SET stock_quantity = 5 WHERE id = @p').run({ p: K })
    const fold = loadFold(rawDb)
    await receive(db, D, 6, '2026-09-01')
    await applyCount(db, D, [['2026-09-10', 2]])
    await fold(K, D, 'write_off')
    await applyCount(db, K, [['2026-09-10', 9]])
    const keeper = ledger(rawDb, K)
    assert.deepStrictEqual({ branch: keeper.branch, lotSum: keeper.lotSum }, { branch: 9, lotSum: 0 }, `keeper [${keeper.lots}]`)
    assert.strictEqual(keeper.product, keeper.branchSum, 'keeper rollup')
    assertParity(rawDb, D, 'twin')
    assert.strictEqual(ledger(rawDb, D).lotSum, 0, 'twin holds nothing')
  })

  // FX-stock4 N1 (R-stock3, pre-existing in production): a count that took
  // from more than one lot carries no batch_id (0084), only its per-lot
  // takes (dated_stock_count_batch_actions). Reverting it from the ledger put
  // the units back on branch_stock alone: receive 4 and 8, count to 0,
  // revert -> branch 12, lots 0. Each lot must get back what the count took.
  const revert = (db, rawDb, movementId) => applyMovementRevert(db,
    rawDb.prepare('SELECT * FROM inventory_movements WHERE id = @id').get({ id: movementId }), { userId: 1, userName: 'Admin' })
  const countRow = (rawDb, productId, date) => rawDb.prepare(`SELECT id, batch_id AS batchId FROM inventory_movements
    WHERE product_id = @p AND reason = 'Dated stock count import' AND substr(created_at, 1, 10) = @d ORDER BY id DESC LIMIT 1`).get({ p: productId, d: date })
  const revertRowOf = (rawDb, movementId) => rawDb.prepare('SELECT id FROM inventory_movements WHERE reference_id = @ref').get({ ref: `revert:${movementId}` }).id

  await test('N1: receive 4 and 8, count to 0 (one movement over two lots, no batch_id), revert: branch 12, lots 4 / 8 (production: lots 0); reverted again: refused, nothing moves; the revert reverted: 0 / 0', async () => {
    const { rawDb, db } = freshDb()
    const P = 120
    addProduct(rawDb, P)
    let count = null
    await runSteps(rawDb, P, [
      ['receive 4 @09-01', () => receive(db, P, 4, '2026-09-01'), { branch: 4 }],
      ['receive 8 @09-05', () => receive(db, P, 8, '2026-09-05'), { branch: 12, lots: '2026-09-01=4 2026-09-05=8' }],
      ['count 09-20 = 0', async () => { await applyCount(db, P, [['2026-09-20', 0]]); count = countRow(rawDb, P, '2026-09-20') }, { branch: 0, lotSum: 0 }],
      ['revert the count', () => revert(db, rawDb, count.id), { ok: true, branch: 12, lots: '2026-09-01=4 2026-09-05=8' }],
      ['revert it again: refused', () => revert(db, rawDb, count.id), { ok: false, code: 'already_reverted', branch: 12, lots: '2026-09-01=4 2026-09-05=8' }],
      ['revert the revert', () => revert(db, rawDb, revertRowOf(rawDb, count.id)), { ok: true, branch: 0, lotSum: 0 }],
      ['that one again: refused', () => revert(db, rawDb, revertRowOf(rawDb, count.id)), { ok: false, code: 'already_reverted', branch: 0, lotSum: 0 }],
    ])
    assert.strictEqual(count.batchId, null, 'the count movement carries no batch_id (the N1 path)')
  })

  await test('N1: the count reverted, then re-applied, re-applied again, corrected, sold out: parity every step', async () => {
    const { rawDb, db } = freshDb()
    const P = 121
    addProduct(rawDb, P)
    await runSteps(rawDb, P, [
      ['receive 4 @09-01', () => receive(db, P, 4, '2026-09-01'), { branch: 4 }],
      ['receive 8 @09-05', () => receive(db, P, 8, '2026-09-05'), { branch: 12 }],
      ['count 09-20 = 0', () => applyCount(db, P, [['2026-09-20', 0]]), { branch: 0, lotSum: 0 }],
      ['revert the count', () => revert(db, rawDb, countRow(rawDb, P, '2026-09-20').id), { ok: true, branch: 12, lotSum: 12 }],
      ['count 09-20 = 0 re-applied', () => applyCount(db, P, [['2026-09-20', 0]]), { branch: 0, lotSum: 0 }],
      ['re-applied again', () => applyCount(db, P, [['2026-09-20', 0]]), { branch: 0, lotSum: 0 }],
      ['corrected 09-20 = 5', () => applyCount(db, P, [['2026-09-20', 5]]), { branch: 5, lotSum: 5 }],
      ['sell 5', () => sell(db, rawDb, P, 5), { branch: 0, lotSum: 0 }],
      ['sale 1 refused, the till shows none either', () => sell(db, rawDb, P, 1), { ok: false, available: 0, lotTotal: 0 }],
    ])
  })

  await test('N1: the count left 2 behind and a sale took them before the revert: each lot gets back exactly what the count took (4 and 6), not what it holds now', async () => {
    const { rawDb, db } = freshDb()
    const P = 122
    addProduct(rawDb, P)
    await runSteps(rawDb, P, [
      ['receive 4 @09-01', () => receive(db, P, 4, '2026-09-01'), { branch: 4 }],
      ['receive 8 @09-05', () => receive(db, P, 8, '2026-09-05'), { branch: 12 }],
      ['count 09-20 = 2 (takes 4 and 6)', () => applyCount(db, P, [['2026-09-20', 2]]), { branch: 2, lotSum: 2 }],
      ['sell 2', () => sell(db, rawDb, P, 2), { branch: 0, lotSum: 0 }],
      ['revert the count', () => revert(db, rawDb, countRow(rawDb, P, '2026-09-20').id), { ok: true, branch: 10, lots: '2026-09-01=4 2026-09-05=6' }],
      ['sell 10', () => sell(db, rawDb, P, 10), { branch: 0, lotSum: 0 }],
    ])
  })

  await test('N1: the count also took untracked stock (more than its one lot held, so still no batch_id): the lot gets its 4 back, the untracked 3 stay branch-only, lots never above branch; reverted back: 0 / 0', async () => {
    const { rawDb, db } = freshDb()
    const P = 123
    addProduct(rawDb, P)
    rawDb.prepare('INSERT INTO branch_stock (product_id, branch_id, quantity) VALUES (@p, 1, 3)').run({ p: P })
    rawDb.prepare('UPDATE products SET stock_quantity = 3 WHERE id = @p').run({ p: P })
    await receive(db, P, 4, '2026-09-01')
    await applyCount(db, P, [['2026-09-20', 0]])
    const count = countRow(rawDb, P, '2026-09-20')
    assert.strictEqual(count.batchId, null, 'a lot that covered only part carries no batch_id')
    const check = (label, expected) => {
      const s = ledger(rawDb, P)
      assert.deepStrictEqual({ branch: s.branch, lots: s.lots }, expected, `${label}: ${JSON.stringify({ branch: s.branch, lots: s.lots })}`)
      assert.strictEqual(s.product, s.branchSum, `${label}: rollup`)
      assert.ok(s.lotSum <= s.branch, `${label}: lots ${s.lotSum} above branch ${s.branch}`)
    }
    check('counted', { branch: 0, lots: '2026-09-01=0' })
    const reverted = await revert(db, rawDb, count.id)
    assert.strictEqual(reverted.ok, true, JSON.stringify(reverted))
    assert.strictEqual(reverted.usedBatchId, null, 'the counter-movement is not stamped with a lot that covered only part')
    check('reverted', { branch: 7, lots: '2026-09-01=4' })
    const back = await revert(db, rawDb, revertRowOf(rawDb, count.id))
    assert.strictEqual(back.ok, true, JSON.stringify(back))
    check('revert reverted', { branch: 0, lots: '2026-09-01=0' })
  })

  await test('N1 after a merge: a count drained two of a twin\'s lots, the twin was folded into a keeper holding those lot keys; reverting the count is refused and nothing moves on either product', async () => {
    const { rawDb, db } = freshDb()
    const K = 124
    const D = 125
    addTwin(rawDb, K)
    addTwin(rawDb, D)
    const fold = loadFold(rawDb)
    let count = null
    await runSteps(rawDb, K, [
      ['receive keeper 1 @09-01 and 1 @09-05', async () => { await receive(db, K, 1, '2026-09-01'); await receive(db, K, 1, '2026-09-05') }, { branch: 2 }],
      ['receive twin 4 @09-01 and 8 @09-05', async () => { await receive(db, D, 4, '2026-09-01'); await receive(db, D, 8, '2026-09-05') }, { branch: 2 }],
      ['count twin 09-20 = 0', async () => { await applyCount(db, D, [['2026-09-20', 0]]); count = countRow(rawDb, D, '2026-09-20') }, { branch: 2 }],
      ['fold the twin into the keeper', () => fold(K, D, 'merge'), { branch: 2, lots: '2026-09-01=1 2026-09-05=1' }],
      ['revert the count (now the keeper\'s): refused', () => revert(db, rawDb, count.id), { ok: false, status: 400, branch: 2, lots: '2026-09-01=1 2026-09-05=1' }],
    ], [D])
  })

  await test('N1 after a merge that repointed the twin\'s lots (the keeper had no lot with those keys): the revert puts 4 / 8 back on those lots, now the keeper\'s', async () => {
    const { rawDb, db } = freshDb()
    const K = 126
    const D = 127
    addTwin(rawDb, K)
    addTwin(rawDb, D)
    const fold = loadFold(rawDb)
    let count = null
    await runSteps(rawDb, K, [
      ['receive keeper 1 @09-03', () => receive(db, K, 1, '2026-09-03'), { branch: 1 }],
      ['receive twin 4 @09-01 and 8 @09-05', async () => { await receive(db, D, 4, '2026-09-01'); await receive(db, D, 8, '2026-09-05') }, { branch: 1 }],
      ['count twin 09-20 = 0', async () => { await applyCount(db, D, [['2026-09-20', 0]]); count = countRow(rawDb, D, '2026-09-20') }, { branch: 1 }],
      ['fold the twin into the keeper', () => fold(K, D, 'merge'), { branch: 1, lotSum: 1 }],
      ['revert the count', () => revert(db, rawDb, count.id), { ok: true, branch: 13, lots: '2026-09-01=4 2026-09-03=1 2026-09-05=8' }],
      ['sell 13', () => sell(db, rawDb, K, 13), { branch: 0, lotSum: 0 }],
    ], [D])
  })

  // FX-stock4 X1 (R-stock3 test gap): the re-apply takes from the OLDEST lot
  // first, in both of its walks -- the drain of a lower count, and the
  // settlement of a lot a sale overdrew. No test pinned the settlement order,
  // so a newest-first settlement (R-stock3's settle-lifo mutant) passed
  // everything; the drain order was pinned only inside longer scenarios, so
  // it gets its own direct test too. The
  // lot quantities are compared with the inactive marks stripped: this pins
  // WHICH lot the units come off, not when an empty lot is hidden.
  const lotQuantities = (rawDb, productId) => ledger(rawDb, productId).lots.replace(/\(inactive\)/g, '')

  await test('X1: a corrected count drains the oldest lot first: receive 5 @08-01 and 5 @09-01, count 09-10 = 7, corrected to 4: lots 0 / 4 (newest-first: 4 / 0)', async () => {
    const { rawDb, db } = freshDb()
    const P = 130
    addProduct(rawDb, P)
    await runSteps(rawDb, P, [
      ['receive 5 @08-01', () => receive(db, P, 5, '2026-08-01'), { branch: 5 }],
      ['receive 5 @09-01', () => receive(db, P, 5, '2026-09-01'), { branch: 10 }],
      ['count 09-10 = 7', () => applyCount(db, P, [['2026-09-10', 7]]), { branch: 7, lotSum: 7 }],
      ['re-applied', () => applyCount(db, P, [['2026-09-10', 7]]), { branch: 7, lotSum: 7 }],
      ['corrected 09-10 = 4', () => applyCount(db, P, [['2026-09-10', 4]]), { branch: 4, lotSum: 4 }],
    ])
    assert.strictEqual(lotQuantities(rawDb, P), '2026-08-01=0 2026-09-01=4', 'the drain walked oldest first')
  })

  await test('X1: a corrected count settles an overdrawn lot from the oldest lot first: receipt 7 @08-01, count 08-16 = 10, sale 9, receipts 4 @08-10 and 4 @09-01, corrected 08-16 = 3: lots 0 / 0 / 0 / 3 (newest-first: 0 / 1 / 0 / 2)', async () => {
    const { rawDb, db } = freshDb()
    const P = 131
    addProduct(rawDb, P)
    await runSteps(rawDb, P, [
      ['receipt 7 @08-01', () => receive(db, P, 7, '2026-08-01'), { branch: 7 }],
      ['count 08-16 = 10 (+3 on its own lot)', () => applyCount(db, P, [['2026-08-16', 10]]), { branch: 10, lots: '2026-08-01=7 2026-08-16=3' }],
      ['FIFO sale 9 (7 + 2 of the count lot)', () => sell(db, rawDb, P, 9), { branch: 1, lotSum: 1 }],
      ['receipt 4 @08-10', () => receive(db, P, 4, '2026-08-10'), { branch: 5 }],
      ['receipt 4 @09-01', () => receive(db, P, 4, '2026-09-01'), { branch: 9 }],
      // Reversing the count's +3 leaves its lot owing 2 (the sale took 2 of
      // them); the -3 to reach 3 drains the 08-10 lot to 1, and the 2 owed
      // are settled from the oldest lot that still holds any: 08-10's last
      // 1, then 1 from 09-01.
      ['corrected 08-16 = 3', () => applyCount(db, P, [['2026-08-16', 3]]), { branch: 3, lotSum: 3 }],
    ])
    assert.strictEqual(lotQuantities(rawDb, P), '2026-08-01=0 2026-08-10=0 2026-08-16=0 2026-09-01=3', 'the settlement walked oldest first')
  })

  await test('seeded random walk: receipts, FIFO sales, counts, re-applies, corrections, soft-deletes and reverts keep lots == branch at every step', async () => {
    const { rawDb, db } = freshDb()
    const SEQUENCES = 120
    const OPS = 14
    const DATES = ['2026-08-01', '2026-08-10', '2026-08-16', '2026-08-20', '2026-09-01']
    let steps = 0
    let batchLessReverts = 0
    let chainReverts = 0
    for (let seq = 0; seq < SEQUENCES; seq += 1) {
      let state = 0x9e3779b9 ^ (seq * 2654435761)
      const rnd = () => {
        state |= 0; state = (state + 0x6D2B79F5) | 0
        let t = Math.imul(state ^ (state >>> 15), 1 | state)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
      const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
      const P = 1000 + seq
      addProduct(rawDb, P)
      let lastFile = null
      const trace = []
      for (let op = 0; op < OPS; op += 1) {
        const r = rnd()
        let expectBranch = null
        if (r < 0.2) {
          const date = DATES[int(0, DATES.length - 1)]
          const quantity = int(1, 6)
          await receive(db, P, quantity, date)
          trace.push(`receive ${quantity}@${date.slice(5)}`)
        } else if (r < 0.42) {
          const branch = branchQty(rawDb, P)
          if (branch > 0) {
            const quantity = int(1, branch)
            await sell(db, rawDb, P, quantity)
            trace.push(`sell ${quantity}`)
          }
        } else if (r < 0.62) {
          const first = int(0, DATES.length - 1)
          const second = int(0, DATES.length - 1)
          lastFile = [[DATES[first], int(0, 12)]]
          if (second !== first && rnd() < 0.5) lastFile.push([DATES[second], int(0, 12)])
          await applyCount(db, P, lastFile)
          expectBranch = latestCount(lastFile)
          trace.push(`count ${lastFile.map(([d, n]) => `${d.slice(5)}=${n}`).join(',')}`)
        } else if (r < 0.77 && lastFile) {
          await applyCount(db, P, lastFile)
          expectBranch = latestCount(lastFile)
          trace.push('re-apply')
        } else if (r < 0.87 && lastFile) {
          lastFile = lastFile.map(([date, count]) => [date, Math.max(0, count + int(-4, 4))])
          await applyCount(db, P, lastFile)
          expectBranch = latestCount(lastFile)
          trace.push(`corrected ${lastFile.map(([d, n]) => `${d.slice(5)}=${n}`).join(',')}`)
        } else if (r < 0.93) {
          const empty = rawDb.prepare(`SELECT pb.id FROM product_batches pb WHERE pb.variant_product_id = @p AND pb.is_active = 1
            AND NOT EXISTS (SELECT 1 FROM branch_batch_stock b WHERE b.batch_id = pb.id AND b.quantity > 0) ORDER BY pb.id LIMIT 1`).get({ p: P })
          if (empty) {
            rawDb.prepare('UPDATE product_batches SET is_active = 0 WHERE id = @id').run({ id: empty.id })
            trace.push(`soft-delete empty lot ${empty.id}`)
          }
        } else {
          // Ledger revert of a count movement -- one lot covered (the lot is
          // stamped on the row) or, FX-stock4 N1, several lots did (only its
          // provenance names them) -- or of the latest such revert, at any
          // depth: every Revert in a chain moves the root's own lot shares.
          // Refusals are fine.
          const chain = r >= 0.965
          const row = chain
            ? rawDb.prepare(`SELECT * FROM inventory_movements m WHERE m.product_id = @p AND m.reference_id LIKE 'revert:%'
                AND NOT EXISTS (SELECT 1 FROM inventory_movements r WHERE r.reference_id = 'revert:' || m.id)
                ORDER BY m.id DESC LIMIT 1`).get({ p: P })
            : rawDb.prepare(`SELECT * FROM inventory_movements m WHERE m.product_id = @p AND m.reason = 'Dated stock count import'
                AND NOT EXISTS (SELECT 1 FROM inventory_movements r WHERE r.reference_id = 'revert:' || m.id)
                ORDER BY m.id DESC LIMIT 1`).get({ p: P })
          if (row) {
            const result = await applyMovementRevert(db, row, { userId: 1, userName: 'Admin' })
            if (result.ok && chain) chainReverts += 1
            if (result.ok && !chain && row.batch_id == null) batchLessReverts += 1
            trace.push(`${chain ? 'revert the revert' : 'revert'} #${row.id}${row.batch_id == null ? ' (no lot stamp)' : ''} ${result.ok ? 'ok' : 'refused'}`)
          }
        }
        steps += 1
        const s = assertParity(rawDb, P, `walk ${seq} step ${op} after [${trace.join('; ')}]`)
        if (expectBranch != null) {
          assert.strictEqual(s.branch, expectBranch, `walk ${seq} step ${op}: stock ${s.branch} is not the count ${expectBranch} after [${trace.join('; ')}] [${s.lots}]`)
        }
      }
    }
    console.log(`  (${SEQUENCES} walks, ${steps} steps, ${batchLessReverts} batch-less count reverts, ${chainReverts} reverts of reverts)`)
    assert.ok(batchLessReverts > 0 && chainReverts > 0, 'the walk must exercise both revert kinds')
  })

  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exitCode = failed ? 1 : 0
}

main()
