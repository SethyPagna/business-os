// N21 (a2-salesfix lane): the owner saw "[]" and other machine text where a
// sale's customer address should be, and saw the address twice (an Address
// row AND a Delivery address row) in the sale detail.
//
// Cause: customers.address stores the Contact Options JSON that
// cloudflare/src/lib/contactOptions.ts serializes -- an array of
// {label,name,phone,email,address,area} -- and sales.customer_address was
// snapshotted RAW out of that column by every writer (POS checkout, the
// customer link/edit route, the rename/edit cascade, the duplicate merge and
// the bulk customer update). Readers then printed the JSON. Receipt.tsx had
// its OWN half-implementation that did `String(parsed[0])` on that array,
// which is where "[object Object]" came from.
//
// One kernel now answers "what address does a human see", it is duplicated
// BYTE FOR BYTE across the two packages (they share no module), and this test
// compares the two copies character by character as well as exercising the
// behavior on both.
//
// Run: node tests/contactDisplayAddress.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contactDisplayAddress } from '../src/components/contacts/contactOptionUtils.ts'
import { contactDisplayAddress as workerContactDisplayAddress } from '../../cloudflare/src/lib/contactOptions.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

// ---------------------------------------------------------------------------
// 1. Behavior, run on BOTH implementations so a divergence cannot hide.

const OPTIONS_JSON = JSON.stringify([
  { label: 'Default', name: null, phone: '012345678', email: null, address: 'St 271, Phnom Penh', area: null },
  { label: 'Work', name: null, phone: null, email: null, address: 'Toul Kork', area: null },
])

const cases: Array<[unknown, string, string]> = [
  // The shape the owner actually has: an options array renders as the primary
  // address, never as JSON.
  [OPTIONS_JSON, 'St 271, Phnom Penh', 'options JSON -> the primary address'],
  // The owner's literal complaint: an empty options array is NOT "[]".
  ['[]', '', 'an empty options array shows nothing'],
  // A serialized array whose first entry carries no address at all: the first
  // entry that HAS one wins, rather than showing a blank because entry #1 was
  // a phone-only contact.
  [JSON.stringify([{ label: 'Phone only', phone: '011', address: null }, { label: 'Home', address: 'Sen Sok' }]), 'Sen Sok', 'the first entry with an address wins'],
  // Every entry data-free -> nothing, not "[{...}]".
  [JSON.stringify([{ label: 'Phone only', phone: '011', address: null }]), '', 'options with no address at all show nothing'],
  // Legacy array-of-strings rows (collectLegacyContactOptions' input shape).
  ['["St 271","Toul Kork"]', 'St 271', 'a legacy string array -> its first entry'],
  ['["","Toul Kork"]', 'Toul Kork', 'a blank legacy entry is skipped'],
  // The ordinary legacy case: a plain typed address, untouched.
  ['Phnom Penh, Cambodia', 'Phnom Penh, Cambodia', 'a plain address passes through'],
  ['  Phnom Penh  ', 'Phnom Penh', 'a plain address is trimmed'],
  // A house number that happens to be valid JSON must NOT be swallowed.
  ['271', '271', 'a numeric address is still an address'],
  // Truncated machine text -- the other half of the owner's '[{' report.
  ['[{', '', 'truncated options JSON shows nothing, never "[{"'],
  ['{"address":"x"', '', 'truncated object JSON shows nothing'],
  // A bare object is machine text too, not an address.
  ['{"label":"Default","address":"St 271"}', '', 'a bare options object is not a display address'],
  // Emptiness in every form.
  [null, '', 'null -> empty'],
  [undefined, '', 'undefined -> empty'],
  ['', '', 'empty string -> empty'],
  ['   ', '', 'whitespace -> empty'],
]

for (const [input, expected, label] of cases) {
  assert.equal(contactDisplayAddress(input), expected, `frontend: ${label}`)
  assert.equal(workerContactDisplayAddress(input), expected, `worker: ${label}`)
}

// Delivery contacts describe an AREA rather than a street address, and the
// same kernel serves them via its mode argument.
const AREA_JSON = JSON.stringify([{ label: 'Default', area: 'Chamkarmon', address: null }])
assert.equal(contactDisplayAddress(AREA_JSON, 'area'), 'Chamkarmon')
assert.equal(workerContactDisplayAddress(AREA_JSON, 'area'), 'Chamkarmon')
// ...and reading an area row in address mode finds no address, rather than
// falling back to printing the JSON.
assert.equal(contactDisplayAddress(AREA_JSON), '')
assert.equal(workerContactDisplayAddress(AREA_JSON), '')

// ---------------------------------------------------------------------------
// 2. The two copies are byte-identical. A behavioral test alone would let the
//    two drift into "agrees on the cases we thought of".

function extractKernel(source: string): string {
  const start = source.indexOf('export function contactDisplayAddress(')
  assert.ok(start > 0, 'expected contactDisplayAddress in the source')
  const end = source.indexOf('\n}', start)
  assert.ok(end > start, 'expected the function to close')
  return source.slice(start, end + 2).replace(/\r\n/g, '\n')
}

