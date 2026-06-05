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
