import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, TouchEvent as ReactTouchEvent, WheelEvent as ReactWheelEvent } from 'react'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import ZoomIn from 'lucide-react/dist/esm/icons/zoom-in.js'
import ZoomOut from 'lucide-react/dist/esm/icons/zoom-out.js'
import { protectedImageProps } from '../../utils/protectedMedia'

/**
 * Reusable gallery lightbox with arrows, dot navigation, and thumbnail rail.
 * Keep callers in control of state so the component stays simple and testable.
 */
type LightboxLabels = {
  prev?: string
  next?: string
  imageCount?: string
  dotsLabel?: string
}

type ImageGalleryLightboxProps = {
  open?: boolean
  title?: string
  images?: Array<string | null | undefined | false>
  index?: number
  onClose?: () => void
  onIndexChange?: (index: number) => void
  labels?: LightboxLabels
  renderImage?: (src: string, alt: string, className: string) => ReactNode
}

type LabelValues = Record<string, string | number>

// Zoom/pan constants. MIN_SCALE is always 1 (the image's normal
// object-contain fit) -- there's no "zoom out past fit", just reset.
const MIN_SCALE = 1
const MAX_SCALE = 4
const DOUBLE_TAP_SCALE = 2.5
const DOUBLE_TAP_MAX_INTERVAL_MS = 300
const WHEEL_ZOOM_SENSITIVITY = 0.0022
const ZOOM_BUTTON_STEP = 1

type ZoomState = { scale: number; x: number; y: number }
const RESET_ZOOM: ZoomState = { scale: MIN_SCALE, x: 0, y: 0 }

type PanPointer = { x: number; y: number }

