/**
 * The whole money COLUMN of a sale, in one place.
 *
 * receiptLineMath.ts owns a single line and the delivery fee. This owns the
 * rows underneath them -- Subtotal, Item discount, Discount, Membership
 * discount, Tax, Delivery, Total, Refunded, Net total, Paid, Change, Balance
 * due -- because every one of those rows is only correct RELATIVE to the
 * others, and the two surfaces that print them (components/receipt/Receipt.tsx
 * and components/sales/SaleDetailModal.tsx) each derived them separately from
 * the raw row, with their own `?? sale.total` coalescing.
 *
 * The ground truth is the Worker's lib/saleTotals.ts computeSaleTotals, which
 * is what actually wrote `sales.total_usd`:
 *
 *     total_usd = subtotal_usd - discount_usd - membership_discount_usd
 *                 + tax_usd + (delivery fee, ONLY when the CUSTOMER paid it)
 *
 * `receiptTotalsFootingErrorUsd` below re-states exactly that identity so a
 * test can assert it is zero on real fixtures rather than a reader trusting it.
 *
 * Three ways a printed column disagreed with that stored total:
 *
 *  1. DELIVERY THE SHOP ABSORBED. `total_usd` never carries it, but
 *     SaleDetailModal printed the stored fee whoever paid it, so its column was
 *     over by exactly the absorbed fee. Receipt.tsx already handled this
 *     (receiptDeliveryFigures); its sibling did not.
 *  2. REFUNDS. GET /api/sales attaches `refund_usd` from the returns table and
 *     both surfaces printed it as a negative row ABOVE the Total -- but the
 *     Total is `total_usd`, which does not net it. A figure shown as a
 *     subtraction and then not subtracted is the Part-596 shape again, in the
 *     other direction. The refund belongs BELOW the Total with an explicit Net
 *     total under it, so both halves foot: the sale totalled X, returns took Y
 *     back, the customer's net is X - Y.
 *  3. BALANCE DUE. SaleDetailModal computed `total - amount_paid_usd` and
 *     ignored `amount_paid_khr` entirely, so a sale settled in riel -- an
 *     ordinary shape at this counter -- read as fully unpaid and showed the
 *     whole total as still owed. Riel is a tender, not a rounding note.
 */

import {
  receiptDeliveryFigures,
  receiptLineSavingsUsd,
  type ReceiptDeliveryFigures,
  type ReceiptDeliveryInput,
  type ReceiptLineInput,
} from './receiptLineMath.ts'

export interface ReceiptTotalsSale extends ReceiptDeliveryInput {
  items?: ReceiptLineInput[] | string | null
  exchange_rate?: number | string | null
  subtotal_usd?: number | string | null
  subtotal?: number | string | null
  subtotal_khr?: number | string | null
  discount_usd?: number | string | null
  discount?: number | string | null
  discount_khr?: number | string | null
  membership_discount_usd?: number | string | null
  membership_discount_khr?: number | string | null
  tax_usd?: number | string | null
  tax?: number | string | null
  tax_khr?: number | string | null
  total_usd?: number | string | null
  total?: number | string | null
  total_khr?: number | string | null
  amount_paid_usd?: number | string | null
  amount_paid?: number | string | null
  amount_paid_khr?: number | string | null
  change_usd?: number | string | null
  change_returned?: number | string | null
  change_khr?: number | string | null
  refund_usd?: number | string | null
  refund_khr?: number | string | null
  sale_status?: string | null
}

export interface ReceiptTotalsOptions {
  /**
   * The receipt template's `show_item_discount`. False means every line was
   * printed at its charged price with no per-unit cut beside it, so there is
   * no item-discount figure to report either.
   */
  showItemDiscount?: boolean
  /**
   * Rate for a sale that stored none (old rows). NEVER a re-fetched live rate:
   * every riel figure here converts at the rate the sale was booked at, or a
   * reprint would tell a different story than the original.
   */
  fallbackExchangeRate?: number
}

export interface ReceiptTotalsFigures {
  /** The rate the sale was BOOKED at; the basis of every derived riel figure. */
  exchangeRate: number
  /** Sum of the NET line totals -- exactly what `sales.subtotal_usd` holds. */
  subtotalUsd: number
  subtotalKhr: number
  /** The per-line cuts. Already inside subtotalUsd; reported, never re-applied. */
  itemDiscountUsd: number
  /** The order-level cut the cashier typed. */
  discountUsd: number
  discountKhr: number
  membershipDiscountUsd: number
  membershipDiscountKhr: number
  /** item + order-level + membership. A summary, not another subtraction. */
  totalDiscountUsd: number
  taxUsd: number
  taxKhr: number
  delivery: ReceiptDeliveryFigures
  totalUsd: number
  totalKhr: number
  refundUsd: number
  refundKhr: number
  /** total - refund. Equal to totalUsd when nothing came back. */
  netTotalUsd: number
  netTotalKhr: number
  paidUsd: number
  paidKhr: number
  /** Every tender expressed in dollars at the booked rate -- USD plus riel. */
  paidTotalUsd: number
  changeUsd: number
  changeKhr: number
  /** Still owed on the sale as transacted. Zero once the tender covers it. */
  outstandingUsd: number
  outstandingKhr: number
}

