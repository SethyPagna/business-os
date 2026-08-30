import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import Pencil from 'lucide-react/dist/esm/icons/pencil.js'
import Plus from 'lucide-react/dist/esm/icons/plus.js'
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left.js'
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.js'
import Pin from 'lucide-react/dist/esm/icons/pin.js'
import PinOff from 'lucide-react/dist/esm/icons/pin-off.js'
import Loader2 from 'lucide-react/dist/esm/icons/loader-2.js'
import X from 'lucide-react/dist/esm/icons/x.js'
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2.js'
import { useApp as useAppHook } from '../../app/AppContextCore.tsx'
import { noteDisplayTitle } from '../notes/useNotesController.ts'
import { useNotes } from '../notes/NotesContext.tsx'
import type { NoteRecord } from '../../api/notesTransport.ts'

type AppContextValue = {
  page: string
  navigateTo: (pageId: string) => void
}

const useApp = useAppHook as () => AppContextValue

// Personal, per-user autosaved notes -- quick-access floating panel. This
// used to hard-navigate straight to the full Notes page (components/notes/
// NotesPage.tsx) on every tap, which meant a quick jot-something-down
// always cost you whatever you were looking at on the current page. Back
// to a real popup, but built properly this time: a draggable floating card
// (same pointer-drag mechanics as BackgroundImportTracker.tsx's header --
// see its own comment for why the whole header row is the drag handle
// rather than a dedicated grip button) driven by the same useNotesController
// hook the full Notes page now also uses, so the two surfaces can never
// drift out of sync on load/autosave/conflict-handling logic.
//
// Docked as a slim "bump" tab flush to the left screen edge, vertically
// centered, until opened -- opposite edge from BackgroundImportTracker's
// minimized dock (right), so the two never collide. Hidden entirely while
// already on the full Notes page, since a shortcut to the page currently
// on screen has nothing to do.
//
// Resizable via a bottom-right corner handle, same pointer-drag mechanics
// (capture, threshold-before-committing, persisted to localStorage) as the
// header's reposition drag above -- previously the panel was a fixed
// h-[26rem] w-[min(360px,...)] with no way to make it bigger for a long
// note or smaller to get it out of the way. Resizing and repositioning are
// independent gestures (different handle, different pointer session) but
// share the same clamp-to-viewport approach so neither can push the panel
// off-screen.

const DRAG_POS_STORAGE_KEY = 'businessos_notes_widget_pos'
const SIZE_STORAGE_KEY = 'businessos_notes_widget_size'
// The collapsed pencil chip's own remembered position -- separate from the
// open panel's DRAG_POS_STORAGE_KEY on purpose: the chip lives docked to
// the LEFT EDGE and only its vertical position is draggable (free x/y
// would detach it from the edge its rounded-r "bump" design hugs). One
// number is all it needs.
const LAUNCHER_POS_STORAGE_KEY = 'businessos_notes_launcher_pos'
const LAUNCHER_EDGE_MARGIN = 8

function readLauncherTop(): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LAUNCHER_POS_STORAGE_KEY)
    if (raw == null) return null
    const top = Number(raw)
    return Number.isFinite(top) ? top : null
  } catch (_) {
    return null
  }
}

function writeLauncherTop(top: number): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LAUNCHER_POS_STORAGE_KEY, String(top))
  } catch (_) {
    // Same as writeDragPos -- the drag still works for the session.
  }
}

function clampLauncherTop(top: number, chipHeight: number): number {
  const maxTop = Math.max(LAUNCHER_EDGE_MARGIN, window.innerHeight - chipHeight - LAUNCHER_EDGE_MARGIN)
  return Math.min(maxTop, Math.max(LAUNCHER_EDGE_MARGIN, top))
}
const DRAG_EDGE_MARGIN = 8
const MIN_WIDTH = 280
const MIN_HEIGHT = 280
// First-ever open (no remembered size) now starts at the same floor the
// resize handle itself enforces (MIN_WIDTH/MIN_HEIGHT), instead of a larger
// 360x416 default -- the panel opens as small as it's ever allowed to be,
// and since MIN_WIDTH/MIN_HEIGHT is also clampSize's floor, dragging the
// corner handle from this starting point can only ever grow the panel, not
// shrink it further.
const DEFAULT_WIDTH = MIN_WIDTH
const DEFAULT_HEIGHT = MIN_HEIGHT
// Per-pointer-type drag threshold -- see the identical constant's comment
// in BackgroundImportTracker.tsx for why a flat 4px (fine for mouse, far
// too tight for a real touch tap) was swallowing taps on the
// Maximize/Close buttons on touchscreens.
const DRAG_MOVE_THRESHOLD_BY_POINTER_TYPE: Record<string, number> = { touch: 10, pen: 8, mouse: 4 }
function getDragMoveThreshold(pointerType: string): number {
  return DRAG_MOVE_THRESHOLD_BY_POINTER_TYPE[pointerType] ?? 4
}

