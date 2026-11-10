// The "through ABA" choice on a return (KHQR S6b). A sale that fulfilled an online order took part of its money through the KHQR payment method, so the refund of that part goes back
// the same way, through ABA, and never out of the till drawer. The Worker decides (it needs the online_orders refund action, the sale linked to an order, dollars only, and the cash
// part within what was paid online less earlier ABA returns and notes -- refund_channel_requires_online_order, aba_refund_over_online); this decides only whether the choice is
// OFFERED, so nobody is invited into a refund that is guaranteed to fail, and what cap to show. The cap shown is what the sale took online; the Worker may know of less.

export const DEFAULT_ONLINE_METHOD = 'ABA KHQR'

/** The payment method name the Worker records for online money (setting online_order_payment_method, 'ABA KHQR' until changed). */
export const onlineMethodName = (settings: Record<string, unknown> | null | undefined): string => {
  const set = String(settings?.online_order_payment_method ?? '').trim()
  return set || DEFAULT_ONLINE_METHOD
}

const same = (a: unknown, b: unknown): boolean => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase()
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100

/** Dollars the sale took through the online method: the sum of its payment rows named that way (rows may arrive as JSON text). */
export function onlineTenderUsd(paymentDetails: unknown, method: string): number {
  let list: unknown = paymentDetails
  if (typeof list === 'string') { try { list = JSON.parse(list) } catch { list = [] } }
  if (!Array.isArray(list)) return 0
  return round2(list.reduce((sum: number, row) => {
    const entry = row as { method?: unknown; amount_usd?: unknown; refund_credit?: unknown }
    return same(entry?.method, method) && entry?.refund_credit !== true ? sum + (Number(entry.amount_usd) || 0) : sum
  }, 0))
}

export type AbaRefundOffer = { offered: boolean; capUsd: number; amountUsd: number; overCap: boolean }

export function abaRefundOffer(input: {
  paymentDetails: unknown
  method: string
  canRefund: boolean
  /** The refund the review shows (quote.total_refund_usd). A sale of an online order is paid, so none of it lowers a debt: all of it is cash to send back. */
  creditUsd: number
  exchangeActive: boolean
  returnType: string
}): AbaRefundOffer {
  const capUsd = onlineTenderUsd(input.paymentDetails, input.method)
  const amountUsd = round2(Number(input.creditUsd) || 0)
  const offered = input.canRefund && capUsd > 0 && !input.exchangeActive && input.returnType !== 'writeoff' && amountUsd > 0
  return { offered, capUsd, amountUsd, overCap: amountUsd > capUsd + 0.005 }
}
