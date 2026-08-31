import { apiFetch, route } from './http.ts'
import { ensureClientRequestId } from './requestIds.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

type InventoryPayload = Record<string, unknown>

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
