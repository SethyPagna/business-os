// STOCK REMOVED ENTIRELY = A LOSS AT COST PRICE.
//
// Owner, Sep 14 2026: "for the losses due to remove stock actions, i want in
// stat a break down of revenue/profit excluding the losses caused by this. and
// including caused by this ... this way i can see and understand both", and
// "if remove directly it also counts toward losses. as cost price no selling
// price means loss."
//
// So this module prices the stock that left the business WITHOUT a sale, at
// the cost it was carried at, and derives the two "after losses" figures that
// sit beside the canonical revenue/profit. It does NOT change revenue_usd or
// profit_usd: the canonical definitions (canonical-revenue-definition) stay
// exactly what they were, and the loss view is an ADDITIONAL pair of numbers.
//
// Deliberately import-free so scripts/test-removal-losses-pure.cjs can
// transpile it standalone with no stubs: the SQL fragments are strings, the
// arithmetic is pure, and the date/branch window is supplied by the caller
// (salesAnalytics.ts) using the SAME business-day helpers the sales kernel
// uses, so the two figures are always scoped to the same window.

/**
 * The movement types that count as a removal LOSS.
 *
 * ONE constant so the boundary can be moved by an owner ruling in one edit
 * rather than by hunting call sites. Currently exactly one type, and that is
 * deliberate -- every other outflow in stockLedgerQuery.ts's LEDGER_OUT_TYPES
 * was checked against its writers and is NOT a loss:
 *
 *   'sale'                    revenue was recognized for it
 *   'damage_out'              a DRAW from the damaged lot (routes/sales.ts
 *                             writes it when POS sells damaged stock) -- it is
 *                             a sale, not a write-off. Counting it here would
 *                             book sold goods as destroyed goods.
 *   'supplier_return'         goes back to the supplier, against the balance
 *   'transfer_out' / 'move_out' / 'row_move_out'
 *                             the stock is still ours, at another branch/row
 *   'return_reversal' / 'replacement_out'
 *                             tied to a return record and reversed from there
 *   'out'                     inventory CSV import remove -- a data
 *                             correction, not a business event (see
 *                             importEngine.ts classifyInventory)
 *   'write_off' / 'delete'    product deletion (productDelete.ts /
 *                             bulkDeleteEngine.ts). Real destroyed value, but
 *                             their UNDO writes a fresh 'add' row instead of a
 *                             'revert:<id>' counter-movement, so an undone
 *                             delete cannot be excluded here and would be
 *                             over-reported as a permanent loss. Left out
 *                             until that undo carries a marker; over-counting
 *                             the owner's losses is worse than omitting a
 *                             class they did not name.
 *   'adjustment'              duplicate-product merge write-off
 *                             (routes/products.ts, the `writeOffStock` branch)
 *                             -- a NEGATIVE-quantity row cleaning up a phantom
 *                             duplicate catalog row, not destroyed goods.
 *                             Excluded twice over: wrong type, and the
 *                             `quantity > 0` guard below.
 *
 * On the condition-tag transition table (p3/tag, Sep 14 2026): a tagged HOLD
 * writes 'damage_out' and is correctly NOT a loss here; a direct removal writes
 * 'remove' and IS; disposing a held row writes 'write_off'. That last one
 * cannot simply be added to the set above, because 'write_off' is ALSO
 * productDelete.ts's type and productDelete's undo has no 'revert:' marker --
 * adding it today would permanently over-count every undone product deletion.
 * Adding 'write_off' therefore needs a discriminator between the two writers
 * first (a reference_id on the dispose row would be enough); that is named as
 * an owner/lane ruling, not silently assumed.
 *
 * VALUATION IS AT READ TIME, not at write time. Several removal writers book
 * no cost columns at all (productDelete.ts, datedStockCountApply.ts, the
 * products.ts merge write-off), and `inventory_movements.unit_cost_usd` is
 * DEFAULT 0 since migration 0001, so a stored 0 means ABSENCE, not free goods.
 * removalRowLossUsd therefore treats 0 as missing and falls through to
 * COALESCE(product_batches.unit_cost_usd, products.cost_price_usd) -- see
 * REMOVAL_LOSS_SELECT below. Nothing needs cost columns added at write time,
 * and a row that is uncostable everywhere is counted in `unvalued_rows` rather
 * than being silently valued at zero.
 */