const num = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

function parseItems(raw: ReceiptTotalsSale['items']): ReceiptLineInput[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string') return []
  try {
    const parsed: unknown = JSON.parse(raw || '[]')
    return Array.isArray(parsed) ? (parsed as ReceiptLineInput[]) : []
  } catch {
    return []
  }
}

/**
 * Read a sale's stored money into the rows a receipt column prints.
 *
 * Deliberately takes the RAW sale row rather than pre-parsed numbers: the
 * `?? sale.total` / `|| sale.total` style coalescing each surface used to do
 * for itself is exactly where two readers of one row drift apart, so it
 * happens once, here.
 */
export function receiptTotalsFigures(
  sale: ReceiptTotalsSale,
  options: ReceiptTotalsOptions = {},
): ReceiptTotalsFigures {
  const exchangeRate = num(sale.exchange_rate) || options.fallbackExchangeRate || 4100

  const subtotalUsd = num(sale.subtotal_usd ?? sale.subtotal)
  const discountUsd = num(sale.discount_usd ?? sale.discount)
  const membershipDiscountUsd = num(sale.membership_discount_usd)
  const itemDiscountUsd = round2(
    receiptLineSavingsUsd(parseItems(sale.items), options.showItemDiscount !== false, exchangeRate),
  )
  const taxUsd = num(sale.tax_usd ?? sale.tax)

  const totalUsd = num(sale.total_usd ?? sale.total)
  const totalKhr = num(sale.total_khr) || totalUsd * exchangeRate
  const refundUsd = num(sale.refund_usd)
  const refundKhr = num(sale.refund_khr) || refundUsd * exchangeRate

  const paidUsd = num(sale.amount_paid_usd ?? sale.amount_paid)
  const paidKhr = num(sale.amount_paid_khr)
  // Riel handed over is money handed over. Converted at the sale's own booked
  // rate -- the same term the Worker's computeSaleTotals uses to decide change,
  // so "still owed" and "change given" cannot disagree about one tender.
  const paidTotalUsd = round2(paidUsd + (exchangeRate > 0 ? paidKhr / exchangeRate : 0))
  const outstandingUsd = Math.max(0, round2(totalUsd - paidTotalUsd))

  return {
    exchangeRate,
    subtotalUsd,
    subtotalKhr: num(sale.subtotal_khr) || Math.round(subtotalUsd * exchangeRate),
    itemDiscountUsd,
    discountUsd,
    discountKhr: num(sale.discount_khr) || Math.round(discountUsd * exchangeRate),
    membershipDiscountUsd,
    membershipDiscountKhr: num(sale.membership_discount_khr) || Math.round(membershipDiscountUsd * exchangeRate),
    totalDiscountUsd: round2(itemDiscountUsd + discountUsd + membershipDiscountUsd),
    taxUsd,
    taxKhr: num(sale.tax_khr) || Math.round(taxUsd * exchangeRate),
    delivery: receiptDeliveryFigures(sale, exchangeRate),
    totalUsd,
    totalKhr,
    refundUsd,
    refundKhr,
    netTotalUsd: round2(totalUsd - refundUsd),
    netTotalKhr: Math.round(totalKhr - refundKhr),
    paidUsd,
    paidKhr,
    paidTotalUsd,
    changeUsd: num(sale.change_usd ?? sale.change_returned),
    changeKhr: num(sale.change_khr),
    outstandingUsd,
    outstandingKhr: Math.round(outstandingUsd * exchangeRate),
  }
}

/**
 * How far the rows above the Total are from the Total itself, in dollars.
 *
 * A number rather than a boolean so a failing test can print the size of the
 * gap, which is usually the name of the bug: a mismatch equal to the delivery
 * fee is the absorbed-fee defect, one equal to the membership discount is a
 * dropped row, and so on. Exported so the shape of the check lives next to the
 * shape of the column instead of being restated in every test file.
 */
export function receiptTotalsFootingErrorUsd(figures: ReceiptTotalsFigures): number {
  return round2(
    figures.subtotalUsd
    - figures.discountUsd
    - figures.membershipDiscountUsd
    + figures.taxUsd
    + figures.delivery.chargedUsd
    - figures.totalUsd,
  )
}
