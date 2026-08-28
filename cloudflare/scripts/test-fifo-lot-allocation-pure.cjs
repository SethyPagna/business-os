// Z0: sales that don't explicitly pick a lot are auto-allocated across the
// product's active lots at the branch, OLDEST received first, so a later
// return/cancel can restore stock to the SAME lots (see saleTransitions.ts
// and routes/returns.ts). This pins the two building blocks:
//   - allocateAcrossLots: pure split of a quantity across ordered lots,
//     clamped to each lot's availability, reporting any uncovered remainder.
//   - readFifoLotAvailability: the real SQL ordering (received_at ASC, NULL
//     dates last) against a real in-memory DB + the real migration chain.
//
// Run (from cloudflare/): node scripts/test-fifo-lot-allocation-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

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
  async batch(items) {
    const results = []
    for (const item of items) { const r = rawDb.prepare(item.sql).run(item.params || {}); results.push({ changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }) }
    return results
  },
}

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
  Module._load = originalLoad
  return moduleObj.exports
}

const batchCode = loadReal('lib/batchCode.ts')
const productBatches = loadReal('lib/productBatches.ts', { './db': { getDb: () => db }, './batchCode': batchCode, './sqlBinding': loadReal('lib/sqlBinding.ts') })
const { allocateAcrossLots, readFifoLotAvailability } = productBatches

let passed = 0
function check(name, fn) {
  try { fn(); console.log('PASS', name); passed++ }
  catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1 }
}

// ---- allocateAcrossLots (pure) --------------------------------------------
check('one lot covers the whole line', () => {
  const { takes, uncovered } = allocateAcrossLots([{ batchId: 1, lotCode: 'A', expiryDate: null, available: 10 }], 4)
  assert.deepStrictEqual(takes, [{ batchId: 1, lotCode: 'A', expiryDate: null, quantity: 4 }])
  assert.strictEqual(uncovered, 0)
})

check('spills across lots in the given (FIFO) order', () => {
  const lots = [
    { batchId: 1, lotCode: 'old', expiryDate: null, available: 2 },
    { batchId: 2, lotCode: 'new', expiryDate: null, available: 5 },
  ]
  const { takes, uncovered } = allocateAcrossLots(lots, 4)
  assert.strictEqual(takes.length, 2)
  assert.deepStrictEqual(takes.map((t) => [t.batchId, t.quantity]), [[1, 2], [2, 2]], 'drains the oldest lot first')
  assert.strictEqual(uncovered, 0)
})

check('reports the remainder the lots cannot cover (legacy stock)', () => {
  const { takes, uncovered } = allocateAcrossLots([{ batchId: 1, lotCode: 'A', expiryDate: null, available: 3 }], 5)
  assert.strictEqual(takes.length, 1)
  assert.strictEqual(takes[0].quantity, 3)
  assert.strictEqual(uncovered, 2, 'two units are not attributable to any lot')
})

check('skips empty lots, never emits a zero take', () => {
  const lots = [
    { batchId: 1, lotCode: 'empty', expiryDate: null, available: 0 },
    { batchId: 2, lotCode: 'has', expiryDate: null, available: 3 },
  ]
  const { takes } = allocateAcrossLots(lots, 2)
  assert.deepStrictEqual(takes.map((t) => t.batchId), [2])
})

// ---- readFifoLotAvailability (real SQL + migrations) ----------------------
check('oldest received_at first, NULL received dates last, empty lots excluded', async () => {
  rawDb.prepare(`INSERT INTO products (id, name, is_active, stock_quantity) VALUES (500, 'FIFO Serum', 1, 0)`).run()
  // Three active lots + one empty + one undated, out of received order.
  const lots = [
    { id: 9001, lot: '08152026', received: '2026-08-15', qty: 4 },
    { id: 9002, lot: '08012026', received: '2026-08-01', qty: 3 }, // oldest
    { id: 9003, lot: '08202026', received: '2026-08-20', qty: 5 },
    { id: 9004, lot: 'EMPTY',    received: '2026-07-01', qty: 0 }, // excluded (no stock)
    { id: 9005, lot: 'NODATE',   received: null,         qty: 2 }, // last
  ]
  for (const l of lots) {
    rawDb.prepare(`INSERT INTO product_batches (id, variant_product_id, batch_key, lot_code, received_at, is_active, batch_number) VALUES (?, 500, ?, ?, ?, 1, ?)`).run([l.id, l.lot, l.lot, l.received, l.id])
    rawDb.prepare(`INSERT INTO branch_batch_stock (batch_id, branch_id, quantity) VALUES (?, 1, ?)`).run([l.id, l.qty])
  }
  const available = await readFifoLotAvailability(db, 500, 1)
  assert.deepStrictEqual(available.map((r) => r.batchId), [9002, 9001, 9003, 9005], 'oldest first, undated last, empty excluded')
  assert.deepStrictEqual(available.map((r) => r.available), [3, 4, 5, 2])
})

console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
