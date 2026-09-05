import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  beginTrackedRequest,
  invalidateTrackedRequest,
  isTrackedRequestCurrent,
  withLoaderTimeout,
} from './loaders'
import { resolveReplayAction } from './actionReplay'

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
  // Optional refresh-only callback (K1). When the server replays the reversal
  // itself (undo_payload/redo_payload names a registered applier and the
  // /undo|/redo response is applied:true), the closure must NOT also mutate --
  // that would be a redundant, and under optimistic-concurrency a conflicting,
  // second write. If `refresh` is provided it is called INSTEAD of the closure
  // to re-pull the page's data; without it, the closure runs as before.
  refresh?: HistoryAction
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
  refresh?: HistoryAction
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
const ACTION_HISTORY_INITIAL_READ_DELAY_MS = 2500
const ACTION_HISTORY_IDLE_TIMEOUT_MS = 5000
let actionHistoryTransportPromise: Promise<ActionHistoryTransportModule> | null = null

function loadActionHistoryTransport(): Promise<ActionHistoryTransportModule> {
  if (!actionHistoryTransportPromise) actionHistoryTransportPromise = import('../api/actionHistoryTransport.ts')
  return actionHistoryTransportPromise
}

function scheduleActionHistoryRead(task: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  let idleId: number | null = null
  const timerId = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(task, { timeout: ACTION_HISTORY_IDLE_TIMEOUT_MS })
      return
    }
    task()
  }, ACTION_HISTORY_INITIAL_READ_DELAY_MS)
  return () => {
    window.clearTimeout(timerId)
    if (idleId != null && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(idleId)
    }
  }
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
    refresh: entry.refresh,
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

// Root cause of "history clears on page refresh": the *undoable* stack
// (undoStack/redoStack) holds live JS closures captured from the page's
// in-memory state -- those can never survive a reload no matter what's
// cached, since there's no generic way to serialize "how to undo this"
// for arbitrary actions. That part is an inherent limit of this pattern,
// not a bug (formatServerStatus already labels those "No longer
// reversible" after a reload, correctly).
//
// What *is* fixable, and was the actual visible symptom: `serverItems`
// (the read-only recorded-actions list) only exists in React state, which
// starts empty on every mount, and `refreshServerItems` doesn't resolve
// until after ACTION_HISTORY_INITIAL_READ_DELAY_MS plus a network
// round-trip -- so every refresh showed "No recent actions" for a couple
// of seconds even though the server has the real list the whole time.
// Caching the last-seen list per scope in sessionStorage and hydrating
// synchronously on mount closes that gap; the background fetch still runs
// exactly as before and overwrites the cache with the authoritative data.
const ACTION_HISTORY_CACHE_PREFIX = 'actionHistory:cache:'

function cacheKeyFor(scope: string): string {
  return `${ACTION_HISTORY_CACHE_PREFIX}${scope}`
}

