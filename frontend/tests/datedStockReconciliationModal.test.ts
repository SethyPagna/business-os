import assert from 'node:assert/strict'
import {
  normalizeHeaderForMatch,
  autoMapHeaders,
  TARGET_FIELDS,
} from '../src/components/products/import/datedStockReconciliationMapping.ts'
import { normalizeToIsoDate } from '../src/utils/batchCode.ts'

// normalizeHeaderForMatch -- lowercases and strips everything but a-z0-9,
// so "Branch Name", "branch_name", and "BRANCH-NAME" all collapse to the
// same comparison key.
assert.equal(normalizeHeaderForMatch('Branch Name'), 'branchname')
assert.equal(normalizeHeaderForMatch('branch_name'), 'branchname')
assert.equal(normalizeHeaderForMatch('BRANCH-NAME'), 'branchname')
assert.equal(normalizeHeaderForMatch(''), '')
assert.equal(normalizeHeaderForMatch(undefined as unknown as string), '')
console.log('PASS normalizeHeaderForMatch collapses case/punctuation/whitespace variants to the same key')

// autoMapHeaders -- every TARGET_FIELDS key has at least one alias, so a
// file whose headers exactly match a common real-world naming should
// auto-map every field.
{
  const headers = ['Date', 'Branch', 'Qty', 'Product Name', 'SKU', 'Barcode', 'Selling Price USD', 'Selling Price KHR']
  const mapping = autoMapHeaders(headers)
  assert.equal(mapping.date, 'Date')
  assert.equal(mapping.branchName, 'Branch')
  assert.equal(mapping.count, 'Qty')
  assert.equal(mapping.productName, 'Product Name')
  assert.equal(mapping.sku, 'SKU')
  assert.equal(mapping.barcode, 'Barcode')
  assert.equal(mapping.sellingPriceUsd, 'Selling Price USD')
  assert.equal(mapping.sellingPriceKhr, 'Selling Price KHR')
  console.log('PASS autoMapHeaders maps every target field when the file uses common real-world header names')
}

// A second common naming convention (underscored, "stock qty" instead of
// "qty", "item" instead of "product name") should map just as well --
// this is the whole point of the alias list, not a one-shot lucky match.
{
  const headers = ['snapshot_date', 'store', 'stock_quantity', 'item_name', 'upc']
  const mapping = autoMapHeaders(headers)
  assert.equal(mapping.date, 'snapshot_date')
  assert.equal(mapping.branchName, 'store')
  assert.equal(mapping.count, 'stock_quantity')
  assert.equal(mapping.productName, 'item_name')
  assert.equal(mapping.barcode, 'upc')
  assert.equal(mapping.sku, undefined)
  console.log('PASS autoMapHeaders also matches a second, differently-worded set of real-world header names')
}

// A header with no recognizable alias (e.g. a stray "Notes" column) is
// left unmapped rather than guessed -- silently mapping the wrong column
// would corrupt every row's data, so "no match" must stay "no match".
{
  const headers = ['Date', 'Branch', 'Qty', 'Notes']
  const mapping = autoMapHeaders(headers)
  assert.equal(mapping.date, 'Date')
  assert.equal(mapping.branchName, 'Branch')
  assert.equal(mapping.count, 'Qty')
  assert.equal(mapping.productName, undefined)
  assert.equal(mapping.sku, undefined)
  assert.equal(mapping.barcode, undefined)
  console.log('PASS autoMapHeaders leaves a field unmapped rather than guessing when no header resembles it')
}

// Ambiguous case: two headers could both plausibly match the same target
// (e.g. "Product" and "Product Name" both look like productName). The
// first one found wins deterministically -- not a hard requirement of the
// UI (the user can always remap by hand), but the behavior must be stable
// across runs rather than flapping.
{
  const headers = ['Product', 'Product Name', 'Date', 'Branch', 'Qty']
  const mapping1 = autoMapHeaders(headers)
  const mapping2 = autoMapHeaders(headers)
  assert.equal(mapping1.productName, mapping2.productName)
  console.log('PASS autoMapHeaders resolves an ambiguous double-candidate header deterministically')
}

// Every TARGET_FIELDS entry is a real, distinct key -- guards against a
// future edit accidentally duplicating or renaming a key without updating
// autoMapHeaders' alias table to match.
{
  const keys = TARGET_FIELDS.map((f) => f.key)
  assert.equal(new Set(keys).size, keys.length)
  const required = TARGET_FIELDS.filter((f) => f.required).map((f) => f.key)
  assert.deepEqual(required, ['date', 'branchName', 'count'])
  console.log('PASS TARGET_FIELDS keys are unique and the required set matches the backend\'s own required fields')
}

// The Count date hint must name the order the backend actually reads.
//
// This screen maps a spreadsheet the shop already owns, so its `date` column
// stays MONTH-first -- the only meaning it has ever had, and re-reading those
// files day-first would rewrite historical stock counts silently
// (cloudflare/src/lib/datedStockCountResolve.ts now states that order rather
// than defaulting into it). The app itself went day-first on Sep 4 2026, so a
// hint reading only "any common date format" became a promise the parser does
// not keep: an operator who types 03/09/2026 into a day-first field elsewhere
// in the app maps a column of those same strings here and gets 9 March.
//
// The assertion is tied to the KERNEL, not to a remembered string: it asks
// normalizeToIsoDate what its default order really does to 03/09/2026 -- both
// fields <= 12, so both orders yield a real date and only the answer separates
// them -- and then requires the hint to advertise that same order. Flip the
// parser without rewriting the hint, or rewrite the hint without the parser,
// and this goes red.
{
  const hint = TARGET_FIELDS.find((f) => f.key === 'date')?.hint || ''
  assert.equal(
    normalizeToIsoDate('03/09/2026'), '2026-03-09',
    'the mapped sheet column is still read month-first -- if this moved, the hint below must move with it',
  )
  assert.ok(hint.includes('mm/dd/yyyy'), `the Count date hint must name the order it is read in, got: ${hint}`)
  assert.ok(!hint.includes('dd/mm/yyyy'), 'and must not also advertise the day-first order it does NOT accept')
  assert.ok(
    !/any common date format/i.test(hint),
    'the old wording promised every format and delivered one; it must not come back',
  )
  // Positive control on the detector: handed the old string, these same two
  // checks must FAIL. A sweep that cannot report a negative proves nothing.
  const old = 'The date this snapshot was taken (any common date format).'
  assert.equal(old.includes('mm/dd/yyyy'), false, 'control: the old hint named no order')
  assert.equal(/any common date format/i.test(old), true, 'control: the old hint is what the pattern catches')
  console.log('PASS the Count date hint names the month-first order its own parser uses')
}

console.log('datedStockReconciliationModal tests passed')
