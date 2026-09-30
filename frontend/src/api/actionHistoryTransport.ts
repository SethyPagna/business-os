import { apiFetch, route } from './http.ts'
import { appendQuery, buildQueryString, type QueryParams } from './query.ts'
import { getClientDeviceInfo } from '../utils/deviceInfo.ts'

type ActionHistoryPayload = Record<string, unknown>

export type StockMovementRevertPreview = {
  kind: 'movement' | 'stock_set' | 'stock_session'
  movementId: number
  historyId?: number
  operationId?: string | number
  direction?: 'undo' | 'redo'
  expectedGeneration?: number
  label?: string
  lineCount: number
}

// Confirmation must use a fresh server decision, never a cached generation.
export function getStockMovementRevertPreview(id: number): Promise<{ success: true; revert: StockMovementRevertPreview }> {
  return apiFetch('GET', `/api/action-history/movements/${id}/revert-preview`)
    .catch((error: unknown) => localizeReplayRefusal(error, 'undo'))
}

export function getActionHistoryDetails(id: string | number, offset = 0): Promise<unknown> {
  return route(`actionHistory:details:${id}:${offset}`, () => apiFetch('GET', `/api/action-history/${encodeURIComponent(String(id))}/details?offset=${offset}&limit=10`), null)
}

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

export function getActionHistoryUsers(): Promise<unknown> {
  return route(
    'actionHistory:users',
    () => apiFetch('GET', '/api/users'),
    () => [],
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

// A replay the Worker refused answers 409 with a code from
// cloudflare/src/lib/undoAppliers.ts (UNDO_*_CODE; UNDO_REFUSED_CODE for a
// refusal with no stable code of its own). It is restated in the UI language AppContext
// applies to <html lang>, from the same language pack the screens use, the way
// fileTransport.ts restates an avatar type refusal; callers
// (utils/actionHistory.ts runEntry and runServerEntry) show error.message as
// is. Every other failure keeps its own message, and the English stays when
// the pack cannot be loaded. tests/undoConflictMessages.test.ts pins these
// codes to the Worker's.
const REPLAY_REFUSAL_KEYS: Readonly<Record<string, { undo: string; redo: string }>> = {
  undo_record_changed: { undo: 'undo_refused_record_changed', redo: 'redo_refused_record_changed' },
  undo_no_default_branch: { undo: 'undo_refused_no_default_branch', redo: 'redo_refused_no_default_branch' },
  undo_history_stale: { undo: 'undo_refused_history_stale', redo: 'redo_refused_history_stale' },
  undo_already_done: { undo: 'undo_refused_already_done', redo: 'redo_refused_already_done' },
  undo_history_unusable: { undo: 'undo_refused_history_unusable', redo: 'redo_refused_history_unusable' },
  undo_needs_original_tab: { undo: 'undo_refused_needs_original_tab', redo: 'redo_refused_needs_original_tab' },
  undo_refused: { undo: 'undo_refused_generic', redo: 'redo_refused_generic' },
}

async function localizeReplayRefusal(error: unknown, direction: 'undo' | 'redo'): Promise<never> {
  const refusal = error instanceof Error ? error as Error & { status?: unknown; code?: unknown } : null
  const keys = refusal && refusal.status === 409 && typeof refusal.code === 'string' && Object.prototype.hasOwnProperty.call(REPLAY_REFUSAL_KEYS, refusal.code)
    ? REPLAY_REFUSAL_KEYS[refusal.code]
    : null
  if (refusal && keys) {
    try {
      const language = typeof document !== 'undefined' ? String(document.documentElement?.getAttribute('lang') || '').trim().toLowerCase() : ''
      const pack = (language.startsWith('km') ? (await import('../lang/km.json')).default : (await import('../lang/en.json')).default) as Record<string, unknown>
      const value = pack[keys[direction]]
      if (typeof value === 'string' && value.trim()) refusal.message = value
    } catch {
      // Keep the server's English.
    }
  }
  throw error
}

export function undoActionHistory(id: string | number, payload: ActionHistoryPayload = {}): Promise<unknown> {
  return route(
    `actionHistory:undo:${id}`,
    () => apiFetch('POST', `/api/action-history/${id}/undo`, { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  ).catch((error: unknown) => localizeReplayRefusal(error, 'undo'))
}

export function redoActionHistory(id: string | number, payload: ActionHistoryPayload = {}): Promise<unknown> {
  return route(
    `actionHistory:redo:${id}`,
    () => apiFetch('POST', `/api/action-history/${id}/redo`, { ...getDevicePayload(), ...(payload || {}) }),
    null,
    true,
  ).catch((error: unknown) => localizeReplayRefusal(error, 'redo'))
}
