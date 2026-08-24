import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import {
  createNote as createNoteRequest,
  deleteNote as deleteNoteRequest,
  getNotes as getNotesRequest,
  reorderNotes as reorderNotesRequest,
  updateNote as updateNoteRequest,
  type NoteRecord,
} from '../../api/notesTransport.ts'

// Personal, per-user autosaved notes -- shared controller. Originally lived
// entirely inside NotesPage.tsx; pulled out so NotesWidget.tsx's floating
// quick-panel (see its own comment) can drive the exact same load/autosave/
// conflict-handling/pin/delete logic against api/notesTransport.ts instead
// of a second, drifting copy. Deliberately has no opinion on layout/mobile
// panes -- that stays local to each caller.

type TranslateFn = (key: string) => string
type AppContextValue = {
  notify: (message: string, tone?: 'info' | 'success' | 'warning' | 'error') => void
  t: TranslateFn
}

const useApp = useAppHook as unknown as () => AppContextValue

type NotesApiError = Error & {
  conflict?: boolean
  current?: Record<string, unknown> | null
}

const AUTOSAVE_DELAY_MS = 900

export function noteDisplayTitle(note: NoteRecord, t: TranslateFn): string {
  const title = (note.title || '').trim()
  if (title) return title
  const firstLine = (note.content || '').split(/\r?\n/).find((line) => line.trim())
  if (firstLine) return firstLine.trim()
  return t('notes_untitled') || 'Untitled note'
}

