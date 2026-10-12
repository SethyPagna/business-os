// Owner ruling, 12 Oct 2026: received dates show NEWEST FIRST everywhere a lot
// list is displayed (POS picker, Transfer, Manage Received Dates, Returns,
// inventory lists), and a list that is about expiry shows the lot closest to
// expiring first. This is display only: the Worker's FIFO deduction and the
// lot a sale actually draws from are untouched. It supersedes S4-18's old
// "POS earliest to latest" direction (tests/posCore.test.ts carries the POS
// side); the S4-18 "not split into available/unavailable sections" clause
// still holds, so date dominates and availability only breaks an exact tie.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { batchReceivedInstant, sortLotsForDisplay } from '../src/utils/lotDisplayOrder.ts'
import { getVisibleProductBatches } from '../src/utils/productBatches.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const read = (file: string) => fs.readFileSync(path.join(here, file), 'utf8').replace(/\r\n/g, '\n')
const ids = (rows: Array<{ id: number }>) => rows.map((row) => row.id)

let passed = 0
const failures: string[] = []
function check(name: string, fn: () => void) {
  try {
    fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`FAIL ${name}: ${(error as Error).message.split('\n')[0]}`)
  }
}

check('received context: newest received date first across timestamps, date-only values and date-coded lots', () => {
  const sorted = sortLotsForDisplay([
    { id: 1, received_at: '2026-01-05 08:00:00', quantity: 3 },
    { id: 2, received_at: '2026-06-01', quantity: 3 },
    { id: 3, lot_code: '09152026', received_at: null, quantity: 3 },
    { id: 4, received_at: '2026-06-01 20:30:00', quantity: 3 },
    { id: 5, received_at: '2025-12-31 23:00:00', quantity: 3 },
  ])
  assert.deepEqual(ids(sorted), [3, 4, 2, 1, 5], '15 Sep, 1 Jun 20:30, 1 Jun, 5 Jan 2026, 31 Dec 2025')
})

check('received context: an undated lot sorts after every dated one, however much stock either holds', () => {
  const sorted = sortLotsForDisplay([
    { id: 1, lot_code: 'RECON-7321', received_at: null, quantity: 50 },
    { id: 2, received_at: '2020-01-01 00:00:00', quantity: 0 },
    { id: 3, received_at: 'not-a-date', quantity: 9 },
    { id: 4, received_at: '2026-03-01 08:00:00', quantity: 1 },
    { id: 5, received_at: '', quantity: 0 },
  ])
  assert.deepEqual(ids(sorted), [4, 2, 1, 3, 5], 'dated lots newest first, then the undated ones with stock before the empty one')
})

check('received context: date dominates availability (no available/unavailable sections), stock only breaks an exact tie', () => {
  const sorted = sortLotsForDisplay([
    { id: 1, received_at: '2026-01-05 08:00:00', quantity: 9 },
    { id: 2, received_at: '2026-06-01 08:00:00', quantity: 0 },
    { id: 3, received_at: '2026-03-01 08:00:00', quantity: 4 },
    { id: 4, received_at: '2026-06-01 08:00:00', quantity: 2 },
  ])
  assert.deepEqual(ids(sorted), [4, 2, 3, 1], 'the empty 1 Jun lot stays between 1 Jun (stocked) and 1 Mar')
})

check('received context: undated ties fall back to the higher batch number, then to the incoming order', () => {
  const sorted = sortLotsForDisplay([
    { id: 1, received_at: null, batch_number: null, quantity: 1 },
    { id: 2, received_at: null, batch_number: 2, quantity: 1 },
    { id: 3, received_at: null, batch_number: 1, quantity: 1 },
    { id: 4, received_at: null, batch_number: null, quantity: 1 },
  ])
  assert.deepEqual(ids(sorted), [2, 3, 1, 4])
})

check('expiry context: closest to expiry first, lots with no expiry last, equal expiry newest received first', () => {
  const sorted = sortLotsForDisplay([
    { id: 1, expiry_date: null, received_at: '2026-09-01', quantity: 1 },
    { id: 2, expiry_date: '2027-03-01', received_at: '2026-01-01', quantity: 1 },
    { id: 3, expiry_date: '2026-11-15', received_at: '2026-02-01', quantity: 1 },
    { id: 4, expiry_date: '2026-11-15', received_at: '2026-08-01', quantity: 1 },
    { id: 5, expiry_date: '2026-01-31', received_at: '2025-06-01', quantity: 1 },
  ], 'expiry')
  assert.deepEqual(ids(sorted), [5, 4, 3, 2, 1], 'already-expired 31 Jan first, then 15 Nov (newer receipt first), then 1 Mar, then no expiry')
})

