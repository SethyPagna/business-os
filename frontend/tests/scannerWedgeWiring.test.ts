// Source-shape checks for the scanner-gun / exact-hit wiring (lane S4).
//
// The behaviour is proved in scannerWedge.test.ts, scanExactHit.test.ts and
// scannerWedgeBrowser.test.ts. These pin what only the source can show: the POS
// and Products scans go through the SAME handler as typing (so pos_search is
// saved and pinned rows are released), nothing in a scan path adds, opens or
// picks, and both language packs carry the new key.
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path: string): string => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const pos = read('../src/components/pos/POS.tsx')
const products = read('../src/components/products/Products.tsx')
const card = read('../src/components/pos/ProductCard.tsx')
const sheet = read('../src/components/pos/ProductDetailSheet.tsx')
const searchInput = read('../src/components/shared/SearchInput.tsx')
const hook = read('../src/components/shared/useScannerWedge.ts')
const exactHit = read('../src/utils/scanExactHit.ts')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>

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

// The text from `start` to the first `end` after it; throws when either is gone.
function slice(source: string, start: RegExp, end: RegExp): string {
  const from = source.search(start)
  assert.ok(from >= 0, `source lost ${start}`)
  const rest = source.slice(from)
  const to = rest.search(end)
  assert.ok(to > 0, `source lost ${end} after ${start}`)
  return rest.slice(0, to)
}

const PICKS_OR_ADDS = /addToCart|openProductCard|setDetailProduct|onOpen\(|\.click\(\)|handleSelect|setSelectedIds|toggleSelectionScope/

runTest('POS: the camera and the gun fill the search through the typing handler', () => {
  assert.doesNotMatch(pos, /onDetected=\{setSearch\}/, 'a scan used to bypass the typed path and skip pos_search')
  assert.match(pos, /<ScanSearchButton onDetected=\{applyScan\} t=\{t\} \/>/)
  assert.match(pos, /const changeSearch = useCallback\(\(next: string\) => \{\s*writePosStorage\('session', 'pos_search', next\)\s*setSearch\(next\)\s*\}, \[\]\)/)
  assert.match(pos, /onChange=\{e => \{ pendingScanRef\.current = null; changeSearch\(e\.target\.value\) \}\}/, 'typing uses changeSearch too')
  const applyScan = slice(pos, /const applyScan = useCallback/, /\n {2}\}, \[changeSearch\]\)/)
  assert.match(applyScan, /changeSearch\(code\)/)
  assert.match(pos, /useScannerWedge\(\{\s*enabled: isActive && !posOverlayOpen,\s*searchRef,/)
  assert.match(pos, /applyScan\(code\)\s*if \(origin === 'field'\) notify\(t\('scan_moved_to_search'\), 'info'\)/)
})

runTest('POS: a scan never adds, opens or picks a product', () => {
  assert.doesNotMatch(slice(pos, /const applyScan = useCallback/, /\n {2}\}, \[changeSearch\]\)/), PICKS_OR_ADDS)
  const onScan = slice(pos, /useScannerWedge\(\{/, /\n {2}\}\)\n/)
  assert.doesNotMatch(onScan, PICKS_OR_ADDS)
  const reveal = slice(pos, /const code = pendingScanRef\.current/, /\}, \[debouncedProductSearch, isDesktopViewport, scanHitId\]\)/)
  assert.doesNotMatch(reveal, PICKS_OR_ADDS, 'the revealed card is scrolled to and focused, not activated')
  assert.match(reveal, /scrollIntoView/)
  assert.match(reveal, /if \(isDesktopViewport\) card\?\.focus\(/, 'only desktop moves focus to the card')
})

runTest('POS: only the single exact-barcode card is ringed, and the sheet marks the child row', () => {
  assert.match(pos, /findScanHit\(visibleProductCards, \(card\) => card\.__groupMeta\?\.rows \?\? \[card\], debouncedProductSearch\)/)
  assert.match(pos, /scanHit=\{p\.id === scanHitId\}/)
  assert.match(pos, /scanQuery=\{debouncedProductSearch\}/)
  assert.match(card, /scanHit\?: boolean/)
  assert.match(card, /data-scan-hit=\{scanHit \? 'true' : undefined\}/)
  assert.match(card, /scanHit \? ' outline outline-2 outline-primary-500' : ''/, 'an outline: .dark .card forces its own box-shadow, so a ring would vanish')
  assert.match(sheet, /import \{ isExactBarcodeHit \} from '\.\.\/\.\.\/utils\/scanExactHit\.ts'/)
  assert.match(sheet, /const scanned = scanHitIndex >= 0 && isExactBarcodeHit\(variant, scanQuery\)/)
  assert.match(sheet, /data-scan-hit=\{scanned \? 'true' : undefined\}/)
  const openPage = slice(sheet, /\/\/ Open on the page that holds the searched barcode/, /\}, \[product\?\.id, scanHitIndex\]\)/)
  assert.doesNotMatch(openPage, /setSelectedVariantId|onAddToCart|onPick/, 'the sheet opens on the marked row\'s page; it does not choose it')
  assert.match(openPage, /setBarcodePage\(Math\.floor\(scanHitIndex \/ VARIANT_CHOICES_PAGE_SIZE\)\)/)
})

