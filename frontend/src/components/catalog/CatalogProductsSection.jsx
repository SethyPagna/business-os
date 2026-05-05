import React, { useEffect, useMemo, useState } from 'react'
import { ArrowRight, BadgeCheck, BadgePercent, Flame, Medal, Search, ShoppingBag, Sparkles, Tag, Trophy } from 'lucide-react'
import { ProductImg } from '../products/primitives'
import PaginationControls, { paginateItems } from '../shared/PaginationControls.jsx'
import { SectionShell, StatusPill } from './catalogUi'
import { buildPortalHighlightBadges, buildPortalPricePresentation } from './portalCatalogDisplay.mjs'
import { aggregateInitialOptions, getInitialKey } from '../../utils/initials.mjs'

function getBadgeIcon(badge) {
  if (badge?.key === 'promotion') return BadgePercent
  if (badge?.key === 'recommended') return BadgeCheck
  if (badge?.key === 'top-seller') return Number(badge.rank) === 1 ? Trophy : Medal
  if (badge?.key === 'top-product') return Number(badge.rank) === 1 ? Flame : Medal
  return Sparkles
}

function getBadgeToneClass(badge) {
  if (badge?.tone === 'amber') return 'bg-amber-400/95 text-slate-950 ring-1 ring-amber-200/80'
  if (badge?.tone === 'emerald') return 'bg-emerald-600/95 text-white ring-1 ring-emerald-200/40'
  if (badge?.tone === 'rose') return 'bg-rose-600/95 text-white ring-1 ring-rose-200/40'
  if (badge?.tone === 'violet') return 'bg-violet-600/95 text-white ring-1 ring-violet-200/40'
  if (badge?.tone === 'blue') return 'bg-sky-600/95 text-white ring-1 ring-sky-200/40'
  return 'bg-slate-900/90 text-white ring-1 ring-white/20'
}

function getProductInitial(product) {
  return getInitialKey(product?.name || '')
}

/**
 * Product-facing portal catalog view. Kept separate so the editor shell can
 * lazy-load the heavy customer-facing product list only when the tab is active.
 */
