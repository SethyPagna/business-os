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
  /grid-cols-\[minmax\(0,1fr\)_auto\][\s\S]*p\.barcode \? \(\s*<span className="shrink-0 whitespace-nowrap text-right font-medium text-gray-500 dark:text-gray-300">\s*\{p\.barcode\}/,
  'Mobile inventory card should keep the barcode inline with the identity tags so it does not get pushed under stock controls',
)

assert.match(
  inventorySource,
  /className="flex shrink-0 items-center justify-end gap-0\.5 text-right"/,
  'Quantity, stock status, and Adjust should share one compact inline control strip without a framed background',
)

assert.doesNotMatch(
  inventorySource,
  /rounded-xl bg-gray-50 px-2 py-1\.5 text-right dark:bg-gray-800\/70/,
  'Mobile inventory card should not keep the old stacked stock/status/adjust column',
)

console.log('PASS inventory mobile card layout keeps barcode and stock controls compact')
