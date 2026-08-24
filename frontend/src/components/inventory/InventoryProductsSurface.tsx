import { Fragment, useEffect, useRef, useState } from 'react'
import type { ComponentType } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import DualMoney from './DualMoney'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'
import { createLongPressHandlers, consumeLongPressClick, type LongPressState } from '../../utils/longPress.ts'

type Translator = (key: string) => string | undefined
type MoneyFormatter = (value: number) => string
type IdValue = number | string

type BranchStock = {
  branch_id: IdValue
  branch_name?: string
  quantity?: number
}

export type InventoryProductRow = {
  id: IdValue
  name: string
  unit?: string
  brand?: string
  category?: string
  barcode?: string
  low_stock_threshold?: number
  out_of_stock_threshold?: number
  qty_sold?: number
  revenue_usd?: number
  cogs_usd?: number
  purchase_price_usd?: number
  cost_price_usd?: number
  purchase_price_khr?: number
  selling_price_usd?: number
  selling_price_khr?: number
  special_price_usd?: number
  special_price_khr?: number
  stock_value_usd?: number
  stock_value_khr?: number
  branch_stock?: BranchStock[]
  // Present when this row is a merge of 2+ real product rows that are
  // identical except for branch (see mergeSameDetailRows). Selecting this
  // row needs to act on every id here, not just `id`.
  __mergedProductIds?: IdValue[]
}

type InventoryGroup = {
  key: string
  name: string
  ids: IdValue[]
  items: InventoryProductRow[]
  // Display rows: branch-only duplicates already collapsed (see
  // mergeSameDetailRows in utils/productGrouping.ts). Iterate this for
  // rendering; `items`/`ids` stay the full raw set for selection scope.
  rows: InventoryProductRow[]
  hasMultipleItems?: boolean
  stockTotal?: number
}

type InventorySection = {
  id: string
  label: string
  ids: IdValue[]
  items: InventoryProductRow[]
  groups: InventoryGroup[]
}

type InventoryBadgeProps = {
  product: InventoryProductRow
  fmtUSD: MoneyFormatter
  t: Translator
}

type InventoryBatchPreviewProps = {
  product: InventoryProductRow
  branchId: IdValue | null | undefined
  t: Translator
  compact?: boolean
}

type InventoryProductsSurfaceProps = {
  InventoryBatchPreview: ComponentType<InventoryBatchPreviewProps>
  InventoryDiscountBadge: ComponentType<InventoryBadgeProps>
  branchFilter?: IdValue | null
  branches: Array<{ id: IdValue; name?: string }>
  collapsedInventoryGroups: Set<string>
  collapsedInventorySections: Set<string>
  fmtKHR: MoneyFormatter
  fmtUSD: MoneyFormatter
  getInventoryGroupSummaryParts: (group: InventoryGroup, options?: { includeCount?: boolean }) => string[]
  getStockQty: (product: InventoryProductRow) => number
  initialDesktopRevealReady: boolean
  initialMobileFullListReady: boolean
  initialMobileRevealReady: boolean
  initialMobileInventorySections?: InventorySection[]
  inventoryProductSections: InventorySection[]
  loading: boolean
  openAdjust: (product: InventoryProductRow) => void
  selectedProductIds: Set<number>
  // Long-press-to-select-mode, same pattern as Products.tsx (part 77/190):
  // checkboxes only render once selectionModeActive is true, and a plain
  // row click opens the detail sheet outside select mode / toggles
  // selection inside it. See getInventoryLongPressState's own comment on
  // Inventory.tsx for why this state lives in the parent, not here.
  selectionModeActive: boolean
  getInventoryLongPressState: (rowId: number) => LongPressState
  setDetailProduct: (product: InventoryProductRow) => void
  showProductsSection?: boolean
  t: Translator
  toggleInventoryGroup: (groupKey: string) => void
  toggleInventorySection: (sectionId: string) => void
  toggleInventorySelectionScope: (ids: IdValue[], checked: boolean) => void
  toggleSelectedProduct: (productId: IdValue) => void
  visibleInventoryProducts: InventoryProductRow[]
  isInventorySelectionScopeFullySelected: (ids: IdValue[]) => boolean
  isInventorySelectionScopePartiallySelected: (ids: IdValue[]) => boolean
  // Deep-link target from a notification click (routes/notifications.ts's
  // `anchor: product-<id>`, consumed in Inventory.tsx via the `#product-`
  // hash -- see its own comment). When set, the matching row scrolls into
  // view and gets a brief highlight flash; `onFocusHandled` clears the
  // request once handled (or once retries are exhausted) so the same
  // product can be re-focused on a later click.
  focusProductId?: IdValue | null
  onFocusHandled?: () => void
}

