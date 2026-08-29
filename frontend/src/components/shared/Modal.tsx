import X from 'lucide-react/dist/esm/icons/x.js'
import { useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

type ModalProps = {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  // F3 (Part 424): optional controls rendered between the title and the ✕
  // (e.g. a flow's − minimize button). Interactive children are already
  // drag-exempt via handlePointerDown's closest('button...') guard.
  headerExtra?: ReactNode
  wide?: boolean
  size?: ModalSize
  // Lets the operator drag the modal window around by its header -- added
  // for the large import modals (Contacts/Inventory/Products/Sales), which
  // can otherwise sit over the exact rows/state someone needs to glance at
  // while reviewing an import. Four call sites already passed this prop
  // before this component ever implemented it (a real typecheck break,
  // not just an unused prop) -- see CHANGES-VERIFIED.md.
  draggable?: boolean
}

export default function Modal({ title, onClose, children, wide, size, draggable, headerExtra }: ModalProps) {
  const widthClass =
    size === 'sm' ? 'max-w-lg' :
    size === 'lg' ? 'max-w-3xl' :
    size === 'xl' ? 'max-w-4xl' :
    wide          ? 'max-w-4xl' :
    'max-w-2xl'

  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  // Keeps at least this many px of the panel overlapping the viewport on
  // every side, so a drag can never push the whole modal (header included)
  // off-screen with no way to grab it back short of closing and reopening.
  const DRAG_VISIBLE_MARGIN = 48

  const handlePointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggable) return
    // If the press started on the close button (or any other interactive
    // child that might land in the header later), don't start a drag or
    // capture the pointer -- capturing here retargets the subsequent click
    // to this wrapper instead of the button, so the button's own onClick
    // (e.g. onClose) never fires. Only the bare header background should
    // initiate a drag.
    const target = e.target as HTMLElement | null
    if (target?.closest('button, a, input, select, textarea, [role="button"]')) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: offset.x, originY: offset.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const handlePointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggable || !dragRef.current) return
    const { startX, startY, originX, originY } = dragRef.current
    let nextX = originX + (e.clientX - startX)
    let nextY = originY + (e.clientY - startY)
    const rect = panelRef.current?.getBoundingClientRect()
    if (rect && typeof window !== 'undefined') {
      // rect already includes the currently-applied offset, so recover the
      // untransformed ("home") position to clamp against, then re-derive it.
      const homeLeft = rect.left - offset.x
      const homeTop = rect.top - offset.y
      const minX = DRAG_VISIBLE_MARGIN - homeLeft - rect.width
      const maxX = window.innerWidth - DRAG_VISIBLE_MARGIN - homeLeft
      const minY = DRAG_VISIBLE_MARGIN - homeTop - rect.height
      const maxY = window.innerHeight - DRAG_VISIBLE_MARGIN - homeTop
      nextX = Math.min(Math.max(nextX, minX), maxX)
      nextY = Math.min(Math.max(nextY, minY), maxY)
    }
    setOffset({ x: nextX, y: nextY })
  }
  const handlePointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggable) return
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  const node = (
    // overflow-y-auto + items-start (with items-center restored once there's
    // room) added Aug 19 2026: the old items-center-only wrapper had no
    // scroll of its own, so when a modal's content (e.g. the barcode
    // scanner's tall video area) pushed the panel taller than the viewport,
    // centering clipped the excess off BOTH top and bottom equally -- and
    // since this wrapper couldn't scroll, whatever got pushed above y=0
    // (the header, including the close button) was genuinely unreachable,
    // not just visually cut off. Now the wrapper can scroll to reveal
    // anything past the top on short/landscape viewports, and py-8 gives
    // room to actually scroll to instead of the panel sitting flush against
    // the viewport edge with nothing to grab.
    // pointer-events-auto is explicit, not decorative: `pointer-events` is
    // an inherited CSS property, and this Modal used to sometimes get
    // mounted as a descendant of an ancestor that sets `pointer-events-none`
    // on itself (e.g. BackgroundImportTracker.tsx's floating-widget
    // positioning wrapper). Kept even now that the whole node is portalled
    // to document.body (see below) -- cheap, and guards against a future
    // ancestor doing the same thing again.
    // z-[1050] (was z-50): now that this whole node is portalled directly
    // to document.body (see below), its z-index competes in the SAME
    // global stacking context as the app's other body-level fixed overlays
    // instead of being scoped inside whatever ancestor happened to mount
    // it. z-50 was never wrong for a nested Modal (any local ancestor's
    // own stacking context made it "win" against ordinary page content
    // regardless), but at the top level it would have lost to
    // BackgroundImportTracker.tsx's chip/panel (z-[1000]) and
    // NotificationCenter.tsx's dropdown (z-[1010]) -- i.e. exactly the
    // widgets a Modal like the Import Report is opened from. Placed above
    // both, but deliberately still below App.tsx's toast layer (z-[1100])
    // -- a toast confirming an action taken while a modal is open should
    // stay visible on top of it, not get hidden behind the backdrop.
    <div className="pointer-events-auto fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-[1050] overflow-y-auto p-4 py-8 sm:py-4">
      <div
        ref={panelRef}
        className={`bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full ${widthClass} max-h-modal-92 flex flex-col fade-in my-auto`}
        style={draggable && (offset.x || offset.y) ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : undefined}
      >
        <div
          className={`flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 ${draggable ? 'cursor-move select-none touch-none' : ''}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h2>
          <div className="flex items-center gap-1">
          {headerExtra}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
          ><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="modal-scroll p-5">{children}</div>
      </div>
    </div>
  )

  // Portalled straight to document.body -- this is the real fix for the
  // "import report opens broken/frozen, can't be closed" report. Before
  // this change, a Modal rendered from inside BackgroundImportTracker.tsx's
  // floating-widget tree (e.g. the Import Report opened from the imports
  // notification/tracker chip) stayed nested under App.tsx's `<main>`,
  // which has `overflow-hidden` (App.tsx's flex layout for the sidebar+
  // content row). `position: fixed` escapes normal layout, but a browser
  // still CLIPS a fixed-position descendant's paint to an `overflow-hidden`
  // ancestor's box, even though that ancestor isn't fixed's containing
  // block -- a well-known CSS gotcha, not a positioning bug in this
  // component's own classes. The effect matched exactly what was reported:
  // `<main>` itself has no scrollbar of its own (`overflow-hidden`, not
  // `auto`), so once this dialog's dimmed backdrop + panel were clipped
  // to that box, there was no way to scroll the page to reach whatever
  // part of the dialog (often the header and its Close button) fell
  // outside the visible, clipped rectangle -- the dialog looked "frozen"
  // because the one thing that could have gotten you back to its header
  // (page scroll) did nothing, `<main>` had none to give. Rendering into
  // document.body sidesteps every such ancestor (this one and any future
  // one) the same way this codebase's other portalled overlays already do
  // (NotificationCenter.tsx's own dropdown, PortalMenu.tsx, AppSelect.tsx).
  if (typeof document === 'undefined') return node
  return createPortal(node, document.body)
}

