import { getClientDeviceInfo } from '../utils/deviceInfo.ts'
import { apiFetch, route } from './http.ts'

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

export function createCustomer(payload: ContactWritePayload = {}): Promise<unknown> {
  return createContact('customers', '/api/customers', 'customer', payload)
}

export function createDeliveryContact(payload: ContactWritePayload = {}): Promise<unknown> {
  return createContact('deliveryContacts', '/api/delivery-contacts', 'delivery_contact', payload)
}
