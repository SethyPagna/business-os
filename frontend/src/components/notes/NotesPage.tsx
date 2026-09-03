import { useEffect, useRef, useState } from 'react'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Pin from 'lucide-react/dist/esm/icons/pin.js'
import PinOff from 'lucide-react/dist/esm/icons/pin-off.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import GripVertical from 'lucide-react/dist/esm/icons/grip-vertical.js'
import { noteDisplayTitle } from './useNotesController.ts'
import { useNotes } from './NotesContext.tsx'
import type { NoteRecord } from '../../api/notesTransport.ts'

// Personal, per-user autosaved notes -- full page version. Used to live
// only behind a small floating button with an inline popup panel
// (NotesWidget.tsx); that panel had no real place in the sidebar/nav and
// sat cramped in a corner. This is the same feature as an actual page
// (list + editor, side by side on wider screens), reachable from the
// sidebar like any other page.
//
// NotesWidget.tsx is a draggable floating quick-panel again (its own
// separate surface, not a shortcut into this page) -- both it and this
// page drive the exact same load/autosave/conflict-handling/pin/delete
// logic via the shared useNotesController hook instead of each keeping
// its own drifting copy.

export default function NotesPage() {
  const {
    t,
    loading,
    sortedNotes,
    activeId,
    activeNote,
    draftTitle,
    draftContent,
    saveState,
    busy,
    ensureLoaded,
    openNote,
    flushPendingSave,
    handleNewNote,
    handleTitleChange,
    handleContentChange,
    handleTogglePin,
    handleDelete,
    reorderNotes,
  } = useNotes()

  // Narrow-screen layout only shows one pane at a time; wide screens show
  // both side by side regardless of this state (see the sm:flex overrides
  // below).
  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list')

  // Drag-to-reorder, POINTER-based (not the old HTML5 `draggable`). Native
  // drag-and-drop has no touch support at all and the grip handle was
  // hidden until hover, so on a phone a note could never be grabbed or
  // reordered ("notes tab icon was not draggable"). Pointer events work on
  // touch and mouse alike: press the grip, move over another note (found
  // via elementFromPoint -> the nearest [data-note-id]), release to drop
  // the dragged note right before it. Refs drive the gesture (stable across
  // the re-renders each move triggers); the state mirrors are only for the
  // drag/drop visual highlight. reorderNotes (useNotesController.ts) still
  // does the actual reordering + persistence.
  const dragNoteIdRef = useRef<number | null>(null)
  const dropTargetIdRef = useRef<number | null>(null)
  const [dragNoteId, setDragNoteId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)

  const handleGripPointerDown = (noteId: number) => (event: import('react').PointerEvent<HTMLSpanElement>) => {
    dragNoteIdRef.current = noteId
    dropTargetIdRef.current = noteId
    setDragNoteId(noteId)
    setDropTargetId(noteId)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* capture is best-effort */ }
  }
  const handleGripPointerMove = (event: import('react').PointerEvent<HTMLSpanElement>) => {
    if (dragNoteIdRef.current == null) return
    const target = typeof document !== 'undefined' ? document.elementFromPoint(event.clientX, event.clientY) : null
    const li = target instanceof Element ? target.closest('[data-note-id]') : null
    const id = li ? Number(li.getAttribute('data-note-id')) : null
    if (id != null && Number.isFinite(id)) {
      dropTargetIdRef.current = id
      setDropTargetId(id)
    }
  }
  const endGripDrag = () => {
    const dragId = dragNoteIdRef.current
    const dropId = dropTargetIdRef.current
    if (dragId != null && dropId != null && dragId !== dropId) reorderNotes(dragId, dropId)
    dragNoteIdRef.current = null
    dropTargetIdRef.current = null
    setDragNoteId(null)
    setDropTargetId(null)
  }

  useEffect(() => { ensureLoaded() }, [ensureLoaded])

  const openNoteHere = (note: NoteRecord) => {
    openNote(note)
    setMobileView('editor')
  }

  const backToList = () => {
    flushPendingSave()
    setMobileView('list')
  }

  const newNoteHere = async () => {
    const note = await handleNewNote()
    if (note) setMobileView('editor')
  }

  const deleteHere = async (note: NoteRecord) => {
    await handleDelete(note)
    setMobileView('list')
  }

  return (
    <div className="page-scroll flex flex-col p-3 sm:p-6">
      <div className="flex min-h-[calc(var(--app-vh-100)_*_.7)] flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:min-h-[calc(var(--app-vh-100)_*_.75)]">
        {/* List pane */}
        <div
          className={`flex w-full flex-col border-slate-100 dark:border-slate-800 sm:flex sm:w-72 sm:flex-shrink-0 sm:border-r ${
            mobileView === 'list' ? 'flex' : 'hidden'
          }`}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5 dark:border-slate-800">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
              {t('notes_title') || 'My Notes'}
            </span>
            <button
              type="button"
              onClick={newNoteHere}
              disabled={busy}
              aria-label={t('notes_new') || 'New note'}
              title={t('notes_new') || 'New note'}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-950 dark:text-blue-300"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('notes_new') || 'New note'}
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('loading') || 'Loading…'}
              </div>
            ) : sortedNotes.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-slate-400">
                <Pencil className="h-6 w-6 text-slate-300" />
                <span>{t('notes_empty') || 'No notes yet.'}</span>
                <button
                  type="button"
                  onClick={newNoteHere}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-950 dark:text-blue-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {t('notes_new') || 'New note'}
                </button>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {sortedNotes.map((note) => (
                  <li
                    key={note.id}
                    data-note-id={note.id}
                    className={`group flex items-start gap-1 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                      note.id === activeId ? 'bg-blue-50/70 dark:bg-blue-950/40' : ''
                    } ${dragNoteId === note.id ? 'opacity-60' : ''} ${
                      dragNoteId != null && dropTargetId === note.id && dropTargetId !== dragNoteId ? 'border-t-2 border-blue-400' : ''
                    }`}
                  >
                    {/* Grip is the pointer-drag handle (touch + mouse). Kept
                        visible at rest (not opacity-0) so it can be grabbed
                        on a touch screen, where there is no hover. touch-none
                        stops the gesture from scrolling the list instead. */}
                    <span
                      className="mt-1 shrink-0 cursor-grab touch-none text-slate-400 opacity-60 group-hover:opacity-100 dark:text-slate-500"
                      title={t('dragToReorder') || 'Drag to reorder'}
                      onPointerDown={handleGripPointerDown(note.id)}
                      onPointerMove={handleGripPointerMove}
                      onPointerUp={endGripDrag}
                      onPointerCancel={endGripDrag}
                    >
                      <GripVertical className="h-3.5 w-3.5" />
                    </span>
                    <button type="button" onClick={() => openNoteHere(note)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-1.5">
                        {note.pinned ? <Pin className="h-3 w-3 shrink-0 text-blue-500" /> : null}
                        <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                          {noteDisplayTitle(note, t)}
                        </span>
                      </div>
                      {note.content ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-slate-400">{note.content}</p>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTogglePin(note)}
                      aria-label={note.pinned ? (t('notes_unpin') || 'Unpin') : (t('notes_pin') || 'Pin')}
                      className="shrink-0 rounded-full p-1 text-slate-300 opacity-0 hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100 dark:hover:bg-slate-700"
                    >
                      {note.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteHere(note)}
                      disabled={busy}
                      aria-label={t('delete') || 'Delete'}
                      className="shrink-0 rounded-full p-1 text-slate-300 opacity-0 hover:bg-red-50 hover:text-red-500 disabled:opacity-50 group-hover:opacity-100 dark:hover:bg-red-950"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Editor pane */}
        <div className={`flex w-full flex-1 flex-col ${mobileView === 'editor' ? 'flex' : 'hidden'} sm:flex`}>
          {activeNote ? (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                <button
                  type="button"
                  onClick={backToList}
                  aria-label={t('notes_back') || 'Back to notes'}
                  className="inline-flex items-center gap-1 rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 sm:hidden"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="flex-1" />
                {saveState !== 'idle' ? (
                  <span className="flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                    {saveState === 'saving' ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t('notes_saving') || 'Saving…'}
                      </>
                    ) : (
                      t('notes_saved') || 'Saved'
                    )}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => deleteHere(activeNote)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-950"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('delete') || 'Delete'}
                </button>
              </div>
              <input
                type="text"
                value={draftTitle}
                onChange={(e) => handleTitleChange(e.target.value)}
                placeholder={t('notes_title_placeholder') || 'Title'}
                className="border-b border-slate-100 bg-transparent px-4 py-3 text-base font-medium text-slate-800 outline-none placeholder:text-slate-300 dark:border-slate-800 dark:text-slate-100"
              />
              <textarea
                value={draftContent}
                onChange={(e) => handleContentChange(e.target.value)}
                placeholder={t('notes_content_placeholder') || 'Write a note…'}
                className="min-h-[240px] flex-1 resize-none bg-transparent px-4 py-3 text-sm text-slate-700 outline-none placeholder:text-slate-300 dark:text-slate-200"
                autoFocus
              />
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-slate-400">
              <Pencil className="h-6 w-6 text-slate-300" />
              <span>{t('notes_empty') || 'No notes yet.'}</span>
              <button
                type="button"
                onClick={newNoteHere}
                disabled={busy}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-950 dark:text-blue-300"
              >
                <Plus className="h-3.5 w-3.5" />
                {t('notes_new') || 'New note'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