const frontendKernel = extractKernel(read('src/components/contacts/contactOptionUtils.ts'))
const workerKernel = extractKernel(readFileSync(new URL('../../cloudflare/src/lib/contactOptions.ts', import.meta.url), 'utf8'))
assert.equal(
  frontendKernel,
  workerKernel,
  'contactDisplayAddress must be byte-identical in contactOptionUtils.ts and cloudflare/src/lib/contactOptions.ts',
)

// ---------------------------------------------------------------------------
// 3. Every WRITER that snapshots customers.address into a sale goes through
//    the kernel, so new rows are clean at rest.

const worker = (path: string) => readFileSync(new URL(`../../cloudflare/${path}`, import.meta.url), 'utf8')

const salesRoutes = worker('src/routes/sales.ts')
const contactsRoutes = worker('src/routes/contacts.ts')
const bulkUpdate = worker('src/lib/saleBulkUpdate.ts')
const pos = read('src/components/pos/POS.tsx')

// PATCH /api/sales/:id/customer
assert.match(salesRoutes, /customer_address: contactDisplayAddress\(customer\?\.address/, 'the sale customer link must snapshot the display address')
// Duplicate merge, and the rename/edit cascade.
assert.match(contactsRoutes, /keeperAddress: contactDisplayAddress\(keeper\.address/, 'the customer merge must repoint the display address')
assert.match(contactsRoutes, /const customerAddress = contactDisplayAddress\(/, 'the customer edit cascade must write the display address')
// Bulk "set customer on N sales".
assert.match(bulkUpdate, /address: contactDisplayAddress\(/, 'the bulk customer update must snapshot the display address')
// POS checkout.
assert.match(pos, /customer_address: contactDisplayAddress\(active\.customer\.address\)/, 'POS checkout must snapshot the display address')

for (const [label, source] of [['routes/sales.ts', salesRoutes], ['routes/contacts.ts', contactsRoutes], ['lib/saleBulkUpdate.ts', bulkUpdate]] as const) {
  assert.match(source, /contactDisplayAddress/, `${label} must import the kernel`)
}

// ---------------------------------------------------------------------------
// 4. Every READER renders through the kernel too, so the rows already stored
//    stop showing machine text without waiting for a repair.

const receipt = read('src/components/receipt/Receipt.tsx')
// Receipt.tsx's own displayAddress() was a second, WRONG implementation:
// String(parsed[0]) on an options array yields "[object Object]".
assert.doesNotMatch(receipt, /function displayAddress\b/, 'Receipt.tsx must not keep its own address parser')
assert.match(receipt, /const customerAddress = contactDisplayAddress\(sale\.customer_address\)/, 'Receipt.tsx must resolve the address through the kernel')
assert.doesNotMatch(receipt, /value=\{sale\.customer_address\}/, 'no receipt layout may print the raw column')
assert.equal(
  (receipt.match(/value=\{customerAddress\}/g) || []).length,
  2,
  'both receipt layouts (full and compact) must print the resolved address',
)
// The section gate uses the RESOLVED value too: a row holding only "[]"
// resolves to nothing and must not force an empty customer block onto paper.
assert.match(receipt, /const hasCustomer = [^\n]*customerAddress/, 'the customer block must be gated on the resolved address')

const saleDetail = read('src/components/sales/SaleDetailModal.tsx')
assert.match(saleDetail, /const customerAddress = contactDisplayAddress\(sale\.customer_address\)/, 'the sale detail must resolve the address through the kernel')
assert.match(saleDetail, /label=\{t\('address'\) \|\| 'Address'\} value=\{customerAddress\}/, 'the Address row must render the resolved value')

// The sales EXPORT is a reader too -- a CSV cell full of options JSON is the
// same defect in a different container.
assert.match(salesRoutes, /customer_address: index === 0 \? contactDisplayAddress\(sale\.customer_address\)/, 'the sales export must emit the display address')

// ---------------------------------------------------------------------------
// 5. The Customer card shows ONE address row (owner: "just keep address ...
//    because in sales only show address"). The receipt-template delivery
//    toggles are untouched -- this is about the sale detail's Customer card.

assert.doesNotMatch(saleDetail, /delivery_address/, "the Customer card's Delivery address row must be gone")
assert.doesNotMatch(saleDetail, /deliveryAddressToShow/, 'the delivery-address derivation must be gone with its row')
assert.equal(
  (saleDetail.match(/label=\{t\('address'\)/g) || []).length,
  1,
  'the Customer card must carry exactly one address row',
)
// The receipt template's own delivery-address switch is a different surface
// and stays.
assert.match(read('src/components/receipt-settings/constants.ts'), /show_delivery_address|show_customer_address/, 'receipt template toggles stay')

console.log('contactDisplayAddress.test.ts OK')