export default function ImageGalleryLightbox({
  open = false,
  title = '',
  images = [],
  index = 0,
  onClose,
  onIndexChange,
  labels = {},
  renderImage,
}: ImageGalleryLightboxProps) {
  const safeImages = Array.isArray(images) ? images.filter(Boolean) as string[] : []
  const total = safeImages.length
  const safeIndex = total ? Math.max(0, Math.min(index, total - 1)) : 0
  const currentImage = total ? safeImages[safeIndex] : ''

  const copy = {
    prev: labels.prev || 'Prev',
    next: labels.next || 'Next',
    imageCount: labels.imageCount || '{current}/{total}',
    dotsLabel: labels.dotsLabel || 'Image {current} of {total}',
  }

  // Zoom/pan state for the CURRENT image only -- deliberately not part of
  // the caller's GalleryViewState (see CatalogPage.tsx/Products.tsx/
  // POS.tsx's own state shape), since it's transient view state, not
  // something a caller ever needs to read or persist across a re-render
  // triggered by something else. Reset (not carried over) whenever the
  // visible image changes or the lightbox closes -- carrying a zoom level
  // from one photo to a completely different one would be confusing, not
  // helpful; "persist through the gesture" (the actual ask) means it
  // shouldn't snap back to 1x the instant your finger lifts mid-gesture,
  // not that it should follow you between images.
  const [zoom, setZoom] = useState<ZoomState>(RESET_ZOOM)
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const stageRef = useRef<HTMLDivElement | null>(null)
  const imageWrapRef = useRef<HTMLDivElement | null>(null)
  // Active pointer/touch tracking for drag-to-pan (one finger/mouse button)
  // and pinch-to-zoom (two touches). Refs, not state -- these update every
  // pixel of movement and must never trigger a re-render on their own.
  const panStartRef = useRef<{ pointer: PanPointer; zoom: ZoomState } | null>(null)
  const pinchStartRef = useRef<{ distance: number; scale: number; midpoint: PanPointer; zoom: ZoomState } | null>(null)
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null)

  function formatLabel(template: string, values: LabelValues) {
    return String(template || '').replace(/\{(\w+)\}/g, (_match, key) => String(values?.[key] ?? ''))
  }

  function setIndex(nextIndex: number) {
    if (!total || typeof onIndexChange !== 'function') return
    const wrapped = (nextIndex + total) % total
    onIndexChange(wrapped)
  }

  function renderGalleryImage(src: string, alt: string, className: string) {
    if (typeof renderImage === 'function') return renderImage(src, alt, className)
    // Every caller except CatalogPreviewSurface.tsx (which supplies its own
    // renderImage using the already-protected CatalogProductImage) lands
    // here -- including ProductDetailFlyout.tsx's storefront lightbox and
    // any admin product-photo gallery use, so this default is where the
    // shared deterrence has to live for those to be covered at all.
    return <img src={src} alt={alt} className={className} {...protectedImageProps()} />
  }

  // Keeps a zoomed/panned image inside the stage rather than letting it
  // drift fully off-screen. Measures the image wrapper's own (untransformed
  // -- CSS `transform` doesn't affect offsetWidth/offsetHeight) layout size
  // against the stage's, so this works correctly for both a wide and a
  // portrait-oriented image rather than assuming a fixed aspect ratio.
  function clampPan(scale: number, x: number, y: number): PanPointer {
    const stage = stageRef.current
    const wrap = imageWrapRef.current
    if (!stage || !wrap || scale <= MIN_SCALE) return { x: 0, y: 0 }
    const stageRect = stage.getBoundingClientRect()
    const maxX = Math.max(0, (wrap.offsetWidth * scale - stageRect.width) / 2)
    const maxY = Math.max(0, (wrap.offsetHeight * scale - stageRect.height) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, x)), y: Math.max(-maxY, Math.min(maxY, y)) }
  }

  function applyZoom(nextScale: number, anchor?: PanPointer) {
    const clampedScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, nextScale))
    setZoom((current) => {
      if (clampedScale === MIN_SCALE) return RESET_ZOOM
      // Zooming around an anchor point (cursor/pinch midpoint/double-tap
      // location) rather than the image center -- without this, zooming in
      // on a corner of the image would recenter it and feel disorienting,
      // same complaint the "reverts/resets" ask was really about.
      const stage = stageRef.current
      if (anchor && stage) {
        const stageRect = stage.getBoundingClientRect()
        const originX = anchor.x - stageRect.left - stageRect.width / 2
        const originY = anchor.y - stageRect.top - stageRect.height / 2
        const scaleRatio = clampedScale / current.scale
        const nextX = originX - (originX - current.x) * scaleRatio
        const nextY = originY - (originY - current.y) * scaleRatio
        const clamped = clampPan(clampedScale, nextX, nextY)
        return { scale: clampedScale, x: clamped.x, y: clamped.y }
      }
      const clamped = clampPan(clampedScale, current.x, current.y)
      return { scale: clampedScale, x: clamped.x, y: clamped.y }
    })
  }

  function toggleDoubleTapZoom(point: PanPointer) {
    if (zoomRef.current.scale > MIN_SCALE) {
      setZoom(RESET_ZOOM)
    } else {
      applyZoom(DOUBLE_TAP_SCALE, point)
    }
  }

  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    // Only intercept the wheel for zoom when the pointer is actually over
    // the image stage and there's something to zoom (more than one image
    // or already zoomed) -- deltaY-based zoom, same direction convention
    // as Google Maps/Photos (scroll up/away = zoom in).
    event.preventDefault()
    const next = zoomRef.current.scale - event.deltaY * WHEEL_ZOOM_SENSITIVITY
    applyZoom(next, { x: event.clientX, y: event.clientY })
  }

  function handleDoubleClick(event: ReactMouseEvent<HTMLDivElement>) {
    toggleDoubleTapZoom({ x: event.clientX, y: event.clientY })
  }

  function distanceBetween(a: PanPointer, b: PanPointer): number {
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  function midpointBetween(a: PanPointer, b: PanPointer): PanPointer {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length === 2) {
      panStartRef.current = null
      const [a, b] = [event.touches[0], event.touches[1]]
      const pointA = { x: a.clientX, y: a.clientY }
      const pointB = { x: b.clientX, y: b.clientY }
      pinchStartRef.current = {
        distance: distanceBetween(pointA, pointB),
        scale: zoomRef.current.scale,
        midpoint: midpointBetween(pointA, pointB),
        zoom: zoomRef.current,
      }
      return
    }
    if (event.touches.length === 1) {
      pinchStartRef.current = null
      const touch = event.touches[0]
      const now = Date.now()
      const lastTap = lastTapRef.current
      if (lastTap && now - lastTap.time < DOUBLE_TAP_MAX_INTERVAL_MS && distanceBetween(lastTap, { x: touch.clientX, y: touch.clientY }) < 40) {
        lastTapRef.current = null
        toggleDoubleTapZoom({ x: touch.clientX, y: touch.clientY })
        return
      }
      lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY }
      if (zoomRef.current.scale > MIN_SCALE) {
        panStartRef.current = { pointer: { x: touch.clientX, y: touch.clientY }, zoom: zoomRef.current }
      }
    }
  }

  function handleTouchMove(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length === 2 && pinchStartRef.current) {
      event.preventDefault()
      const [a, b] = [event.touches[0], event.touches[1]]
      const pointA = { x: a.clientX, y: a.clientY }
      const pointB = { x: b.clientX, y: b.clientY }
      const start = pinchStartRef.current
      const ratio = distanceBetween(pointA, pointB) / (start.distance || 1)
      applyZoom(start.scale * ratio, midpointBetween(pointA, pointB))
      return
    }
    if (event.touches.length === 1 && panStartRef.current) {
      event.preventDefault()
      const touch = event.touches[0]
      const start = panStartRef.current
      const dx = touch.clientX - start.pointer.x
      const dy = touch.clientY - start.pointer.y
      const clamped = clampPan(start.zoom.scale, start.zoom.x + dx, start.zoom.y + dy)
      setZoom({ scale: start.zoom.scale, x: clamped.x, y: clamped.y })
    }
  }

  function handleTouchEnd(event: ReactTouchEvent<HTMLDivElement>) {
    if (event.touches.length < 2) pinchStartRef.current = null
    if (event.touches.length === 0) panStartRef.current = null
  }

  // Mouse drag-to-pan (desktop, once zoomed via wheel/double-click) --
  // pointer events rather than mousedown/mousemove so a drag that leaves
  // the image element mid-gesture is still tracked via pointer capture.
  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') return // touch has its own handlers above
    if (zoomRef.current.scale <= MIN_SCALE) return
    event.currentTarget.setPointerCapture(event.pointerId)
    panStartRef.current = { pointer: { x: event.clientX, y: event.clientY }, zoom: zoomRef.current }
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch' || !panStartRef.current) return
    const start = panStartRef.current
    const dx = event.clientX - start.pointer.x
    const dy = event.clientY - start.pointer.y
    const clamped = clampPan(start.zoom.scale, start.zoom.x + dx, start.zoom.y + dy)
    setZoom({ scale: start.zoom.scale, x: clamped.x, y: clamped.y })
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'touch') return
    panStartRef.current = null
  }

  // Reset zoom whenever the visible image changes (including on open) --
  // the "persist through the gesture" ask is about not snapping back
  // mid-pinch/drag, not about a zoom level following you to a different
  // photo.
  useEffect(() => {
    setZoom(RESET_ZOOM)
    panStartRef.current = null
    pinchStartRef.current = null
  }, [safeIndex, open])

  useEffect(() => {
    if (!open || !total) return undefined
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose?.()
      if (event.key === 'ArrowLeft' && zoomRef.current.scale <= MIN_SCALE) setIndex(safeIndex - 1)
      if (event.key === 'ArrowRight' && zoomRef.current.scale <= MIN_SCALE) setIndex(safeIndex + 1)
      if (event.key === '+' || event.key === '=') applyZoom(zoomRef.current.scale + ZOOM_BUTTON_STEP)
      if (event.key === '-') applyZoom(zoomRef.current.scale - ZOOM_BUTTON_STEP)
      if (event.key === '0') setZoom(RESET_ZOOM)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, total, safeIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !total) return null

  const isZoomed = zoom.scale > MIN_SCALE

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-2 backdrop-blur-md sm:p-4" onClick={() => onClose?.()}>
      {/* w-full/h-full up to a capped max on larger screens -- on a narrow
          phone this fills the safe viewport edge-to-edge (minus the outer
          p-2) rather than reserving a fixed vw fraction that could still
          overflow/clip on very small or very wide-aspect devices. */}
      <div className="relative flex h-full max-h-[92vh] w-full max-w-[98vw] flex-col justify-center sm:max-w-[min(92vw,1100px)]" onClick={(event) => event.stopPropagation()}>
        <div className="absolute right-1 top-1 z-20 flex items-center gap-1.5 sm:right-2 sm:top-2">
          <button
            type="button"
            className="rounded-full border border-white/20 bg-slate-950/45 p-2 text-white shadow-sm transition hover:bg-slate-950/65 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => applyZoom(zoom.scale - ZOOM_BUTTON_STEP)}
            disabled={!isZoomed}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="rounded-full border border-white/20 bg-slate-950/45 p-2 text-white shadow-sm transition hover:bg-slate-950/65 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={() => applyZoom(zoom.scale + ZOOM_BUTTON_STEP)}
            disabled={zoom.scale >= MAX_SCALE}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="rounded-full border border-white/20 bg-slate-950/45 p-2 text-white shadow-sm transition hover:bg-slate-950/65"
            onClick={() => onClose?.()}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.5rem] px-1 py-8 sm:px-2">
          <div className="mb-3 flex items-center justify-between gap-3 px-1 text-xs text-white/80">
            <span className="truncate">{title}</span>
            <span>{formatLabel(copy.imageCount, { current: safeIndex + 1, total })}</span>
          </div>
          {/* Stage: the fixed-size viewport the (possibly zoomed/panned)
              image is clipped to. Wheel/touch/pointer gesture handlers all
              live here rather than on the image itself, since the caller's
              renderImage() may return an <img> or a wrapped component
              (e.g. CatalogProductImage) we don't control the root node of.
              touch-action: none while zoomed stops the browser's own
              scroll/native-pinch from fighting the custom pan/zoom above
              MIN_SCALE; left as 'pan-y' at 1x so a vertical swipe on a
              touch device still reaches the page/modal's own scroll.
              The prev/next arrows are now overlaid directly on the stage's
              own edges (not the outer padded frame) so they sit on top of
              the image itself and don't reserve dedicated horizontal
              chrome -- more of the available width goes to the image. */}
          <div
            ref={stageRef}
            className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden ${isZoomed ? 'cursor-move' : ''}`}
            style={{ touchAction: isZoomed ? 'none' : 'pan-y' }}
            onWheel={handleWheel}
            onDoubleClick={handleDoubleClick}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          >
            <div
              ref={imageWrapRef}
              className="flex h-full w-full select-none items-center justify-center"
              style={{
                transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
                // No transition while actively dragging/pinching (would
                // lag behind the finger); a short one otherwise so the
                // double-tap/button zoom steps feel deliberate, not a
                // snap. Gesture-in-progress is approximated by whether a
                // pan/pinch ref is currently set.
                transition: panStartRef.current || pinchStartRef.current ? 'none' : 'transform 150ms ease-out',
              }}
            >
              {renderGalleryImage(currentImage, title || 'Image', 'block h-full w-full rounded-2xl object-contain shadow-2xl')}
            </div>
            {total > 1 && !isZoomed ? (
              <>
                <button
                  type="button"
                  className="absolute left-1 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-slate-950/45 p-1.5 text-white shadow-sm transition hover:bg-slate-950/70 sm:left-2 sm:p-2"
                  onClick={(event) => { event.stopPropagation(); setIndex(safeIndex - 1) }}
                  aria-label={copy.prev}
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-slate-950/45 p-1.5 text-white shadow-sm transition hover:bg-slate-950/70 sm:right-2 sm:p-2"
                  onClick={(event) => { event.stopPropagation(); setIndex(safeIndex + 1) }}
                  aria-label={copy.next}
                >
                  <ChevronRight className="h-5 w-5" />
                </button>
              </>
            ) : null}
          </div>
          <div className="mt-4 flex items-center justify-center">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {safeImages.map((image, thumbIndex) => (
                <button
                  key={`thumb-${image}-${thumbIndex}`}
                  type="button"
                  aria-label={formatLabel(copy.dotsLabel, { current: thumbIndex + 1, total })}
                  className={`flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border p-1 transition ${thumbIndex === safeIndex ? 'border-white/80 bg-white/15 ring-2 ring-white/30' : 'border-white/15 bg-white/5 hover:border-white/45'}`}
                  onClick={() => setIndex(thumbIndex)}
                >
                  {renderGalleryImage(image, `${title}-${thumbIndex + 1}`, 'h-full w-full object-contain')}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
