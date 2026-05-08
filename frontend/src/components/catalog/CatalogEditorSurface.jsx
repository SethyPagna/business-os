import { Bot, ExternalLink, Eye, Images, Plus, Save, Search, ShoppingBag, Sparkles, Upload } from 'lucide-react'
import { ProductImg } from '../products/primitives'
import { useCatalogPageContext } from './CatalogPageContext'
import ImageField from './CatalogImageField'
import { SectionShell } from './catalogUi'

export default function CatalogEditorSurface() {
  const {
    aboutBlocks,
    activeEditorSection,
    addAboutBlock,
    addAiFaqStarterSet,
    addFaqItem,
    addFaqStarterSet,
    addPromoItem,
    aiProviders,
    cancelPortalMediaUpload,
    clearPortalMediaTarget,
    copy,
    draftMapEmbedUrl,
    dragAboutBlockId,
    dragPromoItemId,
    editorDirty,
    editorDraft,
    editorSaving,
    editorSections,
    faqItems,
    formatDateTime,
    generatedPublicUrl,
    getAboutBlockLabel,
    getMediaUploadState,
    handleReviewSubmission,
    moveAboutBlockBefore,
    movePromoItemBefore,
    navigateTo,
    normalizeHexColor,
    openFilePicker,
    openPortalImage,
    previewConfig,
    previewSectionRef,
    products,
    promoItems,
    publicPortalUrl,
    recommendedProductIds,
    recommendedProductOptions,
    recommendedProductSearchInput,
    recommendedProductSearchTerm,
    removeAboutBlock,
    removeFaqItem,
    removePromoItem,
    reviewItems,
    reviewSavingId,
    savePortalDraft,
    selectedRecommendedProductOptions,
    setActiveEditorSection,
    setDraft,
    setDragAboutBlockId,
    setDragPromoItemId,
    setRecommendedProductSearchInput,
    setRecommendedProductSearchTerm,
    setReviewItems,
    toNumber,
    toggleRecommendedProduct,
    updateAboutBlock,
    updateFaqItem,
    updatePromoItem,
    uploadAboutBlockMedia,
    uploadDraftImage,
    uploadPromoItemMedia,
  } = useCatalogPageContext()

  return (
    <aside id="portal-editor-top" className="space-y-5">
      <div className="sticky top-0 z-30 -mx-4 rounded-none border-y border-slate-200 bg-white/95 px-3 py-2 shadow-md backdrop-blur dark:border-slate-700 dark:bg-slate-950/95 sm:top-2 sm:mx-0 sm:rounded-2xl sm:border">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-1 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
            {editorSections.map(([sectionId, sectionKey, label]) => (
              <button
                key={sectionId}
                type="button"
                className={`whitespace-nowrap rounded-full px-3 py-2 text-xs font-semibold transition ${
                  activeEditorSection === sectionKey
                    ? 'bg-slate-950 text-white shadow-sm dark:bg-white dark:text-slate-950'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                }`}
                onClick={() => setActiveEditorSection(sectionKey)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 lg:flex lg:justify-end">
              <button
                type="button"
                className="btn-secondary inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs sm:text-sm"
                onClick={() => previewSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
              >
                <Eye className="mr-1 inline h-4 w-4" />
                {copy('jumpToPreview', 'Jump to preview', 'ទៅកាន់ការមើលជាមុន')}
              </button>
              <button className="btn-primary inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs sm:text-sm" disabled={editorSaving || !editorDirty} onClick={savePortalDraft}>
                <Save className="mr-1 inline h-4 w-4" />
                {copy('saveChanges', 'Save changes', 'រក្សាទុកការកែប្រែ')}
              </button>
          </div>
        </div>
      </div>
      <SectionShell
        title={copy('studioTitle', 'Portal Editor')}
        subtitle={copy('studioHint', 'Edit the customer-facing portal here. The public page remains read-only.')}
      >
        <div className="space-y-5 dark:[&_.border-slate-200]:border-slate-700 dark:[&_.border-slate-300]:border-slate-700 dark:[&_.bg-white]:bg-slate-950/80 dark:[&_.bg-slate-50]:bg-slate-900/60 dark:[&_.bg-slate-100]:bg-slate-800 dark:[&_.text-slate-900]:text-slate-100 dark:[&_.text-slate-700]:text-slate-200 dark:[&_.text-slate-600]:text-slate-300 dark:[&_.text-slate-500]:text-slate-400 dark:[&_.text-slate-400]:text-slate-500 dark:[&_.input]:border-slate-700 dark:[&_.input]:bg-slate-950 dark:[&_.input]:text-slate-100 dark:[&_.input]:placeholder:text-slate-500 dark:[&_video]:bg-slate-950">
          <div id="portal-section-display" className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'display' ? '' : 'hidden'}`}>
            <div className="mb-2 text-sm font-semibold text-slate-900">{copy('display', 'Display settings')}</div>
            <div className="grid gap-3">
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showCatalog', 'Show product catalog')}</span>
                <input id="portal-show-catalog" name="customer_portal_show_catalog" type="checkbox" checked={!!editorDraft.customer_portal_show_catalog} onChange={(event) => setDraft('customer_portal_show_catalog', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showMembership', 'Show membership lookup')}</span>
                <input id="portal-show-membership" name="customer_portal_show_membership" type="checkbox" checked={!!editorDraft.customer_portal_show_membership} onChange={(event) => setDraft('customer_portal_show_membership', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showAbout', 'Show about section')}</span>
                <input id="portal-show-about" name="customer_portal_show_about" type="checkbox" checked={!!editorDraft.customer_portal_show_about} onChange={(event) => setDraft('customer_portal_show_about', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showPrices', 'Show selling prices')}</span>
                <input id="portal-show-prices" name="customer_portal_show_prices" type="checkbox" checked={!!editorDraft.customer_portal_show_prices} onChange={(event) => setDraft('customer_portal_show_prices', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showOutOfStockProducts', 'Show out-of-stock products')}</span>
                <input id="portal-show-out-of-stock-products" name="customer_portal_show_out_of_stock_products" type="checkbox" checked={editorDraft.customer_portal_show_out_of_stock_products !== false} onChange={(event) => setDraft('customer_portal_show_out_of_stock_products', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showProductBrand', 'Show brand tags')}</span>
                <input id="portal-show-product-brand" name="customer_portal_show_product_brand" type="checkbox" checked={editorDraft.customer_portal_show_product_brand !== false} onChange={(event) => setDraft('customer_portal_show_product_brand', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showProductCategory', 'Show category tags')}</span>
                <input id="portal-show-product-category" name="customer_portal_show_product_category" type="checkbox" checked={editorDraft.customer_portal_show_product_category !== false} onChange={(event) => setDraft('customer_portal_show_product_category', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showProductDescription', 'Show short descriptions')}</span>
                <input id="portal-show-product-description" name="customer_portal_show_product_description" type="checkbox" checked={editorDraft.customer_portal_show_product_description !== false} onChange={(event) => setDraft('customer_portal_show_product_description', event.target.checked)} />
              </label>
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showProductDiscount', 'Show discount details')}</span>
                <input id="portal-show-product-discount" name="customer_portal_show_product_discount" type="checkbox" checked={editorDraft.customer_portal_show_product_discount !== false} onChange={(event) => setDraft('customer_portal_show_product_discount', event.target.checked)} />
              </label>
            </div>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="portal-price-display" className="block text-sm font-medium text-slate-700">{copy('priceDisplay', 'Price display')}</label>
                <select id="portal-price-display" name="customer_portal_price_display" className="input" value={editorDraft.customer_portal_price_display || 'USD'} onChange={(event) => setDraft('customer_portal_price_display', event.target.value)}>
                  <option value="USD">USD</option>
                  <option value="KHR">KHR</option>
                  <option value="BOTH">Both</option>
                </select>
              </div>
              <div>
                  <label htmlFor="portal-refresh-seconds" className="block text-sm font-medium text-slate-700">{copy('refreshSeconds', 'Public refresh interval (seconds)', 'ចន្លោះពេលស្រស់ថ្មីសាធារណៈ (វិនាទី)')}</label>
                <input id="portal-refresh-seconds" name="customer_portal_refresh_seconds" className="input" type="number" min="5" max="120" step="1" value={editorDraft.customer_portal_refresh_seconds || '20'} onChange={(event) => setDraft('customer_portal_refresh_seconds', event.target.value)} />
              </div>
              <div>
                <label htmlFor="portal-grid-mobile" className="block text-sm font-medium text-slate-700">{copy('gridColumnsMobile', 'Mobile grid columns')}</label>
                <input
                  id="portal-grid-mobile"
                  name="customer_portal_grid_columns_mobile"
                  className="input"
                  type="number"
                  min="1"
                  max="3"
                  step="1"
                  value={editorDraft.customer_portal_grid_columns_mobile ?? '1'}
                  onChange={(event) => setDraft('customer_portal_grid_columns_mobile', event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="portal-grid-desktop" className="block text-sm font-medium text-slate-700">{copy('gridColumnsDesktop', 'Desktop grid columns')}</label>
                <input
                  id="portal-grid-desktop"
                  name="customer_portal_grid_columns_desktop"
                  className="input"
                  type="number"
                  min="2"
                  max="10"
                  step="1"
                  value={editorDraft.customer_portal_grid_columns_desktop ?? '4'}
                  onChange={(event) => setDraft('customer_portal_grid_columns_desktop', event.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-1">
                <div className="text-sm font-semibold text-slate-900">{copy('portalHighlights', 'Product highlights')}</div>
                <p className="text-xs text-slate-500">{copy('portalHighlightsHint', 'Use compact badges to call attention to trending, featured, or promotional items without overcrowding the product cards.')}</p>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">{copy('showTopSellerBadge', 'Show top seller badges')}</span>
                  <input type="checkbox" checked={!!editorDraft.customer_portal_show_top_seller_badge} onChange={(event) => setDraft('customer_portal_show_top_seller_badge', event.target.checked)} />
                </label>
                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">{copy('showTopProductBadge', 'Show top product badges')}</span>
                  <input type="checkbox" checked={!!editorDraft.customer_portal_show_top_product_badge} onChange={(event) => setDraft('customer_portal_show_top_product_badge', event.target.checked)} />
                </label>
                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">{copy('showRecommendedBadge', 'Show recommended badges')}</span>
                  <input type="checkbox" checked={!!editorDraft.customer_portal_show_recommended_badge} onChange={(event) => setDraft('customer_portal_show_recommended_badge', event.target.checked)} />
                </label>
                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">{copy('showPromotionBadge', 'Show promotion badges')}</span>
                  <input type="checkbox" checked={!!editorDraft.customer_portal_show_promotion_badge} onChange={(event) => setDraft('customer_portal_show_promotion_badge', event.target.checked)} />
                </label>
                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 md:col-span-2">
                  <span className="text-sm font-medium text-slate-700">{copy('showNewArrivalBadge', 'Show new arrival badges')}</span>
                  <input type="checkbox" checked={!!editorDraft.customer_portal_show_new_arrival_badge} onChange={(event) => setDraft('customer_portal_show_new_arrival_badge', event.target.checked)} />
                </label>
                <div className="md:col-span-2">
                  <label htmlFor="portal-highlight-rank-limit" className="block text-sm font-medium text-slate-700">{copy('highlightRankLimit', 'Ranking badge limit')}</label>
                  <input
                    id="portal-highlight-rank-limit"
                    name="customer_portal_highlight_rank_limit"
                    className="input"
                    type="number"
                    min="1"
                    max="10"
                    step="1"
                    value={editorDraft.customer_portal_highlight_rank_limit || '3'}
                    onChange={(event) => setDraft('customer_portal_highlight_rank_limit', event.target.value)}
                  />
                </div>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="block text-sm font-medium text-slate-700">{copy('recommendedProducts', 'Recommended products')}</div>
                  <span className="text-xs font-semibold text-slate-500">{recommendedProductIds.length} {copy('selected', 'selected')}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{copy('recommendedProductsHint', 'Select store-picked products that should always receive a recommended badge on the public portal.')}</p>
                {selectedRecommendedProductOptions.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {selectedRecommendedProductOptions.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        className="inline-flex max-w-full items-center gap-2 rounded-full border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800 transition hover:border-violet-300 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-100"
                        onClick={() => toggleRecommendedProduct(product.id)}
                        title={`${copy('remove', 'Remove')} ${product.name}`}
                      >
                        <span className="truncate">{product.name}</span>
                        <span aria-hidden="true">x</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <form
                  className="mt-3 flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-900/50 sm:flex-row"
                  onSubmit={(event) => {
                    event.preventDefault()
                    setRecommendedProductSearchTerm(recommendedProductSearchInput.trim())
                  }}
                >
                  <label htmlFor="portal-recommended-product-search" className="sr-only">{copy('search', 'Search products')}</label>
                  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-white px-3 py-2 dark:bg-slate-950">
                    <Search className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      id="portal-recommended-product-search"
                      name="recommended_product_search"
                      className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-100"
                      value={recommendedProductSearchInput}
                      onChange={(event) => setRecommendedProductSearchInput(event.target.value)}
                      placeholder={copy('searchPlaceholder', 'Search by product name, description, category, or brand')}
                      autoComplete="off"
                    />
                  </div>
                  <button type="submit" className="btn-secondary inline-flex items-center justify-center gap-2 whitespace-nowrap">
                    <Search className="h-4 w-4" />
                    {copy('search', 'Search')}
                  </button>
                </form>
                {recommendedProductSearchTerm.trim().length >= 2 ? (
                  recommendedProductOptions.length ? (
                    <div className="mt-3 grid max-h-72 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                      {recommendedProductOptions.map((product) => {
                        const checked = recommendedProductIds.includes(product.id)
                        return (
                          <label key={product.id} className={`flex items-center gap-3 rounded-2xl border px-3 py-2 transition ${checked ? 'border-violet-300 bg-violet-50 dark:border-violet-700 dark:bg-violet-950/30' : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950/50'}`}>
                            <input type="checkbox" checked={checked} onChange={() => toggleRecommendedProduct(product.id)} />
                            <div className="h-11 w-11 overflow-hidden rounded-xl bg-slate-200 dark:bg-slate-800">
                              {product.image ? <ProductImg src={product.image} alt={product.name} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-slate-400"><ShoppingBag className="h-4 w-4" /></div>}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">{product.name}</div>
                              <div className="truncate text-xs text-slate-500 dark:text-slate-400">{product.subtitle || `#${product.id}`}</div>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                      {copy('noProducts', 'No products matched the current filters.')}
                    </div>
                  )
                ) : (
                  <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                    {products.length ? copy('searchPlaceholder', 'Search by product name, description, category, or brand') : copy('noRecommendedProducts', 'No products loaded yet. Save products first, then come back here.')}
                  </div>
                )}
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{copy('promotionsEditor', 'Promotions and posts')}</div>
                    <p className="mt-1 text-xs text-slate-500">{copy('promotionsEditorHint', 'Add compact promo cards or store posts that appear before the product grid.')}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                      <input
                        id="portal-show-promotions"
                        name="customer_portal_show_promotions"
                        type="checkbox"
                        checked={!!editorDraft.customer_portal_show_promotions}
                        onChange={(event) => setDraft('customer_portal_show_promotions', event.target.checked)}
                      />
                      {copy('showPromotions', 'Show promotions and posts')}
                    </label>
                    <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm" onClick={addPromoItem}>
                      <Plus className="h-4 w-4" />
                      {copy('addPromotionCard', 'Add promotion card')}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="portal-promotions-title" className="block text-sm font-medium text-slate-700">{copy('promotionsTitle', 'Promotions title')}</label>
                    <input
                      id="portal-promotions-title"
                      name="customer_portal_promotions_title"
                      className="input"
                      value={editorDraft.customer_portal_promotions_title || ''}
                      onChange={(event) => setDraft('customer_portal_promotions_title', event.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="portal-promotions-intro" className="block text-sm font-medium text-slate-700">{copy('promotionsIntro', 'Promotions intro')}</label>
                    <input
                      id="portal-promotions-intro"
                      name="customer_portal_promotions_intro"
                      className="input"
                      value={editorDraft.customer_portal_promotions_intro || ''}
                      onChange={(event) => setDraft('customer_portal_promotions_intro', event.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  {promoItems.length ? promoItems.map((item) => (
                    <article
                      key={item.id}
                      draggable
                      onDragStart={() => setDragPromoItemId(item.id)}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() => {
                        movePromoItemBefore(dragPromoItemId, item.id)
                        setDragPromoItemId(null)
                      }}
                      onDragEnd={() => setDragPromoItemId(null)}
                      className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${dragPromoItemId === item.id ? 'opacity-60' : ''}`}
                    >
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">{item.title || copy('promotionCardTitle', 'Card title')}</div>
                        <button type="button" className="text-xs font-semibold text-rose-600 hover:text-rose-700" onClick={() => removePromoItem(item.id)}>
                          {copy('remove', 'Remove')}
                        </button>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
                        <div className="space-y-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label htmlFor={`portal-promo-eyebrow-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('promotionEyebrow', 'Badge label')}</label>
                              <input id={`portal-promo-eyebrow-${item.id}`} className="input" value={item.eyebrow || ''} onChange={(event) => updatePromoItem(item.id, 'eyebrow', event.target.value)} />
                            </div>
                            <div>
                              <label htmlFor={`portal-promo-title-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('promotionCardTitle', 'Card title')}</label>
                              <input id={`portal-promo-title-${item.id}`} className="input" value={item.title || ''} onChange={(event) => updatePromoItem(item.id, 'title', event.target.value)} />
                            </div>
                          </div>
                          <div>
                            <label htmlFor={`portal-promo-subtitle-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('promotionCardSubtitle', 'Card subtitle')}</label>
                            <input id={`portal-promo-subtitle-${item.id}`} className="input" value={item.subtitle || ''} onChange={(event) => updatePromoItem(item.id, 'subtitle', event.target.value)} />
                          </div>
                          <div>
                            <label htmlFor={`portal-promo-body-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('promotionCardBody', 'Card details')}</label>
                            <textarea id={`portal-promo-body-${item.id}`} className="input resize-none" rows={4} value={item.body || ''} onChange={(event) => updatePromoItem(item.id, 'body', event.target.value)} />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label htmlFor={`portal-promo-cta-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('promotionCtaLabel', 'Button label')}</label>
                              <input id={`portal-promo-cta-${item.id}`} className="input" value={item.ctaLabel || ''} onChange={(event) => updatePromoItem(item.id, 'ctaLabel', event.target.value)} />
                            </div>
                            <div>
                              <label htmlFor={`portal-promo-link-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('promotionLink', 'Button link')}</label>
                              <input id={`portal-promo-link-${item.id}`} className="input" value={item.linkUrl || ''} onChange={(event) => updatePromoItem(item.id, 'linkUrl', event.target.value)} placeholder="https://..." />
                            </div>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <ImageField
                            label={copy('coverImage', 'Cover image')}
                            value={item.mediaUrl}
                            fieldId={`portal-promo-image-${item.id}`}
                            onUpload={() => uploadPromoItemMedia(item.id)}
                            onCancelUpload={() => cancelPortalMediaUpload(`promo:${item.id}`)}
                            onChooseExisting={() => openFilePicker(`promo:${item.id}`, 'image', copy('coverImage', 'Cover image'))}
                            onChange={(value) => updatePromoItem(item.id, 'mediaUrl', value)}
                            onClear={() => clearPortalMediaTarget(`promo:${item.id}`)}
                            onPreview={() => openPortalImage(item.title || copy('coverImage', 'Cover image'), [item.mediaUrl])}
                            uploadLabel={copy('uploadImage', 'Upload image')}
                            chooseLabel={copy('openFiles', 'Files')}
                            clearLabel={copy('clearImage', 'Clear')}
                            previewLabel={copy('openGallery', 'Open image gallery')}
                            hint={copy('portalImageUploadHint', 'Upload stores a short file path, so portal settings stay clean.')}
                            cancelLabel={copy('cancelUpload', 'Cancel upload')}
                            uploadingLabel={copy('uploading', 'Uploading...')}
                            uploadedQueuedLabel={copy('portalUploadQueued', 'Uploaded. Background optimization is running now.')}
                            uploadedReadyLabel={copy('portalUploadReady', 'Uploaded and ready.')}
                            uploadState={getMediaUploadState(`promo:${item.id}`)}
                          />
                        </div>
                      </div>
                    </article>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-400">
                      {copy('noPromotionCards', 'No promotion cards yet. Add one to feature discounts, events, or new arrivals.')}
                    </div>
                  )}
                </div>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-500">{copy('syncSpeedHint', 'Lower values refresh faster but create more requests. Internal preview still reacts to sync events immediately.')}</p>
          </div>

          <div id="portal-section-theme" className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'about' ? '' : 'hidden'}`}>
            <div className="mb-2 text-sm font-semibold text-slate-900">{copy('portalTheme', 'Portal theme')}</div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label htmlFor="portal-hero-gradient-start" className="block text-sm font-medium text-slate-700">{copy('heroGradientStart', 'Header color 1')}</label>
                <input
                  id="portal-hero-gradient-start"
                  name="customer_portal_hero_gradient_start"
                  className="input h-11"
                  type="color"
                  value={normalizeHexColor(editorDraft.customer_portal_hero_gradient_start, '#0f172a')}
                  onChange={(event) => setDraft('customer_portal_hero_gradient_start', event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="portal-hero-gradient-mid" className="block text-sm font-medium text-slate-700">{copy('heroGradientMid', 'Header color 2')}</label>
                <input
                  id="portal-hero-gradient-mid"
                  name="customer_portal_hero_gradient_mid"
                  className="input h-11"
                  type="color"
                  value={normalizeHexColor(editorDraft.customer_portal_hero_gradient_mid, '#14532d')}
                  onChange={(event) => setDraft('customer_portal_hero_gradient_mid', event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="portal-hero-gradient-end" className="block text-sm font-medium text-slate-700">{copy('heroGradientEnd', 'Header color 3')}</label>
                <input
                  id="portal-hero-gradient-end"
                  name="customer_portal_hero_gradient_end"
                  className="input h-11"
                  type="color"
                  value={normalizeHexColor(editorDraft.customer_portal_hero_gradient_end, '#ea580c')}
                  onChange={(event) => setDraft('customer_portal_hero_gradient_end', event.target.value)}
                />
              </div>
            </div>
            <div className="mt-4">
              <label htmlFor="portal-about-title" className="block text-sm font-medium text-slate-700">{copy('aboutTitle', 'About title')}</label>
              <input
                id="portal-about-title"
                name="customer_portal_about_title"
                className="input"
                value={editorDraft.customer_portal_about_title || ''}
                onChange={(event) => setDraft('customer_portal_about_title', event.target.value)}
              />
            </div>
            <div className="mt-4">
              <label htmlFor="portal-about-content" className="block text-sm font-medium text-slate-700">{copy('aboutContent', 'About content')}</label>
              <textarea
                id="portal-about-content"
                name="customer_portal_about_content"
                className="input resize-none"
                rows={4}
                value={editorDraft.customer_portal_about_content || ''}
                onChange={(event) => setDraft('customer_portal_about_content', event.target.value)}
              />
              <p className="mt-2 text-xs text-slate-500">{copy('aboutContentHint', 'Tell customers about your story, hours, policies, or services.')}</p>
            </div>
            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{copy('aboutBlocks', 'About blocks')}</div>
                  <p className="mt-1 text-xs text-slate-500">{copy('aboutBlocksHint', 'Add text, image, and video sections, then move them into the order you want customers to see.')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm" onClick={() => addAboutBlock('text')}>
                    <Plus className="h-4 w-4" />
                    {copy('addTextBlock', 'Text')}
                  </button>
                  <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm" onClick={() => addAboutBlock('image')}>
                    <Images className="h-4 w-4" />
                    {copy('addImageBlock', 'Image')}
                  </button>
                  <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm" onClick={() => addAboutBlock('video')}>
                    <Plus className="h-4 w-4" />
                    {copy('addVideoBlock', 'Video')}
                  </button>
                </div>
              </div>
              <div className="mt-4 space-y-4">
                {aboutBlocks.length ? aboutBlocks.map((block, index) => (
                  <article
                    key={block.id}
                    draggable
                    onDragStart={() => setDragAboutBlockId(block.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      moveAboutBlockBefore(dragAboutBlockId, block.id)
                      setDragAboutBlockId(null)
                    }}
                    onDragEnd={() => setDragAboutBlockId(null)}
                    className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${dragAboutBlockId === block.id ? 'opacity-60' : ''}`}
                  >
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex flex-wrap items-center gap-3 text-sm font-semibold text-slate-900">
                        <button type="button" className="cursor-grab rounded-xl border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500" title={copy('dragToReorder', 'Drag to reorder')}>
                          ::
                        </button>
                        <span>
                          {getAboutBlockLabel(block.type)} #{index + 1}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => removeAboutBlock(block.id)}>{copy('remove', 'Remove')}</button>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
                      <div className="space-y-4">
                        <div>
                          <label htmlFor={`portal-about-block-title-${block.id}`} className="block text-sm font-medium text-slate-700">{copy('sectionTitle', 'Section title')}</label>
                          <input id={`portal-about-block-title-${block.id}`} className="input" value={block.title} onChange={(event) => updateAboutBlock(block.id, 'title', event.target.value)} />
                        </div>
                        <div>
                          <label htmlFor={`portal-about-block-body-${block.id}`} className="block text-sm font-medium text-slate-700">{block.type === 'text' ? copy('textContent', 'Text content') : copy('captionDescription', 'Caption / description')}</label>
                          <textarea id={`portal-about-block-body-${block.id}`} className="input resize-none" rows={block.type === 'text' ? 5 : 3} value={block.body} onChange={(event) => updateAboutBlock(block.id, 'body', event.target.value)} />
                        </div>
                      </div>
                      <div className="space-y-3">
                        {(() => {
                          const uploadKey = `about:${block.id}`
                          const blockUpload = getMediaUploadState(uploadKey)
                          const uploadLabel = block.type === 'video' ? copy('uploadVideo', 'Upload video') : copy('uploadImage', 'Upload image')
                          return (
                            <>
                        <label htmlFor={`portal-about-block-media-${block.id}`} className="block text-sm font-medium text-slate-700">{block.type === 'video' ? copy('videoUrl', 'Video URL') : copy('imageUrl', 'Image URL')}</label>
                        <input id={`portal-about-block-media-${block.id}`} className="input" value={block.mediaUrl} placeholder={block.type === 'video' ? 'https://...' : 'https://... or upload below'} onChange={(event) => updateAboutBlock(block.id, 'mediaUrl', event.target.value)} />
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className="btn-secondary text-sm" onClick={() => uploadAboutBlockMedia(block.id)} disabled={blockUpload.status === 'uploading'}>
                            <Upload className="mr-2 inline h-4 w-4" />
                            {blockUpload.status === 'uploading' ? copy('uploading', 'Uploading...') : uploadLabel}
                          </button>
                          {blockUpload.status === 'uploading' ? (
                            <button type="button" className="btn-secondary text-sm" onClick={() => cancelPortalMediaUpload(uploadKey)}>
                              {copy('cancelUpload', 'Cancel upload')}
                            </button>
                          ) : null}
                          <button type="button" className="btn-secondary text-sm" onClick={() => openFilePicker(`about:${block.id}`, block.type === 'video' ? 'video' : 'image', block.title || copy('about', 'About'))} disabled={blockUpload.status === 'uploading'}>
                            {copy('openFiles', 'Files')}
                          </button>
                          {block.mediaUrl && block.type !== 'video' ? (
                            <button type="button" className="btn-secondary text-sm" onClick={() => openPortalImage(block.title || copy('about', 'About'), [block.mediaUrl])} disabled={blockUpload.status === 'uploading'}>
                              <Eye className="mr-2 inline h-4 w-4" />
                              {copy('openGallery', 'Open image gallery')}
                            </button>
                          ) : null}
                          {block.mediaUrl ? (
                            <button type="button" className="btn-secondary text-sm" onClick={() => clearPortalMediaTarget(uploadKey)} disabled={blockUpload.status === 'uploading'}>
                              {copy('clearImage', 'Clear')}
                            </button>
                          ) : null}
                        </div>
                        {blockUpload.status === 'uploading' ? (
                          <div className="rounded-2xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                            <div className="flex items-center justify-between gap-3">
                              <span>{blockUpload.fileName || copy('uploading', 'Uploading...')}</span>
                              <span>{Number(blockUpload.progress || 0)}%</span>
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-blue-100">
                              <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.max(6, Number(blockUpload.progress || 0))}%` }} />
                            </div>
                          </div>
                        ) : null}
                        {blockUpload.processingStatus && blockUpload.processingStatus !== 'idle' && blockUpload.status === 'uploaded' ? (
                          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                            {blockUpload.processingStatus === 'queued'
                              ? copy('portalUploadQueued', 'Uploaded. Background optimization is running now.')
                              : copy('portalUploadReady', 'Uploaded and ready.')}
                          </div>
                        ) : null}
                        {blockUpload.error ? (
                          <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {blockUpload.error}
                          </div>
                        ) : null}
                        {block.mediaUrl ? (
                          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white p-3">
                            {block.type === 'video' ? (
                              <video src={block.mediaUrl} controls preload="metadata" className="max-h-56 w-full rounded-2xl bg-white object-contain" />
                            ) : (
                              <button type="button" className="flex w-full items-center justify-center rounded-2xl bg-slate-50 p-3" onClick={() => openPortalImage(block.title || copy('about', 'About'), [block.mediaUrl])}>
                                <img src={block.mediaUrl} alt={block.title || copy('about', 'About')} className="max-h-56 max-w-full object-contain" />
                              </button>
                            )}
                          </div>
                        ) : null}
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  </article>
                )) : (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                    {copy('aboutEmpty', 'Add your first About block to build a richer page with reorderable text, images, and video.')}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div id="portal-section-faq" className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'faq' ? '' : 'hidden'}`}>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{copy('faqSettings', 'FAQ settings')}</div>
                  <p className="mt-1 text-xs text-slate-500">{copy('faqHint', 'Add your most common customer questions here. Customers can open each answer one by one.')}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm" onClick={addFaqStarterSet}>
                    <Sparkles className="h-4 w-4" />
                    {copy('addStarterSet', 'Starter set')}
                  </button>
                  <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm" onClick={addAiFaqStarterSet}>
                    <Bot className="h-4 w-4" />
                    {copy('addAiStarterSet', 'AI starter')}
                  </button>
                  <button type="button" className="btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm" onClick={addFaqItem}>
                    <Plus className="h-4 w-4" />
                    {copy('addFaq', 'Add FAQ')}
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-4">
                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">{copy('faqEnabled', 'Show FAQ section')}</span>
                  <input type="checkbox" checked={!!editorDraft.customer_portal_show_faq} onChange={(event) => setDraft('customer_portal_show_faq', event.target.checked)} />
                </label>
                <div>
                  <label htmlFor="portal-faq-title" className="block text-sm font-medium text-slate-700">{copy('faqTitle', 'FAQ title')}</label>
                  <input id="portal-faq-title" className="input mt-1" value={editorDraft.customer_portal_faq_title || ''} onChange={(event) => setDraft('customer_portal_faq_title', event.target.value)} />
                </div>
                <div className="space-y-3">
                  {faqItems.length ? faqItems.map((item, index) => (
                    <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">#{index + 1}</div>
                        <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => removeFaqItem(item.id)}>{copy('remove', 'Remove')}</button>
                      </div>
                      <div className="mt-3 grid gap-3">
                        <div>
                          <label htmlFor={`portal-faq-question-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('faqQuestion', 'Question')}</label>
                          <input id={`portal-faq-question-${item.id}`} className="input mt-1" value={item.question} onChange={(event) => updateFaqItem(item.id, 'question', event.target.value)} />
                        </div>
                        <div>
                          <label htmlFor={`portal-faq-answer-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('faqAnswer', 'Answer')}</label>
                          <textarea id={`portal-faq-answer-${item.id}`} className="input mt-1 resize-none" rows={3} value={item.answer} onChange={(event) => updateFaqItem(item.id, 'answer', event.target.value)} />
                        </div>
                      </div>
                    </article>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
                      {copy('faqHint', 'Add your most common customer questions here. Customers can open each answer one by one.')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div id="portal-section-assistant" className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'assistant' ? '' : 'hidden'}`}>
            <div className="space-y-5">
              <div>
                  <div className="text-sm font-semibold text-slate-900">{copy('portalAssistantSettings', 'AI assistant settings', 'ការកំណត់ជំនួយការ AI')}</div>
                  <p className="mt-2 text-sm text-slate-600">{copy('portalAssistantHint', 'This customer-facing AI page suggests products from your live catalog and can include online references when the selected provider supports them.', 'ជំនួយការ AI សម្រាប់អតិថិជននេះនឹងណែនាំផលិតផលពីកាតាឡុកបច្ចុប្បន្ន ហើយអាចបន្ថែមប្រភពអនឡាញបាន បើ provider ដែលបានជ្រើសគាំទ្រ។')}</p>
              </div>

              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('assistantEnabled', 'Enable AI assistant')}</span>
                <input type="checkbox" checked={!!editorDraft.customer_portal_ai_enabled} onChange={(event) => setDraft('customer_portal_ai_enabled', event.target.checked)} />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="portal-ai-title" className="block text-sm font-medium text-slate-700">{copy('assistantTitle', 'Assistant title')}</label>
                  <input id="portal-ai-title" className="input mt-1" value={editorDraft.customer_portal_ai_title || ''} onChange={(event) => setDraft('customer_portal_ai_title', event.target.value)} />
                </div>
                <div>
                  <label htmlFor="portal-ai-provider" className="block text-sm font-medium text-slate-700">{copy('assistantProvider', 'AI provider entry', 'AI provider')}</label>
                  <select id="portal-ai-provider" className="input mt-1" value={editorDraft.customer_portal_ai_provider_id || ''} onChange={(event) => setDraft('customer_portal_ai_provider_id', event.target.value)}>
                    <option value="">{copy('assistantProviderAuto', 'Automatic (best available)', 'ស្វ័យប្រវត្តិ (ល្អបំផុតដែលមាន)')}</option>
                    {aiProviders.map((provider) => (
                      <option key={provider.id} value={String(provider.id)}>
                        {provider.name} | {provider.provider_label || provider.provider} | {provider.default_model || copy('noModel', 'No model')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="portal-ai-intro" className="block text-sm font-medium text-slate-700">{copy('assistantIntro', 'Assistant intro')}</label>
                <textarea id="portal-ai-intro" className="input mt-1 resize-none" rows={3} value={editorDraft.customer_portal_ai_intro || ''} onChange={(event) => setDraft('customer_portal_ai_intro', event.target.value)} />
              </div>

              <div>
                <label htmlFor="portal-ai-disclaimer" className="block text-sm font-medium text-slate-700">{copy('assistantDisclaimer', 'Assistant disclaimer')}</label>
                <textarea id="portal-ai-disclaimer" className="input mt-1 resize-none" rows={3} value={editorDraft.customer_portal_ai_disclaimer || ''} onChange={(event) => setDraft('customer_portal_ai_disclaimer', event.target.value)} />
              </div>

              <div>
                <label htmlFor="portal-ai-prompt" className="block text-sm font-medium text-slate-700">{copy('assistantPrompt', 'Extra prompt instructions')}</label>
                <textarea id="portal-ai-prompt" className="input mt-1 resize-none" rows={4} value={editorDraft.customer_portal_ai_prompt || ''} onChange={(event) => setDraft('customer_portal_ai_prompt', event.target.value)} />
                <p className="mt-2 text-xs text-slate-500">{copy('assistantPromptHint', 'Optional store-specific rules, such as tone or what categories to prioritize.')}</p>
              </div>

            </div>
          </div>

          <div id="portal-section-publish" className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'publish' ? '' : 'hidden'}`}>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
              <ExternalLink className="h-4 w-4" />
              {copy('customerUrl', 'Customer URL')}
            </div>
            <div className="break-all rounded-xl bg-white px-3 py-2 text-sm text-slate-700">{generatedPublicUrl}</div>
            <p className="mt-2 text-xs text-slate-500">{copy('customerUrlHint', 'Set a custom public path here, then publish that path through a separate customer-facing Funnel so the customer link is harder to guess from the admin side.')}</p>
            <div className="mt-3">
              <label htmlFor="portal-public-path" className="block text-sm font-medium text-slate-700">{copy('publicPathInput', 'Custom public path')}</label>
              <input
                id="portal-public-path"
                name="customer_portal_path"
                className="input mt-1"
                value={editorDraft.customer_portal_path || ''}
                placeholder={copy('publicPathPlaceholder', '/your-customer-link')}
                onChange={(event) => setDraft('customer_portal_path', event.target.value)}
              />
            </div>
            <div className="mt-3">
              <label htmlFor="portal-public-url" className="block text-sm font-medium text-slate-700">{copy('publicUrlLabel', 'Public customer URL')}</label>
              <input
                id="portal-public-url"
                name="customer_portal_public_url"
                className="input mt-1"
                value={editorDraft.customer_portal_public_url || ''}
                placeholder={copy('publicUrlPlaceholder', 'https://customers.example.com')}
                onChange={(event) => setDraft('customer_portal_public_url', event.target.value)}
              />
              <p className="mt-2 text-xs text-slate-500">{copy('publicUrlHint', 'Use a different public domain or Funnel URL here when you publish the customer portal outside the admin link.')}</p>
            </div>
            <label className="mt-3 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div>
                <div className="text-sm font-medium text-slate-700">{copy('translateWidget', 'Enable public translate widget')}</div>
                <div className="mt-1 text-xs text-slate-500">{copy('translateWidgetHint', 'Public customers switch English/Khmer instantly. External languages use Google only as a fallback.')}</div>
              </div>
              <input id="portal-translate-widget-enabled" name="customer_portal_translate_widget_enabled" type="checkbox" checked={!!editorDraft.customer_portal_translate_widget_enabled} onChange={(event) => setDraft('customer_portal_translate_widget_enabled', event.target.checked)} />
            </label>
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
              <label htmlFor="portal-translations-json" className="block text-sm font-medium text-slate-700">{copy('translationOverrides', 'Dynamic content translations')}</label>
              <p className="mt-1 text-xs text-slate-500">
                {copy('translationOverridesHint', 'Optional JSON for About, FAQ, assistant, submission, social labels, and product description translations. Business name, short tagline, and portal intro stay original.')}
              </p>
              <textarea
                id="portal-translations-json"
                name="customer_portal_translations"
                className="input mt-3 min-h-[160px] resize-y font-mono text-xs"
                spellCheck={false}
                value={editorDraft.customer_portal_translations || '{}'}
                onChange={(event) => setDraft('customer_portal_translations', event.target.value)}
              />
              <details className="mt-2 text-xs text-slate-500">
                <summary className="cursor-pointer font-semibold text-slate-600">{copy('translationOverridesExample', 'Example format')}</summary>
                <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-50 p-3 text-[11px] leading-5 text-slate-600">{`{
  "zh-CN": {
    "aboutTitle": "关于我们",
    "promotionsTitle": "精选优惠",
    "aboutBlocks": {
      "block-id": { "title": "标题", "body": "内容" }
    },
    "promoItems": {
      "promo-id": { "title": "优惠标题", "body": "优惠内容", "ctaLabel": "立即查看" }
    },
    "faqItems": {
      "faq-id": { "question": "问题", "answer": "答案" }
    },
    "products": {
      "123": { "description": "产品说明" }
    }
  }
}`}</pre>
              </details>
            </div>
            <a className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-sky-700 hover:text-sky-800" href={publicPortalUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              {copy('openEmbeddedPreview', 'Open public preview')}
            </a>
          </div>

          <div id="portal-section-branding" className={activeEditorSection === 'branding' ? 'grid gap-4' : 'hidden'}>
            <div>
              <label htmlFor="portal-business-name" className="block text-sm font-medium text-slate-700">{copy('businessName', 'Business name')}</label>
              <input id="portal-business-name" name="business_name" autoComplete="organization" className="input" value={editorDraft.business_name || ''} onChange={(event) => setDraft('business_name', event.target.value)} />
            </div>
            <div>
              <label htmlFor="portal-business-tagline" className="block text-sm font-medium text-slate-700">{copy('businessTagline', 'Short tagline')}</label>
              <input id="portal-business-tagline" name="customer_portal_business_tagline" autoComplete="off" className="input" value={editorDraft.customer_portal_business_tagline || ''} onChange={(event) => setDraft('customer_portal_business_tagline', event.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="portal-business-phone" className="block text-sm font-medium text-slate-700">{copy('phone', 'Phone')}</label>
                <input id="portal-business-phone" name="business_phone" autoComplete="tel" className="input" value={editorDraft.business_phone || ''} onChange={(event) => setDraft('business_phone', event.target.value)} />
              </div>
              <div>
                <label htmlFor="portal-business-email" className="block text-sm font-medium text-slate-700">{copy('email', 'Email')}</label>
                <input id="portal-business-email" name="business_email" autoComplete="email" className="input" value={editorDraft.business_email || ''} onChange={(event) => setDraft('business_email', event.target.value)} />
              </div>
            </div>
            <div>
              <label htmlFor="portal-business-address" className="block text-sm font-medium text-slate-700">{copy('address', 'Address')}</label>
              <textarea id="portal-business-address" name="business_address" autoComplete="street-address" className="input resize-none" rows={2} value={editorDraft.business_address || ''} onChange={(event) => setDraft('business_address', event.target.value)} />
            </div>
            <div>
              <label htmlFor="portal-address-link" className="block text-sm font-medium text-slate-700">{copy('addressLink', 'Address link')}</label>
              <input
                id="portal-address-link"
                name="customer_portal_address_link"
                autoComplete="url"
                className="input"
                placeholder="https://maps.google.com/..."
                value={editorDraft.customer_portal_address_link || ''}
                onChange={(event) => setDraft('customer_portal_address_link', event.target.value)}
              />
              <p className="mt-2 text-xs text-slate-500">{copy('addressLinkHint', 'Optional external map or directions link opened when customers tap the address.')}</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 text-sm font-semibold text-slate-900">{copy('contactVisibility', 'Contact visibility')}</div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-phone">
                  <span className="text-sm text-slate-700">{copy('showPhone', 'Show phone')}</span>
                  <input id="portal-show-phone" name="customer_portal_show_phone" type="checkbox" checked={!!editorDraft.customer_portal_show_phone} onChange={(event) => setDraft('customer_portal_show_phone', event.target.checked)} />
                </label>
                <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-email">
                  <span className="text-sm text-slate-700">{copy('showEmail', 'Show email')}</span>
                  <input id="portal-show-email" name="customer_portal_show_email" type="checkbox" checked={!!editorDraft.customer_portal_show_email} onChange={(event) => setDraft('customer_portal_show_email', event.target.checked)} />
                </label>
                <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-address">
                  <span className="text-sm text-slate-700">{copy('showAddress', 'Show address')}</span>
                  <input id="portal-show-address" name="customer_portal_show_address" type="checkbox" checked={!!editorDraft.customer_portal_show_address} onChange={(event) => setDraft('customer_portal_show_address', event.target.checked)} />
                </label>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label htmlFor="portal-intro" className="block text-sm font-medium text-slate-700">{copy('portalIntro', 'Portal intro')}</label>
                  <textarea id="portal-intro" name="customer_portal_intro" autoComplete="off" className="input resize-none" rows={3} value={editorDraft.customer_portal_intro || ''} onChange={(event) => setDraft('customer_portal_intro', event.target.value)} />
                </div>
                <div>
                  <label htmlFor="portal-language" className="block text-sm font-medium text-slate-700">{copy('language', 'Portal language')}</label>
                  <select id="portal-language" name="customer_portal_language" className="input" value={editorDraft.customer_portal_language || 'auto'} onChange={(event) => setDraft('customer_portal_language', event.target.value)}>
                    <option value="auto">{copy('followApp', 'English (default source)')}</option>
                    <option value="en">{copy('english', 'English')}</option>
                    <option value="km">{copy('khmer', 'Khmer')}</option>
                  </select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="portal-website" className="block text-sm font-medium text-slate-700">{copy('website', 'Website')}</label>
                    <input id="portal-website" name="customer_portal_website" autoComplete="url" className="input" value={editorDraft.customer_portal_website || ''} onChange={(event) => setDraft('customer_portal_website', event.target.value)} />
                    <input id="portal-website-label" name="customer_portal_website_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_website_label || ''} onChange={(event) => setDraft('customer_portal_website_label', event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="portal-facebook" className="block text-sm font-medium text-slate-700">{copy('facebook', 'Facebook')}</label>
                    <input id="portal-facebook" name="customer_portal_facebook" autoComplete="url" className="input" value={editorDraft.customer_portal_facebook || ''} onChange={(event) => setDraft('customer_portal_facebook', event.target.value)} />
                    <input id="portal-facebook-label" name="customer_portal_facebook_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_facebook_label || ''} onChange={(event) => setDraft('customer_portal_facebook_label', event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="portal-instagram" className="block text-sm font-medium text-slate-700">{copy('instagram', 'Instagram')}</label>
                    <input id="portal-instagram" name="customer_portal_instagram" autoComplete="url" className="input" value={editorDraft.customer_portal_instagram || ''} onChange={(event) => setDraft('customer_portal_instagram', event.target.value)} />
                    <input id="portal-instagram-label" name="customer_portal_instagram_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_instagram_label || ''} onChange={(event) => setDraft('customer_portal_instagram_label', event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="portal-telegram" className="block text-sm font-medium text-slate-700">{copy('telegram', 'Telegram')}</label>
                    <input id="portal-telegram" name="customer_portal_telegram" autoComplete="url" className="input" value={editorDraft.customer_portal_telegram || ''} onChange={(event) => setDraft('customer_portal_telegram', event.target.value)} />
                    <input id="portal-telegram-label" name="customer_portal_telegram_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_telegram_label || ''} onChange={(event) => setDraft('customer_portal_telegram_label', event.target.value)} />
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-3 text-sm font-semibold text-slate-900">{copy('socialVisibility', 'Social visibility')}</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-website">
                      <span className="text-sm text-slate-700">{copy('showWebsite', 'Show website')}</span>
                      <input id="portal-show-website" name="customer_portal_show_website" type="checkbox" checked={!!editorDraft.customer_portal_show_website} onChange={(event) => setDraft('customer_portal_show_website', event.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-facebook">
                      <span className="text-sm text-slate-700">{copy('showFacebook', 'Show Facebook')}</span>
                      <input id="portal-show-facebook" name="customer_portal_show_facebook" type="checkbox" checked={!!editorDraft.customer_portal_show_facebook} onChange={(event) => setDraft('customer_portal_show_facebook', event.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-instagram">
                      <span className="text-sm text-slate-700">{copy('showInstagram', 'Show Instagram')}</span>
                      <input id="portal-show-instagram" name="customer_portal_show_instagram" type="checkbox" checked={!!editorDraft.customer_portal_show_instagram} onChange={(event) => setDraft('customer_portal_show_instagram', event.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-telegram">
                      <span className="text-sm text-slate-700">{copy('showTelegram', 'Show Telegram')}</span>
                      <input id="portal-show-telegram" name="customer_portal_show_telegram" type="checkbox" checked={!!editorDraft.customer_portal_show_telegram} onChange={(event) => setDraft('customer_portal_show_telegram', event.target.checked)} />
                    </label>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 text-sm font-semibold text-slate-900">{copy('mapEmbed', 'Google map embed URL')}</div>
                <label htmlFor="portal-google-map-embed" className="sr-only">{copy('mapEmbed', 'Google map embed URL')}</label>
                <textarea
                  id="portal-google-map-embed"
                  name="customer_portal_google_maps_embed"
                  autoComplete="off"
                  className="input resize-none"
                  rows={4}
                  value={editorDraft.customer_portal_google_maps_embed || ''}
                  placeholder="<iframe src='https://www.google.com/maps/embed?...'></iframe>"
                  onChange={(event) => setDraft('customer_portal_google_maps_embed', event.target.value)}
                />
                <p className="mt-2 text-xs text-slate-500">{copy('mapEmbedHint', 'Paste a Google Maps link or embed URL. The portal will render it as an interactive map card.')}</p>
                <label className="mt-3 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-google-map">
                  <span className="text-sm text-slate-700">{copy('showGoogleMap', 'Show Google map')}</span>
                  <input id="portal-show-google-map" name="customer_portal_show_google_map" type="checkbox" checked={!!editorDraft.customer_portal_show_google_map} onChange={(event) => setDraft('customer_portal_show_google_map', event.target.checked)} />
                </label>
                {draftMapEmbedUrl ? (
                  <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                    <iframe title="portal-map-preview" src={draftMapEmbedUrl} className="h-48 w-full border-0" loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div id="portal-section-media" className={activeEditorSection === 'media' ? 'grid min-w-0 gap-4 2xl:grid-cols-2' : 'hidden'}>
            <ImageField
              label={copy('logoImage', 'Logo image')}
              value={editorDraft.customer_portal_logo_image}
              fieldId="portal-logo-image"
              onUpload={() => uploadDraftImage('customer_portal_logo_image')}
              onCancelUpload={() => cancelPortalMediaUpload('customer_portal_logo_image')}
              onChooseExisting={() => openFilePicker('customer_portal_logo_image', 'image', copy('logoImage', 'Logo image'))}
              onChange={(value) => setDraft('customer_portal_logo_image', value)}
              onClear={() => clearPortalMediaTarget('customer_portal_logo_image')}
              onPreview={() => openPortalImage(copy('logoImage', 'Logo image'), [editorDraft.customer_portal_logo_image])}
              uploadLabel={copy('uploadImage', 'Upload image')}
              chooseLabel={copy('openFiles', 'Files')}
              clearLabel={copy('clearImage', 'Clear')}
              previewLabel={copy('openGallery', 'Open image gallery')}
              hint={copy('portalImageUploadHint', 'Upload stores a short file path, so portal settings stay clean.')}
              cancelLabel={copy('cancelUpload', 'Cancel upload')}
              uploadingLabel={copy('uploading', 'Uploading...')}
              uploadedQueuedLabel={copy('portalUploadQueued', 'Uploaded. Background optimization is running now.')}
              uploadedReadyLabel={copy('portalUploadReady', 'Uploaded and ready.')}
              uploadState={getMediaUploadState('customer_portal_logo_image')}
            />
            <ImageField
              label={copy('faviconImage', 'Browser tab icon')}
              value={editorDraft.customer_portal_favicon_image}
              fieldId="portal-favicon-image"
              onUpload={() => uploadDraftImage('customer_portal_favicon_image')}
              onCancelUpload={() => cancelPortalMediaUpload('customer_portal_favicon_image')}
              onChooseExisting={() => openFilePicker('customer_portal_favicon_image', 'image', copy('faviconImage', 'Browser tab icon'))}
              onChange={(value) => setDraft('customer_portal_favicon_image', value)}
              onClear={() => clearPortalMediaTarget('customer_portal_favicon_image')}
              onPreview={() => openPortalImage(copy('faviconImage', 'Browser tab icon'), [editorDraft.customer_portal_favicon_image])}
              uploadLabel={copy('uploadImage', 'Upload image')}
              chooseLabel={copy('openFiles', 'Files')}
              clearLabel={copy('clearImage', 'Clear')}
              previewLabel={copy('openGallery', 'Open image gallery')}
              hint={copy('faviconHint', 'Shown in browser tabs and saved shortcuts. If empty, the circular logo is used automatically.')}
              cancelLabel={copy('cancelUpload', 'Cancel upload')}
              uploadingLabel={copy('uploading', 'Uploading...')}
              uploadedQueuedLabel={copy('portalUploadQueued', 'Uploaded. Background optimization is running now.')}
              uploadedReadyLabel={copy('portalUploadReady', 'Uploaded and ready.')}
              uploadState={getMediaUploadState('customer_portal_favicon_image')}
            />
            <div className="grid min-w-0 gap-4">
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" htmlFor="portal-show-logo">
                <span className="text-sm font-medium text-slate-700">{copy('showLogo', 'Show logo')}</span>
                <input id="portal-show-logo" name="customer_portal_show_logo" type="checkbox" checked={!!editorDraft.customer_portal_show_logo} onChange={(event) => setDraft('customer_portal_show_logo', event.target.checked)} />
              </label>
              <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-slate-700">{copy('logoSize', 'Logo size')}</span>
                <input
                  id="portal-logo-size"
                  name="customer_portal_logo_size"
                  className="mt-2 w-full accent-slate-950"
                  type="range"
                  min="48"
                  max="144"
                  step="4"
                  value={editorDraft.customer_portal_logo_size || '80'}
                  onChange={(event) => setDraft('customer_portal_logo_size', event.target.value)}
                />
                <span className="mt-1 block text-xs text-slate-500">{editorDraft.customer_portal_logo_size || '80'}px</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">{copy('logoFit', 'Logo fit')}</span>
                <select
                  id="portal-logo-fit"
                  name="customer_portal_logo_fit"
                  className="input mt-2"
                  value={editorDraft.customer_portal_logo_fit || 'cover'}
                  onChange={(event) => setDraft('customer_portal_logo_fit', event.target.value)}
                >
                  <option value="contain">{copy('fitContain', 'Fit inside')}</option>
                  <option value="cover">{copy('fitCover', 'Fill frame')}</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">{copy('logoZoom', 'Logo zoom')}</span>
                <input
                  id="portal-logo-zoom"
                  name="customer_portal_logo_zoom"
                  className="mt-2 w-full accent-slate-950"
                  type="range"
                  min="80"
                  max="180"
                  step="5"
                  value={editorDraft.customer_portal_logo_zoom || '100'}
                  onChange={(event) => setDraft('customer_portal_logo_zoom', event.target.value)}
                />
                <span className="mt-1 block text-xs text-slate-500">{editorDraft.customer_portal_logo_zoom || '100'}%</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">{copy('logoPositionX', 'Horizontal position')}</span>
                <input
                  id="portal-logo-position-x"
                  name="customer_portal_logo_position_x"
                  className="mt-2 w-full accent-slate-950"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={editorDraft.customer_portal_logo_position_x || '50'}
                  onChange={(event) => setDraft('customer_portal_logo_position_x', event.target.value)}
                />
                <span className="mt-1 block text-xs text-slate-500">{editorDraft.customer_portal_logo_position_x || '50'}%</span>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">{copy('logoPositionY', 'Vertical position')}</span>
                <input
                  id="portal-logo-position-y"
                  name="customer_portal_logo_position_y"
                  className="mt-2 w-full accent-slate-950"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={editorDraft.customer_portal_logo_position_y || '50'}
                  onChange={(event) => setDraft('customer_portal_logo_position_y', event.target.value)}
                />
                <span className="mt-1 block text-xs text-slate-500">{editorDraft.customer_portal_logo_position_y || '50'}%</span>
              </label>
              </div>
              {editorDraft.customer_portal_logo_image ? (
                <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{copy('logoPreview', 'Logo preview')}</div>
                  <div
                    className="mt-3 rounded-[28px] p-4 text-white"
                    style={{
                      backgroundImage: `linear-gradient(135deg, ${normalizeHexColor(editorDraft.customer_portal_hero_gradient_start, '#0f172a')} 0%, ${normalizeHexColor(editorDraft.customer_portal_hero_gradient_mid, '#14532d')} 50%, ${normalizeHexColor(editorDraft.customer_portal_hero_gradient_end, '#ea580c')} 100%)`,
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className="flex items-center justify-center overflow-hidden rounded-full border border-white/25 bg-white shadow-lg"
                        style={{
                          height: `${Math.min(128, Math.max(48, toNumber(editorDraft.customer_portal_logo_size, 80)))}px`,
                          width: `${Math.min(128, Math.max(48, toNumber(editorDraft.customer_portal_logo_size, 80)))}px`,
                        }}
                      >
                        <img
                          src={editorDraft.customer_portal_logo_image}
                          alt={copy('logoImage', 'Logo image')}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full"
                          style={{
                            objectFit: editorDraft.customer_portal_logo_fit === 'cover' ? 'cover' : 'contain',
                            objectPosition: `${editorDraft.customer_portal_logo_position_x || '50'}% ${editorDraft.customer_portal_logo_position_y || '50'}%`,
                            transform: `scale(${Math.max(0.8, Math.min(1.8, (toNumber(editorDraft.customer_portal_logo_zoom, 100) || 100) / 100))})`,
                            transformOrigin: 'center',
                          }}
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{editorDraft.business_name || previewConfig.businessName || 'Business OS'}</div>
                        <div className="mt-1 text-xs text-white/80">{editorDraft.customer_portal_business_tagline || previewConfig.businessTagline || 'Preview the circular logo frame on the live header.'}</div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <ImageField
              label={copy('coverImage', 'Cover image')}
              value={editorDraft.customer_portal_cover_image}
              fieldId="portal-cover-image"
              onUpload={() => uploadDraftImage('customer_portal_cover_image')}
              onCancelUpload={() => cancelPortalMediaUpload('customer_portal_cover_image')}
              onChooseExisting={() => openFilePicker('customer_portal_cover_image', 'image', copy('coverImage', 'Cover image'))}
              onChange={(value) => setDraft('customer_portal_cover_image', value)}
              onClear={() => clearPortalMediaTarget('customer_portal_cover_image')}
              onPreview={() => openPortalImage(copy('coverImage', 'Cover image'), [editorDraft.customer_portal_cover_image])}
              uploadLabel={copy('uploadImage', 'Upload image')}
              chooseLabel={copy('openFiles', 'Files')}
              clearLabel={copy('clearImage', 'Clear')}
              previewLabel={copy('openGallery', 'Open image gallery')}
              hint={copy('portalImageUploadHint', 'Upload stores a short file path, so portal settings stay clean.')}
              cancelLabel={copy('cancelUpload', 'Cancel upload')}
              uploadingLabel={copy('uploading', 'Uploading...')}
              uploadedQueuedLabel={copy('portalUploadQueued', 'Uploaded. Background optimization is running now.')}
              uploadedReadyLabel={copy('portalUploadReady', 'Uploaded and ready.')}
              uploadState={getMediaUploadState('customer_portal_cover_image')}
            />
            <label className="xl:col-span-2 mt-1 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" htmlFor="portal-show-cover">
              <span className="text-sm font-medium text-slate-700">{copy('showCover', 'Show cover image')}</span>
              <input id="portal-show-cover" name="customer_portal_show_cover" type="checkbox" checked={!!editorDraft.customer_portal_show_cover} onChange={(event) => setDraft('customer_portal_show_cover', event.target.checked)} />
            </label>
          </div>

          <div id="portal-section-submissions" className={activeEditorSection === 'submissions' ? 'grid gap-4' : 'hidden'}>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">{copy('portalCatalogSettings', 'Catalog settings')}</div>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="portal-stock-threshold-mode" className="block text-sm font-medium text-slate-700">{copy('stockThresholdMode', 'Stock badge mode')}</label>
                  <select id="portal-stock-threshold-mode" name="customer_portal_stock_threshold_mode" className="input" value={editorDraft.customer_portal_stock_threshold_mode || 'product'} onChange={(event) => setDraft('customer_portal_stock_threshold_mode', event.target.value)}>
                    <option value="product">{copy('stockThresholdModeProduct', 'Use each product threshold')}</option>
                    <option value="global">{copy('stockThresholdModeGlobal', 'Use portal-wide thresholds')}</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="portal-low-stock-threshold" className="block text-sm font-medium text-slate-700">{copy('lowStockThreshold', 'Low stock threshold')}</label>
                  <input id="portal-low-stock-threshold" name="customer_portal_low_stock_threshold" className="input" type="number" min="0" step="0.01" value={editorDraft.customer_portal_low_stock_threshold || '10'} onChange={(event) => setDraft('customer_portal_low_stock_threshold', event.target.value)} />
                </div>
                <div>
                  <label htmlFor="portal-out-stock-threshold" className="block text-sm font-medium text-slate-700">{copy('outOfStockThreshold', 'Out of stock threshold')}</label>
                  <input id="portal-out-stock-threshold" name="customer_portal_out_of_stock_threshold" className="input" type="number" min="0" step="0.01" value={editorDraft.customer_portal_out_of_stock_threshold || '0'} onChange={(event) => setDraft('customer_portal_out_of_stock_threshold', event.target.value)} />
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">{copy('stockThresholdHint', 'Global thresholds override the product-level stock badges on the customer portal only.')}</p>
            </div>

            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <div className="text-sm font-semibold text-sky-900">{copy('portalMembershipSettings', 'Membership settings')}</div>
              <p className="mt-2 text-sm text-sky-800">
                {copy('pointsPageHint', 'Point earning rules, redemption values, customer point notes, and reward-point defaults are managed in Loyalty Points so this portal page can stay focused on customer-facing content.')}
              </p>
                <button type="button" className="btn-secondary mt-3 text-sm" onClick={() => navigateTo('loyalty_points')}>
                  {copy('openPointsPage', 'Open Loyalty Points', 'បើកទំព័រពិន្ទុស្មោះត្រង់')}
                </button>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm font-semibold text-slate-900">{copy('portalSubmissionSettings', 'Submission settings')}</div>
              <div className="mt-4 grid gap-4">
                <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                  <span className="text-sm font-medium text-slate-700">{copy('submissionFeature', 'Enable share submissions')}</span>
                  <input id="portal-submission-enabled" name="customer_portal_submission_enabled" type="checkbox" checked={!!editorDraft.customer_portal_submission_enabled} onChange={(event) => setDraft('customer_portal_submission_enabled', event.target.checked)} />
                </label>
                <div>
                  <label htmlFor="portal-submission-instructions" className="block text-sm font-medium text-slate-700">{copy('submissionInstructions', 'Submission instructions')}</label>
                  <textarea id="portal-submission-instructions" name="customer_portal_submission_instructions" autoComplete="off" className="input mt-1 resize-none" rows={4} value={editorDraft.customer_portal_submission_instructions || ''} onChange={(event) => setDraft('customer_portal_submission_instructions', event.target.value)} />
                  <p className="mt-1 text-xs text-slate-500">{copy('submissionInstructionsHint', 'Customers can only submit screenshots. Staff reviews and awards points inside Business OS.')}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SectionShell>

      <div className={activeEditorSection === 'submissions' ? '' : 'hidden'}>
      <SectionShell title={copy('reviewQueue', 'Review queue')} subtitle={copy('reviewQueueHint', 'Approve, reject, and award points for customer share submissions.')}>
        <div className="space-y-4">
          {reviewItems.length ? reviewItems.map((item) => (
            <article key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{item.customer_name || item.membership_number || `#${item.id}`}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.membership_number || '-'}{item.platform ? ` • ${item.platform}` : ''}</div>
                </div>
                <div className="text-xs font-semibold text-slate-500">{formatDateTime(item.created_at)}</div>
              </div>
              {item.note ? <p className="mt-3 text-sm text-slate-700">{item.note}</p> : null}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {(item.screenshots || []).map((image, index) => (
                  <button
                    key={`${item.id}-${index}`}
                    type="button"
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white"
                    onClick={() => openPortalImage(item.customer_name || item.membership_number || `#${item.id}`, item.screenshots || [], index)}
                  >
                    <img src={image} alt={`review-${item.id}-${index + 1}`} className="h-28 w-full object-cover" />
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-3">
                <div>
                  <label htmlFor={`portal-review-reward-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('rewardPoints', 'Reward points')}</label>
                  <input
                    id={`portal-review-reward-${item.id}`}
                    name={`portal_review_reward_${item.id}`}
                    className="input"
                    type="number"
                    min="0"
                    step="1"
                    value={item.reward_points || 0}
                    onChange={(event) => setReviewItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, reward_points: event.target.value } : entry))}
                  />
                </div>
                <div>
                  <label htmlFor={`portal-review-note-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('shareReviewNote', 'Review note')}</label>
                  <textarea
                    id={`portal-review-note-${item.id}`}
                    name={`portal_review_note_${item.id}`}
                    className="input resize-none"
                    rows={3}
                    value={item.review_note || ''}
                    placeholder={copy('reviewNotePlaceholder', 'Internal review note')}
                    onChange={(event) => setReviewItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, review_note: event.target.value } : entry))}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className="btn-primary text-sm" disabled={reviewSavingId === item.id} onClick={() => handleReviewSubmission(item, 'approved')}>
                    {copy('approve', 'Approve')}
                  </button>
                  <button className="btn-secondary text-sm" disabled={reviewSavingId === item.id} onClick={() => handleReviewSubmission(item, 'rejected')}>
                    {copy('reject', 'Reject')}
                  </button>
                  <button className="btn-secondary text-sm" disabled={reviewSavingId === item.id} onClick={() => handleReviewSubmission(item, 'pending')}>
                    {copy('pending', 'Pending')}
                  </button>
                </div>
              </div>
            </article>
          )) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              {copy('noSubmissions', 'No share submissions yet.')}
            </div>
          )}
        </div>
      </SectionShell>
      </div>
    </aside>
  )
}
