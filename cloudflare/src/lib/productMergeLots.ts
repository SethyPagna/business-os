import { localDateOf } from './businessDateWindow'
import { meanMoney4, weightedMeanMoney4 } from './moneyPrecision'

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
//   * Same date: the duplicate lot's stock is added into the kept lot (always,
//     whatever its cost or expiry). The kept lot then carries
//       - COST: the QUANTITY-WEIGHTED average of the costs of the lots combined
//         (owner 5 Oct 2026 "cost = weighted average"; each lot's weight is its
//         stock being combined, summed over branches). A $0 or unknown cost is
//         left out of the weights (owner 6 Oct): the real cost stands; if every
//         lot is $0 or unknown the kept lot's own value stands; if the weights
//         total 0 the kept lot's own cost stands. Rounded to 4 places by the
//         one rounding the cost writers use (moneyPrecision).
//       - EXPIRY: the earliest non-null.
//       - SUPPLIER, payment status, credit due date and lot code: its own, unchanged,
//         even when empty (lead ruling 16 Nov: payables are counted per receipt, so
//         taking a duplicate's supplier would make the kept lot's OWN receipt payable
//         to a supplier it was never bought from). The added lot's supplier and payable
//         stay on its own inactive source record, counted once through merge_deactivated_at.
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

export type CostedLot = { cost: unknown; quantity: unknown }

const nonNegative = (value: unknown): number => {
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0
}

/**
 * The cost a kept lot carries after lots are added into it: the QUANTITY-WEIGHTED average of the costs of the kept lot
 * and every lot added, each weighted by its stock (4 at $4 and 6 at $5 is $4.60; two lots of 6 at $4 and $5 are $4.50).
 * A $0 or unknown cost is not weighted: with one real cost among them that cost stands exactly, with none the kept lot's
 * own value (zero or unknown) stands, and when the weights of the real costs total 0 the kept lot's own cost stands.
 * Every figure leaves through moneyPrecision's 4-place rounding (owner 30 Sep): weightedMeanMoney4 for the mean,
 * meanMoney4 for a single figure.
 */
export function foldedLotCost(keeper: CostedLot, added: readonly CostedLot[]): number | null {
  const own = keeper.cost == null || keeper.cost === '' ? null : Number(keeper.cost)
  const bearing = [keeper, ...added].map((lot) => ({ cost: positiveCost(lot.cost), quantity: nonNegative(lot.quantity) }))
    .filter((lot): lot is { cost: number; quantity: number } => lot.cost !== null)
  if (bearing.length === 0) return own
  if (bearing.length === 1) return meanMoney4([bearing[0].cost])
  const totalQuantity = bearing.reduce((sum, lot) => sum + lot.quantity, 0)
  if (totalQuantity <= 0) return own
  return weightedMeanMoney4(bearing.map((lot) => ({ amount: lot.cost, factor: lot.quantity })), totalQuantity)
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
  /** Total stock per lot id (sum over branches) as it stands before the fold; a row's own lot_quantity is the fallback. */
  quantities?: ReadonlyMap<number, number>,
): FoldedLotMetadata[] {
  const keeperById = new Map(keeperLots.map((lot) => [Number(lot.id), lot]))
  const duplicateById = new Map(duplicateLots.map((lot) => [Number(lot.id), lot]))
  const quantityOf = (lot: MergeLotRow) => quantities?.get(Number(lot.id)) ?? lot.lot_quantity
  const grouped = new Map<number, number[]>()
  for (const [duplicateId, keeperId] of [...matches].sort((a, b) => a[0] - b[0])) {
    grouped.set(keeperId, [...(grouped.get(keeperId) || []), duplicateId])
  }
  return [...grouped].sort((a, b) => a[0] - b[0]).map(([keeperLotId, duplicateLotIds]) => {
    const keeper = keeperById.get(keeperLotId)!
    const added = duplicateLotIds.map((id) => duplicateById.get(id)!)
    const unit_cost_usd = foldedLotCost({ cost: keeper.unit_cost_usd, quantity: quantityOf(keeper) }, added.map((lot) => ({ cost: lot.unit_cost_usd, quantity: quantityOf(lot) })))
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
