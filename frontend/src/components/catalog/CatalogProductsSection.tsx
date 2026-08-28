import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import BadgeCheck from 'lucide-react/dist/esm/icons/badge-check.js'
import BadgePercent from 'lucide-react/dist/esm/icons/badge-percent.js'
import Flame from 'lucide-react/dist/esm/icons/flame.js'
import Medal from 'lucide-react/dist/esm/icons/medal.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js'
import Trophy from 'lucide-react/dist/esm/icons/trophy.js'
import type { LucideIcon } from 'lucide-react'
import CatalogProductImage from './catalogImages'
import CatalogPaginationControls, { CATALOG_DEFAULT_PAGE_SIZE, paginateCatalogItems } from './catalogPagination'
import { SectionShell, StatusPill } from './catalogUi'
import PortalFilterCombobox from './PortalFilterCombobox'
import { buildPortalHighlightBadges, buildPortalPricePresentation, shouldShowStockStatus } from './portalCatalogDisplay.ts'
import { isProductPromoted, type PromotionRule } from '../../utils/promotionRules.ts'
import { aggregateInitialOptions, getInitialKey } from '../../utils/initials.ts'
import { getKhmerTextProps } from '../../utils/scriptTypography.ts'

type CopyFn = (key: string, fallback?: string) => string
type ReplaceVarsFn = (template: string, values: Record<string, string | number>) => string
type StringListSetter = Dispatch<SetStateAction<string[]>>
type InitialFilterSetter = Dispatch<SetStateAction<string>>
type PortalBadge = ReturnType<typeof buildPortalHighlightBadges>[number]
type PriceFormatter = Parameters<typeof buildPortalPricePresentation>[2]

type CatalogOption = {
  id: number | string
  name: string
}

type InitialOption = ReturnType<typeof aggregateInitialOptions>[number]

type PortalPreviewConfig = {
  priceDisplay?: string
  highlightRankLimit?: unknown
  showRecommendedBadge?: boolean
  showPromotionBadge?: boolean
  showTopSellerBadge?: boolean
  showTopProductBadge?: boolean
  showNewArrivalBadge?: boolean
  showPromotions?: boolean
  showPrices?: boolean
  showProductCategory?: boolean
  showProductBrand?: boolean
  showProductDescription?: boolean
  showProductDiscount?: boolean
  showStockStatus?: boolean
}

type CatalogProduct = Record<string, unknown> & {
  id: number | string
  name?: string
  description?: string
  category?: string
  brand?: string
  discount_label?: string
}

type PromotionItem = {
  id: number | string
  eyebrow?: string
  title?: string
  subtitle?: string
  body?: string
  mediaUrl?: string
  linkUrl?: string
  linkProductId?: string | number
  linkProductName?: string
  ctaLabel?: string
}

