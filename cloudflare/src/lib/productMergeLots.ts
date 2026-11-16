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

// A stored received_at is ISO: a bare date, or a timestamp that starts with one. Every writer normalises to it (the UI route through
// normalizeTypedDate, day-first; CSV cells through normalizeToIsoDate by their column's own order; stock-in and counts write the business
// date). A day-first slash string such as '03/11/2026' is therefore never stored; read here it would be misread MONTH-first by Date.parse
// (as 11 March), so anything that is not ISO-led is refused (no date: it never matches) instead of guessed.
const ISO_LED = /^\d{4}-\d{2}-\d{2}(?:[T ]|$)/

/** The business-day date ('YYYY-MM-DD') of a lot's received_at, or null when it has none or is not ISO. */
export function mergeLotReceivedDate(receivedAt: unknown): string | null {
  const text = String(receivedAt ?? '').trim()
  if (!text || !ISO_LED.test(text)) return null
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

/**
 * A lot a merge may fold or match: an ACTIVE one (a row without an is_active field counts as active). An inactive kept lot is never a match
 * target and is never reactivated by a merge. An inactive DISCARDED lot is never folded and never marked: it is re-pointed onto the keeper
 * exactly as it is (inactive, unmarked), so the sale lines whose product_id follows the merge still find their lot under the same product
 * (lead ruling 16 Nov 2026, B2). A lot that is inactive and still holds stock cannot exist: the 0154 triggers refuse positive stock on an
 * inactive lot, so the earlier "inactive but stocked" exception was unreachable and is gone.
 */
export function isMergeableLot(lot: MergeLotRow): boolean {
  return lot.is_active == null || Number(lot.is_active) === 1
}

/** receivedDate -> the one ACTIVE kept lot that date's stock is added into. */
export function keeperLotByDate<T extends MergeLotRow>(keeperLots: readonly T[]): Map<string, T> {
  const byDate = new Map<string, T>()
  for (const lot of [...keeperLots].filter(isMergeableLot).sort(lotOrder)) {
    const date = mergeLotReceivedDate(lot.received_at)
    if (date && !byDate.has(date)) byDate.set(date, lot)
  }
  return byDate
}

/**
 * Discarded lot id -> the lot its stock is added into. A key present means FOLD, a key absent means the lot is created on the keeper.
 *   - A same-business-day ACTIVE kept lot is the target (lowest batch_number, then id).
 *   - With no such kept lot, the discarded lots of one date become ONE new lot: the first of them (lowest batch_number, then id) is
 *     created on the keeper and the others are folded into it (owner 16 Nov 2026: "add stock to batch if there is"; one row per date).
 *     The target is then a discarded lot id, which is itself absent from the map.
 *   - A lot with no received date is never matched: it is created as it is. An inactive discarded lot is ignored here (it is re-pointed as it is).
 * One implementation for the fold, the previews, the estimates and the group (Conflicts) path.
 */
export function matchDuplicateLots(
  keeperLots: readonly MergeLotRow[],
  duplicateLots: readonly MergeLotRow[],
): Map<number, number> {
  const byDate = keeperLotByDate(keeperLots)
  const createdByDate = new Map<string, MergeLotRow>()
  const matches = new Map<number, number>()
  for (const lot of [...duplicateLots].filter(isMergeableLot).sort(lotOrder)) {
    const date = mergeLotReceivedDate(lot.received_at)
    if (!date) continue
    const target = byDate.get(date) ?? createdByDate.get(date)
    if (target) matches.set(Number(lot.id), Number(target.id))
    else createdByDate.set(date, lot)
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

const EXPIRY_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/

/**
 * An expiry as ISO 'YYYY-MM-DD' for comparing, or null when it is not a Y-M-D date. batches.ts stores an expiry as typed, so '2027-1-5' and
 * '2027-01-31' both exist; compared as strings '2027-1-5' would sort after '2027-01-31' (the character '1' is greater than '0').
 */
export function isoExpiry(value: unknown): string | null {
  const match = EXPIRY_ISO.exec(String(value ?? '').trim())
  if (!match) return null
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * The earliest expiry across the kept lot and the lots added, compared as ISO dates (padded or not); the kept lot's own when none has
 * one. The winner is written as ISO. A value that is not a Y-M-D date is not compared and never wins over one that is.
 */
export function foldedLotExpiry(keeperExpiry: unknown, addedExpiries: readonly unknown[]): string | null {
  const present = [keeperExpiry, ...addedExpiries].map(isoExpiry).filter((value): value is string => value !== null)
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
  const duplicateById = new Map(duplicateLots.map((lot) => [Number(lot.id), lot]))
  // A target may be a discarded lot that is itself created on the keeper (the first of several on a date the keeper lacks).
  const keeperById = new Map([...keeperLots, ...[...new Set(matches.values())].map((id) => duplicateById.get(id)).filter((lot): lot is MergeLotRow => !!lot)]
    .map((lot) => [Number(lot.id), lot] as const))
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
