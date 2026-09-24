import X from 'lucide-react/dist/esm/icons/x.js'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useApp as useAppHook } from '../../../AppContext.tsx'

// Same cast Modal.tsx/UnsavedChangesPrompt.tsx use -- Fold is a kit
// component adopted only inside the admin app, which
// always sits under AppProvider.
const useApp = useAppHook as unknown as () => { t: (key: string) => string }

export type FoldProps = {
  open: boolean
  onClose: () => void
  title: ReactNode
  /** Rendered in the fold header, before the close button. */
  actions?: ReactNode
  children: ReactNode
  /** The row/button that triggered this fold -- >=768px anchors the
   *  floating panel under it. Optional: without it the panel centers on
   *  the viewport (still portalled, still level-2, just unanchored). Not
   *  part of the brief's minimal prop sketch, but required to actually
   *  implement "anchored to the triggering row" -- documented here rather
   *  than left unresolved. */
  anchorRef?: RefObject<HTMLElement | null>
  /** Identity of the row `anchorRef.current` currently points at (a row id,
   *  a key -- anything that changes when the anchor changes).
   *
   *  A ref mutation is invisible to React: callers set `anchorRef.current =
   *  el` and then change which row is open, so when the fold is RE-TARGETED
   *  while already open (press row A, then row B; or a programmatic drill
   *  from one row to another) nothing re-ran the placement effect and the
   *  panel stayed at the previous row's coordinates (measured: panel top
 *  275px while the newly-opened row sat at 542px, reportsDetailFloatClose).
   *  The placement effect is keyed on this, so passing the open row's id is
   *  what makes a re-target move the panel. Optional: a fold anchored to one
   *  fixed control (the options fold's button) has nothing to re-target. */
  anchorKey?: string | number
  /** Desktop panel width: 'md' (20rem, default) for a single receipt/detail,
   *  'lg' (28rem) when the body is a multi-column table. Ignored on the mobile sheet. */
  size?: 'md' | 'lg'
  className?: string
}

const MOBILE_BREAKPOINT = 768
const FOLD_HISTORY_MARKER = '__businessOsFold'

// The header carries the record's NAME (a product, a customer, a receipt
// number, a period). Names are never cut with an ellipsis on this project
// (owner, Sep 22: "product names are using elipses when too long, remember we
// don't do that. we do scroll left and right") -- a long one scrolls sideways
// inside its own box.
//
// `.detail-scroll-text` (styles/main.css) is that scroller, app-wide and
// already used by the product detail surfaces: one implementation, not a
// second. It lives HERE rather than in a per-surface override, because an
// override in reports-surface.css only ever fixed the panels that happen to
// carry `.reports-fold-panel` -- the kit gallery's fold, and any future
// caller, kept the ellipsis. Both branches (mobile sheet, desktop panel)
// share the string so they cannot drift apart.
const FOLD_TITLE_CLASS = 'detail-scroll-text min-w-0 flex-1 font-[family-name:var(--ui-font-display)] text-[length:var(--ui-size-h3)] font-semibold text-[var(--ui-ink)]'

function getFocusable(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  )
}

