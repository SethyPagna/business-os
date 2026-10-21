// Lane 6.0.927: 6.0.921 folded the Khmer digits a Windows-Khmer-layout scanner
// gun types (០-៩) in searchMatch.ts, but the shared search core
// (utils/searchCore.ts, a byte copy of the Worker's lib/searchCore.ts) kept its
// own code keys. The in-memory pickers built on utils/rowSearch.ts (Transfer,
// duplicates review) therefore missed a Khmer scan, and the product index could
// answer it with a name hit before the server fallback ran. Code keys and code
// texts now fold; name matching never does.
//
// Every check runs and the failures are listed together, so the red on the
// base commit names each broken behaviour instead of stopping at the first.
//
// Run: node tests/searchCoreKhmerDigits.test.ts
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as frontendCore from '../src/utils/searchCore.ts'
import { createRowSearch } from '../src/utils/rowSearch.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const workerPath = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'searchCore.ts')
const workerCore = (await import(pathToFileURL(workerPath).href)) as typeof frontendCore
assert.notEqual(workerCore, frontendCore, 'the two copies are loaded as separate modules')

const KHMER_CODE = '៣៣៤៨៩០១៧២៩២២២'
const MIXED_CODE = '33៤8៩០1៧2៩222'
const ASCII_CODE = '3348901729222'
const KHMER_PARTIAL = '១៧២៩២២២'
const NAME_KHMER_DIGITS = 'ទឹកអប់ផ្កាម្លិះ ១០០មល'
const NAME_ASCII_DIGITS = 'ទឹកអប់ផ្កាម្លិះ 100មល'

type Row = { id: number; name: string; brand?: string; barcode?: string; sku?: string }
const rows: Row[] = [
  { id: 1, name: 'Dior Backstage Highlighter', barcode: ASCII_CODE },
  { id: 2, name: 'Other product', barcode: '3348901729223' },
  { id: 3, name: NAME_KHMER_DIGITS, barcode: '4006381333931' },
  { id: 4, name: NAME_ASCII_DIGITS, barcode: '4006381333932' },
  { id: 5, name: 'Padded twin', barcode: `0${ASCII_CODE}` },
  { id: 6, name: 'Stored in Khmer digits', barcode: '៥៥៥៥១២៣៤៩' },
  { id: 7, name: 'UPC-E twin', barcode: '01234565' },
  { id: 8, name: 'UPC-A twin', barcode: '012345000065' },
  { id: 9, name: 'Seven digit lookalike', barcode: '1234565' },
  { id: 10, name: 'Lip serum', sku: 'AB-12345' },
  { id: 11, name: 'ក្រែម ១២៣៤៥', barcode: '9990000000001' },
  { id: 12, name: 'Cream 12345', barcode: '9990000000002' },
  { id: 13, name: `ក្រែម ${KHMER_CODE}`, barcode: '9990000000003' },
]

const failures: string[] = []
function check(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`RED  ${name}\n     ${String((error as Error).message).split('\n')[0]}`)
  }
}

