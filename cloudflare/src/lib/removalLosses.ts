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
 *   'delete'                  bulkDeleteEngine.ts's bulk product delete. IN
 *                             the set (p5/losses, Sep 15 2026): stock drained
 *                             by a bulk delete is destroyed exactly as
 *                             finally as a single product delete's
 *                             'write_off' is, and the owner's ruling ("if
 *                             remove directly it also counts toward losses")
 *                             draws no distinction by which UI action did the
 *                             removing. bulkDeleteEngine.ts now stamps
 *                             `reference_id = 'bulk_delete:<jobId>'` on every
 *                             row from one job (bulkDeleteWriteOffReferenceId),
 *                             the same shared-string-per-event shape
 *                             productRemoveWriteOffReferenceId uses below, so
 *                             the write_off-shaped revert guard (clause 5)
 *                             covers it too. There is currently no undo for a
 *                             bulk-delete job at all, so that guard never
 *                             actually excludes a 'delete' row today -- it is
 *                             wired ahead of an undo landing rather than
 *                             creating a gap once one does.
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
 * VALUATION IS AT READ TIME, not at write time. Several removal writers book
 * no cost columns at all (productDelete.ts, datedStockCountApply.ts, the
 * products.ts merge write-off), and `inventory_movements.unit_cost_usd` is
 * DEFAULT 0 since migration 0001, so a stored 0 means ABSENCE, not free goods.
 * removalRowLossUsd therefore treats 0 as missing and falls through to a
 * four-tier chain -- lot cost, product cost, the product's own latest costed
 * lot, then a same-name twin product's latest costed lot -- see
 * REMOVAL_LOSS_SELECT below (p5/losses, Sep 15 2026: extended past the first
 * two tiers after a production row valued a real removal at $0 because its
 * lot and its product row were both uncosted while a same-name duplicate
 * product carried the true cost). Nothing needs cost columns added at write
 * time, and a row that is uncostable everywhere is counted in
 * `unvalued_rows` rather than being silently valued at zero.
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
 *  4. no revert exists FOR this row (keyed by its own numeric id)
 *                                   a removal that was later reverted put the
 *                                   goods back on the shelf, so it must not
 *                                   count. Same correlated lookup
 *                                   stockInSessionsQuery.ts already uses.
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
    `NOT EXISTS (SELECT 1 FROM inventory_movements rv
       WHERE rv.reference_id = 'revert:' || CAST(${alias}.id AS TEXT))`,
    `(${alias}.movement_type NOT IN ('write_off', 'delete') OR ${alias}.reference_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM inventory_movements rv2
         WHERE rv2.reference_id = 'revert:' || CAST(${alias}.reference_id AS TEXT)))`,
  ].join(' AND ')
}

/**
 * The SELECT list this module's reducer expects. `fallback_unit_cost_usd` is
 * a chain of increasingly indirect sources, tried in order, used only when
 * the movement itself carries no (non-zero) cost snapshot:
 *
 *   1. the lot the units actually came from (`product_batches.unit_cost_usd`)
 *   2. the product's own cost price (`products.cost_price_usd`)
 *   3. the product's OWN most-recently-received costed lot, i.e. a different
 *      batch than the one this movement drew from actually carries a price
 *      (writers that never stamp a lot cost, or a lot whose cost was left 0)
 *   4. the most-recently-received costed lot of a SAME-NAME product row --
 *      a "twin" catalog row for the identical item (see productIdentity.ts's
 *      productRowIdentityKey; matched here on normalized name only, since
 *      SQL has no access to the JS barcode fold) whose stock was priced
 *      while this row's was not. This is exactly the production case the
 *      owner reported: `inventory_movements` id 47026 (product 2556
 *      "Girlactik Face Glow Goldie", a leading-zero-barcode duplicate of the
 *      product that actually carries the real cost) priced at $0 while its
 *      same-name twin held the true cost the whole time.
 *
 * Every tier is NULLIF'd against 0 (see removalRowLossUsd's own comment: a
 * stored/joined 0 means "no source", not "free"), so a lot or product row
 * that is itself uncosted correctly falls through to the next tier instead
 * of freezing the chain at zero. Only when NONE of the four sources exist is
 * the row `unvalued`.
 */
export const REMOVAL_LOSS_SELECT = `
  m.id AS id,
  m.created_at AS created_at,
  m.quantity AS quantity,
  m.unit_cost_usd AS unit_cost_usd,
  m.total_cost_usd AS total_cost_usd,
  COALESCE(
    NULLIF(pb.unit_cost_usd, 0),
    NULLIF(p.cost_price_usd, 0),
    (SELECT NULLIF(pb2.unit_cost_usd, 0) FROM product_batches pb2
       WHERE pb2.variant_product_id = p.id AND pb2.unit_cost_usd IS NOT NULL AND pb2.unit_cost_usd > 0
       ORDER BY pb2.received_at DESC, pb2.id DESC LIMIT 1),
    (SELECT NULLIF(pb3.unit_cost_usd, 0) FROM product_batches pb3
       JOIN products p3 ON p3.id = pb3.variant_product_id
       WHERE p3.id != p.id AND LOWER(TRIM(p3.name)) = LOWER(TRIM(p.name))
         AND pb3.unit_cost_usd IS NOT NULL AND pb3.unit_cost_usd > 0
       ORDER BY pb3.received_at DESC, pb3.id DESC LIMIT 1)
  ) AS fallback_unit_cost_usd
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
