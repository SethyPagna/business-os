import { useCallback, useEffect, useMemo, useState } from 'react'

// The "bucket" is a customer-facing shortlist on the public portal --
// NOT a cart, no payment, no order submitted anywhere. A visitor taps
// "Add" on products they're interested in, then from the bucket drawer
// can copy the list to their clipboard or download it as a text file,
// to show/send to staff through whatever channel they like (in person,
// Messenger, Telegram, etc). Persisted client-side only (localStorage),
// scoped to this browser -- there is no backend endpoint for it and none
// is needed, since nothing here is ever charged or fulfilled by the app.

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
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((entry): PortalBucketItem => ({
        id: entry?.id,
        name: String(entry?.name || '').trim(),
        category: entry?.category ? String(entry.category) : undefined,
        brand: entry?.brand ? String(entry.brand) : undefined,
        priceText: entry?.priceText ? String(entry.priceText) : undefined,
        qty: Math.max(1, Math.min(MAX_QTY, Math.round(Number(entry?.qty)) || 1)),
      }))
      .filter((entry) => entry.id != null && entry.name)
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

  return { items, add, remove, setQty, clear, count, hasItem, getQty }
}

export function formatPortalBucketText(items: PortalBucketItem[], businessName = ''): string {
  const lines: string[] = []
  if (businessName) lines.push(businessName)
  lines.push(new Date().toLocaleString())
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
