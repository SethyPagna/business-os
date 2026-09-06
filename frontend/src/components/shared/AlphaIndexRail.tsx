import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import {
  RAIL_SPECIAL_KEY,
  nearestRailKey,
  nextRailFocusKey,
  railFocusKey,
  railGestureScrubs,
  railIndexAtOffset,
  railPointerDownAction,
  railRendersThroughPortal,
  railTouchActionClass,
  sortRailKeys,
} from '../../utils/alphaRail.ts'
import type { RailFocusMove } from '../../utils/alphaRail.ts'

export interface AlphaIndexRailProps {
  /** Letters/section keys that actually have data right now -- the rail only
   * renders these (sorted), so it never shows a letter with nothing behind
   * it. Grows/shrinks per page by design (Aug 22 2026 ask: "just show
   * characters that are available" -- supersedes the earlier always-show-
   * full-A-Z decision, which made rails on smaller catalogs look mostly
   * empty/disabled). */
  letters: string[]
  /** Called with the letter the user tapped, scrubbed to, or activated from
   * the keyboard. Always one of `letters` (or `resetOption.key`) -- see
   * nearestRailKey. */
  onJump: (letter: string) => void
  /** Accessible label for the rail; also the prefix of every letter button's
   * own accessible name ("Jump to brand" -> "Jump to brand A"). */
  label?: string
  className?: string
  /** Where the rail pins itself.
   *  - 'sidebar' (default): just right of the admin's fixed 220px sidebar on
   *    md+, right screen edge below it. Products and POS rely on this.
   *  - 'screen': the right screen edge at EVERY breakpoint, clear of a
   *    notch. Used by the public storefront, which has no sidebar.
   *  - 'inline': NOT viewport-fixed and NOT portalled -- it sticks to the
   *    middle of the nearest scrollport inside whatever container the caller
   *    positions it in. This is what lets the admin's portal EDITOR PREVIEW
   *    have the same brand index as the storefront it previews: a `fixed`
   *    rail there would float out of the preview panel and sit over the
   *    admin's own chrome. */
  edge?: 'sidebar' | 'screen' | 'inline'
  /** Mouse hover opens the rail.
   *
   * Defaults ON for the storefront-shaped variants ('screen', 'inline'),
   * which live at the outer right edge of their own surface, and OFF for
   * 'sidebar': that one is pinned at x=228px, immediately right of the admin
   * sidebar and INSIDE the content area, so the cursor crosses it on the way
   * to the list several times a minute. Opening on every crossing is noise,
   * and Products/POS have always opened it by pressing. */
  openOnHover?: boolean
  /** Controlled highlight. Pass the caller's own selection (e.g. the active
   * brand-initial filter) so the chosen key stays marked after the rail
   * collapses. Omit to let the rail track its own last jump. */
  activeKey?: string | null
  /** Optional leading entry that clears the caller's selection -- rendered as
   * a dot so it stays as narrow as the letters. The storefront uses it for
   * "All brands"; the admin rails (which scroll rather than filter) do not
   * pass one. */
  resetOption?: { key: string; ariaLabel: string } | null
}

