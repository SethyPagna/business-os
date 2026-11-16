import { localDateOf } from './businessDateWindow'
import { meanMoney4 } from './moneyPrecision'

// Which lot of the KEEPER a discarded product's lot is folded into, and what
// the kept lot carries afterwards. ONE implementation: the fold itself
// (routes/products.ts foldDuplicateProductInto), its dependent-lot read plan
// (productMergeSnapshot.ts), the cost preview projection
// (productMergeCostPreview.ts) and the statement estimates all call these
// functions, so a preview can never promise a fold the write would not make.
//
// Owner ruling, 16 Nov 2026 (verbatim): "merged duplicate row should integrate
// with the merge. so there shouldn't be any so called merged duplicate row
// left. it will create a batch if there isn't a match date or add stock to
// batch if there is." Asked about the same received date at a different cost
// or expiry, the owner chose "Always add on same date".
//
//   * MATCH BY RECEIVED DATE, in the business day (Cambodia, UTC+7), never by
//     batch_key. A stored full timestamp is a UTC instant, so 23:30 UTC on 3
//     Nov is 4 Nov in the shop; a stored bare date is already a business date.
//   * Same date: the duplicate lot's stock is added into the kept lot. The kept
//     lot then carries the mean of the DISTINCT non-zero costs (zero and unknown
//     are left out, as in every cost mean) and the EARLIEST non-null expiry.
//     Its supplier, lot code, payment status and credit due date stay its own.
//   * No same-date kept lot: the duplicate lot is re-pointed as a new lot.
//   * Several kept lots on that date: the lowest batch_number takes it (then
//     the lowest id), so the choice never depends on read order.
//   * A lot with no received date never matches and never is matched.
//
// Matching reads the keeper's lots as they stood BEFORE this fold; a lot the
// fold itself creates is not a match target for a second lot of the same
// duplicate (each of those is created on its own). A later fold of a group
// reads the keeper afresh, so it does match a lot an earlier fold created.

export type MergeLotRow = {
  id: number | string
  received_at?: unknown
  batch_number?: unknown
  unit_cost_usd?: unknown
  expiry_date?: unknown
  [field: string]: unknown
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/

/** The business-day date ('YYYY-MM-DD') of a lot's received_at, or null when it has none. */
export function mergeLotReceivedDate(receivedAt: unknown): string | null {
  const text = String(receivedAt ?? '').trim()
  if (!text) return null
  if (BARE_DATE.test(text)) return text
  const local = localDateOf(text)
  return BARE_DATE.test(local) ? local : null
}

function lotOrder(a: MergeLotRow, b: MergeLotRow): number {
  const numberOf = (lot: MergeLotRow) => {
    const value = lot.batch_number == null || lot.batch_number === '' ? NaN : Number(lot.batch_number)
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER
  }
  const left = numberOf(a)
  const right = numberOf(b)
  return left !== right ? left - right : Number(a.id) - Number(b.id)
}

/** receivedDate -> the one kept lot that date's stock is added into. */
export function keeperLotByDate<T extends MergeLotRow>(keeperLots: readonly T[]): Map<string, T> {
  const byDate = new Map<string, T>()
  for (const lot of [...keeperLots].sort(lotOrder)) {
    const date = mergeLotReceivedDate(lot.received_at)
    if (date && !byDate.has(date)) byDate.set(date, lot)
  }
  return byDate
}

/** Discarded lot id -> kept lot id, for the lots that have a same-date kept lot. Others are absent (created). */
export function matchDuplicateLots(
  keeperLots: readonly MergeLotRow[],
  duplicateLots: readonly MergeLotRow[],
): Map<number, number> {
  const byDate = keeperLotByDate(keeperLots)
  const matches = new Map<number, number>()
  for (const lot of duplicateLots) {
    const date = mergeLotReceivedDate(lot.received_at)
    const target = date ? byDate.get(date) : undefined
    if (target) matches.set(Number(lot.id), Number(target.id))
  }
  return matches
}

function positiveCost(value: unknown): number | null {
  if (value == null || value === '') return null
  const cost = Number(value)
  return Number.isFinite(cost) && cost > 0 ? cost : null
}

/**
 * The cost a kept lot carries after lots are added into it: the mean of the
 * DISTINCT non-zero costs across the kept lot and every lot added (4/5/6 is 5,
 * never a pairwise 5.25; ten receipts at 4 and one at 5 is 4.50). Zero and
 * unknown costs are excluded. With one distinct figure the lot keeps that
 * figure exactly as stored (an old five-place cost is not rewritten); with
 * none the kept lot's own value (zero or unknown) stands.
 */
export function foldedLotCost(keeperCost: unknown, addedCosts: readonly unknown[]): number | null {
  const distinct = [...new Set([keeperCost, ...addedCosts].map(positiveCost).filter((cost): cost is number => cost !== null))]
  if (distinct.length === 0) return keeperCost == null || keeperCost === '' ? null : Number(keeperCost)
  if (distinct.length === 1) return distinct[0]
  return meanMoney4(distinct)
}

/** The earliest non-empty expiry across the kept lot and the lots added; the kept lot's own when none has one. */
export function foldedLotExpiry(keeperExpiry: unknown, addedExpiries: readonly unknown[]): string | null {
  const present = [keeperExpiry, ...addedExpiries].map((value) => String(value ?? '').trim()).filter(Boolean)
  if (!present.length) return keeperExpiry == null ? null : String(keeperExpiry)
  return present.reduce((earliest, value) => (value < earliest ? value : earliest))
}

export type FoldedLotMetadata = {
  keeperLotId: number
  duplicateLotIds: number[]
  receivedDate: string
  unit_cost_usd: number | null
  expiry_date: string | null
  costChanged: boolean
  expiryChanged: boolean
}

/**
 * For every kept lot that takes stock from this fold: the lots added into it
 * and the cost and expiry it will carry. Keyed by kept lot id, in kept-lot id
 * order, so the write order is deterministic.
 */
export function planFoldedLotMetadata(
  keeperLots: readonly MergeLotRow[],
  duplicateLots: readonly MergeLotRow[],
  matches: ReadonlyMap<number, number> = matchDuplicateLots(keeperLots, duplicateLots),
): FoldedLotMetadata[] {
  const keeperById = new Map(keeperLots.map((lot) => [Number(lot.id), lot]))
  const duplicateById = new Map(duplicateLots.map((lot) => [Number(lot.id), lot]))
  const grouped = new Map<number, number[]>()
  for (const [duplicateId, keeperId] of [...matches].sort((a, b) => a[0] - b[0])) {
    grouped.set(keeperId, [...(grouped.get(keeperId) || []), duplicateId])
  }
  return [...grouped].sort((a, b) => a[0] - b[0]).map(([keeperLotId, duplicateLotIds]) => {
    const keeper = keeperById.get(keeperLotId)!
    const added = duplicateLotIds.map((id) => duplicateById.get(id)!)
    const unit_cost_usd = foldedLotCost(keeper.unit_cost_usd, added.map((lot) => lot.unit_cost_usd))
    const expiry_date = foldedLotExpiry(keeper.expiry_date, added.map((lot) => lot.expiry_date))
    const same = (a: unknown, b: unknown) => (a == null || a === '' ? null : String(a)) === (b == null || b === '' ? null : String(b))
    return {
      keeperLotId,
      duplicateLotIds,
      receivedDate: mergeLotReceivedDate(keeper.received_at)!,
      unit_cost_usd,
      expiry_date,
      costChanged: !same(keeper.unit_cost_usd, unit_cost_usd),
      expiryChanged: !same(keeper.expiry_date, expiry_date),
    }
  })
}
