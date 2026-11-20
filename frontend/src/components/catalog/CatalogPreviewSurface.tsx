import { Suspense, cloneElement, isValidElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ComponentType, Dispatch, ReactNode, RefObject, SetStateAction } from 'react'
import { lazyRetry } from '../../utils/lazyImport.ts'
import ArrowDown from 'lucide-react/dist/esm/icons/arrow-down.js'
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.js'
import Check from 'lucide-react/dist/esm/icons/check.js'
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list.js'
import Globe from 'lucide-react/dist/esm/icons/globe.js'
import Heart from 'lucide-react/dist/esm/icons/heart.js'
import MessageCircle from 'lucide-react/dist/esm/icons/message-circle.js'
import Moon from 'lucide-react/dist/esm/icons/moon.js'
import Sun from 'lucide-react/dist/esm/icons/sun.js'
import User from 'lucide-react/dist/esm/icons/user.js'
import LazyPortalMenu from '../shared/LazyPortalMenu'
import PortalContactMenu from './PortalContactMenu.tsx'
import { PORTAL_PRIMARY_COLORS } from './portalButtons.ts'
import CatalogProductImage from './catalogImages'
import { PortalNavSearchSlotContext } from './portalNavSearchSlot.ts'
import type { ProductDetailViewState } from './ProductDetailFlyout'
import type { PortalFooterProps } from './legal/LegalPages.tsx'
import { PUBLIC_STOREFRONT_LANGUAGE_OPTIONS, type PortalLanguageOption } from './portalLanguageOptions.ts'
import type { PortalContactEntry } from './portalSocialLinks.ts'
import PortalAnnouncementStrip from './PortalAnnouncementStrip.tsx'
import type { PortalAnnouncement } from './portalAnnouncement.ts'
import '../../styles/public-portal.css'

const ImageGalleryLightbox = lazyRetry(() => import('../shared/ImageGalleryLightbox'), 'catalog-preview-image-gallery-lightbox')
const ProductDetailFlyout = lazyRetry(() => import('./ProductDetailFlyout'), 'catalog-preview-product-detail-flyout')

// The storefront translator really takes a Khmer fallback as its third
// argument (CatalogPage declares it that way and PublicCatalogPage implements
// it) -- this local alias just under-declared it, so any call that supplied
// the Khmer text was a type error.
type CopyFunction = (key: string, fallback?: string, fallbackKm?: string) => string

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

type CatalogPreviewSurfaceProps = {
  publicView: boolean
  darkMode: boolean
  portalBackground: string
  copy: CopyFunction
  canEdit: boolean
  previewSectionRef: RefObject<HTMLDivElement>
  onBackToEditor: () => void
  displayConfig: DisplayConfig
  configPending?: boolean
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
  // The header list icon opens the List page. `listPage` is the full Saved/List page: while it is set it replaces the tab content and no tab is current.
  onOpenList?: () => void
  listCount?: number
  listPage?: ReactNode
  accountSignedIn?: boolean
  // Every way to reach the shop (buildPortalContactEntries): the header's Contact menu. None: no Contact button.
  contactEntries?: readonly PortalContactEntry[]
  catalogSection: ReactNode
  secondaryTabSection: ReactNode
  // N45 legal lane: the storefront <footer> (business details, quick links,
  // social links and the policy links). Rendered here so the live site and
  // the admin preview show the SAME footer from one place; the caller
  // supplies it so this surface never has to know the business-detail shape.
  footer?: ReactNode
  // The announcement bar (owner, 2 Nov 2026), already resolved for this page and language: none draws nothing. The live page passes a way
  // to close it; the Website Editor preview does not.
  announcement?: PortalAnnouncement | null
  onDismissAnnouncement?: () => void
  onAnnouncementHeight?: (height: number) => void
  publicScrollButtonsVisible: boolean
  scrollPublicPortal: (direction: 'top' | 'bottom') => void
  productGalleryView: GalleryViewState
  setProductGalleryView: Dispatch<SetStateAction<GalleryViewState>>
  // Both CatalogPage.tsx (admin live-preview) and PublicCatalogPage.tsx
  // (the live site) wire this up as of this session -- previously only
  // the type/render plumbing existed here but neither caller actually
  // passed it, so the product-detail flyout could never open from either
  // surface. Still optional/undefined-safe, same pattern the rest of this
  // shared surface uses for e.g. footer.
  productDetailView?: ProductDetailViewState
  closeProductDetailView?: () => void
  productDetailShopName?: string
  productDetailContactNote?: string
  productDetailCautionDefault?: string
  productDetailNeedMoreDetailsDefault?: string
  onAddToBucket?: (product: { id: number | string }, priceText?: string) => void
  getBucketQty?: (id: number | string) => number
  isInWishlist?: (id: number | string) => boolean
  onToggleWishlist?: (product: { id: number | string }, priceText?: string) => void
  filePicker: FilePickerState
  setFilePicker: Dispatch<SetStateAction<FilePickerState>>
  handleFilePickerSelect: (asset: unknown) => void
  portalImageView: PortalImageViewState
  setPortalImageView: Dispatch<SetStateAction<PortalImageViewState>>
  toggleTheme: () => void
  pageLanguage: string
  /** The menu's active row: one of the six values. Defaults to pageLanguage (the editor preview only knows km and en). */
  pageLanguageChoice?: string
  /** The editor preview passes only the hand-written two; the live storefront gets all six. */
  languageOptions?: readonly PortalLanguageOption[]
  changePageLanguage: (language: string) => void
}

