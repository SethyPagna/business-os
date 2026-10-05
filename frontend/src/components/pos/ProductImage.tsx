import { useEffect, useRef, useState } from 'react'
import { resolvePublicAssetUrl } from '../../utils/publicAssetUrls.ts'
import { toImageVariantPath } from '../../utils/imageVariantUrl.ts'

const BROKEN_PRODUCT_IMAGE_RETRY_MS = 5 * 60 * 1000
const brokenProductImageUrls = new Map<string, number>()

type ProductImageProps = {
  src?: string
  alt?: string
  className?: string
}

type ImageApi = {
  getImageDataUrl?: (src: string) => Promise<string | null | undefined>
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

export default function ProductImage({ src, alt, className }: ProductImageProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  // The thumbnail variant (/uploads/_v/w320/...) is tried first; if it fails to
  // load, the ORIGINAL is shown once before the image is treated as broken.
  const [variantFailedFor, setVariantFailedFor] = useState('')
  const imageRequestRef = useRef(0)
  const safeSrc = String(src || '').trim()
  const variantPath = variantFailedFor === safeSrc || !safeSrc.startsWith('/uploads/') ? null : toImageVariantPath(safeSrc)

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
    if (safeSrc.startsWith('data:') || safeSrc.startsWith('blob:') || safeSrc.startsWith('http')) {
      setUrl(safeSrc)
      return () => {
        imageRequestRef.current = requestId + 1
      }
    }
    if (safeSrc.startsWith('/uploads/')) {
      setUrl(variantPath ? resolvePublicAssetUrl(variantPath, { unversioned: true }) : resolvePublicAssetUrl(safeSrc))
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
        className={`bg-gray-100 text-gray-400 dark:bg-gray-700/80 dark:text-gray-500 ${className || ''}`}
      />
    )
  }
  return (
    <img
      src={url}
      alt={alt || ''}
      className={className}
      onError={() => {
        if (variantPath) { setVariantFailedFor(safeSrc); return }
        markBrokenProductImage(safeSrc)
        setFailed(true)
      }}
      loading="lazy"
      decoding="async"
    />
  )
}
