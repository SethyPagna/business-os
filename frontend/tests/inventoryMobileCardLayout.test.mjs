import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const inventoryProductsSource = readFileSync(new URL('../src/components/inventory/InventoryProductsSurface.jsx', import.meta.url), 'utf8')

assert.match(
  inventoryProductsSource,
  /const productBrand = String\(p\.brand \|\| ''\)\.trim\(\)[\s\S]*const productCategory = String\(p\.category \|\| ''\)\.trim\(\)[\s\S]*const productTagText = \[productBrand, productCategory\]\.filter\(Boolean\)\.join\(' Â· '\)/,
  'Mobile inventory card should keep brand and category visible in the identity area',
)

assert.match(
  inventoryProductsSource,
  /className="flex min-w-\[4\.35rem\] max-w-\[4\.6rem\] shrink-0 flex-col items-end gap-0\.5 text-right"[\s\S]*\{p\.barcode\}/,
  'Mobile inventory card should keep the barcode in the compact stock-controls area instead of dropping into a separate lower block',
)

assert.match(
  inventoryProductsSource,
  /className="flex items-center justify-end gap-0\.5"[\s\S]*\{qty\}[\s\S]*\{slbl\}[\s\S]*\{t\('adjust'\)\}/,
  'Quantity, stock status, and Adjust should share one compact inline control strip',
)

assert.doesNotMatch(
  inventoryProductsSource,
  /rounded-xl bg-gray-50 px-2 py-1\.5 text-right dark:bg-gray-800\/70/,
  'Mobile inventory card should not keep the old stacked stock/status/adjust column',
)

console.log('PASS inventory mobile card layout keeps barcode and stock controls compact')
