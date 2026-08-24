import assert from 'node:assert/strict'
import {
  groupAddSaleImportRows,
  resolveAddSaleCostPrices,
  resolveAddSaleProductMatches,
  type AddSaleImportRow,
  type ExistingProductForCostLookup,
  type ExistingProductForMatchLookup,
} from '../src/components/products/import/addSaleImportResolve.ts'

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

// ---- groupAddSaleImportRows ----

await runTest('rows sharing the same action label bundle into one group', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'Serum', action: 'sale1' },
    { name: 'Toner', action: 'sale1' },
    { name: 'Cleanser', action: 'sale2' },
  ]
  const groups = groupAddSaleImportRows(rows)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0], { actionLabel: 'sale1', rowIndexes: [0, 1] })
  assert.deepEqual(groups[1], { actionLabel: 'sale2', rowIndexes: [2] })
})

await runTest('rows with no action label each become their own singleton sale, never merged together', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'Serum' },
    { name: 'Toner' },
  ]
  const groups = groupAddSaleImportRows(rows)
  assert.equal(groups.length, 2)
  assert.deepEqual(groups[0], { actionLabel: null, rowIndexes: [0] })
  assert.deepEqual(groups[1], { actionLabel: null, rowIndexes: [1] })
})

await runTest('action label matching is case/whitespace-insensitive', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'Serum', action: 'Sale1' },
    { name: 'Toner', action: ' sale1 ' },
    { name: 'Cleanser', action: 'SALE1' },
  ]
  const groups = groupAddSaleImportRows(rows)
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0], { actionLabel: 'sale1', rowIndexes: [0, 1, 2] })
})

await runTest('a blank/whitespace-only action label is treated the same as no label at all', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'Serum', action: '' },
    { name: 'Toner', action: '   ' },
    { name: 'Cleanser' },
  ]
  const groups = groupAddSaleImportRows(rows)
  assert.equal(groups.length, 3)
  assert.ok(groups.every((group) => group.actionLabel === null))
})

await runTest('groups preserve original row order both across and within groups', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'A', action: 'sale2' },
    { name: 'B' },
    { name: 'C', action: 'sale1' },
    { name: 'D', action: 'sale2' },
    { name: 'E', action: 'sale1' },
  ]
  const groups = groupAddSaleImportRows(rows)
  // First-seen order: sale2 group formed at row 0, singleton at row 1,
  // sale1 group formed at row 2.
  assert.deepEqual(groups.map((g) => g.actionLabel), ['sale2', null, 'sale1'])
  assert.deepEqual(groups[0].rowIndexes, [0, 3])
  assert.deepEqual(groups[2].rowIndexes, [2, 4])
})

// ---- resolveAddSaleCostPrices ----

await runTest('a row that supplies its own cost price resolves directly, no product lookup needed', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', cost_price_usd: '4.50' }]
  const result = resolveAddSaleCostPrices(rows, [])
  assert.equal(result[0].resolved, true)
  assert.equal(result[0].costPriceUsd, 4.5)
  assert.equal(result[0].matchedProductId, undefined)
})

await runTest('a row missing cost price inherits it from an existing product matched by barcode', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', barcode: 'BC-1' }]
  const existing: ExistingProductForCostLookup[] = [
    { id: 10, barcode: 'BC-1', cost_price_usd: 5, cost_price_khr: 20000 },
  ]
  const result = resolveAddSaleCostPrices(rows, existing)
  assert.equal(result[0].resolved, true)
  assert.equal(result[0].costPriceUsd, 5)
  assert.equal(result[0].costPriceKhr, 20000)
  assert.equal(result[0].matchedProductId, 10)
})

await runTest('barcode match takes priority over sku and name when multiple could match', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', barcode: 'BC-1', sku: 'SKU-9' }]
  const existing: ExistingProductForCostLookup[] = [
    { id: 20, sku: 'SKU-9', cost_price_usd: 99 },
    { id: 10, barcode: 'BC-1', cost_price_usd: 5 },
  ]
  const result = resolveAddSaleCostPrices(rows, existing)
  assert.equal(result[0].matchedProductId, 10)
  assert.equal(result[0].costPriceUsd, 5)
})

await runTest('falls back to sku match, then name match, when barcode does not match', () => {
  const bySku = resolveAddSaleCostPrices(
    [{ name: 'Serum', sku: 'SKU-9' }],
    [{ id: 20, sku: 'SKU-9', cost_price_usd: 7 }],
  )
  assert.equal(bySku[0].matchedProductId, 20)
  assert.equal(bySku[0].costPriceUsd, 7)

  const byName = resolveAddSaleCostPrices(
    [{ name: 'Serum' }],
    [{ id: 30, name: 'Serum', cost_price_usd: 8 }],
  )
  assert.equal(byName[0].matchedProductId, 30)
  assert.equal(byName[0].costPriceUsd, 8)
})

await runTest('a row missing cost price with no matching product is blocked as missing_cost_no_match', () => {
  const result = resolveAddSaleCostPrices([{ name: 'Brand New Thing' }], [])
  assert.equal(result[0].resolved, false)
  assert.equal(result[0].reason, 'missing_cost_no_match')
  assert.equal(result[0].matchedProductId, undefined)
})

