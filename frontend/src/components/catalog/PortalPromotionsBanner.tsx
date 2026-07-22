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

export type PortalPromotionsBannerProps = {
  copy: CopyFunction
  onOpenImage?: (title: string, images: string[]) => void
}

export default function PortalPromotionsBanner({ copy, onOpenImage }: PortalPromotionsBannerProps) {
  const [promotions, setPromotions] = useState<PortalPromotion[]>([])
  const [loaded, setLoaded] = useState(false)
  const mountedRef = useRef(true)

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

  // Render nothing at all once loaded-with-zero-results, rather than an
  // empty bordered box -- a promotions section with nothing in it should
  // take up no space, not look like a broken/empty widget.
  if (!loaded || promotions.length === 0) return null

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

  return (
    <section
      className="mb-4 -mx-1 px-1"
      aria-label={copy('announcementStripSection', 'Announcements')}
    >
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {promotions.map((promo) => {
          const clickable = (promo.link_type === 'product' && promo.link_product_id && (promo.image_path || promo.link_product_image)) || (promo.link_type === 'url' && promo.link_url)
          const imageUrl = promo.image_path ? resolvePublicAssetUrl(promo.image_path) : ''
          return (
            <button
              key={promo.id}
              type="button"
              onClick={clickable ? () => handleActivate(promo) : undefined}
              disabled={!clickable}
              className={`group relative flex min-w-[260px] max-w-[320px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition dark:border-slate-700 dark:bg-slate-900 ${
                clickable ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md' : 'cursor-default'
              }`}
            >
              {imageUrl ? (
                <div className="h-28 w-full overflow-hidden bg-slate-100 dark:bg-slate-800">
                  <img
                    src={imageUrl}
                    alt={promo.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                </div>
              ) : null}
              <div className="flex flex-1 flex-col gap-1 p-3">
                {promo.badge_text ? (
                  <span
                    className="inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white"
                    style={{ backgroundColor: promo.badge_color || '#dc2626' }}
                  >
                    {promo.badge_text}
                  </span>
                ) : null}
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{promo.title}</div>
                {promo.subtitle ? (
                  <div className="text-xs text-slate-500 dark:text-slate-400">{promo.subtitle}</div>
                ) : null}
                {promo.link_type === 'product' && promo.link_product_name ? (
                  <div className="mt-auto pt-1 text-xs font-medium text-sky-600 dark:text-sky-400">
                    {copy('portalPromotionsViewProduct', 'View')} {promo.link_product_name} →
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
