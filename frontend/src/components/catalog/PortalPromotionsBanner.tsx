import { useEffect, useRef, useState } from 'react'
import { safeLinkUrl } from '../../utils/safeLinkUrl.ts'
import { getPortalPromotions } from '../../api/portalPublicTransport.ts'
import { resolvePublicAssetUrl } from '../../utils/publicAssetUrls.ts'
import { PORTAL_MERCHANT_COLOR_DEFAULTS, ensureAccessibleSurface } from './portalContrast.ts'
import { microLabelProps } from './catalogUi.tsx'

type CopyFunction = (key: string, fallback?: string, fallbackKm?: string) => string

type PortalPromotion = {
  id: number
  title: string
  subtitle: string | null
  image_path: string | null
  link_type: 'none' | 'product' | 'url'
  link_url: string | null
  link_product_id: number | null
  link_product_name: string | null
  link_product_image: string | null
  badge_text: string | null
  badge_color: string | null
}

function resolveLinkType(value: unknown): 'none' | 'product' | 'url' {
  if (value === 'product' || value === 'url') return value
  return 'none'
}

function normalizePromotions(payload: unknown): PortalPromotion[] {
  const items = (payload && typeof payload === 'object' && 'items' in (payload as Record<string, unknown>))
    ? (payload as { items?: unknown }).items
    : payload
  if (!Array.isArray(items)) return []
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      id: Number(item.id) || 0,
      title: String(item.title || ''),
      subtitle: item.subtitle ? String(item.subtitle) : null,
      image_path: item.image_path ? String(item.image_path) : (item.link_product_image ? String(item.link_product_image) : null),
      link_type: resolveLinkType(item.link_type),
      link_url: item.link_url ? String(item.link_url) : null,
      link_product_id: item.link_product_id != null ? Number(item.link_product_id) : null,
      link_product_name: item.link_product_name ? String(item.link_product_name) : null,
      link_product_image: item.link_product_image ? String(item.link_product_image) : null,
      badge_text: item.badge_text ? String(item.badge_text) : null,
      badge_color: item.badge_color ? String(item.badge_color) : null,
    }))
    .filter((item) => item.title)
}

// A small, fixed rotation of brass and charcoal gradients for cards with no
// image, so an image-less card still looks designed instead of broken.
// Picked deterministically from the promotion id, so a given card's colour
// doesn't shift on re-render.
const FALLBACK_GRADIENTS = [
  // Every stop clears 4.5:1 against the white title these cards print on
  // top of it (a -400/-500 stop ran 1.81:1 to 4.23:1).
  'from-amber-800 via-amber-800 to-amber-700',
  'from-stone-800 via-stone-800 to-stone-700',
  'from-amber-900 via-amber-800 to-amber-700',
  'from-stone-700 via-stone-800 to-amber-800',
]

// One compact strip, not a wall of cards: the shopper came for products.
const MAX_PROMOTION_CARDS = 2

function fallbackGradientFor(id: number): string {
  return FALLBACK_GRADIENTS[Math.abs(id) % FALLBACK_GRADIENTS.length]
}

function SkeletonCard() {
  return (
    <div className="flex min-w-[260px] max-w-[320px] shrink-0 animate-pulse flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
      <div className="h-28 w-full bg-slate-200 dark:bg-neutral-800" />
      <div className="flex flex-col gap-2 p-3">
        <div className="h-3 w-16 rounded-full bg-slate-200 dark:bg-neutral-800" />
        <div className="h-4 w-3/4 rounded bg-slate-200 dark:bg-neutral-800" />
        <div className="h-3 w-1/2 rounded bg-slate-200 dark:bg-neutral-800" />
      </div>
    </div>
  )
}

export type PortalPromotionsBannerProps = {
  copy: CopyFunction
  onOpenImage?: (title: string, images: string[]) => void
  // "View <product>" opens the product's detail flyout (the page owner
  // resolves the id: loaded list, then one by-id search). The image
  // lightbox below is only the fallback for a surface that cannot.
  onOpenProduct?: (productId: number, productName: string) => void
}

