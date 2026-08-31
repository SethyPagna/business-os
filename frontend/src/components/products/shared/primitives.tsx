import { useEffect, useRef, useState } from 'react'
import type { MouseEventHandler, TouchEventHandler, ReactNode, PointerEvent as ReactPointerEvent } from 'react'
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle.js'
import ImageOff from 'lucide-react/dist/esm/icons/image-off.js'
import { resolvePublicAssetUrl } from '../../../utils/publicAssetUrls.ts'

const BROKEN_PRODUCT_IMAGE_RETRY_MS = 5 * 60 * 1000
const brokenProductImageUrls = new Map<string, number>()

type ImageApi = {
  getImageDataUrl?: (src: string) => Promise<string | null | undefined>
}

interface ProductImgProps {
  src?: string | null
  alt?: string
  className?: string
  onClick?: MouseEventHandler<HTMLImageElement>
  // A clickable thumbnail usually sits inside a row that has its OWN
  // press handling (long-press to enter select mode, tap to open the
  // detail -- see utils/longPress.ts). Those bind mousedown/touchstart,
  // which fire BEFORE click, so an onClick that only stops click
  // propagation does not stop the row from also reacting. Exposing the
  // press events lets a caller stop the gesture at its start.
  onMouseDown?: MouseEventHandler<HTMLImageElement>
  onTouchStart?: TouchEventHandler<HTMLImageElement>
}

interface ProductImagePlaceholderProps {
  className?: string
  compact?: boolean
}

interface MarginCardProps {
  costUsd: number
  sellingUsd: number
  usdSymbol: string
}

interface DualPriceInputProps {
  labelUsd: string
  labelKhr: string
  valueUsd?: string | number | null
  valueKhr?: string | number | null
  onUsdChange: (value: string) => void
  onKhrChange: (value: string) => void
  usdSymbol: string
  khrSymbol: string
  exchangeRate?: number
  t?: (key: string) => string | undefined
}

interface SanitizeNumericInputOptions {
  allowDecimal?: boolean
  allowNegative?: boolean
}

function getImageApi(): ImageApi | undefined {
  return (window as Window & { api?: ImageApi }).api
}

function isRecentlyBrokenProductImage(src: string): boolean {
  const lastFailedAt = Number(brokenProductImageUrls.get(src) || 0)
  if (!lastFailedAt) return false
  if ((Date.now() - lastFailedAt) < BROKEN_PRODUCT_IMAGE_RETRY_MS) return true
  brokenProductImageUrls.delete(src)
  return false
}

function markBrokenProductImage(src: string): void {
  if (!src) return
  brokenProductImageUrls.set(src, Date.now())
}

function sanitizeNumericInput(value: unknown, { allowDecimal = true, allowNegative = false }: SanitizeNumericInputOptions = {}): string {
  let next = String(value ?? '').replace(/,/g, '').replace(/[^\d.-]/g, '')
  if (!allowNegative) next = next.replace(/-/g, '')
  else if (next.includes('-')) next = `${next.startsWith('-') ? '-' : ''}${next.replace(/-/g, '')}`
  if (!allowDecimal) return next.replace(/\./g, '')
  const dotIndex = next.indexOf('.')
  if (dotIndex === -1) return next
  return `${next.slice(0, dotIndex + 1)}${next.slice(dotIndex + 1).replace(/\./g, '')}`
}

