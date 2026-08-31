import { useCallback, useEffect, useMemo, useState } from 'react'
import { fmtDateTime24 } from '../../utils/formatters.ts'

// The "bucket" is a customer-facing shortlist on the public portal --
// NOT a cart, no payment, no order submitted anywhere. A visitor taps
// "Add" on products they're interested in, then from the bucket drawer
// can copy the list to their clipboard or download it as a text file,
// to show/send to staff through whatever channel they like (in person,
// Messenger, Telegram, etc). Persisted client-side (localStorage) for
// GUESTS, scoped to this browser; when a customer signs in (§2) the same
// list is ALSO mirrored to their account so it follows them across devices
// (PublicCatalogPage owns that sync — see setAll + mergeBucketItems here).
// Nothing here is ever charged or fulfilled by the app.

export type PortalBucketItem = {
  id: string | number
  name: string
  category?: string
  brand?: string
  priceText?: string
  qty: number
}

const STORAGE_KEY = 'business-os-portal-bucket-v1'
const MAX_QTY = 999

function readStoredBucket(): PortalBucketItem[] {
  if (typeof window === 'undefined') return []
  try {
    return sanitizeBucketItems(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]'))
  } catch {
    return []
  }
}

function writeStoredBucket(items: PortalBucketItem[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Storage can be unavailable (private browsing, quota, disabled) --
    // the bucket just won't persist across reloads in that case, not fatal.
  }
}

// Plain, no-React lookup backing `getQty` -- returns 0 for an id that isn't
// in the bucket rather than undefined, so callers can use it directly in
// arithmetic/comparisons (e.g. `qty > 0`) without a null check.
export function findItemQty(items: PortalBucketItem[], id: string | number): number {
  return items.find((item) => String(item.id) === String(id))?.qty ?? 0
}

export function usePortalBucket() {
  const [items, setItems] = useState<PortalBucketItem[]>(() => readStoredBucket())

  useEffect(() => {
    writeStoredBucket(items)
  }, [items])

  const add = useCallback((
    product: { id: string | number; name?: string; category?: string; brand?: string },
    priceText?: string,
    qty = 1,
  ) => {
    setItems((current) => {
      const existing = current.find((item) => String(item.id) === String(product.id))
      if (existing) {
        return current.map((item) => (
          String(item.id) === String(product.id)
            ? { ...item, priceText: priceText ?? item.priceText, qty: Math.max(1, Math.min(MAX_QTY, item.qty + qty)) }
            : item
        ))
      }
      return [
        ...current,
        {
          id: product.id,
          name: String(product.name || '').trim(),
          category: product.category ? String(product.category) : undefined,
          brand: product.brand ? String(product.brand) : undefined,
          priceText,
          qty: Math.max(1, Math.min(MAX_QTY, qty)),
        },
      ]
    })
  }, [])

  const remove = useCallback((id: string | number) => {
    setItems((current) => current.filter((item) => String(item.id) !== String(id)))
  }, [])

  const setQty = useCallback((id: string | number, qty: number) => {
    setItems((current) => current.map((item) => (
      String(item.id) === String(id)
        ? { ...item, qty: Math.max(1, Math.min(MAX_QTY, Math.round(qty) || 1)) }
        : item
    )))
  }, [])

  const clear = useCallback(() => setItems([]), [])

  // Replace the whole list — used by PublicCatalogPage to load an account's
  // server-stored cart and to write back a guest→account merge. Sanitized
  // through the same clamps as a stored read so a server payload can't inject
  // bad shapes.
  const setAll = useCallback((next: PortalBucketItem[]) => {
    setItems(sanitizeBucketItems(next))
  }, [])

  const count = useMemo(() => items.reduce((sum, item) => sum + item.qty, 0), [items])
  const hasItem = useCallback(
    (id: string | number) => items.some((item) => String(item.id) === String(id)),
    [items],
  )
  // Per-item quantity, for the product-card Add button badge -- distinct
  // from `hasItem` (boolean membership) and `count` (total across every
  // item), since the card needs to show/keep incrementing *this specific*
  // product's own qty as the person taps Add repeatedly. Delegates to the
  // plain exported `findItemQty` below so the lookup itself is testable
  // without a React render, same as `formatPortalBucketText` already is.
  const getQty = useCallback(
    (id: string | number) => findItemQty(items, id),
    [items],
  )

  return { items, add, remove, setQty, clear, setAll, count, hasItem, getQty }
}

// Shared sanitizer so a stored read, a server payload, and a merge all clamp
// items the same way (bounded qty, required id + name).
function sanitizeBucketItems(raw: unknown): PortalBucketItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((entry): PortalBucketItem => ({
      id: (entry as PortalBucketItem)?.id,
      name: String((entry as PortalBucketItem)?.name || '').trim(),
      category: (entry as PortalBucketItem)?.category ? String((entry as PortalBucketItem).category) : undefined,
      brand: (entry as PortalBucketItem)?.brand ? String((entry as PortalBucketItem).brand) : undefined,
      priceText: (entry as PortalBucketItem)?.priceText ? String((entry as PortalBucketItem).priceText) : undefined,
      qty: Math.max(1, Math.min(MAX_QTY, Math.round(Number((entry as PortalBucketItem)?.qty)) || 1)),
    }))
    .filter((entry) => entry.id != null && entry.name)
}

