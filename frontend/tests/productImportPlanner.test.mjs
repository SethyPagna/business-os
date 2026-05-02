import assert from 'node:assert/strict'
import { analyzeProductImportRows, analyzeProductImportText } from '../src/components/products/productImportPlanner.mjs'

let failed = 0

async function runTest(name, fn) {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('same product name and same non-stock details plans stock merge', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Serum', sku: 'S-1', selling_price_usd: '12.345', stock_quantity: '3' },
  ], [
    { id: 10, name: 'Serum', sku: 'S-1', selling_price_usd: 12.35, stock_quantity: 1 },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'merge_stock')
  assert.equal(analysis.rows[0]._target_product_id, 10)
  assert.equal(analysis.summary.mergeCount, 1)
})

await runTest('same product name and different details plans variant creation', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Serum', sku: 'S-2', selling_price_usd: '15', supplier: 'Supplier B', stock_quantity: '2' },
  ], [
    { id: 10, name: 'Serum', sku: 'S-1', selling_price_usd: 12, supplier: 'Supplier A', created_at: '2026-01-01' },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'create_variant')
  assert.equal(analysis.rows[0]._parent_id, 10)
  assert.equal(analysis.summary.variantCount, 1)
})

await runTest('same product name with only price changes plans stock merge', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Serum', sku: 'S-1', barcode: 'BC-1', selling_price_usd: '15', purchase_price_usd: '8', discount_percent: '10', stock_quantity: '2' },
  ], [
    { id: 10, name: 'Serum', sku: 'S-1', barcode: 'BC-1', selling_price_usd: 12, purchase_price_usd: 6, discount_percent: 0 },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'merge_stock')
  assert.equal(analysis.rows[0]._target_product_id, 10)
  assert.equal(analysis.summary.mergeCount, 1)
})

await runTest('malformed existing product rows do not crash import analysis', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Safe Cream', sku: 'SAFE-1', selling_price_usd: '8.001', stock_quantity: '2' },
  ], [
    null,
    { id: 20, name: 'Safe Cream', sku: 'SAFE-1', image_gallery: null, selling_price_usd: 8.01 },
    { id: 21, name: '', image_gallery: '{bad json' },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'merge_stock')
  assert.equal(analysis.rows[0]._target_product_id, 20)
})

await runTest('different product name with same SKU or barcode becomes editable identifier conflict', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Serum Travel', sku: 'S-1', barcode: 'BC-1', selling_price_usd: '8.001', stock_quantity: '2' },
  ], [
    { id: 20, name: 'Serum Full Size', sku: 'S-1', barcode: 'BC-1', selling_price_usd: 12.01 },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'new')
  assert.equal(analysis.rows[0]._identifier_conflict_mode, 'clear_imported')
  assert.equal(analysis.conflicts[0].conflictType, 'identifier')
  assert.deepEqual(analysis.conflicts[0].conflictFields, ['sku', 'barcode'])
})

await runTest('same product name with same barcode still exposes identifier handling', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Serum', barcode: 'BC-1', selling_price_usd: '15', supplier: 'Supplier B', stock_quantity: '2' },
  ], [
    { id: 20, name: 'Serum', barcode: 'BC-1', selling_price_usd: 12.01, supplier: 'Supplier A', created_at: '2026-01-01' },
  ])

  assert.equal(analysis.rows[0]._planned_action, 'create_variant')
  assert.equal(analysis.rows[0]._identifier_conflict_mode, 'clear_imported')
  assert.equal(analysis.conflicts[0].conflictType, 'same_name_identifier')
  assert.deepEqual(analysis.conflicts[0].conflictFields, ['barcode'])
})

await runTest('same-file duplicate barcode rows become review conflicts', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Serum A', barcode: '651986410538', selling_price_usd: '12', stock_quantity: '1' },
    { name: 'Serum B', barcode: '651986410538', selling_price_usd: '14', stock_quantity: '2' },
  ], [])

  assert.equal(analysis.conflicts.length, 2)
  assert.deepEqual(analysis.conflicts.map((entry) => entry.conflictFields), [['barcode'], ['barcode']])
  assert.deepEqual(analysis.conflicts[0].importDuplicateRows.barcode, [0, 1])
  assert.equal(analysis.rows[0]._identifier_conflict_mode, 'clear_imported')
  assert.equal(analysis.rows[1]._identifier_conflict_mode, 'clear_imported')
})

await runTest('missing product name rows stay visible as review issues', () => {
  const analysis = analyzeProductImportRows([
    { name: '', barcode: 'HAS-BARCODE', selling_price_usd: '12', stock_quantity: '1' },
    { name: 'Named Product', barcode: 'OK-1', selling_price_usd: '14', stock_quantity: '2' },
  ], [])

  assert.equal(analysis.rows.length, 2)
  assert.equal(analysis.rows[0]._planned_action, 'skip_row')
  assert.equal(analysis.conflicts[0].conflictType, 'missing_name')
  assert.deepEqual(analysis.conflicts[0].issueTypes, ['missing_name'])
  assert.equal(analysis.errors.length, 1)
})

await runTest('duplicate imported same-name rows avoid unsafe temporary row ids', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Cream', sku: 'C-1', selling_price_usd: '3.001', stock_quantity: '1' },
    { name: 'Cream', sku: 'C-1', selling_price_usd: '3.001', stock_quantity: '4' },
    { name: 'Cream', sku: 'C-2', selling_price_usd: '4.001', stock_quantity: '2' },
  ], [])

  assert.deepEqual(analysis.rows.map((row) => row._planned_action), ['new', 'merge_stock', 'create_variant'])
  assert.equal(analysis.rows.some((row) => String(row._parent_id || '').startsWith('row:')), false)
  assert.equal(analysis.rows.some((row) => String(row._target_product_id || '').startsWith('row:')), false)
})

await runTest('same imported name groups rows into detail subgroups for review', () => {
  const analysis = analyzeProductImportRows([
    { name: 'Cream', barcode: 'BC-1', brand: 'A', unit: 'pcs', selling_price_usd: '3.001', stock_quantity: '1' },
    { name: 'Cream', barcode: 'BC-1', brand: 'A', unit: 'pcs', selling_price_usd: '3.001', stock_quantity: '4' },
    { name: 'Cream', barcode: 'BC-2', brand: 'B', unit: 'pcs', selling_price_usd: '4.001', stock_quantity: '2' },
  ], [])

  const group = (analysis.groups || []).find((entry) => entry.key === 'cream')
  assert.ok(group, 'Expected same-name group in analysis')
  assert.equal(group.rowNumbers.length, 3)
  assert.equal(group.subgroups.length, 2)
  assert.deepEqual(group.subgroups.map((entry) => entry.rowIndexes).sort((a, b) => b.length - a.length), [[0, 1], [2]])
  assert.equal(group.subgroups[0].suggestedAction, 'merge_stock')
  assert.equal(group.subgroups.some((entry) => entry.suggestedAction === 'create_variant'), true)
})

await runTest('large product import analysis keeps deterministic row counts', () => {
  const rows = ['name,sku,selling_price_usd,stock_quantity']
  for (let index = 0; index < 10000; index += 1) {
    rows.push(`ផលិតផល ${index},SKU-${index},${index % 10}.123,${index % 7}`)
  }
  const analysis = analyzeProductImportText(rows.join('\n'), [])

  assert.equal(analysis.summary.total, 10000)
  assert.equal(analysis.rows.length, 10000)
  assert.equal(analysis.errors.length, 0)
})

if (failed > 0) {
  process.exitCode = 1
}
