import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// P10-21 (owner, verbatim): "customers purchases are doing default date start
// and date end, remove that to show all". CustomerPurchasesReportModal used
// to open on todayDateTimeRange(), so a customer with years of history only
// ever showed today's purchases. It now opens on empty bounds (all-time),
// the same shape the sibling SupplierPurchasesModal already used.
//
// P10-22 (owner, verbatim): "the stats can be one row, make it compact. then
// actually show rows of sales as well. records." The four stat cells used to
// be a 2x2 grid (`grid-cols-2` with no wider breakpoint); they now collapse
// into one row at sm+, and the modal renders a paged list of the customer's
// individual sale rows, not only totals.
//
// Asserted against the CODE (source-shape), matching purchasesModalPagination
// .test.ts's own approach for this exact sibling pair.

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..')
const readSource = (relativePath: string): string => readFileSync(resolve(repo, relativePath), 'utf8')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const modal = readSource('frontend/src/components/contacts/CustomerPurchasesReportModal.tsx')
const salesTransport = readSource('frontend/src/api/salesTransport.ts')

runTest('the modal no longer imports or calls todayDateTimeRange', () => {
  assert.doesNotMatch(modal, /todayDateTimeRange/)
})

runTest('fromDate/toDate start empty, not a today default', () => {
  assert.match(modal, /const \[fromDate, setFromDate\] = useState\(''\)/)
  assert.match(modal, /const \[toDate, setToDate\] = useState\(''\)/)
})

runTest('startDate/endDate are only added to the request once a bound is actually chosen', () => {
  assert.match(modal, /if \(fromDate\) params\.startDate = fromDate/)
  assert.match(modal, /if \(toDate\) params\.endDate = toDate/)
})

runTest('the customer-report query builder drops empty date bounds (skipEmpty)', () => {
  const fnBody = salesTransport.slice(salesTransport.indexOf('export function getCustomerSalesReport'))
  assert.match(fnBody, /buildQueryString\(params, \{ skipEmpty: true \}\)/)
})

runTest('the four stat cells render in one row at sm+ (not a permanent 2x2 grid)', () => {
  // A permanent 2x2 grid would be `grid-cols-2` with no wider breakpoint on
  // that same element; the fix adds a `sm:grid-cols-4` (or wider) so the row
  // becomes one line as soon as there's room, matching SupplierPurchasesModal.
  assert.match(modal, /grid (?:shrink-0 )?grid-cols-2 gap-2 sm:grid-cols-4/)
})

runTest('the modal lists individual sale rows, not just totals', () => {
  assert.match(modal, /sales\.map\(\(sale\) =>/)
  assert.match(modal, /receipt_number/)
  assert.match(modal, /branch_name/)
})

runTest('sale rows are paged server-side via PaginationControls, not a full dump', () => {
  assert.match(modal, /<PaginationControls/)
  assert.match(modal, /page_size: pageSize/)
})

runTest('the modal has exactly one live scroll region (parity with the P10-16/20 supplier fix)', () => {
  assert.match(modal, /flex h-full min-h-0 flex-col gap-3/)
  assert.match(modal, /min-h-0 flex-1 overflow-y-auto rounded-xl border border-gray-200/)
})

runTest('dates render day-first 24-hour via the shared formatter, not a raw ISO string', () => {
  assert.match(modal, /fmtDateTime24\(sale\.created_at\)/)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('customerPurchasesReportAllTime tests passed')
