import assert from 'node:assert/strict'
import {
  buildNewProductPayloadsForRows,
  createMissingProductsForRows,
  applyProductCreationOutcomes,
  createMissingProductsAndReplan,
  type CreateProductFn,
} from '../src/components/products/import/addSaleImportCreateProducts.ts'
import type { ResolvedSaleRow } from '../src/components/products/import/addSaleImportPlan.ts'
import type { AddSaleImportRow, AddSaleGroup, CostPriceResolution, ProductMatchResolution } from '../src/components/products/import/addSaleImportResolve.ts'

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

const needsNewProductRow = (rowIndex: number, overrides: Partial<ResolvedSaleRow> = {}): ResolvedSaleRow => ({
  rowIndex,
  status: 'needs_new_product',
  branchId: 1,
  quantity: 2,
  sellingPriceUsd: 15,
  costPriceUsd: 8,
  ...overrides,
})

await runTest('buildNewProductPayloadsForRows only builds payloads for needs_new_product rows, carrying name/barcode/sku/branch/cost/selling price forward', () => {
  const rows: AddSaleImportRow[] = [
    { name: 'New Widget', barcode: 'BC1', sku: 'SKU1' },
    { name: 'Already Matched' },
  ]
  const resolvedRows: ResolvedSaleRow[] = [
    needsNewProductRow(0),
    { rowIndex: 1, status: 'ready', productId: 99, branchId: 1, quantity: 1, sellingPriceUsd: 10 },
  ]
  const payloads = buildNewProductPayloadsForRows(rows, resolvedRows)
  assert.equal(payloads.size, 1, 'Only the needs_new_product row should get a payload')
  const payload = payloads.get(0)
  assert.deepEqual(payload, {
    name: 'New Widget',
    barcode: 'BC1',
    sku: 'SKU1',
    branch_id: 1,
    cost_price_usd: 8,
    selling_price_usd: 15,
  })
})

await runTest('buildNewProductPayloadsForRows skips a needs_new_product row with no name or no branch', () => {
  const rows: AddSaleImportRow[] = [{ name: '' }, { name: 'Has Name' }]
  const resolvedRows: ResolvedSaleRow[] = [
    needsNewProductRow(0),
    needsNewProductRow(1, { branchId: undefined }),
  ]
  const payloads = buildNewProductPayloadsForRows(rows, resolvedRows)
  assert.equal(payloads.size, 0, 'A row with no name or no resolved branch should not get a creation payload')
})

await runTest('createMissingProductsForRows reports a real numeric id as created', async () => {
  const rows: AddSaleImportRow[] = [{ name: 'New Widget' }]
  const resolvedRows: ResolvedSaleRow[] = [needsNewProductRow(0)]
  const stub: CreateProductFn = async () => ({ item: {}, id: 501, success: true })
  const outcomes = await createMissingProductsForRows(rows, resolvedRows, stub)
  assert.deepEqual(outcomes, [{ rowIndex: 0, status: 'created', productId: 501 }])
})

await runTest('createMissingProductsForRows reports a Review-Required tier response as pending, not created', async () => {
  const rows: AddSaleImportRow[] = [{ name: 'New Widget' }]
  const resolvedRows: ResolvedSaleRow[] = [needsNewProductRow(0)]
  const stub: CreateProductFn = async () => ({ success: true, pending: true, pendingActionId: 'pending-123' })
  const outcomes = await createMissingProductsForRows(rows, resolvedRows, stub)
  assert.deepEqual(outcomes, [{ rowIndex: 0, status: 'pending', pendingActionId: 'pending-123' }])
})

await runTest('createMissingProductsForRows reports a thrown error as failed, without crashing the batch', async () => {
  const rows: AddSaleImportRow[] = [{ name: 'Widget A' }, { name: 'Widget B' }]
  const resolvedRows: ResolvedSaleRow[] = [needsNewProductRow(0), needsNewProductRow(1)]
  let call = 0
  const stub: CreateProductFn = async () => {
    call += 1
    if (call === 1) throw new Error('Network down')
    return { item: {}, id: 777, success: true }
  }
  const outcomes = await createMissingProductsForRows(rows, resolvedRows, stub)
  assert.equal(outcomes.length, 2, 'One row failing should not stop the rest of the batch from being attempted')
  assert.deepEqual(outcomes[0], { rowIndex: 0, status: 'failed', error: 'Network down' })
  assert.deepEqual(outcomes[1], { rowIndex: 1, status: 'created', productId: 777 })
})

