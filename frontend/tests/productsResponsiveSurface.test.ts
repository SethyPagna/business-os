import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const products = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8')
const stockSessions = readFileSync(new URL('../src/components/products/StockInSessionsSection.tsx', import.meta.url), 'utf8')
const batches = readFileSync(new URL('../src/components/inventory/ManageBatchesModal.tsx', import.meta.url), 'utf8')
const detail = readFileSync(new URL('../src/components/products/surfaces/ProductDetailModal.tsx', import.meta.url), 'utf8')
const inventoryDetail = readFileSync(new URL('../src/components/inventory/ProductDetailModal.tsx', import.meta.url), 'utf8')
const report = readFileSync(new URL('../src/components/products/surfaces/ProductDetailReport.tsx', import.meta.url), 'utf8')
const productForm = readFileSync(new URL('../src/components/products/forms/ProductForm.tsx', import.meta.url), 'utf8')
const variantForm = readFileSync(new URL('../src/components/products/forms/VariantFormModal.tsx', import.meta.url), 'utf8')
const stockModals = readFileSync(new URL('../src/components/inventory/InventoryStockModals.tsx', import.meta.url), 'utf8')
const confirmDialog = readFileSync(new URL('../src/components/shared/ConfirmDialog.tsx', import.meta.url), 'utf8')
const receiveBatch = readFileSync(new URL('../src/components/inventory/ReceiveBatchModal.tsx', import.meta.url), 'utf8')
const fastStockIn = readFileSync(new URL('../src/components/inventory/FastStockInModal.tsx', import.meta.url), 'utf8')
const transfer = readFileSync(new URL('../src/components/branches/TransferModal.tsx', import.meta.url), 'utf8')
const newReturn = readFileSync(new URL('../src/components/returns/NewReturnModal.tsx', import.meta.url), 'utf8')
const posDetail = readFileSync(new URL('../src/components/pos/ProductDetailSheet.tsx', import.meta.url), 'utf8')
const stockChanges = readFileSync(new URL('../src/components/products/StockChangeSection.tsx', import.meta.url), 'utf8')
const productList = readFileSync(new URL('../src/components/products/surfaces/ProductsListSurface.tsx', import.meta.url), 'utf8')
const productRowParts = readFileSync(new URL('../src/components/products/surfaces/ProductRowParts.tsx', import.meta.url), 'utf8')

