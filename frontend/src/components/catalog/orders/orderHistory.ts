import { isOrderToken } from './orderPath.ts'

// "My orders": the orders this browser placed, kept in this browser only (localStorage), like the shortlist.
// The order link IS the key to the order, so what is stored is the link's token, the order number and the time it was placed. Never the
// name, phone or address: the order page reads those from the server when it opens. The cookie policy lists this key (legalContent.ts).

export type SavedOrder = { token: string; orderNo: string; savedAt: string; totalUsd: number }

export const ORDER_HISTORY_STORAGE_KEY = 'business-os-portal-orders-v1'
/** The newest orders only: a phone's storage is not a ledger. */
export const ORDER_HISTORY_MAX = 20

export function sanitizeSavedOrders(raw: unknown): SavedOrder[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: SavedOrder[] = []
  for (const entry of raw) {
    const row = (entry && typeof entry === 'object' ? entry : {}) as Partial<Record<keyof SavedOrder, unknown>>
    const token = row.token
    if (!isOrderToken(token) || seen.has(token)) continue
    const orderNo = typeof row.orderNo === 'string' ? row.orderNo.trim().slice(0, 24) : ''
    const savedAt = typeof row.savedAt === 'string' && Number.isFinite(Date.parse(row.savedAt)) ? row.savedAt : ''
    const totalUsd = Number(row.totalUsd)
    if (!orderNo || !savedAt || !Number.isFinite(totalUsd) || totalUsd < 0) continue
    seen.add(token)
    out.push({ token, orderNo, savedAt, totalUsd })
  }
  return out.slice(0, ORDER_HISTORY_MAX)
}

/** Newest first; the same order saved twice keeps one row (the later save wins). */
export function addSavedOrder(current: readonly SavedOrder[], order: SavedOrder): SavedOrder[] {
  return sanitizeSavedOrders([order, ...current.filter((entry) => entry.token !== order.token)])
}

export const removeSavedOrder = (current: readonly SavedOrder[], token: string): SavedOrder[] => current.filter((entry) => entry.token !== token)

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
const browserStorage = (): StorageLike | null => {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export function readSavedOrders(storage: StorageLike | null = browserStorage()): SavedOrder[] {
  if (!storage) return []
  try { return sanitizeSavedOrders(JSON.parse(storage.getItem(ORDER_HISTORY_STORAGE_KEY) || '[]')) } catch { return [] }
}

/** Storage can be blocked (private browsing, quota): the order itself is safe on the server and in the link, so this never throws. */
export function writeSavedOrders(orders: readonly SavedOrder[], storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return false
  try { storage.setItem(ORDER_HISTORY_STORAGE_KEY, JSON.stringify(sanitizeSavedOrders(orders))); return true } catch { return false }
}

export function rememberOrder(order: SavedOrder, storage: StorageLike | null = browserStorage()): boolean {
  return writeSavedOrders(addSavedOrder(readSavedOrders(storage), order), storage)
}

export function forgetOrder(token: string, storage: StorageLike | null = browserStorage()): boolean {
  return writeSavedOrders(removeSavedOrder(readSavedOrders(storage), token), storage)
}
