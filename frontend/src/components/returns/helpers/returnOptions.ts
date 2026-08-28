// K2 (Part 410, 11.12/11.13): pure helpers for the return-options chooser
// and Replace. The BACKEND kernel (cloudflare/src/lib/returnsStock.ts) is
// authoritative for all of this -- these mirror its normalization and
// settlement math so the modal's preview shows exactly what the server
// will decide, never a different answer.

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

// Mirror of the backend kernel's computeSettlement thresholds: an even
// exchange is only even within half a cent / half a riel of zero.
// Positive diff = the customer owes the difference.
export function computeSettlementPreview(input: {
  returnedTotalUsd: number
  returnedTotalKhr: number
  replacementTotalUsd: number
  replacementTotalKhr: number
}): { diffUsd: number; diffKhr: number; isEven: boolean } {
  const diffUsd = Number((input.replacementTotalUsd - input.returnedTotalUsd).toFixed(2))
  const diffKhr = Math.round(input.replacementTotalKhr - input.returnedTotalKhr)
  return { diffUsd, diffKhr, isEven: Math.abs(diffUsd) < 0.005 && Math.abs(diffKhr) < 1 }
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