export const REMOVAL_LOSS_MOVEMENT_TYPES = ['remove'] as const

/**
 * Removal movements whose `reason` is one of these are NOT losses.
 *
 * A dated stock-count import is a RECONCILIATION -- it back-dates the ledger
 * to a physical count, so its removals are corrections to a wrong number, not
 * goods that were destroyed. Owner ruling pending (default: exclude); one
 * constant so flipping it is a one-line change.
 *
 * Byte-identical to datedStockCountImport.ts's DATED_STOCK_COUNT_REASON --
 * duplicated rather than imported to keep this module import-free, and pinned
 * by test-removal-losses-pure.cjs so the two cannot drift.
 */
export const REMOVAL_LOSS_EXCLUDED_REASONS = ['Dated stock count import'] as const

function quoted(values: readonly string[]): string {
  return values.map((value) => `'${value.replace(/'/g, "''")}'`).join(', ')
}

/**
 * The WHERE fragment selecting the loss-bearing removal movements under
 * `alias`. The caller AND-s its own date/branch window onto this.
 *
 * Four guards, each for a writer that would otherwise be mis-counted:
 *
 *  1. `movement_type IN (...)`      the loss set above.
 *  2. `quantity > 0`                stockSession.ts's session UNDO writes a
 *                                   'remove' row with a NEGATIVE quantity (and
 *                                   negated costs) to reverse a stock-in
 *                                   session. It moved no goods out.
 *  3. the row is not itself a revert
 *                                   stockRevert.ts reverses an 'add' by
 *                                   writing a 'remove' stamped
 *                                   reference_id 'revert:<id>'. That undoes an
 *                                   inflow; nothing was lost.
 *  4. no revert exists FOR this row
 *                                   a removal that was later reverted put the
 *                                   goods back on the shelf, so it must not
 *                                   count. Same correlated lookup
 *                                   stockInSessionsQuery.ts already uses.
 *
 *  plus the excluded-reason set above.
 */
export function removalLossMovementWhere(alias = 'm'): string {
  return [
    `${alias}.movement_type IN (${quoted(REMOVAL_LOSS_MOVEMENT_TYPES)})`,
    `${alias}.quantity > 0`,
    `(${alias}.reference_id IS NULL OR CAST(${alias}.reference_id AS TEXT) NOT LIKE 'revert:%')`,
    `COALESCE(${alias}.reason, '') NOT IN (${quoted(REMOVAL_LOSS_EXCLUDED_REASONS)})`,
    `NOT EXISTS (SELECT 1 FROM inventory_movements rv
       WHERE rv.reference_id = 'revert:' || CAST(${alias}.id AS TEXT))`,
  ].join(' AND ')
}

/**
 * The SELECT list this module's reducer expects. `fallback_unit_cost_usd` is
 * the lot cost the units came from, or the product's cost price -- used only
 * when the movement itself carries no cost snapshot.
 */
export const REMOVAL_LOSS_SELECT = `
  m.id AS id,
  m.created_at AS created_at,
  m.quantity AS quantity,
  m.unit_cost_usd AS unit_cost_usd,
  m.total_cost_usd AS total_cost_usd,
  COALESCE(pb.unit_cost_usd, p.cost_price_usd) AS fallback_unit_cost_usd
`

/** The FROM/JOIN this module's SELECT list is written against. */
export const REMOVAL_LOSS_FROM = `
  FROM inventory_movements m
  LEFT JOIN product_batches pb ON pb.id = m.batch_id
  LEFT JOIN products p ON p.id = m.product_id
`

export type RemovalLossRow = {
  id?: number | string | null
  created_at?: string | null
  quantity?: number | string | null
  unit_cost_usd?: number | string | null
  total_cost_usd?: number | string | null
  fallback_unit_cost_usd?: number | string | null
}

export type RemovalLossSummary = {
  /** Cost value of the stock removed in the window. Never negative. */
  removal_loss_usd: number
  /** Units removed. */
  removal_loss_qty: number
  /** Removal rows that carried no cost anywhere -- the loss is understated by
   *  whatever they were worth, and this says so instead of hiding it. */
  removal_loss_unvalued_rows: number
}

