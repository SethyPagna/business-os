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
