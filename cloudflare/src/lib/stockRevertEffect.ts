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

// ---- History Undo/Redo of a stock record: what it will add or remove ----
//
// Lead (6 Oct 2026, owner rule): "the Revert confirmation must always say
// exactly what it will add/remove, by lot/branch, on every surface that offers
// Revert or Undo". Each stock applier's Undo/Redo moves the record's OWN
// recorded change (REVERT-SET: lib/stockLotAdjustment.ts, stockInLineEdit.ts,
// stockSession.ts, transferOperation.ts, productDelete.ts), so the lines are
// read from that record -- never re-derived from today's stock -- and the
// branch totals are today's quantity -> today's quantity + the change.

export const STOCK_EFFECT_APPLIERS: ReadonlySet<string> = new Set(['stock.quantity_set', 'stock.session_line_edit', 'stock.session', 'stock.transfer', 'product.remove'])
const MAX_EFFECT_LINES = 40

export type HistoryEffectLine = {
  productId: number; productName: string | null; branchId: number; branchName: string | null
  batchId: number | null; receivedAt: string | null; lotCode: string | null
  /** Signed: -30 takes 30 out, +27 puts 27 in. */
  change: number
}
export type HistoryEffectBranch = { productId: number; productName: string | null; branchId: number; branchName: string | null; before: number; after: number }
export type HistoryStockEffect = { applier: string; direction: 'undo' | 'redo'; lines: HistoryEffectLine[]; branches: HistoryEffectBranch[]; more: number }

type RawLine = { productId: number; branchId: number; batchId: number | null; change: number; dateBatchId?: number | null }
type Json = Record<string, unknown>
const n = (value: unknown) => Number(value) || 0
const parse = (value: unknown): Json => { try { return JSON.parse(String(value ?? 'null')) ?? {} } catch { return {} } }

