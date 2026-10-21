// What an empty list says after a SCAN (utils/scanMiss.ts, api/productSearchIndex.ts catalogHasBarcode).
//
// The owner rule (2 Sep, still binding): a scan only fills the search. So a miss changes the WORDS where the list
// is empty and nothing else. The traps here are the plausible wrong implementations: calling a typed query a miss,
// saying "no such barcode" while the page still shows the answer to the previous query, deciding "hidden by the
// filters" by name or substring, and claiming either when the page cannot tell.
//
// Run: node tests/scanMiss.test.ts
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyScanMiss, type ScanMissInput } from '../src/utils/scanMiss.ts'
import { __productSearchIndexTest, catalogHasBarcode, ensureProductSearchIndex, productSearchIndexStatus } from '../src/api/productSearchIndex.ts'

let failed = 0
function runTest(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve().then(fn).then(
    () => console.log(`PASS ${name}`),
    (error) => { failed += 1; console.error(`FAIL ${name}`); console.error(error) },
  )
}

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.join(here, '..')
const read = (relative: string): string => readFileSync(path.join(frontend, relative), 'utf8').replace(/\r\n/g, '\n')

const CODE = '3348901729222'
const base: ScanMissInput = { scannedCode: CODE, answered: true, listEmpty: true, filtersActive: false, inCatalog: false }
const classify = (patch: Partial<ScanMissInput>) => classifyScanMiss({ ...base, ...patch })

await runTest('a scanned code with nothing listed and no filter on is "no match", carrying the code', () => {
  assert.deepEqual(classify({}), { kind: 'no_match', code: CODE })
})

await runTest('a typed or edited query is never a scan miss', () => {
  assert.equal(classify({ scannedCode: null }), null)
  assert.equal(classify({ scannedCode: '' }), null)
})

await runTest('nothing is said while the page on screen answers an older query', () => {
  assert.equal(classify({ answered: false }), null)
  assert.equal(classify({ answered: false, filtersActive: true, inCatalog: true }), null)
})

await runTest('rows on screen keep the list: a scan with matches never shows a miss', () => {
  assert.equal(classify({ listEmpty: false }), null)
  assert.equal(classify({ listEmpty: false, filtersActive: true, inCatalog: true }), null)
})

await runTest('a code the catalog has, with a filter on and nothing listed, is "hidden by the filters"', () => {
  assert.deepEqual(classify({ filtersActive: true, inCatalog: true }), { kind: 'hidden_by_filters', code: CODE })
})

await runTest('a code the catalog lacks stays "no match" even with filters on', () => {
  assert.deepEqual(classify({ filtersActive: true, inCatalog: false }), { kind: 'no_match', code: CODE })
})

await runTest('with filters on and no index to ask, neither is claimed (the generic empty state stays)', () => {
  assert.equal(classify({ filtersActive: true, inCatalog: null }), null)
})

await runTest('with no filter on, a stale index cannot make an empty answer "hidden" and a missing index cannot hide a miss', () => {
  assert.deepEqual(classify({ filtersActive: false, inCatalog: true }), { kind: 'no_match', code: CODE })
  assert.deepEqual(classify({ filtersActive: false, inCatalog: null }), { kind: 'no_match', code: CODE })
})

// ---- catalogHasBarcode over the real index, served through its transport seam ----

type Packed = [number, string, string, string, string, string]
const rows: Packed[] = [
  [1, 'Dior Sauvage', 'Dior', 'Perfume', CODE, ''],
  [2, 'Chanel Coco', 'Chanel', 'Perfume', '03145891264003', ''],
  [3, 'Chanel Coco Mini', 'Chanel', 'Perfume', `1${CODE}`, ''],
  [4, 'Small package', 'Acme', 'Care', '012345000065', ''],
  [5, CODE, 'Acme', 'Care', '9999999999999', ''],
  [6, 'Placeholder', 'Acme', 'Care', '0', ''],
]
const { transport } = __productSearchIndexTest
let denied = false
let served = rows
transport.fetchPage = async (page) => {
  if (denied) throw Object.assign(new Error('forbidden'), { status: 403 })
  return { format: 1, page, buckets: [0], hash: `fixture-${served.length}`, rows: served } as never
}
transport.readStored = async () => null
transport.writeStored = async () => {}

await runTest('before the index loads, the catalog cannot say (null), so a page claims nothing', () => {
  __productSearchIndexTest.reset()
  assert.equal(productSearchIndexStatus(), 'idle')
  assert.equal(catalogHasBarcode(CODE), null)
})

await ensureProductSearchIndex()