// Fold -- the kit's level-2 container: a floating panel (>=768px, anchored
// to the triggering row) or a bottom sheet (<768px), replacing both the
// inline-expand accordions (Branches `expandedBranches`, ReviewQueue/
// InventoryMovements/AllFieldsPanel) and the direct-to-modal surfaces
// (POS `ProductDetailSheet`, `SaleDetailModal`, Contacts `DetailModal`)
// the Gate 2A audit found, without touching those pages' own data logic
// (P2-1 does not adopt Fold into any page -- that is P2-4/P2-5's job).
//
// Never dims/pushes page content -- unlike Modal, this is a lighter,
// row-anchored layer: outside clicks close it via the same document-level
// listener pattern PortalMenu.tsx already uses (not a full-screen scrim),
// except on the mobile sheet, where a translucent scrim is the expected
// "sliding up from the bottom" affordance.
//
// History-stack awareness: pushes one history entry while open so the
// OS/browser back button closes the fold instead of leaving the page (the
// brief allows "implement onPopState close and document" when Section 6's
// own bottom-sheet history pattern isn't available to mirror -- that is
// the approach taken here). Closing via any other affordance (Escape,
// outside click, the X button) calls `history.back()` itself IF the fold's
// own marked entry is still the current one, so it does not leave a dead
// forward-history entry sitting behind the user.
// Desktop placement: below the anchor when there is room, otherwise flipped
// above it. A chip or row near the bottom of the viewport used to get a panel
// whose top was clamped to innerHeight-80, leaving ~80px visible and the rest
// cut off (a fixed element cannot be scrolled into view). Whichever side is
// used, max height is bounded by the space on that side so the body scrolls
// instead of overflowing the viewport.
//
// AND the result is clamped to the viewport on BOTH axes, not only on `left`.
// The panel follows its anchor on every scroll (see `track` below), so a list
// scrolled far enough carried the anchor -- and with it the panel -- clean off
// the top of the screen: `top: -872px` measured on a real report list by the
// lane's verifier, and `top: -1596px` reproduced in
// tests/reportsDetailFloatClose.test.ts (which fails on that assertion if this
// clamp is removed). The header X was unreachable, so the owner's "if i move
// it it disappears" was still true on desktop after the auto-close fix. A
// fixed panel cannot be scrolled back into view, so the clamp is the only
// repair. `maxHeight` is clamped with it: a panel pinned to the top margin may
// not be taller than the room left under it, or the clamp just moves the
// overflow to the bottom edge.
const FOLD_MIN_SPACE = 240
const FOLD_VIEWPORT_MARGIN = 8
function placeAnchored(rect: DOMRect, panelWidth: number): CSSProperties {
  const gap = 8
  const margin = FOLD_VIEWPORT_MARGIN
  const viewportHeight = window.innerHeight
  const left = Math.max(margin, Math.min(rect.left, window.innerWidth - panelWidth - gap))
  const spaceBelow = viewportHeight - rect.bottom - gap * 2
  const spaceAbove = rect.top - gap * 2
  const base: CSSProperties = { position: 'fixed', left, zIndex: 'var(--z-fold)' }
  // The tallest a panel may be and still sit inside both margins.
  const limit = Math.max(120, viewportHeight - margin * 2)
  if (spaceBelow >= FOLD_MIN_SPACE || spaceBelow >= spaceAbove) {
    const maxHeight = Math.min(Math.max(120, spaceBelow), limit)
    // Never above the top margin, never so low that the panel's own height
    // would push its bottom past the bottom margin.
    const top = Math.min(Math.max(margin, rect.bottom + gap), Math.max(margin, viewportHeight - margin - maxHeight))
    return { ...base, top, maxHeight }
  }
  const maxHeight = Math.min(Math.max(120, spaceAbove), limit)
  const bottom = Math.min(Math.max(margin, viewportHeight - rect.top + gap), Math.max(margin, viewportHeight - margin - maxHeight))
  return { ...base, bottom, maxHeight }
}

