// @ts-nocheck -- verbatim code of an older build, typed for modules that no longer exist here
// The readers of the build BEFORE the cache-lifecycle slice (commit 736929e91, release candidate 20261102b), copied verbatim, for
// tests/rollbackReadsNewRecords.test.ts. A rollback puts that build back in front of the records this build wrote; these are the functions
// it would read them with. Nothing here is edited except the export keyword and the two types they need. Do not update this file when the
// product changes: it is a record of what the old build did.
//   readWorkDraft      frontend/src/utils/workDrafts.ts
//   normalizeOrder     frontend/src/components/pos/POS.tsx
import { createEmptyOrder } from '../../src/constants.ts'

export type WorkDraft<T> = { at: number; data: T }
export type PosOrder = Record<string, unknown> & { cart: unknown[]; checkoutRequestId?: string; customer: Record<string, unknown>; paymentDetails: Array<{ id: string; method: string; usd: string; khr: string }> }
type PaymentDetail = { id: string; method: string; usd: string; khr: string }

export function readWorkDraft<T>(key: string, options?: { notOlderThanMs?: number }): WorkDraft<T> | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: number; data?: T; form?: T }
    // `form` is Part 388's original field name for the product draft --
    // accepted on read so existing saved drafts survive this extraction.
    const data = (parsed?.data ?? parsed?.form) as T | undefined
    if (data == null) {
      localStorage.removeItem(key)
      return null
    }
    const at = Number(parsed?.at) || 0
    const floor = Number(options?.notOlderThanMs) || 0
    if (floor && at <= floor) {
      localStorage.removeItem(key)
      return null
    }
    return { at, data }
  } catch {
    return null
  }
}

function normalizeOrder(order: Partial<PosOrder> = {}, fallbackIndex = 1): PosOrder {
  const base = createEmptyOrder(fallbackIndex) as PosOrder
  const legacyDetail: PaymentDetail = {
    id: `payment-${fallbackIndex}-1`,
    method: String(order.paymentMethod || base.paymentMethod || 'Cash'),
    usd: String(order.paidUsd || ''),
    khr: String(order.paidKhr || ''),
  }
  const paymentDetails = Array.isArray(order.paymentDetails) && order.paymentDetails.length
    ? order.paymentDetails.map((detail, index) => ({
        id: String(detail?.id || `payment-${fallbackIndex}-${index + 1}`),
        method: String(detail?.method || base.paymentMethod || 'Cash'),
        usd: String(detail?.usd || ''),
        khr: String(detail?.khr || ''),
      }))
    : [legacyDetail]
  return {
    ...base,
    ...order,
    cart: Array.isArray(order.cart) ? order.cart : base.cart,
    customer: { ...base.customer, ...(order.customer || {}) },
    paymentDetails,
    selectedDelivery: order.selectedDelivery || null,
  }
}

// The till's order initializer (POS.tsx useState<PosOrder[]>), minus the React wrapper: the stored string, parsed and normalized.
export function oldRestoreOrders(saved: string | null): PosOrder[] {
  try {
    if (saved) {
      const parsed = JSON.parse(saved) as unknown
      if (Array.isArray(parsed) && parsed.length) return parsed.map((order, index) => normalizeOrder(order as Partial<PosOrder>, index + 1))
    }
  } catch {}
  return [normalizeOrder({}, 1)]
}
