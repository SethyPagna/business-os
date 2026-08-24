import assert from 'node:assert/strict'
import {
  resolveAddSaleRows,
  buildAddSaleGroupPlans,
  type ResolvedSaleRow,
} from '../src/components/products/import/addSaleImportPlan.ts'
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

const branchIds = new Map([['main', 1], ['branch b', 2]])

// ---- resolveAddSaleRows ----

await runTest('a fully resolvable row (matched product, known branch, price, qty) resolves ready', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'Serum', barcode: 'BC-1', branch: 'Main', quantity: 2, selling_price_usd: 25 },
  ]
  const costs = resolveAddSaleCostPrices(rows, [{ id: 10, barcode: 'BC-1', cost_price_usd: 5 }])
  const matches = resolveAddSaleProductMatches(rows, costs, [
    { id: 10, barcode: 'BC-1', branch: 'Main', cost_price_usd: 5 },
  ])
  const resolved = resolveAddSaleRows(rows, costs, matches, branchIds)
  assert.deepEqual(resolved[0], {
    rowIndex: 0,
    status: 'ready',
    productId: 10,
    branchId: 1,
    quantity: 2,
    sellingPriceUsd: 25,
  })
})

await runTest('an unrecognized branch name blocks the row with unknown_branch', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', branch: 'Nowhere', quantity: 1, selling_price_usd: 10, cost_price_usd: 5 }]
  const costs = resolveAddSaleCostPrices(rows, [])
  const matches = resolveAddSaleProductMatches(rows, costs, [])
  const resolved = resolveAddSaleRows(rows, costs, matches, branchIds)
  assert.equal(resolved[0].status, 'blocked')
  assert.equal(resolved[0].blockedReason, 'unknown_branch')
})

await runTest('a zero/blank quantity blocks the row with invalid_quantity', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', branch: 'Main', quantity: 0, selling_price_usd: 10, cost_price_usd: 5 }]
  const costs = resolveAddSaleCostPrices(rows, [])
  const matches = resolveAddSaleProductMatches(rows, costs, [])
  const resolved = resolveAddSaleRows(rows, costs, matches, branchIds)
  assert.equal(resolved[0].status, 'blocked')
  assert.equal(resolved[0].blockedReason, 'invalid_quantity')
})

await runTest('neither selling price currency supplied blocks the row with missing_selling_price', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', branch: 'Main', quantity: 1, cost_price_usd: 5 }]
  const costs = resolveAddSaleCostPrices(rows, [])
  const matches = resolveAddSaleProductMatches(rows, costs, [])
  const resolved = resolveAddSaleRows(rows, costs, matches, branchIds)
  assert.equal(resolved[0].status, 'blocked')
  assert.equal(resolved[0].blockedReason, 'missing_selling_price')
})

await runTest('an unresolved cost price blocks the row with missing_cost_price, matching the hard cost block', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Brand New', branch: 'Main', quantity: 1, selling_price_usd: 10 }]
  const costs = resolveAddSaleCostPrices(rows, [])
  const matches = resolveAddSaleProductMatches(rows, costs, [])
  const resolved = resolveAddSaleRows(rows, costs, matches, branchIds)
  assert.equal(resolved[0].status, 'blocked')
  assert.equal(resolved[0].blockedReason, 'missing_cost_price')
})

await runTest('a cost_price_mismatch row stays blocked and passes the resolver reason through', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', barcode: 'BC-1', branch: 'Main', quantity: 1, selling_price_usd: 10, cost_price_usd: 9 }]
  const costs = resolveAddSaleCostPrices(rows, [])
  const existing: ExistingProductForMatchLookup[] = [{ id: 10, barcode: 'BC-1', branch: 'Main', cost_price_usd: 5 }]
  const matches = resolveAddSaleProductMatches(rows, costs, existing)
  const resolved = resolveAddSaleRows(rows, costs, matches, branchIds)
  assert.equal(resolved[0].status, 'blocked')
  assert.equal(resolved[0].blockedReason, 'cost_price_mismatch')
})

await runTest('a review decision to use a specific product resolves the row to ready with that id', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', branch: 'Main', quantity: 1, selling_price_usd: 10, cost_price_usd: 9 }]
  const costs = resolveAddSaleCostPrices(rows, [])
  const matches = resolveAddSaleProductMatches(rows, costs, [])
  const decisions = new Map([[0, { type: 'use_product' as const, productId: 42 }]])
  const resolved = resolveAddSaleRows(rows, costs, matches, branchIds, decisions)
  assert.equal(resolved[0].status, 'ready')
  assert.equal(resolved[0].productId, 42)
})

await runTest('a review decision to create a new product resolves the row to needs_new_product with its own cost carried over', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Brand New', branch: 'Branch B', quantity: 3, selling_price_usd: 12, cost_price_usd: 4 }]
  const costs = resolveAddSaleCostPrices(rows, [])
  const matches = resolveAddSaleProductMatches(rows, costs, [])
  const decisions = new Map([[0, { type: 'create_new' as const }]])
  const resolved = resolveAddSaleRows(rows, costs, matches, branchIds, decisions)
  assert.equal(resolved[0].status, 'needs_new_product')
  assert.equal(resolved[0].costPriceUsd, 4)
  assert.equal(resolved[0].branchId, 2)
})

