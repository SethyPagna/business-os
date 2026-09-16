import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0

type TestCallback = () => void | Promise<void>

async function runTest(name: string, fn: TestCallback): Promise<void> {
  try {
    await fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

await runTest('products table separates product identity from operational details', () => {
  const source = fs.readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
  const surface = fs.readFileSync(new URL('../src/components/products/surfaces/ProductsListSurface.tsx', import.meta.url), 'utf8')
  assert.match(source, /ProductDiscountBadge/)
  assert.match(source, /ProductDetailsCell/)
  assert.match(surface, /t\('details'\)\s*\|\|\s*'Details'/)
  assert.match(source, /renderDesktopProductRow[\s\S]*<ProductDetailsCell/)
  assert.match(source, /renderMobileProductCard[\s\S]*<ProductDiscountBadge[\s\S]*overlay/)
  const desktopRowStart = source.indexOf('const renderDesktopProductRow')
  const desktopRowEnd = source.indexOf('const renderMobileProductCard', desktopRowStart)
  const desktopRowSource = source.slice(desktopRowStart, desktopRowEnd)
  assert.doesNotMatch(desktopRowSource, /renderUnitChip\(product\.unit\)/)
})

await runTest('POS product cards expose discount badges before opening details', () => {
  const source = fs.readFileSync(new URL('../src/components/pos/POS.tsx', import.meta.url), 'utf8')
  // N19 round 3: the card body is components/pos/ProductCard.tsx now -- one
  // component, mounted by the POS grid and by the sale screen's add-items and
  // Replace searches. The badge rule is asserted in its new home, plus the
  // POS grid still mounting it, which together is what this lock was after.
  const card = fs.readFileSync(new URL('../src/components/pos/ProductCard.tsx', import.meta.url), 'utf8')
  const detailSheet = fs.readFileSync(new URL('../src/components/pos/ProductDetailSheet.tsx', import.meta.url), 'utf8')
  assert.match(card, /ProductDiscountBadge/)
  // G1 (Part 391): the badge evaluates the shared promotion kernel
  // (promotionBadgeForProduct -- product discount OR rule, including
  // buy->=X hints), no longer bare calculateProductDiscount.
  assert.match(card, /promotionBadgeForProduct\(product,\s*promotionRules\)/)
  assert.match(card, /<ProductDiscountBadge/)
  assert.match(source, /pagedProductCards\.map[\s\S]*<ProductCard/)
  // Component uses the "effective" naming convention for whichever variant
  // the branch+barcode pickers currently resolve to (effectiveVariant,
  // effectiveVariantStock, effectiveVariantInStock, effectiveVariantPromotion)
  // -- match that, not a bare "variant"/"variantPromotion" that was never
  // the actual identifier here.
  assert.match(detailSheet, /effectiveVariantPromotion\.active/)
  assert.match(detailSheet, /closeAfterAdd\(effectiveVariant,\s*'promotion'\)/)
})

await runTest('inventory retains legacy refresh stats but clears unavailable Products scope totals', () => {
  const source = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
  assert.match(source, /const\s+\[stockStatsLoaded,\s*setStockStatsLoaded\]/)
  assert.match(source, /setStatsRefreshError/)
  assert.match(source, /if\s*\(needsStatsData\s*&&\s*statsResult\?\.item\)/)
  assert.match(source, /else\s+if\s*\(needsStatsData\s*&&\s*\(needsProductsData\s*\|\|\s*loadedOnceRef\.current\)\)/)
  // Execute the actual stats-result branch: the Products exception must not
  // accidentally erase confirmed legacy stats or expose stale scoped totals.
  const start = source.indexOf('if (needsStatsData && statsResult?.item)')
  const end = source.indexOf('if (needsMovementData', start)
  assert.ok(start >= 0 && end > start, 'stats-result branch remains identifiable')
  const applyResult = new Function('needsStatsData', 'statsResult', 'needsProductsData', 'loadedOnceRef', 'inventoryStatsScope', 'setStockStats', 'setStockStatsScope', 'setStockStatsLoaded', 'setStatsRefreshError', 'tr', source.slice(start, end))
  const previous = { total_products: 7 }
  for (const products of [false, true]) {
    for (const loaded of [false, true]) {
      const state = { stats: previous as object | null, scope: 'old', loaded, error: '' }
      applyResult(true, null, products, { current: loaded }, 'new',
        (value: object | null) => { state.stats = value },
        (value: string) => { state.scope = value },
        (value: boolean) => { state.loaded = value },
        (value: string) => { state.error = value }, (key: string) => key)
      assert.equal(state.stats, products ? null : previous)
      assert.equal(state.loaded, products ? false : loaded)
      assert.equal(state.scope, products || loaded ? 'new' : 'old')
      assert.equal(state.error, products ? 'inventory_products_load_failed' : loaded ? 'inventory_stats_refresh_failed' : '')
    }
  }
  assert.match(source, /serverStats=\{stockStatsScope === inventoryStatsScope \? stockStats : null\}/)
  assert.match(source, /statsError=\{stockStatsScope === inventoryStatsScope \? statsRefreshError : null\}/)
  assert.doesNotMatch(source, /setStockStats\(\{\s*total_products:\s*0/)
})

if (failed > 0) {
  process.exitCode = 1
}
