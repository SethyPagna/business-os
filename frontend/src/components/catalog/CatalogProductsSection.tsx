import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right.js'
import BadgeCheck from 'lucide-react/dist/esm/icons/badge-check.js'
import BadgePercent from 'lucide-react/dist/esm/icons/badge-percent.js'
import Flame from 'lucide-react/dist/esm/icons/flame.js'
import Medal from 'lucide-react/dist/esm/icons/medal.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Heart from 'lucide-react/dist/esm/icons/heart.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js'
import Trophy from 'lucide-react/dist/esm/icons/trophy.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import type { LucideIcon } from 'lucide-react'
import CatalogProductImage from './catalogImages'
import CatalogPaginationControls, { CATALOG_DEFAULT_PAGE_SIZE, paginateCatalogItems } from './catalogPagination'
import { SectionShell, StatusPill } from './catalogUi'
import PortalFilterCombobox from './PortalFilterCombobox'
import PortalPromoStrip from './PortalPromoStrip.tsx'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import AlphaIndexRail from '../shared/AlphaIndexRail.tsx'
import { RAIL_ALL_KEY, resolveBrandJump } from '../../utils/alphaRail.ts'
import { pagerState } from '../../utils/pagerState.ts'
import { buildPortalHighlightBadges, buildPortalPricePresentation, resolvePortalStockStatus, shouldShowStockStatus } from './portalCatalogDisplay.ts'
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
  // Legacy-fallback threshold config for resolvePortalStockStatus (only
  // consulted for rows that still carry raw quantities -- editor preview
  // drafts and pre-deploy caches; live rows arrive with server-computed
  // statuses).
  stockThresholdMode?: string
  lowStockThreshold?: unknown
  outOfStockThreshold?: unknown
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
  // G1b: the one public promo facet ("only deals"); optional so the
  // admin preview surface can omit it.
  promoOnly?: boolean
  setPromoOnly?: (value: boolean) => void
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
  // Wishlist (§2: the heart/save toggle). Works for guests (localStorage) and
  // is mirrored to the account once signed in — the card doesn't care which.
  isInWishlist?: (id: string | number) => boolean
  onToggleWishlist?: (product: CatalogProduct, priceText?: string) => void
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

