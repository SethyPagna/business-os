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
  // header wins over the defaults on reopen, today/paid stay the
  // first-open defaults.
  assert.match(modalSource, /const \[receivedDate, setReceivedDate\] = useState<string>\(draft\?\.receivedDate \|\| todayMmDdYyyy\(\)\)/)
  assert.match(modalSource, /const \[paymentStatus, setPaymentStatus\] = useState<'paid' \| 'credit'>\(draft\?\.paymentStatus \|\| 'paid'\)/)
  // every Add sends the header fields with the line
  assert.match(modalSource, /receivedDate: receivedDate\.trim\(\) \|\| null/)
  assert.match(modalSource, /supplierId: supplier\.supplierId/)
  assert.match(modalSource, /paymentStatus,/)
  // credit needs its due date BEFORE any write (server enforces it too)
  assert.match(modalSource, /paymentStatus === 'credit' && !creditDueDate\.trim\(\)/)
})

runTest('F2: Add writes ONE receiveBatchStock through the D4 kernel and continues', () => {
  // the shared transport is the only write path -- no parallel writes
  assert.match(modalSource, /import \{ receiveBatchStock \} from '\.\.\/\.\.\/api\/batchesTransport\.ts'/)
  assert.doesNotMatch(modalSource, /apiFetch|fetch\(/)
  assert.equal((modalSource.match(/receiveBatchStock\(/g) || []).length, 1) // exactly one call site
  // each line's outcome is recorded visibly -- success with its lot code,
  // failure with the error -- so there is never a silent partial write
  assert.match(modalSource, /ok: true,\s+detail: result\?\.lotCode/)
  assert.match(modalSource, /ok: false,\s+detail: message/)
  // Add clears the line and refocuses for the next product
  assert.match(modalSource, /const resetLine = \(\) => \{/)
  assert.match(modalSource, /searchInputRef\.current\?\.focus\(\)/)
  // Enter in the qty field is the fast path
  assert.match(modalSource, /if \(event\.key === 'Enter'\) void addLine\(\)/)
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