// Vertical A-Z jump-rail. Replaces the old horizontal per-page filter bars
// (see the removal note above this component's call sites in Products.tsx /
// Inventory.tsx) and, since Sep 6 2026, the public storefront's "Jump to
// brand" letter GRID -- which was a `max-h-[...] overflow-y-auto` box sitting
// directly over the product list, so a wheel/touch gesture aimed at the page
// landed inside it instead of scrolling the page.
//
// Collapsed it is a column of dashes so it doesn't compete with the page for
// attention. Hovering it (mouse) or pressing it (touch) opens it to full
// letter labels for accurate targeting, and it then STAYS open until the
// mouse leaves the rail or the person clicks/taps somewhere else -- a
// deliberate multi-glance use (pick a letter, read the results, come back)
// must not feel like the rail keeps closing on its own.
//
// Pointer events cover mouse, touch and pen with one handler set, and pointer
// capture keeps a scrub live once the finger leaves the (intentionally
// narrow) hit area. The letters are real <button>s with a roving tab stop on
// top of that, so the rail is reachable and operable from the keyboard -- the
// plain buttons it replaced on the storefront were, and losing that would
// have been a regression.
export default function AlphaIndexRail({
  letters,
  onJump,
  label,
  className = '',
  edge = 'sidebar',
  openOnHover,
  activeKey,
  resetOption = null,
}: AlphaIndexRailProps) {
  const railRef = useRef<HTMLDivElement | null>(null)
  const buttonRefs = useRef(new Map<string, HTMLButtonElement>())
  const [internalActive, setInternalActive] = useState<string | null>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  // Separate from `dragging`/`activeLetter` -- this is the "stays big" state:
  // true from the moment the rail is opened, false only once the mouse leaves
  // it or an outside click/tap closes it.
  const [stickyOpen, setStickyOpen] = useState(false)
  // Which key the CURRENT gesture last emitted. A scrub crosses the same key
  // on consecutive pointermove events, and a mouse press fires pointerdown and
  // then click; re-emitting would re-run the caller's jump (and, for a
  // toggling filter, immediately undo it). Cleared at the start and end of
  // every gesture, so re-picking the same key later always emits.
  const lastEmittedRef = useRef<string | null>(null)
  const lastPointerTypeRef = useRef<string>('mouse')
  // The gesture in progress. `openedOnly` marks the press that did nothing but
  // OPEN a collapsed rail: until the finger has actually travelled, that
  // gesture must not emit a jump (see railGestureScrubs).
  const gestureRef = useRef<{ openedOnly: boolean; startY: number } | null>(null)

  const items = useMemo(() => sortRailKeys(letters), [letters])
  // The reset entry takes part in hit-testing and keyboard movement, but
  // never in the nearest-letter fallback (it isn't a letter).
  const navKeys = useMemo(
    () => (resetOption ? [resetOption.key, ...items] : items),
    [items, resetOption],
  )

  const expanded = dragging || stickyOpen
  const hoverOpens = openOnHover ?? edge !== 'sidebar'
  const activeLetter = activeKey !== undefined ? activeKey : internalActive
  const tabStopKey = railFocusKey(navKeys, focusKey ?? activeLetter)

  // Hit-testing measures the LETTER COLUMN, never the pill around it. The
  // rail is height-capped but its entries are shrink-0, so a long enough
  // alphabet makes the column taller than the box (and then scrolls inside
  // it); a linear split of the clamped box height names a letter rows away
  // from the finger. Two rect reads -- the first and the last entry -- carry
  // the scroll position, the padding and the border with them, so the mapping
  // stays true in every state without measuring all 28 buttons per move.
  const keyAtPoint = useCallback((clientY: number): string | null => {
    const node = railRef.current
    if (!node) return null
    const rect = node.getBoundingClientRect()
    const firstRect = buttonRefs.current.get(navKeys[0])?.getBoundingClientRect()
    const lastRect = buttonRefs.current.get(navKeys[navKeys.length - 1])?.getBoundingClientRect()
    const contentTop = firstRect ? firstRect.top - rect.top : 0
    const contentHeight = firstRect && lastRect ? lastRect.bottom - firstRect.top : rect.height
    const index = railIndexAtOffset(navKeys.length, clientY - rect.top, rect.height, contentTop, contentHeight)
    return index === -1 ? null : navKeys[index] ?? null
  }, [navKeys])

  const jumpTo = useCallback((rawKey: string | null) => {
    if (!rawKey) return
    setStickyOpen(true)
    const target = resetOption && rawKey === resetOption.key ? rawKey : nearestRailKey(items, rawKey)
    if (!target) return
    setFocusKey(target)
    if (activeKey === undefined) setInternalActive(target)
    if (lastEmittedRef.current === target) return
    lastEmittedRef.current = target
    onJump(target)
  }, [activeKey, items, onJump, resetOption])

  // Closes the rail immediately -- no fade timer -- used by the pointer-leave,
  // click-outside and Escape paths below.
  const closeRail = useCallback(() => {
    setStickyOpen(false)
    setFocusKey(null)
    if (activeKey === undefined) setInternalActive(null)
  }, [activeKey])

  // The FIRST press of a gesture either opens a collapsed rail or jumps -- see
  // railPointerDownAction. On touch it can never do both: the collapsed
  // entries are ~2px dashes, so hit-testing the press that was meant to open
  // the rail produced an essentially random key (on the storefront, a random
  // brand filter).
  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const pointerType = event.pointerType || 'mouse'
    lastPointerTypeRef.current = pointerType
    lastEmittedRef.current = null
    const action = railPointerDownAction(expanded, pointerType)
    gestureRef.current = { openedOnly: action === 'open', startY: event.clientY }
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (action === 'open') {
      setStickyOpen(true)
      return
    }
    jumpTo(keyAtPoint(event.clientY))
  }, [expanded, jumpTo, keyAtPoint])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    const gesture = gestureRef.current
    if (gesture) {
      if (!railGestureScrubs(gesture.openedOnly, gesture.startY, event.clientY)) return
      gesture.openedOnly = false
    }
    jumpTo(keyAtPoint(event.clientY))
  }, [dragging, jumpTo, keyAtPoint])

  // Release just ends the drag gesture -- it does not collapse the rail
  // (that's closeRail(), triggered only by pointer-leave/outside-click/Esc).
  const releaseDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    lastEmittedRef.current = null
    gestureRef.current = null
    setDragging(false)
  }, [])

  // pointercancel on a press that had only OPENED the rail means the browser
  // took the gesture for a page scroll -- which is exactly what the collapsed
  // rail now permits (touch-pan-y). That was never a tap on the index, so
  // undo the open rather than leaving the rail hanging over the page after
  // every swipe that happens to start on the right edge.
  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const openedOnly = gestureRef.current?.openedOnly === true
    releaseDrag(event)
    if (openedOnly) closeRail()
  }, [closeRail, releaseDrag])

  // Hover-to-open, mouse only. A tap emits a pointerenter with pointerType
  // 'touch' immediately before pointerdown; opening on that would make the
  // touch path indistinguishable from the mouse path, and touch has no
  // "leave" to close it again.
  const handlePointerEnter = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    lastPointerTypeRef.current = event.pointerType || 'mouse'
    if (!hoverOpens) return
    if (event.pointerType !== 'mouse') return
    setStickyOpen(true)
  }, [hoverOpens])

  // "Moving elsewhere" -- the mouse actually leaving the rail's own hit area.
  // Touch/pen keep the rail open (they have no hover state to lose) and close
  // on the outside pointerdown below, which is what the owner asked for.
  // Never while mid-drag, and never while the rail holds keyboard focus.
  const handlePointerLeave = useCallback(() => {
    if (dragging) return
    if (lastPointerTypeRef.current !== 'mouse') return
    const node = railRef.current
    if (node && node.contains(document.activeElement)) return
    closeRail()
  }, [closeRail, dragging])

  const moveFocus = useCallback((move: RailFocusMove) => {
    const next = nextRailFocusKey(navKeys, tabStopKey, move)
    if (!next) return
    setStickyOpen(true)
    setFocusKey(next)
    buttonRefs.current.get(next)?.focus()
  }, [navKeys, tabStopKey])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, RailFocusMove> = {
      ArrowDown: 'down',
      ArrowRight: 'down',
      ArrowUp: 'up',
      ArrowLeft: 'up',
      Home: 'first',
      End: 'last',
    }
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      moveFocus(move)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeRail()
    }
  }, [closeRail, moveFocus])

  // Keyboard activation only. Mouse and touch already went through
  // pointerdown; a browser reports a keyboard-synthesised click with
  // detail === 0, which is the one case pointerdown never covers.
  const handleClick = useCallback((key: string) => (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.detail !== 0) return
    lastEmittedRef.current = null
    jumpTo(key)
  }, [jumpTo])

  // "Click elsewhere" -- a pointerdown anywhere outside the rail's own DOM
  // node. Only listens while the rail is actually open, so this never adds
  // global listener overhead for the (default, most common) collapsed state.
  useEffect(() => {
    if (!stickyOpen) return
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const node = railRef.current
      if (!node) return
      if (event.target instanceof Node && node.contains(event.target)) return
      closeRail()
    }
    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
  }, [stickyOpen, closeRail])

  if (items.length === 0) return null

  const railLabel = label || 'Jump to letter'
  // 'screen' clears a notched right edge at every breakpoint and keeps a
  // shorter column so the rail cannot reach the storefront's bottom-right
  // list FAB (z-50); 'sidebar' keeps the admin's 220px offset on md+;
  // 'inline' owns no position of its own -- the sticky track below places it.
  const edgeClass = edge === 'inline'
    ? 'relative max-h-[60vh]'
    : edge === 'screen'
      ? 'fixed top-1/2 z-30 -translate-y-1/2 right-[calc(0.5rem+env(safe-area-inset-right))] max-h-[60vh]'
      : 'fixed top-1/2 z-30 -translate-y-1/2 right-2 max-h-[70vh] md:left-[228px] md:right-auto'

  // The STOREFRONT rail is rendered through a portal, like every other float
  // in the app: it is viewport-`fixed` inside a shell that carries
  // `overflow-y: auto` + `-webkit-overflow-scrolling: touch`, the combination
  // iOS Safari has historically clipped and mis-positioned fixed descendants
  // inside. Going straight to <body> removes the whole question.
  //
  // The admin rails do NOT portal -- see railRendersThroughPortal. A portal
  // takes a node out of every ancestor's `display`, and POS's products pane is
  // `hidden md:flex` while the cashier is on the mobile Cart tab.
  const railNode = (
    <div
      ref={railRef}
      role="toolbar"
      aria-label={railLabel}
      aria-orientation="vertical"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={releaseDrag}
      onPointerCancel={handlePointerCancel}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onKeyDown={handleKeyDown}
      // `justify-start` + `overflow-y-auto`, not `justify-center`: the entries
      // are shrink-0, so an alphabet longer than the max-h cap used to paint
      // straight through the pill's own edge (and centring pushed its head
      // out of reach of any scroll). `overscroll-contain` keeps a wheel that
      // runs off the end of the rail from chaining into the page behind it,
      // and the scrollbar is hidden because a 20px pill has no room for one.
      // `touch-none` ONLY while expanded (railTouchActionClass). The rail is a
      // ~20px strip over 60vh of the right screen edge -- on the storefront,
      // exactly where a thumb lands -- so suppressing touch in the collapsed
      // state turned it into a dead scroll zone on the very surface whose
      // reported defect was "the page cannot be scrolled".
      className={`flex select-none flex-col items-center justify-start overflow-y-auto overscroll-contain rounded-full border border-gray-200 bg-white/90 shadow-md backdrop-blur-sm transition-[gap,padding] duration-150 [scrollbar-width:none] dark:border-slate-700 dark:bg-slate-900/90 [&::-webkit-scrollbar]:hidden ${railTouchActionClass(expanded)} ${edgeClass} ${
        expanded ? 'gap-[1px] px-1 py-2' : 'gap-[3px] px-1 py-1.5'
      } ${className}`}
    >
      {navKeys.map((key) => {
        const isReset = Boolean(resetOption) && key === resetOption?.key
        const isActive = activeLetter === key
        // Collapsed the rail is a stack of DASHES -- short horizontal bars,
        // wider than they are tall. A square (h-1 w-1) on a rounded-full box
        // is a dot, which is the admin index-rail look the owner rejected for
        // the storefront; and with no fill of its own it was an empty pill.
        const entryShape = expanded ? 'h-5 w-6 rounded-full text-xs' : 'h-0.5 w-2.5 rounded-full text-[0px]'
        const entryTone = isActive
          ? 'bg-blue-600 text-white'
          : expanded
            ? 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-slate-800'
            : 'bg-gray-300 dark:bg-slate-600'
        return (
          <button
            key={key}
            type="button"
            ref={(node) => {
              if (node) buttonRefs.current.set(key, node)
              else buttonRefs.current.delete(key)
            }}
            // One tab stop for the whole rail (roving): 26+ stops on a
            // decorative index would bury the page's real controls.
            tabIndex={key === tabStopKey ? 0 : -1}
            aria-label={isReset ? (resetOption?.ariaLabel || railLabel) : `${railLabel} ${key === RAIL_SPECIAL_KEY ? '#' : key}`}
            aria-pressed={isActive}
            onFocus={() => {
              setStickyOpen(true)
              setFocusKey(key)
            }}
            onClick={handleClick(key)}
            // Feedback for where the finger/cursor landed comes from the
            // active letter itself growing in place (scale) -- not a second
            // floating bubble elsewhere on screen showing the same character
            // twice (the thing this replaced).
            className={`flex shrink-0 cursor-pointer items-center justify-center font-semibold leading-none outline-none transition-all duration-150 focus-visible:ring-2 focus-visible:ring-blue-500 ${entryShape} ${
              isActive ? 'scale-125' : ''
            } ${entryTone}`}
          >
            {expanded ? (isReset ? '•' : key) : ''}
          </button>
        )
      })}
    </div>
  )

  // 'inline' is the one variant that must NOT leave its container: it is the
  // admin portal editor's preview of this same index, and the preview is a
  // panel inside the admin page, not the viewport. The track spans the height
  // of the positioned ancestor the caller provides and the rail sticks to the
  // middle of whatever scrollport that panel lives in, so it stays beside the
  // products it indexes instead of over the admin's chrome. The track itself
  // is pointer-transparent, so the product cards under it stay clickable.
  if (edge === 'inline') {
    return (
      <div className="pointer-events-none absolute inset-y-0 right-0 z-30 flex w-9 justify-center">
        {/* A percentage sticky offset would resolve against this full-height
            track, not the scrollport, so the rail is pinned a fixed distance
            below the top of whatever scrolls -- clear of the preview's own
            sticky search row. */}
        <div className="pointer-events-auto sticky top-24">
          {railNode}
        </div>
      </div>
    )
  }

  if (!railRendersThroughPortal(edge)) return railNode

  return typeof document === 'undefined' ? railNode : createPortal(railNode, document.body)
}
