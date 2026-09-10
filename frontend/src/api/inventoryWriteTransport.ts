import { apiFetch, route } from './http.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { executeTransferRun, loadTransferRun, prepareTransferRun, saveTransferRun, type PendingTransferRun } from './branchTransport.ts'

type InventoryPayload = Record<string, unknown>

export type PendingInventoryTransfer = PendingTransferRun & {
  context: { kind: 'submit' | 'undo' | 'redo'; original: InventoryPayload; productName: string; entryId: string; serverId?: string | number | null }
}

// Separate actor-scoped storage prevents a Branch modal replaying an Inventory
// request against a different endpoint. Keep the entire frozen intent on reload.
function inventoryTransferStore(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.sessionStorage) {
  return {
    getItem: (key: string) => storage.getItem(`inventory:${key}`),
    setItem: (key: string, value: string) => storage.setItem(`inventory:${key}`, value),
    removeItem: (key: string) => storage.removeItem(`inventory:${key}`),
  }
}
export function loadInventoryTransfer(actorId: unknown, storage?: Storage): PendingInventoryTransfer | null {
  const run = loadTransferRun(actorId, inventoryTransferStore(storage)) as PendingInventoryTransfer | null
  if (run && (!run.context || !['submit', 'undo', 'redo'].includes(run.context.kind) || !run.context.entryId || !run.context.original || run.requests.length !== 1 || run.requests[0].bulk)) {
    throw new Error('The saved transfer cannot be read. Check transfer history before clearing browser storage.')
  }
  return run
}
export function saveInventoryTransfer(actorId: unknown, run: PendingInventoryTransfer | null, storage?: Storage): void {
  saveTransferRun(actorId, run, inventoryTransferStore(storage))
}
export function prepareInventoryTransfer(actorId: unknown, body: InventoryPayload, context: Omit<PendingInventoryTransfer['context'], 'entryId'> & { entryId?: string }): PendingInventoryTransfer {
  const run = prepareTransferRun(actorId, [{ bulk: false, body }])
  return { ...run, context: JSON.parse(JSON.stringify({ ...context, entryId: context.entryId || run.requests[0].body.client_request_id })) }
}
export function executeInventoryTransfer(run: PendingInventoryTransfer, checkpoint: (next: PendingInventoryTransfer) => void): Promise<PendingInventoryTransfer> {
  return executeTransferRun(run, (next) => checkpoint(next as PendingInventoryTransfer), (request) => transferInventoryStock(request.body)) as Promise<PendingInventoryTransfer>
}

export type InventoryStockSessionProduct = Record<string, unknown>

export type InventoryStockSessionLine = {
  line_id: string
  kind: 'receive' | 'create_receive'
  product_id?: number
  product?: InventoryStockSessionProduct
  batch_id?: number | null
  branch_id: number
  quantity: number
  supplier_id?: number | null
  supplier_name?: string | null
  received_date: string
  expiry_date?: string | null
  notes?: string | null
  unit_cost_usd?: number | null
  // A $0.00 receipt is only accepted as a DECLARED gift. The flag is what
  // distinguishes it from a cost nobody entered (lib/stockReceiptGate.ts).
  free_goods?: boolean
  payment_status?: 'paid' | 'credit' | null
  credit_due_date?: string | null
}

export type InventoryStockSessionRequest = {
  client_request_id: string
  mode: 'stock_in'
  items: InventoryStockSessionLine[]
}

export type InventoryStockSessionReceipt = {
  success: true
  replayed: boolean
  operationId: string
  clientRequestId: string
  actionHistoryId: number
  snapshotId: number
  memberCount: number
  createdCount: number
  receivedCount: number
  totalQuantity: number
  totalCostUsd: number
  items: Array<{
    lineId: string
    kind: 'receive' | 'create_receive'
    productId: number
    productName: string
    createdProduct: boolean
    branchId: number
    batchId: number | null
    batchNumber: number | null
    lotCode: string | null
    movementId: number | null
    quantity: number
    unitCostUsd: number | null
  }>
}

// Atomic stock-session commits can include many validated product and lot
// writes in one idempotent Worker transaction. Give only this replay-safe
// endpoint enough time to return its immutable receipt; legacy per-line
// stock mutations retain the shared short timeout because they do not carry
// this session-level replay contract.
export const INVENTORY_SESSION_TIMEOUT_MS = 60_000

function getDevicePayload(): InventoryPayload {
  return { ...getClientDeviceInfo() }
}