async function recordedLines(db: D1Compat, historyId: number, payload: Json, sign: number): Promise<{ lots: RawLine[]; branches: RawLine[] } | null> {
  const applier = String(payload.applier || '')
  const lots: RawLine[] = []
  const branches: RawLine[] = []
  if (applier === 'stock.quantity_set') {
    const op = await db.prepare('SELECT before_json, after_json FROM stock_lot_adjustment_operations WHERE id=@id AND history_id=@history')
      .get<{ before_json: string; after_json: string }>({ id: String(payload.operation_id || ''), history: historyId })
    if (!op) return null
    const before = parse(op.before_json), after = parse(op.after_json)
    lots.push({ productId: n(after.productId), branchId: n(after.branchId), batchId: n(after.batchId) || null, change: sign * (n(after.lotQuantity) - n(before.lotQuantity)) })
    branches.push({ productId: n(after.productId), branchId: n(after.branchId), batchId: null, change: sign * (n(after.branchQuantity) - n(before.branchQuantity)) })
  } else if (applier === 'stock.session_line_edit') {
    const op = await db.prepare('SELECT before_json, after_json, revision_json FROM stock_lot_adjustment_operations WHERE id=@id AND history_id=@history')
      .get<{ before_json: string; after_json: string; revision_json: string }>({ id: String(payload.operation_id || ''), history: historyId })
    if (!op) return null
    const before = parse(op.before_json), after = parse(op.after_json), revision = parse(op.revision_json)
    const lotsOf = (state: Json) => (Array.isArray(state.lots) ? state.lots : []) as Json[]
    for (const lot of lotsOf(after)) {
      const was = lotsOf(before).find((l) => l.role === lot.role) ?? {}
      const id = n(lot.id) || (lot.role === 'target' ? n(revision.targetLotId) : 0)
      const change = sign * (n(lot.stock) - n(was.stock))
      if (change) lots.push({ productId: n(after.productId), branchId: n(after.branchId), batchId: id || null, change })
    }
    branches.push({ productId: n(after.productId), branchId: n(after.branchId), batchId: null, change: sign * (n(after.branchQty) - n(before.branchQty)) })
  } else if (applier === 'stock.session') {
    const op = await db.prepare(`SELECT s.payload_json FROM stock_session_operations o JOIN undo_snapshots s ON s.id=o.snapshot_id
      WHERE o.history_id=@history AND o.id=@id`).get<{ payload_json: string }>({ history: historyId, id: String(payload.operation_id || '') })
    if (!op) return null
    const snapshot = parse(op.payload_json)
    const image = (side: 'before' | 'after', key: string) => ((((snapshot[side] ?? {}) as Json)[key] ?? []) as Json[])
    for (const [key, out] of [['branchBatchStock', lots], ['branchStock', branches]] as const) {
      for (const row of image('after', key)) {
        const was = image('before', key).find((r) => r.id === row.id)
        const change = sign * (n(row.quantity) - n(was?.quantity))
        if (!change) continue
        const productId = key === 'branchStock' ? n(row.product_id)
          : n((image('after', 'batches').find((b) => b.id === row.batch_id) ?? {}).variant_product_id)
        out.push({ productId, branchId: n(row.branch_id), batchId: key === 'branchBatchStock' ? n(row.batch_id) : null, change })
      }
    }
  } else if (applier === 'stock.transfer') {
    const members = await db.prepare(`SELECT m.* FROM transfer_operation_members m JOIN transfer_operation_receipts r ON r.id=m.receipt_id
      WHERE r.operation_id=@operation AND r.action_history_id=@history ORDER BY m.ordinal`).all<Json>({ operation: String(payload.operation_id || ''), history: historyId })
    if (!members.length) return null
    // Forward moves units out of the source and into the destination; Undo the reverse.
    for (const m of members) {
      for (const a of (parse(m.allocations_json) as unknown as Json[]) || []) {
        lots.push({ productId: n(m.source_product_id), branchId: n(m.source_branch_id), batchId: n(a.source_batch_id) || null, change: -sign * n(a.quantity) })
        // A destination lot created by the move is not on the sealed member; it carries the source lot's received date.
        lots.push({ productId: n(m.destination_product_id), branchId: n(m.destination_branch_id), batchId: n(a.destination_batch_id) || null, change: sign * n(a.quantity), dateBatchId: n(a.source_batch_id) || null })
      }
      if (n(m.untracked_quantity) > 0) {
        lots.push({ productId: n(m.source_product_id), branchId: n(m.source_branch_id), batchId: null, change: -sign * n(m.untracked_quantity) })
        lots.push({ productId: n(m.destination_product_id), branchId: n(m.destination_branch_id), batchId: null, change: sign * n(m.untracked_quantity) })
      }
      branches.push({ productId: n(m.source_product_id), branchId: n(m.source_branch_id), batchId: null, change: -sign * n(m.quantity) })
      branches.push({ productId: n(m.destination_product_id), branchId: n(m.destination_branch_id), batchId: null, change: sign * n(m.quantity) })
    }
  } else if (applier === 'product.remove') {
    const op = await db.prepare('SELECT plan_json FROM product_remove_operations WHERE operation_id=@operation AND action_history_id=@history')
      .get<{ plan_json: string }>({ operation: String(payload.operation_id || ''), history: historyId })
    if (!op) return null
    const plan = parse(op.plan_json)
    // The removal wrote the stock off; Undo puts exactly that back, Redo writes it off again.
    const restore = -sign
    const productId = n(plan.product_id)
    for (const row of (plan.branch_batch_stock ?? []) as Json[]) if (n(row.quantity)) lots.push({ productId, branchId: n(row.branch_id), batchId: n(row.batch_id) || null, change: restore * n(row.quantity) })
    for (const row of (plan.branch_stock ?? []) as Json[]) if (n(row.quantity)) branches.push({ productId, branchId: n(row.branch_id), batchId: null, change: restore * n(row.quantity) })
  } else {
    return null
  }
  return { lots, branches }
}

