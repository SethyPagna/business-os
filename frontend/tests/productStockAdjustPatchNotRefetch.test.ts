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
// The Stock Session (FastStockInModal) reports completion as
// `onDone: () => void` with no API response, so "patch directly from the
// response" is not reachable from Products.tsx. onDone runs before the float
// clears its draft, so the host reads which products the session saved: one
// product (the detail's Adjust) refetches ONLY that row and patches it in
// place; several products, or a draft already gone, reload the page. A
// session opened from one product can queue others, so the pre-picked
// product alone is not the set that changed.
//
// No DOM renderer is available in this harness, so the wiring is a source
// assertion in the project's existing style (see
// tests/hotRowMemoBoundaries.test.ts); the saved-scope reader is executed.

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

const SESSION_ON_DONE = /onDone=\{\(\) => \{\s*const productIds = stockSessionSavedScope\(\)\?\.productIds \?\? \[\]\s*void \(productIds\.length === 1 \? refreshAdjustedProduct\(productIds\[0\]\) : load\(true\)\)\s*\}\}/

runTest('the Stock Session onDone patches the one saved product, else reloads', () => {
  const mount = products.slice(products.indexOf('{stockSession ? ('))
  const session = mount.slice(0, mount.indexOf('/>'))
  assert.match(session, /<FastStockInModal/)
  assert.match(session, SESSION_ON_DONE, 'onDone must read the saved products and patch a single one')
  // Controls: the pre-fix onDone reloaded the page on every adjust, and a
  // refresh of the pre-picked product alone misses products queued later.
  assert.doesNotMatch('onDone={() => { setAdjustStockProduct(null); setRestoreStockAdjustDraftKey(null); void load(true) }}', SESSION_ON_DONE)
  assert.doesNotMatch('onDone={() => { void (stockSession.product?.id != null ? refreshAdjustedProduct(stockSession.product.id) : load(true)) }}', SESSION_ON_DONE)
})

const store = new Map<string, string>()
const storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => { store.set(key, String(value)) },
  removeItem: (key: string) => { store.delete(key) },
}
;(globalThis as Record<string, unknown>).localStorage = storage
;(globalThis as Record<string, unknown>).sessionStorage = storage
const { stockSessionSavedScope, stockSessionHasItems } = await import('../src/utils/stockSessionBusy.ts')
const { scopedWorkDraftKey, writeWorkDraft, clearWorkDraft } = await import('../src/utils/workDrafts.ts')

runTest('the float calls onDone before it clears its draft, so the saved scope is still readable', () => {
  const float = readFrontend('src/components/inventory/FastStockInModal.tsx').replace(/\r\n/g, '\n')
  assert.match(float, /const finishSession = \(\) => \{\n\s*onDone\(\)\n\s*clearWorkDraft\(fastStockInDraftKey\)/)
  assert.match(float, /persistSessionDraft\(lines\)[\s\S]*?if \(failed\) \{\n\s*onDone\(\)/, 'a partial failure reports after the outcomes are written')
})

runTest('the saved scope lists the saved lines once each, and is null once the draft is gone', () => {
  const key = scopedWorkDraftKey('fast_stockin')
  assert.equal(stockSessionSavedScope(), null)
  assert.equal(stockSessionHasItems(), false)
  writeWorkDraft(key, { branchId: '2', lines: [
    { status: 'saved', product: { id: 7 } },
    { status: 'error', product: { id: 8 } },
    { status: 'saved', product: { id: '7' } },
    { status: 'saved', product: { id: 9 } },
    { status: 'queued', product: { id: 10 } },
  ] })
  assert.deepEqual(stockSessionSavedScope(), { branchId: '2', productIds: [7, 9] })
  assert.equal(stockSessionHasItems(), true)
  clearWorkDraft(key)
  assert.equal(stockSessionSavedScope(), null)
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All productStockAdjustPatchNotRefetch tests passed')
}
