import { Fragment } from 'react'
import type { ReactNode, RefObject } from 'react'
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'

type Translate = (key: string) => string | undefined
type TranslateWithFallback = (key: string, fallback: string, khmerFallback?: string) => string
type ProductId = string | number

type ProductLike = {
  id?: ProductId
  [key: string]: unknown
}

type ProductGroup = {
  key: string
  name: string
  anchorId?: ProductId
  ids: ProductId[]
  items: ProductLike[]
  hasMultipleItems: boolean
}

type ProductSection = {
  id: string
  label: string
  ids: ProductId[]
  items: ProductLike[]
  groups: ProductGroup[]
}

type ProductRowRenderOptions = {
  indented: boolean
}

type ProductsListSurfaceProps = {
  allVisibleProducts: ProductLike[]
  collapsedProductGroups: Set<string>
  collapsedProductSections: Set<string>
  desktopSelectAllRef: RefObject<HTMLInputElement | null>
  getGroupSummaryParts: (group: ProductGroup, options?: { includeCount?: boolean }) => string[]
  initialDesktopRevealReady: boolean
  isSelectionScopeFullySelected: (ids: ProductId[]) => boolean
  isSelectionScopePartiallySelected: (ids: ProductId[]) => boolean
  loading: boolean
  productSections: ProductSection[]
  productTotal?: number
  productTotalLabel?: string
  refreshingProducts: boolean
  renderDesktopProductRow: (product: ProductLike, options: ProductRowRenderOptions) => ReactNode
  renderMobileProductCard: (product: ProductLike, options: ProductRowRenderOptions) => ReactNode
  selectedVisibleCount: number
  t: Translate
  toggleProductGroup: (key: string) => void
  toggleProductSection: (id: string) => void
  toggleSelectAll: (checked: boolean) => void
  toggleSelectionScope: (ids: ProductId[], checked: boolean) => void
  tr: TranslateWithFallback
  visibleIds: ProductId[]
  visibleProducts: ProductLike[]
}

