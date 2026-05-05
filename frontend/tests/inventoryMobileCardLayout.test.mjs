import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const inventorySource = readFileSync(new URL('../src/components/inventory/Inventory.jsx', import.meta.url), 'utf8')

assert.match(
  inventorySource,
  /const productTags = \[p\.brand, p\.category, p\.is_group \? 'Group' : \(p\.parent_id \? 'Variant' : ''\)\]\.filter\(Boolean\)/,
  'Mobile inventory card should keep brand, category, and group tags visible in the identity area',
)

assert.match(
  inventorySource,
  /p\.barcode \? \(\s*<span className="max-w-\[7\.25rem\] truncate rounded-md bg-white px-1\.5 py-0\.5 font-medium text-\[10px\] text-gray-500 shadow-sm dark:bg-gray-900 dark:text-gray-300">/,
  'Mobile inventory card should render barcode as a compact header pill next to stock controls',
)

assert.match(
  inventorySource,
  /className="flex min-w-0 shrink-0 items-center justify-end gap-1 rounded-xl bg-gray-50 px-2 py-1\.5 text-right dark:bg-gray-800\/70"/,
  'Barcode, quantity, stock status, and Adjust should share one compact inline control strip',
)

assert.doesNotMatch(
  inventorySource,
  /className="flex min-w-\[6\.25rem\] flex-col items-end gap-1 rounded-xl bg-gray-50 px-2 py-1\.5 text-right dark:bg-gray-800\/70"/,
  'Mobile inventory card should not keep the old stacked stock/status/adjust column',
)

console.log('PASS inventory mobile card layout keeps barcode and stock controls compact')