type CatalogProductsSectionProps = {
  copy: CopyFn
  // G1: the active promotion rules from the catalog payload -- badges and
  // prices below evaluate the SAME kernel POS charges with.
  promotionRules?: PromotionRule[]
  filteredProducts?: CatalogProduct[]
  serverPaged?: boolean
  productTotal?: number | string | null
  productPage?: number | string | null
  productPageSize?: number | string | null
  setProductPage?: (page: number) => void
  setProductPageSize?: (pageSize: number) => void
  initialOptions?: InitialOption[]
  initialFilter?: string
  setInitialFilter?: InitialFilterSetter
  refreshingProducts?: boolean
  loadingProducts?: boolean
  categories?: CatalogOption[]
  brands?: string[]
  branches?: CatalogOption[]
  search?: string
  setSearch: (value: string) => void
  filtersOpen: boolean
  setFiltersOpen: Dispatch<SetStateAction<boolean>>
  portalActiveFilterCount: number
  clearPortalFilters: () => void
  categoryFilter: string[]
  setCategoryFilter: StringListSetter
  brandFilter: string[]
  setBrandFilter: StringListSetter
  branchFilter: string[]
  setBranchFilter: StringListSetter
  stockFilter: string[]
  setStockFilter: StringListSetter
  toggleFilterValue: (currentValues: string[], setter: StringListSetter, value: string) => void
  // Optional: batch-select a whole "Main - Sub" hierarchical category group
  // in one tap (see utils/categoryGrouping.ts / PortalFilterCombobox's
  // onToggleGroup prop). Falls back to the flat per-category list if not
  // supplied, same fallback shape used by the other pages' FilterMenu.
  toggleFilterValues?: (currentValues: string[], setter: StringListSetter, batch: string[], checked: boolean) => void
  previewConfig: PortalPreviewConfig
  portalError?: string | null
  productGridClass: string
  compactTwoColumnMobile?: boolean
  compactCatalogCards?: boolean
  promotionItems?: PromotionItem[]
  promotionsTitle?: string
  promotionsIntro?: string
  selectedStockBranch?: unknown
  getBranchQty: (product: CatalogProduct, selectedBranch: unknown) => number
  getStockStatus: (product: CatalogProduct, quantity: number, config: PortalPreviewConfig) => string
  normalizeProductGallery: (product: CatalogProduct) => string[]
  openProductGallery: (product: CatalogProduct, startIndex: number) => void
  // Opens the new Details flyout (images/description-sections/price/add-to-
  // cart) for this product. Optional -- the admin editor's own live preview
  // (CatalogPage.tsx) doesn't pass this (it has its own full product editor
  // a click away already), so the card's click-to-open-details behavior is
  // a public-portal-only affordance, same optionality pattern as
  // onAddToBucket below.
  openProductDetail?: (product: CatalogProduct) => void
  openPortalImage?: (title: string, images: string[]) => void
  formatPortalPrice: PriceFormatter
  replaceVars: ReplaceVarsFn
  onAddToBucket?: (product: CatalogProduct, priceText?: string) => void
  isInBucket?: (id: string | number) => boolean
  getBucketQty?: (id: string | number) => number
  // Branch is an internal stock-tracking dimension, not a customer-facing
  // concept -- the branch filter row should only ever appear in the admin's
  // own in-app preview, never on the real public-facing storefront.
  publicView?: boolean
}

function getBadgeIcon(badge: PortalBadge): LucideIcon {
  if (badge?.key === 'promotion') return BadgePercent
  if (badge?.key === 'recommended') return BadgeCheck
  if (badge?.key === 'top-seller') return Number(badge.rank) === 1 ? Trophy : Medal
  if (badge?.key === 'top-product') return Number(badge.rank) === 1 ? Flame : Medal
  return Sparkles
}

function getBadgeToneClass(badge: PortalBadge): string {
  if (badge?.tone === 'amber') return 'bg-amber-400/95 text-slate-950 ring-1 ring-amber-200/80'
  if (badge?.tone === 'emerald') return 'bg-emerald-600/95 text-white ring-1 ring-emerald-200/40'
  if (badge?.tone === 'rose') return 'bg-rose-600/95 text-white ring-1 ring-rose-200/40'
  if (badge?.tone === 'violet') return 'bg-violet-600/95 text-white ring-1 ring-violet-200/40'
  if (badge?.tone === 'blue') return 'bg-sky-600/95 text-white ring-1 ring-sky-200/40'
  return 'bg-slate-900/90 text-white ring-1 ring-white/20'
}

function getProductInitial(product: Pick<CatalogProduct, 'name'> | null | undefined): string {
  return getInitialKey(product?.name || '')
}

/**
 * Product-facing portal catalog view. Kept separate so the editor shell can
 * lazy-load the heavy customer-facing product list only when the tab is active.
 */