// G4: the A-Z rail indexes BRANDS (server-side rail letters come from
// p.brand too -- routes/portal.ts); the non-serverPaged fallback (the
// admin editor's live preview) must bucket the same way or the preview's
// rail would disagree with the storefront it previews.
function getProductInitial(product: Pick<CatalogProduct, 'brand'> | null | undefined): string {
  return getInitialKey(product?.brand || '')
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
    promoOnly = false,
    setPromoOnly,
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
    normalizeProductGallery,
    openProductGallery,
    openProductDetail,
    openPortalImage,
    formatPortalPrice,
    replaceVars,
    onAddToBucket,
    getBucketQty,
    isInWishlist,
    onToggleWishlist,
  } = props
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(CATALOG_DEFAULT_PAGE_SIZE)
  const [localInitialFilter, setLocalInitialFilter] = useState('all')
  const filterPanelRef = useRef<HTMLDivElement | null>(null)
  const effectivePage = serverPaged ? Number(productPage || 1) : page
  const effectivePageSize = serverPaged ? Number(productPageSize || CATALOG_DEFAULT_PAGE_SIZE) : pageSize
  const effectiveInitialFilter = serverPaged ? (controlledInitialFilter || 'all') : localInitialFilter
  const updatePage = serverPaged ? setProductPage : setPage
  const updatePageSize = serverPaged ? setProductPageSize : setPageSize
  const updateInitialFilter = serverPaged ? setControlledInitialFilter : setLocalInitialFilter

  useEffect(() => {
    if (!serverPaged) setPage(1)
  }, [brandFilter, branchFilter, categoryFilter, localInitialFilter, search, serverPaged, stockFilter])

  useEffect(() => {
    if (!filtersOpen) return undefined
    const frame = window.requestAnimationFrame(() => filterPanelRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [filtersOpen])

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
  // One fact, consulted by BOTH pager mounts. They used to disagree: the top
  // one rendered unconditionally while the bottom one was gated on the page
  // COUNT, so a single-page result showed a pager above the grid and nothing
  // below it. Sharing that count gate then hid BOTH on a single page -- and
  // the per-page chooser lives inside the pill, with the storefront's page
  // size held in component state rather than in the URL, so a shopper on
  // 100/page who narrowed to 12 products had no way back short of reloading
  // the site. The pill renders whenever there is anything to show; on one
  // page its arrows are simply disabled.
  const showPager = pagerState(effectivePage, totalProducts, effectivePageSize, CATALOG_DEFAULT_PAGE_SIZE).visible
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
    // G4: BRAND headers -- the grid browses brand-first now (server
    // ordering matches), so the section breaks follow p.brand.
    let lastKey: string | null = null
    pagedProducts.forEach((product, index) => {
      if (index < promotedRun) return
      const raw = String(product.brand || '').trim()
      const key = raw.toLowerCase()
      if (key === lastKey) return
      lastKey = key
      headers.set(index, raw || copy('noBrandHeader', 'Other Brands'))
    })
    return headers
  }, [pagedProducts, showCategoryHeaders, copy, promotionRules])

  // Shared filter-field body (category/brand/branch/stock) -- rendered
  // twice: once inside the body-portalled mobile/tablet filter layer below
  // `lg`, and once inside the always-visible left rail at `lg` and up.
  // Extracted to a function rather than duplicated JSX so the two call
  // sites can never drift apart.
  const renderFilterFields = () => (
    <>
      {/* G1b: the storefront's ONE promo facet -- a single "only deals"
          toggle. Deliberately no rule-by-rule or admin facets here
          (supplier etc. never reach the portal -- standing surface rule). */}
      {setPromoOnly ? (
        <button
          type="button"
          onClick={() => setPromoOnly(!promoOnly)}
          aria-pressed={promoOnly}
          className={`mb-2 flex w-full items-center justify-between rounded-[1.1rem] px-3 py-2 text-xs font-bold uppercase tracking-wide ring-1 transition-colors ${
            promoOnly
              ? 'bg-rose-600 text-white ring-rose-600'
              : 'bg-slate-50 text-gray-500 ring-slate-100 hover:text-rose-600 dark:bg-neutral-800 dark:text-neutral-400 dark:ring-neutral-700'
          }`}
        >
          <span>{copy('promotionsFilter', 'Promotions only')}</span>
          <span aria-hidden="true">{promoOnly ? '✓' : ''}</span>
        </button>
      ) : null}
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
      subtitle={copy('liveCatalog', 'Browse our products and check availability.')}
    >
      {/* Desktop (lg+): an always-visible left rail replaces the floating
          Filters layer used below `lg`; no popover is needed when there is
          room for a permanent sidebar. */}
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
          {/* The brand index used to be a second card here: a 4-column letter
              GRID inside its own `max-h-[...] overflow-y-auto` box. That box
              sat over the product list and swallowed wheel/touch gestures
              aimed at the page, and it duplicated a `lg:hidden` chip row
              below the search field. Both are now the single screen-edge
              AlphaIndexRail mounted at the end of this section. */}
        </aside>

        <div className="min-w-0">
      {/* G3: the auto-scrolling promo row sits ABOVE search, public view
          only, and only when the merchant shows promotions at all. */}
      {publicView && previewConfig.showPromotions !== false ? (
        <PortalPromoStrip
          products={filteredProducts}
          promotionRules={promotionRules}
          copy={copy}
          formatPrice={(usd, khr) => formatPortalPrice(usd, khr, previewConfig)}
          openProductDetail={openProductDetail}
        />
      ) : null}
      <div className="mb-5 space-y-3">
        <div className="sticky top-16 z-20 -mx-1 space-y-2 rounded-[22px] border border-slate-200 bg-white/96 p-2 shadow-[0_8px_24px_rgba(15,23,42,0.08)] backdrop-blur dark:border-neutral-700 dark:bg-neutral-900/96 sm:top-20">
          <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 dark:border-neutral-700 dark:bg-neutral-950 dark:focus-within:border-amber-400 dark:focus-within:ring-amber-500/15">
            <Search className="h-4 w-4 shrink-0 text-blue-600 dark:text-amber-300" />
            <input
              id="portal-product-search"
              name="product_search"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-neutral-100"
              placeholder={copy('searchPlaceholder', 'Search products')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="flex shrink-0 items-center gap-1.5 lg:hidden">
            <LazyPortalMenu
              align="auto"
              triggerWrapperClassName="min-w-0"
              menuClassName="w-[min(24rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] overflow-hidden rounded-[1.35rem] border border-slate-200 bg-white p-0 shadow-xl dark:border-neutral-700 dark:bg-neutral-900"
              onOpenChange={setFiltersOpen}
              trigger={(
                <button
                  type="button"
                  className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    filtersOpen || portalActiveFilterCount > 0 ? 'border-blue-600 bg-blue-600 text-white shadow-sm dark:border-amber-400 dark:bg-amber-400 dark:text-neutral-950' : 'border-slate-200 bg-white text-slate-700 shadow-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-200 dark:hover:border-amber-500/50 dark:hover:text-amber-300'
                  }`}
                  aria-label={copy('filters', 'Filters')}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                  <span className="hidden sm:inline">{copy('filters', 'Filters')}</span>
                  {portalActiveFilterCount > 0 ? (
                    <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{portalActiveFilterCount}</span>
                  ) : null}
                </button>
              )}
              content={({ closeMenu }) => (
                <div
                  ref={filterPanelRef}
                  role="dialog"
                  aria-label={copy('filters', 'Filters')}
                  tabIndex={-1}
                  className="max-h-[min(32rem,calc(100dvh-1rem))] overflow-y-auto overscroll-contain p-2.5 outline-none"
                >
                  <div className="mb-2 flex items-center justify-between gap-2 px-1">
                    <span className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{copy('filters', 'Filters')}</span>
                    <div className="flex items-center gap-2">
                      {portalActiveFilterCount > 0 ? (
                        <button type="button" className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-neutral-300 dark:hover:text-white" onClick={clearPortalFilters}>
                          {copy('clear', 'Clear')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"
                        onClick={closeMenu}
                        aria-label={copy('closeFilters', 'Close filters')}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">{renderFilterFields()}</div>
                </div>
              )}
            />
            {portalActiveFilterCount > 0 ? (
              <button type="button" className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:text-neutral-300 dark:hover:bg-neutral-800" onClick={clearPortalFilters}>
                {copy('clear', 'Clear')}
              </button>
            ) : null}
          </div>
          </div>

        {/* The `lg:hidden` letter chip row lived here: an `overflow-x-auto`
            strip of `h-8 min-w-9` buttons pinned under the search field. On a
            375px screen it was a full-width horizontal scroller directly
            above the grid, and it was the phone half of a control the
            screen-edge rail now provides at every breakpoint. */}

        <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-1 pt-2 text-xs text-slate-500 dark:border-neutral-800 dark:text-neutral-400">
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
      </div>

      {previewConfig.showPromotions !== false && visiblePromotionItems.length ? (
        <div className="mb-5 space-y-3">
          <div className="flex flex-col gap-1 px-1">
            <div className="text-lg font-semibold text-slate-900 dark:text-neutral-100">{promotionsTitle || copy('promotionsSectionFallback', 'Featured offers')}</div>
            <div className="text-sm text-slate-500 dark:text-neutral-400">{promotionsIntro || copy('promotionsSectionHint', 'Our latest offers and announcements.')}</div>
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

      {portalError ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200">
          {portalError}
        </div>
      ) : null}

      {/* Back / page / total / Next / per-page, centred, above the grid --
          and the identical mount below it. `back` and `next` have to be in
          this map: PaginationControls treats any truthy return as the label,
          so the map's `|| key` fallback was printing the raw lowercase keys
          "back" and "next" as the button captions in every language. */}
      {showPager ? (
        <CatalogPaginationControls
          className="mb-4"
          page={effectivePage}
          pageSize={effectivePageSize}
          totalItems={totalProducts}
          label={copy('products', 'products')}
          t={(key) => ({
            page: copy('page', 'Page'),
            of: copy('of', 'of'),
            back: copy('back', 'Back'),
            next: copy('next', 'Next'),
            per_page: copy('perPage', 'per page'),
          })[key] || key}
          onPageChange={updatePage}
          onPageSizeChange={(size) => {
            updatePageSize?.(size)
            updatePage?.(1)
          }}
        />
      ) : null}

      {/* Tighter vertical rhythm on phones so more products show per screen
          (user, Aug 31: "minimized for better useability ... same for public
          portal"): the row gap was 32px (gap-y-8) on mobile, which left the
          2-up grid feeling sparse and big. 16px on phones, easing back up at
          the sm/tablet breakpoint. Column count stays the store's config. */}
      <div className={`grid gap-x-4 gap-y-4 sm:gap-x-6 sm:gap-y-8 ${productGridClass}`}>
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
          // Server-computed status (see portalCatalogDisplay.ts's resolver
          // and its SECURITY BOUNDARY note) -- raw quantities/thresholds no
          // longer reach the storefront payload.
          const status = resolvePortalStockStatus(product, selectedStockBranch, previewConfig)
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
            // The mapped element is this Fragment, so IT carries the key --
            // keys on the children below never reached React's reconciler
            // (the "unique key" warning on this list).
            <Fragment key={product.id}>
              {categoryHeaderLabel ? (
                <div className="col-span-full flex items-center gap-3 pt-2 first:pt-0">
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-neutral-400">
                    {categoryHeaderLabel}
                  </h3>
                  <div className="h-px flex-1 bg-slate-200 dark:bg-neutral-800" />
                </div>
              ) : null}
              <article
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
                  <div className="flex items-center gap-1">
                  {onToggleWishlist ? (
                    (() => {
                      const saved = isInWishlist?.(product.id) ?? false
                      return (
                        <button
                          type="button"
                          className={`inline-flex shrink-0 items-center justify-center rounded-full p-1.5 transition ${saved ? 'text-rose-500' : 'text-slate-400 hover:text-rose-400 dark:text-neutral-500'}`}
                          onClick={(event) => {
                            event.stopPropagation()
                            onToggleWishlist(product, previewConfig.showPrices ? pricePresentation?.primaryText : undefined)
                          }}
                          aria-label={saved ? copy('removeFromWishlist', 'Remove from saved') : copy('addToWishlist', 'Save to wishlist')}
                          aria-pressed={saved}
                          title={saved ? copy('removeFromWishlist', 'Remove from saved') : copy('addToWishlist', 'Save to wishlist')}
                        >
                          <Heart className={`h-4 w-4 ${saved ? 'fill-current' : ''}`} />
                        </button>
                      )
                    })()
                  ) : null}
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
              </div>
            </article>
            </Fragment>
          )
        })}
      </div>

      {showPager ? (
        <CatalogPaginationControls
          className="mt-4"
          page={effectivePage}
          pageSize={effectivePageSize}
          totalItems={totalProducts}
          label={copy('products', 'products')}
          t={(key) => ({
            page: copy('page', 'Page'),
            of: copy('of', 'of'),
            back: copy('back', 'Back'),
            next: copy('next', 'Next'),
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

      {/* One vertical brand index for every breakpoint, pinned to the right
          screen edge: collapsed it is a column of dashes, hover (mouse) or
          touch opens it, a letter selects that brand group and the same
          letter again clears back to All. It replaces BOTH letter lists this
          section used to carry, and being `fixed` it adds nothing to the page
          flow -- no inner scroller over the grid, no width at 320/375.

          publicView only: the admin portal editor renders this same section
          inside a `.page-scroll` preview panel, where a viewport-fixed rail
          would float outside the preview and over the admin chrome. */}
      {publicView && initialOptions.length > 1 ? (
        <AlphaIndexRail
          edge="screen"
          letters={initialOptions.map((item) => item.key)}
          activeKey={effectiveInitialFilter === RAIL_ALL_KEY ? null : effectiveInitialFilter}
          resetOption={{ key: RAIL_ALL_KEY, ariaLabel: copy('all', 'All') }}
          label={copy('jumpToBrand', 'Jump to brand')}
          onJump={(key) => updateInitialFilter?.(resolveBrandJump(effectiveInitialFilter, key))}
        />
      ) : null}
    </SectionShell>
  )
}