export function adjustStock(payload: InventoryPayload = {}): Promise<unknown> {
  return route(
    'products:adjustStock',
    () => apiFetch('POST', '/api/inventory/adjust', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

// Milestone A stock-session wire. The caller owns stable request/line ids:
// retries must send the byte-equivalent logical request so the Worker can
// return its immutable receipt instead of applying stock twice. Deliberately
// network-only -- there is no offline/outbox replay contract for this write.
export function createInventorySession(payload: InventoryStockSessionRequest): Promise<InventoryStockSessionReceipt> {
  return route(
    'inventory:session:create',
    () => apiFetch('POST', '/api/inventory/sessions', payload, INVENTORY_SESSION_TIMEOUT_MS),
    null,
    true,
  ) as Promise<InventoryStockSessionReceipt>
}

// Part 553: the Stock Change ledger's per-row write actions (Products page
// ledger row context menu). Both hit the inventory movement endpoints gated on
// Full Access to Inventory. Revert posts a compensating counter-movement;
// editReason updates just the movement's reason text.
export function revertStockMovement(id: number): Promise<unknown> {
  return route(
    'inventory:movement:revert',
    () => apiFetch('POST', `/api/inventory/movements/${id}/revert`, { ...getDevicePayload() }),
    null,
    true,
  )
}

export function editStockMovementReason(id: number, reason: string): Promise<unknown> {
  return route(
    'inventory:movement:reason',
    () => apiFetch('PATCH', `/api/inventory/movements/${id}/reason`, { ...getDevicePayload(), reason }),
    null,
    true,
  )
}

export function transferInventoryStock(payload: InventoryPayload = {}): Promise<unknown> {
  const body = payload.client_request_id ? JSON.parse(JSON.stringify(payload)) : ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'transfer')
  return route(
    'inventory:transfer',
    () => apiFetch(
      'POST',
      '/api/inventory/transfer',
      body,
    ),
    null,
    true,
  )
}

export function moveStockRow(payload: InventoryPayload = {}): Promise<unknown> {
  return route(
    'inventory:moveRow',
    () => apiFetch('POST', '/api/inventory/move-row', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export function saveInventoryReasons(items: unknown[] = []): Promise<unknown> {
  return route(
    'inventory:reasons:save',
    () => apiFetch('PUT', '/api/inventory/reasons', { ...getDevicePayload(), items }),
    null,
    true,
  )
}

export function replaceInventoryReason(payload: { type: string; from: string; to: string; scope: 'saved_only' | 'linked' }): Promise<unknown> {
  return route('inventory:reasons:replace', () => apiFetch('POST', '/api/inventory/reasons/replace', payload), null, true)
}

// Dated stock-reconciliation import -- the 4-call review flow (Part
// 288-292's backend, first wired to a real UI this session): /resolve
// analyzes raw uploaded rows (never writes a product), the review screen
// collects a decision for each row /resolve couldn't place automatically,
// /resolve/apply-decisions executes those decisions (creates/links
// products, applies price choices) and returns a complete resolved list,
// then that combined list goes through the SAME /preview + /apply pair
// the (already-built, already-tested) non-dated-count stock-count flow
// uses to turn resolved productId/branchId/date/count rows into real
// inventory movements. All four are writes (`isWrite: true`) -- /resolve
// can auto-create an unrecognized branch, and /preview reads live
// product/branch names for its plan even though it makes no DB writes
// itself, so it's kept consistent with /apply rather than raced against
// a local read fallback that doesn't exist for it.
export function resolveDatedStockCountRows(rows: unknown[] = []): Promise<unknown> {
  return route(
    'inventory:datedStockCount:resolve',
    () => apiFetch('POST', '/api/inventory/dated-stock-count/resolve', { ...getDevicePayload(), rows }),
    null,
    true,
  )
}

export function applyDatedStockCountDecisions(payload: InventoryPayload = {}): Promise<unknown> {
  return route(
    'inventory:datedStockCount:applyDecisions',
    () => apiFetch('POST', '/api/inventory/dated-stock-count/resolve/apply-decisions', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export function previewDatedStockCount(entries: unknown[] = []): Promise<unknown> {
  return route(
    'inventory:datedStockCount:preview',
    () => apiFetch('POST', '/api/inventory/dated-stock-count/preview', { ...getDevicePayload(), entries }),
    null,
    true,
  )
}

export function applyDatedStockCount(entries: unknown[] = []): Promise<unknown> {
  return route(
    'inventory:datedStockCount:apply',
    () => apiFetch('POST', '/api/inventory/dated-stock-count/apply', { ...getDevicePayload(), entries }),
    null,
    true,
  )
}