/** What the History Undo (or Redo) of this stock record will add or remove, by lot and branch. */
export async function historyStockEffect(db: D1Compat, history: { id: number; status: string | null; undo_payload: string | null; redo_payload: string | null }, requested?: 'undo' | 'redo'): Promise<HistoryStockEffect | null> {
  const direction = requested ?? (history.status === 'redoable' ? 'redo' : 'undo')
  const payload = parse(direction === 'undo' ? history.undo_payload : history.redo_payload)
  const applier = String(payload.applier || '')
  if (!STOCK_EFFECT_APPLIERS.has(applier)) return null
  // Undo inverts the recorded change, Redo re-applies it.
  const raw = await recordedLines(db, history.id, payload, direction === 'undo' ? -1 : 1)
  if (!raw) return null
  // Merge equal (product, branch, lot) keys; keep the record's order.
  const merge = (rows: RawLine[]) => {
    const map = new Map<string, RawLine>()
    for (const row of rows) {
      const key = `${row.productId}:${row.branchId}:${row.batchId ?? ''}`
      const found = map.get(key)
      if (found) found.change += row.change
      else map.set(key, { ...row })
    }
    return [...map.values()].filter((row) => Math.abs(row.change) > 1e-9)
  }
  const lots = merge(raw.lots)
  const pairs = merge(raw.branches)
  const ids = (values: number[]) => JSON.stringify([...new Set(values.filter((v) => v > 0))])
  const [products, branchRows, lotRows, stockRows] = await Promise.all([
    db.prepare('SELECT p.id, p.name FROM json_each(@ids) j JOIN products p ON p.id=j.value').all<{ id: number; name: string | null }>({ ids: ids([...lots, ...pairs].map((r) => r.productId)) }),
    db.prepare('SELECT b.id, b.name FROM json_each(@ids) j JOIN branches b ON b.id=j.value').all<{ id: number; name: string | null }>({ ids: ids([...lots, ...pairs].map((r) => r.branchId)) }),
    db.prepare('SELECT pb.id, pb.received_at, pb.lot_code FROM json_each(@ids) j JOIN product_batches pb ON pb.id=j.value').all<{ id: number; received_at: string | null; lot_code: string | null }>({ ids: ids(lots.flatMap((r) => [n(r.batchId), n(r.dateBatchId)])) }),
    db.prepare(`SELECT json_extract(j.value,'$[0]') AS product_id, json_extract(j.value,'$[1]') AS branch_id,
        COALESCE((SELECT quantity FROM branch_stock WHERE product_id=json_extract(j.value,'$[0]') AND branch_id=json_extract(j.value,'$[1]')),0) AS quantity
      FROM json_each(@pairs) j`).all<{ product_id: number; branch_id: number; quantity: number }>({ pairs: JSON.stringify(pairs.map((r) => [r.productId, r.branchId])) }),
  ])
  const productName = (id: number) => products.find((p) => Number(p.id) === id)?.name ?? null
  const branchName = (id: number) => branchRows.find((b) => Number(b.id) === id)?.name ?? null
  const lines: HistoryEffectLine[] = lots.slice(0, MAX_EFFECT_LINES).map((row) => {
    const lotId = row.batchId || row.dateBatchId
    const lot = lotId ? lotRows.find((l) => Number(l.id) === lotId) : undefined
    return {
      productId: row.productId, productName: productName(row.productId), branchId: row.branchId, branchName: branchName(row.branchId),
      batchId: row.batchId, receivedAt: lot?.received_at ?? null, lotCode: row.batchId ? lot?.lot_code ?? null : null, change: row.change,
    }
  })
  const branches: HistoryEffectBranch[] = pairs.map((row) => {
    const before = n(stockRows.find((s) => Number(s.product_id) === row.productId && Number(s.branch_id) === row.branchId)?.quantity)
    return { productId: row.productId, productName: productName(row.productId), branchId: row.branchId, branchName: branchName(row.branchId), before, after: before + row.change }
  })
  return { applier, direction, lines, branches, more: Math.max(0, lots.length - lines.length) }
}
