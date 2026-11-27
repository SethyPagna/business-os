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
//  * delivery_contact_missing - the delivery person picked for the sale was deleted before it was saved (409): nothing was recorded; pick another.
//  * shift_required_for_cash - cash needs an open shift today (owner R40, 26 + 27 Nov 2026): the sale, later payment or refund moved cash with no
//    open shift; nothing was recorded. The text names who can reopen a closed shift: its opener or an administrator.
// sale_created_at_too_old is the one code with a different key: a queued sale older than the Worker's window (B1-R) is refused and kept on
// the device for the owner (server_sale_kept_on_device).
const SALE_SUBMIT_REFUSAL_OWN_KEY: readonly string[] = [
  'receipt_number_conflict',
  'sale_discount_exceeds_price',
  'sale_discount_exceeds_subtotal',
  'sale_stock_changed',
  'riel_cash_not_hundreds',
  'sale_payment_rows_mismatch',
  'delivery_contact_missing',
]

/**
 * The pack sentence for a coded sale-submit refusal (a thrown API error or a
 * result carrying `code`), or null for anything else, so each checkout path
 * keeps its own localizing for every other error.
 */
export function saleSubmitRefusalText(error: unknown, t: (key: string) => string | undefined, options: CashShiftRefusalOptions = {}): string | null {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : null
  if (code === 'shift_required_for_cash') return cashShiftRefusalText(error as CashShiftRefusalFields, t, options)
  // includes() is false for anything that is not one of the listed strings, so a missing or non-string code needs no separate check.
  const key = code === 'sale_created_at_too_old' ? 'server_sale_kept_on_device' : SALE_SUBMIT_REFUSAL_OWN_KEY.includes(code as string) ? code as string : null
  const text = key ? t(key) : null
  return typeof text === 'string' && text.trim() ? text : null
}

type CashShiftRefusalFields = { shift_state?: unknown; direction?: unknown; who?: unknown; opener_name?: unknown }

/** `canOpen` is false for an account with no shift access (a returns-only role): it is told who to ask, never to open a shift itself. */
export type CashShiftRefusalOptions = { canOpen?: boolean }

/** The pack sentence for the Worker's shift_required_for_cash refusal: what is missing, then who may reopen a closed shift. */
export function cashShiftRefusalText(refusal: CashShiftRefusalFields, t: (key: string) => string | undefined, options: CashShiftRefusalOptions = {}): string | null {
  const give = refusal.direction === 'out'
  const closed = refusal.shift_state === 'closed'
  if (!closed && options.canOpen === false) {
    const askToOpen = t('shift_open_ask_cashier')
    if (typeof askToOpen === 'string' && askToOpen.trim()) return askToOpen
  }
  const first = t(closed ? (give ? 'shift_closed_for_refund' : 'shift_closed_for_cash') : give ? 'shift_required_for_refund' : 'shift_required_for_cash')
  if (typeof first !== 'string' || !first.trim()) return null
  if (!closed || refusal.who !== 'ask_reopen') return first
  const name = typeof refusal.opener_name === 'string' ? refusal.opener_name.trim() : ''
  const ask = name ? t('shift_reopen_ask')?.replace('{name}', name) : t('shift_reopen_ask_admin')
  return ask ? `${first} ${ask}` : first
}