await runTest('applyProductCreationOutcomes only turns "created" outcomes into use_product decisions, preserving any existing decisions', () => {
  const existing = new Map([[5, { type: 'use_product' as const, productId: 5 }]])
  const outcomes = [
    { rowIndex: 0, status: 'created' as const, productId: 501 },
    { rowIndex: 1, status: 'pending' as const, pendingActionId: 'p1' },
    { rowIndex: 2, status: 'failed' as const, error: 'boom' },
  ]
  const decisions = applyProductCreationOutcomes(outcomes, existing)
  assert.deepEqual(decisions.get(0), { type: 'use_product', productId: 501 })
  assert.equal(decisions.has(1), false, 'A pending creation should not be treated as a usable product yet')
  assert.equal(decisions.has(2), false, 'A failed creation should not be treated as a usable product')
  assert.deepEqual(decisions.get(5), { type: 'use_product', productId: 5 }, 'An existing manual review decision should be preserved')
})

await runTest('createMissingProductsAndReplan turns a needs_new_product row into a ready group plan after a successful creation', async () => {
  const rows: AddSaleImportRow[] = [{ name: 'New Widget', branch: 'Main', quantity: 2, selling_price_usd: '15', cost_price_usd: '8' }]
  const groups: AddSaleGroup[] = [{ actionLabel: null, rowIndexes: [0] }]
  const costResolutions: CostPriceResolution[] = [{ rowIndex: 0, resolved: true, costPriceUsd: 8 }]
  const matchResolutions: ProductMatchResolution[] = [{ rowIndex: 0, matched: false, reason: 'no_identity_match' }]
  const branchIdByName = new Map([['main', 1]])
  const resolvedRows: ResolvedSaleRow[] = [needsNewProductRow(0)]
  const stub: CreateProductFn = async () => ({ item: {}, id: 501, success: true })

  const { plans, creationOutcomes } = await createMissingProductsAndReplan(
    rows, groups, costResolutions, matchResolutions, branchIdByName, resolvedRows, undefined, undefined, stub,
  )
  assert.deepEqual(creationOutcomes, [{ rowIndex: 0, status: 'created', productId: 501 }])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].status, 'ready', 'The group should now be ready once its only row got a real product id')
  assert.equal((plans[0] as { payload: { items: { product_id: number }[] } }).payload.items[0].product_id, 501)
})

await runTest('createMissingProductsAndReplan leaves the group as needs_new_product when creation is still pending review', async () => {
  const rows: AddSaleImportRow[] = [{ name: 'New Widget', branch: 'Main', quantity: 2, selling_price_usd: '15', cost_price_usd: '8' }]
  const groups: AddSaleGroup[] = [{ actionLabel: null, rowIndexes: [0] }]
  const costResolutions: CostPriceResolution[] = [{ rowIndex: 0, resolved: true, costPriceUsd: 8 }]
  const matchResolutions: ProductMatchResolution[] = [{ rowIndex: 0, matched: false, reason: 'no_identity_match' }]
  const branchIdByName = new Map([['main', 1]])
  const resolvedRows: ResolvedSaleRow[] = [needsNewProductRow(0)]
  const stub: CreateProductFn = async () => ({ success: true, pending: true, pendingActionId: 'p1' })
  // The row's original "create a new product" review decision (what put
  // it into 'needs_new_product' in the first place) must be supplied as
  // existing state -- a pending outcome doesn't itself produce a
  // use_product decision, so without the original create_new decision
  // still in the map, resolveAddSaleRows would have nothing to resolve
  // the row against and fall through to its default "blocked, no
  // identity match" outcome instead.
  const existingDecisions = new Map([[0, { type: 'create_new' as const }]])

  const { plans, creationOutcomes } = await createMissingProductsAndReplan(
    rows, groups, costResolutions, matchResolutions, branchIdByName, resolvedRows, undefined, existingDecisions, stub,
  )
  assert.deepEqual(creationOutcomes, [{ rowIndex: 0, status: 'pending', pendingActionId: 'p1' }])
  assert.equal(plans[0].status, 'needs_new_product', 'A pending (review-gated) creation must not be treated as ready yet')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
