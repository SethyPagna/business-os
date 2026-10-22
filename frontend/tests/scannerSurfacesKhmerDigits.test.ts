// Khmer digits on the two scanner-adjacent text checks (lane 6.0.934).
//
// With the Windows Khmer keyboard layout a scanner gun types ០-៩ for 0-9. The Stock
// Session "+ Create" row decided "is this a barcode?" with an ASCII-only digit test, so a
// scanned code prefilled the product NAME; the supplier-return picker's partial barcode
// match compared the raw strings, so a Khmer-digit prefix found nothing. Both now fold
// the digits, for the barcode only: a Khmer numeral in a product name stays as typed.
//
// Every check runs and the failures are listed together, so the red on the base commit
// names each broken behaviour. The component-level proof for "+ Create" is
// scannerSurfacesStockSessionCreateMounted.test.ts.
//
// Run: node tests/scannerSurfacesKhmerDigits.test.ts
import assert from 'node:assert/strict'
import {
  filterAndRankSupplierReturnProducts,
  supplierReturnProductMatchesSearch,
} from '../src/components/returns/supplierReturnSearch.ts'

const KHMER_CODE = '៣៣៤៨៩០១៧២៩២២២'
const ASCII_CODE = '3348901729222'
const KHMER_PREFIX = '៣៣៤៨៩០១'
const ASCII_PREFIX = '3348901'
const KHMER_NAME = 'ទឹកអប់ផ្កាម្លិះ ១០០មល'

const failures: string[] = []
function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => {
      failures.push(name)
      console.log(`RED  ${name}\n     ${String((error as Error).message).split('\n')[0]}`)
    },
  )
}

const dior = { id: 1, name: 'Dior Sauvage', barcode: ASCII_CODE }
const stored = { id: 2, name: 'Khmer-stored code', barcode: KHMER_CODE }
const water = { id: 3, name: KHMER_NAME, barcode: '9999999999999' }
const soap = { id: 4, name: 'Soap', barcode: '2002' }
const upcE = { id: 5, name: 'UPC item', barcode: '01234565' }

await check('supplier return: a Khmer-digit PREFIX of a barcode finds the product', () => {
  assert.equal(supplierReturnProductMatchesSearch(dior, ASCII_PREFIX), true, 'control: the ASCII prefix matches')
  assert.equal(supplierReturnProductMatchesSearch(dior, KHMER_PREFIX), true)
  assert.equal(supplierReturnProductMatchesSearch(dior, '៤៨៩០១'), true, 'a middle slice too')
})

await check('supplier return: a barcode stored with Khmer digits is found by an ASCII prefix', () => {
  assert.equal(supplierReturnProductMatchesSearch(stored, ASCII_PREFIX), true)
  assert.equal(supplierReturnProductMatchesSearch(stored, KHMER_PREFIX), true)
})

await check('supplier return: the full Khmer code still finds the ASCII product (exact path, unchanged)', () => {
  assert.equal(supplierReturnProductMatchesSearch(dior, KHMER_CODE), true)
  assert.deepEqual(filterAndRankSupplierReturnProducts([soap, dior, stored], KHMER_CODE).map((row) => row.id), [1, 2])
})

await check('supplier return: ranked list for a Khmer prefix keeps the barcode matches and drops the rest', () => {
  assert.deepEqual(filterAndRankSupplierReturnProducts([soap, dior, water, stored], KHMER_PREFIX).map((row) => row.id).sort(), [1, 2])
})

await check('supplier return: names are not folded (a Khmer numeral in a name stays as typed)', () => {
  assert.equal(supplierReturnProductMatchesSearch(water, '១០០'), true, 'the same Khmer numerals find the name')
  assert.equal(supplierReturnProductMatchesSearch(water, '100'), false, 'an ASCII 100 does not reach into the name')
  assert.equal(supplierReturnProductMatchesSearch(soap, '១០០'), false, 'and 100 is not in the barcode 2002 either')
})

await check('supplier return: the UPC-E guard on the partial path holds for Khmer digits exactly as for ASCII', () => {
  assert.equal(supplierReturnProductMatchesSearch(upcE, '123456'), false, 'control: a seven-digit slice of a valid UPC-E is not an identity')
  assert.equal(supplierReturnProductMatchesSearch(upcE, '១២៣៤៥៦'), false)
})

const seed = await import('../src/utils/stockSessionCreateSeed.ts').catch(() => null)

await check('+ Create: a Khmer-digit barcode prefills the barcode field, folded to ASCII, not the name', () => {
  assert.ok(seed, 'src/utils/stockSessionCreateSeed.ts exists')
  assert.deepEqual(seed.createFormSeed(KHMER_CODE, ''), { name: '', barcode: ASCII_CODE })
  assert.deepEqual(seed.createFormSeed('33៤8៩០1៧2៩222', ''), { name: '', barcode: ASCII_CODE }, 'a half-Khmer burst too')
})

await check('+ Create: the existing rules are unchanged', () => {
  assert.ok(seed)
  assert.deepEqual(seed.createFormSeed(ASCII_CODE, ''), { name: '', barcode: ASCII_CODE })
  assert.deepEqual(seed.createFormSeed('123456', ''), { name: '', barcode: '123456' }, 'six digits is the threshold')
  assert.deepEqual(seed.createFormSeed('12345', ''), { name: '12345', barcode: '' }, 'five is a name')
  assert.deepEqual(seed.createFormSeed('Dior Sauvage', ''), { name: 'Dior Sauvage', barcode: '' })
  assert.deepEqual(seed.createFormSeed('AB-12345', 'AB-12345'), { name: '', barcode: 'AB-12345' }, 'a code the scanner read is a barcode whatever it spells')
  assert.deepEqual(seed.createFormSeed('AB-12345', ''), { name: 'AB-12345', barcode: '' }, 'typed, it is a name')
  assert.deepEqual(seed.createFormSeed('AB-12345', 'XY-1'), { name: 'AB-12345', barcode: '' }, 'a scan of something else does not make this text a barcode')
})

await check('+ Create: Khmer text and short Khmer numbers stay names, unfolded', () => {
  assert.ok(seed)
  assert.deepEqual(seed.createFormSeed(KHMER_NAME, ''), { name: KHMER_NAME, barcode: '' })
  assert.deepEqual(seed.createFormSeed('១២៣', ''), { name: '១២៣', barcode: '' }, 'under six digits it is a name and is not rewritten')
})

if (failures.length) {
  console.log(`\n${failures.length} red: ${failures.join(' | ')}`)
  process.exitCode = 1
}