for (const [label, core] of [['frontend', frontendCore], ['worker', workerCore]] as const) {
  const index = core.buildTermIndex(rows)
  const ids = (query: string, options?: frontendCore.SearchOptions): number[] => core.searchTermIndex(index, query, options).hits.map((hit) => hit.id)
  const exactIds = (query: string): number[] => core.searchTermIndex(index, query).hits.filter((hit) => hit.tier === core.SEARCH_TIER_EXACT_CODE).map((hit) => hit.id).sort((a, b) => a - b)

  check(`${label}: a Khmer scan has the same code keys as the ASCII code`, () => {
    assert.deepEqual(core.codeKeys(ASCII_CODE), [ASCII_CODE], 'positive control')
    assert.deepEqual(core.codeKeys(KHMER_CODE), core.codeKeys(ASCII_CODE))
    assert.deepEqual(core.codeKeys(MIXED_CODE), core.codeKeys(ASCII_CODE))
    assert.deepEqual(core.codeKeys(' ៣៣៤៨-៩០១ ៧២៩២២២ '), [ASCII_CODE], 'separators and padding are ignored as before')
    assert.deepEqual(core.codeKeys(`០${KHMER_CODE}`), [ASCII_CODE], 'a Khmer leading zero strips like ASCII 0')
    assert.deepEqual(core.codeKeys('០០០០'), [], 'an all-zero Khmer placeholder is not a code')
    assert.deepEqual(core.codeKeys('១២៣'), [], 'under four characters is not a code')
  })

  check(`${label}: queryCodeKeys treats a lone Khmer scan as a code and anything wider as text`, () => {
    assert.deepEqual(core.queryCodeKeys(KHMER_CODE), [ASCII_CODE])
    assert.deepEqual(core.queryCodeKeys(`  ${KHMER_CODE}  `), [ASCII_CODE])
    assert.deepEqual(core.queryCodeKeys(`${KHMER_CODE} dior`), [])
    assert.deepEqual(core.queryCodeKeys(`${KHMER_CODE},${ASCII_CODE}`), [])
  })

  check(`${label}: UPC-E and UPC-A pairing runs on the folded value, collision guard intact`, () => {
    assert.ok(core.codeKeys('០១២៣៤៥៦៥').includes('upca:012345000065'))
    assert.deepEqual(core.codeKeys('០១២៣៤៥៦៥'), core.codeKeys('01234565'))
    assert.equal(core.codeKeySetsMatch(core.codeKeys('០១២៣៤៥៦៥'), core.codeKeys('012345000065')), true)
    assert.equal(core.codeKeySetsMatch(core.codeKeys('០១២៣៤៥៦៥'), core.codeKeys('1234565')), false, 'valid UPC-E never collides with a 7-digit code')
  })

  check(`${label}: the index answers a Khmer scan with the exact-code tier, same as the ASCII scan`, () => {
    assert.deepEqual(exactIds(ASCII_CODE), [1, 5], 'positive control: the ASCII scan finds the code and its zero-padded twin')
    assert.deepEqual(exactIds(KHMER_CODE), [1, 5])
    assert.deepEqual(exactIds(MIXED_CODE), [1, 5])
    assert.deepEqual(exactIds(`០${KHMER_CODE}`), [1, 5], 'Khmer leading zero folds before the zero strip')
    assert.deepEqual(exactIds('៣៣៤៨៩០១៧២៩២២៣'), [2], 'a different Khmer code finds only its own row')
  })

  check(`${label}: a Khmer scan ranks the barcode row ahead of a name that carries the same digits`, () => {
    const ranked = ids(KHMER_CODE)
    assert.deepEqual(ranked.slice(0, 2).sort((a, b) => a - b), [1, 5], 'the barcode rows lead, not the Khmer-numbered name')
    assert.equal(ranked[2], 13, 'the name hit is still a candidate (name matching is unchanged)')
  })

  check(`${label}: a partial Khmer scan reaches the ASCII barcode through the code-text path`, () => {
    assert.deepEqual(ids('1729222').sort((a, b) => a - b), [1, 5], 'positive control: the partial ASCII scan')
    assert.deepEqual(ids(KHMER_PARTIAL).sort((a, b) => a - b), [1, 5, 13], 'the barcode rows plus the name that carries those Khmer digits; the …2223 code is not matched')
    assert.ok(ids('ab១២៣៤៥').includes(10), 'a Khmer-digit tail on a letter sku folds too')
  })

  check(`${label}: an ASCII scan finds a barcode stored in Khmer digits`, () => {
    assert.deepEqual(exactIds('555512349'), [6])
    assert.ok(ids('55551').includes(6), 'and so does its partial scan')
    assert.deepEqual(exactIds('៥៥៥៥១២៣៤៩'), [6], 'the Khmer-digit twin of that code too')
  })

  check(`${label}: guard: Khmer names and Khmer digits in names match by name exactly as before`, () => {
    assert.deepEqual(ids('ទឹកអប់ផ្កាម្លិះ').sort((a, b) => a - b), [3, 4], 'Khmer words reach both names')
    assert.deepEqual(ids('១០០មល'), [3], 'a Khmer-digit name word reaches only the Khmer-numbered name')
    assert.deepEqual(ids('100មល'), [4], 'an ASCII-digit name word reaches only the ASCII-numbered name')
    assert.ok(!ids('១២៣៤៥').includes(12), 'Khmer digits never reach ASCII digits in a name')
    assert.ok(ids('១២៣៤៥').includes(11), 'Khmer digits still reach the Khmer-numbered name')
    assert.ok(!ids('12345').includes(11), 'ASCII digits never reach Khmer digits in a name')
    assert.ok(ids('12345').includes(12))
    assert.equal(core.normalize(NAME_KHMER_DIGITS), 'ទឹកអប់ផ្កាម្លិះ ១០០មល', 'normalize leaves Khmer digits as typed')
  })

  check(`${label}: a Khmer scan with titleOnly never reads the codes`, () => {
    assert.ok(!ids(KHMER_CODE, { titleOnly: true }).includes(1))
    assert.ok(ids(KHMER_CODE, { titleOnly: true }).includes(13))
  })
}

