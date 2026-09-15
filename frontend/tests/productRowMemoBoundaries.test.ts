import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// P4-4b item 3: renderDesktopProductRow/renderMobileProductCard used to be
// plain closures invoked directly inside ProductsListSurface's .map() on
// EVERY render of Products.tsx (a ~5500-line component) -- there was no
// component boundary for React to bail out at, so a completely unrelated
// state change (a different section's toggle, an in-flight duplicate merge)
// still rebuilt every visible row's JSX from scratch. Two more root causes
// made this worse even after adding a memo boundary: renderUnitChip and
// openLightbox were plain (non-useCallback) functions redeclared every
// render, and BOTH were already listed in the two row useCallbacks' own
// dependency arrays -- so those callbacks were themselves rebuilt every
// render regardless of anything else, which would have silently defeated
// any row-level memoization layered on top (same class of bug
// hotRowMemoBoundaries.test.ts pinned for POS.tsx's ProductCard/POS.tsx
// pair). This test pins all of it: the memo boundary, the ctx that feeds
// it, and the two stabilized handlers underneath.
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

runTest('ProductDesktopRow and ProductMobileCard are memoized components', () => {
  assert.match(products, /import \{ Suspense, memo, useState, useEffect, useCallback, useMemo, useRef \} from 'react'/, 'Products.tsx must import memo from react')
  assert.match(products, /function ProductDesktopRowComponent\(\{ product: p, indented = false, ctx \}: \{ product: ProductRecord; indented\?: boolean; ctx: ProductRowCtx \}\) \{/, 'a standalone desktop row component must exist, taking product/indented/ctx as props')
  assert.match(products, /const ProductDesktopRow = memo\(ProductDesktopRowComponent\)/, 'the desktop row component must be wrapped in memo')
  assert.match(products, /function ProductMobileCardComponent\(\{ product: p, indented = false, ctx \}: \{ product: ProductRecord; indented\?: boolean; ctx: ProductRowCtx \}\) \{/, 'a standalone mobile card component must exist, taking product/indented/ctx as props')
  assert.match(products, /const ProductMobileCard = memo\(ProductMobileCardComponent\)/, 'the mobile card component must be wrapped in memo')
})

runTest('the row components are defined at module scope, not recreated inside ProductsFullEditor', () => {
  const componentStart = products.indexOf('function ProductDesktopRowComponent')
  const editorStart = products.indexOf('function ProductsFullEditor()')
  assert.ok(componentStart > 0 && editorStart > componentStart, 'ProductDesktopRowComponent must be declared BEFORE (outside) ProductsFullEditor, so memo() only wraps it once, not on every render')
})

runTest('renderDesktopProductRow/renderMobileProductCard now delegate to the memoized components with a shared ctx', () => {
  assert.match(products, /const renderDesktopProductRow = useCallback\(\(p: ProductRecord, \{ indented = false \}: \{ indented\?: boolean \} = \{\}\) => \(\s*<ProductDesktopRow key=\{p\.id\} product=\{p\} indented=\{indented\} ctx=\{productRowCtx\} \/>\s*\), \[productRowCtx\]\)/, 'renderDesktopProductRow must render <ProductDesktopRow> instead of building the row JSX inline')
  assert.match(products, /const renderMobileProductCard = useCallback\(\(p: ProductRecord, \{ indented = false \}: \{ indented\?: boolean \} = \{\}\) => \(\s*<ProductMobileCard key=\{p\.id\} product=\{p\} indented=\{indented\} ctx=\{productRowCtx\} \/>\s*\), \[productRowCtx\]\)/, 'renderMobileProductCard must render <ProductMobileCard> instead of building the card JSX inline')
  assert.match(products, /const productRowCtx = useMemo<ProductRowCtx>\(\(\) => \(\{/, 'a single shared ctx object must be built via useMemo so its identity is stable across unrelated renders')
})

runTest('renderUnitChip and openLightbox are stabilized with useCallback (previously plain per-render functions)', () => {
  assert.match(products, /const renderUnitChip = useCallback\(\(unitName: string \| undefined\) => \{/, 'renderUnitChip must be a useCallback, not a fresh closure every render')
  assert.match(products, /\}, \[navigateTo, tr, unitMap\]\)/, 'renderUnitChip must declare its real dependencies')
  assert.match(products, /const openLightbox = useCallback\(\(gallery: unknown, startIndex = 0, title = ''\) => \{/, 'openLightbox must be a useCallback, not a fresh closure every render')
  // Positive control: the pre-fix code declared both as plain functions,
  // which is exactly what would have defeated the ctx/memo boundary above
  // even with everything else in place.
  assert.doesNotMatch(products, /^  const renderUnitChip = \(unitName: string \| undefined\) => \{/m, 'the pre-fix unmemoized renderUnitChip must be gone')
  assert.doesNotMatch(products, /^  const openLightbox = \(gallery: unknown, startIndex = 0, title = ''\) => \{/m, 'the pre-fix unmemoized openLightbox must be gone')
})

runTest('the tagged/held child rows (TaggedStockRows.tsx) are also memoized', () => {
  const taggedStockRows = readFrontend('src/components/products/TaggedStockRows.tsx')
  assert.match(taggedStockRows, /import \{ memo, useState \} from 'react'/, 'TaggedStockRows.tsx must import memo from react')
  assert.match(taggedStockRows, /export const TaggedStockDesktopRow = memo\(TaggedStockDesktopRowComponent\)/, 'TaggedStockDesktopRow must be memoized')
  assert.match(taggedStockRows, /export const TaggedStockMobileCard = memo\(TaggedStockMobileCardComponent\)/, 'TaggedStockMobileCard must be memoized')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('All productRowMemoBoundaries tests passed')
}
