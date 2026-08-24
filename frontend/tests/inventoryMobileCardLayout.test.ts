import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const inventoryProductsSource = readFileSync(new URL('../src/components/inventory/InventoryProductsSurface.tsx', import.meta.url), 'utf8')

assert.match(
  inventoryProductsSource,
  /const productBrand = String\(p\.brand \|\| ''\)\.trim\(\)[\s\S]*const productCategory = String\(p\.category \|\| ''\)\.trim\(\)[\s\S]*const productTagText = \[productBrand, productCategory, p\.barcode\]\.filter\(Boolean\)\.join\(' \| '\)/,
  'Mobile inventory card should keep brand, category, and barcode visible in one compact identity line',
)

assert.match(
  inventoryProductsSource,
  /className=\{`mt-0\.5 min-h-\[0\.65rem\] min-w-0 text-\[10px\] leading-3 text-gray-500 dark:text-gray-300 \$\{selectionModeActive \? 'pl-6' : ''\}`\} title=\{productTagText\}/,
  'Mobile inventory card should render product details as a single ellipsized line below the product name, indented under the checkbox only while select mode is active',
)

assert.match(
  inventoryProductsSource,
  /className="flex max-w-\[7rem\] shrink-0 flex-col items-end gap-0\.5 text-right"[\s\S]*className=\{`min-w-0 max-w-\[5\.6rem\] truncate whitespace-nowrap text-\[11px\] font-bold leading-none \$\{stockTextClass\}`\}[\s\S]*\{qty\}/,
  'Quantity should be color-coded by stock status (stockTextClass) instead of a separate status badge pill',
)

assert.match(
  inventoryProductsSource,
  /className="mt-0\.5 flex items-start justify-between gap-2 border-t border-gray-100 pt-0\.5 dark:border-gray-700"[\s\S]*title=\{t\('sold_qty'\) \|\| 'Sold quantity'\}>×\{soldQty\}[\s\S]*text-purple-700 dark:text-purple-400" title=\{t\('revenue'\) \|\| 'Revenue'\}>\{fmtUSD\(revenue\)\}[\s\S]*className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1\.5 text-\[11px\] font-semibold[\s\S]*\{t\('adjust'\)\}/,
  'Adjust action should sit beside pricing and sales metrics as a professional compact button (sold/revenue now shown via color + title, collapsed into the cost/price row)',
)

assert.match(
  inventoryProductsSource,
  /className="whitespace-nowrap text-red-600" title=\{t\('purchase_price'\) \|\| 'Cost'\}>\{fmtUSD\(p\.purchase_price_usd \|\| p\.cost_price_usd \|\| 0\)\}[\s\S]*className="whitespace-nowrap text-green-700" title=\{t\('selling_price'\) \|\| 'Price'\}>\{fmtUSD\(p\.selling_price_usd \|\| 0\)\}/,
  'Mobile inventory card cost/price should be color-coded (red/green) to match the Products page compact-stat pattern, not plain gray text',
)

assert.match(
  inventoryProductsSource,
  /className="truncate text-\[13px\] font-semibold leading-\[1\.05rem\] text-gray-900 dark:text-white"/,
  'Mobile inventory card should ellipsize long product names instead of letting them collide with stock controls',
)

assert.doesNotMatch(
  inventoryProductsSource,
  /rounded-xl bg-gray-50 px-2 py-1\.5 text-right dark:bg-gray-800\/70/,
  'Mobile inventory card should not keep the old stacked stock/status/adjust column',
)

console.log('PASS inventory mobile card layout keeps barcode and stock controls compact')
