import assert from 'node:assert/strict'
import fs from 'node:fs'

let failed = 0

async function runTest(name, fn) {
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
  const source = fs.readFileSync(new URL('../src/components/products/Products.jsx', import.meta.url), 'utf8')
  const surface = fs.readFileSync(new URL('../src/components/products/ProductsListSurface.jsx', import.meta.url), 'utf8')
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
  const source = fs.readFileSync(new URL('../src/components/pos/POS.jsx', import.meta.url), 'utf8')
  assert.match(source, /ProductDiscountBadge/)
  assert.match(source, /calculateProductDiscount\(product,\s*exchangeRate\)/)
  assert.match(source, /pagedProductCards\.map[\s\S]*<ProductDiscountBadge/)
  assert.match(source, /variantPromotion\.active/)
  assert.match(source, /addToCart\(variant,\s*'promotion'\)/)
})

await runTest('inventory keeps previous stats during partial refresh failures', () => {
  const source = fs.readFileSync(new URL('../src/components/inventory/Inventory.jsx', import.meta.url), 'utf8')
  assert.match(source, /const\s+\[stockStatsLoaded,\s*setStockStatsLoaded\]/)
  assert.match(source, /setStatsRefreshError/)
  assert.match(source, /if\s*\(needsStatsData\s*&&\s*statsResult\?\.item\)/)
  assert.match(source, /else\s+if\s*\(needsStatsData\s*&&\s*loadedOnceRef\.current/)
  assert.doesNotMatch(source, /setStockStats\(\{\s*total_products:\s*0/)
})

if (failed > 0) {
  process.exitCode = 1
}
