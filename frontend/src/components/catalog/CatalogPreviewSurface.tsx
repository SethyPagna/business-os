import { Suspense, useMemo, useState } from 'react'
import type { CSSProperties, ComponentType, Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js'
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import Heart from 'lucide-react/dist/esm/icons/heart.js'
import Moon from 'lucide-react/dist/esm/icons/moon.js'
import Sun from 'lucide-react/dist/esm/icons/sun.js'
import User from 'lucide-react/dist/esm/icons/user.js'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import CatalogProductImage from './catalogImages'
import type { ProductDetailViewState } from './ProductDetailFlyout'
import '../../styles/public-portal.css'

const ImageGalleryLightbox = lazyRetry(() => import('../shared/ImageGalleryLightbox'), 'catalog-preview-image-gallery-lightbox')
const ProductDetailFlyout = lazyRetry(() => import('./ProductDetailFlyout'), 'catalog-preview-product-detail-flyout')

type CopyFunction = (key: string, fallback?: string) => string

type DisplayConfig = {
  businessName?: string
  businessTagline?: string
  logoFit?: string
  logoPositionX?: number
  logoPositionY?: number
  logoZoom?: number
  showLogo?: boolean
  translateWidgetEnabled?: boolean
}

type PortalTab = {
  key: string
  label: string
  icon: ComponentType<{ className?: string }>
}

type PortalNavMetrics = {
  left?: number
  width?: number
  height?: number
}

type GalleryViewState = {
  open: boolean
  title: string
  items: string[]
  index: number
}

type PortalImageViewState = {
  open: boolean
  title: string
  images: string[]
  index: number
}

type FilePickerState = {
  open: boolean
  target?: unknown
  mediaType: string
  title: string
}

type FilePickerModalProps = FilePickerState & {
  onClose: () => void
  onSelect: (asset: unknown) => void
}

type TranslateOption = {
  value: string
  label: string
  kind?: string
}

type HeaderLink = {
  key: string
  label: string
  value: string
  icon: ComponentType<{ className?: string }>
  accentClassName?: string
}

type TranslateApplyState = 'idle' | 'applied' | 'failed' | string

type CatalogPreviewSurfaceProps = {
  publicView: boolean
  darkMode: boolean
  portalBackground: string
  copy: CopyFunction
  canEdit: boolean
  previewSectionRef: RefObject<HTMLDivElement>
  onBackToEditor: () => void
  displayConfig: DisplayConfig
  versionedBusinessLogo?: string | null
  showBrandLabel: boolean | string
  previewTitle: string
  portalTabs: PortalTab[]
  activeTab: string
  setActiveTab: (key: string) => void
  publicPortalNavRef: RefObject<HTMLElement>
  publicPortalNavPinned: boolean
  publicPortalNavMetrics: PortalNavMetrics
  // Top-bar Account + Wishlist icons (public storefront only). Wired by
  // PublicCatalogPage; the admin editor preview (CatalogPage.tsx) omits them,
  // so the icons simply don't render there.
  onOpenAccount?: () => void
  onOpenWishlist?: () => void
  wishlistCount?: number
  accountSignedIn?: boolean
  headerLinks?: HeaderLink[]
  catalogSection: ReactNode
  secondaryTabSection: ReactNode
  promotionsSection?: ReactNode
  publicScrollButtonsVisible: boolean
  scrollPublicPortal: (direction: 'top' | 'bottom') => void
  productGalleryView: GalleryViewState
  setProductGalleryView: Dispatch<SetStateAction<GalleryViewState>>
  // Both CatalogPage.tsx (admin live-preview) and PublicCatalogPage.tsx
  // (the live site) wire this up as of this session -- previously only
  // the type/render plumbing existed here but neither caller actually
  // passed it, so the product-detail flyout could never open from either
  // surface. Still optional/undefined-safe, same pattern the rest of this
  // shared surface uses for e.g. promotionsSection.
  productDetailView?: ProductDetailViewState
  closeProductDetailView?: () => void
  productDetailShopName?: string
  productDetailContactNote?: string
  productDetailCautionDefault?: string
  productDetailNeedMoreDetailsDefault?: string
  onAddToBucket?: (product: { id: number | string }, priceText?: string) => void
  getBucketQty?: (id: number | string) => number
  filePicker: FilePickerState
  setFilePicker: Dispatch<SetStateAction<FilePickerState>>
  handleFilePickerSelect: (asset: unknown) => void
  portalImageView: PortalImageViewState
  setPortalImageView: Dispatch<SetStateAction<PortalImageViewState>>
  toggleTheme: () => void
  translateTarget: string
  translateApplyState: TranslateApplyState
  translateApplyMessage?: string
  externalTranslateTarget?: string | null
  translateReady: boolean
  changeTranslateTarget: (target: string) => void
  allPublicTranslateOptions: TranslateOption[]
}

const FilePickerModal = lazyRetry(async () => ({
  default: (await import('../files/FilePickerModal')).default as ComponentType<FilePickerModalProps>,
}), 'catalog-preview-file-picker-modal')

export default function CatalogPreviewSurface({
  publicView,
  darkMode,
  portalBackground,
  copy,
  canEdit,
  previewSectionRef,
  onBackToEditor,
  displayConfig,
  showBrandLabel,
  previewTitle,
  portalTabs,
  activeTab,
  setActiveTab,
  publicPortalNavRef,
  publicPortalNavPinned,
  publicPortalNavMetrics,
  onOpenAccount,
  onOpenWishlist,
  wishlistCount = 0,
  accountSignedIn = false,
  headerLinks = [],
  catalogSection,
  secondaryTabSection,
  promotionsSection,
  publicScrollButtonsVisible,
  scrollPublicPortal,
  productGalleryView,
  setProductGalleryView,
  productDetailView,
  closeProductDetailView,
  productDetailShopName,
  productDetailContactNote,
  productDetailCautionDefault,
  productDetailNeedMoreDetailsDefault,
  onAddToBucket,
  getBucketQty,
  filePicker,
  setFilePicker,
  handleFilePickerSelect,
  portalImageView,
  setPortalImageView,
  toggleTheme,
  translateTarget,
  translateApplyState,
  translateApplyMessage,
  externalTranslateTarget,
  translateReady,
  changeTranslateTarget,
  allPublicTranslateOptions,
}: CatalogPreviewSurfaceProps) {
  const [translateSearch, setTranslateSearch] = useState('')
  const trimmedTranslateSearch = translateSearch.trim().toLowerCase()
  // Split into "first-party" (fast, real translations) vs "external" (the
  // 9 Google-Translate-only languages) sections instead of one flat list
  // of 28 -- matches the distinction the data already carries (`kind`)
  // but the old flat list never surfaced visually, just via a per-item
  // "External translation:" text prefix that was easy to miss while
  // scanning a long list. Filtered by the search box below when there
  // are enough options that scrolling to find one is real friction.
  const filteredTranslateOptions = useMemo(() => {
    if (!trimmedTranslateSearch) return allPublicTranslateOptions
    return allPublicTranslateOptions.filter((option) => option.label.toLowerCase().includes(trimmedTranslateSearch))
  }, [allPublicTranslateOptions, trimmedTranslateSearch])
  const firstPartyTranslateOptions = filteredTranslateOptions.filter((option) => option.kind !== 'external')
  const externalTranslateOptions = filteredTranslateOptions.filter((option) => option.kind === 'external')

  const handlePortalTabClick = (key: string) => {
    if (key === activeTab) return
    setActiveTab(key)
    if (!publicView || typeof window === 'undefined') return
    if (window.innerWidth >= 640 && publicPortalNavPinned) return
    window.requestAnimationFrame(() => {
      const target = publicPortalNavRef?.current || previewSectionRef?.current
      if (!target) return
      const rect = target.getBoundingClientRect()
      const mobileViewport = window.innerWidth < 640
      if (mobileViewport) {
        const topPadding = 4
        const bottomPadding = Math.min(96, Math.round(window.innerHeight * 0.18))
        const alreadyInView = rect.top >= topPadding && rect.bottom <= window.innerHeight - bottomPadding
        if (alreadyInView) return
      }
      const top = Math.max(0, window.scrollY + rect.top - (window.innerWidth >= 640 ? 12 : 4))
      window.scrollTo({ top, behavior: 'auto' })
    })
  }

  // Same top-safe-area gap as the header padding above -- this is a
  // `position: fixed` inline style (the nav's "pinned while scrolling"
  // state, separate from its default `sticky top-1` CSS), so the browser
  // doesn't apply any safe-area handling automatically the way it can for
  // a plain top-0; it has to be added into the calc'd offset itself.
  const pinnedNavStyle: CSSProperties | undefined = publicView && publicPortalNavPinned ? {
    position: 'fixed',
    top: typeof window !== 'undefined' && window.innerWidth >= 640
      ? 'calc(8px + env(safe-area-inset-top, 0px))'
      : 'env(safe-area-inset-top, 0px)',
    left: `${typeof window !== 'undefined' ? Math.max(8, publicPortalNavMetrics.left || 0) : publicPortalNavMetrics.left}px`,
    width: `${typeof window !== 'undefined'
      ? Math.max(0, Math.min(publicPortalNavMetrics.width || window.innerWidth, window.innerWidth - 16))
      : publicPortalNavMetrics.width}px`,
    zIndex: 40,
  } : undefined

  return (
    <div
      data-portal-root="true"
      // When !publicView this surface is always rendered inside CatalogPage's own
      // .page-scroll container (the admin "portal editor" preview panel), so it must
      // NOT declare a second .page-scroll/overflow-y-auto here -- two nested scroll
      // containers each fighting for wheel/touch events is what produced the frozen
      // scroll + duplicate scrollbar bug mid-page. Just fill width and let the parent
      // scroller handle scrolling.
      className={`${publicView && darkMode ? 'dark ' : ''}${publicView ? 'min-h-screen w-full overflow-visible' : 'w-full'}`}
      style={{
        ...(publicView ? { touchAction: 'pan-y pinch-zoom', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : {}),
        background: portalBackground,
      }}
    >
      {/* publicView-only top safe-area padding: this is the live customer
          storefront's own header, reported as "the top bar of public
          website is blocked when opened" -- on a notched/Dynamic-Island
          iPhone (especially opened from a home-screen "Add to Home
          Screen" install, which runs edge-to-edge with no browser chrome)
          nothing reserved that area, so the business name/logo row could
          render up under the status bar/notch cutout. env() resolves to
          0px on devices without a safe area, so this is a no-op there --
          only applied when publicView since the !publicView case is the
          admin "portal editor" preview embed, which is never opened
          full-screen on a device and shouldn't get extra top padding. */}
      <div className={`mx-auto max-w-[1680px] px-5 py-3 sm:px-10 sm:py-4 lg:px-16 xl:px-20 ${publicView ? 'pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pt-[calc(1rem+env(safe-area-inset-top))]' : ''}`}>
        <div className="space-y-0">
          <div ref={previewSectionRef} className="space-y-0">
            {canEdit ? (
              <div className="flex justify-end">
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  onClick={onBackToEditor}
                >
                  {copy('backToEditor', 'Back to editor')}
                </button>
              </div>
            ) : null}
            <section className="portal-header-shell rounded-t-[28px] border-b border-slate-200/80 dark:border-neutral-800/80">
              <div className="px-1 py-4 sm:py-5">
                <div className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
                  {/* 6.2 (user): the LOGO is out of the top bar -- it still
                      lives on the About page hero. Social links take this
                      side; language + light/dark sit on the far side. */}
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    {headerLinks.map((item) => {
                      const Icon = item.icon
                      return (
                        <a
                          key={item.key}
                          href={item.value}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100 dark:text-neutral-200 dark:hover:bg-neutral-800 ${item.accentClassName || ''}`}
                          aria-label={item.label}
                          title={item.label}
                        >
                          <Icon className="h-[18px] w-[18px]" />
                        </a>
                      )
                    })}
                    {!publicView ? (
                      <div className="hidden shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 sm:inline-flex dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                        {copy('previewBadge', 'Portal Studio')}
                      </div>
                    ) : null}
                  </div>
                  <div className="min-w-0 text-center">
                    {showBrandLabel ? (
                      <div className="notranslate truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-neutral-500" translate="no">
                        {displayConfig.businessName}
                      </div>
                    ) : null}
                    <div
                      className="notranslate text-lg font-semibold leading-tight tracking-tight text-balance break-words [overflow-wrap:anywhere] text-slate-900 sm:truncate sm:text-2xl dark:text-neutral-100"
                      style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
                      translate="no"
                    >
                      {previewTitle || displayConfig.businessName || copy('about', 'About')}
                    </div>
                    {displayConfig.businessTagline ? (
                      <div className="notranslate hidden truncate text-xs text-slate-500 sm:block dark:text-neutral-400" translate="no">
                        {displayConfig.businessTagline}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-1">
                    {/* Wishlist + Account live in the top bar (public storefront
                        only — the admin editor preview doesn't wire these
                        handlers, so they don't render there). Each opens its own
                        slide-in drawer. */}
                    {onOpenWishlist ? (
                      <button
                        type="button"
                        className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        onClick={onOpenWishlist}
                        aria-label={copy('wishlistTitle', 'Wishlist')}
                        title={copy('wishlistTitle', 'Wishlist')}
                      >
                        <Heart className="h-[18px] w-[18px]" />
                        {wishlistCount > 0 ? (
                          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-none text-white">
                            {wishlistCount}
                          </span>
                        ) : null}
                      </button>
                    ) : null}
                    {onOpenAccount ? (
                      <button
                        type="button"
                        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition hover:bg-slate-100 dark:hover:bg-neutral-800 ${accountSignedIn ? 'text-emerald-600 dark:text-emerald-300' : 'text-slate-700 dark:text-neutral-200'}`}
                        onClick={onOpenAccount}
                        aria-label={copy('account', 'Account')}
                        title={copy('account', 'Account')}
                      >
                        <User className="h-[18px] w-[18px]" />
                      </button>
                    ) : null}
                    {displayConfig.translateWidgetEnabled ? (
                      <LazyPortalMenu
                        align="right"
                        onOpenChange={(open) => {
                          if (!open) setTranslateSearch('')
                        }}
                        trigger={(
                          <button
                            type="button"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                            aria-label={copy('publicTranslation', 'Language tools')}
                            title={copy('publicTranslation', 'Language tools')}
                          >
                            <Globe className="h-[18px] w-[18px]" />
                          </button>
                        )}
                        content={({ closeMenu }) => {
                          const renderOption = (option: TranslateOption) => {
                            const active = translateTarget === option.value && (
                              translateApplyState === 'applied'
                              || (option.value === 'original' && translateApplyState === 'idle')
                            )
                            return (
                              <button
                                key={option.value}
                                type="button"
                                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition ${
                                  active
                                    ? 'bg-blue-50 text-blue-700 dark:bg-amber-500/10 dark:text-amber-300'
                                    : 'text-slate-700 hover:bg-slate-50 dark:text-neutral-200 dark:hover:bg-neutral-800'
                                }`}
                                onClick={() => {
                                  changeTranslateTarget(option.value)
                                  closeMenu()
                                }}
                              >
                                <span>{option.value === 'original' ? copy('followApp', 'Original') : option.label}</span>
                                {active ? <span className="text-[11px] font-semibold uppercase">{copy('active', 'Active')}</span> : null}
                              </button>
                            )
                          }
                          return (
                            <div className="w-72 max-w-[85vw]">
                              <div className="px-4 pb-2 pt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                {copy('publicTranslation', 'Language tools')}
                              </div>
                              {allPublicTranslateOptions.length > 8 ? (
                                <div className="px-3 pb-2">
                                  <input
                                    type="text"
                                    value={translateSearch}
                                    onChange={(event) => setTranslateSearch(event.target.value)}
                                    placeholder={copy('searchLanguages', 'Search languages')}
                                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:focus:border-amber-400 dark:focus:bg-neutral-900"
                                    // Real user requirement, not decorative:
                                    // a flat 28-option list with no way to
                                    // filter was the actual complaint behind
                                    // "hard to find the right language" --
                                    // this narrows the two sections below as
                                    // you type instead of forcing a scroll
                                    // through the full list every time.
                                    autoFocus
                                  />
                                </div>
                              ) : null}
                              <div className="max-h-[min(60vh,20rem)] overflow-y-auto py-1">
                                {firstPartyTranslateOptions.length ? firstPartyTranslateOptions.map(renderOption) : null}
                                {externalTranslateOptions.length ? (
                                  <>
                                    <div className="mt-1 border-t border-slate-200 px-4 pb-1.5 pt-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 dark:border-neutral-700 dark:text-neutral-500">
                                      {copy('externalTranslation', 'More languages (auto-translated)')}
                                    </div>
                                    {externalTranslateOptions.map(renderOption)}
                                  </>
                                ) : null}
                                {!firstPartyTranslateOptions.length && !externalTranslateOptions.length ? (
                                  <div className="px-4 py-6 text-center text-sm text-slate-400 dark:text-neutral-500">
                                    {copy('noLanguagesFound', 'No languages match your search.')}
                                  </div>
                                ) : null}
                              </div>
                              {translateApplyMessage ? (
                                <div className={`border-t border-slate-200 px-4 py-2 text-xs dark:border-neutral-700 ${
                                  translateApplyState === 'failed'
                                    ? 'text-rose-600 dark:text-rose-300'
                                    : 'text-slate-500 dark:text-neutral-400'
                                }`}>
                                  {translateApplyMessage}
                                </div>
                              ) : null}
                              {externalTranslateTarget && !translateReady ? (
                                <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-neutral-700 dark:text-neutral-400">
                                  {copy('externalTranslationPreparing', 'Preparing external translation...')}
                                </div>
                              ) : null}
                            </div>
                          )
                        }}
                      />
                    ) : null}
                    <button
                      type="button"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-700 transition hover:bg-slate-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
                      onClick={toggleTheme}
                      aria-label={darkMode ? copy('switch_to_light_mode', 'Switch to light mode') : copy('switch_to_dark_mode', 'Switch to dark mode')}
                      title={darkMode ? copy('switch_to_light_mode', 'Switch to light mode') : copy('switch_to_dark_mode', 'Switch to dark mode')}
                    >
                      {darkMode ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section
              ref={publicPortalNavRef}
              className={`pb-1 ${publicView ? 'sticky top-1 z-40 sm:top-2' : ''}`}
              style={publicView && publicPortalNavPinned ? { minHeight: `${publicPortalNavMetrics.height || 0}px` } : undefined}
            >
              <div
                className="portal-nav-shell rounded-b-[28px] border-b border-slate-200/80 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/85 dark:border-neutral-800/80 dark:bg-[#0b0b0c]/95"
                style={pinnedNavStyle}
              >
                <div className="portal-nav-scroll overflow-x-auto overflow-y-hidden" aria-label={copy('publicNavigation', 'Section navigation')}>
                  <div className="portal-nav-track flex w-max min-w-full flex-nowrap items-center gap-6 px-1">
                    {portalTabs.map((item) => {
                      const Icon = item.icon
                      const selected = activeTab === item.key
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={`inline-flex min-w-max shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-3 text-xs font-medium tracking-wide transition sm:text-sm ${
                            selected
                              ? 'portal-nav-tab-active border-slate-900 text-slate-900 dark:border-neutral-100 dark:text-neutral-100'
                              : 'border-transparent text-slate-500 hover:text-slate-800 dark:text-neutral-400 dark:hover:text-neutral-200'
                          }`}
                          onClick={() => handlePortalTabClick(item.key)}
                        >
                          <Icon className="h-4 w-4 sm:hidden" />
                          <span className="whitespace-nowrap">{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </section>

            {promotionsSection}
            {catalogSection}
            {secondaryTabSection}
          </div>
        </div>
      </div>
      {publicView ? (
        // Root cause of "bucket icon turns into move-to-top/bottom": this
        // wrapper used to sit in the exact same bottom-RIGHT corner as the
        // bucket/contact-us FABs (rendered by the caller, outside this
        // surface) at a higher z-index (z-[70] vs the FABs' z-50), so once
        // scrolled far enough for these to appear, they physically covered
        // the FABs and won every tap -- tying pointer-events to visibility
        // (an earlier fix) only helped while hidden, not once actually
        // visible, which is exactly when someone would also want the
        // bucket. Now anchored to the bottom-LEFT instead: nothing else in
        // this surface lives there, so there's no corner to collide in
        // regardless of scroll/visibility state.
        <div className={`fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-[calc(0.75rem+env(safe-area-inset-left))] z-[70] flex flex-col gap-2 transition-opacity duration-200 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:left-[calc(1.5rem+env(safe-area-inset-left))] ${publicScrollButtonsVisible ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}>
          {/*
            text-neutral-600 here, not text-slate-600: public-portal.css
            force-overrides `.text-slate-500/600/...` with `!important` (see
            the `.dark [data-portal-root='true'] .text-slate-600` rule) so
            the theme's slate/gray tokens stay legible against arbitrary
            admin-picked backgrounds. That !important beats this button's
            own (non-important) `dark:text-neutral-100`, so with the slate
            class the icon was stuck at a dimmer forced gray instead of the
            near-white it was designed for -- exactly the low-contrast
            symptom reported. Neutral isn't in that override list, so it
            renders as authored.
          */}
          <button
            type="button"
            tabIndex={publicScrollButtonsVisible ? 0 : -1}
            aria-hidden={!publicScrollButtonsVisible}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/95 text-neutral-600 shadow-[0_10px_24px_rgba(148,163,184,0.22)] backdrop-blur transition hover:bg-slate-50 hover:text-neutral-950 dark:border-neutral-700/80 dark:bg-neutral-900/92 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-white"
            onClick={() => scrollPublicPortal('top')}
            aria-label={copy('scrollToTop', 'Move to top')}
            title={copy('scrollToTop', 'Move to top')}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            tabIndex={publicScrollButtonsVisible ? 0 : -1}
            aria-hidden={!publicScrollButtonsVisible}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/95 text-neutral-600 shadow-[0_10px_24px_rgba(148,163,184,0.22)] backdrop-blur transition hover:bg-slate-50 hover:text-neutral-950 dark:border-neutral-700/80 dark:bg-neutral-900/92 dark:text-neutral-100 dark:hover:bg-neutral-800 dark:hover:text-white"
            onClick={() => scrollPublicPortal('bottom')}
            aria-label={copy('scrollToBottom', 'Move to bottom')}
            title={copy('scrollToBottom', 'Move to bottom')}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <Suspense fallback={null}>
        {productGalleryView.open && productGalleryView.items.length ? (
          <ImageGalleryLightbox
            open
            title={productGalleryView.title}
            images={productGalleryView.items}
            index={productGalleryView.index}
            onClose={() => setProductGalleryView({ open: false, title: '', items: [], index: 0 })}
            onIndexChange={(index: number) => setProductGalleryView((current) => ({ ...current, index }))}
            labels={{
              prev: copy('prevImage', 'Prev'),
              next: copy('nextImage', 'Next'),
              imageCount: copy('imageCount', '{current}/{total}'),
              dotsLabel: copy('dotsLabel', 'Image {current} of {total}'),
            }}
            renderImage={(src, alt, className) => (
              <CatalogProductImage src={src} alt={alt} className={className} />
            )}
          />
        ) : null}
        {productDetailView?.open && productDetailView.product ? (
          <ProductDetailFlyout
            view={productDetailView}
            copy={copy}
            onClose={() => closeProductDetailView?.()}
            shopName={productDetailShopName}
            contactNote={productDetailContactNote}
            cautionDefault={productDetailCautionDefault}
            needMoreDetailsDefault={productDetailNeedMoreDetailsDefault}
            onAddToBucket={onAddToBucket}
            bucketQty={productDetailView.product ? getBucketQty?.(productDetailView.product.id) : 0}
          />
        ) : null}
        {!publicView && filePicker.open ? (
          <FilePickerModal
            open={filePicker.open}
            title={filePicker.title}
            mediaType={filePicker.mediaType}
            onClose={() => setFilePicker({ open: false, target: null, mediaType: 'image', title: 'Choose file' })}
            onSelect={handleFilePickerSelect}
          />
        ) : null}
        {portalImageView.open && portalImageView.images.length ? (
          <ImageGalleryLightbox
            open
            title={portalImageView.title}
            images={portalImageView.images}
            index={portalImageView.index}
            onClose={() => setPortalImageView({ open: false, title: '', images: [], index: 0 })}
            onIndexChange={(index: number) => setPortalImageView((current) => ({ ...current, index }))}
            labels={{
              prev: copy('prevImage', 'Prev'),
              next: copy('nextImage', 'Next'),
              imageCount: copy('imageCount', '{current}/{total}'),
              dotsLabel: copy('dotsLabel', 'Image {current} of {total}'),
            }}
          />
        ) : null}
      </Suspense>
    </div>
  )
}