export default function PortalPromotionsBanner({ copy, onOpenImage, onOpenProduct }: PortalPromotionsBannerProps) {
  const [promotions, setPromotions] = useState<PortalPromotion[]>([])
  const [loaded, setLoaded] = useState(false)
  const [showLeftFade, setShowLeftFade] = useState(false)
  const [showRightFade, setShowRightFade] = useState(false)
  const mountedRef = useRef(true)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    mountedRef.current = true
    getPortalPromotions()
      .then((payload) => {
        if (!mountedRef.current) return
        setPromotions(normalizePromotions(payload))
      })
      .catch(() => {
        // Promotions are a non-essential enhancement to the portal -- if the
        // request fails (offline, slow network, server hiccup), the catalog
        // itself must keep working. Fail silently to an empty banner rather
        // than showing an error state for a section nobody asked to see yet.
        if (mountedRef.current) setPromotions([])
      })
      .finally(() => {
        if (mountedRef.current) setLoaded(true)
      })
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Scroll-edge fade affordance: only show a fade (and thus hint "there's
  // more this way") on the side that actually has more content to reveal.
  // Recomputed on scroll and on resize, since a wider viewport can turn a
  // scrollable strip into one that already shows everything.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const updateFades = () => {
      const maxScroll = el.scrollWidth - el.clientWidth
      setShowLeftFade(el.scrollLeft > 4)
      setShowRightFade(el.scrollLeft < maxScroll - 4)
    }
    updateFades()
    el.addEventListener('scroll', updateFades, { passive: true })
    const resizeObserver = new ResizeObserver(updateFades)
    resizeObserver.observe(el)
    return () => {
      el.removeEventListener('scroll', updateFades)
      resizeObserver.disconnect()
    }
  }, [promotions])

  const handleActivate = (promo: PortalPromotion) => {
    if (promo.link_type === 'product' && promo.link_product_id) {
      if (onOpenProduct) {
        onOpenProduct(promo.link_product_id, promo.link_product_name || promo.title)
        return
      }
      const imageUrl = promo.image_path || promo.link_product_image
      if (imageUrl) {
        onOpenImage?.(promo.link_product_name || promo.title, [resolvePublicAssetUrl(imageUrl)])
      }
      return
    }
    if (promo.link_type === 'url' && promo.link_url) {
      // The Worker refuses to STORE anything but http(s) and site-relative
      // paths (lib/safeLinkUrl.ts). Rows written before that guard existed
      // are still in the table, and window.location.assign follows a
      // javascript: URL happily, so the same rule is applied again here on
      // the way out. A refused link does nothing rather than navigating
      // somewhere unexpected (N45).
      const target = safeLinkUrl(promo.link_url)
      if (!target) return
      if (/^https?:\/\//i.test(target)) {
        window.open(target, '_blank', 'noopener,noreferrer')
      } else {
        window.location.assign(target)
      }
    }
  }

  // While loading, show a brief skeleton rather than nothing -- avoids the
  // section popping into existence and shifting everything below it once
  // the request resolves. Once loaded with zero results, render nothing at
  // all: an empty promotions section should take up no space, not look like
  // a broken widget.
  if (loaded && promotions.length === 0) return null

  return (
    <section
      className="relative mb-4 -mx-1 px-1"
      aria-label={copy('announcementStripSection', 'Announcements')}
    >
      {showLeftFade ? (
        <div className="pointer-events-none absolute inset-y-0 left-1 z-10 w-8 bg-gradient-to-r from-white to-transparent dark:from-neutral-950" />
      ) : null}
      {showRightFade ? (
        <div className="pointer-events-none absolute inset-y-0 right-1 z-10 w-10 bg-gradient-to-l from-white to-transparent dark:from-neutral-950" />
      ) : null}
      <div
        ref={scrollRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {!loaded
          ? [0, 1].map((key) => <SkeletonCard key={key} />)
          : promotions.map((promo, index) => {
              const clickable = (promo.link_type === 'product' && promo.link_product_id && (onOpenProduct || promo.image_path || promo.link_product_image)) || (promo.link_type === 'url' && promo.link_url)
              const imageUrl = promo.image_path ? resolvePublicAssetUrl(promo.image_path) : ''
              // Past the second, a promotion is a compact chip in the same scrolling row: still reachable, not a wall of cards.
              if (index >= MAX_PROMOTION_CARDS) {
                return (
                  <button
                    key={promo.id}
                    type="button"
                    data-promotion-chip="true"
                    onClick={clickable ? () => handleActivate(promo) : undefined}
                    disabled={!clickable}
                    className="inline-flex min-h-11 max-w-[16rem] shrink-0 snap-start items-center rounded-full border border-amber-300 bg-white px-4 py-2 text-left text-xs font-semibold text-amber-950 dark:border-amber-500/30 dark:bg-neutral-900 dark:text-amber-200"
                  >
                    <span className="break-words">{promo.title}</span>
                  </button>
                )
              }
              // badge_color is typed by the merchant, so the ink cannot be a
              // hardcoded white -- pick it, and darken/lighten the fill only
              // as far as 4.5:1 requires.
              const badgeSurface = ensureAccessibleSurface(promo.badge_color, 'text', PORTAL_MERCHANT_COLOR_DEFAULTS.promotionBadge)
              return (
                <button
                  key={promo.id}
                  type="button"
                  onClick={clickable ? () => handleActivate(promo) : undefined}
                  disabled={!clickable}
                  className={`group relative flex min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm ring-1 ring-transparent transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 ${
                    clickable ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:ring-amber-300 dark:hover:ring-amber-500/40' : 'cursor-default'
                  }`}
                >
                  {imageUrl ? (
                    <div className="relative h-28 w-full overflow-hidden bg-slate-100 dark:bg-neutral-800">
                      <img
                        src={imageUrl}
                        alt={promo.title}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/25 to-transparent" />
                    </div>
                  ) : (
                    <div className={`flex h-28 w-full items-center justify-center bg-gradient-to-br ${fallbackGradientFor(promo.id)} px-4 text-center`}>
                      <span className="break-words text-sm font-semibold leading-snug text-white">{promo.title}</span>
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    {promo.badge_text ? (
                      <span
                        {...microLabelProps(promo.badge_text, 'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 font-semibold shadow-sm', 'text-[11px] uppercase tracking-wide')}
                        style={{ backgroundColor: badgeSurface.background, color: badgeSurface.color }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: badgeSurface.color }} aria-hidden="true" />
                        {promo.badge_text}
                      </span>
                    ) : null}
                    <div className="break-words text-sm font-semibold leading-snug text-slate-900 dark:text-neutral-100">{promo.title}</div>
                    {promo.subtitle ? (
                      <div className="break-words text-xs leading-snug text-slate-500 dark:text-neutral-400">{promo.subtitle}</div>
                    ) : null}
                    {promo.link_type === 'product' && promo.link_product_name ? (
                      <div className="mt-auto flex items-center gap-1 pt-1 text-xs font-medium text-amber-800 transition-transform group-hover:translate-x-0.5 dark:text-amber-400">
                        {copy('portalPromotionsViewProduct', 'View')} <span translate="no" className="notranslate">{promo.link_product_name}</span>
                        <span aria-hidden="true">→</span>
                      </div>
                    ) : null}
                  </div>
                </button>
              )
            })}
      </div>
    </section>
  )
}
