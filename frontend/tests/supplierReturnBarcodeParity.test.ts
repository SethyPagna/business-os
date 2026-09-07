import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  filterAndRankSupplierReturnProducts,
  supplierReturnProductMatchesSearch,
} from '../src/components/returns/supplierReturnSearch.ts'

const upcE = { id: 1, name: 'UPC item', barcode: '01234565' }
const upcA = { id: 2, name: 'Expanded UPC item', barcode: '012345000065' }
const internal = { id: 3, name: 'Internal item', barcode: '1234565' }
const ean13 = { id: 4, name: 'EAN item', barcode: '3348901770569' }
const gtin14 = { id: 5, name: 'GTIN item', barcode: '03348901770569' }

assert.ok(supplierReturnProductMatchesSearch(upcE, upcA.barcode), 'a scanned UPC-A finds its valid UPC-E form')
assert.ok(supplierReturnProductMatchesSearch(upcA, upcE.barcode), 'a scanned UPC-E finds its valid UPC-A form')
assert.ok(!supplierReturnProductMatchesSearch(upcE, internal.barcode), 'a seven-digit internal code does not collide with UPC-E')
assert.ok(!supplierReturnProductMatchesSearch(internal, upcE.barcode), 'UPC-E does not collide with a seven-digit internal code')
assert.ok(supplierReturnProductMatchesSearch(gtin14, ean13.barcode), 'ordinary GTIN-14/EAN-13 leading-zero twins still match')

assert.deepEqual(
  filterAndRankSupplierReturnProducts([internal, upcE, upcA], upcE.barcode).map((row) => row.id),
  [1, 2],
  'a scan returns only the validated UPC pair and ranks both as barcode identities',
)
assert.deepEqual(
  filterAndRankSupplierReturnProducts([upcE, internal], internal.barcode).map((row) => row.id),
  [3],
  'an internal-code scan returns only the internal-code product',
)

const modal = readFileSync(new URL('../src/components/returns/NewSupplierReturnModal.tsx', import.meta.url), 'utf8')
assert.match(modal, /<ScanSearchButton onDetected=\{setSearch\}/, 'a scan fills the supplier-return search field')
assert.match(modal, /filterAndRankSupplierReturnProducts\(products, search\)/, 'the supplier-return picker uses the guarded search contract')
assert.ok(!/normalizeBarcodeKey\(product\.barcode\) === barcodeKey/.test(modal), 'the picker must not restore stripped-key equality')

console.log('PASS supplierReturnBarcodeParity')