export default function InventoryProductsSurface({
  InventoryBatchPreview,
  InventoryDiscountBadge,
  branchFilter,
  branches,
  collapsedInventoryGroups,
  collapsedInventorySections,
  fmtKHR,
  fmtUSD,
  getInventoryGroupSummaryParts,
  getStockQty,
  initialDesktopRevealReady,
  initialMobileFullListReady,
  initialMobileRevealReady,
  initialMobileInventorySections,
  inventoryProductSections,
  loading,
  openAdjust,
  selectedProductIds,
  selectionModeActive,
  getInventoryLongPressState,
  setDetailProduct,
  showProductsSection,
  t,
  toggleInventoryGroup,
  toggleInventorySection,
  toggleInventorySelectionScope,
  toggleSelectedProduct,
  visibleInventoryProducts,
  isInventorySelectionScopeFullySelected,
  isInventorySelectionScopePartiallySelected,
  focusProductId,
  onFocusHandled,
}: InventoryProductsSurfaceProps) {
  const skeletonRows = Array.from({ length: 8 }, (_, index) => index)
  const mobileSkeletonRows = Array.from({ length: 6 }, (_, index) => index)
  const showDesktopLoadingOverlay = !initialDesktopRevealReady
  const showMobileLoadingOverlay = !initialMobileRevealReady
  const showMobileSkeletonContent = loading && visibleInventoryProducts.length === 0
  const mobileInventorySections = initialMobileFullListReady
    ? inventoryProductSections
    : (initialMobileInventorySections || inventoryProductSections)

  // Row not mounted yet the instant the hash lands (still loading, on a
  // later page, or filtered out) is common -- retry briefly before giving
  // up silently rather than requiring the row to already be on screen.
  const [flashId, setFlashId] = useState<IdValue | null>(null)
  const focusAttemptRef = useRef(0)
  useEffect(() => {
    if (focusProductId == null) return undefined
    let cancelled = false
    focusAttemptRef.current += 1
    const attemptId = focusAttemptRef.current
    const tryFocus = (retriesLeft: number) => {
      if (cancelled || attemptId !== focusAttemptRef.current) return
      // A branch-merged row (see __mergedProductIds) is keyed by its
      // primary id, but the notification may point at any of the ids it
      // absorbed -- fall back to the scope-id list when the direct id
      // lookup misses.
      const el = document.getElementById(`product-${focusProductId}`)
        || document.querySelector(`[data-product-ids~="${focusProductId}"]`)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setFlashId(focusProductId)
        window.setTimeout(() => {
          if (!cancelled) setFlashId((current) => (current === focusProductId ? null : current))
        }, 1800)
        onFocusHandled?.()
        return
      }
      if (retriesLeft > 0) {
        window.setTimeout(() => tryFocus(retriesLeft - 1), 250)
      } else {
        onFocusHandled?.()
      }
    }
    tryFocus(6)
    return () => { cancelled = true }
  }, [focusProductId, onFocusHandled])
  const isFlashed = (product: InventoryProductRow) => {
    if (flashId == null) return false
    const scopeIds = product.__mergedProductIds?.length ? product.__mergedProductIds : [product.id]
    return scopeIds.some((id) => String(id) === String(flashId))
  }
  const flashClassName = 'ring-2 ring-blue-400 dark:ring-blue-500 bg-blue-50 dark:bg-blue-900/20 transition-colors duration-[1400ms]'

  const renderDesktopTableHead = (showSelectionControl: boolean) => (
    <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10">
      <tr>
        <th className="px-3 py-1.5 text-left font-semibold text-gray-600 dark:text-gray-400">
          {showSelectionControl ? <span className="sr-only">{t('select') || 'Select'}</span> : <span className="sr-only">loading</span>}
        </th>
        <th className="text-left px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 min-w-[140px]">{t('product_name')}</th>
        <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('current_stock')}</th>
        {branches.length > 1 && <th className="text-left px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 hidden md:table-cell">{t('branches')}</th>}
        <th className="text-right px-3 py-1.5 font-semibold text-red-600 dark:text-red-400 whitespace-nowrap">{t('cost')}</th>
        <th className="text-right px-3 py-1.5 font-semibold text-green-600 dark:text-green-400 whitespace-nowrap">{t('price')}</th>
        {/* lg->md, matching the row cell below (Aug 22 2026 ask: Stock Value
            is a price figure, was invisible-by-default on a typical
            laptop-width window). */}
        <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap hidden md:table-cell">{t('stock_val')}</th>
        <th className="text-right px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap hidden xl:table-cell">{t('net_sold_header')}</th>
        <th className="text-right px-3 py-1.5 font-semibold text-green-700 dark:text-green-400 whitespace-nowrap hidden xl:table-cell">{t('revenue_header')}</th>
        <th className="text-right px-3 py-1.5 font-semibold text-orange-600 dark:text-orange-400 whitespace-nowrap hidden xl:table-cell">{t('cogs_header')}</th>
        <th className="text-right px-3 py-1.5 font-semibold text-blue-600 dark:text-blue-400 whitespace-nowrap hidden xl:table-cell">{t('profit_header')}</th>
        <th className="text-center px-3 py-1.5 font-semibold text-gray-600 dark:text-gray-400 whitespace-nowrap">{t('adjust_stock')}</th>
      </tr>
    </thead>
  )

  const renderDesktopLoadingShell = () => (
    <div className="bg-white/92 px-3 py-3 dark:bg-slate-950/80">
      <div className="rounded-xl border border-slate-200/90 bg-slate-50/90 p-3 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="h-3.5 w-36 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="mt-2 h-2.5 w-56 max-w-[70vw] rounded bg-slate-100 dark:bg-slate-800" />
          </div>
          <div className="h-6 w-20 rounded-lg bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          <div className="h-7 rounded-lg bg-slate-100 dark:bg-slate-800" />
          <div className="h-7 rounded-lg bg-slate-100 dark:bg-slate-800" />
          <div className="h-7 rounded-lg bg-slate-100 dark:bg-slate-800" />
          <div className="h-7 rounded-lg bg-slate-100 dark:bg-slate-800" />
        </div>
      </div>
    </div>
  )

  return (
    <>
      <div className={`relative sm:hidden ${showMobileLoadingOverlay ? '' : 'space-y-2'}`}>
        {!showMobileLoadingOverlay ? (
          <div className="space-y-2">
            {showMobileSkeletonContent ? (
              <div className="space-y-2">
                <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
                      <div className="h-4 w-6 rounded bg-slate-200 dark:bg-slate-700" />
                    </div>
                    <div className="h-5 w-20 rounded-lg bg-slate-200 dark:bg-slate-700" />
                  </div>
                </div>
                {mobileSkeletonRows.map((row) => (
                  <div key={`inventory-mobile-skeleton-${row}`} className="card animate-pulse px-3 py-2.5">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                      <div className="space-y-2">
                        <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
                        <div className="h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
                      </div>
                      <div className="space-y-2">
                        <div className="h-4 w-12 rounded bg-slate-100 dark:bg-slate-800" />
                        <div className="h-5 w-16 rounded-full bg-slate-100 dark:bg-slate-800" />
                      </div>
                    </div>
                    <div className="mt-3 h-8 rounded-xl bg-slate-100 dark:bg-slate-800" />
                    <div className="mt-3 h-10 rounded-xl bg-slate-100 dark:bg-slate-800" />
                  </div>
                ))}
              </div>
            ) : visibleInventoryProducts.length === 0 ? (
              <div className="text-center py-10 text-gray-400">{t('no_data')}</div>
            ) : mobileInventorySections.map((section) => {
          const isCollapsed = collapsedInventorySections.has(section.id)
          return (
            <div key={section.id} className="space-y-2" data-inventory-jump-id={section.id}>
              <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    {selectionModeActive ? (
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={isInventorySelectionScopeFullySelected(section.ids)}
                      ref={(node) => {
                        if (node) node.indeterminate = isInventorySelectionScopePartiallySelected(section.ids)
                      }}
                      onChange={(event) => toggleInventorySelectionScope(section.ids, event.target.checked)}
                      aria-label={`Select ${section.label}`}
                    />
                    ) : null}
                    <span>{section.label}</span>
                    <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                    onClick={() => toggleInventorySection(section.id)}
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                  </button>
                </div>
              </div>
              {!isCollapsed ? section.groups.map((group) => {
                const groupCollapsed = collapsedInventoryGroups.has(group.key)
                const showGroupRow = group.rows.length > 1
                return (
                  <div
                    key={group.key}
                    className={showGroupRow
                      ? 'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/80'
                      : 'space-y-2'}
                  >
                    {showGroupRow ? (
                      <div className="px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <label className="flex min-w-0 items-start gap-2">
                            {selectionModeActive ? (
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded"
                              checked={isInventorySelectionScopeFullySelected(group.ids)}
                              ref={(node) => {
                                if (node) node.indeterminate = isInventorySelectionScopePartiallySelected(group.ids)
                              }}
                              onChange={(event) => toggleInventorySelectionScope(group.ids, event.target.checked)}
                              aria-label={`Select ${group.name}`}
                            />
                            ) : null}
                            <button type="button" className="min-w-0 text-left" onClick={() => toggleInventoryGroup(group.key)}>
                              <div className="flex items-center gap-1.5">
                                {groupCollapsed ? <ChevronRight className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                                <span className="truncate text-[13px] font-semibold text-slate-900 dark:text-white">{group.name}</span>
                              </div>
                              {/* Row count used to repeat here (badge) and again as "N options"
                                  in the summary line below via includeCount:false -- same fix as
                                  Products.tsx part 144: one copy only, folded into the summary line. */}
                              <div className="mt-0.5 truncate pl-[1.15rem] text-[10px] text-slate-500 dark:text-slate-300">
                                {getInventoryGroupSummaryParts(group).join(' | ')}
                              </div>
                            </button>
                          </label>
                        </div>
                      </div>
                    ) : null}
                    {!groupCollapsed ? group.rows.map((p) => {
                      const qty = getStockQty(p)
                      const lowStockThreshold = Number(p.low_stock_threshold || 0)
                      const isLow = qty > 0 && qty <= lowStockThreshold
                      const isOut = qty <= (p.out_of_stock_threshold || 0)
                      // Stock status convention (this session): color the
                      // qty value itself instead of showing a separate
                      // "In Stock"/"Low"/"Out" badge next to it -- the
                      // word is still available in the click-to-view
                      // details panel, just not repeated on every card.
                      const stockTextClass = isOut ? 'text-red-600 dark:text-red-400' : isLow ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                      const soldQty = Math.max(0, p.qty_sold || 0)
                      const revenue = Math.max(0, p.revenue_usd || 0)
                      const productBrand = String(p.brand || '').trim()
                      const productCategory = String(p.category || '').trim()
                      const productTagText = [productBrand, productCategory, p.barcode].filter(Boolean).join(' | ')
                      const rowScopeIds = p.__mergedProductIds?.length ? p.__mergedProductIds : [p.id]
                      const rowSelected = isInventorySelectionScopeFullySelected(rowScopeIds)
                      // Long-press-to-select-mode, same pattern as Products.tsx
                      // (see getInventoryLongPressState's comment on Inventory.tsx):
                      // press-and-hold enters select mode by selecting this row;
                      // once selectionModeActive, a plain click toggles selection
                      // directly instead and these handlers are skipped entirely.
                      const rowLongPressState = getInventoryLongPressState(Number(p.id))
                      const longPress = createLongPressHandlers(rowLongPressState, {
                        disabled: selectionModeActive,
                        onLongPress: () => toggleInventorySelectionScope(rowScopeIds, true),
                        onClick: () => setDetailProduct(p),
                      })
                      // Consumes the native ghost click that follows a fired
                      // long-press -- see utils/longPress.ts's consumeLongPressClick.
                      const handleRowClick = () => {
                        if (consumeLongPressClick(rowLongPressState)) return
                        toggleInventorySelectionScope(rowScopeIds, !rowSelected)
                      }
                      // Grouped child rows share the group's single card background/border
                      // (set on the wrapper above) instead of each getting its own boxed
                      // "card" -- a thin top divider separates rows within the group instead.
                      // Ungrouped single products are untouched, still their own card.
                      const rowClassName = `${showGroupRow
                        ? 'cursor-pointer select-none border-t border-gray-100 px-3 py-1.5 dark:border-gray-800'
                        : 'card cursor-pointer select-none px-3 py-1.5'} ${rowSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''} ${isFlashed(p) ? flashClassName : ''}`
                      return (
                        <div
                          id={`product-${p.id}`}
                          data-product-ids={rowScopeIds.join(' ')}
                          key={p.id}
                          className={rowClassName}
                          onClick={selectionModeActive ? handleRowClick : undefined}
                          {...(selectionModeActive ? {} : longPress)}
                        >
                          {/* Grouped rows get a slight overall indent (checkbox, name, and
                              stats all shift right together) so they read as nested under
                              the group -- kept as one outer wrapper rather than touching the
                              inner classNames below, several of which are exact-string
                              source-pattern assertions in inventoryMobileCardLayout.test.ts. */}
                          <div className={showGroupRow ? 'pl-3' : ''}>
                          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-0.5">
                            <div className="min-w-0">
                              <div className="flex items-start gap-1.5">
                                {selectionModeActive ? (
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 flex-shrink-0 rounded"
                                  checked={rowSelected}
                                  ref={(node) => {
                                    if (node) node.indeterminate = !rowSelected && isInventorySelectionScopePartiallySelected(rowScopeIds)
                                  }}
                                  onChange={(event) => {
                                    event.stopPropagation()
                                    toggleInventorySelectionScope(rowScopeIds, event.target.checked)
                                  }}
                                  onClick={(event) => event.stopPropagation()}
                                  aria-label={`${t('select') || 'Select'} ${p.name}`}
                                />
                                ) : null}
                                <div className="min-w-0 pr-0.5">
                                  <div className="truncate text-[13px] font-semibold leading-[1.05rem] text-gray-900 dark:text-white" title={p.name}>
                                    <span {...getKhmerTextProps(p.name)}>{p.name}</span>
                                  </div>
                                </div>
                              </div>
                              {productTagText ? (
                              <div className={`mt-0.5 min-h-[0.65rem] min-w-0 text-[10px] leading-3 text-gray-500 dark:text-gray-300 ${selectionModeActive ? 'pl-6' : ''}`} title={productTagText}>
                                  <span {...getKhmerTextProps(productTagText, 'block truncate')}>{productTagText}</span>
                                </div>
                              ) : null}
                            </div>
                            <div className="flex max-w-[7rem] shrink-0 flex-col items-end gap-0.5 text-right">
                              <div className={`min-w-0 max-w-[5.6rem] truncate whitespace-nowrap text-[11px] font-bold leading-none ${stockTextClass}`}>
                                {qty}
                                <span {...getKhmerTextProps(p.unit, 'ml-1 text-[10px] font-normal opacity-70')}>{p.unit}</span>
                              </div>
                            </div>
                          </div>
                          <div className="mt-0.5 flex items-start justify-between gap-2 border-t border-gray-100 pt-0.5 dark:border-gray-700">
                            {/* Cost/Price/Sold/Rev collapsed into one row -- color alone
                                (no "Sold"/"Rev" text labels) tells them apart since a tap
                                on the card already opens the full detail view with labels;
                                this row is a scan-friendly summary, not the source of truth. */}
                            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[10.5px]">
                              <span className="whitespace-nowrap text-red-600" title={t('purchase_price') || 'Cost'}>{fmtUSD(p.purchase_price_usd || p.cost_price_usd || 0)}</span>
                              <span className="text-gray-300 dark:text-gray-600">|</span>
                              <span className="whitespace-nowrap text-green-700" title={t('selling_price') || 'Price'}>{fmtUSD(p.selling_price_usd || 0)}</span>
                              {(p.special_price_usd || 0) > 0 ? (
                                <>
                                  <span className="text-gray-300 dark:text-gray-600">|</span>
                                  <span className="whitespace-nowrap text-blue-700 dark:text-blue-400" title={t('special_price') || 'Special'}>{fmtUSD(p.special_price_usd || 0)}</span>
                                </>
                              ) : null}
                              <span className="text-gray-300 dark:text-gray-600">|</span>
                              <span className="whitespace-nowrap text-amber-600 dark:text-amber-400" title={t('sold_qty') || 'Sold quantity'}>×{soldQty}</span>
                              <span className="text-gray-300 dark:text-gray-600">|</span>
                              <span className="whitespace-nowrap text-purple-700 dark:text-purple-400" title={t('revenue') || 'Revenue'}>{fmtUSD(revenue)}</span>
                              <InventoryDiscountBadge product={p} fmtUSD={fmtUSD} t={t} />
                              <InventoryBatchPreview product={p} branchId={branchFilter} t={t} compact />
                            </div>
                            <button onClick={(event) => { event.stopPropagation(); openAdjust(p) }} className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold leading-none text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-blue-400 dark:hover:bg-blue-500/15 dark:hover:text-blue-200">
                              {t('adjust')}
                            </button>
                          </div>
                          </div>
                        </div>
                      )
                    }) : null}
                  </div>
                )
              }) : null}
            </div>
          )
          })}
          </div>
        ) : null}
        {showMobileLoadingOverlay ? (
          <div className="pointer-events-none absolute inset-0 space-y-2">
            <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
              <div className="flex items-center justify-between gap-3">
                <div className="h-4 w-20 rounded bg-slate-200 dark:bg-slate-700" />
                <div className="h-5 w-20 rounded-lg bg-slate-200 dark:bg-slate-700" />
              </div>
            </div>
            {mobileSkeletonRows.slice(0, 8).map((row) => (
              <div key={`inventory-mobile-overlay-${row}`} className="card animate-pulse px-3 py-2.5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
                  <div className="space-y-2">
                    <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-800" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-4 w-14 rounded bg-slate-100 dark:bg-slate-800" />
                    <div className="h-5 w-20 rounded-full bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
                <div className="mt-2 h-5 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="mt-2 h-4 w-3/5 rounded bg-slate-100 dark:bg-slate-800" />
              </div>
            ))}
          </div>
        ) : null}
      </div>

      {/* Same fix as Products.tsx's ProductsListSurface: previously a
          fixed-height card (`sm:h-[calc(100vh-18rem)]`) that clipped/scrolled
          independently of the page. Now flows with `.page-scroll` instead --
          no forced height, no separate scroll region. `overflow-x-auto` stays
          on the inner wrapper so a very wide table can still scroll
          horizontally without widening the whole page. */}
      <div className="card hidden sm:block">
        <div className="relative overflow-x-auto">
          <table className="w-full text-xs">
            {renderDesktopTableHead(initialDesktopRevealReady)}
            <tbody className={showDesktopLoadingOverlay ? 'invisible' : ''}>
              {visibleInventoryProducts.length === 0 ? (
                <tr><td colSpan={12} className="text-center py-8 text-gray-400">{t('no_data')}</td></tr>
              ) : inventoryProductSections.map((section) => {
                const isCollapsed = collapsedInventorySections.has(section.id)
                return (
                  <Fragment key={section.id}>
                    <tr className="bg-slate-50 dark:bg-slate-800/60" data-inventory-jump-id={section.id}>
                      <td className="px-3 py-2">
                        {selectionModeActive ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded"
                          checked={isInventorySelectionScopeFullySelected(section.ids)}
                          ref={(node) => {
                            if (node) node.indeterminate = isInventorySelectionScopePartiallySelected(section.ids)
                          }}
                          onChange={(event) => toggleInventorySelectionScope(section.ids, event.target.checked)}
                          aria-label={`Select ${section.label}`}
                        />
                        ) : null}
                      </td>
                      <td colSpan={11} className="px-4 py-2">
                        <div className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          <span>{section.label} | {section.items.length} {(t('products') || 'products').toLowerCase()}</span>
                          <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium normal-case tracking-normal text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white" onClick={() => toggleInventorySection(section.id)}>
                            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                          </button>
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed ? section.groups.map((group) => {
                      const groupCollapsed = collapsedInventoryGroups.has(group.key)
                      const showGroupRow = group.rows.length > 1
                      return (
                        <Fragment key={group.key}>
                          {showGroupRow ? (
                            <tr className="bg-white dark:bg-gray-800/70">
                              <td className="px-3 py-2">
                                {selectionModeActive ? (
                                <input
                                  type="checkbox"
                                  className="h-4 w-4 rounded"
                                  checked={isInventorySelectionScopeFullySelected(group.ids)}
                                  ref={(node) => {
                                    if (node) node.indeterminate = isInventorySelectionScopePartiallySelected(group.ids)
                                  }}
                                  onChange={(event) => toggleInventorySelectionScope(group.ids, event.target.checked)}
                                  aria-label={`Select ${group.name}`}
                                />
                                ) : null}
                              </td>
                              <td colSpan={11} className="px-4 py-1.5">
                                <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => toggleInventoryGroup(group.key)}>
                                  {groupCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                  <span {...getKhmerTextProps(group.name, 'truncate text-sm font-semibold text-slate-900 dark:text-white')}>{group.name}</span>
                                  {/* Badge removed -- duplicated "N options" already in the summary
                                      pills just below (includeCount now defaults true there instead
                                      of being excluded), same fix as Products.tsx part 144. */}
                                  <span className="ml-2 flex flex-wrap gap-1 text-[11px] font-medium text-slate-500 dark:text-slate-300">
                                    {getInventoryGroupSummaryParts(group).map((part) => (
                                      <span key={`${group.key}-${part}`} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">{part}</span>
                                    ))}
                                  </span>
                                </button>
                              </td>
                            </tr>
                          ) : null}
                          {!groupCollapsed ? group.rows.map((p) => {
                            const qty = getStockQty(p)
                            const lowStockThreshold = Number(p.low_stock_threshold || 0)
                            const isLow = qty > 0 && qty <= lowStockThreshold
                            const isOut = qty <= (p.out_of_stock_threshold || 0)
                            // Same convention as the mobile card above:
                            // color the qty instead of a separate badge.
                            const stockTextClass = isOut ? 'text-red-600 dark:text-red-400' : isLow ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'
                            const netRev = Math.max(0, p.revenue_usd || 0)
                            const netCogs = Math.max(0, p.cogs_usd || 0)
                            const profit = netRev - netCogs
                            const productTagText = [p.brand, p.category, p.barcode].filter(Boolean).join(' | ')
                            const rowScopeIds = p.__mergedProductIds?.length ? p.__mergedProductIds : [p.id]
                            const rowSelected = isInventorySelectionScopeFullySelected(rowScopeIds)
                            // Same long-press-to-select-mode pattern as the mobile card
                            // rows above and Products.tsx's desktop rows -- see this
                            // file's mobile-row comment above for the full reasoning.
                            const rowLongPressState = getInventoryLongPressState(Number(p.id))
                            const longPress = createLongPressHandlers(rowLongPressState, {
                              disabled: selectionModeActive,
                              onLongPress: () => toggleInventorySelectionScope(rowScopeIds, true),
                              onClick: () => setDetailProduct(p),
                            })
                            const handleRowClick = () => {
                              if (consumeLongPressClick(rowLongPressState)) return
                              toggleInventorySelectionScope(rowScopeIds, !rowSelected)
                            }
                            return (
                              <tr
                                id={`product-${p.id}`}
                                data-product-ids={rowScopeIds.join(' ')}
                                key={p.id}
                                // Same desktop grouped-vs-standalone accent added to
                                // Products.tsx's renderDesktopProductRow -- this file
                                // previously had no visual distinction at all here
                                // (unlike its own mobile card rows just above, which
                                // already indent via the `showGroupRow ? 'pl-3' : ''`
                                // wrapper a few lines up).
                                className={`table-row cursor-pointer select-none hover:bg-blue-50 dark:hover:bg-blue-900/10 ${rowSelected ? 'bg-blue-50 dark:bg-blue-900/20' : showGroupRow ? 'border-l-2 border-l-slate-300 bg-slate-50/70 dark:border-l-slate-600 dark:bg-slate-800/40' : ''} ${isFlashed(p) ? flashClassName : ''}`}
                                onClick={selectionModeActive ? handleRowClick : undefined}
                                {...(selectionModeActive ? {} : longPress)}
                              >
                                <td className={`px-3 py-1 ${showGroupRow ? 'pl-4' : ''}`} onClick={(event) => event.stopPropagation()}>
                                  {selectionModeActive ? (
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded"
                                    checked={rowSelected}
                                    ref={(node) => {
                                      if (node) node.indeterminate = !rowSelected && isInventorySelectionScopePartiallySelected(rowScopeIds)
                                    }}
                                    onChange={(event) => toggleInventorySelectionScope(rowScopeIds, event.target.checked)}
                                    aria-label={`${t('select') || 'Select'} ${p.name}`}
                                  />
                                  ) : null}
                                </td>
                                <td className={`px-3 py-1 ${showGroupRow ? 'pl-3' : ''}`}>
                                  <div {...getKhmerTextProps(p.name, 'font-medium leading-tight text-gray-900 dark:text-white')}>{p.name}</div>
                                  <div {...getKhmerTextProps(productTagText, 'mt-0.5 text-[10px] leading-4 text-gray-400')}>
                                    <span className="break-words">{productTagText || (t('product') || 'Product')}</span>
                                  </div>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    <InventoryDiscountBadge product={p} fmtUSD={fmtUSD} t={t} />
                                    <InventoryBatchPreview product={p} branchId={branchFilter} t={t} compact />
                                  </div>
                                </td>
                                <td className="px-3 py-1 text-right whitespace-nowrap">
                                  <div className={`font-bold ${stockTextClass}`}>
                                    {qty} <span {...getKhmerTextProps(p.unit, 'text-[10px] font-normal opacity-70')}>{p.unit}</span>
                                  </div>
                                </td>
                                {branches.length > 1 && (
                                  <td className="hidden px-3 py-1 md:table-cell">
                                    <div className="flex flex-wrap gap-0.5">
                                      {(p.branch_stock || []).slice(0, 3).map((bs) => (
                                        <span key={bs.branch_id} className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-400">
                                          {bs.branch_name?.split(' ')[0]}: {bs?.quantity ?? 0}
                                        </span>
                                      ))}
                                    </div>
                                  </td>
                                )}
                                <td className="px-3 py-1"><DualMoney usd={p.purchase_price_usd||p.cost_price_usd||0} khr={p.purchase_price_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                                <td className="px-3 py-1">
                                  <DualMoney usd={p.selling_price_usd||0} khr={p.selling_price_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} />
                                  {(p.special_price_usd || 0) > 0 || (p.special_price_khr || 0) > 0 ? (
                                    <div className="mt-0.5 text-[10px] text-blue-600 dark:text-blue-400">
                                      {t('special_price') || 'Special'} {fmtUSD(p.special_price_usd || p.selling_price_usd || 0)}
                                      {(p.special_price_khr || 0) > 0 ? ` / ${fmtKHR(p.special_price_khr || 0)}` : ''}
                                    </div>
                                  ) : null}
                                </td>
                                {/* Threshold lowered lg->md (Aug 22 2026 ask: default display was
                                    dropping price-adjacent data too early) -- Stock Value is a
                                    price figure, not a niche stat, and hiding it until `lg` meant
                                    it was invisible by default on a typical laptop-width window,
                                    not just on phone/tablet. */}
                                <td className="hidden px-3 py-1 md:table-cell"><DualMoney usd={p.stock_value_usd||0} khr={p.stock_value_khr||0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                                <td className="hidden px-3 py-1 text-right text-gray-500 xl:table-cell">{Math.max(0,p.qty_sold||0)}</td>
                                <td className="hidden px-3 py-1 xl:table-cell"><DualMoney usd={netRev} khr={0} fmtUSD={fmtUSD} fmtKHR={fmtKHR} /></td>
                                <td className="hidden px-3 py-1 text-right xl:table-cell"><span className="text-xs font-medium text-orange-600 dark:text-orange-400">{fmtUSD(netCogs)}</span></td>
                                <td className="hidden px-3 py-1 xl:table-cell"><div className={`text-right text-xs font-medium ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>{fmtUSD(profit)}</div></td>
                                <td className="px-3 py-1 text-center" onClick={(e) => e.stopPropagation()}>
                                  <button onClick={() => openAdjust(p)} className="rounded px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 hover:underline dark:text-blue-400 dark:hover:bg-blue-900/20">
                                    {t('adjust')}
                                  </button>
                                </td>
                              </tr>
                            )
                          }) : null}
                        </Fragment>
                      )
                    }) : null}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
          {showDesktopLoadingOverlay ? (
            <div className="pointer-events-none absolute inset-x-0 top-[2.0625rem] z-20 overflow-hidden border-t border-slate-200/80 bg-white/82 dark:border-slate-700/80 dark:bg-slate-950/78">
              {renderDesktopLoadingShell()}
            </div>
          ) : null}
        </div>
      </div>
    </>
  )
}