await runTest('a row matched to an existing product that itself has no cost price stays blocked, but reports the candidate', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', barcode: 'BC-1' }]
  const existing: ExistingProductForCostLookup[] = [{ id: 10, barcode: 'BC-1', cost_price_usd: null }]
  const result = resolveAddSaleCostPrices(rows, existing)
  assert.equal(result[0].resolved, false)
  assert.equal(result[0].reason, 'missing_cost_match_has_no_cost')
  assert.equal(result[0].matchedProductId, 10)
})

await runTest('multiple rows resolve independently -- one blocked row does not affect the others', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'Has own cost', cost_price_usd: 3 },
    { name: 'Unmatched, no cost' },
    { name: 'Matched, has cost', barcode: 'BC-1' },
  ]
  const existing: ExistingProductForCostLookup[] = [{ id: 10, barcode: 'BC-1', cost_price_usd: 6 }]
  const result = resolveAddSaleCostPrices(rows, existing)
  assert.equal(result[0].resolved, true)
  assert.equal(result[1].resolved, false)
  assert.equal(result[2].resolved, true)
  assert.equal(result[2].costPriceUsd, 6)
})

// ---- resolveAddSaleProductMatches ----

await runTest('a row matches an existing product when identity AND cost price agree', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', barcode: 'BC-1', branch: 'Main' }]
  const costs = resolveAddSaleCostPrices(rows, [
    { id: 10, barcode: 'BC-1', cost_price_usd: 5 },
  ])
  const existing: ExistingProductForMatchLookup[] = [
    { id: 10, barcode: 'BC-1', branch: 'Main', cost_price_usd: 5 },
  ]
  const result = resolveAddSaleProductMatches(rows, costs, existing)
  assert.equal(result[0].matched, true)
  assert.equal(result[0].matchedProductId, 10)
})

await runTest('identity matches but cost price disagrees -- blocked, not auto-merged, candidate reported', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', barcode: 'BC-1', branch: 'Main', cost_price_usd: 9 }]
  const costs = resolveAddSaleCostPrices(rows, [])
  const existing: ExistingProductForMatchLookup[] = [
    { id: 10, barcode: 'BC-1', branch: 'Main', cost_price_usd: 5 },
  ]
  const result = resolveAddSaleProductMatches(rows, costs, existing)
  assert.equal(result[0].matched, false)
  assert.equal(result[0].reason, 'cost_price_mismatch')
  assert.deepEqual(result[0].conflictingCandidateIds, [10])
})

await runTest('selling price is never part of the match key -- ignored entirely by this function', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'Serum', barcode: 'BC-1', branch: 'Main', selling_price_usd: 25 },
  ]
  const costs = resolveAddSaleCostPrices(rows, [{ id: 10, barcode: 'BC-1', cost_price_usd: 5 }])
  const existing: ExistingProductForMatchLookup[] = [
    { id: 10, barcode: 'BC-1', branch: 'Main', cost_price_usd: 5 },
  ]
  // Existing product's own selling price isn't even part of the lookup
  // shape -- proves the function has no way to consult it.
  const result = resolveAddSaleProductMatches(rows, costs, existing)
  assert.equal(result[0].matched, true)
  assert.equal(result[0].matchedProductId, 10)
})

await runTest('branch is part of the match key -- same barcode in a different branch does not match', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', barcode: 'BC-1', branch: 'Branch B' }]
  const costs = resolveAddSaleCostPrices(rows, [{ id: 10, barcode: 'BC-1', cost_price_usd: 5 }])
  const existing: ExistingProductForMatchLookup[] = [
    { id: 10, barcode: 'BC-1', branch: 'Main', cost_price_usd: 5 },
  ]
  const result = resolveAddSaleProductMatches(rows, costs, existing)
  assert.equal(result[0].matched, false)
  assert.equal(result[0].reason, 'no_identity_match')
})

await runTest('when a name is shared by several branch variants, matches the one sharing branch AND cost', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', branch: 'Branch B', cost_price_usd: 6 }]
  const costs = resolveAddSaleCostPrices(rows, [])
  const existing: ExistingProductForMatchLookup[] = [
    { id: 10, name: 'Serum', branch: 'Main', cost_price_usd: 5 },
    { id: 20, name: 'Serum', branch: 'Branch B', cost_price_usd: 6 },
  ]
  const result = resolveAddSaleProductMatches(rows, costs, existing)
  assert.equal(result[0].matched, true)
  assert.equal(result[0].matchedProductId, 20)
})

await runTest('no candidate shares identity at all -- reported as no_identity_match', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Brand New Thing', cost_price_usd: 3 }]
  const costs = resolveAddSaleCostPrices(rows, [])
  const result = resolveAddSaleProductMatches(rows, costs, [])
  assert.equal(result[0].matched, false)
  assert.equal(result[0].reason, 'no_identity_match')
})

await runTest('a row whose cost price is still unresolved cannot be matched yet', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', barcode: 'BC-1' }]
  const costs = resolveAddSaleCostPrices(rows, []) // unresolved: no cost, no match
  const existing: ExistingProductForMatchLookup[] = [{ id: 10, barcode: 'BC-1', cost_price_usd: 5 }]
  const result = resolveAddSaleProductMatches(rows, costs, existing)
  assert.equal(result[0].matched, false)
  assert.equal(result[0].reason, 'cost_unresolved')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('addSaleImportResolve tests passed')
