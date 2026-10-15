const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')
// Receipts that share a sale moment must get distinct, deterministic receipt numbers when they commit concurrently.
//
// Old-system exports carry date-only sale dates, so every receipt of a day mints from the same second (00:00:00). The
// import commits 12 receipts at a time. Each one probed for the first free candidate BEFORE any sibling had written,
// so all twelve picked the same number; one batch won, the other eleven lost the in-batch uniqueness guard and
// re-minted -- all to the same next candidate again. A round settled one receipt, the retry limit (3) ran out, and
// the job failed with "Sale on row N lost its receipt number ... to another sale saved at the same moment".
//
// The window now plans the numbers up front: one read of what the stamps already hold, then the k-th receipt of a
// moment takes the k-th free slot (bare, -2, -3, ...). That is unique by construction, independent of the order the
// concurrent batches land in, and identical when the same receipts are replayed after a cut.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const moduleCache = new Map()
function load(rel) {
  if (moduleCache.has(rel)) return moduleCache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  moduleCache.set(rel, mod)
  const localRequire = (request) => {
    if (request === './db') return {}
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const commit = load('lib/salesImportCommit.ts')
const { applyHistoricalSaleImport } = commit
const ACTOR = { id: 41, username: 'importer', name: 'Importer' }
const NOW = '2026-10-14T08:00:00.000Z'
const CONCURRENCY = 12

function fixture() {
  const db = openDb(loadAll())
assert.throws(() => db.prepare("INSERT INTO products(name) VALUES('unadmitted guard control')").run(), /stock_transaction_required/)
  db.prepare("INSERT INTO branches(id,name,is_default,is_active) VALUES(1,'Shop',1,1)").run()
  seedStockFixture(db, () => db.prepare("INSERT INTO products(id,name,sku,stock_quantity,cost_price_usd,is_active) VALUES(10,'Widget','SKU-1',500,3,1)").run())
  seedStockFixture(db, () => db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(10,1,500)').run())
  const route = {
    prepare(sql) {
      const statement = db.prepare(sql)
      return { all: (params) => statement.all(params), get: (params) => statement.get(params), run: async (params) => statement.run(params) }
    },
    batchOnce(statements) { return this.batch(statements) },
    batch: async (statements) => db.batch(statements),
  }
  return { raw: db, route }
}

function saleData(overrides = {}) {
  return {
    receipt_number: null, cashier_id: null, cashier_name: 'Admin', branch_id: 1, branch_name: 'Shop',
    customer_id: null, customer_name: 'Dara', customer_phone: '012345678', customer_address: null,
    payment_method: 'Cash', payment_currency: 'USD', exchange_rate: 4100, notes: null,
    subtotal_usd: 10, subtotal_khr: 41000, discount_usd: 0, discount_khr: 0, tax_usd: 0, tax_khr: 0,
    total_usd: 10, total_khr: 41000, amount_paid_usd: 10, amount_paid_khr: 0, change_usd: 0, change_khr: 0,
    membership_discount_usd: 0, membership_discount_khr: 0, membership_points_redeemed: 0,
    is_delivery: 0, delivery_contact_id: null, delivery_contact_name: null, delivery_contact_phone: null,
    delivery_contact_address: null, delivery_fee_usd: 0, delivery_fee_khr: 0, delivery_fee_paid_by: 'customer',
    sale_status: 'completed', created_at: '2026-08-31T17:00:00.000Z',
    items: [{
      product_id: 10, product_name: 'Widget', sku: 'SKU-1', quantity: 1,
      applied_price_usd: 10, applied_price_khr: 41000, total_usd: 10, total_khr: 41000,
      cost_price_usd: 3, cost_price_khr: 12300, base_price_usd: 10, base_price_khr: 41000,
      product_discount_type: null, product_discount_label: null, product_discount_usd: 0, product_discount_khr: 0,
      manual_discount_type: null, manual_discount_value: 0, manual_discount_usd: 0, manual_discount_khr: 0,
      branch_id: 1, batch_id: null, batch_label: null, batch_expiry_date: null, returned_quantity: 0,
    }],
    ...overrides,
  }
}

// What the engine does for a window: plan the numbers once, then commit CONCURRENCY receipts at a time. `only` limits
// which receipts get committed (a window cut by the call budget commits a subset of a plan made for all of them).
async function runWindow(f, receipts, { jobId = 'job-1', order = (block) => block, only = () => true } = {}) {
  const plan = commit.planHistoricalSaleReceiptNumbers
    ? await commit.planHistoricalSaleReceiptNumbers(f.route, jobId, receipts, NOW)
    : null
  const committing = receipts.filter(only)
  for (let offset = 0; offset < committing.length; offset += CONCURRENCY) {
    const block = order(committing.slice(offset, offset + CONCURRENCY))
    await Promise.all(block.map((receipt) => applyHistoricalSaleImport(f.route, {
      jobId, rowNumber: receipt.rowNumber, data: receipt.data, nowIso: NOW, actor: ACTOR,
      ...(plan ? { plannedReceiptNumber: plan.get(receipt.rowNumber) } : {}),
    })))
  }
}

const sameMoment = (count, firstRow = 2, overrides = {}) =>
  Array.from({ length: count }, (_, index) => ({ rowNumber: firstRow + index, data: saleData(overrides) }))

function numbersByRow(f, jobId = 'job-1') {
  return Object.fromEntries(f.raw.prepare('SELECT client_request_id, receipt_number FROM sales WHERE client_request_id LIKE @p ORDER BY id')
    .all({ p: `sales-import:${jobId}:%` })
    .map((row) => [Number(row.client_request_id.split(':').pop()), row.receipt_number]))
}

const expectedSequence = (count, firstRow = 2, base = '20260901-000000') =>
  Object.fromEntries(Array.from({ length: count }, (_, index) => [firstRow + index, index === 0 ? base : `${base}-${index + 1}`]))

const duplicates = (f) => f.raw.prepare('SELECT receipt_number, COUNT(*) AS n FROM sales GROUP BY receipt_number HAVING COUNT(*) > 1').all()

;(async () => {
  const failures = []
  async function scenario(id, run) {
    try { await run() } catch (error) {
      failures.push(id)
      if (process.env.DEBUG_STACK) console.log(error.stack)
      console.log(`FAIL scenario ${id}: ${String(error && error.message).split('\n').filter(Boolean).slice(0, 3).join(' | ')}`)
    }
  }

  // 1. The reported failure: more same-moment receipts than one concurrent window, committed together.
  await scenario(1, async () => {
    const f = fixture()
    await runWindow(f, sameMoment(30))
    assert.deepEqual(numbersByRow(f), expectedSequence(30), 'every receipt commits, in row order, under the next free number of its moment')
    assert.deepEqual(duplicates(f), [])
    console.log('PASS 30 receipts of one moment commit concurrently under 30 distinct, row-ordered numbers')
  })

  // 2. Determinism: the number does not depend on which concurrent batch lands first.
  await scenario(2, async () => {
    const forward = fixture()
    const backward = fixture()
    await runWindow(forward, sameMoment(14))
    await runWindow(backward, sameMoment(14), { order: (block) => [...block].reverse() })
    assert.deepEqual(numbersByRow(backward), numbersByRow(forward), 'reversing the order the batches are submitted in changes nothing')
    console.log('PASS the numbers are the same however the concurrent batches are ordered')
  })

  // 3. A cut leaves later receipts committed; the replay of the whole window must not move any number.
  await scenario(3, async () => {
    const f = fixture()
    const receipts = sameMoment(14)
    await runWindow(f, receipts, { only: (receipt) => receipt.rowNumber % 3 === 0 })
    const early = numbersByRow(f)
    await runWindow(f, receipts)
    assert.deepEqual(numbersByRow(f), expectedSequence(14), 'the replayed window ends with exactly the numbers an uncut run gives')
    for (const [row, number] of Object.entries(early)) assert.equal(numbersByRow(f)[row], number, `row ${row} keeps the number it committed under`)
    assert.deepEqual(duplicates(f), [])
    console.log('PASS replaying a window after some of its receipts committed keeps every number and completes the rest in order')
  })

  // 4. Another sale already holds some of the moment's numbers: the plan skips them, in order.
  await scenario(4, async () => {
    const f = fixture()
    for (const held of ['20260901-000000-2', '20260901-000000-4']) {
      f.raw.prepare(`INSERT INTO sales(receipt_number,client_request_id,branch_id,branch_name,cashier_name,payment_method,total_usd,sale_status)
                     VALUES(?, ?, 1,'Shop','Till','Cash',1,'completed')`).run([held, `till-${held}`])
    }
    await runWindow(f, sameMoment(5))
    assert.deepEqual(Object.values(numbersByRow(f)), ['20260901-000000', '20260901-000000-3', '20260901-000000-5', '20260901-000000-6', '20260901-000000-7'])
    assert.deepEqual(duplicates(f), [])
    console.log('PASS numbers held by other sales are skipped, still in row order')
  })

  // 5. Different moments never share a sequence, and a supplied business number keeps its own slot.
  await scenario(5, async () => {
    const f = fixture()
    const receipts = [
      { rowNumber: 2, data: saleData() },
      { rowNumber: 3, data: saleData({ created_at: '2026-08-31T17:00:01.000Z' }) },
      { rowNumber: 4, data: saleData() },
      { rowNumber: 5, data: saleData({ receipt_number: '20260901-000001' }) },
      { rowNumber: 6, data: saleData({ receipt_number: 'OLD-77@2026-09-01' }) },
    ]
    await runWindow(f, receipts)
    const numbers = numbersByRow(f)
    assert.equal(numbers[2], '20260901-000000')
    assert.equal(numbers[4], '20260901-000000-2')
    assert.equal(numbers[5], '20260901-000001', 'a free supplied business number is kept verbatim')
    assert.notEqual(numbers[3], numbers[5], 'a minted number never takes a number a sibling supplied')
    assert.match(numbers[6], /^20260901-0000\d\d(?:-\d+)?$/, 'a foreign label is replaced by a minted business number')
    assert.equal(new Set(Object.values(numbers)).size, 5)
    console.log('PASS distinct moments keep separate sequences and supplied numbers keep theirs')
  })

  // 6. The planner on its own: pure, ordered, bounded.
  await scenario(6, async () => {
    const { planBusinessDateTimeNumbers } = load('lib/receiptNumber.ts')
    assert.equal(typeof planBusinessDateTimeNumbers, 'function')
    const moment = new Date('2026-08-31T17:00:00.000Z')
    const plan = planBusinessDateTimeNumbers([1, 2, 3].map((key) => ({ key, moment })), new Set(['20260901-000000']))
    assert.deepEqual([...plan.values()], ['20260901-000000-2', '20260901-000000-3', '20260901-000000-4'])
    const wide = planBusinessDateTimeNumbers(Array.from({ length: 400 }, (_, key) => ({ key, moment })), new Set())
    assert.equal(new Set(wide.values()).size, 400)
    assert.ok([...wide.values()].every((value) => /^\d{8}-\d{6}(?:-[0-9A-Z]{1,4})?$/.test(value)), 'every planned number is a valid business receipt number')
    console.log('PASS the planner hands out the free slots of a moment in order, all of them valid receipt numbers')
  })

  if (failures.length) {
    console.error(`RED: scenario(s) ${failures.join(', ')} failed`)
    process.exit(1)
  }
})().catch((error) => { console.error(error); process.exit(1) })