await runTest('the exact barcode is in the catalog', () => {
  assert.equal(productSearchIndexStatus(), 'ready')
  assert.equal(catalogHasBarcode(CODE), true)
})

await runTest('leading zeros fold, UPC-E pairs with UPC-A, Khmer digits fold', () => {
  assert.equal(catalogHasBarcode('3145891264003'), true, 'the stored GTIN-14 twin of an EAN-13 scan')
  assert.equal(catalogHasBarcode('01234565'), true, 'a UPC-E scan finds the UPC-A row')
  assert.equal(catalogHasBarcode('៣៣៤៨៩០១៧២៩២២២'), true, 'the Windows Khmer layout types Khmer digits')
})

await runTest('never by substring, prefix, name or placeholder', () => {
  assert.equal(catalogHasBarcode('1234565'), false, 'seven digits is not the UPC-E')
  assert.equal(catalogHasBarcode('33489017'), false, 'a prefix of a code')
  assert.equal(catalogHasBarcode('4006381333931'), false, 'a code nobody has')
  assert.equal(catalogHasBarcode('0'), false, 'the placeholder barcode')
  assert.equal(catalogHasBarcode('000000'), false)
})

// Row 5's NAME is the digits of row 1's barcode and row 3's barcode merely contains them. Only row 1 is a barcode
// match, so serving the catalog without row 1 must turn the answer to false.
__productSearchIndexTest.reset()
served = rows.filter((row) => row[0] !== 1)
await ensureProductSearchIndex()

await runTest('a name that spells the digits and a longer GTIN that contains them are not the barcode', () => {
  assert.equal(productSearchIndexStatus(), 'ready')
  assert.equal(catalogHasBarcode(CODE), false)
})

await runTest('an account with no index (403) gets null, not false', async () => {
  __productSearchIndexTest.reset()
  denied = true
  await ensureProductSearchIndex()
  assert.equal(productSearchIndexStatus(), 'unavailable')
  assert.equal(catalogHasBarcode(CODE), null)
  denied = false
})

// ---- the wiring: each surface decides with the same helpers, and a scan alone marks the text as scanned ----

const FILES = {
  pos: read('src/components/pos/POS.tsx'),
  products: read('src/components/products/Products.tsx'),
  imageOnly: read('src/components/products/ProductsImageOnlyView.tsx'),
  imageOnlyControls: read('src/components/products/ProductsImageOnlyControls.tsx'),
  list: read('src/components/products/surfaces/ProductsListSurface.tsx'),
}

