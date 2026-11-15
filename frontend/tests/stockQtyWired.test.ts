// Every Inventory-hub surface that shows an on-hand figure renders <StockQty>, and none keeps a private
// copy of the state rule (the detail pane used to colour by qty <= 0, ignoring the out-of-stock threshold).
// Surfaces still pending are named here so adopting them later is a deliberate edit of this list:
//   InventoryChecksPage.tsx / InventoryCheck*.tsx -- another lane owns them and adopts <StockQty> once both land.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const wired: Array<{ file: string; uses: RegExp }> = [
  { file: 'components/inventory/InventoryProductsSurface.tsx', uses: /<StockQty[\s\S]*?qty=\{quantity\(product\)\}/ },
  { file: 'components/inventory/ProductDetailModal.tsx', uses: /<StockQty qty=\{stockQuantity\} product=\{p\}/ },
  { file: 'components/stock-session/StockSessionLineEntry.tsx', uses: /<StockQty qty=\{pickedStock\} product=\{picked\}/ },
]
for (const { file, uses } of wired) {
  const source = read(file)
  assert.ok(source.includes("from '../shared/StockQty.tsx'"), `${file} imports the shared component`)
  assert.ok(uses.test(source), `${file} renders <StockQty> on the on-hand figure`)
}

// The list renders the figure only through the pill (desktop cell and phone card), never bare.
const list = read('components/inventory/InventoryProductsSurface.tsx')
assert.equal((list.match(/\{stockQty\(product\)\}/g) || []).length, 2, 'desktop cell and phone card both use the pill')
assert.ok(!/>\{quantity\(product\)\}</.test(list), 'no bare quantity(product) is printed any more')

// No private copy of the rule in the detail pane.
const detail = read('components/inventory/ProductDetailModal.tsx')
assert.ok(!/stockQuantity <= 0/.test(detail.replace(/stockValueUsd[^\n]*/, '')), 'the detail pane no longer colours by qty <= 0')
assert.ok(/stockLevelState\(stockQuantity, p, lowStockConfig\)/.test(detail), 'the bar takes the shared state')

// Not touched by this lane.
for (const file of ['components/inventory/InventoryChecksPage.tsx', 'components/inventory/InventoryCheckRows.tsx', 'components/inventory/InventoryCheckListRows.tsx']) {
  assert.ok(!read(file).includes('StockQty'), `${file} belongs to the inventory-check lane and is pending adoption`)
}

// Movements and lots show quantity DELTAS and lot figures, which have no product thresholds: not stock states.
for (const file of ['components/inventory/InventoryMovementsSurface.tsx', 'components/inventory/ManageBatchesModal.tsx']) {
  assert.ok(!read(file).includes('StockQty'), `${file} shows deltas / lot figures, not an on-hand state`)
}

console.log('PASS StockQty is wired into the list, the detail pane and the stock-in picker; no private rule remains')
