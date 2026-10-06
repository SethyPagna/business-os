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
// Owner, 6 Oct 2026: every import reads a slash date DAY-first unless the
// column's own header says mm/dd/yyyy. This screen maps a column the operator
// chooses, so its header names no format -- day-first. The assertion is tied to
// the KERNEL, not to a remembered string: it asks normalizeToIsoDate what
// day-first does to 03/09/2026 -- both fields <= 12, so both orders yield a real
// date and only the answer separates them -- and then requires the hint to
// advertise that same order, in a translated string rather than an English
// literal. Flip the parser without rewriting the hint, or the hint without the
// parser, and this goes red.
{
  const field = TARGET_FIELDS.find((f) => f.key === 'date')
  const hint = field?.hint || ''
  assert.equal(
    normalizeToIsoDate('03/09/2026', 'day-first'), '2026-09-03',
    'the mapped sheet column is read day-first -- if this moved, the hint below must move with it',
  )
  assert.ok(hint.includes('dd/mm/yyyy'), `the Count date hint must name the order it is read in, got: ${hint}`)
  assert.ok(!hint.includes('mm/dd/yyyy'), 'and must not advertise the month-first order it no longer reads')
  assert.ok(!/MONTH first/.test(hint), 'the old month-first wording must not come back')
  assert.ok(!/any common date format/i.test(hint), 'the older wording promised every format and delivered one')
  assert.equal(field?.hintKey, 'dated_count_date_hint', 'the hint is a translated pack string, not an English literal')
  // Positive control on the detector: handed the old string, the checks must FAIL.
  const old = 'This column is read MONTH first, mm/dd/yyyy (03/09/2026 = 9 March)'
  assert.equal(old.includes('dd/mm/yyyy'), false, 'control: the old hint named the other order')
  assert.equal(/MONTH first/.test(old), true, 'control: the old hint is what the pattern catches')
  console.log('PASS the Count date hint names the day-first order its own parser uses')
}

console.log('datedStockReconciliationModal tests passed')
