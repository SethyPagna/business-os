// Section 3 (Sept 2 2026): the Branches hub's Inventory tab used to literally
// re-render BranchesSection view="branches" -- the same branch-cards content
// Overview shows -- so "Inventory" was visually indistinguishable from
// "Overview" (see BranchesHubPage.tsx and nestedUiIntegrity.test.ts /
// branchesDateScope.test.ts for the fix to that specific regression). This
// file pins the RESTORED branch-stock product workspace itself: a distinct
// surface with product rows, per-branch stock, batch counts, and the SAME
// adjust/transfer/manage-batches modals the Movements section already opens
// -- it must never duplicate catalogue editing (name/price/images/description
// stay on Products.tsx; this surface only links out to it).

import assert from 'node:assert/strict'
import fs from 'node:fs'

const hubSource = fs.readFileSync(new URL('../src/components/branches/BranchesHubPage.tsx', import.meta.url), 'utf8')
const inventory = fs.readFileSync(new URL('../src/components/inventory/Inventory.tsx', import.meta.url), 'utf8')
const surface = fs.readFileSync(new URL('../src/components/inventory/InventoryProductsSurface.tsx', import.meta.url), 'utf8')
const products = fs.readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')

// --- The hub wires Inventory to the products workspace, not Overview's cards ---

