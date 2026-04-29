import React from 'react'
import { Search, ShoppingBag } from 'lucide-react'
import { ProductImg } from '../products/primitives'
import { SectionShell, StatusPill } from './catalogUi'

/**
 * Product-facing portal catalog view. Kept separate so the editor shell can
 * lazy-load the heavy customer-facing product list only when the tab is active.
 */
export default function CatalogProductsSection(props) {
  const {
    copy,
    filteredProducts,
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
    mobileGridColumns,
    productGridClass,
    compactTwoColumnMobile,
    compactCatalogCards,
    selectedStockBranch,
    getBranchQty,
    getStockStatus,
    normalizeProductGallery,
    openProductGallery,
    formatPortalPrice,
    replaceVars,
  } = props

  return (
    <SectionShell
      title={copy('products', 'Products')}
      subtitle={copy('liveCatalog', 'Live inventory, customer-safe details only.')}
    >
      <div className="mb-5 space-y-3">
        <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 sm:flex-row sm:items-center">
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
            {replaceVars(copy('filterSummary', '{count} result(s)'), { count: filteredProducts.length })}
          </span>
        </div>
      </div>

      {portalError ? (
        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800/60 dark:bg-rose-950/30 dark:text-rose-200">
          {portalError}
        </div>
      ) : null}

      <div className={`grid gap-3 ${mobileGridColumns === 1 ? 'grid-cols-1' : 'grid-cols-2'} ${productGridClass}`}>
        {filteredProducts.map((product) => {
          const qty = getBranchQty(product, selectedStockBranch)
          const status = getStockStatus(product, qty, previewConfig)
          const gallery = normalizeProductGallery(product)
          const primaryImage = gallery[0] || ''

          return (
            <article key={product.id} className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg dark:border-slate-700 dark:bg-slate-900/90">
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

              <div className={`space-y-2.5 ${compactCatalogCards ? 'p-3.5' : 'p-4'}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  {product.category ? <span className="rounded-full bg-slate-100 px-2.5 py-1 dark:bg-slate-800 dark:text-slate-200">{product.category}</span> : null}
                  {product.brand ? <span className="rounded-full bg-cyan-50 px-2.5 py-1 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200">{product.brand}</span> : null}
                </div>
                <div className={`${compactCatalogCards ? 'text-sm' : 'text-base'} font-semibold text-slate-900 dark:text-slate-100`}>{product.name}</div>
                <p className={`${compactCatalogCards ? 'min-h-[2.9rem] text-[11px] leading-5' : 'min-h-[3.2rem] text-xs leading-5'} text-slate-600 dark:text-slate-300`}>
                  {product.description || copy('noDescription', 'No description available.')}
                </p>

                <div className={`flex items-center justify-between rounded-2xl bg-slate-50 dark:bg-slate-800/80 ${compactCatalogCards ? 'px-3 py-2' : 'px-3.5 py-2.5'}`}>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{copy('price', 'Price')}</div>
                    <div className={`mt-1 font-semibold text-slate-900 dark:text-slate-100 ${compactCatalogCards ? 'text-xs' : 'text-sm'}`}>
                      {previewConfig.showPrices
                        ? formatPortalPrice(product.selling_price_usd, product.selling_price_khr, previewConfig)
                        : copy('priceHidden', 'Price hidden')}
                    </div>
                  </div>
                  {!compactCatalogCards ? <span className="text-xs text-slate-500 dark:text-slate-400">{copy('readOnly', 'Read-only for customers')}</span> : null}
                </div>
              </div>
            </article>
          )
        })}
      </div>

      {filteredProducts.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400">
          {copy('noProducts', 'No products matched the current filters.')}
        </div>
      ) : null}
    </SectionShell>
  )
}
