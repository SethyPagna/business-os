// The till's half of "Fulfil" (KHQR S6a): the order the Orders screen handed over, turned into what the cashier sees and what the sale sends. Pure on purpose, so the rules are
// pinned without a browser: which lines are still to add, how much of the online payment this sale covers and what that means for the customer in words, and the one payment row
// the online money becomes. The Worker re-checks all of it inside the sale write (online_tender_mismatch, order_changed, order_in_review ...).
import { FULFIL_HANDOFF_KEY, type FulfilHandoff } from './onlineOrdersLogic.ts'

export type { FulfilHandoff }
const round2 = (n: number): number => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** The hand-off the Orders screen left in session storage, or null when there is none or it is not an order this till can read. Reading never throws (blocked storage = no hand-off). */
export function readFulfilHandoff(storage?: Pick<Storage, 'getItem'> | null): FulfilHandoff | null {
  try {
    const raw = (storage ?? globalThis.sessionStorage)?.getItem(FULFIL_HANDOFF_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<FulfilHandoff> | null
    if (!value || !Number.isSafeInteger(value.online_order_id) || (value.online_order_id as number) <= 0 || !Array.isArray(value.lines) || !value.lines.length) return null
    const lines = value.lines.filter((line) => Number.isSafeInteger(Number(line?.product_id)) && Number(line.quantity) > 0)
      .map((line) => ({ product_id: Number(line.product_id), quantity: Number(line.quantity) }))
    if (!lines.length) return null
    return {
      online_order_id: Number(value.online_order_id), order_no: String(value.order_no ?? ''), revision: Number(value.revision) || 0,
      branch_id: Number.isSafeInteger(Number(value.branch_id)) ? Number(value.branch_id) : null,
      customer_name: String(value.customer_name ?? ''), customer_phone: String(value.customer_phone ?? ''), fulfilment: String(value.fulfilment ?? ''),
      address: value.address == null ? null : String(value.address), lines, paid_usd: round2(Number(value.paid_usd) || 0),
    }
  } catch { return null }
}

export function clearFulfilHandoff(storage?: Pick<Storage, 'removeItem'> | null): void {
  try { (storage ?? globalThis.sessionStorage)?.removeItem(FULFIL_HANDOFF_KEY) } catch { /* nothing to clear */ }
}

export type CartCount = { productId: number; quantity: number }

/** Per ordered line: how many the cart holds now, and how many are still to add (never negative). The cart may hold more or fewer than the order: the cashier is allowed to change lines. */
export function lineStatus(lines: FulfilHandoff['lines'], cart: readonly CartCount[]): Array<{ product_id: number; ordered: number; inSale: number; missing: number }> {
  const held = new Map<number, number>()
  for (const entry of cart) held.set(entry.productId, (held.get(entry.productId) ?? 0) + (Number(entry.quantity) || 0))
  const ordered = new Map<number, number>()
  for (const line of lines) ordered.set(line.product_id, (ordered.get(line.product_id) ?? 0) + line.quantity)
  return [...ordered].map(([product_id, quantity]) => {
    const inSale = held.get(product_id) ?? 0
    return { product_id, ordered: quantity, inSale, missing: Math.max(0, quantity - inSale) }
  })
}

/** Cart lines the order did not ask for (the cashier added them): product ids with their counts. */
export function extraLines(lines: FulfilHandoff['lines'], cart: readonly CartCount[]): CartCount[] {
  const ordered = new Set(lines.map((line) => line.product_id))
  return cart.filter((entry) => !ordered.has(entry.productId) && Number(entry.quantity) > 0)
}

export type FulfilMoney = {
  /** The online money this sale covers: the part the KHQR payment row must be exactly (the Worker refuses any other figure). */
  coverUsd: number
  /** The customer still has to pay this much at the till (the sale is more than they paid online). */
  balanceUsd: number
  /** The customer paid this much more online than the sale comes to: it is owed back, through ABA. */
  backUsd: number
  kind: 'same' | 'owe_more' | 'refund_back'
}
export function fulfilMoney(paidOnlineUsd: number, saleTotalUsd: number): FulfilMoney {
  const paid = Math.max(0, round2(paidOnlineUsd)), total = Math.max(0, round2(saleTotalUsd))
  const coverUsd = round2(Math.min(paid, total))
  const balanceUsd = round2(Math.max(0, total - paid)), backUsd = round2(Math.max(0, paid - total))
  return { coverUsd, balanceUsd, backUsd, kind: balanceUsd > 0 ? 'owe_more' : backUsd > 0 ? 'refund_back' : 'same' }
}

export const ONLINE_TENDER_ROW_ID = 'online-order-tender'
type TenderRow = { id: string; method: string; usd: string; khr: string }

/**
 * The payment rows with the online money as exactly one row named `method` for `coverUsd`: added when missing, corrected when the cashier's change moved the cover, removed when the
 * cover is zero. Every other row (the cashier's own, for the balance) is left alone. Returns the same array when nothing needs to change, so an effect can compare by identity.
 */
export function withOnlineTender<T extends TenderRow>(details: readonly T[], method: string, coverUsd: number): readonly T[] | T[] {
  const same = (row: TenderRow) => row.id === ONLINE_TENDER_ROW_ID
  const existing = details.find(same)
  const cover = round2(coverUsd)
  if (cover <= 0) return existing ? details.filter((row) => !same(row)) : details
  const wanted = cover.toFixed(2)
  if (existing && existing.method === method && existing.usd === wanted && existing.khr === '') return details
  const row = { id: ONLINE_TENDER_ROW_ID, method, usd: wanted, khr: '' } as T
  // The online row leads, so the cashier's own rows read as "the rest".
  return [row, ...details.filter((entry) => !same(entry))]
}

/** What a sale sends to be linked to the order. */
export const fulfilSaleFields = (handoff: Pick<FulfilHandoff, 'online_order_id'> | null | undefined): { online_order_id?: number } =>
  handoff ? { online_order_id: handoff.online_order_id } : {}