check('frontend and worker copies agree on every Khmer probe', () => {
  const probes = [KHMER_CODE, MIXED_CODE, ASCII_CODE, KHMER_PARTIAL, '០១២៣៤៥៦៥', ' ១២៣៤ ', NAME_KHMER_DIGITS, '១០០មល', '', null, undefined]
  for (const probe of probes) {
    assert.deepEqual(frontendCore.codeKeys(probe), workerCore.codeKeys(probe), `codeKeys(${String(probe)})`)
    assert.deepEqual(frontendCore.queryCodeKeys(probe), workerCore.queryCodeKeys(probe), `queryCodeKeys(${String(probe)})`)
  }
  const frontendIndex = frontendCore.buildTermIndex(rows)
  const workerIndex = workerCore.buildTermIndex(rows)
  for (const probe of probes) {
    assert.deepEqual(frontendCore.searchTermIndex(frontendIndex, probe), workerCore.searchTermIndex(workerIndex, probe), `searchTermIndex(${String(probe)})`)
  }
})

const search = createRowSearch(rows, (row) => ({ name: row.name, brand: row.brand, barcode: row.barcode, sku: row.sku }))
const namesOf = (query: string): string[] => search(query).map((row) => row.name)

check('rowSearch: a Khmer scan finds the ASCII-barcode row, best first', () => {
  const leading = (query: string): number[] => search(query).slice(0, 2).map((row) => row.id).sort((a, b) => a - b)
  assert.deepEqual(leading(ASCII_CODE), [1, 5], 'positive control: the ASCII scan finds the code and its zero-padded twin')
  assert.deepEqual(leading(KHMER_CODE), [1, 5])
  assert.deepEqual(leading(MIXED_CODE), [1, 5])
  assert.equal(search(KHMER_CODE)[2].id, 13, 'the Khmer-numbered name comes after the barcode rows')
  assert.equal(search('៣៣៤៨៩០១៧២៩២២៣')[0].id, 2)
  assert.deepEqual(search(KHMER_PARTIAL).map((row) => row.id).sort((a, b) => a - b), [1, 5, 13])
})

check('rowSearch: a Khmer scan of a UPC-E code reaches both of its stored forms', () => {
  assert.deepEqual(search('០១២៣៤៥៦៥').slice(0, 2).map((row) => row.id).sort((a, b) => a - b), [7, 8])
  assert.ok(!search('០១២៣៤៥៦៥').slice(0, 2).some((row) => row.id === 9), 'the 7-digit lookalike is not a pair')
})

check('rowSearch: guard: Khmer name searches and the empty query behave as before', () => {
  assert.deepEqual(namesOf('ទឹកអប់ផ្កាម្លិះ').sort(), [NAME_ASCII_DIGITS, NAME_KHMER_DIGITS].sort())
  assert.deepEqual(namesOf('១០០មល'), [NAME_KHMER_DIGITS])
  assert.equal(search('').length, rows.length, 'an empty query returns every row')
  assert.equal(search('   ').length, rows.length)
})

if (failures.length) {
  console.log(`\n${failures.length} red: ${failures.join(' | ')}`)
  process.exit(1)
}
console.log('searchCoreKhmerDigits: all checks passed')
