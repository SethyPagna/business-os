import { useEffect } from 'react'
import type { ReactNode } from 'react'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right.js'
import X from 'lucide-react/dist/esm/icons/x.js'

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
    return <img src={src} alt={alt} className={className} />
  }

  useEffect(() => {
    if (!open || !total) return undefined
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose?.()
      if (event.key === 'ArrowLeft') setIndex(safeIndex - 1)
      if (event.key === 'ArrowRight') setIndex(safeIndex + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, total, safeIndex]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open || !total) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/35 p-3 backdrop-blur-md sm:p-4" onClick={() => onClose?.()}>
      <div className="relative flex h-[75vh] w-full max-w-[75vw] flex-col justify-center sm:max-w-[min(75vw,1100px)]" onClick={(event) => event.stopPropagation()}>
        <div className="absolute inset-y-0 left-0 z-20 flex items-center">
          <button
            type="button"
            className="rounded-full border border-white/20 bg-slate-950/45 p-2 text-white shadow-sm transition hover:bg-slate-950/65"
            onClick={() => setIndex(safeIndex - 1)}
            aria-label={copy.prev}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </div>
        <div className="absolute inset-y-0 right-0 z-20 flex items-center">
          <button
            type="button"
            className="rounded-full border border-white/20 bg-slate-950/45 p-2 text-white shadow-sm transition hover:bg-slate-950/65"
            onClick={() => setIndex(safeIndex + 1)}
            aria-label={copy.next}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
        <div className="absolute right-0 top-0 z-20">
          <button
            type="button"
            className="rounded-full border border-white/20 bg-slate-950/45 p-2 text-white shadow-sm transition hover:bg-slate-950/65"
            onClick={() => onClose?.()}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[2rem] px-10 py-8 sm:px-14">
          <div className="mb-3 flex items-center justify-between gap-3 px-1 text-xs text-white/80">
            <span className="truncate">{title}</span>
            <span>{formatLabel(copy.imageCount, { current: safeIndex + 1, total })}</span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            {renderGalleryImage(currentImage, title || 'Image', 'max-h-full max-w-full rounded-2xl object-contain shadow-2xl')}
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
    </div>
  )
}
