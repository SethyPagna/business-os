import X from 'lucide-react/dist/esm/icons/x.js'
import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

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
  /** Desktop panel width: 'md' (20rem, default) for a single receipt/detail,
   *  'lg' (28rem) when the body is a multi-column table. Ignored on the mobile sheet. */
  size?: 'md' | 'lg'
  className?: string
}

const MOBILE_BREAKPOINT = 768
const FOLD_HISTORY_MARKER = '__businessOsFold'

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
const FOLD_MIN_SPACE = 240
function placeAnchored(rect: DOMRect, panelWidth: number): CSSProperties {
  const gap = 8
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - panelWidth - gap))
  const spaceBelow = window.innerHeight - rect.bottom - gap * 2
  const spaceAbove = rect.top - gap * 2
  const base: CSSProperties = { position: 'fixed', left, zIndex: 'var(--z-fold)' }
  if (spaceBelow >= FOLD_MIN_SPACE || spaceBelow >= spaceAbove) {
    return { ...base, top: rect.bottom + gap, maxHeight: Math.max(120, spaceBelow) }
  }
  return { ...base, bottom: window.innerHeight - rect.top + gap, maxHeight: Math.max(120, spaceAbove) }
}

export default function Fold({ open, onClose, title, actions, children, anchorRef, size = 'md', className = '' }: FoldProps) {
  const panelWidth = size === 'lg' ? 448 : 320
  const panelRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)
  const pushedHistoryRef = useRef(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < MOBILE_BREAKPOINT)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Anchor position (desktop only) + outside-click / Escape handling.
  useEffect(() => {
    if (!open) return undefined
    if (!isMobile && anchorRef?.current) {
      setAnchorRect(anchorRef.current.getBoundingClientRect())
    }
    const closeIfOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target)) return
      if (anchorRef?.current?.contains(target)) return
      onClose()
    }
    const closeIfEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', closeIfOutside)
    document.addEventListener('touchstart', closeIfOutside)
    document.addEventListener('keydown', closeIfEscape)
    return () => {
      document.removeEventListener('mousedown', closeIfOutside)
      document.removeEventListener('touchstart', closeIfOutside)
      document.removeEventListener('keydown', closeIfEscape)
    }
  }, [open, isMobile, anchorRef, onClose])

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
      onClose()
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      if (pushedHistoryRef.current) {
        pushedHistoryRef.current = false
        window.history.back()
      }
    }
  }, [open, onClose])

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
          <h3 className="min-w-0 flex-1 truncate font-[family-name:var(--ui-font-display)] text-[length:var(--ui-size-h3)] font-semibold text-[var(--ui-ink)]">{title}</h3>
          {actions}
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ui-radius)] text-[var(--ui-ink-2)] hover:bg-[var(--ui-surface-2)]">
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
        <h3 className="min-w-0 flex-1 truncate font-[family-name:var(--ui-font-display)] text-[length:var(--ui-size-h3)] font-semibold text-[var(--ui-ink)]">{title}</h3>
        {actions}
        <button type="button" onClick={onClose} aria-label="Close" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--ui-radius)] text-[var(--ui-ink-2)] hover:bg-[var(--ui-surface-2)]">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5">{children}</div>
    </div>
  )

  return createPortal(node, document.body)
}
