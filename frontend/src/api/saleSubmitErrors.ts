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
  // N14: the points discount must be the configured value of the points
  // redeemed (cloudflare/src/lib/membershipRedemption.ts).
  membership_discount_mismatch: 'membership_discount_mismatch',
  // N2: a sale is rung inside the cashier's open shift for today
  // (cloudflare/src/lib/saleShiftRequirement.ts; the till's own check is
  // utils/saleShiftRequirement.ts).
  sale_shift_required: 'sale_shift_required',
  sale_shift_closed: 'sale_shift_closed',
}

/**
 * Refusals whose fix is the basket itself. The till freezes the checkout body
 * before sending it, so a retry sends the same body and meets the same
 * refusal: the cart has to be released for review (POS "Review prices", which
 * first proves nothing was recorded) or it stays stuck on that sale for good.
 */
const SALE_SUBMIT_BASKET_REVIEW_CODES: ReadonlySet<string> = new Set([
  'sale_pricing_quote_conflict',
  // N14: the points discount the basket claims is not the configured value.
  'membership_discount_mismatch',
])

/**
 * Refusals answered by the shift, not the basket (N2): the same frozen sale
 * goes through once today's shift is registered or reopened, so the till
 * re-reads the shift (bringing up the registration prompt) and keeps the cart.
 */
const SALE_SUBMIT_SHIFT_CODES: ReadonlySet<string> = new Set(['sale_shift_required', 'sale_shift_closed'])

function refusalCode(error: unknown): string | null {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
  return typeof code === 'string' ? code : null
}

/** True when a refused checkout must be released for review rather than retried as it is. */
export function saleSubmitNeedsBasketReview(error: unknown): boolean {
  const code = refusalCode(error)
  return code !== null && SALE_SUBMIT_BASKET_REVIEW_CODES.has(code)
}

/** The shift refusal a checkout met, or null. */
export function saleSubmitShiftRefusal(error: unknown): 'sale_shift_required' | 'sale_shift_closed' | null {
  const code = refusalCode(error)
  return code !== null && SALE_SUBMIT_SHIFT_CODES.has(code) ? code as 'sale_shift_required' | 'sale_shift_closed' : null
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
