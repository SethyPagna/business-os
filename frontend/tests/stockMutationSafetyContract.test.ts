import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function source(path: string): string {
  return readFileSync(new URL(`../src/components/${path}`, import.meta.url), 'utf8')
}

// Material stock writes must have one review/confirmation before the request
// and a visible outcome afterwards. Navigation, search, filters, and opening
// details deliberately do not confirm: they make no state change.
runTest('single branch transfer permits direct FIFO quantity entry and confirms the exact action', () => {
  const transfer = source('branches/TransferModal.tsx')
  assert.match(transfer, /const hasBatchLots =/)
  assert.match(transfer, /const transferAvailable = selectedBatch[\s\S]*?: Number\(selectedProduct\?\.branch_quantity \|\| 0\)/)
  assert.match(transfer, /batchId: selectedBatchId/)
  assert.doesNotMatch(transfer, /transfer_pick_batch_first/)
  assert.doesNotMatch(transfer, /disabled=\{hasBatchLots && !selectedBatchId\}/)
  assert.match(transfer, /Automatic \(FIFO\)/)
  assert.match(transfer, /confirm_transfer_details/)
  assert.match(transfer, /confirm_bulk_transfer_details/)
  assert.match(transfer, /notify\(finalMessage\)/)
})

runTest('every direct stock receipt and batch mutation confirms before writing and reports its outcome', () => {
  const fastStockIn = source('inventory/FastStockInModal.tsx')
  const receiveBatch = source('inventory/ReceiveBatchModal.tsx')
  const batches = source('inventory/ManageBatchesModal.tsx')
  const sessions = source('products/StockInSessionsSection.tsx')

  assert.match(fastStockIn, /confirm_complete_stock_session/)
  assert.match(fastStockIn, /stock_session_completed/)
  assert.match(receiveBatch, /confirm_receive_batch_details/)
  assert.match(receiveBatch, /notify\(tr\('batch_received'/)
  assert.match(batches, /confirm_update_batch_details/)
  assert.match(batches, /confirm_deactivate_batch_details/)
  assert.match(batches, /notify\(tr\('batch_updated'/)
  assert.match(batches, /notify\(tr\('batch_deactivated'/)
  assert.match(sessions, /confirm_update_stock_session/)
  assert.match(sessions, /confirm_remove_stock_line/)
  assert.match(sessions, /confirm_remove_stock_session/)
  assert.match(sessions, /stock_session_updated/)
})

runTest('stock adjustments, transfers, and ledger edits retain review plus feedback contracts', () => {
  const inventory = source('inventory/Inventory.tsx')
  const adjustment = source('products/forms/StockAdjustModal.tsx')
  const bulk = source('products/forms/BulkAddStockModal.tsx')
  const ledger = source('products/StockChangeSection.tsx')

  assert.match(inventory, /window\.confirm\(adjustConfirmLabel\)/)
  assert.match(inventory, /confirm_transfer_stock_details/)
  assert.match(inventory, /stock_transferred_details/)
  assert.match(adjustment, /<ConfirmDialog/)
  assert.match(adjustment, /notify\(tr\('stock_updated'/)
  assert.match(bulk, /<ConfirmDialog/)
  assert.match(ledger, /confirmRevert/)
  assert.match(ledger, /confirm_update_stock_reason/)
  assert.match(ledger, /movement_reverted/)
  assert.match(ledger, /reason_updated/)
})

// S4-24b: adding a line to a sale that already exists deducts stock exactly
// as checkout does, so it owes the same contract as every other stock write.
runTest('adding items to a recorded sale reviews before the write and names what happened to stock', () => {
  const detail = source('sales/SaleDetailModal.tsx')
  const sales = source('sales/Sales.tsx')

  // one review before the request...
  assert.match(detail, /<ConfirmDialog/)
  assert.match(detail, /onConfirm=\{submitAddItems\}/)
  assert.match(detail, /add_items_submit/)
  // ...which says out loud whether these units leave stock now
  assert.match(detail, /add_items_moves_stock/)
  assert.match(detail, /add_items_holds_stock/)
  // the surface is only offered where the Worker would accept the write
  assert.match(detail, /STATUSES_ACCEPTING_ADDED_ITEMS\.includes\(currentStatus\)/)
  assert.match(detail, /hasRecordedReturns/)

  // ...and a visible outcome afterwards, distinguishing the stock case
  assert.match(sales, /sale_items_added_stock/)
  assert.match(sales, /sale_items_added_no_stock/)
  assert.match(sales, /sale_items_add_failed/)
  // the permission is enforced on the server; the client withholds the prop
  // rather than rendering an action that would 403.
  assert.match(sales, /canAddSaleItems \? handleAddSaleItems : undefined/)
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} stock-mutation-safety-contract test(s) failed`)
} else {
  console.log('\nAll stock mutation safety contract tests passed')
}
