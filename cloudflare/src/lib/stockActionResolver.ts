// The action/delta kernel for the unified "Add / Sale / Reconciliation"
// import (progress.md item 2.1). One import mode, two OPTIONS, one column
// set: name, barcode, shop, warehouse, date, action, selling_price,
// vip_price, cost_price, batch. The whole point is that the SYSTEM decides
// create / add / sale from the numbers and the date -- "no guessing and
// comparing stock current with import" -- and the `action` column only
// disambiguates a same-day mix or names a specific POS sale.
//
// This file is deliberately PURE and DB-free: it takes a row's per-branch
// numbers plus the current per-branch stock and returns a concrete plan or
// a flagged conflict. Product/branch matching (which existing row a
// name/barcode resolves to) is a separate, DB-bound step, exactly as
// datedStockCountRoute.ts splits its DB lookups from its computation -- so
// this correctness-critical logic can be tested in isolation against every
// edge the spec names.
//
// The two OPTIONS the user described:
//
//   DIRECT  -- the shop/warehouse numbers ARE the change to apply, and the
//              `action` column says add vs sale. "shop add 2, warehouse
//              nothing" => shop=2, warehouse=0, action=add => add 2 at shop.
//              "sale 2 in warehouse" => shop=0, warehouse=2, action=sale =>
//              sell 2 from warehouse. No comparison with current stock.
//
//   RECONCILE -- the shop/warehouse numbers are the TOTAL count as of the
//              date, and the system computes the delta against current
//              stock: import > current => add the difference; import <
//              current => sale the difference. The `action` column, when
//              present, must AGREE with the computed direction, otherwise
//              the row is flagged for review (a same-day add-then-sale can
//              net to a count that hides one of the two -- the action
//              column is how a human says which really happened).
//
// Sale grouping, the user's own rule:
//   action = 'sale'    -> ONE aggregated daily sale: every 'sale' row on
//                         the same date is one receipt for all its products.
//   action = 'sale1'/'sale2'/... -> a SPECIFIC POS sale that day: all rows
//                         sharing 'saleN' + date are one receipt, so several
//                         real sales in a day stay separate.
// This is why no per-sale template is needed: the ordinal on the action
// column carries the grouping.

/** A single row's per-branch numbers, already resolved to real branch ids. */
export interface StockActionRow {
  rowNumber: number
  /** Import number for each branch this row touches, keyed by real branch id. */
  branchValues: Array<{ branchId: number; value: number }>
  /** ISO date (YYYY-MM-DD) the change happened / the count is as of. */
  date: string
  /** The raw action-column text; '' means "let the system infer". */
  action: string
  costPriceUsd?: number | null
  sellingPriceUsd?: number | null
  vipPriceUsd?: number | null
  batchLabel?: string | null
  /** True when name+barcode matched no existing product. */
  isNewProduct?: boolean
}

export type StockActionMode = 'direct' | 'reconcile'

/** What one branch's stock should do for this row. */
export interface BranchStockAction {
  branchId: number
  direction: 'add' | 'sale' | 'none'
  quantity: number
}

export interface StockActionPlan {
  rowNumber: number
  /**
   * create -- new product, seed its initial stock (an add that also
   *           inserts the product row).
   * add    -- receive stock into one or more branches (a batch/receipt).
   * sale   -- deduct stock as a recorded sale.
   * noop   -- the numbers describe no change (reconcile with zero delta).
   */
  kind: 'create' | 'add' | 'sale' | 'noop'
  /**
   * For a sale: the receipt this row belongs to. Rows sharing a saleGroupKey
   * are one sale. `${date}` for a plain daily 'sale'; `${date}#${n}` for
   * 'saleN'. Null for non-sales.
   */
  saleGroupKey: string | null
  branchActions: BranchStockAction[]
  /**
   * Human-readable reasons this row cannot be applied unattended. A
   * non-empty list means the review screen must show the row and the whole
   * import is gated behind an explicit "Confirm Action" before it can run
   * (per the user: multiple batches + multiple cost prices, or a sale that
   * would go negative, get flagged rather than guessed).
   */
  conflicts: string[]
}

const SALE_ACTION_RE = /^sale\s*(\d+)?$/i
const ADD_ACTION_RE = /^(add|receive|stock|purchase|in)$/i
const CREATE_ACTION_RE = /^(create|new)$/i

export interface ParsedStockAction {
  kind: 'add' | 'sale' | 'create' | 'auto'
  /** For 'saleN', the N; null for a plain daily 'sale' or a non-sale. */
  saleOrdinal: number | null
}

