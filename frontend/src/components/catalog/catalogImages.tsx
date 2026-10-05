import { useEffect, useRef, useState } from 'react'
import type { MouseEventHandler } from 'react'
import { resolveCatalogAssetUrl } from './catalogAssetUrls'
import { imageVariantSrcSet, toImageVariantPath } from '../../utils/imageVariantUrl.ts'

const BROKEN_CATALOG_IMAGE_RETRY_MS = 5 * 60 * 1000
const brokenCatalogImageUrls = new Map<string, number>()

type ImageApi = {
  getImageDataUrl?: (src: string) => Promise<string | null | undefined>
}

type CatalogProductImageProps = {
  src?: string | null
  alt?: string
  className?: string
  onClick?: MouseEventHandler<HTMLImageElement>
  /**
   * A grid / strip tile, not a viewer: request the small persisted variant
   * (/uploads/_v/w320/...) instead of the ~0.84 MB original. A variant that
   * fails to load falls back to the original once. Leave it off wherever the
   * photo is shown large (lightbox, hero).
   */
  thumbnail?: boolean
  /**
   * With `thumbnail`: the tile's rendered width (an image sizes value) so a
   * dense display can take the 640 px variant. Without it only the 320 px one
   * is used.
   */
  sizes?: string
}

function getImageApi(): ImageApi | undefined {
  return (window as Window & { api?: ImageApi }).api
}

function isRecentlyBrokenCatalogImage(src: string): boolean {
  const lastFailedAt = Number(brokenCatalogImageUrls.get(src) || 0)
  if (!lastFailedAt) return false
  if ((Date.now() - lastFailedAt) < BROKEN_CATALOG_IMAGE_RETRY_MS) return true
  brokenCatalogImageUrls.delete(src)
  return false
}

function markBrokenCatalogImage(src: string): void {
  if (!src) return
  brokenCatalogImageUrls.set(src, Date.now())
}

export default function CatalogProductImage({ src, alt = '', className, onClick, thumbnail = false, sizes }: CatalogProductImageProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [variantFailedFor, setVariantFailedFor] = useState('')
  const imageRequestRef = useRef(0)
  const safeSrc = String(src || '').trim()
  const variantPath = thumbnail && variantFailedFor !== safeSrc && safeSrc.startsWith('/uploads/') ? toImageVariantPath(safeSrc) : null
  const srcSet = variantPath && sizes ? imageVariantSrcSet(safeSrc, (path) => resolveCatalogAssetUrl(path)) : ''

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

    if (isRecentlyBrokenCatalogImage(safeSrc)) {
      setFailed(true)
      setUrl(null)
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }

    if (safeSrc.startsWith('data:') || safeSrc.startsWith('blob:') || safeSrc.startsWith('http')) {
      setUrl(safeSrc)
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }

    if (safeSrc.startsWith('/uploads/')) {
      setUrl(resolveCatalogAssetUrl(variantPath || safeSrc))
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
  }, [safeSrc, variantPath])

  if (!url || failed) {
    return (
      <div
        aria-hidden="true"
        className={`bg-gray-100 text-gray-400 dark:bg-neutral-700/80 dark:text-neutral-500 ${className || ''}`}
      />
    )
  }

  return (
    <img
      src={url}
      srcSet={srcSet || undefined}
      sizes={srcSet ? sizes : undefined}
      alt={alt}
      // An empty alt is the caller saying "this image carries nothing the
      // surrounding markup does not already say" (the flyout thumbnail
      // strip, where the BUTTON carries the name). Take it out of the
      // accessibility tree entirely rather than leaving a nameless
      // graphic in it.
      aria-hidden={alt ? undefined : true}
      className={className}
      data-protected-media="true"
      draggable={false}
      onContextMenu={(event) => event.preventDefault()}
      onDragStart={(event) => event.preventDefault()}
      onClick={onClick}
      onError={() => {
        if (variantPath) { setVariantFailedFor(safeSrc); return }
        markBrokenCatalogImage(safeSrc)
        setFailed(true)
      }}
      loading="lazy"
      decoding="async"
    />
  )
}