export default function CatalogProductsSection(props: CatalogProductsSectionProps) {
  const {
    copy,
    promotionRules = [],
    filteredProducts = [],
    serverPaged = false,
    productTotal,
    productPage,
    productPageSize,
    setProductPage,
    setProductPageSize,
    initialOptions: serverInitialOptions,
    initialFilter: controlledInitialFilter,
    setInitialFilter: setControlledInitialFilter,
    refreshingProducts = false,
    loadingProducts = false,
    categories = [],
    brands = [],
    branches = [],
    publicView = false,
    search = '',
    setSearch,
    filtersOpen,
    setFiltersOpen,
    portalActiveFilterCount,
    clearPortalFilters,
    categoryFilter,
    setCategoryFilter,
    brandFilter,
    setBrandFilter,
    branchFilter,
    setBranchFilter,
    stockFilter,
    setStockFilter,
    toggleFilterValue,
    toggleFilterValues,
    previewConfig,
    portalError,
    productGridClass,
    compactTwoColumnMobile,
    compactCatalogCards,
    promotionItems = [],
    promotionsTitle = '',
    promotionsIntro = '',
    selectedStockBranch,
    getBranchQty,
    getStockStatus,
    normalizeProductGallery,
    openProductGallery,
    openProductDetail,
    openPortalImage,
    formatPortalPrice,
    replaceVars,
    onAddToBucket,
    getBucketQty,
  } = props
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(CATALOG_DEFAULT_PAGE_SIZE)
  const [localInitialFilter, setLocalInitialFilter] = useState('all')
  const effectivePage = serverPaged ? Number(productPage || 1) : page
  const effectivePageSize = serverPaged ? Number(productPageSize || CATALOG_DEFAULT_PAGE_SIZE) : pageSize
  const effectiveInitialFilter = serverPaged ? (controlledInitialFilter || 'all') : localInitialFilter
  const updatePage = serverPaged ? setProductPage : setPage
  const updatePageSize = serverPaged ? setProductPageSize : setPageSize
  const updateInitialFilter = serverPaged ? setControlledInitialFilter : setLocalInitialFilter

  useEffect(() => {
    if (!serverPaged) setPage(1)
  }, [brandFilter, branchFilter, categoryFilter, localInitialFilter, search, serverPaged, stockFilter])

  const localInitialOptions = useMemo(() => {
    const counts = new Map<string, number>()
    filteredProducts.forEach((product) => {
      const key = getProductInitial(product)
      counts.set(key, (counts.get(key) || 0) + 1)
    })
    return aggregateInitialOptions([...counts.entries()].map(([key, count]) => ({ key, count })))
  }, [filteredProducts])
  const initialOptions = serverPaged && Array.isArray(serverInitialOptions) ? serverInitialOptions : localInitialOptions

  const letterFilteredProducts = useMemo(() => (
    serverPaged || effectiveInitialFilter === 'all'
      ? filteredProducts
      : (filteredProducts || []).filter((product) => getProductInitial(product) === effectiveInitialFilter)
  ), [effectiveInitialFilter, filteredProducts, serverPaged])

  const pagedProducts = useMemo(
    () => (serverPaged ? letterFilteredProducts : paginateCatalogItems(letterFilteredProducts, page, pageSize)),
    [letterFilteredProducts, page, pageSize, serverPaged],
  )
  const totalProducts = serverPaged ? Number(productTotal || 0) : letterFilteredProducts.length
  const visiblePromotionItems = useMemo(
    () => Array.isArray(promotionItems)
      ? promotionItems.filter((item) => item?.title || item?.subtitle || item?.body || item?.mediaUrl)
      : [],
    [promotionItems]
  )

  // Category-first section headers -- mirrors the admin Products/
  // Inventory pages' own category-header grouping (Part 226), but computed
  // per-page from whatever order the backend already returned rather than
  // re-sorted client-side, since both callers of this component fetch a
  // server-paginated, already category-sorted page (see portal.ts's
  // PORTAL_CATALOG_DEFAULT_ORDER_SQL). Suppressed while an active search
  // term is in play -- the backend switches to relevance ordering then, so
  // consecutive items no longer share a category and a header would be
  // misleading -- and while the category chip itself is configured hidden,
  // so this never surfaces category info a merchant deliberately turned off
  // elsewhere on the card. A category that happens to span a page boundary
  // shows its header again at the top of the next page rather than being
  // treated as "continuing" -- a reasonable limit of per-page grouping over
  // a paginated feed, not attempted to solve here.
  const showCategoryHeaders = !String(search || '').trim() && previewConfig.showProductCategory !== false
  const categoryHeaderAt = useMemo(() => {
    const headers = new Map<number, string>()
    if (!showCategoryHeaders) return headers
    // G1: the server puts promoted products in a block ABOVE the
    // category-alphabetical run. That leading run gets ONE "Promotions"
    // header; normal category headers begin after it, so a promoted item
    // never drags its whole category header to the top with it.
    let promotedRun = 0
    while (
      promotedRun < pagedProducts.length
      && promotionRules.length
      && isProductPromoted(pagedProducts[promotedRun], promotionRules)
    ) promotedRun++
    if (promotedRun > 0) headers.set(0, copy('promotionsHeader', 'Promotions'))
    let lastKey: string | null = null
    pagedProducts.forEach((product, index) => {
      if (index < promotedRun) return
      const raw = String(product.category || '').trim()
      const key = raw.toLowerCase()
      if (key === lastKey) return
      lastKey = key
      headers.set(index, raw || copy('uncategorized', 'Uncategorized'))
    })
    return headers
  }, [pagedProducts, showCategoryHeaders, copy, promotionRules])

  // Shared filter-field body (category/brand/branch/stock) -- rendered
  // twice: once inside the click-to-open mobile/tablet panel (unchanged
  // behavior below `lg`), and once inside the always-visible left rail at
  // `lg` and up (see the "desktop left-rail filter layout" ask). Extracted
  // to a function rather than duplicated JSX so the two call sites can
  // never drift apart.
  const renderFilterFields = () => (
    <>
      <div className="rounded-[1.1rem] bg-slate-50 p-2 ring-1 ring-slate-100 dark:bg-neutral-800 dark:ring-neutral-700">
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[5.6rem_minmax(0,1fr)] lg:grid-cols-1 lg:gap-1">
          <div className="min-w-0 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-neutral-400 lg:pt-0">
            <span className="block truncate">{copy('category', 'Category')}</span>
          </div>
          <PortalFilterCombobox
            label={copy('category', 'Category')}
            allLabel={copy('all', 'All')}
            searchPlaceholder={copy('searchCategories', 'Search categories...')}
            noMatchesLabel={copy('noMatches', 'No matches')}
            options={categories.map((category) => ({ value: category.name, label: category.name }))}
            selected={categoryFilter}
            onToggle={(value) => toggleFilterValue(categoryFilter, setCategoryFilter, value)}
            onToggleGroup={toggleFilterValues ? (values, checked) => toggleFilterValues(categoryFilter, setCategoryFilter, values, checked) : undefined}
            onClear={() => setCategoryFilter([])}
          />
        </div>
      </div>

      <div className="rounded-[1.1rem] bg-slate-50 p-2 ring-1 ring-slate-100 dark:bg-neutral-800 dark:ring-neutral-700">
        <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[5.6rem_minmax(0,1fr)] lg:grid-cols-1 lg:gap-1">
          <div className="min-w-0 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-neutral-400 lg:pt-0">
            <span className="block truncate">{copy('brand', 'Brand')}</span>
          </div>
          <PortalFilterCombobox
            label={copy('brand', 'Brand')}
            allLabel={copy('all', 'All')}
            searchPlaceholder={copy('searchBrands', 'Search brands...')}
            noMatchesLabel={copy('noMatches', 'No matches')}
            options={brands.map((brand) => ({ value: brand, label: brand }))}
            selected={brandFilter}
            onToggle={(value) => toggleFilterValue(brandFilter, setBrandFilter, value)}
            onToggleGroup={toggleFilterValues ? (values, checked) => toggleFilterValues(brandFilter, setBrandFilter, values, checked) : undefined}
            onClear={() => setBrandFilter([])}
          />
        </div>
      </div>

      {!publicView ? (
        <div className="rounded-[1.1rem] bg-slate-50 p-2 ring-1 ring-slate-100 dark:bg-neutral-800 dark:ring-neutral-700">
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[5.6rem_minmax(0,1fr)] lg:grid-cols-1 lg:gap-1">
            <div className="min-w-0 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-neutral-400 lg:pt-0">
              <span className="block truncate">{copy('branch', 'Branch')}</span>
            </div>
            <PortalFilterCombobox
              label={copy('branch', 'Branch')}
              allLabel={copy('allBranches', 'All branches')}
              searchPlaceholder={copy('searchBranches', 'Search branches...')}
              noMatchesLabel={copy('noMatches', 'No matches')}
              options={branches.map((branch) => ({ value: String(branch.id), label: branch.name }))}
              selected={branchFilter}
              onToggle={(value) => toggleFilterValue(branchFilter, setBranchFilter, value)}
              onClear={() => setBranchFilter([])}
            />
          </div>
        </div>
      ) : null}

      {shouldShowStockStatus(previewConfig) ? (
        <div className="rounded-[1.1rem] bg-slate-50 p-2 ring-1 ring-slate-100 dark:bg-neutral-800 dark:ring-neutral-700">
          <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-2 sm:grid-cols-[5.6rem_minmax(0,1fr)] lg:grid-cols-1 lg:gap-1">
            <div className="min-w-0 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500 dark:text-neutral-400 lg:pt-0">
              <span className="block truncate">{copy('stockStatus', 'Stock status')}</span>
            </div>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {[
                ['in_stock', copy('inStock', 'In Stock')],
                ['low_stock', copy('lowStock', 'Low Stock')],
                ['out_of_stock', copy('outOfStock', 'Out of Stock')],
              ].map(([value, label]) => {
                const active = stockFilter.includes(value)
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => toggleFilterValue(stockFilter, setStockFilter, value)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold leading-none transition-colors ${
                      active
                        ? 'border-blue-700 bg-blue-600 text-white shadow-sm dark:border-amber-400 dark:bg-amber-400 dark:text-neutral-950'
                        : 'border-slate-200 bg-white/95 text-slate-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-neutral-700 dark:bg-neutral-800/90 dark:text-neutral-200 dark:hover:border-amber-500/50 dark:hover:bg-neutral-700/80 dark:hover:text-amber-300'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}
    </>
  )

  return (
    <SectionShell
      title={copy('products', 'Products')}
      subtitle={copy('liveCatalog', 'Live inventory, customer-safe details only.')}
    >
      {/* Desktop (lg+): an always-visible left rail replaces the click-to-
          open Filters button/panel used below `lg` -- no popover needed
          when there's room for a permanent sidebar. Below `lg`, this
          renders nothing (`hidden`) and the existing button/panel further
          down handles filtering as before. */}
      <div className="lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <aside className="hidden min-w-0 lg:sticky lg:top-20 lg:block lg:min-w-0 lg:self-start">
          <div className="min-w-0 space-y-2 rounded-[1.35rem] border border-slate-200 bg-white p-2.5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
            <div className="flex items-center justify-between gap-2 px-1 pb-1">
              <span className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{copy('filters', 'Filters')}</span>
              {portalActiveFilterCount > 0 ? (
                <button type="button" className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-neutral-300 dark:hover:text-white" onClick={clearPortalFilters}>
                  {copy('clear', 'Clear')}
                </button>
              ) : null}
            </div>
            {renderFilterFields()}
          </div>
        </aside>

        <div className="min-w-0">
      <div className="mb-5 space-y-3">
        <div className="sticky top-16 z-20 -mx-1 rounded-[26px] border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/95 sm:top-20">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-neutral-800/80">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              id="portal-product-search"
              name="product_search"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-neutral-100"
              placeholder={copy('searchPlaceholder', 'Search by name, barcode, or SKU')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="flex items-center gap-2 lg:hidden">
            <button
              type="button"
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition sm:flex-none ${
                filtersOpen ? 'bg-slate-950 text-white dark:bg-white dark:text-neutral-950' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700'
              }`}
              onClick={() => setFiltersOpen((current) => !current)}
            >
              {copy('filters', 'Filters')}
              {portalActiveFilterCount > 0 ? (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{portalActiveFilterCount}</span>
              ) : null}
            </button>
            {portalActiveFilterCount > 0 ? (
              <button type="button" className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800" onClick={clearPortalFilters}>
                {copy('clear', 'Clear')}
              </button>
            ) : null}
          </div>
          </div>
        </div>

        {filtersOpen ? (
          <div className="space-y-2 rounded-[1.35rem] border border-slate-200 bg-white p-2.5 shadow-sm dark:border-neutral-700 dark:bg-neutral-900 lg:hidden">
            {renderFilterFields()}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 px-1 text-xs text-slate-500 dark:text-neutral-400">
          <span>{portalActiveFilterCount > 0 ? `${portalActiveFilterCount} ${copy('selected', 'selected')}` : copy('filterCompactHint', 'Use quick filters to narrow products faster.')}</span>
          <span className="font-semibold text-slate-600 dark:text-neutral-200">
            {refreshingProducts
              ? copy('refreshing', 'Refreshing...')
              : loadingProducts
                ? copy('loadingProducts', 'Loading products...')
              : replaceVars(copy('filterSummary', '{count} result(s)'), { count: totalProducts })}
          </span>
        </div>
      </div>

      {previewConfig.showPromotions !== false && visiblePromotionItems.length ? (
        <div className="mb-5 space-y-3">
          <div className="flex flex-col gap-1 px-1">
            <div className="text-lg font-semibold text-slate-900 dark:text-neutral-100">{promotionsTitle || copy('promotionsSectionFallback', 'Featured offers')}</div>
            <div className="text-sm text-slate-500 dark:text-neutral-400">{promotionsIntro || copy('promotionsSectionHint', 'Display offers, announcements, or editor posts ahead of searchable products.')}</div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {visiblePromotionItems.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900/90">
                <div className={`grid gap-0 ${item.mediaUrl ? 'md:grid-cols-[1.1fr,0.9fr]' : ''}`}>
                  <div className="flex flex-col justify-between bg-gradient-to-br from-rose-600 via-rose-500 to-orange-500 p-5 text-white">
                    <div className="space-y-3">
                      {item.eyebrow ? (
                        <span className="inline-flex rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-rose-50">
                          {item.eyebrow}
                        </span>
                      ) : null}
                      <div className="space-y-2">
                        {item.title ? <h3 className="text-2xl font-semibold leading-tight">{item.title}</h3> : null}
                        {item.subtitle ? <div className="text-sm font-medium text-rose-50/95">{item.subtitle}</div> : null}
                        {item.body ? <p className="text-sm leading-6 text-rose-50/90">{item.body}</p> : null}
                      </div>
                    </div>
                    {item.linkProductId && item.linkProductName ? (
                      <button
                        type="button"
                        onClick={() => setSearch(item.linkProductName || '')}
                        className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                      >
                        {item.ctaLabel || copy('viewProduct', 'View product')}
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    ) : item.linkUrl ? (
                      <a
                        href={item.linkUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
                      >
                        {item.ctaLabel || copy('open', 'Open')}
                        <ArrowRight className="h-4 w-4" />
                      </a>
                    ) : null}
                  </div>
                  {item.mediaUrl ? (
                    <button
                      type="button"
                      className="relative min-h-[220px] overflow-hidden bg-slate-100 dark:bg-neutral-800"
                      onClick={() => openPortalImage?.(item.title || promotionsTitle || copy('products', 'Products'), [item.mediaUrl || ''])}
                    >
                      <img src={item.mediaUrl} alt={item.title || item.subtitle || promotionsTitle || copy('products', 'Products')} className="h-full w-full object-cover" />
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {initialOptions.length > 1 ? (
        <div className="mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 dark:border-neutral-700 dark:bg-neutral-900/80">
          <button
            type="button"
            className={`h-8 min-w-8 rounded-xl px-2 text-xs font-semibold ${effectiveInitialFilter === 'all' ? 'bg-slate-950 text-white dark:bg-white dark:text-neutral-950' : 'text-slate-500 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}
            onClick={() => updateInitialFilter?.('all')}
          >
            {copy('all', 'All')}
          </button>
          {initialOptions.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`h-8 min-w-8 rounded-xl px-2 text-xs font-semibold ${effectiveInitialFilter === item.key ? 'bg-slate-950 text-white dark:bg-white dark:text-neutral-950' : 'text-slate-500 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800'}`}
              onClick={() => updateInitialFilter?.(effectiveInitialFilter === item.key ? 'all' : item.key)}
              title={`${item.label} (${item.count})`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {portalError ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200">
          {portalError}
        </div>
      ) : null}

      <CatalogPaginationControls
        className="mb-4"
        page={effectivePage}
        pageSize={effectivePageSize}
        totalItems={totalProducts}
        label={copy('products', 'products')}
        t={(key) => ({
          page: copy('page', 'Page'),
          of: copy('of', 'of'),
          showing: copy('showing', 'Showing'),
          per_page: copy('perPage', 'per page'),
        })[key] || key}
        onPageChange={updatePage}
        onPageSizeChange={(size) => {
          updatePageSize?.(size)
          updatePage?.(1)
        }}
      />

      <div className={`grid gap-x-4 gap-y-8 sm:gap-x-6 sm:gap-y-10 ${productGridClass}`}>
        {loadingProducts ? (
          Array.from({ length: Math.min(4, effectivePageSize || 4) }).map((_, index) => (
            <div key={`portal-product-skeleton-${index}`}>
              <div className="aspect-square animate-pulse rounded-2xl bg-slate-100 dark:bg-neutral-800" />
              <div className="space-y-2 pt-3">
                <div className="h-3 w-1/3 rounded bg-slate-100 dark:bg-neutral-800" />
                <div className="h-4 w-4/5 rounded bg-slate-100 dark:bg-neutral-800" />
                <div className="h-4 w-1/2 rounded bg-slate-100 dark:bg-neutral-800" />
              </div>
            </div>
          ))
        ) : null}
        {pagedProducts.map((product, index) => {
          const qty = getBranchQty(product, selectedStockBranch)
          const status = getStockStatus(product, qty, previewConfig)
          const gallery = normalizeProductGallery(product)
          const primaryImage = gallery[0] || ''
          const highlightBadges = buildPortalHighlightBadges(product, previewConfig, copy, promotionRules)
          const pricePresentation = previewConfig.showPrices
            ? buildPortalPricePresentation(product, previewConfig, formatPortalPrice, promotionRules)
            : null
          const metadataChips = [
            previewConfig.showProductCategory !== false ? product.category : '',
            previewConfig.showProductBrand !== false ? product.brand : '',
          ].map((chip) => String(chip || '').trim()).filter(Boolean)
          const showDescription = previewConfig.showProductDescription !== false
          const showDiscountDetails = previewConfig.showProductDiscount !== false
          const promotion = pricePresentation?.promotion
          const categoryHeaderLabel = categoryHeaderAt.get(index)

          return (
            <>
              {categoryHeaderLabel ? (
                <div
                  key={`category-header-${product.id}`}
                  className="col-span-full flex items-center gap-3 pt-2 first:pt-0"
                >
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    {categoryHeaderLabel}
                  </h3>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-neutral-800" />
                </div>
              ) : null}
              <article
                key={product.id}
                data-product-card="true"
                className={`group overflow-hidden bg-transparent transition duration-200 ${openProductDetail ? 'cursor-pointer' : ''}`}
                onClick={() => openProductDetail?.(product)}
              >
                <div
                className={`relative aspect-square overflow-hidden rounded-2xl bg-slate-100 dark:bg-neutral-800 ${gallery.length ? 'cursor-zoom-in' : ''}`}
                onClick={(event) => {
                  event.stopPropagation()
                  if (gallery.length) openProductGallery(product, 0)
                }}
              >
                {primaryImage ? (
                  <CatalogProductImage src={primaryImage} alt={product.name || copy('products', 'Products')} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-300">
                    <ShoppingBag className="h-10 w-10" />
                  </div>
                )}
                {highlightBadges.length ? (
                  <div className="absolute left-3 top-3 flex max-w-[76%] flex-col items-start gap-1.5">
                    {highlightBadges.map((badge) => (
                      (() => {
                        const BadgeIcon = getBadgeIcon(badge)
                        const badgeColor = typeof badge.color === 'string' ? badge.color : ''
                        const customStyle = badgeColor && badge.key === 'promotion'
                          ? { backgroundColor: badgeColor, color: '#fff' }
                          : undefined
                        return (
                          <span
                            key={String(badge.key || badge.label || 'badge')}
                            style={customStyle}
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] shadow-sm backdrop-blur ${customStyle ? 'ring-1 ring-white/30' : getBadgeToneClass(badge)}`}
                          >
                            <BadgeIcon className="h-3 w-3" />
                            {String(badge.label || '')}
                          </span>
                        )
                      })()
                    ))}
                  </div>
                ) : null}
                {shouldShowStockStatus(previewConfig) ? (
                  <div className="absolute right-3 top-3">
                    <StatusPill copy={copy} status={status} />
                  </div>
                ) : null}
                {gallery.length > 1 ? (
                  <span className="absolute bottom-3 left-3 rounded-full bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                    {replaceVars(copy('imageCount', '{current}/{total}'), { current: 1, total: gallery.length })}
                  </span>
                ) : null}
              </div>

              <div className={`space-y-1 ${compactCatalogCards ? 'pt-2.5' : 'pt-3'}`}>
                {metadataChips.length ? (
                  <div className="flex flex-wrap items-center gap-1 text-[10px] uppercase tracking-wide text-slate-400 dark:text-neutral-500">
                    {metadataChips.map((chip) => (
                      <span key={`${product.id}-${chip}`} {...getKhmerTextProps(chip, '')}>
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div {...getKhmerTextProps(product.name, `${compactCatalogCards ? 'text-[13px]' : 'text-[15px]'} font-medium leading-snug text-slate-900 dark:text-neutral-100`)}>
                  {product.name}
                </div>
                {showDescription ? (
                  <p {...getKhmerTextProps(product.description || copy('noDescription', 'No description available.'), `${compactCatalogCards ? 'line-clamp-2 min-h-[2.2rem] text-[11px] leading-[1.15rem]' : 'line-clamp-2 min-h-[2.6rem] text-xs leading-5'} text-slate-500 dark:text-neutral-400`)}>
                    {product.description || copy('noDescription', 'No description available.')}
                  </p>
                ) : null}
                {showDiscountDetails && promotion?.active ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/20 dark:text-rose-200">
                      <BadgePercent className="h-3 w-3" />
                      {product.discount_label || copy('discounts', 'Discount')}
                    </span>
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-2 pt-1">
                  {previewConfig.showPrices ? (
                    <div className={`font-semibold text-slate-900 dark:text-neutral-100 ${compactCatalogCards ? 'text-xs' : 'text-sm'}`}>
                      {pricePresentation?.primaryText}
                      {showDiscountDetails && promotion?.active && pricePresentation?.originalText ? (
                        <span className="ml-2 text-[11px] font-normal text-slate-400 line-through dark:text-neutral-500">
                          {pricePresentation.originalText}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className={`font-semibold text-slate-900 dark:text-neutral-100 ${compactCatalogCards ? 'text-xs' : 'text-sm'}`} aria-hidden="true" />
                  )}
                  {onAddToBucket ? (
                    (() => {
                      const qty = getBucketQty?.(product.id) ?? 0
                      const added = qty > 0
                      // Always shows "Add" (never swaps to a static
                      // "Added" checkmark) -- a small qty badge appears
                      // once qty > 0 instead, so the button keeps reading
                      // as tappable and the person can see (and keep
                      // incrementing) how many of this item they've
                      // added, matching how the bucket drawer's own +/-
                      // controls already work.
                      return (
                        <button
                          type="button"
                          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${added ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-700 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200'}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            onAddToBucket(product, previewConfig.showPrices ? pricePresentation?.primaryText : undefined)
                          }}
                          aria-label={added ? replaceVars(copy('addToBucketQty', 'Add another ({qty} added)'), { qty }) : copy('addToBucket', 'Add to list')}
                          title={added ? replaceVars(copy('addToBucketQty', 'Add another ({qty} added)'), { qty }) : copy('addToBucket', 'Add to list')}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span className="hidden sm:inline">{copy('addToBucket', 'Add')}</span>
                          {added ? (
                            <span className="ml-0.5 inline-flex min-w-[1.1rem] items-center justify-center rounded-full bg-white/25 px-1 text-[10px] font-bold leading-4">
                              {qty}
                            </span>
                          ) : null}
                        </button>
                      )
                    })()
                  ) : null}
                </div>
              </div>
            </article>
            </>
          )
        })}
      </div>

      {totalProducts > effectivePageSize ? (
        <CatalogPaginationControls
          className="mt-4"
          page={effectivePage}
          pageSize={effectivePageSize}
          totalItems={totalProducts}
          label={copy('products', 'products')}
          t={(key) => ({
            page: copy('page', 'Page'),
            of: copy('of', 'of'),
            showing: copy('showing', 'Showing'),
            per_page: copy('perPage', 'per page'),
          })[key] || key}
          onPageChange={updatePage}
          onPageSizeChange={(size) => {
            updatePageSize?.(size)
            updatePage?.(1)
          }}
        />
      ) : null}

      {totalProducts === 0 && !refreshingProducts && !loadingProducts ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-neutral-700 dark:bg-neutral-800/60 dark:text-neutral-400">
          {copy('noProducts', 'No products matched the current filters.')}
        </div>
      ) : null}
        </div>
      </div>
    </SectionShell>
  )
}
