// Reusable click-and-hold detector for entering "select mode" on a list
// row (Products page, part 77 ask) -- works for both mouse (click-and-
// hold) and touch (long-press) without a third-party gesture library.
//
// Deliberately NOT a React hook (no `use` prefix): a product row is
// rendered by calling renderDesktopProductRow/renderMobileProductCard
// once per visible row inside a .map() (see ProductsListSurface.tsx),
// not by mounting a separate component per row -- calling a hook
// (useRef/useState/etc.) from inside that per-row call would violate
// the Rules of Hooks (the number of hook calls in one component render
// would vary with the visible row count). Instead, the caller owns one
// persistent mutable slot per row (a `Map<rowId, LongPressState>` held
// in a single `useRef` at the page component's top level, see
// Products.tsx) and passes that row's slot in here; everything below
// just reads/writes plain fields on it, no hooks involved.
export interface LongPressState {
  timerId: number | null
  startX: number
  startY: number
  fired: boolean
  // Set when a move past moveTolerancePx cancels a pending press (see
  // `cancel()`/`checkMove()` below). Distinct from `fired`: a cancelled
  // press never fires onLongPress, so `fired` stays false and `end()`
  // would otherwise read that as an ordinary tap and fire onClick for a
  // drag/scroll that was neither a tap nor a hold. Cleared on the next
  // `start()` and consumed (reset to false) by `end()`.
  cancelled: boolean
}

export function createLongPressState(): LongPressState {
  return { timerId: null, startX: 0, startY: 0, fired: false, cancelled: false }
}

// Guards against the "ghost click" that follows a fired long-press.
//
// Root cause: `onLongPress` fires mid-hold, from inside the setTimeout in
// `start()` below, while the mouse/finger is still down. If the caller
// reacts to that by changing the row's own props on the SAME element
// (e.g. Products.tsx enters select mode, which switches the row's
// `onClick` from `undefined` to a toggle-selection handler), the browser
// still fires a native `click` event once the press is released -- a
// mousedown+mouseup (or touchstart+touchend) pair on one element always
// produces a `click` afterward, no matter how long the hold lasted or
// what happened to that element's handlers in between. That native click
// lands on the row's now-different `onClick` and immediately reverses
// whatever the long-press just did (e.g. toggles the just-selected row
// back off), which reads as "select mode auto-exits immediately" -- see
// Products.tsx's `renderDesktopProductRow`/`renderMobileProductCard`.
//
// A drag to a different row masks the bug rather than avoiding it: once
// `checkMove` cancels the pending timer, `onLongPress` never fires at
// all for that press, so there's nothing for the ghost click to reverse
// -- not evidence the gesture is working, just a different way to avoid
// hitting it.
//
// Fix: `state.fired` already flips true when `onLongPress` runs (see
// `start()`), but it can only be reset by `end()`, which is also on this
// same handlers object -- once a caller detaches these handlers in
// response to `onLongPress` (as Products.tsx does), `end()` never runs
// and `fired` would stay stuck true. This lets a caller's OWN click
// handler consume that flag directly: call it first thing inside the
// handler that would otherwise re-toggle the row, and skip the toggle
// when it returns true (it also resets `fired`, so the next ordinary
// click on that row behaves normally).
export function consumeLongPressClick(state: LongPressState): boolean {
  if (!state.fired) return false
  state.fired = false
  return true
}

export interface LongPressHandlers {
  onMouseDown: (event: React.MouseEvent) => void
  onMouseUp: () => void
  onMouseLeave: () => void
  onTouchStart: (event: React.TouchEvent) => void
  onTouchEnd: () => void
  onTouchMove: (event: React.TouchEvent) => void
  onContextMenu: (event: React.MouseEvent) => void
}

interface LongPressOptions {
  onLongPress: () => void
  onClick?: () => void
  thresholdMs?: number
  moveTolerancePx?: number
  // Skip the whole gesture -- e.g. selection mode is already active, so
  // the row's own onClick should select/deselect immediately instead of
  // going through this at all (see Products.tsx's row click handler,
  // which bypasses these handlers entirely once selectionModeActive).
  disabled?: boolean
}

// Behavior: press-and-hold past `thresholdMs` without releasing or
// moving past `moveTolerancePx` fires `onLongPress`; a release before
// the threshold, or a move past the tolerance (a scroll/drag, not a
// hold), fires `onClick` instead and cancels the pending long-press.
// Only one of the two ever fires per press.
//
// moveTolerancePx default raised from 10 to 18 (Aug 22 2026 ask --
// "smaller screens... could not easily access the click to view
// detail"). 10px matches a mouse's precision, not a finger's: touch
// input routinely reports 10-15px of jitter on a single tap even when
// the person's intent was a plain stationary tap, no drag/scroll
// involved -- checkMove()'s dx/dy check was reading that jitter as a
// drag and calling cancel(), which suppresses BOTH onLongPress and
// onClick for that press (see cancel()'s own comment), so the tap
// silently did nothing. 18px keeps genuine scroll/drag gestures (which
// move tens of pixels before the finger settles) working exactly the
// same, while giving an ordinary tap enough slack to register.
export function createLongPressHandlers(
  state: LongPressState,
  { onLongPress, onClick, thresholdMs = 500, moveTolerancePx = 18, disabled = false }: LongPressOptions,
): LongPressHandlers {
  const clearTimer = () => {
    if (state.timerId != null) {
      window.clearTimeout(state.timerId)
      state.timerId = null
    }
  }

  const start = (x: number, y: number) => {
    if (disabled) return
    state.fired = false
    state.cancelled = false
    state.startX = x
    state.startY = y
    clearTimer()
    state.timerId = window.setTimeout(() => {
      state.fired = true
      onLongPress()
    }, thresholdMs)
  }

  const end = () => {
    clearTimer()
    if (state.fired) {
      // Long-press already fired -- this release is just the follow-up
      // mouseup/touchend, not a separate click.
      state.fired = false
      return
    }
    if (state.cancelled) {
      // Moved past tolerance before the threshold -- a drag/scroll, not
      // a tap or a hold. Neither onLongPress nor onClick should fire.
      state.cancelled = false
      return
    }
    if (!disabled) onClick?.()
  }

  const cancel = () => {
    clearTimer()
    state.fired = false
    state.cancelled = true
  }

  const checkMove = (x: number, y: number) => {
    const dx = Math.abs(x - state.startX)
    const dy = Math.abs(y - state.startY)
    if (dx > moveTolerancePx || dy > moveTolerancePx) cancel()
  }

  return {
    onMouseDown: (event) => start(event.clientX, event.clientY),
    onMouseUp: () => end(),
    onMouseLeave: () => cancel(),
    onTouchStart: (event) => {
      const touch = event.touches[0]
      if (touch) start(touch.clientX, touch.clientY)
    },
    onTouchEnd: () => end(),
    onTouchMove: (event) => {
      const touch = event.touches[0]
      if (touch) checkMove(touch.clientX, touch.clientY)
    },
    // Suppress the browser's own right-click/long-press context menu
    // while this gesture is live, so it doesn't pop up alongside (or
    // instead of) entering select mode.
    onContextMenu: (event) => {
      if (state.timerId != null || state.fired) event.preventDefault()
    },
  }
}
