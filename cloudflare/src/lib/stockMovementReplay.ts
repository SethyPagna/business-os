import type { D1Compat } from './db'
import type { ActionHistoryRow } from '../routes/actionHistory'
import { STOCK_LOT_SET_KIND, STOCK_SET_REFERENCE_PREFIX } from './stockLotAdjustment'
import { STOCK_SESSION_KIND } from './stockSession'

type Movement = {
  id: number; product_id: number; branch_id: number; batch_id: number | null
  movement_type: string; quantity: number; reference_id: string | null; reason: string | null
}

export type StockMovementRevertPreview = {
  kind: 'movement' | 'stock_set' | 'stock_session'
  movementId: number
  historyId?: number
  operationId?: string
  direction?: 'undo' | 'redo'
  expectedGeneration?: number
  label?: string
  lineCount: number
}

export class StockMovementReplayError extends Error {
  constructor(message: string, public status: 404 | 409 = 409, public code = 'undo_history_unusable') { super(message) }
}

const unavailable = () => new StockMovementReplayError('This stock action has no exact replay identity. Nothing was changed.')

export async function stockMovementRevertPreview(db: D1Compat, movementId: number): Promise<{ revert: StockMovementRevertPreview; history: ActionHistoryRow | null }> {
  const movement = await db.prepare('SELECT id,product_id,branch_id,batch_id,movement_type,quantity,reference_id,reason FROM inventory_movements WHERE id=@id').get<Movement>({ id: movementId })
  if (!movement) throw new StockMovementReplayError('Stock movement not found.', 404)
  const reference = String(movement.reference_id ?? '')
  const parent = /^revert:\d+$/.test(reference)
    ? await db.prepare('SELECT id,product_id,branch_id,batch_id,movement_type,quantity,reference_id,reason FROM inventory_movements WHERE id=@id').get<Movement>({ id: Number(reference.slice(7)) })
    : null
  const setReference = reference.startsWith(STOCK_SET_REFERENCE_PREFIX) ? reference : String(parent?.reference_id ?? '')
  let kind: 'stock_set' | 'stock_session' | null = null
  let operationId = ''
  let historyId = 0
  let expectedGeneration = 0
  let lineCount = 1
  if (setReference.startsWith(STOCK_SET_REFERENCE_PREFIX)) {
    const match = /^stock-set:(.+):(\d+)$/.exec(setReference)
    if (!match) throw unavailable()
    kind = 'stock_set'
    operationId = match[1]
    expectedGeneration = Number(match[2]) + (reference.startsWith('revert:') ? 1 : 0)
    if (Number(match[2]) % 2 !== 0) throw unavailable()
    const operation = await db.prepare('SELECT history_id,before_json FROM stock_lot_adjustment_operations WHERE id=@id').get<{ history_id: number; before_json: string }>({ id: operationId })
    if (!operation) throw unavailable()
    const before = JSON.parse(operation.before_json)
    if (before.productId !== movement.product_id || before.branchId !== movement.branch_id || before.batchId !== movement.batch_id) throw unavailable()
    historyId = operation.history_id
  } else {
    const member = await db.prepare('SELECT o.id,o.history_id FROM stock_session_members m JOIN stock_session_operations o ON o.id=m.operation_id WHERE m.movement_id=@movement').get<{ id: string; history_id: number }>({ movement: movementId })
    if (member) {
      kind = 'stock_session'
      operationId = member.id
      historyId = member.history_id
    } else if (/^\d+$/.test(reference)) {
      const operation = await db.prepare('SELECT id,history_id FROM stock_session_operations WHERE rowid=@rowid').get<{ id: string; history_id: number }>({ rowid: Number(reference) })
      if (operation) {
        const match = /^Stock session (\S+) (undo|redo) generation (\d+)$/.exec(String(movement.reason ?? ''))
        if (!match || match[1] !== operation.id) throw unavailable()
        expectedGeneration = Number(match[3])
        const undo = match[2] === 'undo'
        if (expectedGeneration <= 0 || expectedGeneration % 2 !== (undo ? 1 : 0)
          || movement.movement_type !== (undo ? 'remove' : 'add')) throw unavailable()
        const member = await db.prepare(`SELECT line_id FROM stock_session_members WHERE operation_id=@operation AND product_id=@product
          AND branch_id=@branch AND batch_id IS @batch AND quantity=@quantity LIMIT 1`).get({ operation: operation.id, product: movement.product_id,
            branch: movement.branch_id, batch: movement.batch_id, quantity: Number(movement.quantity) * (undo ? -1 : 1) })
        if (!member) throw unavailable()
        kind = 'stock_session'
        operationId = operation.id
        historyId = operation.history_id
      }
    }
    if (kind === 'stock_session') {
      const count = await db.prepare('SELECT COUNT(*) AS count FROM stock_session_members WHERE operation_id=@id').get<{ count: number }>({ id: operationId })
      lineCount = Number(count?.count || 0)
    }
  }
  if (!kind) return { revert: { kind: 'movement', movementId, lineCount: 1 }, history: null }
  if (!Number.isSafeInteger(expectedGeneration) || expectedGeneration < 0 || !Number.isSafeInteger(historyId) || historyId <= 0 || lineCount < 1) throw unavailable()
  const history = await db.prepare('SELECT * FROM action_history WHERE id=@id').get<ActionHistoryRow>({ id: historyId })
  if (!history || !history.reversible) throw unavailable()
  const payload = JSON.parse(String(history.undo_payload || '{}'))
  if (payload.operation_id !== operationId || payload.applier !== (kind === 'stock_set' ? STOCK_LOT_SET_KIND : STOCK_SESSION_KIND)) throw unavailable()
  const direction = expectedGeneration % 2 === 0 ? 'undo' : 'redo'
  const currentGeneration = Number(payload.generation)
  const expectedStatus = direction === 'undo' ? 'undoable' : 'redoable'
  if (currentGeneration !== expectedGeneration || history.status !== expectedStatus) {
    throw new StockMovementReplayError('This stock action generation is stale. Refresh its history. Nothing was changed.', 409, 'undo_history_stale')
  }
  return { revert: { kind, movementId, historyId, operationId, direction, expectedGeneration, label: String(history.label || ''), lineCount }, history }
}