type DragPos = { left: number; top: number }

function readDragPos(): DragPos | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DRAG_POS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { left?: unknown; top?: unknown } | null
    const left = Number(parsed?.left)
    const top = Number(parsed?.top)
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null
    return { left, top }
  } catch (_) {
    return null
  }
}

function writeDragPos(pos: DragPos): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(DRAG_POS_STORAGE_KEY, JSON.stringify(pos))
  } catch (_) {
    // Storage unavailable -- dragging still works for the session, it just
    // won't be remembered next reload. Not fatal.
  }
}

// How much of the panel must stay visible/grabbable at minimum -- applies
// only to the relaxed small-screen clamp below, so a drag can't fully lose
// the panel off-screen with no way to bring it back.
const MIN_VISIBLE_PX = 56
// Below this viewport width, dragging is allowed to carry the panel
// partway past the screen edge (see clampDragPos) -- small screens have so
// little room that "always fully on-screen" left almost nowhere to drag it
// out of the way of whatever's underneath, which is what the drag was for.
const RELAXED_CLAMP_BREAKPOINT_PX = 640

function clampDragPos(pos: DragPos, width: number, height: number): DragPos {
  if (typeof window !== 'undefined' && window.innerWidth < RELAXED_CLAMP_BREAKPOINT_PX) {
    // Relaxed: the panel may hang off any edge, as long as at least
    // MIN_VISIBLE_PX of it (measured from whichever edge it's nearest)
    // stays on-screen to grab and pull back.
    const minLeft = MIN_VISIBLE_PX - width
    const maxLeft = window.innerWidth - MIN_VISIBLE_PX
    const minTop = MIN_VISIBLE_PX - height
    const maxTop = window.innerHeight - MIN_VISIBLE_PX
    return {
      left: Math.min(maxLeft, Math.max(minLeft, pos.left)),
      top: Math.min(maxTop, Math.max(minTop, pos.top)),
    }
  }
  const maxLeft = Math.max(DRAG_EDGE_MARGIN, window.innerWidth - width - DRAG_EDGE_MARGIN)
  const maxTop = Math.max(DRAG_EDGE_MARGIN, window.innerHeight - height - DRAG_EDGE_MARGIN)
  return {
    left: Math.min(maxLeft, Math.max(DRAG_EDGE_MARGIN, pos.left)),
    top: Math.min(maxTop, Math.max(DRAG_EDGE_MARGIN, pos.top)),
  }
}

type PanelSize = { width: number; height: number }

function readSize(): PanelSize | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SIZE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { width?: unknown; height?: unknown } | null
    const width = Number(parsed?.width)
    const height = Number(parsed?.height)
    if (!Number.isFinite(width) || !Number.isFinite(height)) return null
    return { width, height }
  } catch (_) {
    return null
  }
}

function writeSize(size: PanelSize): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SIZE_STORAGE_KEY, JSON.stringify(size))
  } catch (_) {
    // Same as writeDragPos -- resizing still works for the session, just
    // won't be remembered next reload.
  }
}

// Bounds the panel to a readable minimum and to whatever room is actually
// left in the viewport from its current top-left corner -- since only the
// bottom-right corner moves while resizing, "how big can it get" depends on
// where the panel currently sits, not just the viewport's raw dimensions.
function clampSize(size: PanelSize, left: number, top: number): PanelSize {
  const maxWidth = Math.max(MIN_WIDTH, window.innerWidth - left - DRAG_EDGE_MARGIN)
  const maxHeight = Math.max(MIN_HEIGHT, window.innerHeight - top - DRAG_EDGE_MARGIN)
  return {
    width: Math.min(maxWidth, Math.max(MIN_WIDTH, size.width)),
    height: Math.min(maxHeight, Math.max(MIN_HEIGHT, size.height)),
  }
}