assert.match(
  hubSource,
  /active === 'inventory' && canInventory \? \([\s\S]{0,200}<InventorySection[\s\S]{0,120}hostSection="products"/,
  'the Branches hub Inventory tab must drive InventorySection with hostSection="products"',
)
assert.doesNotMatch(
  hubSource,
  /active === 'inventory' && canInventory \? \([\s\S]{0,400}<BranchesSection/,
  'the Branches hub Inventory tab must not fall back to rendering BranchesSection (that duplicates the Overview tab)',
)

// --- The product-stock table itself renders under the restored products tab ---

assert.match(inventory, /const InventoryProductsSurface = lazyRetry\(\(\) => import\('\.\/InventoryProductsSurface'\), 'inventory-products-surface'\)/, 'the products workspace must load as its own lazy chunk, like Movements and RFID')
assert.match(inventory, /const showProductsSection = showInventorySections && tab === 'products'/, 'the products surface must be gated by the products tab like every other inventory section')
assert.match(inventory, /\{showProductsSection \? \(/, 'Inventory must conditionally render the products surface')
assert.match(inventory, /<InventoryProductsSurface[\s\S]{0,40}items=\{productsItems\}/, 'the products surface must receive the loaded product rows')
assert.match(inventory, /needsProductsData = inventorySection === 'products' \|\| \(inventorySection === 'all' && tab === 'products'\)/, 'the products list must only fetch when the products tab/section is actually shown')
assert.match(inventory, /getInventoryApi\(\)\.searchInventoryProducts\(\{/, 'the products surface must be backed by the real /products/search endpoint, not a placeholder')

// --- It reuses the shared list-surface components, not bespoke markup ---

for (const [name, re] of [
  ['ColumnChooser', /import ColumnChooser from '\.\.\/shared\/ColumnChooser\.tsx'/],
  ['useColumnPreferences', /import \{ useColumnPreferences \} from '\.\.\/shared\/useColumnPreferences\.ts'/],
  ['TruncatedText', /import TruncatedText from '\.\.\/shared\/TruncatedText\.tsx'/],
  ['PaginationControls', /import PaginationControls from '\.\.\/shared\/PaginationControls\.tsx'/],
  ['LazyPortalMenu', /import LazyPortalMenu from '\.\.\/shared\/LazyPortalMenu'/],
] as const) {
  assert.match(surface, re, `InventoryProductsSurface must reuse the shared ${name} component rather than a bespoke reimplementation`)
}
assert.match(surface, /<TruncatedText text=\{String\(product\.name \|\| ''\)\}/, 'long product names must be revealable in full, not dead-end truncated')
assert.match(surface, /<ColumnChooser columns=\{chooserColumns\}/, 'optional columns must be excel-style chooser driven, not hard-coded')
assert.match(surface, /<PaginationControls[\s\S]{0,40}page=\{page\}/, 'the products table must page through the shared pagination control')

// Search row, filter menu, and stats strip are the SAME instances every other
// Inventory tab uses (they live once in Inventory.tsx, gated by `tab`), not
// separate copies bolted onto the products surface.
assert.match(inventory, /<SearchInput[\s\S]{0,450}tab === 'products'/, 'the shared search row must branch its placeholder for the products tab rather than adding a second search box')
assert.match(inventory, /if \(tab === 'products'\) \{[\s\S]{0,80}\/\/ Restored Sept 2 2026/, 'the shared FilterMenu must gain a products-tab facet set (branch\\/stock-state\\/brand\\/category)')

// --- Catalogue editing stays on Products.tsx; this surface only links out ---

assert.match(surface, /onOpenInCatalogue\?: \(product: AnyRecord\) => void/, 'the catalogue link-out must be optional so the surface never assumes navigation is wired')
assert.match(surface, /tr\('open_in_products', 'Open in Products catalogue'\)/, 'the row menu must offer an explicit link out to the Products catalogue')
assert.doesNotMatch(surface, /selling_price_usd:\s*\{[\s\S]{0,20}onChange|<input[\s\S]{0,60}defaultValue=\{product\.name\}/, 'the branch-stock workspace must never grow inline catalogue-editing form fields (name/price/images/description stay on Products.tsx)')
assert.match(inventory, /window\.sessionStorage\.setItem\('bos:dashboard:products-focus', JSON\.stringify\(\{ search: product\?\.name \|\| '' \}\)\)/, 'jumping to the catalogue must hand off the product name so Products.tsx lands on the right row')
assert.match(products, /const prefillSearch = String\(payload\?\.search \|\| ''\)\.trim\(\)/, 'Products.tsx must consume the branch-stock workspace\'s handoff search term')

// --- Adjust / transfer are gated behind the same per-action permission table every other entry point uses ---

assert.match(inventory, /const canAdjustStock = can\('inventory', 'adjust'\)/, 'stock adjustment must stay gated behind the inventory:adjust permission action')
assert.match(inventory, /const canTransferStock = can\('inventory', 'transfer'\)/, 'stock transfer must stay gated behind the inventory:transfer permission action')
assert.match(inventory, /<InventoryProductsSurface[\s\S]{0,700}canAdjustStock=\{canAdjustStock\}/, 'the products surface must receive the real permission flag, not assume access')
assert.match(inventory, /<InventoryProductsSurface[\s\S]{0,760}canTransferStock=\{canTransferStock\}/, 'the products surface must receive the real permission flag, not assume access')
assert.match(surface, /canAdjustStock \? \{ label: tr\('adjust', 'Adjust'\)/, 'the row action menu must hide Adjust when the viewer lacks inventory:adjust')
assert.match(surface, /canTransferStock \? \{ label: tr\('stock_transfer', 'Transfer'\)/, 'the row action menu must hide Transfer when the viewer lacks inventory:transfer')
assert.match(surface, /\{canAdjustStock \? \(\s*<button type="button"[\s\S]{0,150}onClick=\{\(\) => \{ setStockPopoverId\(null\); onAdjust\(product\) \}\}/, 'the branch-stock popover\'s inline Adjust action must also respect the permission gate')

// --- Adjust/transfer/manage-batches carry the product (and therefore its
// batch/branch identity) through the SAME shared modal-opening functions the
// Movements section already uses -- there is exactly one implementation. ---

assert.match(inventory, /const openAdjust = \(p: InventoryProduct\) => \{/, 'openAdjust must remain the single shared adjust-modal opener')
assert.match(inventory, /product_id: p\.id,[\s\S]{0,200}branch_id: defaultBranchId,/, 'opening Adjust must seed both the product id and a branch id onto the form')
assert.match(inventory, /const openTransfer = \(p: InventoryProduct\) => \{/, 'openTransfer must remain the single shared transfer-modal opener')
assert.match(inventory, /const branchStock = Array\.isArray\(p\?\.branch_stock\) \? p\.branch_stock : \[\]/, 'opening Transfer must read the product\'s own per-branch stock to pick a source branch with real quantity')
assert.match(inventory, /const openManageBatches = \(p: InventoryProduct\) => \{/, 'openManageBatches must remain the single shared batches-modal opener (batch identity lives in that modal, never duplicated here)')
assert.match(inventory, /onAdjust=\{openAdjust\}/, 'the products surface must call the shared openAdjust, not a local reimplementation')
assert.match(inventory, /onTransfer=\{openTransfer\}/, 'the products surface must call the shared openTransfer, not a local reimplementation')
assert.match(inventory, /onManageBatches=\{openManageBatches\}/, 'the products surface must call the shared openManageBatches, not a local reimplementation')
assert.match(surface, /onClick: \(\) => onAdjust\(product\)/, 'the row menu\'s Adjust action must pass the FULL product row (carrying its id and branch_stock) through, not just an id')
assert.match(surface, /onClick: \(\) => onTransfer\(product\)/, 'the row menu\'s Transfer action must pass the full product row through')
assert.match(surface, /onClick: \(\) => onManageBatches\(product\)/, 'the row menu\'s Manage batches action must pass the full product row through')

// --- Branch scoping: the current branch filter narrows the product list server-side and seeds Adjust/Transfer defaults ---

assert.match(inventory, /branchFilter !== 'all' \? \{ branchId: parseInt\(branchFilter, 10\) \} : \{\}/, 'the products search request must scope by the selected branch like every other inventory read')
assert.match(inventory, /const defaultSourceId = branchFilter !== 'all'\s*\? String\(branchFilter\)/, 'Transfer must default its source branch to whichever branch is currently filtered')
assert.match(surface, /function totalStockOf\(product: AnyRecord, branchFilter: string, getStockQty: \(p\?: AnyRecord \| null\) => number\): number \{/, 'the stock cell must resolve quantity for the CURRENT branch filter, not always the product total')

console.log('PASS branch inventory workspace: restored product-stock table, shared components, permission gates, and batch/branch identity carry-through')
