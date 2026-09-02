import { useEffect, useRef, useState } from 'react'
import type { MouseEventHandler } from 'react'
import { resolveCatalogAssetUrl } from './catalogAssetUrls'
import { protectedImageProps } from '../../utils/protectedMedia'

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

export default function CatalogProductImage({ src, alt = '', className, onClick }: CatalogProductImageProps) {
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
      setUrl(resolveCatalogAssetUrl(safeSrc))
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
        className={`bg-gray-100 text-gray-400 dark:bg-neutral-700/80 dark:text-neutral-500 ${className || ''}`}
      />
    )
  }

  return (
    <img
      src={url}
      alt={alt}
      className={className}
      {...protectedImageProps()}
      onClick={onClick}
      onError={() => {
        markBrokenCatalogImage(safeSrc)
        setFailed(true)
      }}
      loading="lazy"
      decoding="async"
    />
  )
}