/**
 * Reads the free-text action column. Blank (or 'auto') defers to the mode's
 * own inference. Unknown text is treated as 'auto' too, NOT silently
 * dropped -- an unrecognised action still produces a plan (inferred) and,
 * where the mode cannot infer safely, a conflict, so a typo can never make
 * a row vanish.
 */
export function parseStockAction(raw: unknown): ParsedStockAction {
  const text = String(raw ?? '').trim()
  if (!text) return { kind: 'auto', saleOrdinal: null }
  if (CREATE_ACTION_RE.test(text)) return { kind: 'create', saleOrdinal: null }
  if (ADD_ACTION_RE.test(text)) return { kind: 'add', saleOrdinal: null }
  const saleMatch = text.match(SALE_ACTION_RE)
  if (saleMatch) {
    const ordinal = saleMatch[1] ? Number(saleMatch[1]) : null
    return { kind: 'sale', saleOrdinal: ordinal && ordinal > 0 ? ordinal : null }
  }
  return { kind: 'auto', saleOrdinal: null }
}

/** The receipt key for a sale row: daily, or per-POS-sale when numbered. */
export function saleGroupKeyFor(date: string, saleOrdinal: number | null): string {
  return saleOrdinal ? `${date}#${saleOrdinal}` : date
}

function roundQty(value: number): number {
  // Stock is tracked to whole/decimal units elsewhere; keep 3dp to avoid
  // float dust turning a real 0 delta into a spurious add/sale.
  return Math.round((Number(value) || 0) * 1000) / 1000
}

/**
 * The core: turn one row + the branch's current stock into a plan.
 *
 * DIRECT mode: `value` is the magnitude of the change; the action column
 * gives the direction (add unless it says sale). A create row is an add
 * that also inserts the product.
 *
 * RECONCILE mode: `value` is the target total; the delta against current
 * stock gives both magnitude and direction. If the action column disagrees
 * with the computed direction, the row is flagged rather than guessed.
 */
export function resolveRowStockAction(
  row: StockActionRow,
  currentByBranch: Map<number, number>,
  mode: StockActionMode,
): StockActionPlan {
  const parsed = parseStockAction(row.action)
  const conflicts: string[] = []

  // A brand-new product can only be a create/add -- there is nothing to
  // sell yet. An explicit 'sale' on an unmatched row is a real mistake, so
  // it is flagged, not silently turned into a create.
  const isCreate = parsed.kind === 'create' || (row.isNewProduct === true && parsed.kind !== 'sale')
  if (row.isNewProduct && parsed.kind === 'sale') {
    conflicts.push('Row is a sale but its name/barcode matches no existing product — nothing to sell.')
  }

  const branchActions: BranchStockAction[] = []
  let sawSale = false
  let sawAdd = false

  for (const entry of row.branchValues) {
    const value = roundQty(entry.value)
    const current = roundQty(currentByBranch.get(entry.branchId) ?? 0)

    if (mode === 'direct') {
      // The number is the change magnitude; 0 means this branch is untouched.
      if (value === 0) { branchActions.push({ branchId: entry.branchId, direction: 'none', quantity: 0 }); continue }
      if (parsed.kind === 'sale') {
        sawSale = true
        if (value > current) {
          conflicts.push(`Sale of ${value} at branch ${entry.branchId} exceeds current stock ${current}.`)
        }
        branchActions.push({ branchId: entry.branchId, direction: 'sale', quantity: value })
      } else {
        // add, create, or auto -> a stock addition
        sawAdd = true
        branchActions.push({ branchId: entry.branchId, direction: 'add', quantity: value })
      }
      continue
    }

    // reconcile: value is the target total; the delta decides.
    const delta = roundQty(value - current)
    if (delta === 0) { branchActions.push({ branchId: entry.branchId, direction: 'none', quantity: 0 }); continue }
    const direction: 'add' | 'sale' = delta > 0 ? 'add' : 'sale'
    if (direction === 'add') sawAdd = true
    else sawSale = true
    // Action column, when explicit, must agree with the computed direction.
    if (parsed.kind === 'add' && direction === 'sale') {
      conflicts.push(`Action says add, but the count dropped from ${current} to ${value} at branch ${entry.branchId}.`)
    }
    if (parsed.kind === 'sale' && direction === 'add') {
      conflicts.push(`Action says sale, but the count rose from ${current} to ${value} at branch ${entry.branchId}.`)
    }
    branchActions.push({ branchId: entry.branchId, direction, quantity: Math.abs(delta) })
  }

  // A single row that both adds and sells across its branches is only
  // legitimate under an explicit action; otherwise it is the ambiguous
  // same-day case the action column exists to resolve.
  let kind: StockActionPlan['kind']
  if (isCreate) {
    kind = 'create'
  } else if (sawSale && !sawAdd) {
    kind = 'sale'
  } else if (sawAdd && !sawSale) {
    kind = 'add'
  } else if (!sawAdd && !sawSale) {
    kind = 'noop'
  } else {
    // mixed add+sale in one row
    if (parsed.kind === 'sale') kind = 'sale'
    else if (parsed.kind === 'add') kind = 'add'
    else {
      kind = 'add'
      conflicts.push('Row both adds and sells stock across branches on the same date — set the action column (add / sale) to say which.')
    }
  }

  const saleGroupKey = kind === 'sale' ? saleGroupKeyFor(row.date, parsed.saleOrdinal) : null
  return { rowNumber: row.rowNumber, kind, saleGroupKey, branchActions, conflicts }
}

