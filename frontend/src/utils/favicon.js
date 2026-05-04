function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

const faviconDataUrlCache = new Map()
const MAX_FAVICON_CACHE_ITEMS = 12

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load favicon source'))
    image.src = source
    if (typeof image.decode === 'function') {
      image.decode().then(() => resolve(image)).catch(() => {})
    }
  })
}

/**
 * Render a square favicon image into a circular transparent frame so browser
 * tabs match the rounded logo treatment used inside the app.
 */
export async function createCircularFaviconDataUrl(source, options = {}) {
  if (!source || typeof document === 'undefined') return ''

  const {
    size = 96,
    fit = 'cover',
    zoom = 100,
    positionX = 50,
    positionY = 50,
  } = options
  const cacheKey = JSON.stringify({ source, size, fit, zoom, positionX, positionY })
  if (faviconDataUrlCache.has(cacheKey)) return faviconDataUrlCache.get(cacheKey)

  const image = await loadImage(source)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) return ''

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
  context.save()
  context.beginPath()
  context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2)
  context.closePath()
  context.clip()
  context.drawImage(image, drawX, drawY, drawWidth, drawHeight)
  context.restore()

  const dataUrl = canvas.toDataURL('image/png')
  faviconDataUrlCache.set(cacheKey, dataUrl)
  while (faviconDataUrlCache.size > MAX_FAVICON_CACHE_ITEMS) {
    faviconDataUrlCache.delete(faviconDataUrlCache.keys().next().value)
  }
  return dataUrl
}
