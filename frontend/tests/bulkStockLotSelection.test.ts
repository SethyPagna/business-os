import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { scopedSetPreview } from '../src/utils/stockReceiptFields.ts'

const bulk = readFileSync(new URL('../src/components/products/forms/BulkAddStockModal.tsx', import.meta.url), 'utf8')
const products = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')

function test(name: string, run: () => void): void {
  try {
    run()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

test('scoped Set preview matches the backend lot and branch arithmetic', () => {
  assert.deepEqual(
    scopedSetPreview({ scope: 'lot', targetQuantity: 7, lotQuantity: 3, branchQuantity: 20 }),
    { scope: 'lot', targetQuantity: 7, valid: true, delta: 4, beforeLotQuantity: 3, afterLotQuantity: 7, beforeBranchQuantity: 20, afterBranchQuantity: 24 },
  )
  assert.deepEqual(
    scopedSetPreview({ scope: 'branch', targetQuantity: 25, lotQuantity: 3, branchQuantity: 20 }),
    { scope: 'branch', targetQuantity: 25, valid: true, delta: 5, beforeLotQuantity: 3, afterLotQuantity: 8, beforeBranchQuantity: 20, afterBranchQuantity: 25 },
  )
  assert.equal(
    scopedSetPreview({ scope: 'branch', targetQuantity: 10, lotQuantity: 3, branchQuantity: 20 }).valid,
    false,
    'a branch correction cannot drain more than the selected lot contains',
  )
})

test('every bulk row requires an explicit action-appropriate received date', () => {
  assert.match(bulk, /getProductBatches\(productId, numericBranchId, action === 'remove'\)/,
    'remove asks for positive lots; add/set ask for every active lot')
  assert.match(bulk, /action === 'add' \? \([\s\S]*?batchId: 'new'/,
    'New received date is an explicit Add-only choice')
  assert.match(bulk, /\(lotOptions\[productId\] \|\| \[\]\)\.map\(\(batch\) =>/,
    'existing received dates remain available per product')
  assert.match(bulk, /const missing = selectedProducts\.find\(\(product\) => !lotSelections\[normalizeProductId\(product\.id\)\]\)/,
    'there is no silent New/FIFO default')
  assert.match(bulk, /if \(action !== 'add'\) \{[\s\S]*?batchId === 'new'/,
    'Remove and Set can only target an existing received date')
  assert.match(bulk, /lotErrors\[productId\][\s\S]*?role="alert"[\s\S]*?setLotReloadKey/,
    'lot lookup failure stays distinct from an empty result and is retryable')
})

test('bulk scoped Set freezes one exact optimistic request per product', () => {
  assert.match(bulk, /const \[setScope, setSetScope\] = useState<StockSetScope>\('lot'\)/,
    'selected-lot Set is the default')
  assert.match(bulk, /\['branch', t\('stock_set_scope_branch'\) \|\| 'Branch total'\]/,
    'branch-total Set is explicit')
  assert.match(bulk, /if \(action === 'set' && selectedLot\) return \{[\s\S]*?setScope,[\s\S]*?batchId: Number\(selectedLot\.id\),[\s\S]*?expectedLotQuantity: Number\(selectedLot\.quantity \|\| 0\),[\s\S]*?expectedBranchQuantity: productBranchQuantity\(product\),[\s\S]*?client_request_id: createClientRequestId\('stock-set'\)/)
  assert.match(bulk, /selectedProducts\.map\(\(product\) => createRow\(buildRowRequest\(product, amount\)\)\)/,
    'the reviewed request is frozen before writes start')
  assert.match(bulk, /getProductApi\(\)\.adjustStock\(row\.request\)/,
    'failed retries reuse the frozen request and idempotency key')
  assert.match(bulk, /isStockIn: action === 'add'/,
    'Set is a correction and never borrows receipt supplier/cost fields')
})

test('server history is the only undo authority for scoped bulk changes', () => {
  assert.match(bulk, /action_history_id/)
  assert.match(bulk, /serverActionHistoryIds: completedHistoryIds/)
  assert.match(products, /if \(serverActionHistoryIds\.length\) await actionHistory\.refreshServerItems\(\)/)
  assert.match(products, /if \(action === 'add' && !serverActionHistoryIds\.length/,
    'the legacy aggregate client undo remains only as an Add fallback')
  assert.match(products, /action === 'remove' \? 'Removed stock from' : action === 'set' \? 'Set stock for' : 'Added stock to'/,
    'completion copy reflects the operation actually performed')
})

console.log('PASS bulk stock lot selection contract')