/**
 * Cross-row check the per-row resolver cannot do: the same product
 * (name+barcode) appearing on several rows with DIFFERENT cost prices AND
 * more than one batch is genuinely ambiguous for a sale — which lot, at
 * which cost, is being drawn down? Per the user this is flagged with a
 * reason and held behind the Confirm Action gate, not resolved by a guess.
 *
 * Pricing that only differs in SELLING / VIP price is NOT a conflict: those
 * both resolve to the selling price for a sale, so they never force a
 * choice. Only cost + batch multiplicity does.
 *
 * `identityKey` groups the rows (typically `${nameKey}|${barcode}`). Returns
 * one reason per conflicting group, keyed by every row number in it, so the
 * review screen can mark each affected row.
 */
export function detectCostBatchConflicts(
  rows: Array<{ rowNumber: number; identityKey: string; costPriceUsd?: number | null; batchLabel?: string | null }>,
): Map<number, string> {
  const byIdentity = new Map<string, typeof rows>()
  for (const row of rows) {
    const list = byIdentity.get(row.identityKey)
    if (list) list.push(row)
    else byIdentity.set(row.identityKey, [row])
  }

  const reasonByRow = new Map<number, string>()
  for (const [, group] of byIdentity) {
    if (group.length < 2) continue
    const distinctCosts = new Set(
      group
        .map((r) => (r.costPriceUsd == null || r.costPriceUsd === 0 ? null : roundQty(r.costPriceUsd)))
        .filter((v) => v != null),
    )
    const distinctBatches = new Set(
      group.map((r) => String(r.batchLabel ?? '').trim()).filter((v) => v !== ''),
    )
    if (distinctCosts.size > 1 && distinctBatches.size > 1) {
      const reason = COST_BATCH_CONFLICT_MESSAGE
      for (const r of group) reasonByRow.set(r.rowNumber, reason)
    }
  }
  return reasonByRow
}

export const COST_BATCH_CONFLICT_MESSAGE = 'Same product has multiple batches at different cost prices — choose which lot each sale draws from before importing.'

export interface StockActionResolution {
  plans: StockActionPlan[]
  /** True when ANY plan carries a conflict — the review screen must gate the import behind Confirm Action. */
  needsReview: boolean
}

/**
 * Resolve a whole sheet: every row gets a plan, cross-row cost/batch
 * conflicts are merged into the affected rows' conflict lists, and
 * `needsReview` says whether the Confirm Action gate is required.
 *
 * Every input row produces exactly one plan — nothing is dropped, matching
 * the "no products hidden/forgotten/lost" rule the dated-count decisions
 * layer already enforces.
 */
export function resolveStockActions(
  rows: StockActionRow[],
  currentStock: Array<{ branchId: number; productKey: string; quantity: number }>,
  mode: StockActionMode,
  identityKeyOf: (row: StockActionRow) => string,
): StockActionResolution {
  // current stock keyed per (productKey, branchId)
  const currentByProductBranch = new Map<string, Map<number, number>>()
  for (const entry of currentStock) {
    const branchMap = currentByProductBranch.get(entry.productKey) ?? new Map<number, number>()
    branchMap.set(entry.branchId, entry.quantity)
    currentByProductBranch.set(entry.productKey, branchMap)
  }

  const plans = rows.map((row) => {
    const key = identityKeyOf(row)
    const branchMap = currentByProductBranch.get(key) ?? new Map<number, number>()
    return resolveRowStockAction(row, branchMap, mode)
  })

  const conflictRows = detectCostBatchConflicts(
    rows.map((row) => ({
      rowNumber: row.rowNumber,
      identityKey: identityKeyOf(row),
      costPriceUsd: row.costPriceUsd,
      batchLabel: row.batchLabel,
    })),
  )
  for (const plan of plans) {
    const reason = conflictRows.get(plan.rowNumber)
    if (reason && !plan.conflicts.includes(reason)) plan.conflicts.push(reason)
  }

  return { plans, needsReview: plans.some((plan) => plan.conflicts.length > 0) }
}
