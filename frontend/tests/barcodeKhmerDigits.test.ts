// Lane S3: with the Windows Khmer keyboard layout active a USB scanner gun
// types Khmer digits (០-៩), so a scan matched no barcode. Barcode keys now fold
// them to ASCII; the leading-zero and UPC-E/UPC-A folding run on the folded
// value, and name matching of Khmer text is untouched.
//
// Every check runs and the failures are listed together, so the red on the
// base commit names each broken behaviour instead of stopping at the first.
// The Worker half is cloudflare/scripts/test-barcode-khmer-digits-pure.cjs.
//
// Run: node tests/barcodeKhmerDigits.test.ts
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as frontend from '../src/utils/searchMatch.ts'

type SearchModule = typeof frontend & { foldNativeDigits?: (value: unknown) => string }
type WorkerModule = SearchModule & { buildExactBarcodeMatchClause: (rawQuery: unknown, params: Record<string, unknown>) => string | undefined }

const here = path.dirname(fileURLToPath(import.meta.url))
const workerPath = path.join(here, '..', '..', 'cloudflare', 'src', 'lib', 'searchMatch.ts')
const worker = (await import(pathToFileURL(workerPath).href)) as WorkerModule
assert.notEqual(worker, frontend, 'the two copies are loaded as separate modules')

const KHMER_CODE = '៣៣៤៨៩០១៧២៩២២២'
const MIXED_CODE = '33៤8៩០1៧2៩222'
const ASCII_CODE = '3348901729222'
const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩'
const NAME = 'ទឹកអប់ផ្កាម្លិះ ១០០មល'

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

for (const [label, search] of [['frontend', frontend as SearchModule], ['worker', worker]] as const) {
  check(`${label}: foldNativeDigits maps ០-៩ to 0-9 and leaves everything else alone`, () => {
    assert.equal(typeof search.foldNativeDigits, 'function', 'foldNativeDigits is exported')
    assert.equal(search.foldNativeDigits!(KHMER_DIGITS), '0123456789')
    assert.equal(search.foldNativeDigits!('ab-១២ ៣x'), 'ab-12 3x')
    assert.equal(search.foldNativeDigits!(NAME), 'ទឹកអប់ផ្កាម្លិះ 100មល', 'letters and marks are untouched')
    assert.equal(search.foldNativeDigits!(null), '')
    assert.equal(search.foldNativeDigits!(undefined), '')
    assert.equal(search.foldNativeDigits!(12345), '12345')
  })

  check(`${label}: Khmer scan has the same barcode keys as the ASCII code`, () => {
    assert.deepEqual(search.barcodeSearchKeys(KHMER_CODE), search.barcodeSearchKeys(ASCII_CODE))
    assert.deepEqual(search.barcodeSearchKeys(KHMER_CODE), [ASCII_CODE])
    assert.equal(search.normalizeBarcodeKey(KHMER_CODE), ASCII_CODE)
    assert.deepEqual(search.searchTermBarcodeKeys(KHMER_CODE), [ASCII_CODE])
    assert.equal(search.searchTermBarcodeKey(KHMER_CODE), ASCII_CODE)
    assert.equal(search.barcodeKeysMatch(KHMER_CODE, ASCII_CODE), true)
    assert.equal(search.barcodeKeysMatch(ASCII_CODE, KHMER_CODE), true)
  })

  check(`${label}: a mixed Khmer/ASCII scan folds too`, () => {
    assert.deepEqual(search.barcodeSearchKeys(MIXED_CODE), search.barcodeSearchKeys(ASCII_CODE))
    assert.equal(search.barcodeKeysMatch(MIXED_CODE, ASCII_CODE), true)
  })

  check(`${label}: separators and padding around a Khmer scan are ignored as before`, () => {
    assert.equal(search.normalizeBarcodeKey(' ៣៣៤៨-៩០១ ៧២៩២២២ '), ASCII_CODE)
    assert.equal(search.barcodeKeysMatch('០៣៣៤៨៩០១៧២៩២២២', ASCII_CODE), true, 'Khmer leading zero strips like ASCII 0')
    assert.equal(search.barcodeKeysMatch('០០០១២៣៤', '1234'), true)
    assert.equal(search.normalizeBarcodeKey('០០០០'), '', 'an all-zero Khmer placeholder is not a real barcode')
    assert.equal(search.normalizeBarcodeKey('១២៣'), '', 'under four characters is still not a real barcode')
  })

  check(`${label}: UPC-E and UPC-A pairing runs on the folded value, collision guard intact`, () => {
    assert.equal(search.barcodeKeysMatch('០១២៣៤៥៦៥', '012345000065'), true, 'Khmer UPC-E reaches its UPC-A')
    assert.equal(search.barcodeKeysMatch('០១២៣៤៥០០០០៦៥', '01234565'), true, 'Khmer UPC-A reaches its UPC-E')
    assert.ok(search.barcodeSearchKeys('០១២៣៤៥៦៥').includes('upca:012345000065'))
    assert.equal(search.barcodeKeysMatch('០១២៣៤៥៦៥', '1234565'), false, 'valid UPC-E never collides with an unrelated 7-digit code')
    assert.equal(search.barcodeKeysMatch('១២៣៤៥៦៥', '01234565'), false, 'collision guard is symmetric')
  })

  check(`${label}: a different Khmer code does not match`, () => {
    assert.equal(search.barcodeKeysMatch(KHMER_CODE, '3348901729223'), false)
    assert.equal(search.barcodeKeysMatch('៣៣៤៨៩០១៧២៩២២៣', ASCII_CODE), false)
  })
}

