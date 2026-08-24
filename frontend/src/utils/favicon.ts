type FaviconFit = 'cover' | 'contain'

type FaviconOptions = {
  size?: number
  fit?: FaviconFit
  zoom?: number
  positionX?: number
  positionY?: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const faviconDataUrlCache = new Map<string, string>()
const MAX_FAVICON_CACHE_ITEMS = 12

function shouldUseAnonymousCors(source: unknown): boolean {
  const raw = String(source || '').trim()
  if (!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return false
  try {
    const url = new URL(raw, window.location.href)
    return url.origin !== window.location.origin
  } catch (_) {
    return false
  }
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    if (shouldUseAnonymousCors(source)) {
      image.crossOrigin = 'anonymous'
    }
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load favicon source'))
    image.src = source
    if (typeof image.decode === 'function') {
      image.decode().then(() => resolve(image)).catch(() => {})
    }
  })
}

function drawFaviconSourceToCanvas(
  image: HTMLImageElement,
  canvas: HTMLCanvasElement,
  options: Required<Pick<FaviconOptions, 'size' | 'fit' | 'zoom' | 'positionX' | 'positionY'>>,
): CanvasRenderingContext2D | null {
  const { size, fit, zoom, positionX, positionY } = options
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return null

  const normalizedZoom = clamp(Number(zoom) || 100, 80, 220) / 100
  const alignX = clamp(Number(positionX) || 50, 0, 100) / 100
  const alignY = clamp(Number(positionY) || 50, 0, 100) / 100

  const baseScale = fit === 'contain'
    ? Math.min(size / image.width, size / image.height)
    : Math.max(size / image.width, size / image.height)

  const drawWidth = image.width * baseScale * normalizedZoom
  const drawHeight = image.height * baseScale * normalizedZoom
  const drawX = (size - drawWidth) * alignX
  const drawY = (size - drawHeight) * alignY

  context.clearRect(0, 0, size, size)
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight)
  return context
}

/**
 * Render a square favicon image into a circular transparent frame so browser
 * tabs match the rounded logo treatment used inside the app.
 */
export async function createCircularFaviconDataUrl(source: string, options: FaviconOptions = {}): Promise<string> {
  if (!source || typeof document === 'undefined') return ''

  const {
    size = 96,
    fit = 'cover',
    zoom = 100,
    positionX = 50,
    positionY = 50,
  } = options
  const cacheKey = JSON.stringify({ shape: 'circle', source, size, fit, zoom, positionX, positionY })
  const cachedDataUrl = faviconDataUrlCache.get(cacheKey)
  if (cachedDataUrl) return cachedDataUrl

  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return ''
  context.save()
  context.beginPath()
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  context.closePath()
  context.clip()
  drawFaviconSourceToCanvas(image, canvas, { size, fit, zoom, positionX, positionY })
  context.restore()

  const dataUrl = canvas.toDataURL('image/png')
  faviconDataUrlCache.set(cacheKey, dataUrl)
  while (faviconDataUrlCache.size > MAX_FAVICON_CACHE_ITEMS) {
    const oldestKey = faviconDataUrlCache.keys().next().value
    if (!oldestKey) break
    faviconDataUrlCache.delete(oldestKey)
  }
  return dataUrl
}

// Full-bleed square render (no circular clip) -- unlike the browser-tab
// favicon above, PWA manifest icons should NOT come pre-masked: Android/
// Chrome apply their own shape mask (circle, squircle, etc.) over the
// square source, so a source that's already circular would show a visibly
// smaller, double-inset circle once the OS mask is applied on top of it.
// Used for the customer portal's dynamically-generated "Add to Home
// Screen" manifest icons (see CatalogPage.tsx) -- kept in this file
// rather than duplicated so both share the same load/fit/zoom/position
// handling and the same in-memory cache.
export async function createSquareIconDataUrl(source: string, options: FaviconOptions = {}): Promise<string> {
  if (!source || typeof document === 'undefined') return ''

  const {
    size = 192,
    fit = 'cover',
    zoom = 100,
    positionX = 50,
    positionY = 50,
  } = options
  const cacheKey = JSON.stringify({ shape: 'square', source, size, fit, zoom, positionX, positionY })
  const cachedDataUrl = faviconDataUrlCache.get(cacheKey)
  if (cachedDataUrl) return cachedDataUrl

  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  const context = drawFaviconSourceToCanvas(image, canvas, { size, fit, zoom, positionX, positionY })
  if (!context) return ''

  const dataUrl = canvas.toDataURL('image/png')
  faviconDataUrlCache.set(cacheKey, dataUrl)
  while (faviconDataUrlCache.size > MAX_FAVICON_CACHE_ITEMS) {
    const oldestKey = faviconDataUrlCache.keys().next().value
    if (!oldestKey) break
    faviconDataUrlCache.delete(oldestKey)
  }
  return dataUrl
}
