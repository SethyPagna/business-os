import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { apiFetch, route } from './http.ts'
import type { RenameImpact } from './renameCascadeTransport.ts'
import type {
  GenderRestorationChunk,
  GenderRestorationReceipt,
  GenderRestorationStatus,
} from '../components/contacts/customerGenderRestorationFlow.ts'

type ContactWritePayload = Record<string, unknown>

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

// The optimistic-concurrency token is the version the SCREEN holds: the
// form's record (its `updated_at`) or, for a delete, the row the tab listed.
// The transport adds nothing. Until 22 Sep 2026 a helper filled a MISSING
// token from a Dexie mirror row the live app stopped rewriting on 12 Sep
// (localMirrors.ts shouldPersistLocalMirror): stale where a row existed,
// absent otherwise, and never the version the operator was looking at. A
// write with no version is checked by nothing server-side rather than
// refused on a stale one.
function updateContact(
  routeKey: string,
  endpoint: string,
  id: number | string,
  payload: ContactWritePayload = {},
): Promise<unknown> {
  return route(
    `${routeKey}:update`,
    () => apiFetch('PUT', `${endpoint}/${encodeURIComponent(String(id))}`, payload),
    null,
    true,
  )
}

function deleteContact(
  routeKey: string,
  endpoint: string,
  id: number | string,
  expectedUpdatedAt?: string | null,
): Promise<unknown> {
  const body = expectedUpdatedAt ? { expectedUpdatedAt } : {}
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
  return updateContact('customers', '/api/customers', id, payload)
}

export function getCustomerRenameImpact(id: number | string, to: string): Promise<RenameImpact> {
  const query = new URLSearchParams({ to })
  return apiFetch('GET', `/api/customers/${encodeURIComponent(String(id))}/rename-impact?${query.toString()}`)
}

export function deleteCustomer(id: number | string, expectedUpdatedAt?: string | null): Promise<unknown> {
  return deleteContact('customers', '/api/customers', id, expectedUpdatedAt)
}

export function previewCustomerGenderRestoration(chunk: GenderRestorationChunk): Promise<GenderRestorationReceipt> {
  return apiFetch('POST', '/api/customers/gender-restoration/preview', chunk)
}

export function applyCustomerGenderRestoration(chunk: GenderRestorationChunk): Promise<GenderRestorationReceipt> {
  return apiFetch('POST', '/api/customers/gender-restoration/apply', chunk)
}

export function getCustomerGenderRestorationStatus(campaignId: string): Promise<GenderRestorationStatus> {
  const query = new URLSearchParams({ campaign_id: campaignId })
  return apiFetch('GET', `/api/customers/gender-restoration/status?${query.toString()}`)
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
  return updateContact('suppliers', '/api/suppliers', id, payload)
}

export function getSupplierRenameImpact(id: number | string, to: string): Promise<RenameImpact> {
  const query = new URLSearchParams({ to })
  return apiFetch('GET', `/api/suppliers/${encodeURIComponent(String(id))}/rename-impact?${query.toString()}`)
}

export function deleteSupplier(id: number | string, expectedUpdatedAt?: string | null): Promise<unknown> {
  return deleteContact('suppliers', '/api/suppliers', id, expectedUpdatedAt)
}

export function createDeliveryContact(payload: ContactWritePayload = {}): Promise<unknown> {
  return createContact('deliveryContacts', '/api/delivery-contacts', 'delivery_contact', payload)
}

export function updateDeliveryContact(id: number | string, payload: ContactWritePayload = {}): Promise<unknown> {
  return updateContact('deliveryContacts', '/api/delivery-contacts', id, payload)
}

export function getDeliveryContactRenameImpact(id: number | string, to: string): Promise<RenameImpact> {
  const query = new URLSearchParams({ to })
  return apiFetch('GET', `/api/delivery-contacts/${encodeURIComponent(String(id))}/rename-impact?${query.toString()}`)
}

export function deleteDeliveryContact(id: number | string, expectedUpdatedAt?: string | null): Promise<unknown> {
  return deleteContact('deliveryContacts', '/api/delivery-contacts', id, expectedUpdatedAt)
}
