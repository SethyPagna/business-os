import assert from 'node:assert/strict'
import {
  normalizeHeaderForMatch,
  autoMapHeaders,
  getUnmetRequiredFields,
  applyAddSaleMapping,
  TARGET_FIELDS,
} from '../src/components/products/import/addSaleImportMapping.ts'

// normalizeHeaderForMatch -- lowercases and strips everything but
// a-z0-9, so differently-punctuated headers collapse to the same key.
assert.equal(normalizeHeaderForMatch('Stock Quantity'), 'stockquantity')
assert.equal(normalizeHeaderForMatch('stock_quantity'), 'stockquantity')
assert.equal(normalizeHeaderForMatch('STOCK-QUANTITY'), 'stockquantity')
assert.equal(normalizeHeaderForMatch(''), '')
console.log('PASS normalizeHeaderForMatch collapses case/punctuation/whitespace variants to the same key')

// autoMapHeaders -- a file using the app's own template column names
// should auto-map every field, required and optional alike.
{
  const headers = [
    'Product name', 'Barcode', 'Branch', 'Stock quantity',
    'Selling price (USD)', 'Selling price (KHR)', 'SKU',
    'Cost price (USD)', 'Cost price (KHR)', 'Sale group', 'Customer/member',
    'Discount', 'Fees',
  ]
  const mapping = autoMapHeaders(headers)
  assert.equal(mapping.name, 'Product name')
  assert.equal(mapping.barcode, 'Barcode')
  assert.equal(mapping.branch, 'Branch')
  assert.equal(mapping.quantity, 'Stock quantity')
  assert.equal(mapping.sellingPriceUsd, 'Selling price (USD)')
  assert.equal(mapping.sellingPriceKhr, 'Selling price (KHR)')
  assert.equal(mapping.sku, 'SKU')
  assert.equal(mapping.costPriceUsd, 'Cost price (USD)')
  assert.equal(mapping.costPriceKhr, 'Cost price (KHR)')
  assert.equal(mapping.action, 'Sale group')
  assert.equal(mapping.customer, 'Customer/member')
  assert.equal(mapping.discount, 'Discount')
  assert.equal(mapping.fees, 'Fees')
  console.log('PASS autoMapHeaders maps every target field when the file uses the app\'s own template names')
}

// A second, differently-worded real-world header set should map just
// as well via the alias list.
{
  const headers = ['item_name', 'upc', 'store', 'qty', 'price']
  const mapping = autoMapHeaders(headers)
  assert.equal(mapping.name, 'item_name')
  assert.equal(mapping.barcode, 'upc')
  assert.equal(mapping.branch, 'store')
  assert.equal(mapping.quantity, 'qty')
  assert.equal(mapping.sellingPriceUsd, 'price')
  assert.equal(mapping.sku, undefined)
  console.log('PASS autoMapHeaders also matches a second, differently-worded set of real-world header names')
}

// An unrecognizable stray column is left unmapped rather than guessed.
{
  const headers = ['Product name', 'Barcode', 'Branch', 'Stock quantity', 'Notes']
  const mapping = autoMapHeaders(headers)
  assert.equal(mapping.name, 'Product name')
  assert.equal(mapping.sku, undefined)
  assert.equal(mapping.action, undefined)
  console.log('PASS autoMapHeaders leaves a field unmapped rather than guessing when no header resembles it')
}

// getUnmetRequiredFields -- a fully-mapped required set plus at least
// one selling price column reports nothing missing.
{
  const mapping = { name: 'A', barcode: 'B', branch: 'C', quantity: 'D', sellingPriceUsd: 'E' }
  assert.deepEqual(getUnmetRequiredFields(mapping), [])
  console.log('PASS getUnmetRequiredFields reports nothing missing once every required field + a selling price is mapped')
}

// getUnmetRequiredFields -- missing a hard-required field is reported
// by label.
{
  const mapping = { name: 'A', barcode: 'B', quantity: 'D', sellingPriceUsd: 'E' } // no branch
  const missing = getUnmetRequiredFields(mapping)
  assert.ok(missing.includes('Branch'))
  console.log('PASS getUnmetRequiredFields reports a missing hard-required field by label')
}

