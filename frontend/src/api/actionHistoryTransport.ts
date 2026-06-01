import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

type ActionHistoryPayload = Record<string, unknown>

function getDevicePayload(): ActionHistoryPayload {
  return { ...getClientDeviceInfo() }
}

export function getActionHistory(
  scope: string | number = 'global',
  limit: string | number = 10,
  params: QueryParams = {},
): Promise<unknown> {
  const query = buildQueryString({ scope, limit, ...(params || {}) })
  return route(
    `actionHistory:get:${query}`,
    () => apiFetch('GET', appendQuery('/api/action-history', query)),
    () => ({ items: [] }),
  )
}

export function createActionHistory(payload: ActionHistoryPayload = {}): Promise<unknown> {
  return route(
    'actionHistory:create',
    () => apiFetch('POST', '/api/action-history', { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export function updateActionHistory(id: string | number, payload: ActionHistoryPayload = {}): Promise<unknown> {
  return route(
    'actionHistory:update',
    () => apiFetch('PATCH', `/api/action-history/${id}`, { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  )
}

export function undoActionHistory(id: string | number): Promise<unknown> {
  return route(
    `actionHistory:undo:${id}`,
    () => apiFetch('POST', `/api/action-history/${id}/undo`, getDevicePayload()),
    null,
    true,
  )
}

export function redoActionHistory(id: string | number): Promise<unknown> {
  return route(
    `actionHistory:redo:${id}`,
    () => apiFetch('POST', `/api/action-history/${id}/redo`, getDevicePayload()),
    null,
    true,
  )
}