runTest('POS: the search box takes codes verbatim', () => {
  assert.match(pos, /onChange=\{e => \{ pendingScanRef\.current = null; changeSearch\(e\.target\.value\) \}\}\s*autoCorrect="off"\s*autoCapitalize="off"\s*spellCheck=\{false\}/)
})

runTest('Products: the camera and the gun go through handleSearchInputChange like typing', () => {
  assert.doesNotMatch(products, /onDetected=\{setSearch\}/, 'a scan used to skip the handler that releases pinned just-edited rows')
  assert.match(products, /<ScanSearchButton onDetected=\{applyScan\} t=\{t\} \/>/)
  const applyScan = slice(products, /const applyScan = useCallback/, /\n {2}\}, \[handleSearchInputChange\]\)/)
  assert.match(applyScan, /handleSearchInputChange\(code\)/)
  assert.doesNotMatch(applyScan, PICKS_OR_ADDS)
  assert.match(products, /const handleTypedSearch = useCallback\(\(value: string\) => \{\s*pendingScanRef\.current = null\s*handleSearchInputChange\(value\)/)
  assert.match(products, /onChange=\{handleTypedSearch\}\s*inputRef=\{searchInputRef\}/)
  assert.match(products, /useScannerWedge\(\{\s*enabled: isActive,\s*searchRef: searchInputRef,/)
  assert.match(products, /applyScan\(code\)\s*if \(origin === 'field'\) notify\(t\('scan_moved_to_search'\), 'info'\)/)
})

runTest('Products: the single exact row is marked on desktop and mobile, its group opened and scrolled to, never opened', () => {
  assert.match(products, /findScanHit\(\s*productSections\.flatMap\(\(section\) => section\.groups\.map\(\(group\) => \(\{ section, group \}\)\)\),\s*\(\{ group \}\) => group\.rows,\s*cleanedSearchQuery,\s*\)/)
  assert.match(products, /scanHitId,\s*\}\), \[scanHitId, productColumns,/, 'the row context carries the hit and rebuilds only when it changes')
  assert.equal((products.match(/data-scan-hit=\{scanHit \? 'true' : undefined\}/g) || []).length, 2, 'table row and mobile card')
  assert.match(products, /SCAN_HIT_CARD_CLASS = 'outline outline-2 -outline-offset-2 outline-primary-500'/)
  const reveal = slice(products, /const code = pendingScanRef\.current/, /\}, \[scanRevealCount\]\)/)
  assert.doesNotMatch(reveal, PICKS_OR_ADDS)
  assert.match(reveal, /setCollapsedProductSections[\s\S]*setCollapsedProductGroups[\s\S]*scrollNodeWithOffset/)
})

runTest('SearchInput: autocorrect, autocapitalize and spellcheck are off before caller props apply', () => {
  assert.match(searchInput, /autoComplete=\{autoComplete\}\s*autoCorrect="off"\s*autoCapitalize="off"\s*spellCheck=\{false\}\s*className=/)
  assert.ok(searchInput.indexOf('spellCheck={false}') < searchInput.indexOf('{...rest}'), 'a caller can still override')
  assert.match(searchInput, /inputRef\?: Ref<HTMLInputElement>/)
  assert.match(searchInput, /<input\s*ref=\{inputRef\}/)
})

runTest('the hook listens in the capture phase, stops the terminator and documents its contract', () => {
  assert.match(hook, /^\/\*\n \* useScannerWedge/, 'the contract is the first thing in the file')
  assert.match(hook, /CONTRACT, for every surface/)
  assert.match(hook, /window\.addEventListener\('keydown', onKeyDown, true\)/)
  assert.match(hook, /window\.removeEventListener\('keydown', onKeyDown, true\)/)
  assert.match(hook, /isComposing: event\.isComposing \|\| event\.keyCode === 229/)
  assert.match(hook, /event\.preventDefault\(\)\s*event\.stopPropagation\(\)/)
  assert.match(hook, /Object\.getOwnPropertyDescriptor\(prototype, 'value'\)\?\.set\?\.call\(element, value\)/, 'React only follows a restore made with the native setter')
  assert.match(hook, /for \(let index = registrations\.length - 1; index >= 0; index -= 1\)/, 'the latest registration is tried first')
})

runTest('the exact hit is the exact-barcode relevance tier and nothing looser', () => {
  assert.match(exactHit, /import \{ MATCH_TIER_EXACT_BARCODE, searchRelevanceTier \} from '\.\/searchMatch\.ts'/)
  assert.match(exactHit, /searchRelevanceTier\(row, query, \{ nameTiers: false \}\) === MATCH_TIER_EXACT_BARCODE/)
  assert.doesNotMatch(exactHit, /\.includes\(|\.startsWith\(|indexOf\(/)
})

runTest('scan_moved_to_search is in both packs, Khmer spells barcode បាកូដ', () => {
  assert.equal(en.scan_moved_to_search, 'Barcode moved to search')
  assert.equal(km.scan_moved_to_search, 'បាកូដត្រូវបានផ្លាស់ទៅប្រអប់ស្វែងរក')
  assert.ok(km.scan_moved_to_search.includes('បាកូដ') && !km.scan_moved_to_search.includes('បារកូដ'))
  assert.doesNotMatch(km.scan_moved_to_search, /[A-Za-z]/, 'no English placeholder in the Khmer pack')
})

if (failed > 0) process.exitCode = 1