// Guest→account cart merge: union by product id, quantity = the LARGER of the
// two (a definite last-writer-wins would silently drop the other device's
// additions). Deterministic and order-stable (base first, then new ids).
export function mergeBucketItems(base: PortalBucketItem[], incoming: PortalBucketItem[]): PortalBucketItem[] {
  const byId = new Map<string, PortalBucketItem>()
  for (const item of sanitizeBucketItems(base)) byId.set(String(item.id), item)
  for (const item of sanitizeBucketItems(incoming)) {
    const existing = byId.get(String(item.id))
    byId.set(String(item.id), existing
      ? { ...existing, priceText: existing.priceText ?? item.priceText, qty: Math.max(existing.qty, item.qty) }
      : item)
  }
  return [...byId.values()]
}

// ---- Wishlist (§2: the heart/save list) ------------------------------------
// A parallel, lighter store: saved products with no quantity. Same guest
// (localStorage) + account (server mirror) split as the bucket.
export type PortalWishlistItem = {
  id: string | number
  name: string
  category?: string
  brand?: string
  priceText?: string
}

const WISHLIST_STORAGE_KEY = 'business-os-portal-wishlist-v1'

function sanitizeWishlistItems(raw: unknown): PortalWishlistItem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: PortalWishlistItem[] = []
  for (const entry of raw) {
    const id = (entry as PortalWishlistItem)?.id
    if (id == null) continue
    const key = String(id)
    if (seen.has(key)) continue
    const name = String((entry as PortalWishlistItem)?.name || '').trim()
    if (!name) continue
    seen.add(key)
    out.push({
      id,
      name,
      category: (entry as PortalWishlistItem)?.category ? String((entry as PortalWishlistItem).category) : undefined,
      brand: (entry as PortalWishlistItem)?.brand ? String((entry as PortalWishlistItem).brand) : undefined,
      priceText: (entry as PortalWishlistItem)?.priceText ? String((entry as PortalWishlistItem).priceText) : undefined,
    })
  }
  return out
}

export function mergeWishlistItems(base: PortalWishlistItem[], incoming: PortalWishlistItem[]): PortalWishlistItem[] {
  return sanitizeWishlistItems([...(Array.isArray(base) ? base : []), ...(Array.isArray(incoming) ? incoming : [])])
}

function readStoredWishlist(): PortalWishlistItem[] {
  if (typeof window === 'undefined') return []
  try {
    return sanitizeWishlistItems(JSON.parse(window.localStorage.getItem(WISHLIST_STORAGE_KEY) || '[]'))
  } catch {
    return []
  }
}

export function usePortalWishlist() {
  const [items, setItems] = useState<PortalWishlistItem[]>(() => readStoredWishlist())

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(items))
    } catch {
      // Storage unavailable — the wishlist just won't persist locally.
    }
  }, [items])

  const has = useCallback((id: string | number) => items.some((item) => String(item.id) === String(id)), [items])

  const toggle = useCallback((product: { id: string | number; name?: string; category?: string; brand?: string }, priceText?: string) => {
    setItems((current) => {
      if (current.some((item) => String(item.id) === String(product.id))) {
        return current.filter((item) => String(item.id) !== String(product.id))
      }
      return [
        ...current,
        {
          id: product.id,
          name: String(product.name || '').trim(),
          category: product.category ? String(product.category) : undefined,
          brand: product.brand ? String(product.brand) : undefined,
          priceText,
        },
      ]
    })
  }, [])

  const remove = useCallback((id: string | number) => {
    setItems((current) => current.filter((item) => String(item.id) !== String(id)))
  }, [])

  const clear = useCallback(() => setItems([]), [])
  const setAll = useCallback((next: PortalWishlistItem[]) => setItems(sanitizeWishlistItems(next)), [])
  const count = items.length

  return { items, has, toggle, remove, clear, setAll, count }
}

export function formatPortalBucketText(items: PortalBucketItem[], businessName = ''): string {
  const lines: string[] = []
  if (businessName) lines.push(businessName)
  // Customer-facing share text: pin mm/dd/yyyy 24-hour Phnom Penh like every
  // other surface instead of the device's own locale/timezone.
  lines.push(fmtDateTime24(new Date()))
  lines.push('')
  items.forEach((item, index) => {
    const details = [item.brand, item.category].filter(Boolean).join(' - ')
    const priceSuffix = item.priceText ? ` (${item.priceText})` : ''
    const detailSuffix = details ? ` [${details}]` : ''
    lines.push(`${index + 1}. ${item.name} x${item.qty}${priceSuffix}${detailSuffix}`)
  })
  return lines.join('\n')
}

export function downloadPortalBucketFile(text: string, businessName = 'my-list'): void {
  if (typeof document === 'undefined') return
  const safeName = String(businessName || 'my-list').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'my-list'
  const stamp = new Date().toISOString().slice(0, 10)
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${safeName}-list-${stamp}.txt`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
