// Counts typed per received date (read switch `ic_lot_counts`) and the direct Set from a row. Pure functions: the page keeps the state, these decide what a typed figure means.
//
// A line is one received date of one product: what the person typed (counted) against the figure the screen showed (seen). A product's count is the sum of its lines and its
// baseline the sum of what they saw, so the Set-to figure keeps sales made after the screen was read: max(0, now + counted - seen) (inventoryWired.setToAmount).
import type { InventoryCheckLotRow } from '../../types/inventoryChecks.ts'
import type { StockConflictAnswer } from '../../api/stockAnswerPatch.ts'

/** What is typed on one received date of a row, with the figure the row showed when it was typed. Keyed by batch id. */
export type LotDraft = Readonly<Record<string, { count: string; seen: number }>>

export type SubmissionLotLine = { productId: number; lots: Array<{ batchId: number; scope: 'lot'; counted: number; seen: number }>; checked: boolean; note?: string }

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

/** Typed count text: blank is "no count", a non-negative decimal is a count, anything else is invalid. */
export function lotCountOf(text: string): { kind: 'empty' } | { kind: 'invalid' } | { kind: 'valid'; value: number } {
  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'empty' }
  const value = Number(trimmed)
  return /^\d*(?:\.\d*)?$/.test(trimmed) && Number.isFinite(value) && value >= 0 ? { kind: 'valid', value } : { kind: 'invalid' }
}

/** The dates a person has typed on, the sum of their counts and of what they saw, and whether every typed figure is a number. */
export function lotTotals(lots: LotDraft | undefined): { dates: number; counted: number; seen: number; valid: boolean } {
  let dates = 0, counted = 0, seen = 0, valid = true
  for (const entry of Object.values(lots ?? {})) {
    const count = lotCountOf(entry.count)
    if (count.kind === 'empty') continue
    if (count.kind === 'invalid') { valid = false; continue }
    dates++; counted += count.value; seen += entry.seen
  }
  const round = (value: number) => Math.round(value * 10000) / 10000
  return { dates, counted: round(counted), seen: round(seen), valid }
}

/** One draft's count text from its dates: the sum, blank when nothing valid is typed, blank when any figure is not a number (so the page asks for a number). */
export function countTextFromLots(lots: LotDraft | undefined): string {
  const totals = lotTotals(lots)
  return totals.dates > 0 && totals.valid ? String(totals.counted) : ''
}

/** The submission line of a product counted per received date: only the dates a person typed on, each with the figure it showed. Null when nothing is typed. */
export function lotSubmissionLine(productId: number, lots: LotDraft, extra: { checked: boolean; note?: string }): SubmissionLotLine | null {
  const entries: SubmissionLotLine['lots'] = []
  for (const [batch, entry] of Object.entries(lots)) {
    const count = lotCountOf(entry.count)
    if (count.kind !== 'valid' || !Number.isSafeInteger(Number(batch)) || Number(batch) <= 0 || !finite(entry.seen)) continue
    entries.push({ batchId: Number(batch), scope: 'lot', counted: count.value, seen: entry.seen })
  }
  if (!entries.length) return null
  entries.sort((a, b) => a.batchId - b.batchId)
  return { productId, lots: entries, checked: extra.checked, ...(extra.note ? { note: extra.note } : {}) }
}

/** What a direct Set on one received date writes: the typed figure, from the figure the row shows now. Null when nothing valid is typed or nothing would change. */
export function rowSetPlan(row: Pick<InventoryCheckLotRow, 'batchId' | 'quantity'>, text: string): { batchId: number; before: number; after: number } | null {
  const count = lotCountOf(text)
  return count.kind === 'valid' && count.value !== row.quantity ? { batchId: row.batchId, before: row.quantity, after: count.value } : null
}

export type StaleLot = { productId: number; name: string; batchId: number; receivedAt: string | null; was: number | null; now: number }

/**
 * A count refused because the stock it was typed against has moved (409 inventory_check_stock_changed) names the figures the server found. Each becomes the stale-quantity
 * answer a Set refusal carries, so the rows take the new figures without a read; the branch total of a row moves by what its date moved. Null when the refusal carries none
 * (an older server): the page then reloads as it always did.
 */
export function staleLotFigures(cause: unknown, products: ReadonlyArray<{ id: number | string; name: string; quantity?: number | null; lot_rows?: InventoryCheckLotRow[] }>, branchId: number):
  { conflicts: StockConflictAnswer[]; changed: StaleLot[] } | null {
  const found = [cause, (cause as { body?: unknown } | null)?.body, (cause as { data?: unknown } | null)?.data]
    .map(candidate => (candidate as { current?: unknown } | null)?.current).find(Array.isArray) as Array<{ productId?: unknown; batchId?: unknown; scope?: unknown; quantity?: unknown }> | undefined
  if (!found || !found.length || !Number.isSafeInteger(branchId) || branchId <= 0) return null
  const conflicts: StockConflictAnswer[] = [], changed: StaleLot[] = []
  const moved = new Map<number, number>()
  for (const entry of found) {
    const productId = Number(entry.productId), batchId = Number(entry.batchId), quantity = Number(entry.quantity)
    const product = products.find(candidate => Number(candidate.id) === productId)
    if (!product || !finite(quantity) || !finite(product.quantity)) continue
    if (entry.scope === 'branch') {
      conflicts.push({ productId, branchId, batchId: 0, current: { lotQuantity: 0, branchQuantity: quantity } })
      changed.push({ productId, name: product.name, batchId: 0, receivedAt: null, was: product.quantity, now: quantity })
      continue
    }
    const row = product.lot_rows?.find(candidate => candidate.batchId === batchId)
    if (!row) continue
    const branchQuantity = Math.max(0, product.quantity + (moved.get(productId) ?? 0) + quantity - row.quantity)
    moved.set(productId, (moved.get(productId) ?? 0) + quantity - row.quantity)
    conflicts.push({ productId, branchId, batchId, current: { lotQuantity: quantity, branchQuantity } })
    changed.push({ productId, name: product.name, batchId, receivedAt: row.receivedAt, was: row.quantity, now: quantity })
  }
  return conflicts.length ? { conflicts, changed } : null
}
