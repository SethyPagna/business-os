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
 *   'delete'                  IN the set, but no writer posts a movement of this
 *                             type today (bulkDeleteEngine.ts drains stock
 *                             through productDelete's 'write_off' rows and
 *                             only logs an audit row named 'delete'). Kept so
 *                             a row of this shape, if one is ever written, is a
 *                             loss like a single delete's 'write_off' is, with
 *                             the same shared-reference revert guard (clause 5)
 *                             covering it.
 *   'adjustment'              duplicate-product merge write-off
 *                             (routes/products.ts, the `writeOffStock` branch)
 *                             -- a NEGATIVE-quantity row cleaning up a phantom
 *                             duplicate catalog row, not destroyed goods.
 *                             Excluded twice over: wrong type, and the
 *                             `quantity > 0` guard below.
 *
 * On the condition-tag transition table (p3/tag, Sep 14 2026): a tagged HOLD
 * writes 'damage_out' and is correctly NOT a loss here (the units are still
 * owned, still held); a direct removal writes 'remove' and IS; disposing a
 * held row (damagedLotActions.ts planDisposeTagged) writes 'write_off', and a
 * product delete that destroys OPEN held lots or sellable stock
 * (productDelete.ts) also writes 'write_off'. Both are real destroyed value
 * per the owner's ruling above, and BOTH commit set (p3/losses-writeoff, Sep
 * 15 2026): a write_off's undo now carries a discriminator this module can
 * exclude by --
 *   - DISPOSE stamps `reference_id = 'damaged_lot:<lotId>'` (stockCondition.ts
 *     damagedLotReference) and today has NO undo path at all (the ledger's
 *     generic revert refuses anything carrying that marker -- stockRevert.ts
 *     -- and there is no "un-dispose" action), so its write_off can never be
 *     reverted and always counts once booked.
 *   - productDelete's write_off(s) (one per drained branch_stock aggregate,
 *     one per drained held lot -- see productRemoveWriteOffReferenceId) share
 *     one `reference_id = 'product_remove:<operationId>:<generation>'` per
 *     apply/redo, and undo writes a counter stamped `revert:` + that same
 *     string, so an undone delete is excluded and a later redo (a NEW
 *     generation, a NEW string) is a fresh, uncounted-until-booked loss again.
 * See the second NOT EXISTS clause below -- it is keyed on `reference_id`,
 * not `id`, for 'write_off'/'delete' rows, because unlike every other writer
 * here these can post more than one loss-bearing row per real-world event.
 *
 * VALUATION IS AT READ TIME, from the cost the removal itself carried (owner,
 * 14 Oct 2026: "if cost is 0$ then it is 0 for loss. if it is none, it should
 * also be unknown. flag it."). A recorded cost of 0 is a real $0 loss. A cost
 * that was never recorded is UNKNOWN: the row is counted in `unvalued_rows`
 * and contributes nothing to the dollar figure. It is never priced from the
 * catalog, from another lot of the product, or from a same-name product -- the
 * four-tier substitution this module used to apply (p5/losses, Sep 15 2026)
 * is gone. The only source beyond the movement's own snapshot is the lot the
 * units were actually drawn from, because that is the removed item's own cost.
 */
export const REMOVAL_LOSS_MOVEMENT_TYPES = ['remove', 'write_off', 'delete'] as const

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
 * Five guards, each for a writer that would otherwise be mis-counted:
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
 *  4. the numeric revert chain is not currently reversed
 *                                   odd counter depth cancels the original
 *                                   loss; even depth restores it in its
 *                                   original reporting period. Counter rows
 *                                   never become a second loss. Reverts are
 *                                   appended, so increasing ids bound the
 *                                   indexed walk without a depth cutoff.
 *  5. no revert exists FOR this row's reference_id (write_off/delete only)
 *                                   DISPOSE and productDelete's write_off
 *                                   rows, and bulkDeleteEngine's 'delete'
 *                                   rows, are the identified exception: their
 *                                   own numeric id is never what their undo
 *                                   references (productDelete can post SEVERAL
 *                                   write_off rows per delete, and a bulk
 *                                   delete job posts one 'delete' row per
 *                                   product/branch, and each reverses them
 *                                   all with ONE shared counter -- see the
 *                                   comment on REMOVAL_LOSS_MOVEMENT_TYPES).
 *                                   Scoped to `movement_type IN ('write_off',
 *                                   'delete')` ONLY, so every other writer's
 *                                   behaviour (in particular guard 4 above,
 *                                   keyed on numeric id) is completely
 *                                   unchanged.
 *
 *  plus the excluded-reason set above.
 */
export function removalLossMovementWhere(alias = 'm'): string {
  return [
    `${alias}.movement_type IN (${quoted(REMOVAL_LOSS_MOVEMENT_TYPES)})`,
    `${alias}.quantity > 0`,
    `(${alias}.reference_id IS NULL OR CAST(${alias}.reference_id AS TEXT) NOT LIKE 'revert:%')`,
    `COALESCE(${alias}.reason, '') NOT IN (${quoted(REMOVAL_LOSS_EXCLUDED_REASONS)})`,
    `NOT EXISTS (
       WITH RECURSIVE loss_reverts(id, depth) AS (
         SELECT rv.id, 1 FROM inventory_movements rv
         WHERE rv.reference_id = 'revert:' || CAST(${alias}.id AS TEXT) AND rv.id > ${alias}.id
         UNION ALL
         SELECT rv.id, chain.depth + 1 FROM inventory_movements rv
         JOIN loss_reverts chain ON rv.reference_id = 'revert:' || CAST(chain.id AS TEXT)
         WHERE rv.id > chain.id
       )
       SELECT 1 FROM loss_reverts chain WHERE chain.depth % 2 = 1
         AND NOT EXISTS (SELECT 1 FROM inventory_movements next_revert
           WHERE next_revert.reference_id = 'revert:' || CAST(chain.id AS TEXT) AND next_revert.id > chain.id)
     )`,
    `(${alias}.movement_type NOT IN ('write_off', 'delete') OR ${alias}.reference_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM inventory_movements rv2
         WHERE rv2.reference_id = 'revert:' || CAST(${alias}.reference_id AS TEXT)))`,
  ].join(' AND ')
}

/**
 * The SELECT list this module's reducer expects. `own_lot_unit_cost_usd` is
 * the cost recorded on the lot the units were drawn from
 * (`product_batches.unit_cost_usd`), NULL when the movement names no lot or the
 * lot's cost was never recorded. It is the removed item's own cost, so it may
 * price a movement that carries no snapshot of its own; a recorded 0 on the lot
 * is a real $0 and is selected as 0, not folded into NULL.
 */
export const REMOVAL_LOSS_SELECT = `
  m.id AS id,
  m.created_at AS created_at,
  m.quantity AS quantity,
  m.unit_cost_usd AS unit_cost_usd,
  m.total_cost_usd AS total_cost_usd,
  pb.unit_cost_usd AS own_lot_unit_cost_usd
`

/** The FROM/JOIN this module's SELECT list is written against. */
export const REMOVAL_LOSS_FROM = `
  FROM inventory_movements m
  LEFT JOIN product_batches pb ON pb.id = m.batch_id
`

export type RemovalLossRow = {
  id?: number | string | null
  created_at?: string | null
  quantity?: number | string | null
  unit_cost_usd?: number | string | null
  total_cost_usd?: number | string | null
  own_lot_unit_cost_usd?: number | string | null
}

export type RemovalLossSummary = {
  /** Cost value of the stock removed in the window. Never negative. */
  removal_loss_usd: number
  /** Units removed. */
  removal_loss_qty: number
  /** Removal rows whose cost was never recorded (unknown, not $0) -- the loss is
   *  understated by whatever they were worth, and this says so instead of hiding it. */
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

// Bucket rows (one period of a split report) carry 4 places so they add up
// to the window's figure exactly; a window total keeps 2 (owner, 13 Oct 2026).
function roundTo(value: number, places: 2 | 4): number {
  if (places === 2) return round2(value)
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000
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
 * then the cost of the lot it was drawn from x quantity. A recorded cost of 0
 * is a real $0 (it is returned as 0, not skipped). A cost that is absent
 * everywhere is UNKNOWN and returns null, which the caller counts as unvalued.
 *
 * One consistency rule: the total and unit snapshots are two columns of one
 * recording. When one is positive and the other is 0, the 0 is the column the
 * writer never filled (both default to 0), so the positive one prices the row.
 * A 0 beside a 0, or a 0 beside NULL, is a recorded $0.
 */
export function removalRowLossUsd(row: RemovalLossRow): number | null {
  const quantity = finite(row.quantity) ?? 0
  if (!(quantity > 0)) return 0
  const total = finite(row.total_cost_usd)
  const unit = finite(row.unit_cost_usd)
  if (total != null && total !== 0) return Math.abs(total)
  if (unit != null && unit !== 0) return Math.abs(unit) * quantity
  if (total != null || unit != null) return 0
  const own = finite(row.own_lot_unit_cost_usd)
  if (own != null) return Math.abs(own) * quantity
  return null
}

/** Reduce priced removal rows to one summary. */
export function summarizeRemovalLosses(rows: readonly RemovalLossRow[] | null | undefined, places: 2 | 4 = 2): RemovalLossSummary {
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
    removal_loss_usd: roundTo(Math.max(0, usd), places),
    removal_loss_qty: round2(qty),
    removal_loss_unvalued_rows: unvalued,
  }
}

/** True when every removal row in the summary had a recorded cost. */
export function isRemovalLossComplete(loss: Pick<RemovalLossSummary, 'removal_loss_unvalued_rows'>): boolean {
  return loss.removal_loss_unvalued_rows === 0
}

/** Bucket removal rows by a caller-supplied period key, then reduce each. */
export function removalLossesByBucket(
  rows: readonly RemovalLossRow[] | null | undefined,
  bucketOf: (row: RemovalLossRow) => string,
  places: 2 | 4 = 2,
): Map<string, RemovalLossSummary> {
  const grouped = new Map<string, RemovalLossRow[]>()
  for (const row of rows || []) {
    const key = bucketOf(row)
    const list = grouped.get(key)
    if (list) list.push(row)
    else grouped.set(key, [row])
  }
  const out = new Map<string, RemovalLossSummary>()
  for (const [key, list] of grouped) out.set(key, summarizeRemovalLosses(list, places))
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
  places: 2 | 4 = 2,
): RemovalLossTotals {
  const revenue = finite(revenueUsd) ?? 0
  const profit = finite(profitUsd) ?? 0
  return {
    removal_loss_usd: loss.removal_loss_usd,
    removal_loss_qty: loss.removal_loss_qty,
    removal_loss_unvalued_rows: loss.removal_loss_unvalued_rows,
    revenue_after_losses_usd: roundTo(revenue - loss.removal_loss_usd, places),
    profit_after_losses_usd: roundTo(profit - loss.removal_loss_usd, places),
  }
}