export default function CatalogProductsSection(props) {
  const {
    copy,
    filteredProducts,
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
    categories,
    brands,
    branches,
    search,
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
    openPortalImage,
    formatPortalPrice,
    replaceVars,
  } = props
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [localInitialFilter, setLocalInitialFilter] = useState('all')
  const effectivePage = serverPaged ? Number(productPage || 1) : page
  const effectivePageSize = serverPaged ? Number(productPageSize || 20) : pageSize
  const effectiveInitialFilter = serverPaged ? (controlledInitialFilter || 'all') : localInitialFilter
  const updatePage = serverPaged ? setProductPage : setPage
  const updatePageSize = serverPaged ? setProductPageSize : setPageSize
  const updateInitialFilter = serverPaged ? setControlledInitialFilter : setLocalInitialFilter

  useEffect(() => {
    if (!serverPaged) setPage(1)
  }, [brandFilter, branchFilter, categoryFilter, localInitialFilter, search, serverPaged, stockFilter])

  const localInitialOptions = useMemo(() => {
    const counts = new Map()
    ;(filteredProducts || []).forEach((product) => {
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
    () => (serverPaged ? letterFilteredProducts : paginateItems(letterFilteredProducts, page, pageSize)),
    [letterFilteredProducts, page, pageSize, serverPaged],
  )
  const totalProducts = serverPaged ? Number(productTotal || 0) : letterFilteredProducts.length
  const quickSearchTags = useMemo(() => {
    const pool = [
      ...(categories || []).slice(0, 4).map((item) => String(item?.name || '').trim()),
      ...(brands || []).slice(0, 3).map((item) => String(item || '').trim()),
    ]
    return [...new Set(pool.filter(Boolean))].slice(0, 6)
  }, [brands, categories])
  const visiblePromotionItems = useMemo(
    () => Array.isArray(promotionItems)
      ? promotionItems.filter((item) => item?.title || item?.subtitle || item?.body || item?.mediaUrl)
      : [],
    [promotionItems]
  )

  return (
    <SectionShell
      title={copy('products', 'Products')}
      subtitle={copy('liveCatalog', 'Live inventory, customer-safe details only.')}
    >
      <div className="mb-5 space-y-3">
        <div className="sticky top-16 z-20 -mx-1 rounded-[26px] border border-slate-200 bg-white/95 p-2 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:top-20">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-800/80">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              id="portal-product-search"
              name="product_search"
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-100"
              placeholder={copy('searchPlaceholder', 'Search products, category, or brand')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition sm:flex-none ${
                filtersOpen ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
              onClick={() => setFiltersOpen((current) => !current)}
            >
              {copy('filters', 'Filters')}
              {portalActiveFilterCount > 0 ? (
                <span className="rounded-full bg-white/20 px-2 py-0.5 text-xs">{portalActiveFilterCount}</span>
              ) : null}
            </button>
            {portalActiveFilterCount > 0 ? (
              <button type="button" className="rounded-xl px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" onClick={clearPortalFilters}>
                {copy('clear', 'Clear')}
              </button>
            ) : null}
          </div>
          </div>
          {quickSearchTags.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {quickSearchTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  onClick={() => setSearch(tag)}
                >
                  <Tag className="h-3.5 w-3.5" />
                  {tag}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {filtersOpen ? (
          <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/70 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{copy('category', 'Category')}</div>
              <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {categories.map((category) => (
                  <label key={category.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <input type="checkbox" checked={categoryFilter.includes(category.name)} onChange={() => toggleFilterValue(categoryFilter, setCategoryFilter, category.name)} />
                    <span className="truncate">{category.name}</span>
                  </label>
                ))}
                {!categories.length ? <div className="text-xs text-slate-400">{copy('all', 'All')}</div> : null}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{copy('brand', 'Brand')}</div>
              <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {brands.map((brand) => (
                  <label key={brand} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <input type="checkbox" checked={brandFilter.includes(brand)} onChange={() => toggleFilterValue(brandFilter, setBrandFilter, brand)} />
                    <span className="truncate">{brand}</span>
                  </label>
                ))}
                {!brands.length ? <div className="text-xs text-slate-400">{copy('all', 'All')}</div> : null}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{copy('branch', 'Branch')}</div>
              <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {branches.map((branch) => (
                  <label key={branch.id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <input type="checkbox" checked={branchFilter.includes(String(branch.id))} onChange={() => toggleFilterValue(branchFilter, setBranchFilter, String(branch.id))} />
                    <span className="truncate">{branch.name}</span>
                  </label>
                ))}
                {!branches.length ? <div className="text-xs text-slate-400">{copy('allBranches', 'All branches')}</div> : null}
              </div>
            </div>
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{copy('stockStatus', 'Stock status')}</div>
              <div className="space-y-1">
                {[
                  ['in_stock', copy('inStock', 'In Stock')],
                  ['low_stock', copy('lowStock', 'Low Stock')],
                  ['out_of_stock', copy('outOfStock', 'Out of Stock')],
                ].map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm text-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <input type="checkbox" checked={stockFilter.includes(value)} onChange={() => toggleFilterValue(stockFilter, setStockFilter, value)} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
          <span>{portalActiveFilterCount > 0 ? `${portalActiveFilterCount} ${copy('selected', 'selected')}` : copy('filterCompactHint', 'Use quick filters to narrow products faster.')}</span>
          <span className="font-semibold text-slate-600 dark:text-slate-200">
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
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">{promotionsTitle || copy('promotionsSectionFallback', 'Featured offers')}</div>
            <div className="text-sm text-slate-500 dark:text-slate-400">{promotionsIntro || copy('promotionsSectionHint', 'Display offers, announcements, or editor posts ahead of searchable products.')}</div>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {visiblePromotionItems.map((item) => (
              <article key={item.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/90">
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
                    {item.linkUrl ? (
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
                      className="relative min-h-[220px] overflow-hidden bg-slate-100 dark:bg-slate-800"
                      onClick={() => openPortalImage?.(item.title || promotionsTitle || copy('products', 'Products'), [item.mediaUrl])}
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
        <div className="mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900/80">
          <button
            type="button"
            className={`h-8 min-w-8 rounded-xl px-2 text-xs font-semibold ${effectiveInitialFilter === 'all' ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
            onClick={() => updateInitialFilter?.('all')}
          >
            {copy('all', 'All')}
          </button>
          {initialOptions.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`h-8 min-w-8 rounded-xl px-2 text-xs font-semibold ${effectiveInitialFilter === item.key ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950' : 'text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}
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

      <PaginationControls
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

      <div className={`grid gap-3 ${productGridClass}`}>
        {loadingProducts ? (
          Array.from({ length: Math.min(4, effectivePageSize || 4) }).map((_, index) => (
            <div key={`portal-product-skeleton-${index}`} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/90">
              <div className={`${compactTwoColumnMobile ? 'aspect-[5/4] sm:aspect-[4/3]' : 'aspect-[5/4]'} animate-pulse bg-slate-100 dark:bg-slate-800`} />
              <div className="space-y-3 p-4">
                <div className="h-4 w-1/2 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-5 w-4/5 rounded bg-slate-100 dark:bg-slate-800" />
                <div className="h-12 rounded bg-slate-100 dark:bg-slate-800" />
              </div>
            </div>
          ))
        ) : null}
        {pagedProducts.map((product) => {
          const qty = getBranchQty(product, selectedStockBranch)
          const status = getStockStatus(product, qty, previewConfig)
          const gallery = normalizeProductGallery(product)
          const primaryImage = gallery[0] || ''
          const highlightBadges = buildPortalHighlightBadges(product, previewConfig, copy)
          const pricePresentation = previewConfig.showPrices
            ? buildPortalPricePresentation(product, previewConfig, formatPortalPrice)
            : null
          const metadataChips = [
            previewConfig.showProductCategory !== false ? product.category : '',
            previewConfig.showProductBrand !== false ? product.brand : '',
          ].filter(Boolean)
          const showDescription = previewConfig.showProductDescription !== false
          const showDiscountDetails = previewConfig.showProductDiscount !== false
          const promotion = pricePresentation?.promotion

          return (
            <article key={product.id} className="overflow-hidden rounded-[22px] border border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-700 dark:bg-slate-900/90">
              <div
                className={`relative ${compactTwoColumnMobile ? 'aspect-[5/4] sm:aspect-[4/3]' : 'aspect-[5/4]'} overflow-hidden bg-slate-100 dark:bg-slate-800 ${gallery.length ? 'cursor-zoom-in' : ''}`}
                onClick={() => {
                  if (gallery.length) openProductGallery(product, 0)
                }}
              >
                {primaryImage ? (
                  <ProductImg src={primaryImage} alt={product.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-300">
                    <ShoppingBag className="h-10 w-10" />
                  </div>
                )}
                <div className="absolute left-4 top-4">
                  <StatusPill copy={copy} status={status} />
                </div>
                {highlightBadges.length ? (
                  <div className="absolute right-3 top-3 flex max-w-[76%] flex-col items-end gap-1.5">
                    {highlightBadges.map((badge) => (
                      (() => {
                        const BadgeIcon = getBadgeIcon(badge)
                        const customStyle = badge.color && badge.key === 'promotion'
                          ? { backgroundColor: badge.color, color: '#fff', boxShadow: '0 8px 20px rgba(15, 23, 42, 0.16)' }
                          : undefined
                        return (
                          <span
                            key={badge.key}
                            style={customStyle}
                            className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] shadow-sm backdrop-blur ${customStyle ? 'ring-1 ring-white/30' : getBadgeToneClass(badge)}`}
                          >
                            <BadgeIcon className="h-3.5 w-3.5" />
                            {badge.label}
                          </span>
                        )
                      })()
                    ))}
                  </div>
                ) : null}
                {gallery.length > 1 ? (
                  <button
                    type="button"
                    className="absolute bottom-3 right-3 rounded-full border border-white/20 bg-slate-900/70 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur"
                    onClick={(event) => {
                      event.stopPropagation()
                      openProductGallery(product, 0)
                    }}
                  >
                    {replaceVars(copy('imageCount', '{current}/{total}'), { current: 1, total: gallery.length })}
                  </button>
                ) : null}
              </div>

              <div className={`space-y-2.5 ${compactCatalogCards ? 'p-3' : 'p-3.5'}`}>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  {metadataChips.map((chip) => (
                    <span key={`${product.id}-${chip}`} className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800 dark:text-slate-200">
                      {chip}
                    </span>
                  ))}
                </div>
                <div className={`${compactCatalogCards ? 'text-sm' : 'text-[15px]'} font-semibold leading-tight text-slate-900 dark:text-slate-100`}>
                  {product.name}
                </div>
                {showDescription ? (
                  <p className={`${compactCatalogCards ? 'line-clamp-2 min-h-[2.4rem] text-[11px] leading-[1.15rem]' : 'line-clamp-3 min-h-[2.8rem] text-xs leading-5'} text-slate-600 dark:text-slate-300`}>
                    {product.description || copy('noDescription', 'No description available.')}
                  </p>
                ) : null}
                {showDiscountDetails && promotion?.active ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-900/20 dark:text-rose-200">
                      <BadgePercent className="h-3 w-3" />
                      {product.discount_label || copy('discounts', 'Discount')}
                    </span>
                    {pricePresentation?.originalText ? (
                      <span className="text-[11px] text-slate-400 line-through dark:text-slate-500">
                        {pricePresentation.originalText}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div className={`flex items-center justify-between gap-2 rounded-2xl bg-slate-50 dark:bg-slate-800/80 ${compactCatalogCards ? 'px-3 py-2' : 'px-3.5 py-2.5'}`}>
                  <div className="min-w-0 flex-1">
                    {previewConfig.showPrices ? (
                      <div className={`font-semibold text-slate-900 dark:text-slate-100 ${compactCatalogCards ? 'text-xs' : 'text-sm'}`}>
                        {pricePresentation?.primaryText}
                      </div>
                    ) : (
                      <div className={`font-semibold text-slate-900 dark:text-slate-100 ${compactCatalogCards ? 'text-xs' : 'text-sm'}`}>
                        {copy('priceHidden', 'Price hidden')}
                      </div>
                    )}
                    {showDiscountDetails && !promotion?.active && pricePresentation?.originalText ? (
                      <div className="text-[11px] text-slate-400 line-through dark:text-slate-500">
                        {pricePresentation.originalText}
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-[11px] font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500"
                    onClick={() => openProductGallery(product, 0)}
                  >
                    <Search className="h-4 w-4" />
                    <span className={compactCatalogCards ? 'hidden sm:inline' : ''}>{copy('viewDetails', 'View')}</span>
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {totalProducts > effectivePageSize ? (
        <PaginationControls
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
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
          {copy('noProducts', 'No products matched the current filters.')}
        </div>
      ) : null}
    </SectionShell>
  )
}
