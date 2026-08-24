import Bot from 'lucide-react/dist/esm/icons/bot.js'
import ExternalLink from 'lucide-react/dist/esm/icons/external-link.js'
import Eye from 'lucide-react/dist/esm/icons/eye.js'
import Facebook from 'lucide-react/dist/esm/icons/facebook.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import Images from 'lucide-react/dist/esm/icons/images.js'
import Instagram from 'lucide-react/dist/esm/icons/instagram.js'
import PhoneCall from 'lucide-react/dist/esm/icons/phone-call.js'
import Smartphone from 'lucide-react/dist/esm/icons/smartphone.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import Save from 'lucide-react/dist/esm/icons/save.js'
import Search from 'lucide-react/dist/esm/icons/search.js'
import Send from 'lucide-react/dist/esm/icons/send.js'
import ShoppingBag from 'lucide-react/dist/esm/icons/shopping-bag.js'
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.js'
import Upload from 'lucide-react/dist/esm/icons/upload.js'
import { Suspense, useState, type RefObject } from 'react'
import { ProductImg } from '../products/shared/primitives'
import AppSelect, { type AppSelectOption } from '../shared/AppSelect.tsx'
import { MessengerIcon } from '../shared/BrandIcons.tsx'
import ButtonGuidePopover from '../shared/ButtonGuidePopover'
import { CatalogPageProvider, useCatalogPageContext } from './CatalogPageContext'
import ImageField from './CatalogImageField'
import { SectionShell } from './catalogUi'
import type { createInitialUploadState } from '../../utils/mediaUpload.ts'
import { lazyRetry } from '../../utils/lazyImport.ts'

const ManageAnnouncementStripModal = lazyRetry(() => import('./ManagePromotionsModal'), 'catalog-editor-announcement-strip-modal')

type CatalogUploadState = ReturnType<typeof createInitialUploadState>
type DraftPrimitive = string | number | boolean | null | undefined
type DraftUpdateValue = string | number | boolean | null
type EditorSectionKey = string
type EditorSection = readonly [string, EditorSectionKey, string]

type CatalogEditorDraft = Record<string, DraftPrimitive> & {
  business_address?: string
  business_email?: string
  business_name?: string
  business_phone?: string
  customer_portal_about_content?: string
  customer_portal_about_title?: string
  customer_portal_product_caution_default?: string
  customer_portal_product_need_more_details_default?: string
  customer_portal_address_link?: string
  customer_portal_ai_disclaimer?: string
  customer_portal_ai_intro?: string
  customer_portal_ai_prompt?: string
  customer_portal_ai_provider_id?: string | number
  customer_portal_ai_title?: string
  customer_portal_business_tagline?: string
  customer_portal_contact_messenger?: string
  customer_portal_contact_messenger_label?: string
  customer_portal_contact_telegram?: string
  customer_portal_contact_telegram_label?: string
  customer_portal_contact_instagram?: string
  customer_portal_contact_instagram_label?: string
  customer_portal_show_contact_instagram?: boolean
  customer_portal_contact_phone?: string
  customer_portal_contact_phone_label?: string
  customer_portal_contact_whatsapp?: string
  customer_portal_contact_whatsapp_label?: string
  customer_portal_cover_image?: string | null
  customer_portal_facebook?: string
  customer_portal_facebook_label?: string
  customer_portal_faq_title?: string
  customer_portal_favicon_image?: string | null
  customer_portal_google_maps_embed?: string
  customer_portal_grid_columns_desktop?: string | number
  customer_portal_grid_columns_mobile?: string | number
  customer_portal_hero_gradient_end?: string
  customer_portal_hero_gradient_mid?: string
  customer_portal_hero_gradient_start?: string
  customer_portal_highlight_rank_limit?: string | number
  customer_portal_instagram?: string
  customer_portal_instagram_label?: string
  customer_portal_intro?: string
  customer_portal_language?: string
  customer_portal_logo_fit?: string
  customer_portal_logo_image?: string | null
  customer_portal_logo_position_x?: string | number
  customer_portal_logo_position_y?: string | number
  customer_portal_logo_size?: string | number
  customer_portal_logo_zoom?: string | number
  customer_portal_low_stock_threshold?: string | number
  customer_portal_out_of_stock_threshold?: string | number
  customer_portal_path?: string
  customer_portal_price_display?: string
  customer_portal_promotions_intro?: string
  customer_portal_promotions_title?: string
  customer_portal_public_url?: string
  customer_portal_refresh_seconds?: string | number
  customer_portal_stock_threshold_mode?: string
  customer_portal_submission_instructions?: string
  customer_portal_telegram?: string
  customer_portal_telegram_label?: string
  customer_portal_translations?: string
  customer_portal_website?: string
  customer_portal_website_label?: string
}

