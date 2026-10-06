// Owner rule 29 Sep 2026, picker ruled in 6 Oct 2026: a refund records the
// currency the cash went out in ($ or riel, $ by default). The Worker accepts
// `refund_currency` on POST /api/returns (cloudflare/src/lib/refundTender.ts),
// converts riel to USD at the sale's rate, and the shift close takes the cash
// part from that currency's drawer. Dollars add no key, exactly as the
// Worker's canonical intent leaves it out, so a dollar refund's request body
// and idempotency digest are the bytes they were before the picker existed.
export type RefundCurrency = 'USD' | 'KHR'

export const REFUND_CURRENCY_CHOICES: ReadonlyArray<{ value: RefundCurrency; symbol: string; labelKey: string; labelEn: string }> = [
  { value: 'USD', symbol: '$', labelKey: 'return_refund_in_usd', labelEn: 'Refund in dollars' },
  { value: 'KHR', symbol: '៛', labelKey: 'return_refund_in_khr', labelEn: 'Refund in riel' },
]

export function refundCurrencyField(currency: RefundCurrency): { refund_currency?: 'KHR' } {
  return currency === 'KHR' ? { refund_currency: 'KHR' } : {}
}

/**
 * RET-A (verifier, 6 Oct 2026): what a RECORDED customer refund did with the
 * money, for the return detail -- the debt it lowered and the cash paid out,
 * in the currency it was paid in. Riel is the cash share of the return's riel
 * figure, the Worker's refundCashKhr / REFUND_DRAWER_KHR_SQL. null for a
 * refund recorded before 0234 (no currency): the detail keeps its old rows.
 */
export function recordedRefundSplit(ret: { refund_currency?: unknown; total_refund_usd?: unknown; total_refund_khr?: unknown; owed_reduction_usd?: unknown }):
  { currency: RefundCurrency; loweredUsd: number; payoutUsd: number; payoutKhr: number } | null {
  if (ret.refund_currency !== 'USD' && ret.refund_currency !== 'KHR') return null
  const refundUsd = Math.max(0, Number(ret.total_refund_usd) || 0)
  const loweredUsd = Math.min(refundUsd, Math.max(0, Number(ret.owed_reduction_usd) || 0))
  const payoutUsd = Math.round((refundUsd - loweredUsd) * 10000) / 10000
  const payoutKhr = ret.refund_currency === 'KHR' && refundUsd > 0 && payoutUsd > 0
    ? Math.round((Number(ret.total_refund_khr) || 0) * payoutUsd / refundUsd) : 0
  return { currency: ret.refund_currency, loweredUsd, payoutUsd, payoutKhr }
}