check('the input array is never reordered in place', () => {
  const input = [
    { id: 1, received_at: '2026-01-01 08:00:00', quantity: 1 },
    { id: 2, received_at: '2026-06-01 08:00:00', quantity: 1 },
  ]
  sortLotsForDisplay(input)
  sortLotsForDisplay(input, 'expiry')
  assert.deepEqual(ids(input), [1, 2])
  assert.deepEqual(sortLotsForDisplay(undefined), [])
})

check('the sort key is decoded from the lot code, not from the dd/mm/yyyy display string', () => {
  assert.equal(batchReceivedInstant({ lot_code: '08242026', received_at: null }), Date.UTC(2026, 7, 24))
  assert.equal(batchReceivedInstant({ received_at: '2026-08-24' }), Date.UTC(2026, 7, 24))
  assert.equal(batchReceivedInstant({ lot_code: 'RECON-7321', received_at: null }), null)
})

// ---------------------------------------------------------------------------
// Every lot list shows the order through the ONE helper (source pins where the
// surface is too heavy to mount; the mounted lists are in
// lotDisplayOrderMounted.test.ts).
// ---------------------------------------------------------------------------
const uses = (file: string, pattern: RegExp, message: string) => assert.match(read(file), pattern, message)

check('POS: the picker and the sheet state order lots through the shared helper', () => {
  uses('../src/components/pos/ProductDetailSheet.tsx', /sortLotsForDisplay\(visibleBatches\)/, 'ProductDetailSheet')
  uses('../src/components/pos/productSheetState.ts', /sortLotsForDisplay\(batches as readonly SheetBatchLike\[\]\)/, 'productSheetState')
  assert.doesNotMatch(read('../src/components/pos/posCore.ts'), /export function sortBatchesForPicker/, 'posCore keeps no second ordering implementation')
})

check('Transfer: the single-product list and every checked row of the bulk list are ordered', () => {
  const transfer = read('../src/components/branches/TransferModal.tsx')
  assert.match(transfer, /sortLotsForDisplay\(productBatches\)\.map\(/, 'single transfer lot list')
  assert.match(transfer, /sortLotsForDisplay\(loadedLots\.batches\)/, 'bulk transfer row lots')
})

check('Inventory transfer form orders its lot options', () => {
  uses('../src/components/inventory/InventoryStockModals.tsx', /sortLotsForDisplay\(transferBatchOptions\)\.map\(/, 'Inventory transfer lot select')
})

check('Manage Received Dates orders its rows, then keeps sold-out lots after the ones on hand', () => {
  uses('../src/components/inventory/ManageBatchesModal.tsx', /orderLotsOnHandFirst\(sortLotsForDisplay\(batches\), /, 'Manage Received Dates')
})

check('Returns order both lot selects (returned units and replacement)', () => {
  const returns = read('../src/components/returns/NewReturnModal.tsx')
  assert.match(returns, /sortLotsForDisplay\(item\.lotOptions\)\.map\(/, 'returned-units lot select')
  assert.match(returns, /sortLotsForDisplay\(line\.batches\)\.map\(/, 'replacement lot select')
})

check('Attribute Supplier lists its lots through the shared helper', () => {
  const modal = read('../src/components/products/surfaces/AttributeSupplierModal.tsx')
  assert.match(modal, /sortLotsForDisplay\(lots\)/)
  assert.doesNotMatch(modal, /localeCompare\(String\(a\.received_at/, 'no raw received_at string compare')
})

check('the shared product-detail lot list is newest first inside the on-hand group and inside the sold-out group', () => {
  const product = {
    batches: [
      { id: 1, received_at: '2026-01-01', quantity: 5 },
      { id: 2, received_at: '2026-08-01', quantity: 0 },
      { id: 3, received_at: '2026-05-01', quantity: 2 },
      { id: 4, received_at: '2026-03-01', quantity: 0 },
    ],
  }
  assert.deepEqual(getVisibleProductBatches(product, 'all', { includeEmpty: true }).map((batch) => batch.id), [3, 1, 2, 4],
    'on hand: 1 May, 1 Jan; then sold out (owner, 25 Sep): 1 Aug, 1 Mar')
  assert.deepEqual(getVisibleProductBatches(product).map((batch) => batch.id), [3, 1], 'compact previews still drop sold-out lots')
  uses('../src/utils/productBatches.ts', /orderLotsOnHandFirst\(sortLotsForDisplay\(visible\)/, 'getVisibleProductBatches')
})

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exitCode = 1
} else console.log(`\nOK ${passed} checks`)