function parseNumericInput(value: unknown, fallback = 0): number {
  if (value === '' || value === null || typeof value === 'undefined') return fallback
  const parsed = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function ProductImg({ src, alt = '', className, onClick, onMouseDown, onTouchStart }: ProductImgProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const imageRequestRef = useRef(0)
  const safeSrc = String(src || '').trim()

  useEffect(() => {
    const requestId = imageRequestRef.current + 1
    imageRequestRef.current = requestId
    setFailed(false)
    if (!safeSrc) {
      setUrl(null)
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }
    if (isRecentlyBrokenProductImage(safeSrc)) {
      setFailed(true)
      setUrl(null)
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }
    if (safeSrc.startsWith('data:') || safeSrc.startsWith('blob:')) {
      setUrl(safeSrc)
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }
    if (safeSrc.startsWith('http')) {
      setUrl(safeSrc)
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }
    if (safeSrc.startsWith('/uploads/')) {
      setUrl(resolvePublicAssetUrl(safeSrc))
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }
    const appApi = getImageApi()
    if (appApi?.getImageDataUrl) {
      async function loadImageData() {
        try {
          const data = await appApi?.getImageDataUrl?.(safeSrc)
          if (imageRequestRef.current !== requestId) return
          setUrl(data || null)
        } catch {
          if (imageRequestRef.current !== requestId) return
          setUrl(null)
        }
      }
      void loadImageData()
    } else {
      setUrl(null)
    }

    return () => {
      imageRequestRef.current = requestId + 1
    }
  }, [safeSrc])

  if (!url || failed) {
    return (
      <div
        aria-hidden="true"
        className={`bg-gray-100 text-gray-400 dark:bg-gray-700/80 dark:text-gray-500 ${className || ''}`}
      />
    )
  }
  return (
    <img
      src={url}
      alt={alt}
      className={className}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onError={() => {
        markBrokenProductImage(safeSrc)
        setFailed(true)
      }}
      loading="lazy"
      decoding="async"
    />
  )
}

function ProductImagePlaceholder({ className = '', compact = false }: ProductImagePlaceholderProps) {
  return (
    <div className={`flex items-center justify-center rounded-xl bg-gray-100 text-gray-400 dark:bg-gray-700/80 dark:text-gray-500 ${className}`}>
      <ImageOff className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
    </div>
  )
}

function MarginCard({ costUsd, sellingUsd, usdSymbol }: MarginCardProps) {
  const margin = sellingUsd - costUsd
  const pct = sellingUsd > 0 ? (margin / sellingUsd * 100) : 0
  const isProfit = margin >= 0

  return (
    <div className={`rounded-xl border p-4 ${isProfit ? 'border-blue-100 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20' : 'border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-900/20'}`}>
      <p className="mb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Margin Analysis</p>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-lg font-bold text-red-600">{usdSymbol}{costUsd.toFixed(2)}</div>
          <div className="text-xs text-gray-500">Cost</div>
        </div>
        <div>
          <div className={`text-lg font-bold ${isProfit ? 'text-blue-600' : 'text-yellow-600'}`}>{usdSymbol}{margin.toFixed(2)}</div>
          <div className="text-xs text-gray-500">Margin ({pct.toFixed(1)}%)</div>
        </div>
        <div>
          <div className="text-lg font-bold text-green-600">{usdSymbol}{sellingUsd.toFixed(2)}</div>
          <div className="text-xs text-gray-500">Selling</div>
        </div>
      </div>
      {!isProfit ? (
        <p className="mt-2 flex items-center justify-center gap-1 text-xs text-yellow-600 dark:text-yellow-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          Selling price is below purchase price
        </p>
      ) : null}
    </div>
  )
}

function DualPriceInput({ labelUsd, labelKhr, valueUsd, valueKhr, onUsdChange, onKhrChange, usdSymbol, khrSymbol }: DualPriceInputProps) {
  const handleUsdChange = (val: string) => onUsdChange(sanitizeNumericInput(val))
  const handleKhrChange = (val: string) => onKhrChange(sanitizeNumericInput(val))

  return (
    <div className="grid grid-cols-2 gap-2">
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{labelUsd} ({usdSymbol})</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{usdSymbol}</span>
          <input
            className="input pl-7"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={valueUsd ?? ''}
            onChange={(event) => handleUsdChange(event.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">{labelKhr} ({khrSymbol})</label>
        <div className="relative">
          <input
            className="input pr-7"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={valueKhr ?? ''}
            onChange={(event) => handleKhrChange(event.target.value)}
            placeholder="0"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">{khrSymbol}</span>
        </div>
      </div>
    </div>
  )
}

// Single-line text a user can pan horizontally to read the full value
// when it overflows, in place of a hard `truncate` (user, Aug 31 2026:
// "for long names do a scroll -- don't show the scroll icon, just built
// in when they touch or click hold move on the name"). Used on the
// small-screen product card so a long product name stays fully
// readable without opening the detail.
//
//  - Touch: the browser's own overflow-x panning handles it, and the
//    events keep bubbling so the card's tap-to-open / long-press-to-
//    select gestures still work -- a pan past tolerance simply cancels
//    them (see utils/longPress.ts), which is exactly right, since a pan
//    is neither a tap nor a hold.
//  - Mouse: click-drag is wired up manually below (native overflow-x
//    does not drag-scroll with a mouse), and its press/click events are
//    stopped from reaching the card so dragging to read never opens the
//    detail flyout or trips select mode.
//  - The scrollbar itself is hidden on every engine (WebKit/Blink,
//    Firefox, old Edge) so only the text moves, no chrome.
function DragScrollText({ children, className = '', title, lang }: {
  children: ReactNode
  className?: string
  title?: string
  lang?: 'km'
}) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false })

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return // native scroll handles touch
    const el = ref.current
    if (!el || el.scrollWidth <= el.clientWidth) return // nothing to pan
    drag.current = { active: true, startX: event.clientX, scrollLeft: el.scrollLeft, moved: false }
    try { el.setPointerCapture(event.pointerId) } catch { /* pre-pointer-capture browsers */ }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!drag.current.active || !el) return
    const dx = event.clientX - drag.current.startX
    if (Math.abs(dx) > 3) drag.current.moved = true
    el.scrollLeft = drag.current.scrollLeft - dx
  }
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return
    drag.current.active = false
    try { ref.current?.releasePointerCapture(event.pointerId) } catch { /* ignore */ }
  }

  return (
    <div
      ref={ref}
      title={title}
      lang={lang}
      // touch-action: pan-x lets a finger pan this strip horizontally even
      // though the scroll ancestors (.page-scroll / body) set
      // `touch-action: pan-y pinch-zoom` — without it the browser refuses the
      // horizontal gesture on touch, so a long product name could not be
      // swiped to read (user, Sep 1 2026, on a phone). Mouse panning is
      // handled by the pointer handlers above; this only re-enables the
      // native touch scroll the onPointerDown handler defers to.
      className={`overflow-x-auto whitespace-nowrap [touch-action:pan-x] [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      // Keep MOUSE presses off the card gesture (touch is left to bubble
      // so tap-to-open still works); swallow the click that ends a real
      // drag so panning to read never opens the detail.
      onMouseDown={(event) => event.stopPropagation()}
      onMouseUp={(event) => event.stopPropagation()}
      onClickCapture={(event) => { if (drag.current.moved) { event.stopPropagation(); drag.current.moved = false } }}
    >
      {children}
    </div>
  )
}

export { ProductImg, ProductImagePlaceholder, MarginCard, DualPriceInput, DragScrollText, sanitizeNumericInput, parseNumericInput }