type CatalogProductOption = {
  id: number
  image?: string | null
  name?: string | null
  subtitle?: string | null
}

type CatalogPromoItem = {
  id: string
  body?: string
  ctaLabel?: string
  eyebrow?: string
  linkUrl?: string
  linkProductId?: string
  linkProductName?: string
  mediaUrl?: string | null
  subtitle?: string
  title?: string
}

type CatalogAboutBlock = {
  id: string
  body?: string
  mediaUrl?: string | null
  title?: string
  type?: string
}

type CatalogFaqItem = {
  id: string
  answer?: string
  question?: string
}

type CatalogAiProvider = {
  default_model?: string | null
  id: string | number
  name?: string | null
  provider?: string | null
  provider_label?: string | null
}

function toAiProviderOptions(
  aiProviders: CatalogAiProvider[],
  autoLabel: string,
  noModelLabel: string,
): AppSelectOption[] {
  return [
    { value: '', label: autoLabel },
    ...aiProviders.map((provider) => ({
      value: String(provider.id),
      label: `${provider.name || provider.provider_label || provider.provider || provider.id} | ${provider.provider_label || provider.provider || 'Provider'} | ${provider.default_model || noModelLabel}`,
    })),
  ]
}



type CatalogPreviewConfig = {
  businessName?: string
  businessTagline?: string
}

type CatalogEditorSurfaceContext = {
  aboutBlocks: CatalogAboutBlock[]
  activeEditorSection: EditorSectionKey
  addAboutBlock: (type: string) => void
  addAiFaqStarterSet: () => void
  addFaqItem: () => void
  addFaqStarterSet: () => void
  addPromoItem: () => void
  aiProviders: CatalogAiProvider[]
  cancelPortalMediaUpload: (target: string) => void
  clearPortalMediaTarget: (target: string) => void
  copy: (key: string, fallback?: string, khmerFallback?: string) => string
  draftMapEmbedUrl: string
  dragAboutBlockId: string | null
  dragPromoItemId: string | null
  editorDirty: boolean
  editorDraft: CatalogEditorDraft
  editorSaving: boolean
  editorSections: EditorSection[]
  faqItems: CatalogFaqItem[]
  generatedPublicUrl: string
  getAboutBlockLabel: (type?: string) => string
  getMediaUploadState: (target: string) => CatalogUploadState
  moveAboutBlockBefore: (dragId: string | null, targetId: string) => void
  movePromoItemBefore: (dragId: string | null, targetId: string) => void
  navigateTo: (page: string) => void
  normalizeHexColor: (value: DraftPrimitive, fallback: string) => string
  openFilePicker: (target: string, type: string, label: string) => void
  openPortalImage: (title: string, images: Array<string | null | undefined>, startIndex?: number) => void
  previewConfig: CatalogPreviewConfig
  previewSectionRef: RefObject<HTMLElement>
  products: unknown[]
  promoItems: CatalogPromoItem[]
  publicPortalUrl: string
  recommendedProductIds: number[]
  recommendedProductOptions: CatalogProductOption[]
  recommendedProductSearchInput: string
  recommendedProductSearchTerm: string
  removeAboutBlock: (id: string) => void
  removeFaqItem: (id: string) => void
  removePromoItem: (id: string) => void
  savePortalDraft: () => void
  selectedRecommendedProductOptions: CatalogProductOption[]
  setActiveEditorSection: (section: EditorSectionKey) => void
  setDraft: (key: string, value: DraftUpdateValue) => void
  setDragAboutBlockId: (id: string | null) => void
  setDragPromoItemId: (id: string | null) => void
  setRecommendedProductSearchInput: (value: string) => void
  setRecommendedProductSearchTerm: (value: string) => void
  toNumber: (value: DraftPrimitive, fallback?: number) => number
  toggleRecommendedProduct: (id: number) => void
  updateAboutBlock: (id: string, key: keyof CatalogAboutBlock, value: string) => void
  updateFaqItem: (id: string, key: keyof CatalogFaqItem, value: string) => void
  updatePromoItem: (id: string, key: keyof CatalogPromoItem, value: string) => void
  uploadAboutBlockMedia: (id: string) => void
  uploadDraftImage: (target: string) => void
  uploadPromoItemMedia: (id: string) => void
}

