import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const inventorySource = readFileSync(new URL('../src/components/inventory/Inventory.jsx', import.meta.url), 'utf8')

assert.match(
  inventorySource,
  /const productTagText = \[p\.brand,\s*p\.category\]\.filter\(Boolean\)\.join\(' · '\)/,
  'Mobile inventory card should keep brand and category visible in the identity area',
)

assert.match(
  inventorySource,
  /className="flex min-w-\[4\.35rem\] max-w-\[4\.6rem\] shrink-0 flex-col items-end gap-0\.5 text-right"[\s\S]*p\.barcode \? \(\s*<span className="mt-0\.5 max-w-full truncate rounded-full bg-slate-100 px-1\.5 py-0\.5 text-\[8\.5px\] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-300">\s*\{p\.barcode\}/,
  'Mobile inventory card should keep the barcode in the compact stock-controls area instead of dropping into a separate lower block',
)

assert.match(
  inventorySource,
  /className="flex items-center justify-end gap-0\.5"[\s\S]*\{qty\}[\s\S]*\{slbl\}[\s\S]*\{t\('adjust'\)\}/,
  'Quantity, stock status, and Adjust should share one compact inline control strip',
)

assert.doesNotMatch(
  inventorySource,
  /rounded-xl bg-gray-50 px-2 py-1\.5 text-right dark:bg-gray-800\/70/,
  'Mobile inventory card should not keep the old stacked stock/status/adjust column',
)

console.log('PASS inventory mobile card layout keeps barcode and stock controls compact')
