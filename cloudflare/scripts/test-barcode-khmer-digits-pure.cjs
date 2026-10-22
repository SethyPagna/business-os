// Lane S3: with the Windows Khmer keyboard layout active a USB scanner gun
// types Khmer digits, so a scan matched no barcode. The Worker's barcode keys
// and its exact-barcode SQL now fold them to ASCII; the leading-zero and
// UPC-E/UPC-A folding run on the folded value, and name matching of Khmer
// text is untouched.
//
// Loads the REAL lib/searchMatch.ts (transpiled) and runs the generated
// exact-barcode clause and rank against a real SQLite table. Every check runs
// and the failures are listed together, so the red on the base commit names
// each broken behaviour instead of stopping at the first.
//
// Run: node scripts/test-barcode-khmer-digits-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Database = require('better-sqlite3')
const { openDb } = require('./harness/d1compat.cjs')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

function load(file, shims = {}) {
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, fileName: file,
  })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, (request) => shims[request] || require(request))
  return mod.exports
}

const search = load(path.join(__dirname, '..', 'src', 'lib', 'searchMatch.ts'))
const productSearch = load(path.join(__dirname, '..', 'src', 'lib', 'productSearchQuery.ts'), {
  './searchMatch': search,
  './productStockGuard': require('./harness/product_stock_guard.cjs'),
})
const frontend = load(path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'searchMatch.ts'))

const KHMER_CODE = '៣៣៤៨៩០១៧២៩២២២'
const MIXED_CODE = '33៤8៩០1៧2៩222'
const ASCII_CODE = '3348901729222'
const KHMER_DIGITS = '០១២៣៤៥៦៧៨៩'
const NAME = 'ទឹកអប់ផ្កាម្លិះ ១០០មល'

const failures = []
function check(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`RED  ${name}\n     ${String(error.message).split('\n')[0]}`)
  }
}

const db = openDb([`CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT, barcode TEXT); CREATE INDEX idx_products_barcode_pg ON products(barcode);
  INSERT INTO products VALUES
    (1, 'Dior Backstage Highlighter', '3348901729222'),
    (2, 'Dior Backstage Highlighter', '03348901729222'),
    (3, 'Other product', '3348901729223'),
    (4, 'Spaced code', '334-890 1729222'),
    (5, 'UPC-E twin', '01234565'),
    (6, 'UPC-A twin', '012345000065'),
    (7, 'Seven digit lookalike', '1234565'),
    (8, 'Placeholder', '0');`])

function matchingIds(rawQuery) {
  const params = {}
  const clause = search.buildExactBarcodeMatchClause(rawQuery, params)
  if (!clause) return null
  return db.prepare(`SELECT p.id FROM products p WHERE ${clause} ORDER BY p.id`).all(params).map((row) => Number(row.id))
}

check('foldNativeDigits maps ០-៩ to 0-9 and leaves everything else alone', () => {
  assert.equal(typeof search.foldNativeDigits, 'function', 'foldNativeDigits is exported')
  assert.equal(search.foldNativeDigits(KHMER_DIGITS), '0123456789')
  assert.equal(search.foldNativeDigits('ab-១២ ៣x'), 'ab-12 3x')
  assert.equal(search.foldNativeDigits(NAME), 'ទឹកអប់ផ្កាម្លិះ 100មល', 'letters and marks are untouched')
  assert.equal(search.foldNativeDigits(null), '')
  assert.equal(search.foldNativeDigits(undefined), '')
  assert.equal(search.foldNativeDigits(12345), '12345')
})

check('Khmer scan has the same barcode keys as the ASCII code', () => {
  assert.deepEqual(search.barcodeSearchKeys(KHMER_CODE), search.barcodeSearchKeys(ASCII_CODE))
  assert.deepEqual(search.barcodeSearchKeys(KHMER_CODE), [ASCII_CODE])
  assert.equal(search.normalizeBarcodeKey(KHMER_CODE), ASCII_CODE)
  assert.deepEqual(search.searchTermBarcodeKeys(KHMER_CODE), [ASCII_CODE])
  assert.equal(search.searchTermBarcodeKey(KHMER_CODE), ASCII_CODE)
  assert.equal(search.barcodeKeysMatch(KHMER_CODE, ASCII_CODE), true)
  assert.equal(search.barcodeKeysMatch(ASCII_CODE, KHMER_CODE), true)
})

check('a mixed Khmer/ASCII scan folds too', () => {
  assert.deepEqual(search.barcodeSearchKeys(MIXED_CODE), search.barcodeSearchKeys(ASCII_CODE))
  assert.equal(search.barcodeKeysMatch(MIXED_CODE, ASCII_CODE), true)
})