// Default position the first time the panel is ever opened (no remembered
// drag position yet) -- just to the right of the left-edge bump, roughly
// vertically centered, echoing where the bump itself sits.
function defaultDragPos(width: number, height: number): DragPos {
  return clampDragPos({ left: 24, top: Math.max(DRAG_EDGE_MARGIN, (window.innerHeight - height) / 2) }, width, height)
}

export default function NotesWidget() {
  const { page, navigateTo } = useApp()
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
  } = useNotes()

  const [open, setOpen] = useState(false)
  const [mobileView, setMobileView] = useState<'list' | 'editor'>('list')
  const [dragPos, setDragPos] = useState<DragPos | null>(() => readDragPos())
  const [size, setSize] = useState<PanelSize | null>(() => readSize())
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<{ pointerId: number; startX: number; startY: number; origLeft: number; origTop: number; moved: boolean; pointerType: string } | null>(null)
  const resizeStateRef = useRef<{ pointerId: number; startX: number; startY: number; origWidth: number; origHeight: number; left: number; top: number; moved: boolean; pointerType: string } | null>(null)
  // Set by the LAUNCHER's own drag ending -- consumed by its onClick so a
  // drag-release doesn't also open the panel. (This used to be set by the
  // open panel's header drag instead, which the launcher could never
  // observe mid-drag -- the leftover flag silently swallowed the FIRST tap
  // on the chip after any panel reposition.)
  const justDraggedRef = useRef(false)
  const [launcherTop, setLauncherTop] = useState<number | null>(() => readLauncherTop())
  const launcherDragStateRef = useRef<{ pointerId: number; startY: number; origTop: number; chipHeight: number; moved: boolean; pointerType: string } | null>(null)

  const label = useMemo(() => t('notes_title') || 'My Notes', [t])

  // Re-clamp a remembered position/size on mount/resize so neither can end
  // up stuck (or overflowing) off-screen after e.g. going from a wide
  // window to a narrow one.
  useEffect(() => {
    if (!dragPos && !size) return
    const clampToViewport = () => {
      const el = panelRef.current
      if (!el) return
      setDragPos((current) => (current ? clampDragPos(current, el.offsetWidth, el.offsetHeight) : current))
      setSize((current) => {
        if (!current) return current
        const rect = el.getBoundingClientRect()
        return clampSize(current, rect.left, rect.top)
      })
    }
    clampToViewport()
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const handleHeaderPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    // The Maximize/Close buttons live inside this header (so the whole bar
    // doubles as a drag handle) and have no pointer handlers of their own,
    // so a pointerdown that starts on either of them bubbles up to here.
    // Capturing the pointer unconditionally -- as this used to do -- can
    // swallow the click those buttons are about to fire on pointerup: some
    // browsers synthesize a touch's click from the *captured* element
    // rather than the original target once setPointerCapture has run,
    // which silently broke closing/maximizing the panel in production.
    // Bail out before starting a drag (and before capturing) whenever the
    // pointerdown began on a button -- let it behave like an ordinary
    // click instead.
    if (event.target instanceof HTMLElement && event.target.closest('button')) return
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      moved: false,
      pointerType: event.pointerType || 'mouse',
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const handleHeaderPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    const el = panelRef.current
    if (!state || !el || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < getDragMoveThreshold(state.pointerType)) return
    if (!state.moved) {
      state.moved = true
      setIsDragging(true)
    }
    const next = clampDragPos({ left: state.origLeft + dx, top: state.origTop + dy }, el.offsetWidth, el.offsetHeight)
    setDragPos(next)
  }, [])

  const endHeaderDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    dragStateRef.current = null
    if (state.moved) {
      setIsDragging(false)
      setDragPos((current) => {
        if (current) writeDragPos(current)
        return current
      })
    }
  }, [])

  // Launcher chip drag -- vertical only, along the left edge it docks to.
  // Pointer events cover mouse, touch and pen in one path (with
  // touch-action: none on the chip so a touch drag isn't hijacked by page
  // scroll), the same mechanics as the panel header drag above: capture,
  // per-pointer-type move threshold so a plain tap still clicks, clamp to
  // the viewport, persist only on release.
  const handleLauncherPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    launcherDragStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      origTop: rect.top,
      chipHeight: rect.height,
      moved: false,
      pointerType: event.pointerType || 'mouse',
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])

  const handleLauncherPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = launcherDragStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    const dy = event.clientY - state.startY
    if (!state.moved && Math.abs(dy) < getDragMoveThreshold(state.pointerType)) return
    state.moved = true
    setLauncherTop(clampLauncherTop(state.origTop + dy, state.chipHeight))
  }, [])

  const endLauncherDrag = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = launcherDragStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    launcherDragStateRef.current = null
    if (state.moved) {
      justDraggedRef.current = true
      setLauncherTop((current) => {
        if (current != null) writeLauncherTop(current)
        return current
      })
    }
  }, [])

  // A remembered chip position from a taller window must not strand the
  // chip below the fold on a shorter one.
  useEffect(() => {
    if (launcherTop == null) return
    const clampToViewport = () => setLauncherTop((current) => (current == null ? current : clampLauncherTop(current, 40)))
    window.addEventListener('resize', clampToViewport)
    return () => window.removeEventListener('resize', clampToViewport)
  }, [launcherTop == null])

  const handleResizeHandlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origWidth: rect.width,
      origHeight: rect.height,
      left: rect.left,
      top: rect.top,
      moved: false,
      pointerType: event.pointerType || 'mouse',
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    // Resizing while the panel is still in its undocked/centered starting
    // position (dragPos null, positioned via the top-1/2 -translate-y-1/2
    // CSS fallback) needs a real left/top to clamp width/height against --
    // lock the position in now from the measured rect, same value it's
    // already visually rendered at, so nothing jumps.
    setDragPos((current) => current ?? { left: rect.left, top: rect.top })
  }, [])

  const handleResizeHandlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    const dx = event.clientX - state.startX
    const dy = event.clientY - state.startY
    if (!state.moved && Math.hypot(dx, dy) < getDragMoveThreshold(state.pointerType)) return
    if (!state.moved) {
      state.moved = true
      setIsResizing(true)
    }
    const next = clampSize({ width: state.origWidth + dx, height: state.origHeight + dy }, state.left, state.top)
    setSize(next)
  }, [])

  const endResizeDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const state = resizeStateRef.current
    if (!state || state.pointerId !== event.pointerId) return
    resizeStateRef.current = null
    if (state.moved) {
      setIsResizing(false)
      setDragPos((current) => {
        if (current) writeDragPos(current)
        return current
      })
      setSize((current) => {
        if (current) writeSize(current)
        return current
      })
    }
  }, [])

  const openPanel = useCallback(() => {
    setOpen(true)
    ensureLoaded()
    setDragPos((current) => {
      if (current) return current
      // First-ever open: no remembered position, and the panel hasn't
      // rendered/measured yet -- fall back to an estimate matching the
      // panel's default DEFAULT_WIDTH/DEFAULT_HEIGHT sizing below (a
      // remembered custom size implies a remembered position too, from
      // the same resize-locks-in-dragPos step, so this branch only ever
      // runs with the defaults anyway).
      const width = Math.min(DEFAULT_WIDTH, window.innerWidth - 2 * DRAG_EDGE_MARGIN)
      const height = Math.min(DEFAULT_HEIGHT, window.innerHeight - 2 * DRAG_EDGE_MARGIN)
      return defaultDragPos(width, height)
    })
  }, [ensureLoaded])

  const closePanel = useCallback(() => {
    flushPendingSave()
    setOpen(false)
  }, [flushPendingSave])

  const openFullPage = useCallback(() => {
    flushPendingSave()
    setOpen(false)
    navigateTo('notes')
  }, [flushPendingSave, navigateTo])

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

  if (page === 'notes') return null

  if (!open) {
    // Docked tab position: on mobile this used to be `top-1/2` (vertical
    // center of the *viewport*), which meant it stayed parked over
    // whatever page content happened to scroll to the screen's midpoint --
    // e.g. Branches' per-branch checkbox/edit buttons once a card's stock
    // list pushed the card tall enough (reported via screenshot: the tab
    // sat directly on top of the branch row's controls). Anchoring to the
    // bottom instead, just above the mobile bottom nav (`Sidebar.tsx`'s
    // `fixed bottom-0 h-14` bar, `md:hidden`), keeps it out of the
    // vertical band where scrollable content actually lives. Desktop has
    // no bottom nav to clear and reports haven't flagged it there, so
    // `md:` keeps the original vertical-center dock.
    // A dragged chip renders at its remembered top (vertical drag only --
    // it stays docked to the left edge by design); otherwise the CSS
    // defaults apply (above the mobile bottom nav / vertically centered on
    // md+). touch-action: none is what lets a touch drag reach the pointer
    // handlers instead of scrolling the page.
    return (
      <div
        className={`pointer-events-none fixed left-0 z-[1001] ${launcherTop == null ? 'bottom-[calc(4.5rem+env(safe-area-inset-bottom))] md:bottom-auto md:top-1/2 md:-translate-y-1/2' : ''}`}
        style={launcherTop != null ? { top: `${launcherTop}px` } : undefined}
      >
        <button
          type="button"
          onClick={() => {
            if (justDraggedRef.current) { justDraggedRef.current = false; return }
            openPanel()
          }}
          onPointerDown={handleLauncherPointerDown}
          onPointerMove={handleLauncherPointerMove}
          onPointerUp={endLauncherDrag}
          onPointerCancel={endLauncherDrag}
          style={{ touchAction: 'none' }}
          aria-label={label}
          title={label}
          className="group pointer-events-auto flex cursor-grab items-center gap-1.5 rounded-r-full border border-blue-200 bg-blue-50/95 py-2.5 pl-2 pr-1 text-blue-900 shadow-lg backdrop-blur transition-[padding-right,transform] duration-150 hover:pr-3 focus-visible:pr-3 active:cursor-grabbing dark:border-blue-900/50 dark:bg-blue-950/90 dark:text-blue-100"
        >
          <Pencil className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="max-w-0 overflow-hidden whitespace-nowrap text-xs font-semibold opacity-0 transition-[max-width,opacity] duration-150 group-hover:max-w-[8rem] group-hover:opacity-100 group-focus-visible:max-w-[8rem] group-focus-visible:opacity-100">
            {label}
          </span>
        </button>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      style={{
        ...(dragPos ? { left: `${dragPos.left}px`, top: `${dragPos.top}px` } : undefined),
        width: `${size?.width ?? DEFAULT_WIDTH}px`,
        height: `${size?.height ?? DEFAULT_HEIGHT}px`,
        maxWidth: 'calc(100vw - 1rem)',
        maxHeight: 'calc(100vh - 1rem)',
      }}
      className={`pointer-events-none fixed z-[1001] flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${isDragging || isResizing ? 'transition-none' : ''} ${!dragPos ? 'left-6 top-1/2 -translate-y-1/2' : ''}`}
    >
      <div
        className="pointer-events-auto flex shrink-0 cursor-grab items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/80 px-3 py-2 active:cursor-grabbing dark:border-slate-800 dark:bg-slate-800/50"
        style={{ touchAction: 'none' }}
        onPointerDown={handleHeaderPointerDown}
        onPointerMove={handleHeaderPointerMove}
        onPointerUp={endHeaderDrag}
        onPointerCancel={endHeaderDrag}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-blue-500" />
          <span className="truncate">{label}</span>
        </span>
        {/* Maximize/Close hit targets: first pass (p-1 -> p-1.5, gap-0.5 ->
            gap-1.5) fixed accidental clicks landing on the wrong button, but
            per Aug 18 batch report the close button on its own is still too
            small to reliably hit on desktop -- a 14px icon plus 6px of
            padding is a ~26px square, well under any reasonable click-target
            floor. Switched from padding-driven sizing to a fixed h-8 w-8
            (32px) box with the icon centered inside, so the clickable area
            no longer shrinks to the icon's own size -- same fix shape as
            the icon staying 3.5 (14px) but now sitting inside a target more
            than twice its area. */}
        <span className="flex flex-shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={openFullPage}
            aria-label={t('notes_open_full_page') || 'Open full page'}
            title={t('notes_open_full_page') || 'Open full page'}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200/70 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={closePanel}
            aria-label={t('close') || 'Close'}
            title={t('close') || 'Close'}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200/70 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </div>

      <div className="pointer-events-auto flex min-h-0 flex-1 flex-col">
        {mobileView === 'list' ? (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1.5 dark:border-slate-800">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {loading ? (t('loading') || 'Loading…') : `${sortedNotes.length} ${t('notes_title') || 'notes'}`}
              </span>
              <button
                type="button"
                onClick={newNoteHere}
                disabled={busy}
                aria-label={t('notes_new') || 'New note'}
                title={t('notes_new') || 'New note'}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-950 dark:text-blue-300"
              >
                <Plus className="h-3 w-3" />
                {t('notes_new') || 'New note'}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : sortedNotes.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-sm text-slate-400">
                  <Pencil className="h-5 w-5 text-slate-300" />
                  <span>{t('notes_empty') || 'No notes yet.'}</span>
                </div>
              ) : (
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sortedNotes.map((note) => (
                    <li
                      key={note.id}
                      className={`group flex items-start gap-1 px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 ${
                        note.id === activeId ? 'bg-blue-50/70 dark:bg-blue-950/40' : ''
                      }`}
                    >
                      <button type="button" onClick={() => openNoteHere(note)} className="min-w-0 flex-1 text-left">
                        <div className="flex items-center gap-1.5">
                          {note.pinned ? <Pin className="h-3 w-3 shrink-0 text-blue-500" /> : null}
                          <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-100">
                            {noteDisplayTitle(note, t)}
                          </span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTogglePin(note)}
                        aria-label={note.pinned ? (t('notes_unpin') || 'Unpin') : (t('notes_pin') || 'Pin')}
                        className="shrink-0 rounded-full p-1 text-slate-300 opacity-0 hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100 dark:hover:bg-slate-700"
                      >
                        {note.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteHere(note)}
                        disabled={busy}
                        aria-label={t('delete') || 'Delete'}
                        className="shrink-0 rounded-full p-1 text-slate-300 opacity-0 hover:bg-red-50 hover:text-red-500 disabled:opacity-50 group-hover:opacity-100 dark:hover:bg-red-950"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5 dark:border-slate-800">
              <button
                type="button"
                onClick={backToList}
                aria-label={t('notes_back') || 'Back to notes'}
                className="inline-flex items-center gap-1 rounded-full p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {saveState !== 'idle' ? (
                <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500">
                  {saveState === 'saving' ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {t('notes_saving') || 'Saving…'}
                    </>
                  ) : (
                    t('notes_saved') || 'Saved'
                  )}
                </span>
              ) : <span className="flex-1" />}
              {activeNote ? (
                <button
                  type="button"
                  onClick={() => deleteHere(activeNote)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-50 dark:hover:bg-red-950"
                  aria-label={t('delete') || 'Delete'}
                  title={t('delete') || 'Delete'}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <input
              type="text"
              value={draftTitle}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder={t('notes_title_placeholder') || 'Title'}
              className="shrink-0 border-b border-slate-100 bg-transparent px-3 py-2 text-sm font-medium text-slate-800 outline-none placeholder:text-slate-300 dark:border-slate-800 dark:text-slate-100"
            />
            <textarea
              value={draftContent}
              onChange={(e) => handleContentChange(e.target.value)}
              placeholder={t('notes_content_placeholder') || 'Write a note…'}
              className="min-h-0 flex-1 resize-none bg-transparent px-3 py-2 text-xs text-slate-700 outline-none placeholder:text-slate-300 dark:text-slate-200"
              autoFocus
            />
          </>
        )}
      </div>

      <div
        role="presentation"
        onPointerDown={handleResizeHandlePointerDown}
        onPointerMove={handleResizeHandlePointerMove}
        onPointerUp={endResizeDrag}
        onPointerCancel={endResizeDrag}
        aria-label={t('notes_resize') || 'Resize'}
        className="pointer-events-auto absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
      >
        <svg viewBox="0 0 16 16" className="h-full w-full text-slate-300 dark:text-slate-600" aria-hidden="true">
          <path d="M15 15L15 11M15 15L11 15M15 15L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </div>
  )
}
