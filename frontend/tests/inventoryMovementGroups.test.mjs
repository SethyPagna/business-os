import assert from 'node:assert/strict'
import { buildMovementGroups, getMovementGroupPage, normalizeMovementTimestamp } from '../src/components/inventory/movementGroups.js'

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

await runTest('transfer in and out rows with same reference become one net-zero group', () => {
  const groups = buildMovementGroups([
    { id: 1, product_id: 10, product_name: 'Serum', movement_type: 'transfer_out', quantity: 4, total_cost_usd: 12, branch_name: 'A', user_name: 'Admin', reference_id: 'transfer_1', created_at: '2026-05-05 10:00:00' },
    { id: 2, product_id: 10, product_name: 'Serum', movement_type: 'transfer_in', quantity: 4, total_cost_usd: 12, branch_name: 'B', user_name: 'Admin', reference_id: 'transfer_1', created_at: '2026-05-05 10:00:01' },
  ])

  assert.equal(groups.length, 1)
  assert.equal(groups[0].recordCount, 2)
  assert.equal(groups[0].productCount, 1)
  assert.equal(groups[0].totalQuantity, 0)
  assert.equal(groups[0].totalCostUsd, 0)
  assert.equal(groups[0].branchSummary, 'A +1')
})

await runTest('movement timestamp falls back to server created_at when imported date is invalid', () => {
  assert.equal(
    normalizeMovementTimestamp({ movement_date: 'Invalid Date', created_at: '2026-05-05 12:34:56' }),
    '2026-05-05 12:34:56',
  )
})

await runTest('expanded movement groups paginate without changing totals', () => {
  const group = buildMovementGroups(Array.from({ length: 25 }, (_, index) => ({
    id: index + 1,
    product_id: index + 1,
    product_name: `Product ${index + 1}`,
    movement_type: 'csv_import',
    quantity: 1,
    total_cost_usd: 2,
    reason: 'May import',
    reference_id: 'import_5491',
    created_at: '2026-05-05 10:00:00',
  })))[0]

  const page = getMovementGroupPage(group, { page: 2, pageSize: 10 })
  assert.equal(group.recordCount, 25)
  assert.equal(group.totalQuantity, 25)
  assert.equal(page.items.length, 10)
  assert.equal(page.page, 2)
  assert.equal(page.totalPages, 3)
})

if (failed > 0) {
  process.exitCode = 1
}
