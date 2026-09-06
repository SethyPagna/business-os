import { apiFetch, route } from './http.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

type InventoryPayload = Record<string, unknown>

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
    () => apiFetch('POST', '/api/inventory/sessions', payload),
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
  return route(
    'inventory:transfer',
    () => apiFetch(
      'POST',
      '/api/inventory/transfer',
      ensureClientRequestId({ ...getDevicePayload(), ...(payload || {}) }, 'transfer'),
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