export default function Fold({ open, onClose, title, actions, children, anchorRef, anchorKey, size = 'md', className = '' }: FoldProps) {
  const { t } = useApp()
  const tr = (key: string, fallback: string): string => {
    const value = t(key)
    return value && value !== key ? value : fallback
  }
  const panelWidth = size === 'lg' ? 448 : 320
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const pushedHistoryRef = useRef(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  // THE close contract, and why `onClose` may never be an effect dependency.
  //
  // Every caller passes an inline arrow (`onClose={() => setOpenRow(null)}`),
  // so its identity changes on EVERY render of the owning view -- including
  // renders that have nothing to do with this panel (the app shell toggles
  // its mobile header on scroll, App.tsx `handleScroll` -> `setVisible`,
  // which re-renders the whole page under the fold). With `onClose` in the
  // history effect's deps that re-render tore the effect down and back up:
  // the cleanup called `history.back()` and the new body pushed a fresh
  // entry, so the traversal's `popstate` landed on the NEW listener and
  // closed the panel. Net effect for the user: scrolling/moving the page
  // auto-closed an open detail float (owner, Sep 22: "when open as a float,
  // click outside/click close to close... currently if i move it just auto
  // close"). A ref keeps the latest handler reachable while the effects stay
  // bound to `open` alone, so the ONLY things that close a fold are the
  // header X, an outside press, Escape and the browser's own Back.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Anchor position (desktop only) + outside-click / Escape handling.
  useEffect(() => {
    if (!open) return undefined
    // One measurement per FRAME, not one per scroll event. A capture-phase
    // scroll listener on `document` fires for every nested scroller and every
    // wheel/touch step; measuring + setState on each one meant a forced layout
    // and a React render per event on a surface (the report list) whose whole
    // complaint was that it felt heavy. The rAF coalesces a burst into the one
    // measurement the next paint will actually use, and an unchanged rect is
    // dropped before it can re-render anything.
    let frame = 0
    let last: { top: number; left: number; bottom: number; right: number } | null = null
    const track = () => {
      const anchor = anchorRef?.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      if (last && last.top === rect.top && last.left === rect.left && last.bottom === rect.bottom && last.right === rect.right) return
      last = { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right }
      setAnchorRect(rect)
    }
    const scheduleTrack = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        track()
      })
    }
    if (!isMobile) track()
    const closeIfOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target)) return
      if (anchorRef?.current?.contains(target)) return
      onCloseRef.current()
    }
    const closeIfEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('mousedown', closeIfOutside)
    document.addEventListener('touchstart', closeIfOutside)
    document.addEventListener('keydown', closeIfEscape)
    // A scroll MOVES the anchored panel with its row; it never closes it, and
    // `placeAnchored` keeps the moved panel inside the viewport so the row can
    // scroll away without taking the close button with it.
    // Capture, because the scrolling node is the nested `.page-scroll`
    // container and scroll events do not bubble (same technique AppSelect/
    // PortalMenu use).
    if (!isMobile) {
      document.addEventListener('scroll', scheduleTrack, true)
      window.addEventListener('resize', scheduleTrack)
    }
    return () => {
      document.removeEventListener('mousedown', closeIfOutside)
      document.removeEventListener('touchstart', closeIfOutside)
      document.removeEventListener('keydown', closeIfEscape)
      document.removeEventListener('scroll', scheduleTrack, true)
      window.removeEventListener('resize', scheduleTrack)
      if (frame) window.cancelAnimationFrame(frame)
    }
  // `anchorKey` is in here so a RE-TARGET re-measures: the caller mutates
  // `anchorRef.current` to the new row, which React cannot see, and without
  // this dep the panel kept the previous row's position. Re-running is
  // cheap (it re-arms three listeners and takes one measurement) and it is
  // NOT the history effect, which must stay keyed on `open` alone.
  }, [open, isMobile, anchorRef, anchorKey])

  // Focus trap + return focus.
  useEffect(() => {
    if (!open) return undefined
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    const focusables = getFocusable(panelRef.current)
    ;(focusables[0] || panelRef.current)?.focus()

    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const items = getFocusable(panelRef.current)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const activeEl = document.activeElement
      if (event.shiftKey && activeEl === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && activeEl === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trapTab)
    return () => {
      document.removeEventListener('keydown', trapTab)
      previouslyFocusedRef.current?.focus?.()
    }
  }, [open])

  // History-stack awareness (see the file comment above).
  useEffect(() => {
    if (!open) return undefined
    window.history.pushState({ [FOLD_HISTORY_MARKER]: true }, '')
    pushedHistoryRef.current = true
    const onPopState = () => {
      pushedHistoryRef.current = false
      onCloseRef.current()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      if (pushedHistoryRef.current) {
        pushedHistoryRef.current = false
        window.history.back()
      }
    }
    // `open` ONLY -- see the onCloseRef note above: a changing handler
    // identity here pushed and popped one history entry per render, and the
    // popstate that produced closed the panel.
  }, [open])

  if (!open || typeof document === 'undefined') return null

  const panelStyle: CSSProperties = isMobile
    ? {}
    : anchorRect
      ? placeAnchored(anchorRect, panelWidth)
      : { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 'var(--z-fold)' }

  const node = isMobile ? (
    <div className="fixed inset-0 z-[var(--z-fold)] flex items-end justify-center" style={{ backgroundColor: 'var(--ui-backdrop)' }}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={['w-full rounded-t-[var(--ui-radius-lg)] bg-[var(--ui-surface)] shadow-[var(--ui-shadow-3)] flex flex-col', 'max-h-[85dvh]', className].join(' ').trim()}
      >
        <div className="flex justify-center pt-2">
          <span className="h-1 w-9 rounded-full bg-[var(--ui-line-2)]" aria-hidden="true" />
        </div>
        <div className="flex min-w-0 items-center gap-2 border-b border-[var(--ui-line)] px-4 py-2.5">
          <h3 className={FOLD_TITLE_CLASS}>{title}</h3>
          {actions}
          <button type="button" onClick={onClose} aria-label={tr('close', 'Close')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ui-radius)] text-[var(--ui-ink-2)] hover:bg-[var(--ui-surface-2)]">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-[env(safe-area-inset-bottom)]">{children}</div>
      </div>
    </div>
  ) : (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === 'string' ? title : undefined}
      tabIndex={-1}
      style={panelStyle}
      className={[size === 'lg' ? 'w-[28rem]' : 'w-80', 'max-h-[70vh] flex flex-col rounded-[var(--ui-radius-lg)] border border-[var(--ui-line)] bg-[var(--ui-surface)] shadow-[var(--ui-shadow-3)]', className].join(' ').trim()}
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-[var(--ui-line)] px-3 py-2">
        <h3 className={FOLD_TITLE_CLASS}>{title}</h3>
        {actions}
        <button type="button" onClick={onClose} aria-label={tr('close', 'Close')} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--ui-radius)] text-[var(--ui-ink-2)] hover:bg-[var(--ui-surface-2)]">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">{children}</div>
    </div>
  )

  return createPortal(node, document.body)
}