check('frontend: matchesSearchTermGroups keeps the ASCII-barcode row for a Khmer scan', () => {
  const row = ['Dior Backstage Highlighter', ASCII_CODE]
  assert.equal(frontend.matchesSearchTermGroups(row, [KHMER_CODE]), true)
  assert.equal(frontend.matchesSearchTermGroups(row, [MIXED_CODE]), true)
  assert.equal(frontend.matchesSearchTermGroups(['Dior Backstage Highlighter', '3348901729223'], [KHMER_CODE]), false, 'a different barcode is still dropped')
  assert.equal(frontend.fuzzyTextMatches(ASCII_CODE, KHMER_CODE), true)
})

check('frontend: a stored Khmer-digit barcode matches an ASCII scan and the reverse', () => {
  assert.equal(frontend.matchesSearchTermGroups(['Dior Backstage Highlighter', KHMER_CODE], [ASCII_CODE]), true)
  assert.ok(frontend.buildHaystackIndex('x', KHMER_CODE).barcodeKeys.includes(ASCII_CODE))
})

check('frontend: relevance puts the exact-barcode row first for a Khmer scan', () => {
  assert.equal(frontend.searchRelevanceTier({ name: 'Dior Backstage Highlighter', barcode: ASCII_CODE }, KHMER_CODE), frontend.MATCH_TIER_EXACT_BARCODE)
  assert.notEqual(frontend.searchRelevanceTier({ name: 'Dior Backstage Highlighter', barcode: '3348901729223' }, KHMER_CODE), frontend.MATCH_TIER_EXACT_BARCODE)
  const rows = [{ name: 'Other', barcode: '3348901729223' }, { name: 'Wanted', barcode: ASCII_CODE }]
  assert.equal(frontend.sortBySearchRelevance(rows, KHMER_CODE)[0].name, 'Wanted')
  assert.equal(frontend.sortExactBarcodeFirst(rows, KHMER_CODE)[0].name, 'Wanted')
})

check('worker: the exact-barcode SQL clause binds the folded code', () => {
  const khmerParams: Record<string, unknown> = {}
  const asciiParams: Record<string, unknown> = {}
  const khmerClause = worker.buildExactBarcodeMatchClause(KHMER_CODE, khmerParams)
  const asciiClause = worker.buildExactBarcodeMatchClause(ASCII_CODE, asciiParams)
  assert.ok(khmerClause, 'a Khmer-digit scan is a barcode lookup')
  assert.equal(khmerParams.barcodeKey, ASCII_CODE)
  assert.equal(khmerClause, asciiClause)
  assert.deepEqual(khmerParams, asciiParams)
})

check('frontend and worker agree on every probe', () => {
  const probes = [KHMER_CODE, MIXED_CODE, ASCII_CODE, KHMER_DIGITS, '០១២៣៤៥៦៥', '០៣៣៤៨៩០១៧០៥៦៩', ' ១២៣៤ ', NAME, '', null, undefined]
  for (const probe of probes) {
    assert.deepEqual(frontend.barcodeSearchKeys(probe), worker.barcodeSearchKeys(probe), `barcodeSearchKeys(${String(probe)})`)
    assert.equal(frontend.normalizeBarcodeKey(probe), worker.normalizeBarcodeKey(probe), `normalizeBarcodeKey(${String(probe)})`)
    assert.deepEqual(frontend.searchTermBarcodeKeys(probe), worker.searchTermBarcodeKeys(probe), `searchTermBarcodeKeys(${String(probe)})`)
  }
})

check('guard: Khmer text and Khmer digits in a product name match by name exactly as before', () => {
  const row = [NAME, '4006381333931']
  assert.equal(frontend.matchesSearchTermGroups(row, ['១០០មល']), true, 'Khmer-digit word in the name still matches')
  assert.equal(frontend.matchesSearchTermGroups(row, ['ទឹកអប់ ១០០']), true, 'Khmer name plus Khmer digits still matches')
  assert.equal(frontend.matchesSearchTermGroups(row, ['ផ្កាម្លិះ']), true)
  assert.equal(frontend.matchesSearchTermGroups([NAME.replace('១០០', '៥៦៧'), '4006381333931'], ['១០០មល']), false, 'a different Khmer number still misses')
  assert.equal(frontend.matchesSearchTermGroups(row, ['100']), false, 'Khmer digits in a name do not become ASCII-searchable')
  assert.equal(frontend.matchesSearchTermGroups(['ក្រែម ១២៣៤៥', '4006381333931'], ['12345']), false, 'a 5-digit ASCII code does not hit a Khmer-numbered name')
  assert.equal(frontend.normalizeSearchText(NAME), 'ទឹកអប់ផ្កាម្លិះ ១០០មល', 'normalizeSearchText leaves Khmer digits in names as typed')
  assert.deepEqual(frontend.tokenizeSearchWords(NAME), ['ទឹកអប់ផ្កាម្លិះ', '១០០មល'])
  assert.equal(frontend.searchRelevanceTier({ name: NAME, barcode: '4006381333931' }, 'ទឹកអប់ផ្កាម្លិះ') === frontend.MATCH_TIER_EXACT_BARCODE, false, 'a Khmer name query is never an exact-barcode hit')
})

if (failures.length) {
  console.log(`\n${failures.length} red: ${failures.join(' | ')}`)
  process.exit(1)
}
console.log('barcodeKhmerDigits: all checks passed')
