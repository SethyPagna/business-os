import { useEffect, useRef, useState } from 'react'
import { getPortalPromotions } from '../../api/portalPublicTransport.ts'
import { resolvePublicAssetUrl } from '../../utils/publicAssetUrls.ts'

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

// A small, fixed rotation of on-brand gradients for cards with no image, so
// an image-less card still looks designed (matching the rose/orange
// gradient panel the existing "Promotions and posts" cards already use)
// instead of looking like a broken/incomplete card. Picked deterministically
// from the promotion id, so a given card's color doesn't shift on re-render.
const FALLBACK_GRADIENTS = [
  'from-rose-500 via-rose-500 to-orange-400',
  'from-sky-500 via-sky-500 to-cyan-400',
  'from-violet-500 via-violet-500 to-fuchsia-400',
  'from-emerald-500 via-emerald-500 to-teal-400',
]

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
}

export default function PortalPromotionsBanner({ copy, onOpenImage }: PortalPromotionsBannerProps) {
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
      const imageUrl = promo.image_path || promo.link_product_image
      if (imageUrl) {
        onOpenImage?.(promo.link_product_name || promo.title, [resolvePublicAssetUrl(imageUrl)])
      }
      return
    }
    if (promo.link_type === 'url' && promo.link_url) {
      const isExternal = /^https?:\/\//i.test(promo.link_url)
      if (isExternal) {
        window.open(promo.link_url, '_blank', 'noopener,noreferrer')
      } else {
        window.location.assign(promo.link_url)
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
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {!loaded
          ? [0, 1, 2].map((key) => <SkeletonCard key={key} />)
          : promotions.map((promo) => {
              const clickable = (promo.link_type === 'product' && promo.link_product_id && (promo.image_path || promo.link_product_image)) || (promo.link_type === 'url' && promo.link_url)
              const imageUrl = promo.image_path ? resolvePublicAssetUrl(promo.image_path) : ''
              return (
                <button
                  key={promo.id}
                  type="button"
                  onClick={clickable ? () => handleActivate(promo) : undefined}
                  disabled={!clickable}
                  className={`group relative flex min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm ring-1 ring-transparent transition-all duration-200 dark:border-neutral-700 dark:bg-neutral-900 ${
                    clickable ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg hover:ring-slate-200 dark:hover:ring-neutral-600' : 'cursor-default'
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
                      <span className="line-clamp-2 text-sm font-semibold leading-tight text-white/95">{promo.title}</span>
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-1 p-3">
                    {promo.badge_text ? (
                      <span
                        className="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white shadow-sm"
                        style={{ backgroundColor: promo.badge_color || '#dc2626' }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-white/80" />
                        {promo.badge_text}
                      </span>
                    ) : null}
                    <div className="text-sm font-semibold text-slate-900 dark:text-neutral-100">{promo.title}</div>
                    {promo.subtitle ? (
                      <div className="line-clamp-2 text-xs text-slate-500 dark:text-neutral-400">{promo.subtitle}</div>
                    ) : null}
                    {promo.link_type === 'product' && promo.link_product_name ? (
                      <div className="mt-auto flex items-center gap-1 pt-1 text-xs font-medium text-sky-600 transition-transform group-hover:translate-x-0.5 dark:text-amber-400">
                        {copy('portalPromotionsViewProduct', 'View')} {promo.link_product_name}
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
