// Source-shape checks for the scanner gun on every remaining search surface (lane 6.0.934).
//
// The behaviour is proved elsewhere: the hook in scannerWedgeBrowser.test.ts, the Stock Session
// float in scannerSurfacesStockSessionBrowser.test.ts, the Khmer folds in
// scannerSurfacesKhmerDigits.test.ts. These pin what only the source can show: each surface
// registers the one shared hook (never a second detector), the hook's onScan does exactly what
// typing and the camera do, and nothing in a scan path adds, opens or picks.
//
// Each check collects its failures instead of stopping at the first, so a run on the base
// commit names every surface that is still unwired.
//
// Run: node tests/scannerSurfacesWiring.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path: string): string => fs.readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
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

// Every `useScannerWedge({ ... })` call in a source, brace-matched.
function hookCalls(source: string): string[] {
  const calls: string[] = []
  let from = 0
  for (;;) {
    const start = source.indexOf('useScannerWedge({', from)
    if (start < 0) return calls
    let depth = 0
    let end = start + 'useScannerWedge('.length
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1
      else if (source[end] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }
    calls.push(source.slice(start, end + 1))
    from = end
  }
}

// Calls that add a line, pick a row or open a sheet. A scan path may call none of them.
const PICKS_OR_ADDS = /\baddLine\(|\bonAdd\(|addToCart|handleSelect|setSelectedProduct\(|setPicked\((?!null)|\.click\(\)|openDiscountEditor|setReplacementPicking|setReplacePicking|setAddSheetGroup|setDraft\(|stageLineUpdate|openSaleForReturn|\bpick\(/
const MOVED_NOTICE = /if \(origin === 'field'\) /

interface Surface {
  name: string
  file: string
  /** useScannerWedge calls expected in the file. */
  hooks: number
  /** The text each hook's onScan must contain, one entry per hook. */
  scans: RegExp[]
  /** Source lines that tie the camera and the keyboard to the same handler the hook calls. */
  same: RegExp[]
}

const SURFACES: Surface[] = [
  {
    name: 'Branches: the branch-stock search (one target per expanded branch)',
    file: '../src/components/branches/Branches.tsx',
    hooks: 1,
    scans: [/enabled,\s*searchRef: inputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*onChange\(code\)/],
    same: [
      /onChange=\{\(event\) => onChange\(event\.target\.value\)\}/,
      /<ScanSearchButton onDetected=\{onChange\} /,
      /<BranchStockSearch[\s\S]*?enabled=\{isActive\}\s*onChange=\{\(value\) => handleBranchStockSearchChange\(branch\.id, value\)\}/,
      /<input\s*ref=\{inputRef\}\s*id=\{`branch-stock-search-\$\{id\}`\}/,
    ],
  },
  {
    name: 'Transfers: the product search',
    file: '../src/components/branches/TransferModal.tsx',
    hooks: 1,
    scans: [/enabled: true,\s*searchRef: searchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*if \(entryLocked\) return\s*handleTransferProductScan\(code\)/],
    same: [
      /<ScanSearchButton\s*onDetected=\{handleTransferProductScan\}/,
      /<input\s*ref=\{searchInputRef\}\s*id="transfer-product-search"/,
      /<input\s*ref=\{searchInputRef\}\s*id="transfer-product-search-multi"/,
    ],
  },
  {
    name: 'Inventory',
    file: '../src/components/inventory/Inventory.tsx',
    hooks: 1,
    scans: [/enabled: isActive,\s*searchRef: searchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*handleSearchChange\(code\)/],
    same: [/inputRef=\{searchInputRef\}/, /onChange=\{handleSearchChange\}/, /<ScanSearchButton onDetected=\{handleSearchChange\}/],
  },
  {
    name: 'Returns',
    file: '../src/components/returns/Returns.tsx',
    hooks: 1,
    scans: [/enabled: isActive,\s*searchRef: searchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*setSearch\(code\)/],
    same: [/inputRef=\{searchInputRef\}/, /onChange=\{setSearch\}/, /<ScanSearchButton onDetected=\{setSearch\}/],
  },
  {
    name: 'New return: the replacement catalog search',
    file: '../src/components/returns/NewReturnModal.tsx',
    hooks: 1,
    scans: [/enabled: step === 'items',\s*searchRef: replacementSearchRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*void searchReplacementCatalog\(code\)/],
    same: [
      /<input\s*ref=\{replacementSearchRef\}/,
      /onDetected=\{\(value\) => \{ void searchReplacementCatalog\(value\) \}\}/,
    ],
  },
  {
    name: 'New supplier return',
    file: '../src/components/returns/NewSupplierReturnModal.tsx',
    hooks: 1,
    scans: [/enabled: true,\s*searchRef: searchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*setSearch\(code\)/],
    same: [/inputRef=\{searchInputRef\}/, /onChange=\{setSearch\}/, /<ScanSearchButton onDetected=\{setSearch\}/],
  },
  {
    name: 'Sales',
    file: '../src/components/sales/Sales.tsx',
    hooks: 1,
    scans: [/enabled: isActive,\s*searchRef: searchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*setSearch\(code\)/],
    same: [/inputRef=\{searchInputRef\}/, /onChange=\{setSearch\}/, /<ScanSearchButton onDetected=\{setSearch\}/],
  },
  {
    name: 'Promotions: the per-product discount search and the rule editor picker',
    file: '../src/components/promotions/PromotionsPage.tsx',
    hooks: 2,
    scans: [
      /enabled: activeSection === 'discounts' && canManageDiscounts && !draft && !discountDraft,\s*searchRef: discountSearchRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{ setProductQuery\(code\); movedNotice\(origin\) \}/,
      /enabled: Boolean\(draft\) && canManagePromotions,\s*searchRef: pickerSearchRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{ setPickerQuery\(code\); movedNotice\(origin\) \}/,
    ],
    same: [
      /<input\s*ref=\{discountSearchRef\}/,
      /onChange=\{\(event\) => setProductQuery\(event\.target\.value\)\}/,
      /<ScanSearchButton onDetected=\{setProductQuery\}/,
      /<input ref=\{pickerSearchRef\}/,
      /onChange=\{\(event\) => setPickerQuery\(event\.target\.value\)\}/,
      /<ScanSearchButton onDetected=\{setPickerQuery\}/,
    ],
  },
  {
    name: 'Product conflicts (duplicates) filter',
    file: '../src/components/products/ProductDuplicatesTab.tsx',
    hooks: 1,
    scans: [/enabled: true,\s*searchRef: searchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*setSearch\(code\)/],
    same: [/<input\s*ref=\{searchInputRef\}/, /onChange=\{\(e\) => setSearch\(e\.target\.value\)\}/, /<ScanSearchButton\s*onDetected=\{setSearch\}/],
  },
  {
    name: 'Stock Change history',
    file: '../src/components/products/StockChangeSection.tsx',
    hooks: 1,
    scans: [/enabled: !stockWorkflowOpen,\s*searchRef: searchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*setSearch\(code\)/],
    same: [/inputRef=\{searchInputRef\}/, /onChange=\{setSearch\}/, /<ScanSearchButton onDetected=\{setSearch\}/],
  },
  {
    name: 'Stock-in sessions list',
    file: '../src/components/products/StockInSessionsSection.tsx',
    hooks: 1,
    scans: [/enabled: true,\s*searchRef: searchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*changeSearch\(code\)/],
    same: [/const changeSearch = \(value: string\) => \{ setSearch\(value\); setPage\(1\) \}/, /inputRef=\{searchInputRef\}/, /onChange=\{changeSearch\}/, /<ScanSearchButton onDetected=\{changeSearch\}/],
  },
  {
    name: 'Image-only Products view',
    file: '../src/components/products/ProductsImageOnlyControls.tsx',
    hooks: 1,
    // onScan is the view's applyScan: it sets the search exactly as onSearchChange does and also marks the text as scanned.
    scans: [/enabled: true,\s*searchRef: searchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*onScan\(code\)/],
    same: [/inputRef=\{searchInputRef\}/, /onChange=\{onSearchChange\}/, /<ScanSearchButton onDetected=\{onScan\}/],
  },
  {
    name: 'Product import conflicts search',
    file: '../src/components/products/import/ProductImportConflictsModal.tsx',
    hooks: 1,
    scans: [/enabled: true,\s*searchRef: searchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*setQuery\(code\)\s*setPage\(1\)/],
    same: [/<input ref=\{searchInputRef\} type="search" value=\{query\} onChange=\{\(event\) => \{ setQuery\(event\.target\.value\); setPage\(1\) \}\}/, /<ScanSearchButton onDetected=\{\(value\) => \{ setQuery\(value\); setPage\(1\) \}\}/],
  },
  {
    name: 'Stock Session line entry (Add / Remove / Set)',
    file: '../src/components/stock-session/StockSessionLineEntry.tsx',
    hooks: 1,
    scans: [/enabled: !busy,\s*searchRef: wedgeSearchRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{\s*if \(picked\) onClearPick\(\)\s*onScan\(code\)\s*if \(origin === 'field'\) onScanMoved\?\.\(\)/],
    same: [/<ScanSearchButton onDetected=\{onScan\}/, /onChange=\{\(event\) => onQuery\(event\.target\.value\)\}/],
  },
  {
    name: 'Sale edit: add-items and replace-line searches',
    file: '../src/components/sales/SaleDetailModal.tsx',
    hooks: 2,
    scans: [
      /enabled: replaceLineId === null,\s*searchRef: addSearchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{ fillAddSearch\(code\); tellScanMoved\(origin\) \}/,
      /enabled: replaceLineId !== null,\s*searchRef: replaceSearchInputRef,\s*onScan: \(code: string, origin: ScanOrigin\) => \{ changeAddQuery\(code\); tellScanMoved\(origin\) \}/,
    ],
    same: [
      /<ScanSearchButton onDetected=\{fillAddSearch\}/,
      /<ScanSearchButton onDetected=\{changeAddQuery\}/,
      /ref=\{replaceSearchInputRef\}/,
      /ref=\{addSearchInputRef\}/,
    ],
  },
]

for (const surface of SURFACES) {
  runTest(`${surface.name}: registers the shared hook, a scan does what typing does and nothing more`, () => {
    const source = read(surface.file)
    assert.match(source, /import \{ useScannerWedge, type ScanOrigin \} from '(?:\.\.\/)+shared\/useScannerWedge\.ts'/, 'imports the one shared hook')
    const calls = hookCalls(source)
    assert.equal(calls.length, surface.hooks, `${surface.hooks} registration(s)`)
    surface.scans.forEach((scan, index) => assert.match(calls[index], scan, `hook ${index + 1} calls the typing handler`))
    for (const call of calls) {
      assert.doesNotMatch(call, PICKS_OR_ADDS, 'a scan never adds, opens or picks')
      assert.match(call, /searchRef:/, 'anchored on the surface\'s own search field')
    }
    for (const same of surface.same) assert.match(source, same)
  })
}

runTest('a burst into a quantity box tells the person where the code went, in the language of the pack', () => {
  for (const surface of SURFACES) {
    const source = read(surface.file)
    if (surface.file.endsWith('PromotionsPage.tsx') || surface.file.endsWith('SaleDetailModal.tsx')) {
      assert.match(source, /origin === 'field'/, surface.file)
    } else if (!surface.file.endsWith('StockSessionLineEntry.tsx')) {
      assert.match(source, MOVED_NOTICE, surface.file)
    }
    if (!surface.file.endsWith('StockSessionLineEntry.tsx')) {
      assert.match(source, /scan_moved_to_search'(?:, 'Barcode moved to search'|\) \|\| 'Barcode moved to search')/, `${surface.file}: the fallback is the pack's English`)
    }
  }
  assert.equal(en.scan_moved_to_search, 'Barcode moved to search')
  assert.equal(km.scan_moved_to_search, 'បាកូដត្រូវបានផ្លាស់ទៅប្រអប់ស្វែងរក')
  assert.match(read('../src/components/sales/SaleDetailModal.tsx'), /'scan_moved_to_search', 'Barcode moved to search', 'បាកូដត្រូវបានផ្លាស់ទៅប្រអប់ស្វែងរក'/)
  assert.match(read('../src/components/inventory/FastStockInModal.tsx'), /onScanMoved=\{\(\) => notify\(tr\('scan_moved_to_search', 'Barcode moved to search'\), 'info'\)\}/)
})

runTest('Stock Session: a picked product does not hide the scanner from the Qty / Cost / Price boxes', () => {
  const entry = read('../src/components/stock-session/StockSessionLineEntry.tsx')
  // Qty, Cost and Price add the line on Enter; the search box is not rendered once a product is picked.
  assert.equal((entry.match(/onEnter=\{onAdd\}/g) || []).length, 4, 'Qty/Cost/Price (add) and the Qty/Set-to box (remove, set) are the Enter-adds')
  assert.match(entry, /const entryRef = useRef<HTMLDivElement \| null>\(null\)/)
  assert.match(entry, /\{ get current\(\) \{ return searchInputRef\.current \?\? entryRef\.current \} \}/, 'the entry row anchors the hook while the search box is gone')
  assert.match(entry, /<div ref=\{entryRef\} className="space-y-1\.5" data-stock-session-entry=\{mode\}>/)
  assert.ok(entry.indexOf('if (picked) onClearPick()') < entry.indexOf('onScan(code)'), 'the pick is cleared (as the chip\'s X does) before the code is set')
})

runTest('Stock Session host: the gun and the camera share one handler with typing\'s side effects; the pick is cleared like the chip\'s X', () => {
  const host = read('../src/components/inventory/FastStockInModal.tsx')
  assert.match(host, /onScan=\{\(value\) => \{\s*const barcode = String\(value \|\| ''\)\.trim\(\)\s*setQuery\(barcode\)\s*setPicked\(null\)\s*setScannedBarcode\(barcode\)\s*setCreatePayload\(null\)\s*\}\}/)
  assert.match(host, /onQuery=\{\(text\) => \{ setQuery\(text\); setPicked\(null\); setScannedBarcode\(''\); setCreatePayload\(null\) \}\}/)
  assert.match(host, /onClearPick=\{\(\) => \{ setEditingKey\(''\); resetLine\(\) \}\}/, 'a stale editing key would let the next Add overwrite a queued line')
})

runTest('Stock Session host: "+ Create" decides barcode-or-name with the Khmer-digit fold', () => {
  const host = read('../src/components/inventory/FastStockInModal.tsx')
  assert.match(host, /import \{ createFormSeed \} from '\.\.\/\.\.\/utils\/stockSessionCreateSeed\.ts'/)
  assert.match(host, /setCreateForm\(createFormSeed\(text, scannedBarcode\)\)/)
  assert.doesNotMatch(host, /\\d\{6,\}/, 'the Khmer-blind digit test is gone from the component')
  const seed = read('../src/utils/stockSessionCreateSeed.ts')
  assert.match(seed, /import \{ foldNativeDigits \} from '\.\/searchMatch\.ts'/)
  assert.match(seed, /\/\^\\d\{6,\}\$\/\.test\(barcode\)/)
})

runTest('Sale edit: both searches have a scan button, and the hooks sit above the `!sale` return', () => {
  const source = read('../src/components/sales/SaleDetailModal.tsx')
  assert.equal((source.match(/<ScanSearchButton\b/g) || []).length, 2, 'one for add-items, one for replace-line')
  assert.match(source, /import ScanSearchButton from '\.\.\/shared\/ScanSearchButton\.tsx'/)
  const early = source.indexOf('  if (!sale) return null')
  assert.ok(early > 0)
  for (const marker of ['useScannerWedge({', 'const changeAddQuery = (value: string): void => {', 'const fillAddSearch =']) {
    const at = source.indexOf(marker)
    assert.ok(at > 0 && at < early, `${marker} runs before the early return, or hooks would be skipped for a null sale`)
  }
  assert.equal(source.indexOf('const changeAddQuery'), source.lastIndexOf('const changeAddQuery'), 'defined once')
  const fill = source.slice(source.indexOf('const fillAddSearch ='), source.indexOf('const replaceSearchInputRef'))
  assert.match(fill, /if \(!saleBranchDisabled \|\| stockRedirect !== null\) \{ changeAddQuery\(value\); return \}/, 'the same gate typing has')
  assert.match(fill, /confirmStockRedirect\(\)\.then\(\(ready\) => \{ if \(ready && detailAliveRef\.current\) changeAddQuery\(value\) \}\)/, 'a disabled sale branch asks for the redirect first, as focusing the box does')
  assert.doesNotMatch(fill, PICKS_OR_ADDS)
})

runTest('every file that renders a scan button also registers the scanner gun (known exemptions are named)', () => {
  const EXEMPT: Record<string, string> = {
    // Lane 933 owns the inventory count page and its controls.
    'inventory/InventoryCheckControls.tsx': 'lane 933',
    // The POS and Products registered theirs in 6.0.923, with the exact-hit highlight.
  }
  const unwired: string[] = []
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(new URL(dir, import.meta.url), { withFileTypes: true })) {
      const path = `${dir}${entry.name}`
      if (entry.isDirectory()) walk(`${path}/`)
      else if (entry.name.endsWith('.tsx')) {
        const source = read(path)
        if (!/<ScanSearchButton\b/.test(source)) continue
        const relative = path.replace('../src/components/', '')
        if (!source.includes('useScannerWedge(') && !EXEMPT[relative]) unwired.push(relative)
      }
    }
  }
  walk('../src/components/')
  assert.deepEqual(unwired, [], 'a scan button with no gun hook leaves a scan with nothing focused lost, and its Enter free to add')
})

if (failed > 0) process.exitCode = 1
