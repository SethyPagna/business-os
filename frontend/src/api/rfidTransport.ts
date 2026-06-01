import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

type RfidPayload = Record<string, unknown>

function getDevicePayload(): RfidPayload {
  return { ...getClientDeviceInfo() }
}

function encodeId(id: string | number): string {
  return encodeURIComponent(String(id))
}

export function getRfidStatus(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return route(
    `inventory:rfid:status:${query}`,
    () => apiFetch('GET', appendQuery('/api/inventory/rfid/status', query)),
    () => ({ item: { connected: false, readerCount: 0, tagCount: 0, exceptionCount: 0 } }),
  )
}

export function createRfidTag(payload: RfidPayload = {}): Promise<unknown> {
  return route(
    'inventory:rfid:tags:create',
    () => apiFetch('POST', '/api/inventory/rfid/tags', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export function searchRfidTags(params: QueryParams = {}): Promise<unknown> {
  const query = buildQueryString(params)
  return route(
    `inventory:rfid:tags:search:${query}`,
    () => apiFetch('GET', appendQuery('/api/inventory/rfid/tags/search', query)),
    () => ({ items: [] }),
  )
}

export function createRfidSession(payload: RfidPayload = {}): Promise<unknown> {
  return route(
    'inventory:rfid:sessions:create',
    () => apiFetch('POST', '/api/inventory/rfid/sessions', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export function recordRfidSessionEvents(id: string | number, payload: RfidPayload = {}): Promise<unknown> {
  return route(
    `inventory:rfid:sessions:${id}:events`,
    () => apiFetch('POST', `/api/inventory/rfid/sessions/${encodeId(id)}/events`, {
      ...getDevicePayload(),
      ...(payload || {}),
    }),
    null,
    true,
  )
}

export function getRfidSessionReview(id: string | number): Promise<unknown> {
  return route(
    `inventory:rfid:sessions:${id}:review`,
    () => apiFetch('GET', `/api/inventory/rfid/sessions/${encodeId(id)}/review`),
    null,
  )
}

export function applyRfidSession(id: string | number, payload: RfidPayload = {}): Promise<unknown> {
  return route(
    `inventory:rfid:sessions:${id}:apply`,
    () => apiFetch('POST', `/api/inventory/rfid/sessions/${encodeId(id)}/apply`, {
      ...getDevicePayload(),
      ...(payload || {}),
    }),
    null,
    true,
  )
}