type CatalogEditorSurfaceProps = {
  contextValue: unknown
}

export default function CatalogEditorSurface({ contextValue }: CatalogEditorSurfaceProps) {
  return (
    <CatalogPageProvider value={contextValue}>
      <CatalogEditorSurfaceContent />
    </CatalogPageProvider>
  )
}

function CatalogEditorSurfaceContent() {
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
    generatedPublicUrl,
    getAboutBlockLabel,
    getMediaUploadState,
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
    savePortalDraft,
    selectedRecommendedProductOptions,
    setActiveEditorSection,
    setDraft,
    setDragAboutBlockId,
    setDragPromoItemId,
    setRecommendedProductSearchInput,
    setRecommendedProductSearchTerm,
    toNumber,
    toggleRecommendedProduct,
    updateAboutBlock,
    updateFaqItem,
    updatePromoItem,
    uploadAboutBlockMedia,
    uploadDraftImage,
    uploadPromoItemMedia,
  } = useCatalogPageContext<CatalogEditorSurfaceContext>()
  const [showAnnouncementStripModal, setShowAnnouncementStripModal] = useState(false)

  return (
    <aside id="portal-editor-top" className="min-h-0 max-w-full space-y-5 overflow-x-hidden">
      <div className="sticky top-0 z-30 -mx-4 rounded-none border-y border-slate-200 bg-white/95 px-3 py-2 shadow-md backdrop-blur dark:border-slate-700 dark:bg-slate-950/95 sm:top-2 sm:mx-0 sm:rounded-2xl sm:border">
        <div className="flex min-w-0 flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 flex-nowrap gap-1 overflow-x-auto pb-1 xl:pb-0">
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
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex sm:justify-end">
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
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{copy('displayVisibilityGroup', 'Catalog & page visibility')}</div>
            <div className="grid gap-3">
              <label className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="text-sm font-medium text-slate-700">{copy('showCatalog', 'Show product catalog')}</span>
                <input id="portal-show-catalog" name="customer_portal_show_catalog" type="checkbox" checked={!!editorDraft.customer_portal_show_catalog} onChange={(event) => setDraft('customer_portal_show_catalog', event.target.checked)} />
              </label>
              <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <div>
                  <div className="text-sm font-medium text-slate-700">{copy('announcementStrip', 'Announcement strip')}</div>
                  <div className="text-xs text-slate-500">{copy('announcementStripHint', 'Small horizontally-scrolling cards at the very top of the page — separate from the Promotions and posts cards below')}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAnnouncementStripModal(true)}
                  className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {copy('manage', 'Manage')}
                </button>
              </div>
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
                <div>
                  <span className="text-sm font-medium text-slate-700">{copy('showStockStatus', 'Show stock status')}</span>
                  <div className="text-xs text-slate-500">{copy('showStockStatusHint', 'The In Stock / Low Stock / Out of Stock badge on each product, and the matching filter above the catalog. Turning this off hides both.')}</div>
                </div>
                <input id="portal-show-stock-status" name="customer_portal_show_stock_status" type="checkbox" checked={editorDraft.customer_portal_show_stock_status !== false} onChange={(event) => setDraft('customer_portal_show_stock_status', event.target.checked)} />
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
            <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{copy('displayLayoutGroup', 'Layout & pricing')}</div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="portal-price-display" className="block text-sm font-medium text-slate-700">{copy('priceDisplay', 'Price display')}</label>
                <AppSelect
                  id="portal-price-display"
                  name="customer_portal_price_display"
                  value={editorDraft.customer_portal_price_display || 'USD'}
                  onChange={(nextValue) => setDraft('customer_portal_price_display', nextValue)}
                  ariaLabel={copy('priceDisplay', 'Price display')}
                  className="mt-1 w-full"
                  buttonClassName="h-10 w-full"
                  menuClassName="min-w-[8rem]"
                  options={[
                    { value: 'USD', label: 'USD' },
                    { value: 'KHR', label: 'KHR' },
                    { value: 'BOTH', label: copy('both', 'Both') },
                  ]}
                />
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
                      placeholder={copy('searchPlaceholder', 'Search by name, barcode/sku, brand, or category')}
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
                              {product.image ? <ProductImg src={product.image} alt={product.name || ''} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-slate-400"><ShoppingBag className="h-4 w-4" /></div>}
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
                              <label htmlFor={`portal-promo-link-type-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('promotionLinksTo', 'Button links to')}</label>
                              <AppSelect
                                id={`portal-promo-link-type-${item.id}`}
                                value={item.linkProductId ? 'product' : (item.linkUrl ? 'url' : 'none')}
                                buttonClassName="input h-auto w-full"
                                options={[
                                  { value: 'none', label: copy('promotionLinkNone', 'No button') },
                                  { value: 'product', label: copy('promotionLinkProduct', 'A product') },
                                  { value: 'url', label: copy('promotionLinkUrl', 'A custom link') },
                                ]}
                                onChange={(nextType) => {
                                  if (nextType === 'product') {
                                    updatePromoItem(item.id, 'linkUrl', '')
                                  } else if (nextType === 'url') {
                                    updatePromoItem(item.id, 'linkProductId', '')
                                    updatePromoItem(item.id, 'linkProductName', '')
                                  } else {
                                    updatePromoItem(item.id, 'linkUrl', '')
                                    updatePromoItem(item.id, 'linkProductId', '')
                                    updatePromoItem(item.id, 'linkProductName', '')
                                  }
                                }}
                              />
                            </div>
                          </div>
                          {(() => {
                            const linkType = item.linkProductId ? 'product' : (item.linkUrl ? 'url' : 'none')
                            if (linkType === 'product') {
                              const productList = products as Array<{ id?: unknown; name?: unknown }>
                              return (
                                <div>
                                  <label htmlFor={`portal-promo-product-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('promotionProduct', 'Product')}</label>
                                  <AppSelect
                                    id={`portal-promo-product-${item.id}`}
                                    value={item.linkProductId || ''}
                                    buttonClassName="input h-auto w-full"
                                    options={[
                                      { value: '', label: copy('promotionSelectProduct', 'Select a product…') },
                                      ...productList.map((product) => ({ value: String(product.id), label: String(product.name || '') })),
                                    ]}
                                    onChange={(nextId) => {
                                      const match = productList.find((product) => String(product.id) === nextId)
                                      updatePromoItem(item.id, 'linkProductId', nextId)
                                      updatePromoItem(item.id, 'linkProductName', match ? String(match.name || '') : '')
                                    }}
                                  />
                                </div>
                              )
                            }
                            if (linkType === 'url') {
                              return (
                                <div>
                                  <label htmlFor={`portal-promo-link-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('promotionLink', 'Button link')}</label>
                                  <input id={`portal-promo-link-${item.id}`} className="input" value={item.linkUrl || ''} onChange={(event) => updatePromoItem(item.id, 'linkUrl', event.target.value)} placeholder="https://..." />
                                </div>
                              )
                            }
                            return null
                          })()}
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

          <div id="portal-section-about" className={`rounded-2xl border border-slate-200 bg-slate-50 p-4 ${activeEditorSection === 'about' ? '' : 'hidden'}`}>
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
              <div className="text-sm font-semibold text-slate-900">{copy('productDefaultsTitle', 'Product detail defaults')}</div>
              <p className="mt-1 text-xs text-slate-500">{copy('productDefaultsHint', 'Shown on every product\'s detail view. A product\'s own Caution text (typed into its description) takes priority over this default; Need More Details always shows when set here.')}</p>
              <div className="mt-3">
                <label htmlFor="portal-product-caution-default" className="block text-sm font-medium text-slate-700">{copy('productCaution', 'Caution')}</label>
                <textarea
                  id="portal-product-caution-default"
                  name="customer_portal_product_caution_default"
                  className="input resize-none"
                  rows={4}
                  placeholder="Follow the instructions on the product packaging and use the product only as directed. Stop use if unexpected irritation, discomfort, or another adverse reaction occurs. Contact us if you need help confirming the exact variant or usage details before purchase. For external use only. Avoid contact with eyes."
                  value={editorDraft.customer_portal_product_caution_default || ''}
                  onChange={(event) => setDraft('customer_portal_product_caution_default', event.target.value)}
                />
              </div>
              <div className="mt-4">
                <label htmlFor="portal-product-need-more-details-default" className="block text-sm font-medium text-slate-700">{copy('productNeedMoreDetails', 'Need More Details')}</label>
                <textarea
                  id="portal-product-need-more-details-default"
                  name="customer_portal_product_need_more_details_default"
                  className="input resize-none"
                  rows={4}
                  placeholder="Contact us if you need additional product details, variant confirmation, usage guidance, or help comparing suitable options. Consider how the product fits into your existing routine and what finish, function, or application style you want. For products where ingredients, shade compatibility, or personal suitability matter, check the exact packaging details before use."
                  value={editorDraft.customer_portal_product_need_more_details_default || ''}
                  onChange={(event) => setDraft('customer_portal_product_need_more_details_default', event.target.value)}
                />
              </div>
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
                          <input id={`portal-about-block-title-${block.id}`} className="input" value={block.title || ''} onChange={(event) => updateAboutBlock(block.id, 'title', event.target.value)} />
                        </div>
                        <div>
                          <label htmlFor={`portal-about-block-body-${block.id}`} className="block text-sm font-medium text-slate-700">{block.type === 'text' ? copy('textContent', 'Text content') : copy('captionDescription', 'Caption / description')}</label>
                          <textarea id={`portal-about-block-body-${block.id}`} className="input resize-none" rows={block.type === 'text' ? 5 : 3} value={block.body || ''} onChange={(event) => updateAboutBlock(block.id, 'body', event.target.value)} />
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
                        <input id={`portal-about-block-media-${block.id}`} className="input" value={block.mediaUrl || ''} placeholder={block.type === 'video' ? 'https://...' : 'https://... or upload below'} onChange={(event) => updateAboutBlock(block.id, 'mediaUrl', event.target.value)} />
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
                          <input id={`portal-faq-question-${item.id}`} className="input mt-1" value={item.question || ''} onChange={(event) => updateFaqItem(item.id, 'question', event.target.value)} />
                        </div>
                        <div>
                          <label htmlFor={`portal-faq-answer-${item.id}`} className="block text-sm font-medium text-slate-700">{copy('faqAnswer', 'Answer')}</label>
                          <textarea id={`portal-faq-answer-${item.id}`} className="input mt-1 resize-none" rows={3} value={item.answer || ''} onChange={(event) => updateFaqItem(item.id, 'answer', event.target.value)} />
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
                  <AppSelect
                    id="portal-ai-provider"
                    value={editorDraft.customer_portal_ai_provider_id || ''}
                    onChange={(nextValue) => setDraft('customer_portal_ai_provider_id', nextValue)}
                    ariaLabel={copy('assistantProvider', 'AI provider entry', 'AI provider')}
                    className="mt-1 w-full"
                    buttonClassName="h-10 w-full"
                    menuClassName="min-w-[18rem]"
                    options={toAiProviderOptions(
                      aiProviders,
                      copy('assistantProviderAuto', 'Automatic (best available)', 'ស្វ័យប្រវត្តិ (ល្អបំផុតដែលមាន)'),
                      copy('noModel', 'No model'),
                    )}
                  />
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
                  <AppSelect
                    id="portal-language"
                    name="customer_portal_language"
                    value={editorDraft.customer_portal_language || 'auto'}
                    onChange={(nextValue) => setDraft('customer_portal_language', nextValue)}
                    ariaLabel={copy('language', 'Portal language')}
                    className="mt-1 w-full"
                    buttonClassName="h-10 w-full"
                    menuClassName="min-w-[12rem]"
                    options={[
                      { value: 'auto', label: copy('followApp', 'English (default source)') },
                      { value: 'en', label: copy('english', 'English') },
                      { value: 'km', label: copy('khmer', 'Khmer') },
                    ]}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="portal-website" className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><Globe className="h-3.5 w-3.5 text-slate-500" />{copy('website', 'Website')}</label>
                    <input id="portal-website" name="customer_portal_website" autoComplete="url" className="input" value={editorDraft.customer_portal_website || ''} onChange={(event) => setDraft('customer_portal_website', event.target.value)} />
                    <input id="portal-website-label" name="customer_portal_website_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_website_label || ''} onChange={(event) => setDraft('customer_portal_website_label', event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="portal-facebook" className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><Facebook className="h-3.5 w-3.5 text-[#1877F2]" />{copy('facebook', 'Facebook')}</label>
                    <input id="portal-facebook" name="customer_portal_facebook" autoComplete="url" className="input" value={editorDraft.customer_portal_facebook || ''} onChange={(event) => setDraft('customer_portal_facebook', event.target.value)} />
                    <input id="portal-facebook-label" name="customer_portal_facebook_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_facebook_label || ''} onChange={(event) => setDraft('customer_portal_facebook_label', event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="portal-instagram" className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><Instagram className="h-3.5 w-3.5 text-[#E1306C]" />{copy('instagram', 'Instagram')}</label>
                    <input id="portal-instagram" name="customer_portal_instagram" autoComplete="url" className="input" value={editorDraft.customer_portal_instagram || ''} onChange={(event) => setDraft('customer_portal_instagram', event.target.value)} />
                    <input id="portal-instagram-label" name="customer_portal_instagram_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_instagram_label || ''} onChange={(event) => setDraft('customer_portal_instagram_label', event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="portal-telegram" className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><Send className="h-3.5 w-3.5 text-[#26A5E4]" />{copy('telegram', 'Telegram')}</label>
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

                {/* "Contact us" floating button config -- the draft/save mapping and the
                    FAB itself (PublicCatalogPage.tsx) already existed and are fully wired;
                    this editor section was simply never built, so there was no way to
                    populate customer_portal_contact_* / turn the show-contact-* toggles on,
                    which is why the FAB never appeared even though the code path is correct. */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="mb-1 flex items-center gap-2">
                    <div className="text-sm font-semibold text-slate-900">{copy('contactChannels', 'Contact us button')}</div>
                    <ButtonGuidePopover
                      title={copy('contactChannelsGuideTitle', 'Contact us channels')}
                      triggerLabel={copy('contactChannelsGuideTitle', 'Contact us channels')}
                      entries={[
                        { icon: <MessengerIcon className="h-4 w-4" />, label: copy('messenger', 'Messenger'), description: copy('contactGuideMessenger', 'Type a bare username (mystore) or @username -- a full m.me or facebook.com link also works. Falls back to your Facebook link above if left blank.') },
                        { icon: <Send className="h-4 w-4" />, label: copy('telegram', 'Telegram'), description: copy('contactGuideTelegram', 'Type a bare username (mystore) or @username -- a full t.me link (including group/channel invite links) also works. Falls back to your Telegram link above if left blank.') },
                        { icon: <Instagram className="h-4 w-4" />, label: copy('instagram', 'Instagram'), description: copy('contactGuideInstagram', 'Type a bare username (mystore) or @username -- a full instagram.com or ig.me link also works. Opens a direct message, not the profile. Falls back to your Instagram link above if left blank.') },
                        { icon: <PhoneCall className="h-4 w-4" />, label: copy('call', 'Call'), description: copy('contactGuideCall', 'Type the phone number customers should call. Opens the device dialer -- defaults to your business phone number if left blank.') },
                      ]}
                    />
                  </div>
                  <p className="mb-3 text-xs text-slate-500">{copy('contactChannelsHint', 'A direct-message floating button shown on the storefront, separate from the social links above. Messenger/Telegram fall back to your Facebook/Telegram links above if left blank.')}</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label htmlFor="portal-contact-messenger" className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><MessengerIcon className="h-3.5 w-3.5 text-amber-600" />{copy('messenger', 'Messenger')}</label>
                      <input id="portal-contact-messenger" name="customer_portal_contact_messenger" autoComplete="off" className="input" placeholder="username or m.me/username" value={editorDraft.customer_portal_contact_messenger || ''} onChange={(event) => setDraft('customer_portal_contact_messenger', event.target.value)} />
                      <input id="portal-contact-messenger-label" name="customer_portal_contact_messenger_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_contact_messenger_label || ''} onChange={(event) => setDraft('customer_portal_contact_messenger_label', event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="portal-contact-telegram" className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><Send className="h-3.5 w-3.5 text-[#26A5E4]" />{copy('telegram', 'Telegram')}</label>
                      <input id="portal-contact-telegram" name="customer_portal_contact_telegram" autoComplete="off" className="input" placeholder="username or t.me/username" value={editorDraft.customer_portal_contact_telegram || ''} onChange={(event) => setDraft('customer_portal_contact_telegram', event.target.value)} />
                      <input id="portal-contact-telegram-label" name="customer_portal_contact_telegram_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_contact_telegram_label || ''} onChange={(event) => setDraft('customer_portal_contact_telegram_label', event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="portal-contact-instagram" className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><Instagram className="h-3.5 w-3.5 text-[#E1306C]" />{copy('instagram', 'Instagram')}</label>
                      <input id="portal-contact-instagram" name="customer_portal_contact_instagram" autoComplete="off" className="input" placeholder="username or instagram.com/username" value={editorDraft.customer_portal_contact_instagram || ''} onChange={(event) => setDraft('customer_portal_contact_instagram', event.target.value)} />
                      <input id="portal-contact-instagram-label" name="customer_portal_contact_instagram_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_contact_instagram_label || ''} onChange={(event) => setDraft('customer_portal_contact_instagram_label', event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="portal-contact-whatsapp" className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><PhoneCall className="h-3.5 w-3.5 text-[#25D366]" />{copy('whatsapp', 'WhatsApp')}</label>
                      <input id="portal-contact-whatsapp" name="customer_portal_contact_whatsapp" autoComplete="off" className="input" placeholder="phone number or wa.me link" value={editorDraft.customer_portal_contact_whatsapp || ''} onChange={(event) => setDraft('customer_portal_contact_whatsapp', event.target.value)} />
                      <input id="portal-contact-whatsapp-label" name="customer_portal_contact_whatsapp_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_contact_whatsapp_label || ''} onChange={(event) => setDraft('customer_portal_contact_whatsapp_label', event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="portal-contact-phone" className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><PhoneCall className="h-3.5 w-3.5 text-emerald-600" />{copy('call', 'Call')}</label>
                      <input id="portal-contact-phone" name="customer_portal_contact_phone" autoComplete="off" className="input" placeholder="phone number" value={editorDraft.customer_portal_contact_phone || editorDraft.business_phone || ''} onChange={(event) => setDraft('customer_portal_contact_phone', event.target.value)} />
                      <input id="portal-contact-phone-label" name="customer_portal_contact_phone_label" autoComplete="off" className="input" placeholder={copy('socialLabelPlaceholder', 'Optional label shown to customers')} value={editorDraft.customer_portal_contact_phone_label || ''} onChange={(event) => setDraft('customer_portal_contact_phone_label', event.target.value)} />
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-contact-messenger">
                      <span className="text-sm text-slate-700">{copy('showContactMessenger', 'Show Messenger button')}</span>
                      <input id="portal-show-contact-messenger" name="customer_portal_show_contact_messenger" type="checkbox" checked={editorDraft.customer_portal_show_contact_messenger !== false} onChange={(event) => setDraft('customer_portal_show_contact_messenger', event.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-contact-telegram">
                      <span className="text-sm text-slate-700">{copy('showContactTelegram', 'Show Telegram button')}</span>
                      <input id="portal-show-contact-telegram" name="customer_portal_show_contact_telegram" type="checkbox" checked={editorDraft.customer_portal_show_contact_telegram !== false} onChange={(event) => setDraft('customer_portal_show_contact_telegram', event.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-contact-instagram">
                      <span className="text-sm text-slate-700">{copy('showContactInstagram', 'Show Instagram button')}</span>
                      <input id="portal-show-contact-instagram" name="customer_portal_show_contact_instagram" type="checkbox" checked={!!editorDraft.customer_portal_show_contact_instagram} onChange={(event) => setDraft('customer_portal_show_contact_instagram', event.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-contact-whatsapp">
                      <span className="text-sm text-slate-700">{copy('showContactWhatsapp', 'Show WhatsApp button')}</span>
                      <input id="portal-show-contact-whatsapp" name="customer_portal_show_contact_whatsapp" type="checkbox" checked={!!editorDraft.customer_portal_show_contact_whatsapp} onChange={(event) => setDraft('customer_portal_show_contact_whatsapp', event.target.checked)} />
                    </label>
                    <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2" htmlFor="portal-show-contact-phone">
                      <span className="text-sm text-slate-700">{copy('showContactPhone', 'Show Call button')}</span>
                      <input id="portal-show-contact-phone" name="customer_portal_show_contact_phone" type="checkbox" checked={!!editorDraft.customer_portal_show_contact_phone} onChange={(event) => setDraft('customer_portal_show_contact_phone', event.target.checked)} />
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
                <AppSelect
                  id="portal-logo-fit"
                  name="customer_portal_logo_fit"
                  value={editorDraft.customer_portal_logo_fit || 'cover'}
                  onChange={(nextValue) => setDraft('customer_portal_logo_fit', nextValue)}
                  ariaLabel={copy('logoFit', 'Logo fit')}
                  className="mt-2 w-full"
                  buttonClassName="h-10 w-full"
                  menuClassName="min-w-[10rem]"
                  options={[
                    { value: 'contain', label: copy('fitContain', 'Fit inside') },
                    { value: 'cover', label: copy('fitCover', 'Fill frame') },
                  ]}
                />
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
            {editorDraft.customer_portal_cover_image ? (
              <div className="xl:col-span-2 min-w-0 rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{copy('coverPreview', 'Cover preview')}</div>
                {/* Mirrors the same gradient-overlay-over-cover-image compositing the
                    live hero banner uses (CatalogSecondaryTabs.tsx's bannerBackground),
                    so this card shows what the person will actually see on save instead
                    of only the raw uploaded file the ImageField's own preview/gallery
                    modal shows -- same gap the logo section already closed with its own
                    dedicated preview card above. */}
                <div
                  className="mt-3 flex h-32 items-end overflow-hidden rounded-[28px] bg-cover bg-center p-4 text-white"
                  style={{
                    backgroundImage: `linear-gradient(135deg, ${normalizeHexColor(editorDraft.customer_portal_hero_gradient_start, '#0f172a')}cc 0%, ${normalizeHexColor(editorDraft.customer_portal_hero_gradient_mid, '#14532d')}b3 55%, ${normalizeHexColor(editorDraft.customer_portal_hero_gradient_end, '#ea580c')}cc 100%), url(${editorDraft.customer_portal_cover_image})`,
                  }}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{editorDraft.business_name || previewConfig.businessName || 'Business OS'}</div>
                    <div className="mt-1 truncate text-xs text-white/80">{editorDraft.customer_portal_business_tagline || previewConfig.businessTagline || 'Preview the hero banner on the live header.'}</div>
                  </div>
                </div>
              </div>
            ) : null}
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
                  <AppSelect
                    id="portal-stock-threshold-mode"
                    name="customer_portal_stock_threshold_mode"
                    value={editorDraft.customer_portal_stock_threshold_mode || 'product'}
                    onChange={(nextValue) => setDraft('customer_portal_stock_threshold_mode', nextValue)}
                    ariaLabel={copy('stockThresholdMode', 'Stock badge mode')}
                    className="mt-1 w-full"
                    buttonClassName="h-10 w-full"
                    menuClassName="min-w-[16rem]"
                    options={[
                      { value: 'product', label: copy('stockThresholdModeProduct', 'Use each product threshold') },
                      { value: 'global', label: copy('stockThresholdModeGlobal', 'Use portal-wide thresholds') },
                    ]}
                  />
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

            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
              <div className="text-sm font-semibold text-sky-900">{copy('reviewQueue', 'Review queue')}</div>
              <p className="mt-2 text-sm text-sky-800">
                {copy('reviewQueueMovedHint', 'Approving, rejecting, and awarding points for customer share submissions now happens in Loyalty Points, alongside the rest of the points rules.')}
              </p>
              <button type="button" className="btn-secondary mt-3 text-sm" onClick={() => navigateTo('loyalty_points')}>
                {copy('openPointsPage', 'Open Loyalty Points', 'បើកទំព័រពិន្ទុស្មោះត្រង់')}
              </button>
            </div>
          </div>
        </div>
      </SectionShell>
      {showAnnouncementStripModal && (
        <Suspense fallback={null}>
          <ManageAnnouncementStripModal
            onClose={() => setShowAnnouncementStripModal(false)}
            productOptions={(products as Array<{ id?: unknown; name?: unknown }>)
              .filter((p) => p.id != null && p.name != null)
              .map((p) => ({ id: Number(p.id), name: String(p.name) }))}
          />
        </Suspense>
      )}
    </aside>
  )
}
