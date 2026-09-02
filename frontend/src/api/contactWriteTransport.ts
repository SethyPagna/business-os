import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { apiFetch, route } from './http.ts'
import type { RenameImpact } from './renameCascadeTransport.ts'

type ContactWritePayload = Record<string, unknown>
type ContactTableName = 'customers' | 'suppliers' | 'delivery_contacts'

function createContactClientRequestId(prefix = 'contact'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function ensureContactClientRequestId(
  payload: ContactWritePayload = {},
  prefix = 'contact',
): ContactWritePayload {
  const current = String(payload.client_request_id || '').trim()
  if (current) return { ...payload, client_request_id: current.slice(0, 120) }
  return { ...payload, client_request_id: createContactClientRequestId(prefix) }
}

function buildContactWritePayload(
  payload: ContactWritePayload = {},
  requestIdPrefix: string,
): ContactWritePayload {
  return ensureContactClientRequestId(
    {
      ...getClientDeviceInfo(),
      ...(payload || {}),
    },
    requestIdPrefix,
  )
}

function createContact(
  routeKey: string,
  endpoint: string,
  requestIdPrefix: string,
  payload: ContactWritePayload = {},
): Promise<unknown> {
  const body = buildContactWritePayload(payload, requestIdPrefix)
  return route(
    `${routeKey}:create`,
    () => apiFetch('POST', endpoint, body),
    null,
    true,
  )
}

async function updateContact(
  routeKey: string,
  endpoint: string,
  tableName: ContactTableName,
  id: number | string,
  payload: ContactWritePayload = {},
): Promise<unknown> {
  const { withExpectedUpdatedAt } = await import('./expectedUpdatedAt.ts')
  const body = await withExpectedUpdatedAt(tableName, id, payload)
  return route(
    `${routeKey}:update`,
    () => apiFetch('PUT', `${endpoint}/${encodeURIComponent(String(id))}`, body),
    null,
    true,
  )
}

async function deleteContact(
  routeKey: string,
  endpoint: string,
  tableName: ContactTableName,
  id: number | string,
): Promise<unknown> {
  const { withExpectedUpdatedAt } = await import('./expectedUpdatedAt.ts')
  const body = await withExpectedUpdatedAt(tableName, id, {})
  return route(
    `${routeKey}:delete`,
    () => apiFetch('DELETE', `${endpoint}/${encodeURIComponent(String(id))}`, body),
    null,
    true,
  )
}

export function createCustomer(payload: ContactWritePayload = {}): Promise<unknown> {
  return createContact('customers', '/api/customers', 'customer', payload)
}

export function updateCustomer(id: number | string, payload: ContactWritePayload = {}): Promise<unknown> {
  return updateContact('customers', '/api/customers', 'customers', id, payload)
}

export function getCustomerRenameImpact(id: number | string, to: string): Promise<RenameImpact> {
  const query = new URLSearchParams({ to })
  return apiFetch('GET', `/api/customers/${encodeURIComponent(String(id))}/rename-impact?${query.toString()}`)
}

export function deleteCustomer(id: number | string): Promise<unknown> {
  return deleteContact('customers', '/api/customers', 'customers', id)
}

export function awardCustomerPoints(id: number | string, payload: { points: number; note?: string }): Promise<unknown> {
  return route(
    'customers:awardPoints',
    () => apiFetch('POST', `/api/customers/${encodeURIComponent(String(id))}/points`, buildContactWritePayload(payload, 'loyalty_points')),
    null,
    true,
  )
}

export function createSupplier(payload: ContactWritePayload = {}): Promise<unknown> {
  return createContact('suppliers', '/api/suppliers', 'supplier', payload)
}

export function updateSupplier(id: number | string, payload: ContactWritePayload = {}): Promise<unknown> {
  return updateContact('suppliers', '/api/suppliers', 'suppliers', id, payload)
}

export function getSupplierRenameImpact(id: number | string, to: string): Promise<RenameImpact> {
  const query = new URLSearchParams({ to })
  return apiFetch('GET', `/api/suppliers/${encodeURIComponent(String(id))}/rename-impact?${query.toString()}`)
}

export function deleteSupplier(id: number | string): Promise<unknown> {
  return deleteContact('suppliers', '/api/suppliers', 'suppliers', id)
}

export function createDeliveryContact(payload: ContactWritePayload = {}): Promise<unknown> {
  return createContact('deliveryContacts', '/api/delivery-contacts', 'delivery_contact', payload)
}

export function updateDeliveryContact(id: number | string, payload: ContactWritePayload = {}): Promise<unknown> {
  return updateContact('deliveryContacts', '/api/delivery-contacts', 'delivery_contacts', id, payload)
}

export function deleteDeliveryContact(id: number | string): Promise<unknown> {
  return deleteContact('deliveryContacts', '/api/delivery-contacts', 'delivery_contacts', id)
}
