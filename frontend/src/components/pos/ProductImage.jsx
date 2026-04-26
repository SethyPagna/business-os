// ── ProductImage ─────────────────────────────────────────────────────────────
// Resolves product image to a browser-displayable URL.
// Handles data-URLs, HTTP URLs, sync-server /uploads/ paths, and Electron paths.

import { useState, useEffect } from 'react'

export default function ProductImage({ src, alt, className }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!src) { setUrl(null); return }
    if (src.startsWith('data:') || src.startsWith('blob:') || src.startsWith('http')) {
      setUrl(src); return
    }
    if (src.startsWith('/uploads/')) {
      const base = window.api?.getSyncServerUrl?.()
        || localStorage.getItem('businessos_sync_server') || ''
      setUrl(base ? `${base.replace(/\/$/, '')}${src}` : null)
      return
    }
    window.api?.getImageDataUrl?.(src).then(d => setUrl(d || null))
  }, [src])
  if (!url) return null
  return <img src={url} alt={alt} className={className} />
}

/**
 * A single row in the cart list.
 * Extracted into its own component to keep the POS render readable and to
 * make future unit testing straightforward.
 */