// Header buttons: 44 x 44 px below 640 px, with no gap between them so six and the shop name still share one row at 360 px; 40 px from sm up.
const HEADER_ICON_CLASS = 'inline-flex h-11 w-11 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full text-[#23201b] transition hover:bg-stone-200 dark:text-neutral-200 dark:hover:bg-neutral-800'
// The main action of the header: icon + the word "Contact" from sm up, the icon alone on a phone.
const HEADER_CONTACT_CLASS = `inline-flex h-11 w-11 sm:h-10 shrink-0 items-center justify-center gap-2 rounded-full transition sm:w-auto sm:px-4 sm:text-sm sm:font-semibold ${PORTAL_PRIMARY_COLORS}`
const HEADER_ICON_GLYPH = 'h-[18px] w-[18px]'
const HEADER_COUNT_CLASS = 'absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-700 px-1 text-[10px] font-bold leading-none text-white'
// The surface recipe (spec section 1) for the floating scroll buttons.
const SCROLL_BUTTON_CLASS = 'inline-flex h-10 w-10 items-center justify-center rounded-xl border border-stone-300 bg-white text-[#23201b] shadow-sm transition hover:bg-stone-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800'
// The strip runs under the page gutters (the page container's own px-4 / sm:px-6 / lg:px-10 / xl:px-14).
const NAV_FULL_BLEED_CLASS = '-mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10 xl:-mx-14 xl:px-14'

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
  configPending = false,
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
  onOpenList,
  listCount = 0,
  listPage = null,
  accountSignedIn = false,
  contactEntries = [],
  catalogSection,
  secondaryTabSection,
  footer,
  announcement,
  onDismissAnnouncement,
  onAnnouncementHeight,
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
  isInWishlist,
  onToggleWishlist,
  filePicker,
  setFilePicker,
  handleFilePickerSelect,
  portalImageView,
  setPortalImageView,
  toggleTheme,
  pageLanguage,
  pageLanguageChoice,
  languageOptions = PUBLIC_STOREFRONT_LANGUAGE_OPTIONS,
  changePageLanguage,
}: CatalogPreviewSurfaceProps) {
  // The tab bar's search slot (public storefront only): the products section draws its search and Filters into it.
  const [searchSlotElement, setSearchSlotElement] = useState<HTMLElement | null>(null)
  const searchSlot = useMemo(() => ({ expected: publicView, element: searchSlotElement }), [publicView, searchSlotElement])

  // A tab strip that scrolls fades the edge that hides more tabs; the active tab is kept in view.
  const tabScrollRef = useRef<HTMLDivElement | null>(null)
  const [tabFade, setTabFade] = useState({ start: false, end: false })
  const updateTabFade = useCallback(() => {
    const box = tabScrollRef.current
    if (!box) return
    const start = box.scrollLeft > 2
    const end = box.scrollLeft + box.clientWidth < box.scrollWidth - 2
    setTabFade((current) => (current.start === start && current.end === end ? current : { start, end }))
  }, [])
  useEffect(() => {
    updateTabFade()
    const box = tabScrollRef.current
    if (!box || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(updateTabFade)
    observer.observe(box)
    return () => observer.disconnect()
  }, [updateTabFade, portalTabs.length])
  useEffect(() => {
    const box = tabScrollRef.current
    const selected = box?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!box || !selected) return
    const boxRect = box.getBoundingClientRect()
    const rect = selected.getBoundingClientRect()
    if (rect.left < boxRect.left || rect.right > boxRect.right) box.scrollBy({ left: rect.left - boxRect.left - 24 })
  }, [activeTab])

  // P-public-9: the footer's quick links are the nav's own tabs. This
  // surface owns the tabs, so it hands them to whichever footer the caller
  // mounted (public page and admin preview alike) -- one source, no drift.
  // A footer jump always lands at the top of the section, so unlike a nav
  // click it scrolls even when the tab is already active.
  const handleFooterQuickLink = (key: string) => {
    if (key !== activeTab) setActiveTab(key)
    if (typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      const target = publicPortalNavRef?.current || previewSectionRef?.current
      target?.scrollIntoView({ block: 'start' })
    })
  }
  const lightboxLabels = {
    prev: copy('prevImage', 'Previous image'),
    next: copy('nextImage', 'Next image'),
    imageCount: copy('imageCount', '{current}/{total}'),
    dotsLabel: copy('dotsLabel', 'Image {current} of {total}'),
    close: copy('close', 'Close'),
    zoomIn: copy('portal_a11y_zoom_in', 'Zoom in', 'ពង្រីកចូល'),
    zoomOut: copy('portal_a11y_zoom_out', 'Zoom out', 'បង្រួមចេញ'),
  }
  const footerWithQuickLinks = isValidElement<PortalFooterProps>(footer)
    ? cloneElement(footer, { quickLinks: portalTabs.map((tab) => ({ key: tab.key, label: tab.label, onSelect: () => handleFooterQuickLink(tab.key) })) })
    : footer

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
  // state, separate from its default `sticky top-0` CSS), so the browser
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
      //
      // The publicView branch used to say `overflow-visible` next to the
      // inline `overflowY: 'auto'` below, which is a contradiction the browser
      // resolves against us: CSS turns a `visible` axis into `auto` whenever
      // the other axis is not visible, so this shell quietly became a TWO-axis
      // scroll container and any over-wide descendant produced a horizontal
      // scroller INSIDE it -- somewhere html/body's own `overflow-x: hidden`
      // could never reach. `clip` is the one value that contains the
      // horizontal axis without making the shell a scrollport; `hidden` would
      // make it one and break every sticky descendant, and the pinned section
      // nav lives in here.
      //
      // The VERTICAL axis then had to follow, and this is the fix for
      // "scrollability in public website". `overflowY: 'auto'` was kept here
      // as "iOS momentum scrolling on the shell", but this box has
      // `height: auto` (only a min-height), so it grows with the catalog and
      // its scrollHeight never exceeds its clientHeight: it is a scrollport
      // that can never scroll, and `-webkit-overflow-scrolling: touch` on a
      // scrollport with nothing to scroll buys no momentum -- the DOCUMENT
      // was always the thing actually moving. What that dead scrollport DID
      // do is become the nearest scrollport ancestor for every `position:
      // sticky` descendant, and a sticky element resolves against its
      // scrollport, not the page. So the section nav (`sticky top-0`) and the
      // products search/filter row (`sticky top-16`) were pinned to a box
      // that never moves -- i.e. they simply scrolled away -- on the live
      // storefront, where the JS pinning fallback is also switched off
      // (PublicCatalogPage passes publicPortalNavPinned={false}).
      //
      // `overflow-x: clip` is deliberately the only overflow left: `clip`
      // paired with `visible` is the ONE pair CSS does not rewrite to `auto`,
      // so the horizontal containment above survives while the document goes
      // back to owning vertical scroll for the whole public route.
      className={`${publicView && darkMode ? 'dark ' : ''}${publicView ? 'min-h-screen w-full overflow-x-clip' : 'w-full'}`}
      style={{
        ...(publicView ? { touchAction: 'pan-x pan-y pinch-zoom', overflowX: 'clip' } : {}),
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
      {/* 2026-09-18 (owner): "the search and filter row. can fully utlize the
          row. there are many space left and right to utilize." sm/lg/xl each
          added their own further gutter on top of the last, and by xl that
          stacked to 5rem (80px) of dead margin on EVERY row in this column,
          the search/filter bar included -- not just the outer page edge, the
          `mx-auto max-w-[1680px]` already keeps that in check on very wide
          monitors. Trimmed back so the row (and everything else in this
          column) actually uses the space instead of floating in a wide
          gutter on ordinary desktop widths. */}
      {announcement ? <PortalAnnouncementStrip announcement={announcement} copy={copy} onDismiss={onDismissAnnouncement} onHeight={publicView ? onAnnouncementHeight : undefined} /> : null}
      {/* The bottom padding clears the floating buttons (My List, and the scroll buttons on the other side), so at the page end none covers the footer. */}
      <div
        className={`mx-auto max-w-[1680px] px-4 py-3 sm:px-6 sm:py-4 lg:px-10 xl:px-14 ${publicView ? 'pt-[calc(0.75rem+env(safe-area-inset-top))] pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:pt-[calc(1rem+env(safe-area-inset-top))] sm:pb-[calc(7.5rem+env(safe-area-inset-bottom))]' : ''} data-[portal-announcement-shown=true]:pt-3 sm:data-[portal-announcement-shown=true]:pt-4`}
        data-portal-announcement-shown={announcement ? 'true' : undefined}
      >
        <div className="space-y-0">
          <div ref={previewSectionRef} className="space-y-0">
            {/* WCAG 2.4.1: the storefront opens with a row of social links,
                the language and theme controls and a scrolling section nav.
                Without this a keyboard visitor walked all of it again on
                every page view before reaching a single product. */}
            {publicView ? (
              <a className="portal-skip-link" href="#portal-main-content">
                {copy('portal_a11y_skip_to_content', 'Skip to products', 'រំលងទៅផលិតផល')}
              </a>
            ) : null}
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
            {/* One row at every width: the shop name on the left, the actions on the right. The row has no surface of its own (it sits on the ivory page);
                the sticky tab strip under it is the solid one. The name wraps to two lines on a phone rather than being cut. */}
            <header className="portal-header-shell">
              <div className="flex items-center gap-2 px-1 py-2 sm:py-3">
                <div className="min-w-0 flex-1">
                  {!publicView ? (
                    <div className="mb-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                      {copy('previewBadge', 'Website Editor')}
                    </div>
                  ) : null}
                  {showBrandLabel ? (
                    <div className="notranslate truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-600 dark:text-neutral-400" translate="no">
                      {displayConfig.businessName}
                    </div>
                  ) : null}
                  <h1
                    className="notranslate line-clamp-2 break-normal text-base font-semibold leading-tight tracking-tight [overflow-wrap:normal] [word-break:normal] text-[#23201b] sm:truncate sm:text-2xl dark:text-neutral-100"
                    style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
                    translate="no"
                  >
                    {previewTitle || displayConfig.businessName || (configPending
                      ? <span aria-hidden="true" className="portal-skeleton-block inline-block h-5 w-40 max-w-full rounded-md align-middle sm:h-7 sm:w-56" />
                      : copy('about', 'About'))}
                  </h1>
                  {displayConfig.businessTagline ? (
                    <div className="notranslate hidden truncate text-xs text-stone-600 sm:block dark:text-neutral-400" translate="no">
                      {displayConfig.businessTagline}
                    </div>
                  ) : null}
                </div>
                {/* `data-portal-header-icons` is the hook public-portal.css's pointer:coarse floor exempts: the targets here are 44 px on a phone and stay on the one row. */}
                <div data-portal-header-icons="" className="flex shrink-0 flex-nowrap items-center justify-end gap-0 sm:gap-1">
                  {contactEntries.length > 0 ? (
                    <PortalContactMenu
                      entries={contactEntries}
                      copy={copy}
                      align="right"
                      trigger={(
                        <button
                          type="button"
                          data-portal-contact-trigger=""
                          className={HEADER_CONTACT_CLASS}
                          aria-label={copy('contactUs', 'Contact us', 'ទាក់ទងយើង')}
                          title={copy('contactUs', 'Contact us', 'ទាក់ទងយើង')}
                        >
                          <MessageCircle className={HEADER_ICON_GLYPH} />
                          <span className="hidden sm:inline">{copy('contactButton', 'Contact', 'ទាក់ទង')}</span>
                        </button>
                      )}
                    />
                  ) : null}
                  {onOpenWishlist ? (
                    <button
                      type="button"
                      className={`relative ${HEADER_ICON_CLASS}`}
                      onClick={onOpenWishlist}
                      aria-label={copy('saved', 'Saved')}
                      title={copy('saved', 'Saved')}
                    >
                      <Heart className={HEADER_ICON_GLYPH} />
                      {wishlistCount > 0 ? <span className={HEADER_COUNT_CLASS}>{wishlistCount}</span> : null}
                    </button>
                  ) : null}
                  {onOpenList ? (
                    <button
                      type="button"
                      className={`relative ${HEADER_ICON_CLASS}`}
                      onClick={onOpenList}
                      aria-label={copy('bucketTitle', 'My List')}
                      title={copy('bucketTitle', 'My List')}
                    >
                      <ClipboardList className={HEADER_ICON_GLYPH} />
                      {listCount > 0 ? <span className={HEADER_COUNT_CLASS}>{listCount}</span> : null}
                    </button>
                  ) : null}
                  {onOpenAccount ? (
                    <button
                      type="button"
                      className={`${HEADER_ICON_CLASS} ${accountSignedIn ? 'text-emerald-700 dark:text-emerald-300' : ''}`}
                      onClick={onOpenAccount}
                      aria-label={copy('account', 'Account')}
                      title={copy('account', 'Account')}
                    >
                      <User className={HEADER_ICON_GLYPH} />
                    </button>
                  ) : null}
                  {displayConfig.translateWidgetEnabled ? (
                    <LazyPortalMenu
                      align="right"
                      trigger={(
                        <button
                          type="button"
                          className={HEADER_ICON_CLASS}
                          aria-label={copy('publicTranslation', 'Language tools')}
                          title={copy('publicTranslation', 'Language tools')}
                        >
                          <Globe className={HEADER_ICON_GLYPH} />
                        </button>
                      )}
                      content={({ closeMenu }) => (
                        // No title row: just the options, the active one marked with a check.
                        <div className="w-60 max-w-[85vw] py-1" role="group" aria-label={copy('publicTranslation', 'Language tools')}>
                          {languageOptions.map((option) => {
                            const active = (pageLanguageChoice ?? pageLanguage) === option.value
                            return (
                              <button
                                key={option.value}
                                type="button"
                                aria-current={active ? 'true' : undefined}
                                className={`flex min-h-11 w-full items-center justify-between gap-3 px-4 text-left text-sm transition hover:bg-stone-100 dark:hover:bg-neutral-800 ${active ? 'font-semibold text-[#7a5c22] dark:text-amber-300' : 'text-[#23201b] dark:text-neutral-200'}`}
                                onClick={() => {
                                  changePageLanguage(option.value)
                                  closeMenu()
                                }}
                              >
                                {/* Each label stays in its own script: a page translator must never rewrite it. */}
                                <span translate="no" className="notranslate">{option.label}</span>
                                <span className="flex items-center gap-2">
                                  {option.google ? (
                                    <span translate="no" className="notranslate rounded border border-stone-300 px-1 text-[10px] font-medium uppercase leading-4 tracking-wide text-stone-500 dark:border-neutral-600 dark:text-neutral-400">Google</span>
                                  ) : null}
                                  {active ? <Check aria-hidden="true" className="h-4 w-4 shrink-0" /> : null}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    />
                  ) : null}
                  <button
                    type="button"
                    className={HEADER_ICON_CLASS}
                    onClick={toggleTheme}
                    aria-label={darkMode ? copy('switch_to_light_mode', 'Switch to light mode') : copy('switch_to_dark_mode', 'Switch to dark mode')}
                    title={darkMode ? copy('switch_to_light_mode', 'Switch to light mode') : copy('switch_to_dark_mode', 'Switch to dark mode')}
                  >
                    {darkMode ? <Sun className={HEADER_ICON_GLYPH} /> : <Moon className={HEADER_ICON_GLYPH} />}
                  </button>
                </div>
              </div>
            </header>

            {/* The tab strip is solid page ground with one line under it, and runs edge to edge so nothing scrolls past it in the page gutters.
                The tabs scroll sideways without a scrollbar; an edge that hides more tabs fades instead of cutting a label. */}
            <nav
              aria-label={copy('publicNavigation', 'Section navigation')}
              ref={publicPortalNavRef}
              className={publicView ? 'sticky top-0 z-40' : ''}
              style={publicView && publicPortalNavPinned ? { minHeight: `${publicPortalNavMetrics.height || 0}px` } : undefined}
            >
              <div
                className={`portal-nav-shell border-b border-stone-300 bg-[#f4f1ea] dark:border-neutral-800 dark:bg-[#0b0b0c] ${publicView && !publicPortalNavPinned ? NAV_FULL_BLEED_CLASS : ''}`}
                style={pinnedNavStyle}
              >
                {/* The search joins the tabs: tabs on their own line on a phone with the search directly under them, one row from lg up. */}
                <div className="flex flex-wrap items-center gap-x-4 lg:flex-nowrap">
                  <div
                    ref={tabScrollRef}
                    onScroll={updateTabFade}
                    data-fade-start={tabFade.start ? 'true' : undefined}
                    data-fade-end={tabFade.end ? 'true' : undefined}
                    className="portal-nav-scroll w-full min-w-0 overflow-x-auto overflow-y-hidden lg:w-auto lg:flex-1"
                  >
                    <div className="portal-nav-track flex w-max min-w-full flex-nowrap items-center gap-6 px-1">
                      {portalTabs.map((item) => {
                        const Icon = item.icon
                        const selected = !listPage && activeTab === item.key
                        return (
                          <button
                            key={item.key}
                            type="button"
                            className={`inline-flex min-h-11 min-w-max shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 text-xs font-medium tracking-wide transition sm:text-sm ${
                              selected
                                ? 'portal-nav-tab-active border-[#23201b] text-[#23201b] dark:border-neutral-100 dark:text-neutral-100'
                                : 'border-transparent text-stone-600 hover:text-[#23201b] dark:text-neutral-400 dark:hover:text-neutral-200'
                            }`}
                            onClick={() => handlePortalTabClick(item.key)}
                            aria-current={selected ? 'page' : undefined}
                          >
                            <Icon className="h-4 w-4 sm:hidden" />
                            <span className="whitespace-nowrap">{item.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  {publicView ? (
                    <div
                      ref={setSearchSlotElement}
                      data-portal-nav-search-slot="true"
                      className="relative w-full min-w-0 shrink-0 pb-2 empty:hidden lg:w-[min(34rem,52%)] lg:pb-0"
                    />
                  ) : null}
                </div>
              </div>
            </nav>

            {/* No system-generated notice is rendered here on purpose. The
                amber "seller details" banner that used to sit between the
                tabs and the content was removed at the owner's direction
                (2026-09-14: "remove the notice in the public website. i
                don't want it. if i want to add i will in the editor"). The
                storefront shows owner-written content only; the empty seller
                fields are still named to the owner inside the editor
                (CatalogEditorSurface.tsx's publication summary). */}
            <main id="portal-main-content" tabIndex={-1}>
              {listPage ? listPage : (
                <>
                  <PortalNavSearchSlotContext.Provider value={searchSlot}>{catalogSection}</PortalNavSearchSlotContext.Provider>
                  {secondaryTabSection}
                </>
              )}
            </main>
            {footerWithQuickLinks}
          </div>
        </div>
      </div>
      {publicView ? (
        // Bottom-LEFT, because nothing else lives there: in the bottom-right corner these used to cover the list button and win every tap.
        <div className={`fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-[calc(0.75rem+env(safe-area-inset-left))] z-[70] flex flex-col gap-2 sm:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] sm:left-[calc(1.5rem+env(safe-area-inset-left))] ${publicScrollButtonsVisible ? 'visible pointer-events-auto' : 'invisible pointer-events-none'}`}>
          <button
            type="button"
            tabIndex={publicScrollButtonsVisible ? 0 : -1}
            aria-hidden={!publicScrollButtonsVisible}
            className={SCROLL_BUTTON_CLASS}
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
            className={SCROLL_BUTTON_CLASS}
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
            variant="immersive"
            labels={lightboxLabels}
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
            language={pageLanguage}
            onAddToBucket={onAddToBucket}
            bucketQty={productDetailView.product ? getBucketQty?.(productDetailView.product.id) : 0}
            onToggleWishlist={onToggleWishlist}
            isInWishlist={productDetailView.product ? isInWishlist?.(productDetailView.product.id) : false}
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
            labels={lightboxLabels}
          />
        ) : null}
      </Suspense>
    </div>
  )
}
