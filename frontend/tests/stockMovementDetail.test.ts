import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  REVERTIBLE_STOCK_MOVEMENT_TYPES,
  STOCK_RECEIPT_MOVEMENT_TYPES,
  isRevertibleStockMovement,
  isStockReceiptMovement,
  recordedMovementCosts,
  showReceiptAccounting,
} from '../src/utils/stockMovementDetail.ts'

let failed = 0
function test(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

test('receipt accounting follows movement type, never batch attribution', () => {
  assert.equal(isStockReceiptMovement('add'), true)
  assert.equal(isStockReceiptMovement('stock_in'), true)
  for (const type of ['adjustment', 'set', 'remove', 'sale', 'return', 'transfer_in', 'correction_in', 'correction_out']) {
    assert.equal(showReceiptAccounting(type), false, type)
  }
})

test('recorded costs preserve zero and never fall back to lot or product values', () => {
  assert.deepEqual(recordedMovementCosts({
    unit_cost_usd: 0,
    total_cost_usd: 0,
    batch_unit_cost_usd: 17,
    batch_received_cost_usd: 170,
    product_cost_usd: 22,
  } as Record<string, unknown>), {
    unitUsd: 0,
    unitKhr: null,
    totalUsd: 0,
    totalKhr: null,
    hasUnit: true,
    hasTotal: true,
  })
  assert.deepEqual(recordedMovementCosts({
    unit_cost_usd: null,
    total_cost_usd: null,
    batch_unit_cost_usd: 17,
    batch_received_cost_usd: 170,
  } as Record<string, unknown>), {
    unitUsd: null,
    unitKhr: null,
    totalUsd: null,
    totalKhr: null,
    hasUnit: false,
    hasTotal: false,
  })
})

test('frontend revert eligibility mirrors the backend allowlist', () => {
  for (const type of ['add', 'remove', 'set', 'adjustment', 'in', 'out', 'csv_import']) {
    assert.equal(isRevertibleStockMovement(type), true, type)
  }
  for (const type of ['sale', 'return', 'supplier_return', 'transfer_in', 'transfer_out', 'correction_in', 'correction_out', 'future_type']) {
    assert.equal(isRevertibleStockMovement(type), false, type)
  }
})

test('frontend movement allowlists stay in source parity with the Worker', () => {
  const revertSource = readFileSync(new URL('../../cloudflare/src/lib/stockRevert.ts', import.meta.url), 'utf8')
  const receiptSource = readFileSync(new URL('../../cloudflare/src/lib/stockInSessionsQuery.ts', import.meta.url), 'utf8')
  const backendRevert = revertSource.match(/REVERTIBLE_MOVEMENT_TYPES = new Set<string>\(\[([\s\S]*?)\]\)/)?.[1]
  const backendReceipt = receiptSource.match(/STOCK_RECEIPT_MOVEMENT_TYPES = \[([^\]]+)\]/)?.[1]
  assert.ok(backendRevert && backendReceipt, 'Worker movement allowlists located')
  const values = (source: string): string[] => [...source.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort()
  assert.deepEqual([...REVERTIBLE_STOCK_MOVEMENT_TYPES].sort(), values(backendRevert))
  assert.deepEqual([...STOCK_RECEIPT_MOVEMENT_TYPES].sort(), values(backendReceipt))
})

test('detail uses a compact two-column identity and action composition', () => {
  const source = readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('{detail ? (')
  const end = source.indexOf('{adjustType ? (', start)
  const detail = source.slice(start, end)
  assert.ok(start > 0 && end > start, 'detail modal located')
  assert.match(detail, /<Modal title=\{`\$\{detail\.product_name\}`\}/)
  assert.ok(detail.indexOf('{detail.barcode}') < detail.indexOf("tr(t, 'date', 'Date')"), 'barcode sits immediately below title, before summary')
  assert.match(detail, /grid grid-cols-2 gap-2/)
  assert.doesNotMatch(detail, /sm:grid-cols-4/)
  assert.match(detail, /\{signedLabel\(detail\)\}[\s\S]*?\{detail\.unit \?/)
  assert.doesNotMatch(detail, /\[tr\(t, 'unit', 'Unit'\), detail\.unit\]/)
})

test('detail labels missing action costs honestly and gates receipt-only lot accounting', () => {
  const source = readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')
  const start = source.indexOf('{detail ? (')
  const end = source.indexOf('{adjustType ? (', start)
  const detail = source.slice(start, end)
  assert.match(detail, /recordedCostLabel\(detailCosts\?\.unitUsd/)
  assert.match(detail, /recordedCostLabel\(detailCosts\?\.totalUsd/)
  assert.match(detail, /tr\(t, 'not_recorded', 'Not recorded'\)/)
  assert.doesNotMatch(detail, /batch_unit_cost_usd/)
  assert.doesNotMatch(detail, /batch_received_cost_usd/)
  assert.match(detail, /\.\.\.\(detailShowsReceiptAccounting \? \[/)
  assert.match(detail, /detailCanRevert && confirmRevert/)
})

if (failed) process.exitCode = 1
