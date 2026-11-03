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
  // A queued sale older than the Worker's window (B1-R): refused, kept on the device for the owner.
  sale_created_at_too_old: 'server_sale_kept_on_device',
  // Stock moved (a Remove, another till's sale) between the sale's reads and its write: the Worker aborts the whole
  // write, so nothing was recorded and the same checkout can simply be sent again. Not a pricing change.
  sale_stock_changed: 'sale_stock_changed',
  // Riel paid in cash is whole 100-riel notes (owner, 27 Oct 2026): a cash tender row, stated riel change, or any other cash
  // writer refused it. The till marks the field before it asks; this restates the Worker's refusal if a stale till still sent it.
  riel_cash_not_hundreds: 'riel_cash_not_hundreds',
  // A tender whose payment rows do not add up to the paid total it states (MONEY-1 review, 4 Nov 2026): the till builds both from one
  // set of rows, so this only answers a stale or foreign client; nothing was recorded.
  sale_payment_rows_mismatch: 'sale_payment_rows_mismatch',
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
