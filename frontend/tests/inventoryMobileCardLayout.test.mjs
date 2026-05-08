import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const inventoryProductsSource = readFileSync(new URL('../src/components/inventory/InventoryProductsSurface.jsx', import.meta.url), 'utf8')

assert.match(
  inventoryProductsSource,
  /const productBrand = String\(p\.brand \|\| ''\)\.trim\(\)[\s\S]*const productCategory = String\(p\.category \|\| ''\)\.trim\(\)[\s\S]*const productTagText = \[productBrand, productCategory, p\.barcode\]\.filter\(Boolean\)\.join\(' \| '\)/,
  'Mobile inventory card should keep brand, category, and barcode visible in one compact identity line',
)

assert.match(
  inventoryProductsSource,
  /className="mt-1 min-w-0 truncate pl-6 text-\[10px\] leading-3\.5 text-gray-500 dark:text-gray-300" title=\{productTagText\}/,
  'Mobile inventory card should render product details as a single ellipsized line below the product name',
)

assert.match(
  inventoryProductsSource,
  /className="flex max-w-\[8\.6rem\] shrink-0 flex-col items-end gap-1 text-right"[\s\S]*\{qty\}[\s\S]*\{slbl\}/,
  'Quantity and stock status should share a compact top-right line without crowding the product details',
)

assert.match(
  inventoryProductsSource,
  /className="mt-2 flex items-start justify-between gap-2 border-t border-gray-100 pt-2 dark:border-gray-700"[\s\S]*Sold \{soldQty\} \| Rev \{fmtUSD\(revenue\)\}[\s\S]*className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1\.5 text-\[11px\] font-semibold[\s\S]*\{t\('adjust'\)\}/,
  'Adjust action should sit beside pricing and sales metrics as a professional compact button',
)

assert.match(
  inventoryProductsSource,
  /className="truncate text-sm font-semibold leading-tight text-gray-900 dark:text-white"/,
  'Mobile inventory card should ellipsize long product names instead of letting them collide with stock controls',
)

assert.doesNotMatch(
  inventoryProductsSource,
  /rounded-xl bg-gray-50 px-2 py-1\.5 text-right dark:bg-gray-800\/70/,
  'Mobile inventory card should not keep the old stacked stock/status/adjust column',
)

console.log('PASS inventory mobile card layout keeps barcode and stock controls compact')