export const EMPTY_REMOVAL_LOSS: RemovalLossSummary = {
  removal_loss_usd: 0,
  removal_loss_qty: 0,
  removal_loss_unvalued_rows: 0,
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function finite(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Price ONE removal row.
 *
 * Order: the movement's own total snapshot, then its unit snapshot x quantity,
 * then the lot/product cost x quantity. A stored cost of exactly 0 is treated
 * as ABSENT rather than as "these goods were free": inventory_movements'
 * cost columns are `DEFAULT 0` (migration 0001) and the writers that predate
 * resolveMovementCostSnapshot left them at that default, so honouring the zero
 * would silently value a real removal at nothing. The only case this changes
 * is a genuinely free item that has a non-zero carried cost -- it is then
 * valued at that carried cost, which is the figure the owner reads as "what it
 * cost me".
 *
 * Returns null when no source can price the row (the caller counts it as
 * unvalued).
 */
export function removalRowLossUsd(row: RemovalLossRow): number | null {
  const quantity = finite(row.quantity) ?? 0
  if (!(quantity > 0)) return 0
  const total = finite(row.total_cost_usd)
  if (total != null && total !== 0) return Math.abs(total)
  const unit = finite(row.unit_cost_usd)
  if (unit != null && unit !== 0) return Math.abs(unit) * quantity
  const fallback = finite(row.fallback_unit_cost_usd)
  if (fallback != null && fallback !== 0) return Math.abs(fallback) * quantity
  return null
}

/** Reduce priced removal rows to one summary. */
export function summarizeRemovalLosses(rows: readonly RemovalLossRow[] | null | undefined): RemovalLossSummary {
  let usd = 0
  let qty = 0
  let unvalued = 0
  for (const row of rows || []) {
    const quantity = finite(row.quantity) ?? 0
    if (!(quantity > 0)) continue
    qty += quantity
    const value = removalRowLossUsd(row)
    if (value == null) unvalued += 1
    else usd += value
  }
  return {
    removal_loss_usd: round2(Math.max(0, usd)),
    removal_loss_qty: round2(qty),
    removal_loss_unvalued_rows: unvalued,
  }
}

/** Bucket removal rows by a caller-supplied period key, then reduce each. */
export function removalLossesByBucket(
  rows: readonly RemovalLossRow[] | null | undefined,
  bucketOf: (row: RemovalLossRow) => string,
): Map<string, RemovalLossSummary> {
  const grouped = new Map<string, RemovalLossRow[]>()
  for (const row of rows || []) {
    const key = bucketOf(row)
    const list = grouped.get(key)
    if (list) list.push(row)
    else grouped.set(key, [row])
  }
  const out = new Map<string, RemovalLossSummary>()
  for (const [key, list] of grouped) out.set(key, summarizeRemovalLosses(list))
  return out
}

export type RemovalLossTotals = RemovalLossSummary & {
  /** Canonical revenue, unchanged, minus the removal losses. */
  revenue_after_losses_usd: number
  /**
   * Canonical profit, unchanged, minus the removal losses. UNCLAMPED on
   * purpose: this is the explicit "including the losses" view the owner asked
   * for, and a month that destroyed more stock than it earned really is
   * negative here. The no-negative-revenue-or-profit rule governs the
   * canonical profit_usd / revenue_usd, which this never touches.
   */
  profit_after_losses_usd: number
}

/**
 * The five fields every totals surface carries. Never merged into revenue_usd
 * or profit_usd -- both views are reported side by side, which is the whole
 * point of the request ("this way i can see and understand both").
 */
export function removalLossTotals(
  revenueUsd: unknown,
  profitUsd: unknown,
  loss: RemovalLossSummary,
): RemovalLossTotals {
  const revenue = finite(revenueUsd) ?? 0
  const profit = finite(profitUsd) ?? 0
  return {
    removal_loss_usd: loss.removal_loss_usd,
    removal_loss_qty: loss.removal_loss_qty,
    removal_loss_unvalued_rows: loss.removal_loss_unvalued_rows,
    revenue_after_losses_usd: round2(revenue - loss.removal_loss_usd),
    profit_after_losses_usd: round2(profit - loss.removal_loss_usd),
  }
}
