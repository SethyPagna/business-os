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

// N7 (this contract was INVERTED before): the four section chips lived in a
// hand-rolled horizontal scroller (`overflow-x-auto` + `inline-flex w-max`)
// whose labels total ~440px against 296px (320) / 351px (375) of usable
// width, so half of them sat off-screen behind a sideways swipe -- while
// every other hub's row wraps and is explicitly forbidden from scrolling
// (nestedUiIntegrity.test.ts, sectionNavigation.test.ts). Products was also
// the one hub-shaped page getHubDestinations() did not know about, so the
// compact navigation could not reach these sections at all. The row is now
// the shared wrapping hub pill row fed by that same table, and it stands
// aside in compact "pages" mode where the home sheet owns section switching.
assert.match(products, /getHubDestinations\('products'/, 'the section list must come from the shared hub table, not a second hand-rolled one')
assert.match(products, /useHubSection<'products' \| 'stock_changes' \| 'stock_in_sessions' \| 'duplicates'>/, "the active section must ride the app's guarded section navigation like every other hub")
assert.match(products, /hub-section-pills flex max-w-full flex-wrap/, 'the Products section switcher must wrap inside the viewport')
assert.match(products, /hub-section-pill inline-flex min-h-11/, 'section chips must meet the 44px compact touch target')
assert.match(products, /layeredSectionNav \|\| productSectionTabs\.length <= 1 \? null :/, 'the page must not draw a second section row when the compact home sheet owns it')
assert.doesNotMatch(products, /overflow-x-auto pb-1 \[scrollbar-width:thin\]/, 'the hand-rolled section scroller must be gone')
assert.doesNotMatch(products, /scrollProductSectionsWithWheel/, 'the scroller-only wheel handler must not survive as dead code')
// Positive control for the two doesNotMatch checks above: the scroll token
// itself is still present in this file (the header-actions row), so their
// absence is a real signal and not a search that stopped working.
assert.match(products, /overflow-x-auto/, 'positive control: overflow-x-auto is still findable in Products.tsx')
assert.match(products, /role="group"[\s\S]*aria-label=\{tr\('product_sections'/, 'the section switcher must have an accessible group label')
assert.match(products, /aria-pressed=\{isActive\}/, 'each section chip must expose its selected state')

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
// invariant is unchanged. The bound itself moved 10.5rem -> 15rem: 10.5rem was
// far too narrow for the two branch chips, and 12.5rem was still too narrow
// once Noto Sans Khmer widened them for lang-km, which is the font this column
// has to be sized against (see the colgroup comment for the measurements).
assert.match(productList, /Name is the one auto column[\s\S]*<col \/>[\s\S]*<col style=\{\{ width: '15rem' \}\} \/>/, 'name must consume the leftover space while Details stays compact')
assert.match(productList, /card hidden min-w-0 max-w-full overflow-hidden xl:flex xl:flex-col/, 'the full table must only replace cards when enough post-sidebar width is available')
assert.match(productList, /min-w-0 max-w-full space-y-2 xl:hidden/, 'cards must remain width-bounded through laptop and mobile layouts')
assert.match(productList, /inline-flex shrink-0 items-center gap-1 whitespace-nowrap[\s\S]*t\('collapse'\)/, 'the section Collapse control must remain fully visible on narrow screens')
assert.match(productRowParts, /mb-1 flex min-w-0 flex-wrap gap-1/, 'branch details must auto-fit horizontally before creating extra rows')
// N36 (owner, Sep 6 2026) REVERSED the rule this line used to pin. It read
// "mobile product names must wrap instead of requiring horizontal scrolling";
// the owner asked for the opposite -- "for product names, make it horizontal
// scroll instead of pushing rows" -- because a wrapping name is what made the
// list rows ragged. The pin stays, pointed at the new rule: names are still
// content (never ellipsised away), they just scroll inside their own cell now.
// The scroll behaviour itself is pinned in tests/productNameScrollCells.test.ts.
assert.match(products, /Product names are content[\s\S]*scroll-x-clean text-sm font-semibold/, 'mobile product names must scroll horizontally inside their cell rather than wrapping to a second row')
assert.doesNotMatch(products, /Product names are content[\s\S]{0,600}break-words text-sm font-semibold/, 'the superseded wrapping name cell must not come back')
assert.match(products, /shrink-0 whitespace-nowrap rounded-full bg-slate-100[\s\S]*\{barcode\}/, 'the mobile barcode pill must show every digit on one line rather than truncating or wrapping')
assert.match(products, /aria-disabled=\{!thumbnailState\.hasImage\}[\s\S]*if \(thumbnailState\.hasImage\) openLightbox\(thumbnailState\.gallery, 0, productName\)/, 'product image slots must isolate row detail clicks and only open the gallery when an image exists')
assert.match(products, /const renderGroupThumbnail[\s\S]*?aria-label=\{`\$\{tr\('view_image', 'View image'\)\}: \$\{title\}`\}[\s\S]*?openLightbox\(state\.gallery, 0, title\)/, 'grouped product thumbnails must also open their gallery without bubbling to product details')
assert.equal((products.match(/onMouseUp=\{\(event\) => event\.stopPropagation\(\)\}/g) || []).length, 3, 'every thumbnail must stop mouse release before the row long-press handler can open details')
assert.equal((products.match(/onTouchEnd=\{\(event\) => event\.stopPropagation\(\)\}/g) || []).length, 3, 'every thumbnail must stop touch release before the row long-press handler can open details')
assert.match(products, /className="text-inherit no-underline hover:text-inherit hover:no-underline" page="products"/, 'copyable product identity links must inherit row typography')
assert.doesNotMatch(products, /\{tr\('wholesale_price', 'Wholesale price', 'តម្លៃបោះដុំ'\)\} \{fmtUSD\(wholesaleUsd \|\| sellingUsd\)\}/, 'desktop wholesale must show the value without a label')
assert.equal((products.match(/<ProductImg[^>]*className="h-12 w-12[^>]*object-contain/g) || []).length, 3, 'desktop, mobile, and grouped thumbnails must share one compact 48px square')
assert.equal((products.match(/<ProductImagePlaceholder className="h-12 w-12/g) || []).length, 3, 'image placeholders must reserve the same compact square as loaded thumbnails')
assert.doesNotMatch(products, /h-full min-h-\[5rem\][^"\n]*w-16|h-20 w-16/, 'thumbnail height must not stretch with product-row content')
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

// Detail footer actions use the shared 40px toolbar contract while retaining
// their responsive half-width wrapping behavior.
assert.match(detail, /className=\{`btn-secondary \$\{TOOLBAR_BUTTON_BASE\}[^`]*min-w-0[^`]*flex-1/, 'detail footer actions must share the canonical height and shrink on narrow screens')
assert.match(detail, /flex flex-wrap items-center gap-2 border-t border-gray-200 p-3/, 'detail footer row must wrap instead of squeezing its labels away')
assert.match(detail, /className=\{`btn-primary \$\{TOOLBAR_BUTTON_BASE\}[^`]*min-w-0[^`]*flex-1/, 'the primary detail action must share the canonical height and shrink on narrow screens')
assert.match(detail, /className=\{toolbarIconButtonClassName\}/, 'the product detail close action must use the shared 40px icon contract')
assert.match(detail, /import \{ createPortal \} from 'react-dom'/, 'the product detail sheet must render outside the Products page stacking context')
assert.match(detail, /modal-viewport-safe[\s\S]*z-\[1050\][\s\S]*overflow-y-auto/, 'the product detail overlay must sit above fixed app bars and remain scrollable')
assert.match(detail, /modal-panel-safe flex w-full flex-col/, 'the product detail panel must remain within the usable viewport and safe areas')
assert.match(detail, /return createPortal\(modal, document\.body\)/, 'the product detail sheet must portal to the document body')
// `[^>]*` between the class list and the `>`: name, brand, supplier and
// barcode now also carry the copy-float gesture attributes (see
// tests/copyFloat.test.ts). The layout property each line pins -- the title
// wraps in full, the barcode stays on one line -- is unchanged, and is
// still the class list itself.
assert.match(detail, /break-words font-bold text-gray-900 dark:text-white"[^>]*>\{productName\}/, 'product detail titles must wrap in full')
assert.match(detail, /whitespace-nowrap font-mono"[^>]*>\{p\.barcode\}/, 'product detail barcodes must remain on one line without truncation')
assert.match(inventoryDetail, /break-words font-bold text-gray-900 dark:text-white"[^>]*>\{p\.name\}/, 'inventory product-detail titles must wrap in full')
assert.match(inventoryDetail, /shrink-0 whitespace-nowrap font-mono text-xs text-gray-400"[^>]*>&middot; \{p\.barcode\}/, 'inventory product-detail barcodes must remain on one line')
assert.match(detail, /<Row label=\{T\('branch', 'Branch'\)\}>[\s\S]*scroll-x-clean flex min-w-0 flex-nowrap/, 'product detail must keep Branch and its values on one row')
// 320px source geometry, EN + KM: after the sheet's 32px inline padding,
// the fixed 4rem label and 0.5rem gap leave 216px for values. Long English
// and Khmer names therefore cannot safely share a justify-between row with
// quantity; the value lane must own the remaining width and scroll, while
// each complete name:value chip stays nowrap and shrink-proof.
assert.match(inventoryDetail, /className="flex min-w-0 gap-2" data-detail-branch-row="true">[\s\S]*w-16 flex-shrink-0 whitespace-nowrap[\s\S]*T\('branch', 'Branch'\)/, 'inventory detail must keep the Branch label inline and fixed at 320px in English and Khmer')
assert.match(inventoryDetail, /scroll-x-clean flex min-w-0 flex-1 flex-nowrap gap-1\.5[\s\S]*shrink-0 whitespace-nowrap rounded-full[\s\S]*\{branchStock\.branch_name\}: [\s\S]*\{branchStock\?\.quantity \?\? 0\} \{p\.unit\}/, 'inventory detail must horizontally scroll complete English/Khmer branch name, quantity, and unit chips at 320px')
assert.match(detail, /data-detail-price-row="cost-wholesale"[\s\S]*PriceCell label=\{T\('label_cost'[\s\S]*PriceCell label=\{T\('wholesale_price'/, 'Cost and Wholesale must share one detail row')
assert.match(detail, /data-detail-price-row="selling-margin"[\s\S]*PriceCell label=\{T\('label_selling_price'[\s\S]*PriceCell label=\{T\('label_margin'/, 'Selling and Margin must share one detail row')
assert.match(detail, /text-sm font-medium tabular-nums/, 'peer product-detail numeric values must share typography')
assert.match(inventoryDetail, /data-detail-price-row="cost-wholesale"[\s\S]*data-detail-price-row="selling-margin"/, 'inventory detail must mirror the paired pricing rows')
// S4-20: the primary action belongs at the END of the panel, never beside the
// ✕. These lines used to pin the exact opposite -- a phone-only Save copied
// into each fixed header -- and they were not wrong at the time: the reason
// recorded in ProductForm.tsx was that "on compact PWA/iOS viewports the
// persistent footer can fall behind browser chrome". That constraint is now
// met by the footer itself rather than by a duplicate button. Each footer is
// either `sticky bottom-0` inside a panel bounded by .modal-panel-safe
// (100dvh minus the safe-area insets) or a flex-shrink-0 sibling placed AFTER
// .modal-scroll, so it is pinned at every breakpoint without being a second
// Save that a mis-tap next to Close can fire instead of dismissing.
//
// Pinned as a position, not as a pattern: the submit handler must be wired
// exactly ONCE in the file, and that one wiring must come after the footer
// container opens. A restored header copy makes the count 2; moving the
// button back up top makes the index smaller. Either way this fails.
const endOfPanelPrimaries: Array<[string, string, string, string]> = [
  ['ProductForm', productForm, 'onClick={saveForm}', 'className="sticky bottom-0'],
  ['VariantFormModal', variantForm, 'onClick={handleSave}', 'className="sticky bottom-0'],
  ['ConfirmDialog', confirmDialog, 'onClick={onConfirm}', 'className="sticky bottom-0'],
  ['InventoryStockModals (adjust)', stockModals, 'onClick={onAdjust}', 'flex flex-shrink-0 gap-2 border-t'],
  ['InventoryStockModals (transfer)', stockModals, 'onClick={onTransfer}', 'flex flex-shrink-0 gap-2 border-t'],
  ['ReceiveBatchModal', receiveBatch, 'onClick={submit}', 'flex items-center justify-end gap-2 border-t'],
  ['FastStockInModal', fastStockIn, 'onClick={commitSession}', 'flex flex-shrink-0 flex-wrap'],
  ['TransferModal', transfer, 'onClick={handleBulkTransfer}', 'flex gap-3 border-t'],
]
for (const [name, source, handler, footerMarker] of endOfPanelPrimaries) {
  const wirings = source.split(handler).length - 1
  assert.equal(wirings, 1, `${name} must wire its primary action exactly once, not once per breakpoint (found ${wirings})`)
  const footerAt = source.indexOf(footerMarker)
  assert.ok(footerAt >= 0, `${name} must keep its end-of-panel footer container`)
  assert.ok(source.indexOf(handler) > footerAt, `${name} must place its primary action inside the end-of-panel footer, not beside the ✕`)
}

assert.doesNotMatch(productForm, /hidden gap-3[\s\S]*sm:flex/, 'the product edit footer must be visible on phones, not desktop-only')
assert.match(productForm, /headerExtra=\{\([\s\S]{0,1200}?<MinimizeButton/, 'the product edit header must keep the minimize control')
assert.match(stockModals, /return createPortal\(modals, document\.body\)/, 'stock-adjust and transfer dialogs must escape page stacking contexts')
assert.match(stockModals, /modal-viewport-safe[\s\S]*z-\[1050\][\s\S]*modal-panel-safe/, 'stock dialogs must stay iPhone-safe above fixed app bars')
assert.match(receiveBatch, /return createPortal\(modal, document\.body\)/, 'receive stock must escape parent stacking contexts')
assert.match(receiveBatch, /modal-viewport-safe[\s\S]*z-\[1050\][\s\S]*modal-panel-safe/, 'receive stock must stay iPhone-safe above fixed app bars')
assert.match(fastStockIn, /modal-viewport-safe[\s\S]*modal-panel-safe/, 'fast stock-in must remain within the usable viewport and safe areas')
assert.match(transfer, /modal-viewport-safe[\s\S]*z-\[1050\]/, 'branch transfers must sit above fixed app bars')

// The same rule applied to the shape that produced the duplicate header Save
// in the first place: a breakpoint-conditional primary. `sm:hidden` sitting
// just above a btn-primary is that shape, so it is what this pins out.
for (const [name, source] of endOfPanelPrimaries.map(([n, s]) => [n, s] as [string, string])) {
  assert.doesNotMatch(
    source,
    /sm:hidden[\s\S]{0,400}?className="[^"]*btn-primary/,
    `${name} must not restore a phone-only primary action beside the close button`,
  )
}
assert.doesNotMatch(transfer, /role="tablist" aria-label="Transfer mode"/, 'branch transfers must not restore separate single and multiple modes')
assert.match(transfer, /fuzzyTextMatches\(\[product\.name, product\.sku, product\.barcode\]\.join\(' '\), query\)/, 'the unified transfer picker must search product name, SKU, and barcode')
assert.match(transfer, /const catalogRequested = Boolean\(debouncedSearch\.trim\(\)\) \|\| showAllProducts[\s\S]*if \(!catalogRequested\) return undefined/, 'the transfer picker must not load the entire catalog before search or Show all products')
assert.match(transfer, /Search products, or use Show all products to list the whole branch/, 'the initially empty transfer picker must explain how to reveal products')
assert.match(transfer, /entireBranchAfterLoadRef\.current = true/, 'Transfer entire branch must still work when the catalog has not loaded yet')

// Lane B: "Select all" used to mean three things at once -- reveal the
// catalog, tick the visible rows, and (as the user read it) move the whole
// branch. It only ever did the first two, silently against whatever happened
// to be on screen. These assertions pin the three controls apart.
assert.match(transfer, /const toggleSelectAllShown = \(\) =>/, 'checking the visible rows must be its own control')
assert.doesNotMatch(transfer, /toggleSelectAllFiltered/, 'the conflated Select all handler must stay gone')
assert.match(transfer, /onClick=\{\(\) => setShowAllProducts\(\(current\) => !current\)\}[\s\S]*aria-pressed=\{showAllProducts\}/, 'revealing the catalog must be a plain view toggle')
assert.match(transfer, /onClick=\{handleTransferEntireBranch\}/, 'moving the whole branch must be its own action')
// What "entire branch" means must not be readable off the filtered list --
// that is exactly how the old control under-transferred without saying so.
assert.match(transfer, /function entireBranchItems\(rows: TransferProduct\[\]\)/, 'the whole-branch item list must be pure and module-scope')
assert.match(transfer, /const everything = entireBranchItems\(multiProducts\)/, 'entire branch must be built from the full listing, never filteredMulti')
assert.doesNotMatch(transfer, /entireBranchItems\(filteredMulti\)/, 'a search box must not be able to shrink what "entire branch" means')

// A whole branch is thousands of rows and the Worker caps one request at 200,
// so the move is chunked. Chunking makes it non-atomic across chunks, which
// the operator has to be told BEFORE committing and again if it stops early.
assert.match(transfer, /const TRANSFER_BULK_CHUNK_SIZE = 200/, 'the client cap must mirror the Worker MAX_BULK_TRANSFER_ITEMS')
assert.match(transfer, /transfer_entire_branch_note/, 'the confirm must say a multi-request run is not one undoable step')
assert.match(transfer, /transfer_bulk_partial/, 'a run that stops partway must report how much already landed')
const retryRun = transfer.slice(transfer.indexOf('const runPendingTransfer'), transfer.indexOf('return createPortal'))
assert.match(retryRun, /const completed = await executeTransferRun\(run, \(next\) => \{[\s\S]*saveTransferRun\(next\.actorId, next\)[\s\S]*setSavedRun\(next\)/, 'every completed chunk checkpoints the exact remaining retry state')
assert.match(retryRun, /saveTransferRun\(completed\.actorId, null\)[\s\S]*setSavedRun\(null\)[\s\S]*onDone\(\)/, 'only a fully completed run clears retry state and reports done')
const retryCatch = retryRun.slice(retryRun.indexOf('} catch (error)'), retryRun.indexOf('} finally'))
assert.doesNotMatch(retryCatch, /setSavedRun\(null\)|onDone\(\)/, 'partial completion must remain retryable instead of being treated as full completion')
assert.match(transfer, /savedRun\.transferred > 0[\s\S]*transfer_bulk_partial[\s\S]*onClick=\{\(\) => \{ void runPendingTransfer\(null\) \}\}/, 'the partial state tells the operator what landed and retries the frozen remainder')
assert.doesNotMatch(transfer, /const discardSavedTransfer|onClick=\{discardSavedTransfer\}/, 'an unresolved transfer cannot be discarded and lose its exact retry identity')
assert.match(transfer, /if \(!savedRun\) draftFinishedRef.current = discardTransferDraft/, 'closing may discard only a draft with no unresolved transfer')

// The write path: one confirmed entry point, on-brand, translated. Starting a
// bulk transfer uses the shared review dialog. Native confirmation remains only
// in the dormant single-mode handler.
const liveTransferPath = transfer.slice(transfer.indexOf('const handleBulkTransfer'), transfer.indexOf('return createPortal'))
assert.doesNotMatch(liveTransferPath, /window\.confirm/, 'no native confirm on the live transfer path -- off-brand and untranslatable')
assert.equal((transfer.match(/window\.confirm/g) || []).length, 1, 'native confirmation is limited to dormant single mode')
assert.match(transfer, /<ConfirmDialog/, 'the shared review dialog asks instead')
assert.match(transfer, /danger=\{pendingTransfer\.scope === 'entire_branch'\}/, 'emptying a branch must get the destructive treatment')
assert.match(transfer, /confirm_bulk_transfer_existing_lots/, 'confirmation describes the explicit existing lots being transferred')

// Small screens: the panel must render its real content from first paint
// instead of showing branch selects and then jumping to full height.
assert.doesNotMatch(transfer, /\{fromBranch && mode === 'multiple' \?/, 'the picker must not be gated behind picking a branch')
assert.match(transfer, /className=\{`modal-scroll min-w-0 space-y-4 p-4 sm:p-5/, 'one width-bounded iOS-safe scroll region, not flex-1 overflow-auto')
assert.match(transfer, /grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3/, 'branch selects must stack before they clip their own names')
assert.match(transfer, /sm:max-h-64 sm:overflow-auto/, 'the row list must not nest a second scroller inside the sheet on phones')
assert.match(transfer, /flex flex-wrap items-center gap-x-3 gap-y-1\.5 px-3 py-2\.5 sm:flex-nowrap/, 'a row must restack rather than squeeze its quantity box away at 375px')
assert.match(posDetail, /aria-expanded=\{batchChoicesOpen\}/, 'POS batches must be collapsed behind one option button')
assert.match(posDetail, /batchChoicesOpen \? <><div/, 'POS batch options must render only after the option button is expanded')
assert.match(posDetail, /setSelectedBatchId\(batch\.id\); setSelectedUnlottedProductId\(null\); setSelectedDamagedLotId\(null\); setBatchChoicesOpen\(false\)/, 'choosing a POS batch must clear unrecorded/damaged intent and close its options')
assert.doesNotMatch(stockChanges, /detailRows/, 'a selected stock change must not load unrelated before/after history into its detail dialog')
assert.match(stockChanges, /<th data-tone="emerald" className="text-center">/, 'stock change Quantity headers must center over centered values')
// dense-th-wrap is load-bearing, not decoration: .dense-data-table th is
// white-space:nowrap with no overflow rule, and the Khmer label
// "ស្តុកពីមុន → ស្តុកចុងក្រោយ" measures 131px against 104px of usable width in
// this 7.5rem column -- without the class the header runs into the Branch
// header instead of clipping. English still fits on one line either way.
assert.match(stockChanges, /<th className="dense-th-wrap text-center">\{beforeLabel\} → \{afterLabel\}<\/th>/, 'stock change Before/After headers must center over centered values and be allowed to wrap for Khmer')
assert.match(newReturn, /const reviewReturn[\s\S]*step === 'items'[\s\S]*onClick=\{reviewReturn\}/, 'returns must expose Review before the final confirmation on mobile')
assert.match(report, /flex w-full min-w-0 items-center justify-between/, 'detail report links must remain width-bounded')
assert.match(report, /<span className="detail-scroll-text[^\"]*">\{label\}<\/span>/, 'detail report labels must stay fully readable through bounded horizontal scrolling')

console.log('PASS Products responsive section, detail, and batch surfaces')
