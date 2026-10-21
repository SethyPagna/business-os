// Which row a scan singles out (utils/scanExactHit.ts).
//
// The owner rule (2 Sep, still binding): a scan fills the search and the list
// narrows; only a single EXACT barcode match may be highlighted. So the traps
// here are the plausible wrong implementations: a substring check, a name
// match, a leading-zero-blind comparison, and "first of two".
import assert from 'node:assert/strict'
import { findScanHit, isExactBarcodeHit } from '../src/utils/scanExactHit.ts'

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

const DIOR = '3348901729222'

runTest('a longer GTIN that merely contains the scanned code is not a hit', () => {
  const longer = { name: 'Dior Sauvage', barcode: `1${DIOR}` }
  assert.ok(String(longer.barcode).includes(DIOR), 'the fixture is what a naive substring check would accept')
  assert.equal(isExactBarcodeHit(longer, DIOR), false)
  assert.equal(isExactBarcodeHit({ name: 'Dior Sauvage', barcode: DIOR }, `1${DIOR}`), false)
  assert.equal(isExactBarcodeHit({ name: 'Dior Sauvage', barcode: DIOR }, DIOR), true)
})

runTest('a name or a prefix is never a barcode hit', () => {
  assert.equal(isExactBarcodeHit({ name: DIOR, barcode: '9999999999999' }, DIOR), false, 'only the barcode field counts')
  assert.equal(isExactBarcodeHit({ name: 'Dior', barcode: DIOR }, 'dior'), false, 'a word is a name search')
  assert.equal(isExactBarcodeHit({ name: 'x', barcode: DIOR }, DIOR.slice(0, 8)), false, 'a prefix of the code is not the code')
})

runTest('leading zeros fold, so a GTIN-14 row and an EAN-13 scan are the same code', () => {
  assert.equal(isExactBarcodeHit({ barcode: `0${DIOR}` }, DIOR), true)
  assert.equal(isExactBarcodeHit({ barcode: DIOR }, `0${DIOR}`), true)
})

runTest('a UPC-E scan hits the UPC-A row (and the reverse)', () => {
  assert.equal(isExactBarcodeHit({ name: 'Small package', barcode: '012345000065' }, '01234565'), true)
  assert.equal(isExactBarcodeHit({ name: 'Small package', barcode: '01234565' }, '012345000065'), true)
  assert.equal(isExactBarcodeHit({ name: 'Small package', barcode: '1234565' }, '01234565'), false, 'seven digits is not the UPC-E')
})

runTest('a multi-word or comma query is a text search, never a scan', () => {
  assert.equal(isExactBarcodeHit({ barcode: DIOR }, `${DIOR} dior`), false)
  assert.equal(isExactBarcodeHit({ barcode: DIOR }, `${DIOR},4006381333931`), false)
  assert.equal(isExactBarcodeHit({ barcode: DIOR }, ''), false)
  assert.equal(isExactBarcodeHit({ barcode: DIOR }, null), false)
})

runTest('placeholder and empty barcodes never match', () => {
  assert.equal(isExactBarcodeHit({ barcode: '0' }, '0'), false, '238 production rows share the literal "0"')
  assert.equal(isExactBarcodeHit({ barcode: '' }, '000000'), false)
  assert.equal(isExactBarcodeHit({ barcode: null }, DIOR), false)
  assert.equal(isExactBarcodeHit(null, DIOR), false)
})

runTest('one matching child row is singled out together with the group that owns it', () => {
  const groups = [
    { name: 'Dior Sauvage', rows: [{ name: 'Dior Sauvage', barcode: '3348901729000' }, { name: 'Dior Sauvage', barcode: DIOR }] },
    { name: 'Chanel', rows: [{ name: 'Chanel', barcode: '3145891264003' }] },
  ]
  const hit = findScanHit(groups, (group) => group.rows, DIOR)
  assert.equal(hit?.group, groups[0])
  assert.equal(hit?.row, groups[0].rows[1])
})

runTest('two rows sharing the barcode single out nothing, in one group or across two', () => {
  const sameGroup = [{ rows: [{ barcode: DIOR }, { barcode: DIOR }] }]
  assert.equal(findScanHit(sameGroup, (group) => group.rows, DIOR), null)
  const twoGroups = [{ rows: [{ barcode: DIOR }] }, { rows: [{ barcode: `0${DIOR}` }] }]
  assert.equal(findScanHit(twoGroups, (group) => group.rows, DIOR), null, 'the leading-zero twin is the same barcode')
})

runTest('only the child rows count: a group lead that is not among its rows is ignored', () => {
  const lead = { name: 'Dior Sauvage', barcode: DIOR }
  const groups = [{ lead, rows: [{ name: 'Dior Sauvage', barcode: '3348901729000' }] }]
  assert.equal(findScanHit(groups, (group) => group.rows, DIOR), null)
})

runTest('no row, no groups and a non-barcode query give no hit', () => {
  assert.equal(findScanHit([], () => [], DIOR), null)
  assert.equal(findScanHit([{ rows: [{ barcode: '4006381333931' }] }], (group) => group.rows, DIOR), null)
  assert.equal(findScanHit([{ rows: [{ name: 'Dior', barcode: DIOR }] }], (group) => group.rows, 'dior'), null)
})

if (failed > 0) process.exitCode = 1
