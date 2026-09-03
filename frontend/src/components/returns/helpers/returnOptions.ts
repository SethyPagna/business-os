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

export type ReturnStockAction = 'none' | 'restock' | 'damaged'

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
  { value: 'restock', icon: '↩️', labelKey: 'stock_action_restock', labelEn: 'Restock', descKey: 'stock_action_restock_desc', descEn: 'Back to sellable stock (same batch when known)' },
  { value: 'damaged', icon: '🟠', labelKey: 'stock_action_damaged', labelEn: 'Damaged', descKey: 'stock_action_damaged_desc', descEn: 'Tracked as a damaged lot, not sellable' },
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

// mm/dd/yyyy per the app-wide date convention; ISO or Date-parseable in.
export function formatBatchDate(value: string | null | undefined): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (isoMatch) return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}`
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime())) return text
  const mm = String(parsed.getMonth() + 1).padStart(2, '0')
  const dd = String(parsed.getDate()).padStart(2, '0')
  return `${mm}/${dd}/${parsed.getFullYear()}`
}

// One line per lot for the replacement batch picker -- lot code, expiry
// (mm/dd/yyyy), and what's actually available at the branch. Never cost.
export function describeBatchOption(batch: {
  lot_code?: string | null
  expiry_date?: string | null
  quantity?: number | null
  batch_number?: number | null
}): string {
  const parts: string[] = []
  const lot = String(batch.lot_code ?? '').trim()
  parts.push(lot || (batch.batch_number != null ? `#${batch.batch_number}` : 'lot'))
  const expiry = formatBatchDate(batch.expiry_date)
  if (expiry) parts.push(`exp ${expiry}`)
  parts.push(`${Number(batch.quantity) || 0} in stock`)
  return parts.join(' · ')
}
