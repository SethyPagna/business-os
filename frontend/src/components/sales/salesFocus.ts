/**
 * The exact-sale handoff behind a link to one sale (the shift report's "changed after close" list).
 *
 * The link used to queue only the receipt number, which the Sales page ran as a typed search over all time: a text match across every sale and every
 * line, about a million rows a click. The link now also queues the sale id; while the search box still holds that receipt and no date range is set,
 * the list and its totals read `id=<sale id>` (an indexed lookup the API already answered for the list, and now for the totals). The box still shows
 * the receipt, so the page looks the same; the moment the user edits the search or picks dates, the focus stops applying and the page reads as typed.
 * Once it has stopped applying it is dropped for good (nextSalesFocus), so typing the receipt again later is a fresh search like any other.
 */
export type SalesFocus = { saleId: number; receipt: string }

/** The queued handoff (sessionStorage JSON) as a focus, or null when it names no usable sale id. A receipt-only handoff stays a plain search. */
export function parseSalesFocus(payload: unknown): SalesFocus | null {
  if (!payload || typeof payload !== 'object') return null
  const { saleId, search } = payload as { saleId?: unknown; search?: unknown }
  const receipt = String(search ?? '').trim()
  if (!receipt) return null
  const id = typeof saleId === 'number' ? saleId : typeof saleId === 'string' && /^\d+$/.test(saleId.trim()) ? Number(saleId.trim()) : NaN
  return Number.isSafeInteger(id) && id > 0 ? { saleId: id, receipt } : null
}

/**
 * The sale id the list and the totals should read exactly, or null to read the typed search as before.
 * `typed` is the search box as typed; `sent` is the debounced value the requests use (it lags `typed` by one debounce), so the focus holds through
 * that lag instead of firing one all-time receipt search for the old text.
 */
export function activeSalesFocusId(
  focus: SalesFocus | null,
  typed: string,
  sent: string,
  range: { startDate?: string; endDate?: string },
): number | null {
  if (!focus) return null
  if (range.startDate || range.endDate) return null
  const same = (value: string) => value.trim() === focus.receipt
  return same(typed) || same(sent) ? focus.saleId : null
}

/**
 * The focus to keep after the box or the dates changed: the same object while it still applies, null once it has stopped (the user edited the text past the debounce lag
 * or picked dates). A dropped focus never comes back, so retyping that receipt reads as a typed search, exactly like a fresh one.
 */
export function nextSalesFocus(
  focus: SalesFocus | null,
  typed: string,
  sent: string,
  range: { startDate?: string; endDate?: string },
): SalesFocus | null {
  return activeSalesFocusId(focus, typed, sent, range) === null ? null : focus
}
