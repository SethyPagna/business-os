// REVERT-SET (owner report, 6 Oct 2026, SK-II Gentle Cleanser 20g): what a
// Revert will do, stated BEFORE the operator confirms it.
//
// The owner Set one received date from 3 to 30 (+27), then pressed Revert on
// the delivery of 30 two rows below it, believing it was the Set. The Revert
// did exactly what it said -- it took the delivery's 30 back -- but nothing on
// either confirm said "-30 from received 29/09, Shop 60 -> 30" or that the
// Set of +27 would stay applied. Production audit 9987 and history 1318
// (still undoable, never tried) are the evidence.
//
// Two reads, both read-only and bounded:
//   revertEffect      the signed stock change the Revert makes, on which lot,
//                     and the branch quantity now -> after. One statement.
//   laterOpenSets     for each movement, the scoped Sets written AFTER it on
//                     the same product and branch that are still applied (no
//                     revert:<id> row). ONE statement for any number of
//                     movements (json_each), so the Stock-in Sessions list can
//                     carry it per line without a query per line (Free plan:
//                     50 D1 queries per request).
import type { D1Compat } from './db'
import type { StockMovementRevertPreview } from './stockMovementReplay'
import { LEDGER_OUT_TYPES } from './stockLedgerQuery'

export type StockRevertEffect = {
  /** The change the Revert makes to stock, signed: -30 takes 30 out. */
  quantity: number
  batchId: number | null
  receivedAt: string | null
  lotCode: string | null
  branchId: number
  branchName: string | null
  branchBefore: number
  branchAfter: number
}

export type LaterOpenSet = {
  movementId: number
  /** Signed change the Set made: +27 added, -5 removed. */
  quantity: number
  batchId: number | null
  receivedAt: string | null
  createdAt: string | null
}

const OUT_TYPES = new Set<string>(LEDGER_OUT_TYPES)
const MAX_LATER_SETS_PER_MOVEMENT = 5

type EffectRow = {
  movement_type: string; quantity: number; batch_id: number | null; branch_id: number | null; branch_name: string | null
  received_at: string | null; lot_code: string | null; branch_quantity: number | null
}

/**
 * The stock change a confirmed Revert makes. `movement` mirrors
 * lib/stockRevert.ts (the opposite of the row, its magnitude, its lot);
 * `stock_set` mirrors replayStockLotSet (the recorded lot delta). A whole
 * stock session has many lines and is described by its line count instead.
 */
export async function revertEffect(db: D1Compat, movementId: number, revert: StockMovementRevertPreview): Promise<StockRevertEffect | null> {
  if (revert.kind === 'stock_session') return null
  const row = await db.prepare(`SELECT m.movement_type, m.quantity, m.batch_id, m.branch_id, b.received_at, b.lot_code,
      (SELECT name FROM branches WHERE id = m.branch_id) AS branch_name,
      (SELECT quantity FROM branch_stock WHERE product_id = m.product_id AND branch_id = m.branch_id) AS branch_quantity
    FROM inventory_movements m LEFT JOIN product_batches b ON b.id = m.batch_id
    WHERE m.id = @id`).get<EffectRow>({ id: movementId })
  if (!row || row.branch_id == null) return null
  let quantity: number
  let branchChange: number
  if (revert.kind === 'stock_set') {
    const operation = await db.prepare('SELECT before_json, after_json FROM stock_lot_adjustment_operations WHERE id = @id')
      .get<{ before_json: string; after_json: string }>({ id: String(revert.operationId ?? '') })
    if (!operation) return null
    const before = JSON.parse(operation.before_json), after = JSON.parse(operation.after_json)
    const sign = revert.direction === 'redo' ? 1 : -1
    quantity = sign * (Number(after.lotQuantity) - Number(before.lotQuantity))
    // The branch moves by its own recorded delta, which differs from the lot's under the lot-scope floor.
    branchChange = sign * (Number(after.branchQuantity) - Number(before.branchQuantity))
  } else {
    const magnitude = Math.abs(Number(row.quantity) || 0)
    quantity = OUT_TYPES.has(row.movement_type) ? magnitude : -magnitude
    branchChange = quantity
  }
  const branchBefore = Number(row.branch_quantity) || 0
  return {
    quantity, batchId: row.batch_id ?? null, receivedAt: row.received_at ?? null, lotCode: row.lot_code ?? null,
    branchId: Number(row.branch_id), branchName: row.branch_name ?? null, branchBefore, branchAfter: branchBefore + branchChange,
  }
}

/**
 * Scoped Sets still applied on each movement's product and branch, written
 * after it -- the changes a Revert of that movement leaves in place. Bounded
 * by idx_inventory_movements_product_created_pg from the movement's own date.
 */
export async function laterOpenSets(db: D1Compat, movementIds: number[]): Promise<Map<number, LaterOpenSet[]>> {
  const ids = [...new Set(movementIds.filter((id) => Number.isSafeInteger(id) && id > 0))]
  const found = new Map<number, LaterOpenSet[]>()
  if (!ids.length) return found
  const rows = await db.prepare(`
    SELECT m.id AS origin_id, s.id, s.movement_type, s.quantity, s.batch_id, s.created_at, b.received_at
    FROM json_each(@ids) src
    JOIN inventory_movements m ON m.id = src.value
    JOIN inventory_movements s ON s.product_id = m.product_id
      AND s.created_at >= COALESCE(substr(m.created_at, 1, 10), '') AND s.id > m.id AND s.branch_id = m.branch_id
      AND s.reference_id >= 'stock-set:' AND s.reference_id < 'stock-set;'
    LEFT JOIN product_batches b ON b.id = s.batch_id
    WHERE NOT EXISTS (SELECT 1 FROM inventory_movements r WHERE r.reference_id = 'revert:' || CAST(s.id AS TEXT))
    ORDER BY m.id, s.id DESC
  `).all<{ origin_id: number; id: number; movement_type: string; quantity: number; batch_id: number | null; created_at: string | null; received_at: string | null }>({ ids: JSON.stringify(ids) })
  for (const row of rows) {
    const list = found.get(Number(row.origin_id)) ?? []
    if (list.length >= MAX_LATER_SETS_PER_MOVEMENT) continue
    const magnitude = Math.abs(Number(row.quantity) || 0)
    list.push({
      movementId: Number(row.id),
      quantity: OUT_TYPES.has(row.movement_type) ? -magnitude : magnitude,
      batchId: row.batch_id ?? null, receivedAt: row.received_at ?? null, createdAt: row.created_at ?? null,
    })
    found.set(Number(row.origin_id), list)
  }
  return found
}
