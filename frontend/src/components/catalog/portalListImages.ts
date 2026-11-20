import { useCallback, useEffect, useState } from 'react'

// The list and the saved items keep a product's id, name and price, not its picture (the account copy on the server is cut to those fields), so
// the page remembers the picture path of what was added in THIS browser. An item that arrived from another device has no picture here and the
// row shows a plain tile instead.
const STORAGE_KEY = 'business-os-portal-list-images-v1'
const MAX_REMEMBERED = 300

function readImages(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {}
  } catch {
    return {}
  }
}

/** Keeps the newest MAX_REMEMBERED pictures (insertion order is age). */
export function rememberImage(images: Record<string, string>, id: string | number, path: string): Record<string, string> {
  const key = String(id)
  const clean = String(path || '').trim()
  if (!key || !clean || images[key] === clean) return images
  const { [key]: _old, ...rest } = images
  const next = { ...rest, [key]: clean }
  const keys = Object.keys(next)
  return keys.length > MAX_REMEMBERED ? Object.fromEntries(keys.slice(keys.length - MAX_REMEMBERED).map((entry) => [entry, next[entry]])) : next
}

export function usePortalListImages() {
  const [images, setImages] = useState<Record<string, string>>(readImages)
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(images))
    } catch {
      // Storage can be unavailable (private browsing, quota): the pictures just are not remembered.
    }
  }, [images])
  const remember = useCallback((id: string | number, path: string) => setImages((current) => rememberImage(current, id, path)), [])
  const imageFor = useCallback((id: string | number) => images[String(id)] || '', [images])
  return { imageFor, remember }
}
