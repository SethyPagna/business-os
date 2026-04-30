import { useCallback, useMemo, useState } from 'react'

function normalizeEntry(entry = {}, index = 0) {
  return {
    id: entry.id || `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    label: String(entry.label || 'Recent action'),
    undo: entry.undo,
    redo: entry.redo,
    serverId: entry.serverId || entry.server_id || null,
    scope: entry.scope || 'global',
    entity: entry.entity || null,
    entity_id: entry.entity_id || entry.entityId || null,
  }
}

export function useActionHistory({ limit = 3, notify, scope = 'global' } = {}) {
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [busy, setBusy] = useState('')

  const pushAction = useCallback((entry) => {
    const nextEntry = normalizeEntry(entry)
    setUndoStack((current) => [...current.slice(-(Math.max(1, limit) - 1)), nextEntry])
    setRedoStack([])
    if (typeof window !== 'undefined' && window.api?.createActionHistory) {
      window.api.createActionHistory({
        scope: entry.scope || scope,
        entity: entry.entity || null,
        entity_id: entry.entity_id || entry.entityId || null,
        label: nextEntry.label,
        undo_label: entry.undoLabel || `Undo ${nextEntry.label}`,
        redo_label: entry.redoLabel || `Redo ${nextEntry.label}`,
        reversible: typeof nextEntry.undo === 'function' && typeof nextEntry.redo === 'function',
        undo_payload: entry.undo_payload || {},
        redo_payload: entry.redo_payload || {},
      }).then((result) => {
        const serverId = result?.id
        if (!serverId) return
        setUndoStack((current) => current.map((item) => item.id === nextEntry.id ? { ...item, serverId } : item))
      }).catch(() => {})
    }
    return nextEntry
  }, [limit, scope])

  const runEntry = useCallback(async (direction, entryId = null) => {
    const source = direction === 'undo' ? undoStack : redoStack
    const entry = entryId ? source.find((item) => item.id === entryId) : source[source.length - 1]
    if (!entry || busy) return false
    const action = direction === 'undo' ? entry.undo : entry.redo
    if (typeof action !== 'function') return false
    setBusy(direction)
    try {
      await Promise.resolve(action())
      if (direction === 'undo') {
        setUndoStack((current) => current.filter((item) => item.id !== entry.id))
        setRedoStack((current) => [...current.slice(-(Math.max(1, limit) - 1)), entry])
        if (entry.serverId && typeof window !== 'undefined' && window.api?.updateActionHistory) window.api.updateActionHistory(entry.serverId, { status: 'redoable' }).catch(() => {})
      } else {
        setRedoStack((current) => current.filter((item) => item.id !== entry.id))
        setUndoStack((current) => [...current.slice(-(Math.max(1, limit) - 1)), entry])
        if (entry.serverId && typeof window !== 'undefined' && window.api?.updateActionHistory) window.api.updateActionHistory(entry.serverId, { status: 'undoable' }).catch(() => {})
      }
      return true
    } catch (error) {
      if (entry.serverId && typeof window !== 'undefined' && window.api?.updateActionHistory) window.api.updateActionHistory(entry.serverId, { status: 'failed', last_error: error?.message || String(error || '') }).catch(() => {})
      notify?.(error?.message || `Unable to ${direction} that action right now.`, 'error')
      return false
    } finally {
      setBusy('')
    }
  }, [busy, limit, notify, redoStack, undoStack])

  const undo = useCallback((entryId = null) => runEntry('undo', entryId), [runEntry])
  const redo = useCallback((entryId = null) => runEntry('redo', entryId), [runEntry])

  return useMemo(() => ({
    busy,
    canUndo: undoStack.length > 0 && !busy,
    canRedo: redoStack.length > 0 && !busy,
    lastUndoLabel: undoStack[undoStack.length - 1]?.label || '',
    lastRedoLabel: redoStack[redoStack.length - 1]?.label || '',
    undoItems: undoStack,
    redoItems: redoStack,
    pushAction,
    undo,
    redo,
  }), [busy, pushAction, redo, redoStack, undo, undoStack])
}
