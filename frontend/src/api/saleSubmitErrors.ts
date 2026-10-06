// POST /api/sales refusals the till restates from the language pack by their
// stable code (cloudflare/src/routes/sales.ts), so a Khmer screen never shows
// the Worker's English. Pinned by tests/saleSubmitRefusal.test.ts.
const SALE_SUBMIT_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  // Another sale minted the same receipt number at the same moment; nothing
  // was recorded and a retry mints afresh.
  receipt_number_conflict: 'receipt_number_conflict',
  // A fixed discount over the item price, or a sale discount over the subtotal
  // (owner, 5 Oct 2026): refused by the Worker on sale create, add-items and
  // amendments, and by the till's own pricing before it ever asks.
  sale_discount_exceeds_price: 'sale_discount_exceeds_price',
  sale_discount_exceeds_subtotal: 'sale_discount_exceeds_subtotal',
  // N15: the quoted exchange rate is outside the band around the Settings
  // rate (cloudflare/src/lib/saleExchangeRateBand.ts); a stale till refreshes.
  exchange_rate_out_of_range: 'exchange_rate_out_of_range',
}

/**
 * The pack sentence for a coded sale-submit refusal (a thrown API error or a
 * result carrying `code`), or null for anything else, so each checkout path
 * keeps its own localizing for every other error.
 */
export function saleSubmitRefusalText(error: unknown, t: (key: string) => string | undefined): string | null {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
  if (typeof code !== 'string' || !Object.prototype.hasOwnProperty.call(SALE_SUBMIT_REFUSAL_KEYS, code)) return null
  const text = t(SALE_SUBMIT_REFUSAL_KEYS[code])
  return typeof text === 'string' && text.trim() ? text : null
}
