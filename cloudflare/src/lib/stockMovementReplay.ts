import type { D1Compat } from './db'
import type { ActionHistoryRow } from '../routes/actionHistory'
import { STOCK_LOT_SET_KIND, STOCK_SET_REFERENCE_PREFIX } from './stockLotAdjustment'
import { STOCK_SESSION_KIND, STOCK_SESSION_MAX_LINES } from './stockSession'

type Movement = {
  id: number; product_id: number; branch_id: number; batch_id: number | null
  movement_type: string; quantity: number; reference_id: string | null
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
const stale = () => new StockMovementReplayError('This stock action generation is stale. Refresh its history. Nothing was changed.', 409, 'undo_history_stale')

async function sessionMovementGeneration(db: D1Compat, movement: Movement, operation: { id: string; generation: number }): Promise<number> {
  const generation = operation.generation
  if (!Number.isSafeInteger(generation) || generation <= 0 || !['add', 'remove'].includes(movement.movement_type)) throw unavailable()
  type MemberMovement = Movement & { member_product: number; member_branch: number; member_batch: number | null; member_quantity: number }
  const originals = await db.prepare(`SELECT i.id,i.product_id,i.branch_id,i.batch_id,i.movement_type,i.quantity,i.reference_id,
    m.product_id AS member_product,m.branch_id AS member_branch,m.batch_id AS member_batch,m.quantity AS member_quantity
    FROM stock_session_members m LEFT JOIN inventory_movements i ON i.id=m.movement_id
    WHERE m.operation_id=@id AND m.quantity>0 ORDER BY m.line_id LIMIT @limit`).all<MemberMovement>({ id: operation.id, limit: STOCK_SESSION_MAX_LINES + 1 })
  const count = originals.length
  if (count === 0 || count > STOCK_SESSION_MAX_LINES || new Set(originals.map(row => row.id)).size !== count) throw unavailable()
  if ((generation + 1) * count > 1000) {
    throw new StockMovementReplayError('This stock action has too many replay movements to preview here. Use History Undo/Redo.', 409, 'undo_preview_limit')
  }
  const reference = String(movement.reference_id)
  for (const row of originals) {
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || !['add', 'stock_in'].includes(row.movement_type)
      || String(row.reference_id) !== reference || row.product_id !== row.member_product || row.branch_id !== row.member_branch
      || row.batch_id !== row.member_batch || row.quantity !== row.member_quantity) throw unavailable()
  }
  const after = Math.max(...originals.map(row => row.id))
  const expectedRows = generation * count
  const rows: Movement[] = []
  for (const type of ['add', 'remove']) {
    rows.push(...await db.prepare(`SELECT id,product_id,branch_id,batch_id,movement_type,quantity,reference_id FROM inventory_movements
      WHERE reference_id=@reference AND movement_type=@type AND id>@after ORDER BY id LIMIT @limit`)
      .all<Movement>({ reference, type, after, limit: expectedRows + 1 }))
  }
  if (rows.length !== expectedRows) throw unavailable()
  rows.sort((left, right) => left.id - right.id)
  const key = (row: Pick<Movement, 'product_id' | 'branch_id' | 'batch_id' | 'quantity'>) => JSON.stringify([row.product_id, row.branch_id, row.batch_id, row.quantity])
  for (let block = 1; block <= generation; block += 1) {
    const undo = block % 2 === 1
    const expected = originals.map(row => key({ ...row, quantity: row.quantity * (undo ? -1 : 1) })).sort()
    const current = rows.slice((block - 1) * count, block * count)
    if (current.some(row => row.movement_type !== (undo ? 'remove' : 'add'))
      || JSON.stringify(current.map(key).sort()) !== JSON.stringify(expected)) throw unavailable()
  }
  if (!rows.slice(-count).some(row => row.id === movement.id)) throw stale()
  return generation
}

export async function stockMovementRevertPreview(db: D1Compat, movementId: number): Promise<{ revert: StockMovementRevertPreview; history: ActionHistoryRow | null }> {
  const movement = await db.prepare('SELECT id,product_id,branch_id,batch_id,movement_type,quantity,reference_id FROM inventory_movements WHERE id=@id').get<Movement>({ id: movementId })
  if (!movement) throw new StockMovementReplayError('Stock movement not found.', 404)
  const reference = String(movement.reference_id ?? '')
  const parent = /^revert:\d+$/.test(reference)
    ? await db.prepare('SELECT id,product_id,branch_id,batch_id,movement_type,quantity,reference_id FROM inventory_movements WHERE id=@id').get<Movement>({ id: Number(reference.slice(7)) })
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
      const operation = await db.prepare('SELECT id,history_id,generation FROM stock_session_operations WHERE rowid=@rowid').get<{ id: string; history_id: number; generation: number }>({ rowid: Number(reference) })
      if (operation) {
        expectedGeneration = await sessionMovementGeneration(db, movement, operation)
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
    throw stale()
  }
  return { revert: { kind, movementId, historyId, operationId, direction, expectedGeneration, label: String(history.label || ''), lineCount }, history }
}
