import assert from 'node:assert/strict'
import { mergeSameDetailRows } from '../src/utils/productGrouping.ts'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('mergeSameDetailRows returns an empty array for empty/invalid input', () => {
  assert.deepEqual(mergeSameDetailRows([]), [])
  assert.deepEqual(mergeSameDetailRows(undefined), [])
  // Runtime guard also covers non-array truthy input (e.g. a bad API payload).
  assert.deepEqual(mergeSameDetailRows(null as unknown as undefined), [])
})

await runTest('mergeSameDetailRows leaves a single row untouched aside from merge bookkeeping', () => {
  const rows = mergeSameDetailRows([
    { id: 1, name: 'Eros Eau de Parfum 200ml', selling_price_usd: 115, stock_quantity: 2 },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 1)
  assert.equal(rows[0].stock_quantity, 2)
  assert.deepEqual(rows[0].__mergedProductIds, [1])
  assert.equal(rows[0].__mergedRowCount, 1)
})

await runTest('mergeSameDetailRows collapses branch-only duplicates into one row', () => {
  const rows = mergeSameDetailRows([
    { id: 5, name: 'Rose Body Mist', barcode: 'RBM-100', selling_price_usd: 12, stock_quantity: 3, branch_stock: [{ branch_id: 1, branch_name: 'Main', quantity: 3 }] },
    { id: 7, name: 'Rose Body Mist', barcode: 'RBM-100', selling_price_usd: 12, stock_quantity: 4, branch_stock: [{ branch_id: 2, branch_name: 'Mall', quantity: 4 }] },
  ])

  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 5, 'keeps the lowest id as the display row')
  assert.equal(rows[0].stock_quantity, 7, 'combines stock across branches')
  assert.deepEqual(rows[0].__mergedProductIds, [5, 7])
  assert.equal(rows[0].__mergedRowCount, 2)
  assert.deepEqual(
    (rows[0].branch_stock as Array<{ branch_id: unknown; quantity: number }>).map((entry) => [entry.branch_id, entry.quantity]),
    [[1, 3], [2, 4]],
  )
})

await runTest('mergeSameDetailRows combines branch_stock quantities for the same branch across rows', () => {
  const rows = mergeSameDetailRows([
    { id: 1, name: 'Duplicate Import', selling_price_usd: 9, branch_stock: [{ branch_id: 1, branch_name: 'Main', quantity: 2 }] },
    { id: 2, name: 'Duplicate Import', selling_price_usd: 9, branch_stock: [{ branch_id: 1, quantity: 5 }] },
  ])

  assert.equal(rows.length, 1)
  assert.equal(rows[0].stock_quantity, 7)
  assert.deepEqual(rows[0].branch_stock, [{ branch_id: 1, branch_name: 'Main', quantity: 7 }])
})

await runTest('mergeSameDetailRows keeps rows separate when a DETAIL differs (barcode)', () => {
  const rows = mergeSameDetailRows([
    { id: 1, name: 'Gloss Nude', barcode: '111', stock_quantity: 1 },
    { id: 2, name: 'Gloss Nude', barcode: '222', stock_quantity: 1 },
  ])
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((row) => row.id), [1, 2])
  assert.deepEqual(rows.map((row) => row.__mergedRowCount), [1, 1])
})

await runTest('mergeSameDetailRows MERGES a cost difference and averages the distinct costs', () => {
  // Cost stopped being a detail on Sep 4 2026 (user ruling). One article
  // bought twice at two prices is one row, not two, and the merged row
  // carries the mean of the distinct costs.
  const rows = mergeSameDetailRows([
    { id: 1, name: 'Gloss Nude', cost_price_usd: 4, stock_quantity: 1 },
    { id: 2, name: 'Gloss Nude', cost_price_usd: 5, stock_quantity: 1 },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].__mergedRowCount, 2)
  assert.equal(rows[0].cost_price_usd, 4.5, 'the merged cost is the mean of the distinct costs')
  assert.equal(rows[0].stock_quantity, 2, 'and their stock adds up, because they are one row now')
})

await runTest('mergeSameDetailRows MERGES a selling/wholesale price difference and keeps the highest', () => {
  // Selling and wholesale price are what we plan to charge, adjustable for
  // sales/POS -- not what the item is. Two rows for one article at two
  // hoped-for prices are one product, and the merged row must never show a
  // price below what one of the merged rows expected to charge.
  //
  // The discounted tier is wholesale_price_* since migration 0111; while this
  // rule still named the retired special_price_* pair the grouped row silently
  // showed the FIRST child row's wholesale price instead of the highest.
  const rows = mergeSameDetailRows([
    { id: 1, name: 'Gloss Nude', selling_price_usd: 8, wholesale_price_usd: 7.5, stock_quantity: 1 },
    { id: 2, name: 'Gloss Nude', selling_price_usd: 9, wholesale_price_usd: 6.0, stock_quantity: 1 },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].__mergedRowCount, 2)
  assert.equal(rows[0].selling_price_usd, 9, 'highest selling price wins')
  assert.equal(rows[0].wholesale_price_usd, 7.5, 'each price field resolves independently to its own highest')
})

await runTest('mergeSameDetailRows ignores id/created_at/updated_at/client_request_id/image_gallery when comparing rows', () => {
  const rows = mergeSameDetailRows([
    { id: 10, name: 'Serum', selling_price_usd: 20, created_at: '2026-01-01', updated_at: '2026-01-01', client_request_id: 'req-a', image_gallery: ['a.jpg'] },
    { id: 11, name: 'Serum', selling_price_usd: 20, created_at: '2026-02-02', updated_at: '2026-02-05', client_request_id: 'req-b', image_gallery: ['b.jpg', 'c.jpg'] },
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].__mergedProductIds, [10, 11])
})

await runTest('mergeSameDetailRows sorts merged cluster members by id and keeps first-seen cluster order', () => {
  const rows = mergeSameDetailRows([
    { id: 30, name: 'Alpha', selling_price_usd: 1 },
    { id: 20, name: 'Beta', selling_price_usd: 2 },
    { id: 10, name: 'Alpha', selling_price_usd: 1 },
  ])
  // Alpha cluster first-seen at row 0 (id 30); Beta second. Within the Alpha
  // cluster, the lead row is the lowest id (10), even though 30 arrived
  // first in the source list.
  assert.deepEqual(rows.map((row) => row.name), ['Alpha', 'Beta'])
  assert.equal(rows[0].id, 10)
  assert.deepEqual(rows[0].__mergedProductIds, [10, 30])
})

await runTest('mergeSameDetailRows falls back to summing stock_quantity when no branch_stock entries exist', () => {
  const rows = mergeSameDetailRows([
    { id: 1, name: 'No Branch Data', selling_price_usd: 5, stock_quantity: 2 },
    { id: 2, name: 'No Branch Data', selling_price_usd: 5, stock_quantity: 3 },
  ])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].stock_quantity, 5)
  assert.deepEqual(rows[0].branch_stock, [])
})

if (failed > 0) {
  process.exitCode = 1
}
