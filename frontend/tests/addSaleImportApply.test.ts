import assert from 'node:assert/strict'
import {
  applyAddSaleGroupPlans,
  summarizeAddSaleApplyResults,
  type CreateSaleFn,
} from '../src/components/products/import/addSaleImportApply.ts'
import type { AddSaleGroupPlan } from '../src/components/products/import/addSaleImportPlan.ts'

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

const readyPlan = (
  rowIndexes: number[],
  actionLabel: string | null = null,
): Extract<AddSaleGroupPlan, { status: 'ready' }> => ({
  actionLabel,
  rowIndexes,
  status: 'ready',
  payload: {
    items: rowIndexes.map((i) => ({ product_id: 10 + i, quantity: 1, branch_id: 1, applied_price_usd: 20 })),
    branch_id: 1,
  },
})

const blockedPlan = (rowIndexes: number[], blockedRowIndexes: number[]): AddSaleGroupPlan => ({
  actionLabel: null,
  rowIndexes,
  status: 'blocked',
  blockedRowIndexes,
})

const needsNewProductPlan = (rowIndexes: number[], newProductRowIndexes: number[]): AddSaleGroupPlan => ({
  actionLabel: null,
  rowIndexes,
  status: 'needs_new_product',
  newProductRowIndexes,
})

await runTest('a ready group calls createSaleFn with its exact payload and reports applied', async () => {
  const calls: Record<string, unknown>[] = []
  const stub: CreateSaleFn = async (payload) => {
    calls.push(payload)
    return { id: 501, receiptNumber: 'R-501' }
  }
  const plan = readyPlan([0, 1], 'sale1')
  const results = await applyAddSaleGroupPlans([plan], stub)
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0], plan.payload)
  assert.deepEqual(results, [
    { status: 'applied', actionLabel: 'sale1', rowIndexes: [0, 1], result: { id: 501, receiptNumber: 'R-501' } },
  ])
})

await runTest('blocked and needs_new_product groups are never sent to createSaleFn', async () => {
  const calls: Record<string, unknown>[] = []
  const stub: CreateSaleFn = async (payload) => {
    calls.push(payload)
    return { id: 1 }
  }
  const plans = [blockedPlan([0], [0]), needsNewProductPlan([1], [1])]
  const results = await applyAddSaleGroupPlans(plans, stub)
  assert.equal(calls.length, 0)
  assert.deepEqual(results, [
    { status: 'skipped_blocked', actionLabel: null, rowIndexes: [0], blockedRowIndexes: [0] },
    { status: 'skipped_needs_new_product', actionLabel: null, rowIndexes: [1], newProductRowIndexes: [1] },
  ])
})

await runTest('a failed createSaleFn call reports failed with the error message, not a thrown exception', async () => {
  const stub: CreateSaleFn = async () => {
    throw new Error('Insufficient stock for Serum: requested 5, available 2')
  }
  const results = await applyAddSaleGroupPlans([readyPlan([0])], stub)
  assert.deepEqual(results, [
    {
      status: 'failed',
      actionLabel: null,
      rowIndexes: [0],
      error: 'Insufficient stock for Serum: requested 5, available 2',
    },
  ])
})

await runTest('one group failing does not block later groups from being attempted', async () => {
  let call = 0
  const stub: CreateSaleFn = async () => {
    call += 1
    if (call === 1) throw new Error('boom')
    return { id: 900 + call }
  }
  const results = await applyAddSaleGroupPlans([readyPlan([0]), readyPlan([1]), readyPlan([2])], stub)
  assert.equal(call, 3)
  assert.equal(results[0].status, 'failed')
  assert.equal(results[1].status, 'applied')
  assert.equal(results[2].status, 'applied')
})

await runTest('groups are applied in file order, not concurrently', async () => {
  const order: number[] = []
  const stub: CreateSaleFn = async (payload) => {
    const items = payload.items as Array<{ product_id: number }>
    order.push(items[0].product_id)
    return { id: items[0].product_id }
  }
  await applyAddSaleGroupPlans([readyPlan([0]), readyPlan([1]), readyPlan([2])], stub)
  assert.deepEqual(order, [10, 11, 12])
})

await runTest('a non-Error throw still produces a readable string, never crashes the batch', async () => {
  const stub: CreateSaleFn = async () => {
    // eslint-disable-next-line no-throw-literal -- deliberately simulating a non-Error rejection
    throw { status: 409, message: 'Conflict' }
  }
  const results = await applyAddSaleGroupPlans([readyPlan([0])], stub)
  assert.equal(results[0].status, 'failed')
  assert.equal((results[0] as { error: string }).error, 'Conflict')
})

await runTest('summarizeAddSaleApplyResults counts each outcome independently', () => {
  const summary = summarizeAddSaleApplyResults([
    { status: 'applied', actionLabel: null, rowIndexes: [0], result: {} },
    { status: 'applied', actionLabel: null, rowIndexes: [1], result: {} },
    { status: 'failed', actionLabel: null, rowIndexes: [2], error: 'x' },
    { status: 'skipped_blocked', actionLabel: null, rowIndexes: [3], blockedRowIndexes: [3] },
    { status: 'skipped_needs_new_product', actionLabel: null, rowIndexes: [4], newProductRowIndexes: [4] },
  ])
  assert.deepEqual(summary, { applied: 2, failed: 1, skippedBlocked: 1, skippedNeedsNewProduct: 1 })
})

await runTest('an empty plan list resolves to an empty result list without calling createSaleFn', async () => {
  let called = false
  const stub: CreateSaleFn = async () => {
    called = true
    return {}
  }
  const results = await applyAddSaleGroupPlans([], stub)
  assert.deepEqual(results, [])
  assert.equal(called, false)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
