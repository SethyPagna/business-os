// RET-D (owner, 5 Oct 2026): "Stock changes: when Revert is not allowed, say
// concisely WHY and WHERE (destination), with an in-built link; Revert must
// never be able to break data." TRANSITION-MATRIX-AUDIT.md section 2.4.
//
// A refusing stock guard already knows THAT the stock moved on; this module
// names WHICH record moved it, so the refusal can read "Sale #R used 3 of
// these units" with a link to that record, instead of only the counts.
//
// Contract, added BESIDE each writer's existing `error` / `code` (a client
// that does not know these fields keeps working exactly as before):
//
//   reason       'consumed'   the units were sold / moved / removed since
//                'superseded' a later change sits on top of this one
//   blocker      { kind, movement_id, movement_type, label, qty, at, branch,
//                  count, total_qty } -- the MOST RECENT such movement (the
//                  one to reverse first), plus how many there are in all
//   destination  { kind: 'movement', movement_id } -- the blocking stock
//                record; the app opens it in Stock Changes, whose detail
//                names its sale / return receipt
//
// COST: called only AFTER a guard refused, never on the success path (Free
// plan read budget). Each lookup is one indexed statement: the lot lookup
// uses idx_inventory_movements_batch (batch_id = ? satisfies its
// IS NOT NULL predicate), the branch lookup idx_inventory_movements_product_created_pg.
import type { D1Compat } from './db'
import { LEDGER_OUT_TYPES } from './stockLedgerQuery'
import { movementReferenceSelectSql } from './movementReference'
import { STOCK_IN_EDIT_REFERENCE_PREFIX, revertChainOpenSql } from './stockInSessionsQuery'

export type StockBlockerKind = 'sale' | 'return' | 'transfer' | 'stock_in_edit' | 'stock_change'
export type StockRefusalReason = 'consumed' | 'superseded'

export type StockBlocker = {
  kind: StockBlockerKind
  movement_id: number
  movement_type: string
  /** The receipt / return number the operator recognises, when the row names one. */
  label: string | null
  qty: number
  at: string | null
  branch: string | null
  /** How many blocking movements there are; this one is the most recent. */
  count: number
  total_qty: number
}

export type StockRefusalDestination = { kind: 'movement'; movement_id: number }

export type StockRefusalDetails = {
  reason: StockRefusalReason
  blocker: StockBlocker
  destination: StockRefusalDestination
}

type BlockerRow = {
  id: number; movement_type: string; quantity: number; reference_id: unknown; created_at: string | null
  branch_name: string | null; reference_kind: string | null; reference_label: string | null
  total_count: number; total_qty: number
}

const OUT_LIST = LEDGER_OUT_TYPES.map((type) => `'${type}'`).join(', ')
const OUT_TYPES = new Set<string>(LEDGER_OUT_TYPES)

/** The record family a blocking movement belongs to (pure; pinned by test). */
export function stockBlockerKind(row: { movement_type: string; reference_id?: unknown; reference_kind?: string | null }): StockBlockerKind {
  if (String(row.reference_id ?? '').startsWith(STOCK_IN_EDIT_REFERENCE_PREFIX)) return 'stock_in_edit'
  if (row.reference_kind === 'sale') return 'sale'
  if (row.reference_kind === 'return') return 'return'
  if (row.movement_type === 'transfer_out' || row.movement_type === 'transfer_in') return 'transfer'
  return 'stock_change'
}

function details(reason: StockRefusalReason, row: BlockerRow | null | undefined): StockRefusalDetails | null {
  if (!row || !(Number(row.id) > 0)) return null
  const blocker: StockBlocker = {
    kind: stockBlockerKind(row),
    movement_id: Number(row.id),
    movement_type: String(row.movement_type),
    label: row.reference_label == null ? null : String(row.reference_label),
    qty: Math.abs(Number(row.quantity) || 0),
    at: row.created_at == null ? null : String(row.created_at),
    branch: row.branch_name == null ? null : String(row.branch_name),
    count: Math.max(1, Number(row.total_count) || 1),
    total_qty: Math.abs(Number(row.total_qty) || 0),
  }
  return { reason, blocker, destination: { kind: 'movement', movement_id: blocker.movement_id } }
}