assert.match(
  products,
  /w-full min-w-0 max-w-full overflow-x-auto[\s\S]*inline-flex w-max/,
  'the Products section switcher must scroll inside a viewport-bounded wrapper',
)
assert.match(products, /onWheel=\{scrollProductSectionsWithWheel\}/, 'the Products section switcher must accept wheel/trackpad scrolling without grabbing its scrollbar')
assert.match(products, /role="group"[\s\S]*aria-label=\{tr\('product_sections'/, 'the section switcher must have an accessible group label')
for (const section of ['products', 'stock_changes', 'stock_in_sessions', 'duplicates']) {
  assert.match(
    products,
    new RegExp(`aria-pressed=\\{activeProductSection === '${section}'\\}`),
    `the ${section} section button must expose its selected state`,
  )
}

// No product row may be unreachable by default: hiding a group's out-of-stock
// child rows is an explicit FilterMenu choice, off unless the operator turns
// it on, and every group it shortens says how many rows went.
assert.match(products, /const \[hideZeroStockRows, setHideZeroStockRows\] = useState\(false\)/, 'zero-stock row hiding must default to off')
assert.match(products, /hideZeroStockRows \? hideZeroStockGroupedChildRows\(sections\) : sections/, 'the Products list must only hide zero-stock rows when the filter is on')
assert.match(products, /setHideZeroStockRows,/, 'the hiding option must be reachable from the shared FilterMenu')
assert.match(products, /hiddenZeroStockRowCount \|\| 0[\s\S]{0,400}tr\('hidden', 'hidden'\)/, 'a shortened group header must show how many rows are hidden')
assert.doesNotMatch(products, /hideZeroStockGroupedChildRows\(buildProductCategorySections/, 'zero-stock rows must not be hidden unconditionally')

assert.match(products, /className="products-list-density-90"[\s\S]*<ProductsListSurface/, 'only the product-result surface should use the requested 90% density')
assert.match(css, /\.products-list-density-90\s*\{[\s\S]*width:\s*100%;[\s\S]*min-width:\s*0;[\s\S]*max-width:\s*100%;/, 'the product surface must never exceed the clipped page width')
assert.doesNotMatch(css, /\.products-list-density-90\s*\{[^}]*zoom:/, 'product density must not use zoom because mobile WebKit can clip the widened box')
assert.match(productList, /<table className="w-full min-w-\[58rem\] table-fixed/, 'the desktop product table must use the compact responsive minimum width')
// Name is still the ONE auto column and Details is still bounded -- that
// invariant is unchanged. The bound itself moved 10.5rem -> 12.5rem because
// 10.5rem was seven pixels too narrow for the two branch chips, wrapping
// every row of the report onto a second line (see the colgroup comment).
assert.match(productList, /Name is the one auto column[\s\S]*<col \/>[\s\S]*<col style=\{\{ width: '12\.5rem' \}\} \/>/, 'name must consume the leftover space while Details stays compact')
assert.match(productList, /card hidden min-w-0 max-w-full overflow-hidden xl:flex xl:flex-col/, 'the full table must only replace cards when enough post-sidebar width is available')
assert.match(productList, /min-w-0 max-w-full space-y-2 xl:hidden/, 'cards must remain width-bounded through laptop and mobile layouts')
assert.match(productList, /inline-flex shrink-0 items-center gap-1 whitespace-nowrap[\s\S]*t\('collapse'\)/, 'the section Collapse control must remain fully visible on narrow screens')
assert.match(productRowParts, /mb-1 flex min-w-0 flex-wrap gap-1/, 'branch details must auto-fit horizontally before creating extra rows')
assert.match(products, /Product names are content[\s\S]*break-words text-sm font-semibold/, 'mobile product names must wrap instead of requiring horizontal scrolling')
assert.match(products, /shrink-0 whitespace-nowrap rounded-full bg-slate-100[\s\S]*\{barcode\}/, 'the mobile barcode pill must show every digit on one line rather than truncating or wrapping')
assert.match(products, /aria-disabled=\{!thumbnailState\.hasImage\}[\s\S]*if \(thumbnailState\.hasImage\) openLightbox\(thumbnailState\.gallery, 0, productName\)/, 'product image slots must isolate row detail clicks and only open the gallery when an image exists')
assert.match(products, /const renderGroupThumbnail[\s\S]*?aria-label=\{`\$\{tr\('view_image', 'View image'\)\}: \$\{title\}`\}[\s\S]*?openLightbox\(state\.gallery, 0, title\)/, 'grouped product thumbnails must also open their gallery without bubbling to product details')
assert.match(products, /import StockInSessionsSection from '\.\/StockInSessionsSection\.tsx'/, 'Stock-in Sessions must ship with Products instead of failing as a navigation-time lazy chunk')
assert.doesNotMatch(products, /lazyRetry\(\(\) => import\('\.\/StockInSessionsSection/, 'Stock-in Sessions must not restore the crash-prone secondary chunk')
assert.match(stockSessions, /Array\.isArray\(payload\.sessions\)/, 'Stock-in Sessions must reject an invalid successful response without crashing the page')
assert.match(stockSessions, /role="alert"[\s\S]*onClick=\{\(\) => void load\(\)\}/, 'Stock-in Sessions failures must stay inline and retryable')

assert.match(
  batches,
  /modal-viewport-safe[\s\S]*z-\[1050\][\s\S]*overflow-y-auto[\s\S]*modal-panel-safe/,
  'Manage Batches must remain inside the dynamic mobile viewport and safe area',
)
assert.match(
  batches,
  /sticky bottom-0[^\"]*border-t[^\"]*backdrop-blur-sm/,
  'batch edit actions must remain reachable while the modal body scrolls',
)

assert.match(detail, /btn-secondary flex min-w-0 flex-1/, 'detail footer actions must be allowed to shrink on narrow screens')
assert.match(detail, /btn-primary flex min-w-0 flex-1/, 'the primary detail action must be allowed to shrink on narrow screens')
assert.match(detail, /import \{ createPortal \} from 'react-dom'/, 'the product detail sheet must render outside the Products page stacking context')
assert.match(detail, /modal-viewport-safe[\s\S]*z-\[1050\][\s\S]*overflow-y-auto/, 'the product detail overlay must sit above fixed app bars and remain scrollable')
assert.match(detail, /modal-panel-safe flex w-full flex-col/, 'the product detail panel must remain within the usable viewport and safe areas')
assert.match(detail, /return createPortal\(modal, document\.body\)/, 'the product detail sheet must portal to the document body')
assert.match(detail, /break-words font-bold text-gray-900 dark:text-white">\{productName\}/, 'product detail titles must wrap in full')
assert.match(detail, /whitespace-nowrap text-left font-mono/, 'product detail barcodes must remain on one line without truncation')
assert.match(inventoryDetail, /break-words font-bold text-gray-900 dark:text-white">\{p\.name\}/, 'inventory product-detail titles must wrap in full')
assert.match(inventoryDetail, /shrink-0 whitespace-nowrap font-mono text-xs text-gray-400">&middot; \{p\.barcode\}/, 'inventory product-detail barcodes must remain on one line')
assert.match(productForm, /headerExtra=\{\([\s\S]*sm:hidden[\s\S]*onClick=\{saveForm\}/, 'product edits must expose Save in the fixed mobile header')
assert.match(productForm, /hidden gap-3[\s\S]*sm:flex/, 'product edits must not rely on a bottom-only mobile footer')
assert.match(variantForm, /headerExtra=\{\([\s\S]*onClick=\{handleSave\}/, 'variant edits must expose Save in the fixed mobile header')
assert.match(confirmDialog, /headerExtra=\{\([\s\S]*onClick=\{onConfirm\}/, 'confirmation dialogs must expose Confirm in the fixed mobile header')
assert.match(stockModals, /return createPortal\(modals, document\.body\)/, 'stock-adjust and transfer dialogs must escape page stacking contexts')
assert.match(stockModals, /modal-viewport-safe[\s\S]*z-\[1050\][\s\S]*sm:hidden/, 'stock dialogs must be iPhone-safe and expose their action in the header')
assert.match(receiveBatch, /return createPortal\(modal, document\.body\)/, 'receive stock must escape parent stacking contexts')
assert.match(receiveBatch, /modal-viewport-safe[\s\S]*z-\[1050\][\s\S]*sm:hidden[\s\S]*receive_stock/, 'receive stock must expose its primary action in the phone-safe header')
assert.match(fastStockIn, /modal-viewport-safe[\s\S]*modal-panel-safe[\s\S]*sm:hidden[\s\S]*commitSession/, 'fast stock-in must retain a reachable mobile completion action')
assert.match(transfer, /modal-viewport-safe[\s\S]*z-\[1050\][\s\S]*sm:hidden[\s\S]*handleBulkTransfer/, 'branch transfers must use one safe one-or-many flow with a mobile header action')
assert.doesNotMatch(transfer, /role="tablist" aria-label="Transfer mode"/, 'branch transfers must not restore separate single and multiple modes')
assert.match(transfer, /fuzzyTextMatches\(\[product\.name, product\.sku, product\.barcode\]\.join\(' '\), query\)/, 'the unified transfer picker must search product name, SKU, and barcode')
assert.match(transfer, /const catalogRequested = Boolean\(debouncedSearch\.trim\(\)\) \|\| showAllProducts[\s\S]*if \(!catalogRequested\) return undefined/, 'the transfer picker must not load the entire catalog before search or Select all')
assert.match(transfer, /Search products, or use Select all to show the full catalog/, 'the initially empty transfer picker must explain how to reveal products')
assert.match(transfer, /selectAllAfterLoadRef\.current = true/, 'Select all must reveal and select the full in-stock catalog when it has not loaded yet')
assert.match(posDetail, /aria-expanded=\{batchChoicesOpen\}/, 'POS batches must be collapsed behind one option button')
assert.match(posDetail, /batchChoicesOpen \? <><div/, 'POS batch options must render only after the option button is expanded')
assert.match(posDetail, /setSelectedBatchId\(batch\.id\); setSelectedDamagedLotId\(null\); setBatchChoicesOpen\(false\)/, 'choosing a POS batch must close its options')
assert.doesNotMatch(stockChanges, /detailRows/, 'a selected stock change must not load unrelated before/after history into its detail dialog')
assert.match(stockChanges, /<th data-tone="emerald" className="text-center">/, 'stock change Quantity headers must center over centered values')
assert.match(stockChanges, /<th className="text-center">\{beforeLabel\} → \{afterLabel\}<\/th>/, 'stock change Before/After headers must center over centered values')
assert.match(newReturn, /const reviewReturn[\s\S]*step === 'items'[\s\S]*onClick=\{reviewReturn\}/, 'returns must expose Review before the final confirmation on mobile')
assert.match(report, /flex w-full min-w-0 items-center justify-between/, 'detail report links must remain width-bounded')
assert.match(report, /<span className="detail-scroll-text[^\"]*">\{label\}<\/span>/, 'detail report labels must stay fully readable through bounded horizontal scrolling')

console.log('PASS Products responsive section, detail, and batch surfaces')
