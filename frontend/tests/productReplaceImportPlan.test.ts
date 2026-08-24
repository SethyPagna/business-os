import assert from 'node:assert/strict'
import { planProductReplaceImport } from '../src/components/products/import/productReplaceImportPlan.ts'

let failed = 0

async function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const existing = [
  { id: 1, name: 'Serum', sku: 'SER-1', barcode: '1111', selling_price_usd: 10, stock_quantity: 5 },
]

// ---- column_replace ----

await runTest('column_replace requires at least one column, else returns a blocking error and no rows', () => {
  const plan = planProductReplaceImport('column_replace', [{ name: 'Serum', sku: 'SER-1' }], existing, { columns: [] })
  assert.equal(plan.rows.length, 0)
  assert.ok(plan.errors.length > 0)
})

await runTest('column_replace: matched row becomes replace_columns scoped to the given columns', () => {
  // Same identity + signature as `existing` (sku/barcode/price all equal)
  // -- General mode's own matcher would call this "merge_stock" (the
  // exact same item, just restock it); Replace mode is what turns that
  // match into an overwrite instead, so the row still needs to actually
  // match for this to test the right thing.
  const plan = planProductReplaceImport(
    'column_replace',
    [{ name: 'Serum', sku: 'SER-1', barcode: '1111', selling_price_usd: 10 }],
    existing,
    { columns: ['selling_price_usd'] },
  )
  assert.equal(plan.rows.length, 1)
  assert.equal(plan.rows[0].plannedAction, 'replace_columns')
  assert.equal(plan.rows[0].targetProductId, 1)
  assert.deepEqual(plan.rows[0].replaceColumns, ['selling_price_usd'])
  assert.equal(plan.summary.replaceCount, 1)
  assert.equal(plan.summary.createCount, 0)
})

// ---- full_row_replace ----

await runTest('full_row_replace: matched row becomes replace_row with no column scope (whole row)', () => {
  const plan = planProductReplaceImport(
    'full_row_replace',
    [{ name: 'Serum', sku: 'SER-1', barcode: '1111', selling_price_usd: 10 }],
    existing,
  )
  assert.equal(plan.rows[0].plannedAction, 'replace_row')
  assert.equal(plan.rows[0].targetProductId, 1)
  assert.deepEqual(plan.rows[0].replaceColumns, [])
})

await runTest('full_row_replace: unmatched row still creates, Replace mode is not "matched rows only"', () => {
  const plan = planProductReplaceImport(
    'full_row_replace',
    [{ name: 'Brand New Thing', sku: 'BNT-1', barcode: '9999' }],
    existing,
  )
  assert.equal(plan.rows[0].plannedAction, 'new')
  assert.equal(plan.rows[0].targetProductId, null)
  assert.equal(plan.summary.createCount, 1)
  assert.equal(plan.summary.replaceCount, 0)
})

await runTest('full_row_replace: a row missing a name is still skipped, same blocking rule as General mode', () => {
  const plan = planProductReplaceImport('full_row_replace', [{ sku: 'NO-NAME' }], existing)
  assert.equal(plan.rows[0].plannedAction, 'skip_row')
  assert.equal(plan.summary.skipCount, 1)
})

// ---- full_wipe_reimport ----

await runTest('full_wipe_reimport: every existing product id is flagged for deletion', () => {
  const twoExisting = [...existing, { id: 2, name: 'Toner', sku: 'TON-1', barcode: '2222' }]
  const plan = planProductReplaceImport('full_wipe_reimport', [{ name: 'Serum', sku: 'SER-1' }], twoExisting)
  assert.deepEqual(plan.deleteAllExistingProductIds.slice().sort(), [1, 2])
  assert.equal(plan.summary.deletedExistingCount, 2)
})

await runTest('full_wipe_reimport: every row creates fresh, even one that would otherwise match an existing product', () => {
  const plan = planProductReplaceImport(
    'full_wipe_reimport',
    [{ name: 'Serum', sku: 'SER-1', barcode: '1111' }],
    existing,
  )
  assert.equal(plan.rows[0].plannedAction, 'new')
  assert.equal(plan.rows[0].targetProductId, null)
  assert.equal(plan.summary.createCount, 1)
  assert.equal(plan.summary.replaceCount, 0)
})

await runTest('full_wipe_reimport: two rows with the same name in the file still become a variant pair, not both "new" merged', () => {
  const plan = planProductReplaceImport(
    'full_wipe_reimport',
    [
      { name: 'Serum', sku: 'SER-A', barcode: '1111', category: 'skin' },
      { name: 'Serum', sku: 'SER-B', barcode: '2222', category: 'hair' },
    ],
    existing,
  )
  assert.equal(plan.rows[0].plannedAction, 'new')
  assert.equal(plan.rows[1].plannedAction, 'create_variant')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All tests passed')
}
