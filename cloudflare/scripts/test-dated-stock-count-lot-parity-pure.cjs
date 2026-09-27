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
async function runSteps(rawDb, productId, steps) {
  for (const [label, action, expected] of steps) {
    const result = await action()
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
        // The count lot received 3 and the revert un-receives them: empty,
        // nothing received, so it leaves the pickers (planUnreceiveBatchStock).
      }, { branch: 7, lots: '2026-08-01=7 2026-08-16=0(inactive)' }],
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

  await test('seeded random walk: receipts, FIFO sales, counts, re-applies, corrections, soft-deletes and reverts keep lots == branch at every step', async () => {
    const { rawDb, db } = freshDb()
    const SEQUENCES = 120
    const OPS = 14
    const DATES = ['2026-08-01', '2026-08-10', '2026-08-16', '2026-08-20', '2026-09-01']
    let steps = 0
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
          // Ledger revert of a count movement that one lot covered (the lot
          // is stamped on the row). Refusals (units already sold) are fine.
          const row = rawDb.prepare(`SELECT * FROM inventory_movements m WHERE m.product_id = @p AND m.reason = 'Dated stock count import'
            AND m.batch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM inventory_movements r WHERE r.reference_id = 'revert:' || m.id)
            ORDER BY m.id DESC LIMIT 1`).get({ p: P })
          if (row) {
            const result = await applyMovementRevert(db, row, { userId: 1, userName: 'Admin' })
            trace.push(`revert #${row.id} ${result.ok ? 'ok' : 'refused'}`)
          }
        }
        steps += 1
        const s = assertParity(rawDb, P, `walk ${seq} step ${op} after [${trace.join('; ')}]`)
        if (expectBranch != null) {
          assert.strictEqual(s.branch, expectBranch, `walk ${seq} step ${op}: stock ${s.branch} is not the count ${expectBranch} after [${trace.join('; ')}] [${s.lots}]`)
        }
      }
    }
    console.log(`  (${SEQUENCES} walks, ${steps} steps)`)
  })

  console.log(`\n${passed} PASS, ${failed} FAIL`)
  process.exitCode = failed ? 1 : 0
}

main()
