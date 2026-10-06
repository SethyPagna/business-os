import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Owner, 30 Sep 2026: "check the adjust stock through the products section
// click on products row and detail. make them more consistent ... just use
// the normal consistent logic". Every row / detail Adjust opens the ONE Stock
// Session (FastStockInModal) in Add with that product pre-picked; the old
// one-product form (StockAdjustModal, the adjust half of InventoryStockModals,
// ReceiveBatchModal) is gone. Adjust and Add variant show only for the grants
// they need.
//
// The UI gate mirrors the Worker, which already refuses without the grant:
// cloudflare/src/routes/inventory.ts:1500 (`getActionTier(user, 'inventory',
// 'adjust') !== 'full'` -> 403 on /api/inventory/adjust) and
// cloudflare/src/routes/stockInCommit.ts:83 (`canReceiveBatchStock` ->
// inventory adjust not blocked, for every receive line of the session commit).

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function jsxBlock(source: string, tag: string): string {
  const start = source.indexOf(`<${tag}`)
  if (start < 0) return ''
  const end = source.indexOf('/>', start)
  return end < 0 ? '' : source.slice(start, end)
}

// Products: the detail's Adjust opens the session mount in Add with the product.
function productsDetailOpensSession(source: string): boolean {
  const detail = jsxBlock(source, 'ProductDetailModal')
  const opener = /onAdjustStock=\{canAdjustInventoryStock \? \(\) => \{ setDetailProduct\(null\); setStockSession\(\{ mode: 'add', product: detailProduct \}\) \} : undefined\}/
  if (!opener.test(detail)) return false
  const mount = source.slice(source.indexOf('{stockSession ? ('))
  const modal = jsxBlock(mount, 'FastStockInModal')
  return /initialProduct=\{sessionProduct\(stockSession\.product\)\}/.test(modal)
    && /initialMode=\{stockSession\.mode\}/.test(modal)
    && /const FastStockInModal = lazyRetry\(\(\) => import\('\.\.\/inventory\/FastStockInModal'\)/.test(source)
}

// Inventory (the Branches hub products section and its detail): openAdjust
// opens the same session with the row's product, in Add.
function inventoryAdjustOpensSession(source: string): boolean {
  if (!/const openAdjust = \(p: InventoryProduct\) => openFastStockIn\(p\)/.test(source)) return false
  const mount = source.slice(source.indexOf('{showFastStockIn ? ('))
  const modal = jsxBlock(mount, 'FastStockInModal')
  return /initialProduct=\{fastStockInProduct\}/.test(modal) && /initialMode="add"/.test(modal)
}

// Branches: a product card's Receive opens the session with the product and
// that card's branch preset.
function branchesReceiveOpensSession(source: string): boolean {
  const mount = source.slice(source.indexOf('{receiveTarget ? ('))
  const modal = jsxBlock(mount, 'LazyFastStockInModal')
  return /initialProduct=\{receiveTarget\.product\}/.test(modal)
    && /defaultBranchId=\{receiveTarget\.branchId\}/.test(modal)
    && /initialMode="add"/.test(modal)
}

function noLegacyAdjustEntry(products: string, inventory: string, branches: string): boolean {
  return !/StockAdjustModal|setAdjustStockProduct|BulkAddStockModal|CreateProductsSessionModal/.test(products)
    && !/setAdjustModal\(|adjustModal=\{|InventoryReasonManagerModal/.test(inventory)
    && !/ReceiveBatchModal/.test(branches)
}

function gatesDetailActions(source: string): boolean {
  const detail = jsxBlock(source, 'ProductDetailModal')
  return /const canAddProduct = can\('products', 'add'\)/.test(source)
    && /const canAdjustInventoryStock = can\('inventory', 'adjust'\)/.test(source)
    && /const canAddVariant = canAddProductVariant\(user\)/.test(source)
    && /onAddVariant=\{canAddVariant \? \(\) => \{/.test(detail)
    && /onAdjustStock=\{canAdjustInventoryStock \? /.test(detail)
}

function gatesInventoryAdjust(source: string): boolean {
  return /const canAdjustStock = can\('inventory', 'adjust'\)/.test(source)
    && (source.match(/onAdjust=\{canAdjustStock \? openAdjust : undefined\}/g) || []).length === 2
    && !/onAdjust=\{openAdjust\}/.test(source)
}

// The shape each check refused before this lane (base 57cf2db5a), so a pass
// below cannot come from a predicate that accepts anything.
const OLD_PRODUCTS = `
const StockAdjustModal = lazyRetry(() => import('./forms/StockAdjustModal'), 'products-stock-adjust-modal')
  const canAddProduct = can('products', 'add')
  const canAdjustInventoryStock = can('inventory', 'adjust')
          <ProductDetailModal
            onAddVariant={() => { setVariantModal(detailProduct); setDetailProduct(null) }}
            onAdjustStock={() => { setDetailProduct(null); setAdjustStockProduct(detailProduct) }}
            onClose={()=>setDetailProduct(null)}
          />
      {adjustStockProduct || restoreStockAdjustDraftKey ? (
          <StockAdjustModal
            initialProduct={adjustStockProduct}
            restoreDraftKey={restoreStockAdjustDraftKey}
          />
      ) : null}
`
const OLD_INVENTORY = `
  const canAdjustStock = can('inventory', 'adjust')
  const openAdjust = (p: InventoryProduct) => {
    setAdjustModal(p)
  }
            onAdjust={canAdjustStock ? openAdjust : undefined}
            onAdjust={canAdjustStock ? openAdjust : undefined}
      {adjustModal || transferModal ? (
          <InventoryStockModals
            adjustModal={adjustModal}
          />
      ) : null}
      {showFastStockIn ? (
          <FastStockInModal
            branchOptions={branchSelectOptions}
            defaultBranchId={branchFilter !== 'all' ? branchFilter : null}
          />
      ) : null}
`
const OLD_BRANCHES = `
const LazyReceiveBatchModal = lazyRetry(async () => ({ default: (await import('../inventory/ReceiveBatchModal')).default }), 'branches-receive-batch-modal')
      {receiveTarget ? (
          <LazyReceiveBatchModal
            product={{ id: receiveTarget.product.id, name: receiveTarget.product.name || '', unit: receiveTarget.product.unit || '' }}
            defaultBranchId={receiveTarget.branchId}
          />
      ) : null}
`

const products = read('../src/components/products/Products.tsx')
const inventory = read('../src/components/inventory/Inventory.tsx')
const branches = read('../src/components/branches/Branches.tsx')

runTest('the checks refuse the pre-lane sources (discriminating fixtures)', () => {
  assert.equal(productsDetailOpensSession(OLD_PRODUCTS), false)
  assert.equal(inventoryAdjustOpensSession(OLD_INVENTORY), false)
  assert.equal(branchesReceiveOpensSession(OLD_BRANCHES), false)
  assert.equal(noLegacyAdjustEntry(OLD_PRODUCTS, OLD_INVENTORY, OLD_BRANCHES), false)
  assert.equal(gatesDetailActions(OLD_PRODUCTS), false, 'Add variant was offered without products add')
})

runTest('Products detail Adjust opens the Stock Session in Add with that product', () => {
  assert.ok(productsDetailOpensSession(products))
})

runTest('Inventory row and detail Adjust open the same session with the row product', () => {
  assert.ok(inventoryAdjustOpensSession(inventory))
})

runTest('Branches Receive opens the same session with the product and its branch', () => {
  assert.ok(branchesReceiveOpensSession(branches))
})

runTest('no new-entry path opens the retired one-product forms', () => {
  assert.ok(noLegacyAdjustEntry(products, inventory, branches))
})

runTest('Adjust and Add variant are gated on inventory adjust and products add', () => {
  assert.ok(gatesDetailActions(products))
  assert.ok(gatesInventoryAdjust(inventory))
})

if (failed > 0) process.exitCode = 1