export default function ProductsListSurface({
  allVisibleProducts,
  collapsedProductGroups,
  collapsedProductSections,
  desktopSelectAllRef,
  getGroupSummaryParts,
  initialDesktopRevealReady,
  isSelectionScopeFullySelected,
  isSelectionScopePartiallySelected,
  loading,
  productSections,
  productTotal,
  productTotalLabel,
  refreshingProducts,
  renderDesktopProductRow,
  renderMobileProductCard,
  selectedVisibleCount,
  t,
  toggleProductGroup,
  toggleProductSection,
  toggleSelectAll,
  toggleSelectionScope,
  tr,
  visibleIds,
  visibleProducts,
}: ProductsListSurfaceProps) {
  const skeletonRows = Array.from({ length: 8 }, (_, index) => index)
  const showDesktopLoadingOverlay = !initialDesktopRevealReady

  const desktopColGroup = (
    <colgroup>
      <col className="w-10" />
      <col className="w-20" />
      <col className="w-64" />
      <col className="w-52" />
      <col className="w-32" />
      <col className="w-32" />
      <col className="w-28" />
      <col className="w-24" />
      <col className="w-28" />
      <col className="w-12" />
    </colgroup>
  )

  const renderDesktopTableHead = (showSelectionControl: boolean) => (
    <thead className="sticky top-0 z-10">
      <tr>
        <th className="w-8 px-3 py-3">
          {showSelectionControl ? (
            <input
              type="checkbox"
              className="rounded"
              checked={visibleIds.length > 0 && selectedVisibleCount === visibleIds.length}
              ref={desktopSelectAllRef}
              onChange={(event) => toggleSelectAll(event.target.checked)}
            />
          ) : (
            <span className="sr-only">loading</span>
          )}
        </th>
        <th className="w-16 whitespace-nowrap px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">Image</th>
        <th className="whitespace-nowrap px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400">{t('product_name')}</th>
        <th className="hidden whitespace-nowrap px-3 py-3 text-left font-semibold text-gray-600 dark:text-gray-400 md:table-cell">{t('details') || 'Details'}</th>
        <th className="col-highlight-red whitespace-nowrap px-3 py-3 text-right font-semibold text-red-600 dark:text-red-400">{t('cost_in_purchase')}</th>
        <th className="col-highlight-green whitespace-nowrap px-3 py-3 text-right font-semibold text-green-600 dark:text-green-400">{t('selling_price_label')}</th>
        <th className="hidden whitespace-nowrap px-3 py-3 text-right font-semibold text-blue-600 dark:text-blue-400 lg:table-cell">{t('margin')}</th>
        <th className="whitespace-nowrap px-3 py-3 text-right font-semibold text-gray-600 dark:text-gray-400">{t('stock')}</th>
        <th className="whitespace-nowrap px-3 py-3 text-center font-semibold text-gray-600 dark:text-gray-400">{t('status')}</th>
        <th className="w-10 px-2 py-3"></th>
      </tr>
    </thead>
  )

  const renderDesktopLoadingShell = () => (
    <div className="min-h-[26rem] animate-pulse bg-white/95 px-4 py-4 dark:bg-slate-950/80">
      <div className="rounded-xl border border-slate-200/90 bg-slate-50/85 p-3 dark:border-slate-700/80 dark:bg-slate-900/70">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
            <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-700" />
          </div>
          <div className="h-7 w-24 rounded-lg bg-slate-200 dark:bg-slate-700" />
        </div>
      </div>
      <div className="mt-4 space-y-4">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={`products-shell-${index}`}
            className="rounded-2xl border border-slate-200/80 bg-white/90 p-4 shadow-sm dark:border-slate-700/70 dark:bg-slate-900/70"
          >
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-slate-200 dark:bg-slate-700" />
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-48 max-w-[60%] rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-3 w-72 max-w-[80%] rounded bg-slate-100 dark:bg-slate-800" />
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-16 rounded-full bg-slate-100 dark:bg-slate-800" />
                    <div className="h-5 w-16 rounded-full bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
                <div className="grid grid-cols-5 gap-3">
                  <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                  <div className="h-10 rounded-lg bg-slate-100 dark:bg-slate-800" />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <>
      <div className="card hidden flex-col sm:flex sm:h-[calc(100vh-18rem)] sm:min-h-[28rem] sm:max-h-[42rem] sm:overflow-hidden">
        <div className="relative min-h-0 overflow-auto sm:flex-1">
          <table className="w-full min-w-[74rem] table-fixed text-sm table-bordered">
            {desktopColGroup}
            {renderDesktopTableHead(initialDesktopRevealReady)}
            <tbody className={showDesktopLoadingOverlay ? 'invisible' : ''}>
              {visibleProducts.length === 0
                ? (showDesktopLoadingOverlay
                  ? null
                  : (
                    <tr>
                      <td colSpan={10} className="py-10 text-center text-gray-400">
                        {refreshingProducts ? tr('products_refreshing', 'Refreshing products...', 'កំពុងធ្វើបច្ចុប្បន្នភាពផលិតផល...') : t('no_data')}
                      </td>
                    </tr>
                    ))
                : productSections.map((section) => {
                  const isCollapsed = collapsedProductSections.has(section.id)
                  return (
                    <Fragment key={section.id}>
                      <tr className="bg-slate-100/90 dark:bg-slate-800/80">
                        <td colSpan={10} className="px-4 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <label className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded"
                                checked={isSelectionScopeFullySelected(section.ids)}
                                ref={(node) => {
                                  if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                                }}
                                onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                                aria-label={`Select ${section.label}`}
                              />
                              <span>{section.label}</span>
                              <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                            </label>
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                              onClick={() => toggleProductSection(section.id)}
                            >
                              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {!isCollapsed ? section.groups.map((group) => {
                        const groupCollapsed = collapsedProductGroups.has(group.key)
                        const showGroupRow = group.hasMultipleItems
                        return (
                          <Fragment key={group.key}>
                            {showGroupRow ? (
                              <tr className="bg-white/80 dark:bg-slate-900/45" data-product-jump-id={group.anchorId}>
                                <td colSpan={10} className="px-4 py-2.5">
                                  <div className="flex items-center justify-between gap-3">
                                    <label className="inline-flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-100">
                                      <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded"
                                        checked={isSelectionScopeFullySelected(group.ids)}
                                        ref={(node) => {
                                          if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                                        }}
                                        onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                                        aria-label={`Select ${group.name}`}
                                      />
                                      <button
                                        type="button"
                                        className="inline-flex min-w-0 items-center gap-2 text-left"
                                        onClick={() => toggleProductGroup(group.key)}
                                      >
                                        {groupCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                        <span className="truncate">{group.name}</span>
                                      </button>
                                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                        {group.items.length}
                                      </span>
                                    </label>
                                    <div className="flex flex-wrap items-center justify-end gap-2 text-[11px] text-slate-500 dark:text-slate-300">
                                      {getGroupSummaryParts(group).map((part) => (
                                        <span key={`${group.key}-${part}`} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                                          {part}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                            {!groupCollapsed || !showGroupRow ? group.items.map((product) => renderDesktopProductRow(product, { indented: showGroupRow })) : null}
                          </Fragment>
                        )
                      }) : null}
                    </Fragment>
                  )
                })}
            </tbody>
          </table>
          {showDesktopLoadingOverlay ? (
            <div className="pointer-events-none absolute inset-x-0 top-[3.125rem] bottom-0 z-20 overflow-hidden border-t border-slate-200/80 bg-white/80 backdrop-blur-[1px] dark:border-slate-700/80 dark:bg-slate-950/78">
              {renderDesktopLoadingShell()}
            </div>
          ) : null}
        </div>
        <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400 dark:border-gray-700">
          {initialDesktopRevealReady
            ? `${visibleProducts.length} / ${productTotal || allVisibleProducts.length} ${t('products')}`
            : (productTotalLabel || t('loading') || 'Loading')}
        </div>
      </div>

      <div className="min-h-[32rem] flex-1 overflow-auto space-y-2 sm:hidden">
        {loading ? (
          <div className="space-y-2">
            {skeletonRows.slice(0, 6).map((row) => (
              <div key={`product-mobile-skeleton-${row}`} className="card animate-pulse p-3">
                <div className="flex items-start gap-3">
                  <div className="h-4 w-4 rounded bg-slate-200 dark:bg-slate-700" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-slate-700" />
                    <div className="h-8 w-full rounded bg-slate-100 dark:bg-slate-800" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : visibleProducts.length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            {refreshingProducts ? tr('products_refreshing', 'Refreshing products...', 'កំពុងធ្វើបច្ចុប្បន្នភាពផលិតផល...') : t('no_data')}
          </div>
        ) : productSections.map((section) => {
          const isCollapsed = collapsedProductSections.has(section.id)
          return (
            <div key={section.id} className="space-y-2">
              <div className="rounded-xl bg-slate-100 px-3 py-2 dark:bg-slate-800/70">
                <div className="flex items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded"
                      checked={isSelectionScopeFullySelected(section.ids)}
                      ref={(node) => {
                        if (node) node.indeterminate = isSelectionScopePartiallySelected(section.ids)
                      }}
                      onChange={(event) => toggleSelectionScope(section.ids, event.target.checked)}
                      aria-label={`Select ${section.label}`}
                    />
                    <span>{section.label}</span>
                    <span className="normal-case tracking-normal text-slate-400">{section.items.length}</span>
                  </label>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-white/70 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-700/60 dark:hover:text-white"
                    onClick={() => toggleProductSection(section.id)}
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isCollapsed ? (t('expand') || 'Expand') : (t('collapse') || 'Collapse')}
                  </button>
                </div>
              </div>
              {!isCollapsed ? section.groups.map((group) => {
                const groupCollapsed = collapsedProductGroups.has(group.key)
                const showGroupRow = group.hasMultipleItems
                return (
                  <div key={group.key} className="space-y-2">
                    {showGroupRow ? (
                      <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/80" data-product-jump-id={group.anchorId}>
                        <div className="flex items-start justify-between gap-3">
                          <label className="flex min-w-0 items-start gap-2">
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 rounded"
                              checked={isSelectionScopeFullySelected(group.ids)}
                              ref={(node) => {
                                if (node) node.indeterminate = isSelectionScopePartiallySelected(group.ids)
                              }}
                              onChange={(event) => toggleSelectionScope(group.ids, event.target.checked)}
                              aria-label={`Select ${group.name}`}
                            />
                            <button type="button" className="min-w-0 text-left" onClick={() => toggleProductGroup(group.key)}>
                              <div className="flex items-center gap-1.5">
                                {groupCollapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">{group.name}</span>
                                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                                  {group.items.length}
                                </span>
                              </div>
                              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-slate-500 dark:text-slate-300">
                                {getGroupSummaryParts(group, { includeCount: false }).map((part) => (
                                  <span key={`${group.key}-${part}`} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                                    {part}
                                  </span>
                                ))}
                              </div>
                            </button>
                          </label>
                        </div>
                      </div>
                    ) : null}
                    {!groupCollapsed || !showGroupRow ? group.items.map((product) => renderMobileProductCard(product, { indented: showGroupRow })) : null}
                  </div>
                )
              }) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}
