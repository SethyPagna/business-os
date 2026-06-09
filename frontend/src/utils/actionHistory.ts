import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from './loaders'

type ActionDirection = 'undo' | 'redo'
type ActionHistoryId = string | number
type HistoryAction = () => unknown | Promise<unknown>
type NotifyFn = (message: string, type?: string) => void

type ActionHistoryUser = {
  id?: unknown
  name?: unknown
  username?: unknown
  role_code?: unknown
  permissions?: unknown
}

type ActionHistoryInput = {
  id?: unknown
  label?: unknown
  undo?: HistoryAction
  redo?: HistoryAction
  serverId?: unknown
  server_id?: unknown
  scope?: unknown
  entity?: unknown
  entity_id?: unknown
  entityId?: unknown
  undoLabel?: unknown
  redoLabel?: unknown
  undo_payload?: unknown
  redo_payload?: unknown
}

type ActionHistoryEntry = {
  id: string
  label: string
  undo?: HistoryAction
  redo?: HistoryAction
  serverId: ActionHistoryId | null
  scope: string
  entity: unknown | null
  entity_id: unknown | null
}

type ServerHistoryItem = {
  id?: string | number
  label?: string
  status?: string
  [key: string]: unknown
}

type UserOption = {
  id: string | number
  name?: string
  username?: string
}

type ActionHistoryTransportModule = typeof import('../api/actionHistoryTransport.ts')

type ActionHistoryOptions = {
  limit?: number
  notify?: NotifyFn
  scope?: string
  enabled?: boolean
  user?: ActionHistoryUser | null
}

declare global {
  interface Window {
    api?: Record<string, any>
  }
}

const ACTION_HISTORY_LOAD_TIMEOUT_MS = 10000
const ACTION_HISTORY_USERS_TIMEOUT_MS = 8000
let actionHistoryTransportPromise: Promise<ActionHistoryTransportModule> | null = null

function loadActionHistoryTransport(): Promise<ActionHistoryTransportModule> {
  if (!actionHistoryTransportPromise) actionHistoryTransportPromise = import('../api/actionHistoryTransport.ts')
  return actionHistoryTransportPromise
}

function normalizeActionHistoryId(value: unknown): ActionHistoryId | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = String(value || '').trim()
  return text || null
}

function normalizeEntry(entry: ActionHistoryInput = {}, index = 0): ActionHistoryEntry {
  return {
    id: String(entry.id || `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`),
    label: String(entry.label || 'Recent action'),
    undo: entry.undo,
    redo: entry.redo,
    serverId: normalizeActionHistoryId(entry.serverId || entry.server_id),
    scope: String(entry.scope || 'global'),
    entity: entry.entity || null,
    entity_id: entry.entity_id || entry.entityId || null,
  }
}

function parsePermissions(value: unknown): { all?: unknown } {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value || '{}')
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch {
      return {}
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : String(error || fallback)
}

