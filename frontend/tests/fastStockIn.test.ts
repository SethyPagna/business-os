import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// F2 (Part 419): fast stock-in -- "enter batch + supplier once, then
// per-product name→details entry; Add appends and continues, Done
// completes the batch. Backed by the same add/batch kernel as D4 -- no
// parallel write path." Source pins hold each clause of that spec.

let failed = 0

type TestCallback = () => void

function runTest(name: string, fn: TestCallback): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const modalSource = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
const inventorySource = readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')

runTest('F2: the shipment header is entered once and rides every line', () => {
  // branch + received date + the SHARED supplier picker + paid/credit --
  // the same field siblings every add-stock surface uses (D5a rule)
  assert.match(modalSource, /import SupplierPickerField, \{ type SupplierChoice \} from '\.\.\/shared\/SupplierPickerField\.tsx'/)
  // F3 slice 1: initializers became draft-aware -- the saved shipment
  // header wins over a reopened-session seed; dates intentionally start
  // blank so the app never silently filters/records a preset day.
  assert.match(modalSource, /draft\?\.receivedDate \|\| initialHeader\?\.receivedDate \|\| ''/)
  assert.match(modalSource, /draft\?\.paymentStatus \|\| initialHeader\?\.paymentStatus \|\| 'paid'/)
  // every Add sends the header fields with the line
  assert.match(modalSource, /receivedDate: receivedDate\.trim\(\) \|\| null/)
  assert.match(modalSource, /supplierId: supplier\.supplierId/)
  assert.match(modalSource, /paymentStatus,/)
  // credit needs its due date BEFORE any write (server enforces it too)
  assert.match(modalSource, /paymentStatus === 'credit' && !creditDueDate\.trim\(\)/)
})

runTest('F2: Add queues editable lines; completion writes through the one D4 kernel', () => {
  // the shared transport is the only write path -- no parallel writes
  assert.match(modalSource, /import \{ receiveBatchStock \} from '\.\.\/\.\.\/api\/batchesTransport\.ts'/)
  assert.doesNotMatch(modalSource, /apiFetch|fetch\(/)
  assert.equal((modalSource.match(/receiveBatchStock\(/g) || []).length, 1) // exactly one call site
  assert.match(modalSource, /status: 'queued'/)
  assert.match(modalSource, /const editLine = \(line: ReceivedLine\)/)
  assert.match(modalSource, /const removeLine = \(key: string\)/)
  assert.match(modalSource, /status: 'saved', detail: result\?\.lotCode/)
  assert.match(modalSource, /status: 'error', detail: message/)
  // Add clears the line and refocuses for the next product
  assert.match(modalSource, /const resetLine = \(\) => \{/)
  assert.match(modalSource, /searchInputRef\.current\?\.focus\(\)/)
  // Enter in the qty field is the fast path
  assert.match(modalSource, /if \(event\.key === 'Enter'\) addLine\(\)/)
})

runTest('changed cost offers and uses the existing price-variant path', () => {
  assert.match(modalSource, /import \{ adjustStock \} from '\.\.\/\.\.\/api\/inventoryWriteTransport\.tsx?'/)
  assert.match(modalSource, /setCreatePriceVariant\(costChanged\(picked, next\)\)/, 'a changed cost enables the safe variant choice by default')
  assert.match(modalSource, /create_price_variant.*Create\/use a price variant/, 'the choice is visible beside the edited cost')
  assert.match(modalSource, /unlockPricing: true/)
  assert.match(modalSource, /pricing: pricingForVariant\(line\.product, Number\(line\.unitCost\)\)/)
  assert.match(modalSource, /sessionId: sessionIdRef\.current/, 'variant receipts remain in the same stock-in session')
})

runTest('F2: the modal portals, guards mid-save closes, and Done refreshes only after real writes', () => {
  assert.match(modalSource, /return createPortal\(/)
  assert.match(modalSource, /const closeIfIdle = \(\) => \{ if \(!saving\) \{ if \(successCount > 0\) onDone\(\); onClose\(\) \} \}/)
})

runTest('F2: Inventory launches it from the Manage menu and reloads after', () => {
  assert.match(inventorySource, /const FastStockInModal = lazyRetry\(\(\) => import\('\.\/FastStockInModal'\)/)
  assert.match(inventorySource, /label: tr\('fast_stockin_title', 'Fast stock-in'\), onClick: \(\) => setShowFastStockIn\(true\)/)
  assert.match(inventorySource, /branchOptions=\{branchSelectOptions\}/)
  assert.match(inventorySource, /onDone=\{\(\) => load\(false\)\}/)
})

if (failed > 0) {
  process.exitCode = 1
}