await runTest('POS, Products and the image-only view mark a scan, and typing never does', () => {
  for (const [name, source] of [['POS', FILES.pos], ['Products', FILES.products], ['image-only', FILES.imageOnly]] as const) {
    assert.match(source, /useScannedQuery\(search\)/, `${name} tracks which text was scanned`)
    assert.match(source, /markScanned\(code\)/, `${name}: a scan marks its code`)
    assert.equal((source.match(/markScanned\(/g) || []).length, 1, `${name}: nothing but the scan handler marks`)
  }
  assert.match(FILES.pos, /const applyScan = useCallback\(\(code: string\) => \{\s*pendingScanRef\.current = code\s*markScanned\(code\)\s*changeSearch\(code\)/)
  assert.match(FILES.imageOnlyControls, /<ScanSearchButton onDetected=\{onScan\}/)
  assert.doesNotMatch(FILES.imageOnlyControls, /onSearchChange\(code\)/, 'the gun no longer bypasses the scan marker')
})

await runTest('every surface asks classifyScanMiss, and only the filtered pages ask the index', () => {
  assert.match(FILES.pos, /classifyScanMiss\(\{[\s\S]*?inCatalog: scannedCode && hasPosFilterSelection \? catalogHasBarcode\(scannedCode\) : null,/)
  assert.match(FILES.products, /classifyScanMiss\(\{[\s\S]*?inCatalog: scannedCode && hasHidingFilters \? catalogHasBarcode\(scannedCode\) : null,/)
  assert.match(FILES.imageOnly, /classifyScanMiss\(\{[\s\S]*?inCatalog: null,/, 'the image-only role has no index')
})

await runTest('a page only says it answered once the loaded page is the one for the current search', () => {
  assert.match(FILES.pos, /answered: !catalogRefreshing && catalogAnsweredKey === productSearchParamsKey && debouncedProductSearch === scannedCode/)
  assert.match(FILES.pos, /setCatalogAnsweredKey\(productSearchParamsKey\)\s*applyCatalogProducts\(prods\)/)
  assert.match(FILES.products, /answered: !loading && !refreshingProducts && answeredSearchKey === productSearchParamsKey && debouncedSearch === scannedCode/)
  assert.match(FILES.products, /setAnsweredSearchKey\(productSearchParamsKey\)/)
  assert.match(FILES.imageOnly, /answered: !loading && answeredSearch === scannedCode && debouncedSearch === scannedCode/)
  assert.match(FILES.imageOnly, /setAnsweredSearch\(debouncedSearch\)/)
})

await runTest('POS: Clear in the hidden state keeps the scanned code, the grid reset still clears everything', () => {
  const selections = FILES.pos.slice(FILES.pos.indexOf('const clearPosFilterSelections'), FILES.pos.indexOf('const clearAllPosFilters'))
  assert.ok(selections.length > 0)
  assert.doesNotMatch(selections, /pos_search|setSearch/, 'the filter reset leaves the search box alone')
  assert.match(FILES.pos, /<ScanMissNotice miss=\{scanMiss\} t=\{t\} onClearFilters=\{clearPosFilterSelections\} \/>/)
  const all = FILES.pos.slice(FILES.pos.indexOf('const clearAllPosFilters'), FILES.pos.indexOf('// Multi-order state'))
  assert.match(all, /setSearch\(''\)[\s\S]*pos_search[\s\S]*clearPosFilterSelections\(\)/)
  assert.doesNotMatch(FILES.pos, /onCreate=/, 'the till shows only the message')
})

await runTest('Products: the list surface shows the notice in both layouts, with Create only when the account may create', () => {
  assert.equal((FILES.list.match(/\{emptyMessage\}/g) || []).length, 2, 'the desktop table and the phone cards')
  assert.match(FILES.products, /onCreateFromScan=\{canAddProduct \? openCreateFromScan : undefined\}/)
  assert.match(FILES.products, /onClearFilters=\{clearAllFilters\}/)
  assert.match(FILES.imageOnly, /<ScanMissNotice miss=\{scanMiss\} t=\{t\} \/>/)
  assert.doesNotMatch(FILES.imageOnly, /onCreate=/, 'the image-only role cannot create products')
})

await runTest('Create opens the real ProductForm through createDefaults, with its own draft and no minimize chip it could not restore', () => {
  assert.match(FILES.products, /const scanCreateDefaults = useMemo\(\(\) => \(scanCreateBarcode \? \{ barcode: scanCreateBarcode \} : undefined\), \[scanCreateBarcode\]\)/)
  assert.match(FILES.products, /draftScope=\{scanCreateBarcode \? `scan-miss-\$\{scanCreateBarcode\}` : 'standalone-create'\}/)
  assert.match(FILES.products, /createDefaults=\{scanCreateDefaults\}/)
  assert.match(FILES.products, /onMinimize=\{scanCreateBarcode \? undefined : /)
  assert.match(FILES.products, /useEffect\(\(\) => \{\s*if \(modal !== 'form'\) setScanCreateBarcode\(null\)\s*\}, \[modal\]\)/, 'the barcode is forgotten when the form closes')
})

await runTest('both packs carry the words, and no source file spells barcode បារកូដ', () => {
  const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
  for (const key of ['scan_no_match', 'scan_hidden_by_filters', 'scan_create_with_barcode', 'create', 'clear', 'clear_filters']) {
    assert.ok(en[key] && km[key], `${key} is in both packs`)
    assert.notEqual(km[key], en[key], `${key} is translated`)
  }
  assert.match(en.scan_no_match, /\{code\}/)
  assert.match(km.scan_no_match, /\{code\}/)
  const walk = (dir: string): string[] => readdirSync(path.join(frontend, dir), { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : /\.(tsx?|json)$/.test(entry.name) ? [path.join(dir, entry.name)] : []
  ))
  const offenders = walk('src').filter((file) => read(file).includes('បារកូដ'))
  assert.deepEqual(offenders, [], 'VariantFormModal used to carry the other spelling in its fallback')
})

await runTest('the camera hook has no permission-denied message: a denied start is blocked or dismissed first', () => {
  const hook = read('src/components/products/scanning/useBarcodeCamera.ts')
  assert.doesNotMatch(hook, /scanPermissionDenied/)
  assert.doesNotMatch(read('src/components/products/scanning/BarcodeScannerModal.tsx'), /scanPermissionDenied/)
  // The ladder that remains: every `denied` is `blocked` or `dismissed`, so nothing is left for a "denied" branch.
  assert.match(hook, /const blocked = documentBlocked \|\| \(denied && permissionWasDenied\)\s*const dismissed = denied && !blocked/)
})

if (failed > 0) process.exitCode = 1
