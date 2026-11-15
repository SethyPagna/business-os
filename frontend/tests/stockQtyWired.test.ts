// Every Inventory-hub surface that shows the CURRENT on-hand quantity of one product renders <StockQty>, and none
// keeps a private copy of the state rule (the detail pane used to colour by qty <= 0, ignoring the out-of-stock threshold).
//
// Deliberately plain (each is not a current on-hand figure, or has nothing to tint):
//   - movement deltas (InventoryMovementsSurface.tsx): signed changes, not stock.
//   - movement past balances (MovementDetailFloat.tsx, ProductHistoryPreviewModal.tsx): a balance at a past moment.
//   - lots (ManageBatchesModal.tsx): lot figures have no thresholds.
//   - the projected before -> after in the stock-session review (StockSessionReviewStep.tsx): a projection, not on-hand.
//   - select-option labels (Inventory.tsx, FastStockInModal.tsx): plain text, nothing to tint.
//   - the per-branch breakdown lines in the list: a branch slice against all-branch thresholds would read "out" almost everywhere.
// Inventory Check (list rows and the session sheet) renders the "Now" figure through <StockQty> as well.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const wired: Array<{ file: string; uses: RegExp }> = [
  { file: 'components/inventory/InventoryProductsSurface.tsx', uses: /<StockQty[\s\S]*?qty=\{quantity\(product\)\}/ },
  { file: 'components/inventory/ProductDetailModal.tsx', uses: /<StockQty qty=\{stockQuantity\} product=\{p\}/ },
  { file: 'components/stock-session/StockSessionLineEntry.tsx', uses: /<StockQty qty=\{pickedStock\} product=\{picked\}/ },
  { file: 'components/inventory/InventoryCheckListRows.tsx', uses: /<StockQty qty={product.quantity} product={product}/ },
  { file: 'components/inventory/InventoryCheckRows.tsx', uses: /<StockQty qty={product.quantity} product={product}/ },
  { file: 'components/inventory/InventoryStockModals.tsx', uses: /<StockQty qty=\{getStockQty\(transferModal\)\} product=\{transferModal\} \/>/ },
]
for (const { file, uses } of wired) {
  const source = read(file)
  const importPath = file.startsWith('components/inventory/') ? './StockQty.tsx' : '../inventory/StockQty.tsx'
  assert.ok(source.includes(`from '${importPath}'`), `${file} imports the Inventory StockQty component (kept out of components/shared, which the storefront chunk loads)`)
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

// The page itself never prints the on-hand figure; only its rows do.
assert.ok(!read('components/inventory/InventoryChecksPage.tsx').includes('StockQty'), 'InventoryChecksPage hands rows to the row components and draws no stock figure')

// Deltas, past balances, lots and the projected review figure stay plain (reasons in the header).
for (const file of ['components/inventory/InventoryMovementsSurface.tsx', 'components/inventory/MovementDetailFloat.tsx', 'components/inventory/ProductHistoryPreviewModal.tsx', 'components/inventory/ManageBatchesModal.tsx', 'components/stock-session/StockSessionReviewStep.tsx']) {
  assert.ok(!read(file).includes('StockQty'), `${file} shows deltas / past balances / lot figures / a projection, not current on-hand`)
}

console.log('PASS StockQty is wired into the list, the detail pane, the stock-in picker, the transfer subtitle and the Inventory Check rows; no private rule remains')