// ---- buildAddSaleGroupPlans ----

await runTest('a singleton (unlabeled) row builds a one-item ready sale payload', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', barcode: 'BC-1', branch: 'Main', quantity: 2, selling_price_usd: 25 }]
  const groups = groupAddSaleImportRows(rows)
  const resolved: ResolvedSaleRow[] = [
    { rowIndex: 0, status: 'ready', productId: 10, branchId: 1, quantity: 2, sellingPriceUsd: 25 },
  ]
  const plans = buildAddSaleGroupPlans(rows, groups, resolved)
  assert.equal(plans.length, 1)
  assert.equal(plans[0].status, 'ready')
  if (plans[0].status === 'ready') {
    assert.equal(plans[0].payload.branch_id, 1)
    assert.equal(plans[0].payload.items.length, 1)
    assert.equal(plans[0].payload.items[0].product_id, 10)
    assert.equal(plans[0].payload.items[0].applied_price_usd, 25)
  }
})

await runTest('rows sharing an action label bundle into one payload with multiple items', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'Serum', branch: 'Main', action: 'sale1', quantity: 1, selling_price_usd: 25 },
    { name: 'Toner', branch: 'Main', action: 'sale1', quantity: 2, selling_price_usd: 15 },
  ]
  const groups = groupAddSaleImportRows(rows)
  const resolved: ResolvedSaleRow[] = [
    { rowIndex: 0, status: 'ready', productId: 10, branchId: 1, quantity: 1, sellingPriceUsd: 25 },
    { rowIndex: 1, status: 'ready', productId: 20, branchId: 1, quantity: 2, sellingPriceUsd: 15 },
  ]
  const plans = buildAddSaleGroupPlans(rows, groups, resolved)
  assert.equal(plans.length, 1)
  assert.equal(plans[0].status, 'ready')
  if (plans[0].status === 'ready') {
    assert.equal(plans[0].payload.items.length, 2)
    assert.deepEqual(plans[0].payload.items.map((i) => i.product_id), [10, 20])
  }
})

await runTest('a per-row customer name resolves to customer_id on the group payload', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Serum', branch: 'Main', quantity: 1, selling_price_usd: 25, customer: 'Dara' }]
  const groups = groupAddSaleImportRows(rows)
  const resolved: ResolvedSaleRow[] = [
    { rowIndex: 0, status: 'ready', productId: 10, branchId: 1, quantity: 1, sellingPriceUsd: 25 },
  ]
  const customerIds = new Map([['dara', 99]])
  const plans = buildAddSaleGroupPlans(rows, groups, resolved, customerIds)
  assert.equal(plans[0].status, 'ready')
  if (plans[0].status === 'ready') {
    assert.equal(plans[0].payload.customer_id, 99)
  }
})

await runTest('one blocked row in a group blocks the whole group -- no partial receipt', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'Serum', branch: 'Main', action: 'sale1', quantity: 1, selling_price_usd: 25 },
    { name: 'Toner', branch: 'Main', action: 'sale1', quantity: 2, selling_price_usd: 15 },
  ]
  const groups = groupAddSaleImportRows(rows)
  const resolved: ResolvedSaleRow[] = [
    { rowIndex: 0, status: 'ready', productId: 10, branchId: 1, quantity: 1, sellingPriceUsd: 25 },
    { rowIndex: 1, status: 'blocked', blockedReason: 'missing_cost_price' },
  ]
  const plans = buildAddSaleGroupPlans(rows, groups, resolved)
  assert.equal(plans.length, 1)
  assert.equal(plans[0].status, 'blocked')
  if (plans[0].status === 'blocked') {
    assert.deepEqual(plans[0].blockedRowIndexes, [1])
  }
})

await runTest('a group with a needs_new_product row is reported as needs_new_product, not partially readied', () => {
  const rows: AddSaleImportRow[] = [{ name: 'Brand New', branch: 'Main', quantity: 1, selling_price_usd: 10 }]
  const groups = groupAddSaleImportRows(rows)
  const resolved: ResolvedSaleRow[] = [
    { rowIndex: 0, status: 'needs_new_product', branchId: 1, quantity: 1, sellingPriceUsd: 10, costPriceUsd: 4 },
  ]
  const plans = buildAddSaleGroupPlans(rows, groups, resolved)
  assert.equal(plans[0].status, 'needs_new_product')
  if (plans[0].status === 'needs_new_product') {
    assert.deepEqual(plans[0].newProductRowIndexes, [0])
  }
})

await runTest('multiple independent singleton rows each build their own separate payload', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'Serum', branch: 'Main', quantity: 1, selling_price_usd: 25 },
    { name: 'Toner', branch: 'Branch B', quantity: 1, selling_price_usd: 15 },
  ]
  const groups = groupAddSaleImportRows(rows)
  const resolved: ResolvedSaleRow[] = [
    { rowIndex: 0, status: 'ready', productId: 10, branchId: 1, quantity: 1, sellingPriceUsd: 25 },
    { rowIndex: 1, status: 'ready', productId: 20, branchId: 2, quantity: 1, sellingPriceUsd: 15 },
  ]
  const plans = buildAddSaleGroupPlans(rows, groups, resolved)
  assert.equal(plans.length, 2)
  assert.ok(plans.every((p) => p.status === 'ready'))
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('addSaleImportPlan tests passed')