// getUnmetRequiredFields -- neither selling-price column mapped is
// reported as its own "at least one of" requirement, distinct from any
// single required field.
{
  const mapping = { name: 'A', barcode: 'B', branch: 'C', quantity: 'D' } // no selling price at all
  const missing = getUnmetRequiredFields(mapping)
  assert.ok(missing.includes('Selling price (USD or KHR)'))
  console.log('PASS getUnmetRequiredFields flags a missing selling price even though neither currency field is individually required')
}

// getUnmetRequiredFields -- KHR alone satisfies the selling-price group
// just as well as USD alone.
{
  const mapping = { name: 'A', barcode: 'B', branch: 'C', quantity: 'D', sellingPriceKhr: 'F' }
  assert.deepEqual(getUnmetRequiredFields(mapping), [])
  console.log('PASS getUnmetRequiredFields treats KHR-only selling price as satisfying the requirement')
}

// TARGET_FIELDS -- unique keys, and the hard-required set matches the
// spec's stated minimum columns exactly (selling price is intentionally
// NOT in this list -- it's covered by the separate "at least one of"
// check above, not a plain required field).
{
  const keys = TARGET_FIELDS.map((f) => f.key)
  assert.equal(new Set(keys).size, keys.length)
  const required = TARGET_FIELDS.filter((f) => f.required).map((f) => f.key)
  assert.deepEqual(required, ['name', 'barcode', 'branch', 'quantity'])
  console.log('PASS TARGET_FIELDS keys are unique and the required set matches the spec\'s minimum columns')
}

// applyAddSaleMapping -- converts raw rows into AddSaleImportRow shape
// using the confirmed mapping, translating camelCase target keys to the
// snake_case fields addSaleImportResolve.ts's functions expect.
{
  const rawRows = [
    {
      'Product name': 'Serum', Barcode: 'BC-1', Branch: 'Main', 'Stock quantity': '3',
      'Selling price (USD)': '25', 'Cost price (USD)': '10', 'Sale group': 'sale1',
    },
    {
      'Product name': 'Toner', Barcode: 'BC-2', Branch: 'Main', 'Stock quantity': '1',
      'Selling price (USD)': '15',
    },
  ]
  const mapping = autoMapHeaders(Object.keys(rawRows[0]))
  const rows = applyAddSaleMapping(rawRows, mapping)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].name, 'Serum')
  assert.equal(rows[0].barcode, 'BC-1')
  assert.equal(rows[0].branch, 'Main')
  assert.equal(rows[0].quantity, '3')
  assert.equal(rows[0].selling_price_usd, '25')
  assert.equal(rows[0].cost_price_usd, '10')
  assert.equal(rows[0].action, 'sale1')
  // Row 2 never had a "Sale group"/"Cost price" cell at all -- those
  // fields are simply absent, not coerced to null or empty string.
  assert.equal(rows[1].action, undefined)
  assert.equal(rows[1].cost_price_usd, undefined)
  console.log('PASS applyAddSaleMapping converts raw mapped rows into AddSaleImportRow shape, leaving unmapped/blank fields unset')
}

// applyAddSaleMapping -- a target field with no mapped header at all is
// simply never set on any row (not even as undefined-but-present),
// same "no match stays no match" principle as autoMapHeaders itself.
{
  const rawRows = [{ Name: 'Serum', Code: 'BC-1' }]
  const mapping = { name: 'Name', barcode: 'Code' } // no branch/quantity/price mapped
  const rows = applyAddSaleMapping(rawRows, mapping)
  assert.equal(rows[0].name, 'Serum')
  assert.equal(rows[0].barcode, 'BC-1')
  assert.equal('branch' in rows[0], false)
  assert.equal('quantity' in rows[0], false)
  console.log('PASS applyAddSaleMapping leaves a target field entirely unset when it has no mapped header')
}

console.log('addSaleImportMapping tests passed')
