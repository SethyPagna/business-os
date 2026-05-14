import { Suspense, lazy } from 'react'
import { ArrowDown, ArrowUp, Globe, Moon, Sun } from 'lucide-react'
import { ProductImg } from '../products/primitives'

const PortalMenu = lazy(() => import('../shared/PortalMenu'))
const ImageGalleryLightbox = lazy(() => import('../shared/ImageGalleryLightbox'))
const FilePickerModal = lazy(() => import('../files/FilePickerModal'))

export default function CatalogPreviewSurface({
  publicView,
  darkMode,
  portalBackground,
  copy,
  canEdit,
  previewSectionRef,
  onBackToEditor,
  displayConfig,
  versionedBusinessLogo,
  showBrandLabel,
  previewTitle,
  portalTabs,
  activeTab,
  setActiveTab,
  publicPortalNavRef,
  publicPortalNavPinned,
  publicPortalNavMetrics,
  catalogSection,
  secondaryTabSection,
  publicScrollButtonsVisible,
  scrollPublicPortal,
  productGalleryView,
  setProductGalleryView,
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
}) {
  const handlePortalTabClick = (key) => {
    if (key === activeTab) return
    setActiveTab(key)
    if (!publicView || typeof window === 'undefined') return
    window.requestAnimationFrame(() => {
      const target = publicPortalNavRef?.current || previewSectionRef?.current
      if (!target) return
      const rect = target.getBoundingClientRect()
      const top = Math.max(0, window.scrollY + rect.top - (window.innerWidth >= 640 ? 12 : 4))
      window.scrollTo({ top, behavior: 'auto' })
    })
  }

  const pinnedNavStyle = publicView && publicPortalNavPinned ? {
    position: 'fixed',
    top: typeof window !== 'undefined' && window.innerWidth >= 640 ? '8px' : '0px',
    left: `${typeof window !== 'undefined' ? Math.max(8, publicPortalNavMetrics.left || 0) : publicPortalNavMetrics.left}px`,
    width: `${typeof window !== 'undefined'
      ? Math.max(0, Math.min(publicPortalNavMetrics.width || window.innerWidth, window.innerWidth - 16))
      : publicPortalNavMetrics.width}px`,
    zIndex: 40,
  } : undefined

  return (
    <div
      data-portal-root="true"
      className={`${publicView && darkMode ? 'dark ' : ''}${publicView ? 'min-h-screen w-full overflow-visible' : 'page-scroll flex-1 overflow-y-auto'}`}
      style={{
        ...(publicView ? { touchAction: 'pan-y pinch-zoom', overflowY: 'auto', WebkitOverflowScrolling: 'touch' } : {}),
        background: portalBackground,
      }}
    >
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <div ref={previewSectionRef} className="space-y-6">
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
            <section className="portal-header-shell overflow-hidden rounded-[30px] border border-slate-200/80 bg-white/96 shadow-[0_14px_36px_rgba(148,163,184,0.16)] backdrop-blur dark:border-slate-700/80 dark:bg-slate-900/88">
              <div className="px-4 py-4 sm:px-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="portal-logo-frame flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-[0_8px_20px_rgba(148,163,184,0.18)] dark:bg-slate-100">
                      {versionedBusinessLogo ? (
                        <button
                          type="button"
                          className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-white"
                          onClick={() => setPortalImageView({ open: true, title: displayConfig.businessName || copy('logoImage', 'Logo image'), images: [versionedBusinessLogo], index: 0 })}
                        >
                          <img
                            src={versionedBusinessLogo}
                            alt={displayConfig.businessName}
                            loading="eager"
                            decoding="async"
                            fetchPriority="high"
                            className="h-full w-full rounded-full"
                            style={{
                              objectFit: 'cover',
                              objectPosition: `${displayConfig.logoPositionX || 50}% ${displayConfig.logoPositionY || 50}%`,
                              transform: `scale(${Math.max(1, Math.min(1.35, (displayConfig.logoZoom || 100) / 100))})`,
                              transformOrigin: 'center',
                            }}
                          />
                        </button>
                      ) : (
                        <span className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          {String(displayConfig.businessName || 'B').slice(0, 2).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      {!publicView ? (
                        <div className="mb-1 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                          {copy('previewBadge', 'Portal Studio')}
                        </div>
                      ) : null}
                      {showBrandLabel ? (
                        <div className="notranslate truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500" translate="no">
                          {displayConfig.businessName}
                        </div>
                      ) : null}
                      <div className="notranslate truncate text-base font-semibold text-slate-900 dark:text-slate-100 sm:text-lg" translate="no">
                        {previewTitle || displayConfig.businessName || copy('about', 'About')}
                      </div>
                      {displayConfig.businessTagline ? (
                        <div className="notranslate hidden truncate text-xs text-slate-500 dark:text-slate-400 sm:block" translate="no">
                          {displayConfig.businessTagline}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {displayConfig.translateWidgetEnabled ? (
                      <Suspense
                        fallback={(
                          <button
                            type="button"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-slate-400 shadow-sm dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-300"
                            aria-label={copy('publicTranslation', 'Language tools')}
                            title={copy('publicTranslation', 'Language tools')}
                            disabled
                          >
                            <Globe className="h-4 w-4" />
                          </button>
                        )}
                      >
                        <PortalMenu
                          align="right"
                          trigger={(
                            <button
                              type="button"
                              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                              aria-label={copy('publicTranslation', 'Language tools')}
                              title={copy('publicTranslation', 'Language tools')}
                            >
                              <Globe className="h-4 w-4" />
                            </button>
                          )}
                          content={({ closeMenu }) => (
                            <div className="max-h-[min(70vh,22rem)] overflow-y-auto py-1">
                              <div className="px-4 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                                {copy('publicTranslation', 'Language tools')}
                              </div>
                              {allPublicTranslateOptions.map((option) => {
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
                                        ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
                                    }`}
                                    onClick={() => {
                                      changeTranslateTarget(option.value)
                                      closeMenu()
                                    }}
                                  >
                                    <span>
                                      {option.value === 'original'
                                        ? copy('followApp', 'Original')
                                        : option.kind === 'external'
                                          ? `${copy('externalTranslation', 'External translation')}: ${option.label}`
                                          : option.label}
                                    </span>
                                    {active ? <span className="text-[11px] font-semibold uppercase">{copy('active', 'Active')}</span> : null}
                                  </button>
                                )
                              })}
                              {translateApplyMessage ? (
                                <div className={`border-t border-slate-200 px-4 py-2 text-xs dark:border-slate-700 ${
                                  translateApplyState === 'failed'
                                    ? 'text-rose-600 dark:text-rose-300'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}>
                                  {translateApplyMessage}
                                </div>
                              ) : null}
                              {externalTranslateTarget && !translateReady ? (
                                <div className="border-t border-slate-200 px-4 py-2 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                  {copy('externalTranslationPreparing', 'Preparing external translation...')}
                                </div>
                              ) : null}
                            </div>
                          )}
                        />
                      </Suspense>
                    ) : null}
                    <button
                      type="button"
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200/80 bg-white text-slate-600 shadow-sm transition hover:bg-slate-50 dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                      onClick={toggleTheme}
                      aria-label={darkMode ? copy('switch_to_light_mode', 'Switch to light mode') : copy('switch_to_dark_mode', 'Switch to dark mode')}
                      title={darkMode ? copy('switch_to_light_mode', 'Switch to light mode') : copy('switch_to_dark_mode', 'Switch to dark mode')}
                    >
                      {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
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
                className="portal-nav-shell overflow-hidden rounded-[24px] border border-slate-200/80 bg-white/96 p-2 shadow-[0_12px_28px_rgba(148,163,184,0.14)] backdrop-blur supports-[backdrop-filter]:bg-white/90 dark:border-slate-700/80 dark:bg-slate-900/92 dark:supports-[backdrop-filter]:bg-slate-900/86"
                style={pinnedNavStyle}
              >
                <div className="portal-nav-scroll overflow-x-auto" aria-label={copy('publicNavigation', 'Section navigation')}>
                  <div className="portal-nav-track inline-flex min-w-full items-center gap-1 rounded-[20px] border border-slate-200/70 bg-slate-50/90 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] dark:border-slate-700/70 dark:bg-slate-800/75 dark:shadow-none">
                    {portalTabs.map((item) => {
                      const Icon = item.icon
                      const selected = activeTab === item.key
                      return (
                        <button
                          key={item.key}
                          type="button"
                          className={`inline-flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold transition sm:text-sm ${
                            selected
                              ? 'portal-nav-tab-active shadow-sm ring-1 ring-slate-200 dark:ring-sky-100/80'
                              : 'text-slate-600 hover:bg-white dark:text-slate-100 dark:hover:bg-slate-700/80'
                          }`}
                          onClick={() => handlePortalTabClick(item.key)}
                        >
                          <Icon className="h-4 w-4" />
                          <span className="whitespace-nowrap">{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>
            </section>

            {catalogSection}
            {secondaryTabSection}
          </div>
        </div>
      </div>
      {publicView ? (
        <div className={`pointer-events-none fixed bottom-5 right-3 z-[70] flex flex-col gap-2 transition-opacity duration-200 sm:bottom-6 sm:right-6 ${publicScrollButtonsVisible ? 'opacity-100' : 'opacity-0'}`}>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/95 text-slate-600 shadow-[0_10px_24px_rgba(148,163,184,0.22)] backdrop-blur transition hover:bg-slate-50 hover:text-slate-950 dark:border-slate-700/80 dark:bg-slate-900/92 dark:text-slate-100 dark:hover:bg-slate-800"
            onClick={() => scrollPublicPortal('top')}
            aria-label={copy('scrollToTop', 'Move to top')}
            title={copy('scrollToTop', 'Move to top')}
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="pointer-events-auto inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/95 text-slate-600 shadow-[0_10px_24px_rgba(148,163,184,0.22)] backdrop-blur transition hover:bg-slate-50 hover:text-slate-950 dark:border-slate-700/80 dark:bg-slate-900/92 dark:text-slate-100 dark:hover:bg-slate-800"
            onClick={() => scrollPublicPortal('bottom')}
            aria-label={copy('scrollToBottom', 'Move to bottom')}
            title={copy('scrollToBottom', 'Move to bottom')}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <Suspense fallback={null}>
        <ImageGalleryLightbox
          open={productGalleryView.open && !!productGalleryView.items.length}
          title={productGalleryView.title}
          images={productGalleryView.items}
          index={productGalleryView.index}
          onClose={() => setProductGalleryView({ open: false, title: '', items: [], index: 0 })}
          onIndexChange={(index) => setProductGalleryView((current) => ({ ...current, index }))}
          labels={{
            prev: copy('prevImage', 'Prev'),
            next: copy('nextImage', 'Next'),
            imageCount: copy('imageCount', '{current}/{total}'),
            dotsLabel: copy('dotsLabel', 'Image {current} of {total}'),
          }}
          renderImage={(src, alt, className) => (
            <ProductImg src={src} alt={alt} className={className} />
          )}
        />
        <FilePickerModal
          open={filePicker.open}
          title={filePicker.title}
          mediaType={filePicker.mediaType}
          onClose={() => setFilePicker({ open: false, target: null, mediaType: 'image', title: 'Choose file' })}
          onSelect={handleFilePickerSelect}
        />
        <ImageGalleryLightbox
          open={portalImageView.open && !!portalImageView.images.length}
          title={portalImageView.title}
          images={portalImageView.images}
          index={portalImageView.index}
          onClose={() => setPortalImageView({ open: false, title: '', images: [], index: 0 })}
          onIndexChange={(index) => setPortalImageView((current) => ({ ...current, index }))}
          labels={{
            prev: copy('prevImage', 'Prev'),
            next: copy('nextImage', 'Next'),
            imageCount: copy('imageCount', '{current}/{total}'),
            dotsLabel: copy('dotsLabel', 'Image {current} of {total}'),
          }}
        />
      </Suspense>
    </div>
  )
}
