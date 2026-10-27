// Undo / Redo of an old-format return edit replays a whole snapshot through PATCH /api/returns/:id.
// This is the pure half of Returns.tsx's buildReturnHistoryPayload: the body each snapshot line becomes.
//
// 6.0.999. The body used to send each line as `return_to_stock: item.return_to_stock !== false` and nothing else.
// The snapshot is what GET /api/returns/:id returned, i.e. the database row, where return_to_stock is the integer 0
// or 1 -- and `0 !== false` is true. So a stored DAMAGED line and a stored NO-RESTOCK line were both replayed as a
// restock: the units became sellable stock and the damaged lot (and its tag) was never re-created. Now every line
// says what it was stored with:
//   - stock_action: restock / damaged / none, read from the stored row (the integer 0 means not restocked);
//   - a damaged line also sends the condition_tag and damaged_disposition the Worker attached to the snapshot
//     (cloudflare/src/lib/returnsStock.ts storedDamagedChoices);
//   - a line that does not say, or a damaged line without its tag, makes the whole body null: nothing is sent, and
//     the caller tells the operator why. A replay never fills a gap with a default.
// The Worker enforces the same rule from its side (firstLineWithoutStockAction); the two stay in step through
// cloudflare/scripts/test-return-history-stock-action-pure.cjs, which runs both on one table.
import type { ReturnStockAction } from './returnOptions.ts'

export interface ReturnHistorySnapshotLine {
  sale_item_id?: number | string | null
  product_id?: number | string | null
  product_name?: string | null
  quantity?: number | string | null
  applied_price_usd?: number | string | null
  applied_price_khr?: number | string | null
  /** The integer the database holds (0 / 1); older typings called it a boolean. */
  return_to_stock?: boolean | number | string | null
  stock_action?: string | null
  /** Damaged lines only: the tag of the lot the line opened (GET /api/returns/:id). */
  condition_tag?: string | null
  damaged_disposition?: string | null
  branch_id?: number | string | null
}

export interface ReturnHistorySnapshot {
  reason?: string | null
  return_type?: string | null
  notes?: string | null
  total_refund_usd?: number | string | null
  total_refund_khr?: number | string | null
  branch_id?: number | string | null
  items: ReturnHistorySnapshotLine[]
}

export interface ReturnHistoryLine {
  sale_item_id: number | string | null
  product_id: number | string | null
  product_name: string | null
  quantity: number | string
  applied_price_usd: number | string
  applied_price_khr: number | string
  return_to_stock: boolean
  stock_action: ReturnStockAction
  condition_tag?: string
  damaged_disposition?: 'keep'
  branch_id: number | string | null
}

export interface ReturnHistoryPayload extends Record<string, unknown> {
  reason: string
  return_type: string
  notes: string
  total_refund_usd: number | string
  total_refund_khr: number | string
  branch_id: number | string | null
  items: ReturnHistoryLine[]
}

/** What a STORED line did to stock. Mirrors the Worker's storedStockAction: the integer 0 is "not restocked". null: the
 *  line says neither way, so nothing may be replayed from it. */
export function storedStockAction(row: { stock_action?: unknown; return_to_stock?: unknown }): ReturnStockAction | null {
  const explicit = String(row.stock_action ?? '').trim().toLowerCase()
  if (explicit === 'none' || explicit === 'restock' || explicit === 'damaged') return explicit
  const flag = row.return_to_stock
  if (flag === true || flag === 1 || flag === '1') return 'restock'
  if (flag === false || flag === 0 || flag === '0') return 'none'
  return null
}

function replayLine(item: ReturnHistorySnapshotLine, snapshotBranchId: number | string | null | undefined): ReturnHistoryLine | null {
  const action = storedStockAction(item)
  if (!action) return null
  // No cost_price_* here, on purpose (e11138a77): a snapshot read without cost access has them redacted, and a replay must
  // not turn a hidden cost into a zero override. The Worker keeps the recorded return cost when a line omits it
  // (frontend/tests/returnCostPayload.test.ts holds this).
  const line: ReturnHistoryLine = {
    sale_item_id: item.sale_item_id || null,
    product_id: item.product_id || null,
    product_name: item.product_name || null,
    quantity: item.quantity || 0,
    applied_price_usd: item.applied_price_usd || 0,
    applied_price_khr: item.applied_price_khr || 0,
    return_to_stock: action === 'restock',
    stock_action: action,
    branch_id: item.branch_id || snapshotBranchId || null,
  }
  if (action !== 'damaged') return line
  // Only a held lot can be replayed ('keep'); a destroyed or drawn one is never re-created by an Undo or Redo.
  const tag = String(item.condition_tag ?? '').trim()
  if (!tag || item.damaged_disposition !== 'keep') return null
  return { ...line, condition_tag: tag, damaged_disposition: 'keep' }
}

/** The Undo / Redo body for a snapshot, or null when any line cannot be replayed without guessing its stock handling. */
export function returnHistoryPayloadFromSnapshot(snapshot: ReturnHistorySnapshot): ReturnHistoryPayload | null {
  const items: ReturnHistoryLine[] = []
  for (const item of snapshot.items) {
    const line = replayLine(item, snapshot.branch_id)
    if (!line) return null
    items.push(line)
  }
  return {
    reason: snapshot.reason || '',
    return_type: snapshot.return_type || 'restock',
    notes: snapshot.notes || '',
    total_refund_usd: snapshot.total_refund_usd || 0,
    total_refund_khr: snapshot.total_refund_khr || 0,
    branch_id: snapshot.branch_id || null,
    items,
  }
}
