import { offsetDate, todayStr } from '../../../utils/dateHelpers.ts'

// A link from another page into Reports (Inventory check's "Sales"): the product to search for and the dates to show, handed over in memory
// and read once by ReportsHub. Memory only: a reload forgets it, and it expires so a link that never reached Reports (navigation blocked
// by unsaved work) cannot reopen Reports on a stale search later.

export const REPORTS_FOCUS_EVENT = 'bos:reports-focus'
const FOCUS_TTL_MS = 30_000

/** Reports > Grouped > Product, searched for one product over a date range. */
export type ReportsFocus = { view: 'products'; search: string; startDate: string; endDate: string }

let queued: (ReportsFocus & { at: number }) | null = null

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** The last 30 business days, today included, for one product. */
export function productSalesFocus(productName: string): ReportsFocus {
  return { view: 'products', search: productName.trim(), startDate: offsetDate(-29), endDate: todayStr() }
}

/** Remember the focus and tell a Reports page that is already open. */
export function queueReportsFocus(focus: ReportsFocus): void {
  queued = { ...focus, at: Date.now() }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(REPORTS_FOCUS_EVENT))
}

/** Look without consuming (a render may run twice); null when nothing fresh is waiting. */
export function peekReportsFocus(): ReportsFocus | null {
  if (!queued || Date.now() - queued.at > FOCUS_TTL_MS || !DAY.test(queued.startDate) || !DAY.test(queued.endDate) || queued.view !== 'products') return null
  const { view, search, startDate, endDate } = queued
  return { view, search, startDate, endDate }
}

/** Read it once: the focus is gone after this. */
export function takeReportsFocus(): ReportsFocus | null {
  const focus = peekReportsFocus()
  queued = null
  return focus
}
