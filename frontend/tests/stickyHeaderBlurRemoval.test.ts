import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// P4-4b fix 3: `backdrop-blur` on a sticky header whose background is
// already >=90% opaque (bg-*/95, /96) costs a per-frame GPU blur pass for
// zero visible difference -- the content behind it is already almost fully
// hidden. Removing the blur class and making the background fully opaque
// keeps the same visual result while dropping that per-scroll-frame cost on
// every one of these headers.
//
// Wave 2 (P4-4b item 2): the 9 sibling sites flagged in 8d89edc5's commit
// message as owned by other in-flight lanes (contacts/, products/
// StockChangeSection.tsx, returns/, sales/) have all since merged onto this
// lane's base, so they moved from outOfScopeFiles into fixedFiles below --
// same bg-*/95 + backdrop-blur -> opaque-no-blur fix, same pattern.

const testDir = dirname(fileURLToPath(import.meta.url))
const frontendRoot = resolve(testDir, '..')

function readFrontend(path: string): string {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

let failed = 0

function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

// Every file this lane fixed (opaque bg/95 or bg/96 sticky header, blur removed).
const fixedFiles = [
  'src/components/branches/Branches.tsx',
  'src/components/catalog/CatalogEditorSurface.tsx',
  'src/components/catalog/CatalogProductsSection.tsx',
  'src/components/catalog/legal/LegalPages.tsx',
  'src/components/fees/FeesPage.tsx',
  'src/components/files/FilesPage.tsx',
  'src/components/inventory/Inventory.tsx',
  'src/components/inventory/ManageBatchesModal.tsx',
  'src/components/products/lookups/ManageBrandsModal.tsx',
  'src/components/products/lookups/ManageCategoriesModal.tsx',
  'src/components/products/lookups/ManageUnitsModal.tsx',
  'src/components/products/Products.tsx',
  'src/components/products/StockInSessionsSection.tsx',
  'src/components/receipt-settings/ReceiptSettings.tsx',
  'src/components/review/ReviewQueue.tsx',
  'src/components/users/Users.tsx',
  'src/components/utils-settings/AuditLog.tsx',
  // Wave 2 (P4-4b item 2): merged onto this lane's base, now fixed too.
  'src/components/contacts/ApInvoicesSection.tsx',
  'src/components/contacts/ArInvoicesSection.tsx',
  'src/components/contacts/CustomersTab.tsx',
  'src/components/contacts/DeliveryTab.tsx',
  'src/components/contacts/StockInInvoicesSection.tsx',
  'src/components/contacts/SuppliersTab.tsx',
  'src/components/products/StockChangeSection.tsx',
  'src/components/returns/Returns.tsx',
  'src/components/sales/Sales.tsx',
]

// No files remain out of scope for this sweep any more -- every sticky
// header site this lane's earlier pass (8d89edc5) deferred has now been
// fixed above. Kept as an empty list (rather than deleted) so a future
// sticky+backdrop-blur site added elsewhere has an obvious place to land
// pending review, and the "left untouched" test below still runs (over
// zero files) instead of silently disappearing.
const outOfScopeFiles: string[] = []

const stickyBlurPattern = /sticky[^"']*backdrop-blur|backdrop-blur[^"']*sticky/

runTest('every file this lane owns no longer pairs sticky with backdrop-blur', () => {
  for (const file of fixedFiles) {
    const source = readFrontend(file)
    assert.doesNotMatch(source, stickyBlurPattern, `${file} must not still combine sticky + backdrop-blur`)
  }
})

runTest('files owned by other in-flight lanes were left untouched (still sticky + backdrop-blur)', () => {
  for (const file of outOfScopeFiles) {
    const source = readFrontend(file)
    assert.match(source, stickyBlurPattern, `${file} is out of scope for this lane and must be unchanged`)
  }
})

runTest('dead .app-topbar CSS rule is removed (zero className references remain)', () => {
  const mainCss = readFrontend('src/styles/main.css')
  // No selector should declare rules FOR .app-topbar any more (the historical
  // prose comment mentioning the class by name is fine and expected to stay).
  assert.doesNotMatch(mainCss, /^\.app-topbar \{/m, '.app-topbar light-mode rule must be removed')
  assert.doesNotMatch(mainCss, /^\.dark \.app-topbar \{/m, '.app-topbar dark-mode rule must be removed')
  assert.doesNotMatch(mainCss, /\.app-topbar \.font-medium/, 'the Khmer font-weight override targeting .app-topbar must be removed')
  // Zero React source anywhere still applies the class -- if this ever
  // regresses (someone reintroduces `className="...app-topbar..."`), this
  // test target file list would need the CSS rule back before it can be
  // called dead again.
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, out)
      else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) out.push(full)
    }
    return out
  }
  const srcDir = resolve(frontendRoot, 'src')
  const hit = walk(srcDir).find((file) => readFileSync(file, 'utf8').includes('app-topbar'))
  assert.equal(hit, undefined, `no source file may reference app-topbar any more (found: ${hit})`)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All stickyHeaderBlurRemoval tests passed')
}