export function useActionHistory({ limit = 10, notify, scope = 'global', enabled = true, user = null }: ActionHistoryOptions = {}) {
  const [undoStack, setUndoStack] = useState<ActionHistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<ActionHistoryEntry[]>([])
  const [serverItems, setServerItems] = useState<ServerHistoryItem[]>([])
  const [busy, setBusy] = useState<ActionDirection | ''>('')
  const [userFilter, setUserFilter] = useState('all')
  const [userOptions, setUserOptions] = useState<UserOption[]>([])
  const historyRequestRef = useRef(0)
  const usersRequestRef = useRef(0)
  const isAdmin = useMemo(() => {
    const roleCode = String(user?.role_code || '').toLowerCase()
    const username = String(user?.username || '').toLowerCase()
    const permissions = parsePermissions(user?.permissions)
    return username === 'admin' || roleCode === 'admin' || !!permissions.all
  }, [user])

  const refreshServerItems = useCallback((): Promise<void> => {
    const requestId = beginTrackedRequest(historyRequestRef)
    return withLoaderTimeout(
      async () => (await loadActionHistoryTransport()).getActionHistory(scope, Math.max(3, limit), {
        all: isAdmin ? 1 : undefined,
        userId: isAdmin && userFilter !== 'all' ? userFilter : undefined,
      }),
      'Action history',
      ACTION_HISTORY_LOAD_TIMEOUT_MS,
    )
      .then((result) => {
        if (!isTrackedRequestCurrent(historyRequestRef, requestId)) return
        const record = result as { items?: ServerHistoryItem[] } | null
        setServerItems(Array.isArray(record?.items) ? record.items : [])
      })
      .catch(() => {})
  }, [isAdmin, limit, scope, userFilter])

  useEffect(() => {
    if (!enabled) return
    refreshServerItems()
  }, [enabled, refreshServerItems])

  useEffect(() => {
    if (!enabled) return
    if (!isAdmin) return
    const requestId = beginTrackedRequest(usersRequestRef)
    withLoaderTimeout(
      async () => (await loadActionHistoryTransport()).getActionHistoryUsers(),
      'Action history users',
      ACTION_HISTORY_USERS_TIMEOUT_MS,
    )
      .then((rows) => {
        if (!isTrackedRequestCurrent(usersRequestRef, requestId)) return
        setUserOptions(Array.isArray(rows) ? rows : [])
      })
      .catch(() => {})
    return () => {
      invalidateTrackedRequest(usersRequestRef)
    }
  }, [enabled, isAdmin])

  useEffect(() => () => {
    invalidateTrackedRequest(historyRequestRef)
    invalidateTrackedRequest(usersRequestRef)
  }, [])

  const pushAction = useCallback((entry: ActionHistoryInput) => {
    const nextEntry = normalizeEntry(entry)
    const reversible = typeof nextEntry.undo === 'function' && typeof nextEntry.redo === 'function'
    if (reversible) {
      setUndoStack((current) => [...current.slice(-(Math.max(1, limit) - 1)), nextEntry])
      setRedoStack([])
    }
    loadActionHistoryTransport().then((api) => api.createActionHistory({
        scope: entry.scope || scope,
        entity: entry.entity || null,
        entity_id: entry.entity_id || entry.entityId || null,
        label: nextEntry.label,
        undo_label: entry.undoLabel || `Undo ${nextEntry.label}`,
        redo_label: entry.redoLabel || `Redo ${nextEntry.label}`,
        reversible,
        undo_payload: entry.undo_payload || {},
        redo_payload: entry.redo_payload || {},
      })).then((result) => {
        const record = result as { id?: ActionHistoryId } | null
        refreshServerItems()
        if (!record?.id) return
        setUndoStack((current) => current.map((item) => item.id === nextEntry.id ? { ...item, serverId: record.id || null } : item))
      }).catch(() => {})
    return nextEntry
  }, [limit, refreshServerItems, scope])

  const runEntry = useCallback(async (direction: ActionDirection, entryId: string | number | null = null): Promise<boolean> => {
    const source = direction === 'undo' ? undoStack : redoStack
    const entry = entryId ? source.find((item) => String(item.id) === String(entryId)) : source[source.length - 1]
    if (!entry || busy) return false
    const action = direction === 'undo' ? entry.undo : entry.redo
    if (typeof action !== 'function') return false
    setBusy(direction)
    let serverTransitioned = false
    try {
      if (entry.serverId) {
        const api = await loadActionHistoryTransport()
        if (direction === 'undo') await api.undoActionHistory(entry.serverId)
        else await api.redoActionHistory(entry.serverId)
        serverTransitioned = true
        refreshServerItems()
      }
      await Promise.resolve(action())
      if (direction === 'undo') {
        setUndoStack((current) => current.filter((item) => item.id !== entry.id))
        setRedoStack((current) => [...current.slice(-(Math.max(1, limit) - 1)), entry])
        if (entry.serverId && !serverTransitioned) loadActionHistoryTransport().then((api) => api.updateActionHistory(entry.serverId!, { status: 'redoable' })).then(refreshServerItems).catch(() => {})
      } else {
        setRedoStack((current) => current.filter((item) => item.id !== entry.id))
        setUndoStack((current) => [...current.slice(-(Math.max(1, limit) - 1)), entry])
        if (entry.serverId && !serverTransitioned) loadActionHistoryTransport().then((api) => api.updateActionHistory(entry.serverId!, { status: 'undoable' })).then(refreshServerItems).catch(() => {})
      }
      return true
    } catch (error) {
      if (entry.serverId) {
        const fallbackStatus = direction === 'undo' ? 'undoable' : 'redoable'
        const nextStatus = serverTransitioned ? fallbackStatus : 'failed'
        loadActionHistoryTransport().then((api) => api.updateActionHistory(entry.serverId!, {
          status: nextStatus,
          last_error: getErrorMessage(error, ''),
        })).then(refreshServerItems).catch(() => {})
      }
      notify?.(getErrorMessage(error, `Unable to ${direction} that action right now.`), 'error')
      return false
    } finally {
      setBusy('')
    }
  }, [busy, limit, notify, redoStack, refreshServerItems, undoStack])

  const undo = useCallback((entryId: string | number | null = null) => runEntry('undo', entryId), [runEntry])
  const redo = useCallback((entryId: string | number | null = null) => runEntry('redo', entryId), [runEntry])

  return useMemo(() => ({
    busy,
    canUndo: undoStack.length > 0 && !busy,
    canRedo: redoStack.length > 0 && !busy,
    lastUndoLabel: undoStack[undoStack.length - 1]?.label || '',
    lastRedoLabel: redoStack[redoStack.length - 1]?.label || '',
    undoItems: undoStack,
    redoItems: redoStack,
    serverItems,
    isAdmin,
    userFilter,
    setUserFilter,
    userOptions,
    refreshServerItems,
    pushAction,
    undo,
    redo,
  }), [busy, isAdmin, pushAction, redo, redoStack, refreshServerItems, serverItems, undo, undoStack, userFilter, userOptions])
}