function readCachedServerItems(scope: string): ServerHistoryItem[] {
  if (typeof window === 'undefined' || !window.sessionStorage) return []
  try {
    const raw = window.sessionStorage.getItem(cacheKeyFor(scope))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeCachedServerItems(scope: string, items: ServerHistoryItem[]): void {
  if (typeof window === 'undefined' || !window.sessionStorage) return
  try {
    window.sessionStorage.setItem(cacheKeyFor(scope), JSON.stringify(items.slice(0, 20)))
  } catch {
    // Storage full/unavailable (private browsing, etc.) -- the bar still
    // works, it just goes back to a brief loading gap on refresh.
  }
}

export function useActionHistory({ limit = 10, notify, scope = 'global', enabled = true, user = null }: ActionHistoryOptions = {}) {
  const [undoStack, setUndoStack] = useState<ActionHistoryEntry[]>([])
  const [redoStack, setRedoStack] = useState<ActionHistoryEntry[]>([])
  const [serverItems, setServerItems] = useState<ServerHistoryItem[]>(() => readCachedServerItems(scope))
  const cachedScopeRef = useRef(scope)
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
        const items = Array.isArray(record?.items) ? record.items : []
        setServerItems(items)
        // Only cache the unfiltered, default view -- an admin's per-user
        // filter result isn't what the next mount (or a different user)
        // should see flashed in before the real fetch resolves.
        if (!isAdmin || userFilter === 'all') writeCachedServerItems(scope, items)
      })
      .catch(() => {})
  }, [isAdmin, limit, scope, userFilter])

  // Re-hydrate from the new scope's cache immediately when `scope` changes
  // -- the useState initializer above only runs on first mount, so without
  // this a scope change would otherwise show a stale previous-scope list
  // (or an empty one) until the network fetch below catches up.
  useEffect(() => {
    if (cachedScopeRef.current === scope) return
    cachedScopeRef.current = scope
    setServerItems(readCachedServerItems(scope))
  }, [scope])

  useEffect(() => {
    if (!enabled) return
    return scheduleActionHistoryRead(() => {
      refreshServerItems()
    })
  }, [enabled, refreshServerItems])

  useEffect(() => {
    if (!enabled) return
    if (!isAdmin) return
    const cancelScheduledRead = scheduleActionHistoryRead(() => {
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
    })
    return () => {
      cancelScheduledRead()
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
    let serverApplied = false
    try {
      if (entry.serverId) {
        const api = await loadActionHistoryTransport()
        const response = direction === 'undo'
          ? await api.undoActionHistory(entry.serverId)
          : await api.redoActionHistory(entry.serverId)
        serverTransitioned = true
        // applied:true means the Worker replayed the reversal itself (K1) --
        // the closure must not mutate again; a refresh-only callback (if the
        // consumer supplied one) re-pulls the page instead.
        serverApplied = !!(response && typeof response === 'object' && (response as { applied?: unknown }).applied)
        refreshServerItems()
      }
      const replay = resolveReplayAction({ serverApplied, refresh: entry.refresh, action })
      await Promise.resolve(replay ? replay() : undefined)
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

  // K1 slice 2: reverse a SERVER row that has no live closure here -- an
  // action recorded before this page loaded (or by another tab/user, for an
  // admin). Only offered by the UI for rows the server marked
  // server_replayable; require_applied makes that authoritative -- if no
  // registered applier can replay the payload, the server refuses without
  // flipping the status, so a reversal is never recorded that didn't happen.
  // Page data catches up through the applier's own broadcast, so no refresh
  // closure is needed (there is none to have -- that's the point).
  const runServerEntry = useCallback(async (direction: ActionDirection, serverId: ActionHistoryId, label = ''): Promise<boolean> => {
    if (!serverId || busy) return false
    setBusy(direction)
    try {
      const api = await loadActionHistoryTransport()
      if (navigator.onLine === false) throw new Error('Connect to the server to replay history.')
      const item = serverItems.find(item => String(item.id) === String(serverId))
      const payload = item?.[direction === 'undo' ? 'undo_payload' : 'redo_payload'] as Record<string, unknown> | undefined
      const applier = String(payload?.applier || '')
      const replayRequest = { require_applied: true, ...(applier.endsWith('.bulk') && payload?.generation != null ? { expected_generation: payload.generation } : {}) }
      const response = direction === 'undo'
        ? await api.undoActionHistory(serverId, replayRequest)
        : await api.redoActionHistory(serverId, replayRequest)
      const applied = !!(response && typeof response === 'object' && (response as { applied?: unknown }).applied)
      refreshServerItems()
      if (!applied) {
        notify?.(`Unable to ${direction} that action right now.`, 'error')
        return false
      }
      if (label) notify?.(label)
      return true
    } catch (error) {
      refreshServerItems()
      notify?.(getErrorMessage(error, `Unable to ${direction} that action right now.`), 'error')
      return false
    } finally {
      setBusy('')
    }
  }, [busy, notify, refreshServerItems, serverItems])

  const undoServer = useCallback((serverId: ActionHistoryId, label = '') => runServerEntry('undo', serverId, label), [runServerEntry])
  const redoServer = useCallback((serverId: ActionHistoryId, label = '') => runServerEntry('redo', serverId, label), [runServerEntry])

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
    undoServer,
    redoServer,
  }), [busy, isAdmin, pushAction, redo, redoServer, redoStack, refreshServerItems, serverItems, undo, undoServer, undoStack, userFilter, userOptions])
}
