/**
 * The exact-sale handoff behind a link to one sale (the shift report's "changed after close" list).
 *
 * The link used to queue only the receipt number, which the Sales page ran as a typed search over all time: a text match across every sale and every
 * line, about a million rows a click. The link now also queues the sale id; while the search box still holds that receipt and no date range is set,
 * the list and its totals read `id=<sale id>` (an indexed lookup the API already answered for the list, and now for the totals). The box still shows
 * the receipt, so the page looks the same; the moment the user edits the search or picks dates, the focus stops applying and the page reads as typed.
 * Once it has stopped applying it is dropped for good (nextSalesFocus), so typing the receipt again later is a fresh search like any other.
 */
import { useEffect, type Dispatch, type SetStateAction } from 'react'

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

/**
 * The focus after the box or the dates changed, for a state updater. `seen` is the focus the effect's render saw; `current` is what the state holds when the
 * updater runs. They differ when an earlier effect in the same flush queued a new focus (the link consumed on a cold mount): this render's typed text and dates
 * predate that focus, so judging it by them would drop it before it ever applied. A focus this render did not see is kept; the next render judges it.
 */
export function settleSalesFocus(
  current: SalesFocus | null,
  seen: SalesFocus | null,
  typed: string,
  sent: string,
  range: { startDate?: string; endDate?: string },
): SalesFocus | null {
  return current === seen ? nextSalesFocus(current, typed, sent, range) : current
}

/** Ends the focus for good once the search is edited past the debounce lag or dates are picked (see settleSalesFocus for the same-flush case). */
export function useSettleSalesFocus(
  focus: SalesFocus | null,
  setFocus: Dispatch<SetStateAction<SalesFocus | null>>,
  typed: string,
  sent: string,
  range: { startDate?: string; endDate?: string },
): void {
  useEffect(() => {
    setFocus((current) => settleSalesFocus(current, focus, typed, sent, range))
    // `focus` is read only to tell a stale render from a fresh one; a change of focus itself re-runs this through typed/sent/range on the next render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, sent, range])
}

/**
 * What a link that opens ONE sale hands to the Sales page: the receipt as the box text and the sale id as the exact focus.
 * Every "Open sale" link builds its EntityLink props here, so none of them can land on the list unfocused (the Expenses link did: it queued the receipt
 * only, an all-time typed search). A sale with no receipt text falls back to the id as the box text, which is still a usable search and still focuses.
 * An id that is not a positive whole number yields no focus, and the link degrades to the plain receipt search it was.
 */
export function saleLinkTarget(saleId: unknown, receipt: unknown): { search: string; focus?: { saleId: number } } {
  const id = typeof saleId === 'number' ? saleId : typeof saleId === 'string' && /^\d+$/.test(saleId.trim()) ? Number(saleId.trim()) : NaN
  const valid = Number.isSafeInteger(id) && id > 0
  const search = String(receipt ?? '').trim() || (valid ? String(id) : '')
  return valid ? { search, focus: { saleId: id } } : { search }
}
