// Owner, 25 Sep 2026 (Products page, large screens): the barcode / brand /
// category chips showed "visible scroll arrows and a scrollbar track". Chip
// scrolling has to be built in and invisible -- no arrows, no track -- and
// still reachable by wheel, touch and drag, on every screen size and every
// list that uses the same scroller.
//
// The arrows were the platform scrollbar of `.detail-scroll-text`
// (styles/main.css), which asked for `scrollbar-width: thin` and a 3px
// WebKit bar: on Windows Chrome that draws a track WITH stepper arrows inside
// a chip a few pixels taller than the bar itself. That CSS now hides the bar
// the way `.scroll-x-clean` (the product-name scroller) already did.
//
// Hiding the bar removes the only thing a MOUSE could grab. Touch pans
// natively, and a trackpad or a shift+wheel scrolls natively; a plain mouse
// needs a drag. This runtime is that drag, once, for every scroller that
// carries either shared class -- no per-site wiring to forget on the next
// list.
//
// The drag must not ALSO be a click. A product row opens the product on the
// press's release (utils/longPress.ts) and a chip is a link, so:
//   - it only starts past the same 18px move tolerance the row uses to decide
//     a press was not a tap (LONG_PRESS_MOVE_TOLERANCE_PX), so the row has
//     already cancelled its own tap by the time anything scrolls;
//   - the click that follows a real drag is swallowed at `window` capture,
//     ahead of every document-level listener (the copy float included);
//   - a link inside the scroller is not dragged out as a URL (`dragstart`).
// A vertical wheel is deliberately NOT turned sideways: these chips sit in
// vertically scrolling lists, and hijacking the wheel over a chip would stop
// the list scrolling wherever the pointer happens to rest on one.
import { LONG_PRESS_MOVE_TOLERANCE_PX } from '../utils/longPress.ts'

export const DRAG_SCROLL_SELECTOR = '.detail-scroll-text, .scroll-x-clean'

export interface ScrollerLike {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
  parentElement?: ScrollerLike | null
  closest?: (selector: string) => ScrollerLike | null
}

/** The innermost shared scroller around `target` that actually overflows. */
export function findDragScroller(target: unknown, selector = DRAG_SCROLL_SELECTOR): ScrollerLike | null {
  let node = target as ScrollerLike | null
  while (node && typeof node.closest === 'function') {
    const match = node.closest(selector)
    if (!match) return null
    if (match.scrollWidth > match.clientWidth + 1) return match
    node = match.parentElement ?? null
  }
  return null
}

export interface DragPointer {
  pointerType?: string
  button?: number
  clientX: number
  target?: unknown
}

export interface DragScrollController {
  down: (event: DragPointer) => void
  /** Returns true while a drag is scrolling (the caller clears any selection). */
  move: (event: DragPointer) => boolean
  up: () => void
  /** True once, for the click that follows a real drag. */
  consumeClick: () => boolean
  tracking: () => boolean
}

export function createDragScrollController(tolerancePx = LONG_PRESS_MOVE_TOLERANCE_PX): DragScrollController {
  let scroller: ScrollerLike | null = null
  let anchorX = 0
  let anchorScroll = 0
  let dragging = false
  let swallowNextClick = false
  return {
    down(event) {
      scroller = null
      dragging = false
      swallowNextClick = false
      // Touch and pen pan natively; only a mouse needs the help.
      if (event.pointerType !== 'mouse' || (event.button ?? 0) !== 0) return
      scroller = findDragScroller(event.target)
      anchorX = event.clientX
      anchorScroll = scroller ? scroller.scrollLeft : 0
    },
    move(event) {
      if (!scroller) return false
      if (!dragging) {
        if (Math.abs(event.clientX - anchorX) <= tolerancePx) return false
        // Re-anchor at the crossing so the content does not jump by the
        // tolerance the moment the drag engages.
        dragging = true
        anchorX = event.clientX
        anchorScroll = scroller.scrollLeft
      }
      scroller.scrollLeft = anchorScroll - (event.clientX - anchorX)
      return true
    },
    up() {
      if (dragging) swallowNextClick = true
      scroller = null
      dragging = false
    },
    consumeClick() {
      if (!swallowNextClick) return false
      swallowNextClick = false
      return true
    },
    tracking: () => scroller !== null,
  }
}

export function installHorizontalDragScroll(win: Window = window): () => void {
  const controller = createDragScrollController()
  const capture: AddEventListenerOptions = { capture: true }
  const passive: AddEventListenerOptions = { capture: true, passive: true }
  const onDown = (event: PointerEvent) => controller.down(event)
  const onMove = (event: PointerEvent) => {
    if (controller.move(event)) win.getSelection?.()?.removeAllRanges()
  }
  const onUp = () => controller.up()
  const onClick = (event: MouseEvent) => {
    if (!controller.consumeClick()) return
    event.stopPropagation()
    event.preventDefault()
  }
  // A mouse press on a chip link would otherwise start the browser's own
  // link drag, which cancels the pointer stream mid-scroll.
  const onDragStart = (event: DragEvent) => {
    if (controller.tracking()) event.preventDefault()
  }
  win.addEventListener('pointerdown', onDown, passive)
  win.addEventListener('pointermove', onMove, passive)
  win.addEventListener('pointerup', onUp, passive)
  win.addEventListener('pointercancel', onUp, passive)
  win.addEventListener('click', onClick, capture)
  win.addEventListener('dragstart', onDragStart, capture)
  return () => {
    win.removeEventListener('pointerdown', onDown, passive)
    win.removeEventListener('pointermove', onMove, passive)
    win.removeEventListener('pointerup', onUp, passive)
    win.removeEventListener('pointercancel', onUp, passive)
    win.removeEventListener('click', onClick, capture)
    win.removeEventListener('dragstart', onDragStart, capture)
  }
}
