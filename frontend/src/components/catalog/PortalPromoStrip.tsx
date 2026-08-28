import { useEffect, useMemo, useRef, useState } from 'react'
import BadgePercent from 'lucide-react/dist/esm/icons/badge-percent.js'
import {
  evaluatePromotionPricing,
  isProductPromoted,
  promotionAutoLabel,
  type PromotionRule,
} from '../../utils/promotionRules.ts'

// G3 (Part 399): "one auto-scrolling row above search; '·' dots represent
// each promoted product/promotion, click a dot to jump. Promos render
// Title + discount." One horizontal strip that drifts on its own,
// pauses while the visitor is over/touching it, and offers a dot per
// item; clicking a dot scrolls that item into view. Deliberately
// dependency-free -- a scroll container plus requestAnimationFrame.

type PortalProduct = Record<string, unknown> & { id: number | string; name?: string }

type StripItem =
  | { kind: 'rule'; key: string; label: string; color: string }
  | { kind: 'product'; key: string; product: PortalProduct; label: string; priceText: string; color: string }

const MAX_PRODUCT_ITEMS = 12
const DRIFT_PX_PER_FRAME = 0.4

export default function PortalPromoStrip({
  products = [],
  promotionRules = [],
  copy,
  formatPrice,
  openProductDetail,
}: {
  products?: PortalProduct[]
  promotionRules?: PromotionRule[]
  copy: (key: string, fallback?: string) => string
  formatPrice: (usd: unknown, khr: unknown) => string
  openProductDetail?: (product: PortalProduct) => void
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const pausedRef = useRef(false)
  const [activeDot, setActiveDot] = useState(0)

  const items = useMemo<StripItem[]>(() => {
    const out: StripItem[] = []
    for (const rule of promotionRules) {
      // A hidden-title rule still advertises its shape via the percent/
      // amount auto-wording? No -- hidden means hidden: the rule's
      // products still appear below as product cards with their cut
      // prices; only the named campaign chip is suppressed.
      if (!rule.show_title) continue
      const label = rule.title || promotionAutoLabel(rule)
      if (!label) continue
      out.push({ kind: 'rule', key: `rule-${rule.id}`, label, color: rule.badge_color || '#e11d48' })
    }
    let taken = 0
    for (const product of products) {
      if (taken >= MAX_PRODUCT_ITEMS) break
      if (!isProductPromoted(product, promotionRules)) continue
      const evaluation = evaluatePromotionPricing(product, 1, promotionRules)
      taken++
      out.push({
        kind: 'product',
        key: `product-${product.id}`,
        product,
        label: String(product.name || ''),
        priceText: evaluation.active
          ? formatPrice(evaluation.unit_price_usd, evaluation.unit_price_khr)
          : (evaluation.title || copy('promotionBadge', 'Promo')),
        color: evaluation.badge_color || '#e11d48',
      })
    }
    return out
  }, [products, promotionRules, copy, formatPrice])

  // The drift: nudge scrollLeft each frame, wrap at the end, hold still
  // while the visitor interacts. Also keeps the active dot in sync with
  // whatever is currently at the left edge.
  useEffect(() => {
    const track = trackRef.current
    if (!track || items.length === 0) return
    let raf = 0
    const step = () => {
      if (!pausedRef.current && track.scrollWidth > track.clientWidth) {
        const max = track.scrollWidth - track.clientWidth
        track.scrollLeft = track.scrollLeft >= max - 1 ? 0 : track.scrollLeft + DRIFT_PX_PER_FRAME
      }
      const children = Array.from(track.children) as HTMLElement[]
      let current = 0
      for (let i = 0; i < children.length; i++) {
        if (children[i].offsetLeft <= track.scrollLeft + 8) current = i
      }
      setActiveDot((previous) => (previous === current ? previous : current))
      raf = window.requestAnimationFrame(step)
    }
    raf = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(raf)
  }, [items.length])

  if (items.length === 0) return null

  const jumpTo = (index: number) => {
    const track = trackRef.current
    const child = track?.children[index] as HTMLElement | undefined
    if (!track || !child) return
    pausedRef.current = true
    track.scrollTo({ left: child.offsetLeft, behavior: 'smooth' })
    // resume the drift shortly after the jump settles
    window.setTimeout(() => { pausedRef.current = false }, 2500)
  }

  return (
    <div className="mb-3">
      <div
        ref={trackRef}
        className="flex gap-2 overflow-x-auto scroll-smooth [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onPointerEnter={() => { pausedRef.current = true }}
        onPointerLeave={() => { pausedRef.current = false }}
        onTouchStart={() => { pausedRef.current = true }}
        onTouchEnd={() => { window.setTimeout(() => { pausedRef.current = false }, 2000) }}
      >
        {items.map((item) => item.kind === 'rule' ? (
          <span
            key={item.key}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-white shadow-sm"
            style={{ backgroundColor: item.color }}
          >
            <BadgePercent className="h-3.5 w-3.5" />
            {item.label}
          </span>
        ) : (
          <button
            key={item.key}
            type="button"
            onClick={() => openProductDetail?.(item.product)}
            className="inline-flex max-w-[14rem] shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs shadow-sm ring-1 ring-slate-200 hover:ring-rose-300 dark:bg-neutral-800 dark:ring-neutral-700"
          >
            <span className="truncate font-medium text-slate-700 dark:text-neutral-100">{item.label}</span>
            <span className="shrink-0 font-bold" style={{ color: item.color }}>{item.priceText}</span>
          </button>
        ))}
      </div>
      {items.length > 1 ? (
        <div className="mt-1.5 flex items-center justify-center gap-1">
          {items.map((item, index) => (
            <button
              key={item.key}
              type="button"
              aria-label={`${copy('promoStripJump', 'Jump to promotion')} ${index + 1}`}
              onClick={() => jumpTo(index)}
              className={`h-3 w-3 leading-none text-base ${index === activeDot ? 'text-rose-600' : 'text-slate-300 hover:text-slate-400 dark:text-neutral-600'}`}
            >
              ·
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