check('separators and padding around a Khmer scan are ignored as before', () => {
  assert.equal(search.normalizeBarcodeKey(' ៣៣៤៨-៩០១ ៧២៩២២២ '), ASCII_CODE)
  assert.equal(search.barcodeKeysMatch('០៣៣៤៨៩០១៧២៩២២២', ASCII_CODE), true, 'Khmer leading zero strips like ASCII 0')
  assert.equal(search.barcodeKeysMatch('០០០១២៣៤', '1234'), true)
  assert.equal(search.normalizeBarcodeKey('០០០០'), '', 'an all-zero Khmer placeholder is not a real barcode')
  assert.equal(search.normalizeBarcodeKey('១២៣'), '', 'under four characters is still not a real barcode')
})

check('UPC-E and UPC-A pairing runs on the folded value, collision guard intact', () => {
  assert.equal(search.barcodeKeysMatch('០១២៣៤៥៦៥', '012345000065'), true, 'Khmer UPC-E reaches its UPC-A')
  assert.equal(search.barcodeKeysMatch('០១២៣៤៥០០០០៦៥', '01234565'), true, 'Khmer UPC-A reaches its UPC-E')
  assert.ok(search.barcodeSearchKeys('០១២៣៤៥៦៥').includes('upca:012345000065'))
  assert.equal(search.barcodeKeysMatch('០១២៣៤៥៦៥', '1234565'), false, 'valid UPC-E never collides with an unrelated 7-digit code')
  assert.equal(search.barcodeKeysMatch('១២៣៤៥៦៥', '01234565'), false, 'collision guard is symmetric')
})

check('a different Khmer code does not match', () => {
  assert.equal(search.barcodeKeysMatch(KHMER_CODE, '3348901729223'), false)
  assert.equal(search.barcodeKeysMatch('៣៣៤៨៩០១៧២៩២២៣', ASCII_CODE), false)
})

check('the exact-barcode SQL clause binds the folded code, identical to the ASCII scan', () => {
  const khmerParams = {}
  const asciiParams = {}
  const khmerClause = search.buildExactBarcodeMatchClause(KHMER_CODE, khmerParams)
  const asciiClause = search.buildExactBarcodeMatchClause(ASCII_CODE, asciiParams)
  assert.ok(khmerClause, 'a Khmer-digit scan is a barcode lookup')
  assert.equal(khmerParams.barcodeKey, ASCII_CODE)
  assert.equal(khmerParams.barcodeKeyPair, 0)
  assert.equal(khmerParams.barcodeKeyEq0, ASCII_CODE)
  assert.equal(khmerClause, asciiClause)
  assert.deepEqual(khmerParams, asciiParams)
  const mixedParams = {}
  search.buildExactBarcodeMatchClause(MIXED_CODE, mixedParams)
  assert.deepEqual(mixedParams, asciiParams)
})

check('the SQL finds the ASCII row, its zero-padded twin and the spaced stored form for a Khmer scan', () => {
  assert.deepEqual(matchingIds(ASCII_CODE), [1, 2, 4], 'positive control: the ASCII scan')
  assert.deepEqual(matchingIds(KHMER_CODE), [1, 2, 4])
  assert.deepEqual(matchingIds(MIXED_CODE), [1, 2, 4])
  assert.deepEqual(matchingIds('០៣៣៤៨៩០១៧២៩២២២'), [1, 2, 4], 'Khmer leading zero folds before the zero strip')
  assert.deepEqual(matchingIds('៣៣៤៨៩០១៧២៩២២៣'), [3])
})

check('the SQL pairs a Khmer UPC-E scan with its UPC-A row and keeps the lookalike out', () => {
  assert.deepEqual(matchingIds('01234565'), [5, 6], 'positive control: the ASCII scan')
  assert.deepEqual(matchingIds('០១២៣៤៥៦៥'), [5, 6])
  assert.deepEqual(matchingIds('០១២៣៤៥០០០០៦៥'), [5, 6])
  assert.deepEqual(matchingIds('1234565'), [5, 7], 'positive control: a bare 7-digit scan has no UPC pair')
  assert.deepEqual(matchingIds('១២៣៤៥៦៥'), matchingIds('1234565'), 'a Khmer 7-digit scan behaves like its ASCII twin')
})

check('the rank SQL floats the Khmer-scanned row ahead of the rest', () => {
  const params = {}
  assert.ok(search.buildExactBarcodeMatchClause(KHMER_CODE, params))
  const rank = search.buildExactBarcodeRankSql('barcodeKey', 'p.barcode')
  const ranked = db.prepare(`SELECT p.id, ${rank} AS rank FROM products p ORDER BY rank, p.id`).all(params)
  assert.deepEqual(ranked.filter((row) => Number(row.rank) === 0).map((row) => Number(row.id)), [1, 2, 4])
})

check('placeholders and short Khmer text are still not barcode lookups', () => {
  assert.equal(search.buildExactBarcodeMatchClause('០', {}), undefined)
  assert.equal(search.buildExactBarcodeMatchClause('០០០០០០', {}), undefined)
  assert.equal(search.buildExactBarcodeMatchClause('១២៣', {}), undefined)
  assert.equal(search.buildExactBarcodeMatchClause('ទឹកអប់ ១០០មល', {}), undefined, 'a two-word Khmer name query stays an ordinary search')
})

