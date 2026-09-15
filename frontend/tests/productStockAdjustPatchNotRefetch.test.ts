import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// P4-4b fix 6: after a single stock adjust on the Products page, the old
// code called load(true) -- a full re-search of the current filtered/
// sorted/paginated page (every visible row, with branch_stock/images/
// batches joins) -- just to reflect ONE row changing. That is one more
// concrete cause of the owner's "takes a while to load, completed etc" PWA
// lag: an action on one product waited for the whole page to come back.
//
// StockAdjustModal.tsx (owned by another lane, not editable here) only
// reports completion as `onDone: () => void` with no adjust API response,
// so "patch directly from the response" is not reachable from Products.tsx.
// The achievable, honest fix is the documented fallback: refetch ONLY the
// one adjusted product (already-existing fetchProductsByIds, one row) and
// patch it into the local `products` array in place, falling back to a full
// load(true) only when the product id is unknown or the refetch does not
// resolve to a row still on the current page/filter.
//
// No DOM renderer is available in this harness, so this is a source-
// assertion test in the project's existing style (see
// tests/hotRowMemoBoundaries.test.ts).

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

const products = readFrontend('src/components/products/Products.tsx')

runTest('patchProductRow updates one row in place instead of replacing the whole products array', () => {
  assert.match(products, /const patchProductRow = useCallback\(\(updated: ProductRecord \| undefined \| null\): boolean => \{/, 'a dedicated single-row patch helper must exist')
  assert.match(products, /setProducts\(\(prev\) => prev\.map\(\(product\) => \(\s*Number\(product\?\.id \|\| 0\) === id \? \{ \.\.\.product, \.\.\.updated \} : product\s*\)\)\)/, 'the patch must replace only the matching row, preserving every other row and array identity churn to a minimum')
})

runTest('refreshAdjustedProduct refetches only the adjusted product, not the whole page', () => {
  assert.match(products, /const refreshAdjustedProduct = useCallback\(async \(productId: EntityId \| null \| undefined\): Promise<void> => \{/, 'a dedicated post-adjust refresh helper must exist')
  const start = products.indexOf('const refreshAdjustedProduct = useCallback')
  const body = products.slice(start, products.indexOf('}, [fetchProductsByIds, load, patchProductRow])', start))
  assert.match(body, /const \[latest\] = await fetchProductsByIds\(\[id\]\)/, 'must fetch exactly the one adjusted product by id, not run a page search')
  assert.match(body, /if \(!latest \|\| !patchProductRow\(latest\)\) await load\(true\)/, 'a full reload must remain the fallback when the single-product refetch cannot resolve the row (unknown id, or it no longer matches the active filter/page)')
})

runTest('the stock-adjust onDone handler uses the patch-one-product path, not an unconditional full reload', () => {
  assert.match(products, /onDone=\{\(\) => \{\s*const adjustedProductId = adjustStockProduct\?\.id \?\? null\s*setAdjustStockProduct\(null\)\s*setRestoreStockAdjustDraftKey\(null\)\s*void refreshAdjustedProduct\(adjustedProductId\)\s*\}\}/, 'onDone must resolve the adjusted product id and hand off to refreshAdjustedProduct')
  // Positive control: the pre-fix onDone unconditionally called load(true)
  // for every single stock adjustment, regardless of which one row changed.
  assert.doesNotMatch(products, /onDone=\{\(\) => \{ setAdjustStockProduct\(null\); setRestoreStockAdjustDraftKey\(null\); void load\(true\) \}\}/, 'the pre-fix unconditional full-page reload on every stock adjust must be gone')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All productStockAdjustPatchNotRefetch tests passed')
}
