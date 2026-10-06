// K2 (Part 410, 11.12/11.13): pure helpers for the return-options chooser
// and Replace. The BACKEND kernel (cloudflare/src/lib/returnsStock.ts) is
// authoritative for all of this -- these mirror its normalization and lot
// rules so the modal shows exactly what the server will decide, never a
// different answer.
//
// There is deliberately NO settlement math here any more. A return refunds
// its own lines at the original sale's prices; a replacement is an ordinary
// sale the customer pays for. Neither nets against the other, so there is no
// difference to preview, owe, or settle.

import { lotCodeDisplay } from '../../../utils/batchLabel.ts'
import { fmtDate, fmtDateOnly } from '../../../utils/formatters.ts'

export type ReturnStockAction = 'none' | 'restock' | 'damaged'

// P4-3. Owner: "if restock as damaged etc... Don't we have the remove tag
// rule for returns. that should be consistent." Mirrors the backend kernel's
// DamagedDisposition (cloudflare/src/lib/returnsStock.ts) byte for byte:
// 'keep' (default, untouched legacy behavior) holds the units as a tagged
// row; 'remove' destroys them immediately as a booked loss. Only meaningful
// when stock_action is 'damaged'.
export type DamagedDisposition = 'keep' | 'remove'

export interface StockActionOption {
  value: ReturnStockAction
  icon: string
  labelKey: string
  labelEn: string
  descKey: string
  descEn: string
}

// The ONE chooser (11.13): each option carries what happens to stock.
export const STOCK_ACTION_OPTIONS: StockActionOption[] = [
  { value: 'restock', icon: '↩️', labelKey: 'stock_action_restock', labelEn: 'Restock', descKey: 'stock_action_restock_desc', descEn: 'Back to sellable stock (same received date when known)' },
  { value: 'damaged', icon: '🟠', labelKey: 'stock_action_damaged', labelEn: 'Damaged', descKey: 'stock_action_damaged_desc', descEn: 'Tracked as damaged stock, not sellable' },
  { value: 'none', icon: '🚫', labelKey: 'stock_action_none', labelEn: 'No restock', descKey: 'stock_action_none_desc', descEn: 'No stock change (write-off / refund only)' },
]

// Mirror of the backend kernel's normalizeStockAction, byte for byte in
// behavior: explicit three-way wins; otherwise the historical
// return_to_stock boolean keeps its exact meaning (absent = restock).
export function normalizeStockAction(input: { stock_action?: unknown; return_to_stock?: unknown }): ReturnStockAction {
  const explicit = String(input.stock_action ?? '').trim().toLowerCase()
  if (explicit === 'none' || explicit === 'restock' || explicit === 'damaged') return explicit
  return input.return_to_stock !== false ? 'restock' : 'none'
}

export function stockActionOption(action: ReturnStockAction): StockActionOption {
  return STOCK_ACTION_OPTIONS.find((option) => option.value === action) || STOCK_ACTION_OPTIONS[2]
}

// Mirror of the backend kernel's planReturnLot verdict, for the ONE thing
// the modal has to decide before it can submit: does this line still need
// the operator to name a lot? The server refuses a lot-tracked line that
// answers "yes" (ReturnLotRequiredError), so the modal must not offer an
// "any stock" escape and must not let Confirm through until every such line
// is answered.
export function returnLineNeedsLotPick(input: {
  originalBatchId?: number | string | null
  pickedBatchId?: number | string | null
  lotOptionCount: number
}): boolean {
  if (input.lotOptionCount <= 0) return false
  const known = Number(input.originalBatchId)
  if (Number.isFinite(known) && known > 0) return false
  const picked = Number(input.pickedBatchId)
  return !(Number.isFinite(picked) && picked > 0)
}

// dd/mm/yyyy through the shared formatters (day-first since Sep 4 2026).
// A stored DATE (ISO, or a slash value that must not pass for a date) goes to
// fmtDateOnly; anything else the engine can parse is an INSTANT and is read in
// the business timezone (Phnom Penh), never the device zone. This used to be a
// hand-rolled copy of fmtDateOnly that read a slash string as month-first via
// `new Date()`.
export function formatBatchDate(value: string | null | undefined): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  if (/^\d{4}-\d{2}-\d{2}/.test(text) || text.includes('/')) return fmtDateOnly(text)
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? fmtDateOnly(text) : fmtDate(parsed)
}

// One line per lot for the replacement batch picker -- lot code, expiry
// (dd/mm/yyyy), and what's actually available at the branch. Never cost.
export function describeBatchOption(batch: {
  lot_code?: string | null
  expiry_date?: string | null
  quantity?: number | null
  batch_number?: number | null
}): string {
  const parts: string[] = []
  const lot = lotCodeDisplay(batch.lot_code)
  parts.push(lot || (batch.batch_number != null ? `#${batch.batch_number}` : 'received date'))
  const expiry = formatBatchDate(batch.expiry_date)
  if (expiry) parts.push(`exp ${expiry}`)
  parts.push(`${Number(batch.quantity) || 0} in stock`)
  return parts.join(' · ')
}