const SELECT_BLOCKER = `SELECT m.id, m.movement_type, m.quantity, m.reference_id, m.created_at,
    COALESCE(NULLIF(TRIM(m.branch_name), ''), (SELECT name FROM branches WHERE id = m.branch_id)) AS branch_name,
    ${movementReferenceSelectSql('m')},
    COUNT(*) OVER () AS total_count, SUM(ABS(m.quantity)) OVER () AS total_qty
  FROM inventory_movements m`

// A movement still standing: not itself a Revert, not reverted now, and not a
// sale that was cancelled (its restock already put the units back).
const STANDING = `(m.reference_id IS NULL OR CAST(m.reference_id AS TEXT) NOT LIKE 'revert:%')
    AND NOT ${revertChainOpenSql('m')}
    AND NOT (m.movement_type = 'sale' AND EXISTS (SELECT 1 FROM sales s WHERE s.id = m.reference_id AND s.sale_status = 'cancelled'))`

/**
 * The movement that took stock OUT of a lot (or, without a lot, out of the
 * product at the branch) after `afterMovementId`. Lot first, because that is
 * the stock the refusing guard counted; the branch is the fallback for
 * unstamped legacy outflows. null when nothing names the blocker (the stock
 * was changed without a movement) -- the caller's own text still stands.
 */
export async function findConsumingBlocker(db: D1Compat, input: {
  productId: number; branchId: number; batchId: number | null; afterMovementId: number
}): Promise<StockRefusalDetails | null> {
  try {
    const params = { product: input.productId, branch: input.branchId, lot: input.batchId, after: input.afterMovementId }
    if (input.batchId != null && input.batchId > 0) {
      const lotRow = await db.prepare(`${SELECT_BLOCKER}
        WHERE m.batch_id = @lot AND m.branch_id = @branch AND m.id > @after AND m.quantity <> 0
          AND m.movement_type IN (${OUT_LIST}) AND ${STANDING}
        ORDER BY m.id DESC LIMIT 1`).get<BlockerRow>(params)
      if (lotRow) return details('consumed', lotRow)
    }
    const branchRow = await db.prepare(`${SELECT_BLOCKER}
      WHERE m.product_id = @product AND m.branch_id = @branch AND m.id > @after AND m.quantity <> 0
        AND m.movement_type IN (${OUT_LIST}) AND ${STANDING}
      ORDER BY m.id DESC LIMIT 1`).get<BlockerRow>(params)
    return details('consumed', branchRow)
  } catch {
    // Naming the blocker is a courtesy on a refusal that already stands.
    return null
  }
}

/**
 * The most recent movement of ANY type on one of `pairs` after
 * `afterMovementId` -- the change an exact-snapshot Undo collided with (a
 * sale, transfer, count or later edit). The caller passes its OWN last row as
 * `afterMovementId`; a refused batch wrote nothing, so every later row is
 * someone else's. (Never exclude rows by a numeric reference_id: sales,
 * returns and session rowids are separate sequences that collide.)
 */
export async function findLaterChangeBlocker(db: D1Compat, input: {
  pairs: Array<{ productId: number; branchId: number }>; afterMovementId: number
}): Promise<StockRefusalDetails | null> {
  const pairs = input.pairs.filter((pair) => pair.productId > 0 && pair.branchId > 0).slice(0, 25)
  if (!pairs.length) return null
  try {
    const params: Record<string, unknown> = { after: input.afterMovementId }
    const pairSql = pairs.map((pair, index) => {
      params[`p${index}`] = pair.productId
      params[`b${index}`] = pair.branchId
      return `(m.product_id = @p${index} AND m.branch_id = @b${index})`
    }).join(' OR ')
    const row = await db.prepare(`${SELECT_BLOCKER}
      WHERE (${pairSql}) AND m.id > @after
      ORDER BY m.id DESC LIMIT 1`).get<BlockerRow>(params)
    // A later outflow (a sale, a transfer) used the stock; anything else sits on top of it.
    return details(row && OUT_TYPES.has(String(row.movement_type)) && Number(row.quantity) > 0 ? 'consumed' : 'superseded', row)
  } catch {
    return null
  }
}
