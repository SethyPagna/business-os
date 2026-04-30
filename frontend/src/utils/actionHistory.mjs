import { useCallback, useMemo, useState } from 'react'

function normalizeEntry(entry = {}, index = 0) {
  return {
    id: entry.id || `${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    label: String(entry.label || 'Recent action'),
    undo: entry.undo,
    redo: entry.redo,
  }
}

export function useActionHistory({ limit = 3, notify } = {}) {
  const [undoStack, setUndoStack] = useState([])
  const [redoStack, setRedoStack] = useState([])
  const [busy, setBusy] = useState('')

  const pushAction = useCallback((entry) => {
    const nextEntry = normalizeEntry(entry)
    setUndoStack((current) => [...current.slice(-(Math.max(1, limit) - 1)), nextEntry])
    setRedoStack([])
    return nextEntry
  }, [limit])

  const runEntry = useCallback(async (direction) => {
    const source = direction === 'undo' ? undoStack : redoStack
    const entry = source[source.length - 1]
    if (!entry || busy) return false
    const action = direction === 'undo' ? entry.undo : entry.redo
    if (typeof action !== 'function') return false
    setBusy(direction)
    try {
      await Promise.resolve(action())
      if (direction === 'undo') {
        setUndoStack((current) => current.slice(0, -1))
        setRedoStack((current) => [...current.slice(-(Math.max(1, limit) - 1)), entry])
      } else {
        setRedoStack((current) => current.slice(0, -1))
        setUndoStack((current) => [...current.slice(-(Math.max(1, limit) - 1)), entry])
      }
      return true
    } catch (error) {
      notify?.(error?.message || `Unable to ${direction} that action right now.`, 'error')
      return false
    } finally {
      setBusy('')
    }
  }, [busy, limit, notify, redoStack, undoStack])

  const undo = useCallback(() => runEntry('undo'), [runEntry])
  const redo = useCallback(() => runEntry('redo'), [runEntry])

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