check('the real product search query finds the ASCII rows for a Khmer scan, indexed and compat paths', () => {
  const real = new Database(':memory:')
  real.pragma('foreign_keys = OFF')
  const migrations = path.join(__dirname, '..', 'migrations')
  for (const file of fs.readdirSync(migrations).filter((name) => name.endsWith('.sql')).sort()) real.exec(fs.readFileSync(path.join(migrations, file), 'utf8'))
  const insert = real.prepare(`INSERT INTO products (id, name, sku, barcode, brand, category, supplier, description, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold, is_active)
    VALUES (@id, @name, NULL, @barcode, '', '', '', '', 'pcs', 50, 10, 0, 1)`)
  seedStockFixture(real, () => {
    insert.run({ id: 1, name: 'Dior Backstage Highlighter', barcode: ASCII_CODE })
    insert.run({ id: 2, name: 'Dior Backstage Highlighter', barcode: '0' + ASCII_CODE })
    insert.run({ id: 3, name: 'Other product', barcode: '3348901729223' })
  })
  const found = (rawQuery, useSearchIndex) => {
    const params = {}
    const query = productSearch.buildProductSearchQuery(rawQuery, params, { useSearchIndex })
    assert.ok(query.whereClause, 'the scan builds a WHERE clause')
    return real.prepare(`SELECT p.id FROM products p WHERE p.is_active = 1 AND ${query.whereClause} ORDER BY p.id`).all(params).map((row) => Number(row.id))
  }
  for (const useSearchIndex of [true, false]) {
    const via = useSearchIndex ? 'indexed' : 'compat'
    assert.deepEqual(found(ASCII_CODE, useSearchIndex), [1, 2], `positive control (${via})`)
    assert.deepEqual(found(KHMER_CODE, useSearchIndex), [1, 2], `Khmer scan (${via})`)
    assert.deepEqual(found(MIXED_CODE, useSearchIndex), [1, 2], `mixed scan (${via})`)
    assert.deepEqual(found('៣៣៤៨៩០១៧២៩២២៣', useSearchIndex), [3], `different Khmer code (${via})`)
  }
})

check('the frontend copy gives the same keys for every probe', () => {
  const probes = [KHMER_CODE, MIXED_CODE, ASCII_CODE, KHMER_DIGITS, '០១២៣៤៥៦៥', '០៣៣៤៨៩០១៧០៥៦៩', ' ១២៣៤ ', NAME, '', null, undefined]
  for (const probe of probes) {
    assert.deepEqual(search.barcodeSearchKeys(probe), frontend.barcodeSearchKeys(probe), `barcodeSearchKeys(${String(probe)})`)
    assert.equal(search.normalizeBarcodeKey(probe), frontend.normalizeBarcodeKey(probe), `normalizeBarcodeKey(${String(probe)})`)
    assert.deepEqual(search.searchTermBarcodeKeys(probe), frontend.searchTermBarcodeKeys(probe), `searchTermBarcodeKeys(${String(probe)})`)
  }
})

check('guard: Khmer text and Khmer digits in a product name match by name exactly as before', () => {
  const nameRow = [NAME, '4006381333931']
  assert.equal(search.matchesSearchTermGroups(nameRow, ['១០០មល']), true, 'Khmer-digit word in the name still matches')
  assert.equal(search.matchesSearchTermGroups(nameRow, ['ទឹកអប់ ១០០']), true, 'Khmer name plus Khmer digits still matches')
  assert.equal(search.matchesSearchTermGroups(nameRow, ['ផ្កាម្លិះ']), true)
  assert.equal(search.matchesSearchTermGroups([NAME.replace('១០០', '៥៦៧'), '4006381333931'], ['១០០មល']), false, 'a different Khmer number still misses')
  assert.equal(search.matchesSearchTermGroups(nameRow, ['100']), false, 'Khmer digits in a name do not become ASCII-searchable')
  assert.equal(search.matchesSearchTermGroups(['ក្រែម ១២៣៤៥', '4006381333931'], ['12345']), false, 'a 5-digit ASCII code does not hit a Khmer-numbered name')
  assert.equal(search.normalizeSearchText(NAME), 'ទឹកអប់ផ្កាម្លិះ ១០០មល', 'normalizeSearchText leaves Khmer digits in names as typed')
  assert.deepEqual(search.tokenizeSearchWords(NAME), ['ទឹកអប់ផ្កាម្លិះ', '១០០មល'])
})

check('the matcher keeps the ASCII-barcode row for a Khmer scan', () => {
  assert.equal(search.matchesSearchTermGroups(['Dior Backstage Highlighter', ASCII_CODE], [KHMER_CODE]), true)
  assert.equal(search.matchesSearchTermGroups(['Dior Backstage Highlighter', '3348901729223'], [KHMER_CODE]), false)
})

if (failures.length) {
  console.log(`\n${failures.length} red: ${failures.join(' | ')}`)
  process.exit(1)
}
console.log('test-barcode-khmer-digits-pure: all checks passed')
