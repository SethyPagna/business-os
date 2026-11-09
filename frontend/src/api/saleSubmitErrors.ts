// POST /api/sales refusals the till restates from the language pack by their
// stable code (cloudflare/src/routes/sales.ts), so a Khmer screen never shows
// the Worker's English. Pinned by tests/saleSubmitRefusal.test.ts.
//
// This file rides the 'app-api-methods' chunk, which every page loads (the storefront too), so it stays as small as the table allows: a
// code whose pack key IS the code is listed once, below, and not as a repeated `key: 'key'` pair.
//
// Codes restated under their own name:
//  * receipt_number_conflict - another sale minted the same receipt number at the same moment; nothing was recorded and a retry mints afresh.
//  * sale_discount_exceeds_price / sale_discount_exceeds_subtotal - a fixed discount over the item price, or a sale discount over the
//    subtotal (owner, 5 Oct 2026): refused by the Worker on sale create, add-items and amendments, and by the till's own pricing first.
//  * sale_stock_changed - stock moved (a Remove, another till's sale) between the sale's reads and its write: the Worker aborts the whole
//    write, so nothing was recorded and the same checkout can simply be sent again. Not a pricing change.
//  * riel_cash_not_hundreds - riel paid in cash is whole 100-riel notes (owner, 27 Oct 2026): a cash tender row, stated riel change, or any
//    other cash writer refused it. The till marks the field before it asks; this restates the refusal if a stale till still sent it.
//  * sale_payment_rows_mismatch - payment rows that do not add up to the paid total the request states (MONEY-1 review, 4 Nov 2026): the
//    till builds both from one set of rows, so this only answers a stale or foreign client; nothing was recorded.
// sale_created_at_too_old is the one code with a different key: a queued sale older than the Worker's window (B1-R) is refused and kept on
// the device for the owner (server_sale_kept_on_device).
const SALE_SUBMIT_REFUSAL_OWN_KEY: readonly string[] = [
  'receipt_number_conflict',
  'sale_discount_exceeds_price',
  'sale_discount_exceeds_subtotal',
  'sale_stock_changed',
  'riel_cash_not_hundreds',
  'sale_payment_rows_mismatch',
]

/**
 * The pack sentence for a coded sale-submit refusal (a thrown API error or a
 * result carrying `code`), or null for anything else, so each checkout path
 * keeps its own localizing for every other error.
 */
export function saleSubmitRefusalText(error: unknown, t: (key: string) => string | undefined): string | null {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
  // includes() is false for anything that is not one of the listed strings, so a missing or non-string code needs no separate check.
  const key = code === 'sale_created_at_too_old' ? 'server_sale_kept_on_device' : SALE_SUBMIT_REFUSAL_OWN_KEY.includes(code as string) ? code as string : null
  const text = key ? t(key) : null
  return typeof text === 'string' && text.trim() ? text : null
}