export function useNotesController() {
  const { notify, t } = useApp()
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [notes, setNotes] = useState<NoteRecord[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftContent, setDraftContent] = useState('')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [busy, setBusy] = useState(false)

  const saveTimerRef = useRef<number | null>(null)
  const activeNoteRef = useRef<NoteRecord | null>(null)

  const activeNote = useMemo(() => notes.find((n) => n.id === activeId) || null, [notes, activeId])
  useEffect(() => { activeNoteRef.current = activeNote }, [activeNote])

  // Lazy load -- NotesWidget only needs this the first time its panel is
  // actually opened, not on every authenticated page load just because the
  // edge tab is mounted.
  const ensureLoaded = useCallback(() => {
    if (loaded) return
    setLoaded(true)
    setLoading(true)
    getNotesRequest()
      .then((result) => {
        setNotes(Array.isArray(result?.notes) ? result.notes : [])
      })
      .catch(() => {
        notify(t('notes_load_failed') || 'Could not load notes right now.', 'error')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [loaded, notify, t])

  useEffect(() => () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
  }, [])

  const flushSave = useCallback((id: number, title: string, content: string) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    setSaveState('saving')
    const current = activeNoteRef.current
    updateNoteRequest(id, { title, content, expectedUpdatedAt: current?.id === id ? current.updated_at : undefined })
      .then((result) => {
        const note = result?.note
        if (!note) return
        setNotes((prev) => prev.map((n) => (n.id === id ? note : n)))
        setSaveState('saved')
      })
      .catch((err: NotesApiError) => {
        if (err?.conflict && err.current) {
          const serverNote = err.current as unknown as NoteRecord
          setNotes((prev) => prev.map((n) => (n.id === id ? serverNote : n)))
          setDraftTitle((prevTitle) => (activeNoteRef.current?.id === id ? (serverNote.title || '') : prevTitle))
          setDraftContent((prevContent) => (activeNoteRef.current?.id === id ? (serverNote.content || '') : prevContent))
          notify(t('notes_conflict') || 'This note was updated elsewhere -- showing the latest version.', 'warning')
        } else {
          notify(t('notes_save_failed') || 'Could not save this note.', 'error')
        }
        setSaveState('idle')
      })
  }, [notify, t])

  const scheduleSave = useCallback((id: number, title: string, content: string) => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => flushSave(id, title, content), AUTOSAVE_DELAY_MS)
  }, [flushSave])

  // Flush any pending autosave immediately (e.g. the widget panel is about
  // to close/collapse) instead of letting it fire after the fields it read
  // from are already gone from view.
  const flushPendingSave = useCallback(() => {
    if (activeId != null && saveTimerRef.current) flushSave(activeId, draftTitle, draftContent)
  }, [activeId, draftTitle, draftContent, flushSave])

  const openNote = useCallback((note: NoteRecord) => {
    if (activeId != null && activeId !== note.id && saveTimerRef.current) flushSave(activeId, draftTitle, draftContent)
    setActiveId(note.id)
    setDraftTitle(note.title || '')
    setDraftContent(note.content || '')
    setSaveState('idle')
  }, [activeId, draftTitle, draftContent, flushSave])

  const closeEditor = useCallback(() => {
    flushPendingSave()
    setActiveId(null)
  }, [flushPendingSave])

  const handleNewNote = useCallback(async () => {
    setBusy(true)
    try {
      const result = await createNoteRequest({ title: '', content: '' })
      const note = result?.note
      if (!note) throw new Error('no note returned')
      setNotes((prev) => [note, ...prev])
      setActiveId(note.id)
      setDraftTitle('')
      setDraftContent('')
      setSaveState('idle')
      return note
    } catch (err) {
      notify(t('notes_create_failed') || 'Could not create a new note.', 'error')
      return null
    } finally {
      setBusy(false)
    }
  }, [notify, t])

  const handleTitleChange = useCallback((value: string) => {
    setDraftTitle(value)
    if (activeId != null) scheduleSave(activeId, value, draftContent)
  }, [activeId, draftContent, scheduleSave])

  const handleContentChange = useCallback((value: string) => {
    setDraftContent(value)
    if (activeId != null) scheduleSave(activeId, draftTitle, value)
  }, [activeId, draftTitle, scheduleSave])

  const handleTogglePin = useCallback(async (note: NoteRecord) => {
    try {
      const result = await updateNoteRequest(note.id, { pinned: !note.pinned, expectedUpdatedAt: note.updated_at })
      const updated = result?.note
      if (updated) setNotes((prev) => prev.map((n) => (n.id === note.id ? updated : n)))
    } catch (err) {
      notify(t('notes_save_failed') || 'Could not save this note.', 'error')
    }
  }, [notify, t])

  const handleDelete = useCallback(async (note: NoteRecord) => {
    setBusy(true)
    try {
      await deleteNoteRequest(note.id)
      setNotes((prev) => prev.filter((n) => n.id !== note.id))
      if (activeId === note.id) setActiveId(null)
    } catch (err) {
      notify(t('notes_delete_failed') || 'Could not delete this note.', 'error')
    } finally {
      setBusy(false)
    }
  }, [activeId, notify, t])

  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      // sort_order only diverges from 0 once a note has actually been
      // dragged (see reorderNotes below / routes/notes.ts's PATCH
      // /reorder) -- ties still fall back to most-recently-updated first,
      // so notes nobody has ever manually reordered keep exactly the
      // newest-first behavior this list always had.
      const orderA = Number(a.sort_order) || 0
      const orderB = Number(b.sort_order) || 0
      if (orderA !== orderB) return orderA - orderB
      return String(b.updated_at || '').localeCompare(String(a.updated_at || ''))
    }),
    [notes],
  )

  // Drag-to-reorder: dragId is the note being dragged, targetId is the note
  // it was dropped onto (goes right before it) -- same moveXBefore shape as
  // Settings.tsx's existing nav-item/mobile-pinned reordering, reused here
  // so this list behaves the same way any other draggable list in the app
  // already does. Optimistic: reorders local state (and assigns matching
  // sort_order values, mirroring what the backend will persist) immediately
  // so the drop feels instant, then persists via PATCH /reorder and
  // reconciles with the server's response; a failed request rolls the local
  // state back and surfaces an error instead of leaving the UI showing an
  // order that didn't actually save.
  const reorderNotes = useCallback((dragId: number, targetId: number) => {
    if (dragId === targetId) return
    const currentOrder = sortedNotes.map((n) => n.id)
    const dragIndex = currentOrder.indexOf(dragId)
    const targetIndex = currentOrder.indexOf(targetId)
    if (dragIndex < 0 || targetIndex < 0) return

    const nextOrder = [...currentOrder]
    nextOrder.splice(dragIndex, 1)
    nextOrder.splice(dragIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, dragId)

    const previousNotes = notes
    const orderRank = new Map(nextOrder.map((id, index) => [id, index]))
    setNotes((prev) => prev.map((note) => (
      orderRank.has(note.id) ? { ...note, sort_order: orderRank.get(note.id) as number } : note
    )))

    reorderNotesRequest(nextOrder)
      .then((result) => {
        if (Array.isArray(result?.notes)) setNotes(result.notes)
      })
      .catch(() => {
        setNotes(previousNotes)
        notify(t('notes_reorder_failed') || 'Could not save the new note order.', 'error')
      })
  }, [notes, notify, sortedNotes, t])

  return {
    t,
    loading,
    notes,
    sortedNotes,
    activeId,
    activeNote,
    draftTitle,
    draftContent,
    saveState,
    busy,
    ensureLoaded,
    openNote,
    closeEditor,
    flushPendingSave,
    handleNewNote,
    handleTitleChange,
    handleContentChange,
    handleTogglePin,
    handleDelete,
    reorderNotes,
  }
}
