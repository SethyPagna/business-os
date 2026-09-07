// The ONE text-affordance layer: a single floating panel that either reveals
// a clipped value in full, or offers to copy it.
//
// Why one delegated controller instead of per-cell React state.
//
// Two gaps were open at 6e3abfea and they are the same gap twice:
//   1. Nothing copied a product NAME, BRAND, SUPPLIER or BARCODE anywhere.
//      The only clipboard writes were ids (CopyableId), files, the share
//      link, the password manager, and one plain-click barcode button in
//      products/surfaces/ProductDetailModal.tsx. No surface offered
//      double-click or long-press at all -- the three `onDoubleClick`
//      handlers in src/ are two layout resets and a lightbox zoom.
//   2. `.dense-cell-truncate` cells (Stock Changes, Stock-in Sessions,
//      Returns, Fees) reveal their full value through the native `title`
//      attribute, which is a hover tooltip -- i.e. nothing at all on a
//      touch screen, where the ellipsis is a dead end.
//
// Fixing (2) per-cell would mean editing every dense surface, several of
// which are owned by other lanes in flight. A single document-level
// delegated controller reaches every `.dense-cell-truncate[title]` cell
// that exists now or is added later, with zero edits to those files, and
// -- critically -- it is the SAME code path `TruncatedText` mounts, so
// there is one implementation of "show me the rest of this text", not two.
// `CopyFloat` marks its trigger with `data-copy-value` and mounts the same
// controller, so there is one float, one placement calculation, one
// dismiss/Escape/reposition contract, one z-layer.
//
// Plain DOM rather than React on purpose: the panel has to be able to open
// over a cell on a surface that never imported anything from this lane, so
// it cannot depend on a React host being mounted somewhere up the tree.
// `ensureTextAffordances()` is idempotent and creates its own body-level
// host on first call.
//
// The one thing delegation must NOT do is quietly change those surfaces'
// behaviour while it is reaching into them. On all four dense tables the
// truncated cells sit inside a row that opens the record when clicked, so
// the reveal defers there (see `claimsClick`): a tooltip is a poor trade for
// a detail view that shows the same value plus the rest of the record. It
// takes the CLICK only where nothing underneath wanted it.
//
// That leaves the reveal reachable by hover on a pointer device and by
// press-and-hold on touch -- the one gesture those rows do not already use
// -- which is the half of gap (2) a hover fixes nothing about. Both are
// additive: the tap still opens the record.
import { createLongPressHandlers, createLongPressState } from '../../utils/longPress.ts'

export const COPY_ATTR = 'data-copy-value'
export const REVEAL_ATTR = 'data-reveal-text'
export const COPY_SELECTOR = '[data-copy-value]'
// While the styled panel is open the native `title` is parked here so the
// browser's own tooltip does not stack on top of it (see `parkTitle`). It
// belongs in the SELECTOR, not just in a stash: a dense cell whose only
// opt-in was that `title` stops matching the moment its panel opens, and
// then every later event on it -- the mouseout that should close the panel,
// a re-hover, a click -- resolves to no target at all and the float hangs.
export const TITLE_PARK_ATTR = 'data-affordance-title'
// A cell opts in either explicitly (TruncatedText, and anything that wants
// the reveal without the dense-table styling) or by already carrying the
// dense-table truncation contract plus the `title` it was relying on --
// parked or not.
export const REVEAL_SELECTOR = `[data-reveal-text], .dense-cell-truncate[title], .dense-cell-truncate[${TITLE_PARK_ATTR}]`
// Ancestors whose OWN click is the point of the surface. The dense tables
// already mark them: main.css styles `tr[data-clickable='true']` with a
// pointer cursor and a hover tint, and all four dense surfaces set it on the
// row that opens a detail view. Native interactive elements count too (the
// Stock-in Sessions line table wraps its product cell in a <button>).
export const SURFACE_CLICK_SELECTOR = '[data-clickable="true"], a[href], button, [role="button"]'

export type AffordanceKind = 'copy' | 'reveal'

/* ------------------------------------------------------------------ *
 * Pure core (unit-tested in frontend/tests/copyFloat.test.ts and
 * frontend/tests/truncatedText.test.ts -- no DOM required).
 * ------------------------------------------------------------------ */

export interface ClipBox { scrollWidth: number; clientWidth: number }

// Clipped when the rendered content is wider than the box showing it. The
// +1 tolerance ignores sub-pixel rounding that would otherwise flag text
// that visually fits (carried over from the original TruncatedText).
export function isClipped(box: ClipBox): boolean {
  return box.scrollWidth > box.clientWidth + 1
}

export type ClosestFn = (selector: string) => unknown

// Copy beats reveal: a field that can be copied shows the copy panel even
// when it is also clipped, so one element never offers two different floats.
export function resolveAffordanceTarget(closest: ClosestFn): { element: unknown; kind: AffordanceKind } | null {
  const copy = closest(COPY_SELECTOR)
  if (copy) return { element: copy, kind: 'copy' }
  const reveal = closest(REVEAL_SELECTOR)
  if (reveal) return { element: reveal, kind: 'reveal' }
  return null
}

// Whose click is it?
//
// ONE rule, both kinds: an affordance takes the click only when nothing
// underneath it wanted that click.
//
// The delegated reveal reaches `.dense-cell-truncate[title]` cells on
// surfaces this lane never edited -- and on four of them (Stock Changes,
// Stock-in Sessions, Returns, Fees) those cells sit inside a row whose own
// click opens the record's detail view. Swallowing the tap there to show a
// tooltip would be a straight downgrade: the detail view shows the same
// value in full, plus everything else about the record.
//
// A copy field is not an exception to that, though the first cut of this
// lane made it one. On the Products list the copyable fields sit inside the
// product row, whose click TOGGLES SELECTION while select mode is active
// (Products.tsx renderDesktopProductRow / renderMobileProductCard). A copy
// field that claims the click there does not add an affordance, it deletes
// one: the row stops being selectable wherever a copyable value happens to
// be drawn. So a copy field inside a clickable surface answers the gestures
// the surface does NOT use -- double-click on a pointer device,
// press-and-hold on touch -- and leaves the plain click to the row.
//
// Where nothing underneath wants it (the two product detail modals, the
// StatsStrip labels, the Stock-in line rows) a plain click opens the panel,
// which is the user's Aug 31 rule -- "if it is too long and used '...' then
// when click or hover it should show info" -- applied to the cells where a
// click was doing nothing at all.
export function claimsClick(_kind: AffordanceKind, insideClickableSurface: boolean): boolean {
  return !insideClickableSurface
}

// The delegated reveal replaces the browser's native `title` tooltip, which
// waits before it appears. Opening instantly would flash a panel under the
// pointer for every cell crossed while sweeping a dense table, so hover
// keeps roughly the native dwell. Click, double-click and long-press are
// deliberate and open with no delay.
export const HOVER_OPEN_DELAY_MS = 450
export const COPY_DOUBLE_CLICK_WINDOW_MS = 250

// A Products row opens from the short-release callback in longPress.ts,
// before the browser can dispatch `dblclick`. Only presses that begin on a
// copy trigger are deferred. The controller cancels the pending row action
// when the second click becomes a double-click; a single click runs normally
// after the platform's double-click window.
const deferredCopySurfaceActions = new WeakMap<object, ReturnType<typeof setTimeout>>()

export function cancelDeferredCopySurfaceAction(element: object): void {
  const timer = deferredCopySurfaceActions.get(element)
  if (timer != null) clearTimeout(timer)
  deferredCopySurfaceActions.delete(element)
}

export function deferCopySurfaceAction(element: object, action: () => void): void {
  cancelDeferredCopySurfaceAction(element)
  const timer = setTimeout(() => {
    deferredCopySurfaceActions.delete(element)
    action()
  }, COPY_DOUBLE_CLICK_WINDOW_MS)
  deferredCopySurfaceActions.set(element, timer)
}

export interface TriggerRect { left: number; top: number; bottom: number }
export interface FloatViewport { innerWidth: number; innerHeight: number }
export interface FloatPlacement {
  left: number
  top: number
  width: number
  maxHeight: number
  placement: 'above' | 'below'
}

// Same geometry the per-cell TruncatedText tooltip used, kept identical so
// the panel lands where it always did: 8px gutter from the viewport edge,
// 6px gap from the trigger, 288px cap, never narrower than 160px, flipped
// above the trigger only when below is both short (<96px) and the worse of
// the two.
export function placeFloat(trigger: TriggerRect, viewport: FloatViewport): FloatPlacement {
  const gutter = 8
  const gap = 6
  const cap = 288
  const width = Math.min(cap, Math.max(160, viewport.innerWidth - gutter * 2))
  const left = Math.min(viewport.innerWidth - width - gutter, Math.max(gutter, trigger.left))
  const roomBelow = viewport.innerHeight - trigger.bottom - gap - gutter
  const roomAbove = trigger.top - gap - gutter
  const placement: 'above' | 'below' = roomBelow >= 96 || roomBelow >= roomAbove ? 'below' : 'above'
  const maxHeight = Math.max(56, Math.min(cap, placement === 'below' ? roomBelow : roomAbove))
  const top = placement === 'below'
    ? Math.min(viewport.innerHeight - gutter, trigger.bottom + gap)
    : Math.max(gutter, trigger.top - gap)
  return { left, top, width, maxHeight, placement }
}

export type FloatReason = 'hover' | 'click' | 'gesture'
export interface FloatState<E = unknown> { element: E; kind: AffordanceKind; reason: FloatReason }
export type FloatIntent<E = unknown> =
  | { type: 'hover-in'; element: E; kind: AffordanceKind }
  | { type: 'hover-out'; element: E }
  | { type: 'click'; element: E; kind: AffordanceKind }
  | { type: 'gesture'; element: E; kind: AffordanceKind }
  | { type: 'dismiss' }

// The open/close rule, in one place.
//
// The case that makes this a reducer rather than a pair of handlers: on a
// touch screen a tap fires a SYNTHETIC mouseover on the tapped element
// immediately before the click, and a synthetic mouseout when the finger
// next lands elsewhere. Handling hover and click independently means the
// panel opens on the synthetic mouseover and then the click toggles the
// very same panel shut -- one tap, no reveal. So a click on an element that
// is already open by hover UPGRADES the reason instead of closing, and a
// hover-out only closes a panel that hover itself opened. A second
// deliberate click on the same element still closes it.
export function nextFloatState<E>(current: FloatState<E> | null, intent: FloatIntent<E>): FloatState<E> | null {
  switch (intent.type) {
    case 'hover-in':
      if (current && current.element === intent.element) return current
      return { element: intent.element, kind: intent.kind, reason: 'hover' }
    case 'hover-out':
      if (current && current.element === intent.element && current.reason === 'hover') return null
      return current
    case 'click':
      if (current && current.element === intent.element && current.reason === 'click') return null
      return { element: intent.element, kind: intent.kind, reason: 'click' }
    case 'gesture':
      return { element: intent.element, kind: intent.kind, reason: 'gesture' }
    case 'dismiss':
      return null
    default:
      return current
  }
}

/* ------------------------------------------------------------------ *
 * The singleton controller.
 * ------------------------------------------------------------------ */

export interface AffordanceLabels {
  /** "Copy" -- the panel's copy button. */
  copy: string
  /** "Copied" -- the confirmation that replaces it for ~1.6s. */
  copied: string
}

const COPIED_RESET_MS = 1600

let installed = false
let labels: AffordanceLabels = { copy: 'Copy', copied: 'Copied' }
let state: FloatState<HTMLElement> | null = null
let host: HTMLDivElement | null = null
let valueNode: HTMLSpanElement | null = null
let copyButton: HTMLButtonElement | null = null
let liveNode: HTMLSpanElement | null = null
let copiedTimer: ReturnType<typeof setTimeout> | null = null
let hoverTimer: ReturnType<typeof setTimeout> | null = null
const pressState = createLongPressState()
let pressElement: HTMLElement | null = null
// Which affordance armed the live press -- a copy field, or a clipped cell
// whose only reveal on a touch screen is the hold.
let pressKind: AffordanceKind = 'copy'
// Touch browsers dispatch compatibility mouse events immediately after a
// touch sequence. Those events describe the touch just handled; treating the
// synthetic mousedown as a new outside press dismissed the panel opened by a
// long-press before the user could use it.
let ignoreCompatibilityMouseUntil = 0
const COMPATIBILITY_MOUSE_WINDOW_MS = 800
const isCompatibilityMouse = (): boolean => Date.now() < ignoreCompatibilityMouseUntil

const textFor = (element: HTMLElement, kind: AffordanceKind): string => (
  kind === 'copy'
    ? String(element.getAttribute(COPY_ATTR) || '')
    : String(element.getAttribute(REVEAL_ATTR) || element.getAttribute('title') || element.getAttribute(TITLE_PARK_ATTR) || element.textContent || '')
).trim()

const parkTitle = (element: HTMLElement): void => {
  const title = element.getAttribute('title')
  if (title == null) return
  element.setAttribute(TITLE_PARK_ATTR, title)
  element.removeAttribute('title')
}

const restoreTitle = (element: HTMLElement): void => {
  const parked = element.getAttribute(TITLE_PARK_ATTR)
  if (parked == null) return
  element.setAttribute('title', parked)
  element.removeAttribute(TITLE_PARK_ATTR)
}

const buildHost = (): void => {
  if (host) return
  host = document.createElement('div')
  host.className = 'text-affordance-float'
  host.setAttribute('role', 'tooltip')
  host.hidden = true
  valueNode = document.createElement('span')
  valueNode.className = 'text-affordance-value'
  copyButton = document.createElement('button')
  copyButton.type = 'button'
  copyButton.className = 'text-affordance-copy'
  copyButton.hidden = true
  liveNode = document.createElement('span')
  liveNode.className = 'sr-only'
  liveNode.setAttribute('aria-live', 'polite')
  host.append(valueNode, copyButton, liveNode)
  copyButton.addEventListener('click', (event) => {
    event.stopPropagation()
    runCopy()
  })
  document.body.appendChild(host)
}

const runCopy = (): void => {
  if (!state || state.kind !== 'copy' || !copyButton || !liveNode) return
  const text = textFor(state.element, 'copy')
  if (!text || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return
  void navigator.clipboard.writeText(text)
    .then(() => {
      if (!copyButton || !liveNode) return
      copyButton.textContent = labels.copied
      copyButton.dataset.copied = 'true'
      liveNode.textContent = labels.copied
      if (copiedTimer) clearTimeout(copiedTimer)
      copiedTimer = setTimeout(() => {
        if (!copyButton || !liveNode) return
        copyButton.textContent = labels.copy
        delete copyButton.dataset.copied
        liveNode.textContent = ''
      }, COPIED_RESET_MS)
    })
    // A blocked clipboard still leaves the value selectable in the panel.
    .catch(() => { /* no-op */ })
}

const position = (): void => {
  if (!state || !host) return
  const rect = state.element.getBoundingClientRect()
  const at = placeFloat(rect, { innerWidth: window.innerWidth, innerHeight: window.innerHeight })
  host.style.left = `${at.left}px`
  host.style.top = `${at.top}px`
  host.style.width = `${at.width}px`
  host.style.maxHeight = `${at.maxHeight}px`
  host.style.transform = at.placement === 'above' ? 'translateY(-100%)' : ''
}

const render = (previous: FloatState<HTMLElement> | null): void => {
  if (!host || !valueNode || !copyButton || !liveNode) return
  if (previous && previous.element !== state?.element) restoreTitle(previous.element)
  if (!state) {
    if (previous) restoreTitle(previous.element)
    host.hidden = true
    copyButton.hidden = true
    liveNode.textContent = ''
    return
  }
  parkTitle(state.element)
  valueNode.textContent = textFor(state.element, state.kind)
  if (state.kind === 'copy') {
    copyButton.hidden = false
    copyButton.textContent = labels.copy
    delete copyButton.dataset.copied
  } else {
    copyButton.hidden = true
  }
  liveNode.textContent = ''
  host.hidden = false
  position()
}

const cancelHover = (): void => {
  if (hoverTimer) clearTimeout(hoverTimer)
  hoverTimer = null
}

const apply = (intent: FloatIntent<HTMLElement>): void => {
  // Any deliberate intent supersedes a hover that has not opened yet, so a
  // pending dwell can never re-open the panel a click just closed.
  if (intent.type !== 'hover-in') cancelHover()
  const previous = state
  const next = nextFloatState(previous, intent)
  if (next === previous) return
  state = next
  render(previous)
}

const targetFrom = (node: EventTarget | null): { element: HTMLElement; kind: AffordanceKind } | null => {
  const el = node as Element | null
  if (!el || typeof el.closest !== 'function') return null
  const found = resolveAffordanceTarget((selector) => el.closest(selector))
  if (!found) return null
  return { element: found.element as HTMLElement, kind: found.kind }
}

// A reveal only earns a panel when the text is actually cut off; an
// un-clipped cell must stay a plain cell so the row's own click still opens
// the row. A copy field always earns one -- it is explicitly opted in.
const eligible = (found: { element: HTMLElement; kind: AffordanceKind }): boolean => (
  found.kind === 'copy' || isClipped(found.element)
)

const insideFloat = (node: EventTarget | null): boolean => (
  !!host && node instanceof Node && host.contains(node)
)

// `parentElement` first, never the element itself: TruncatedText gives a
// clipped span `role="button"`, and asking whether the trigger is its own
// clickable surface would make every one of them defer to nothing.
const insideClickableSurface = (element: HTMLElement): boolean => (
  !!element.parentElement?.closest(SURFACE_CLICK_SELECTOR)
)

// Does the click this press is the start of belong to the float?
//
// If it does, the press must leave the open panel alone so the click that
// follows can toggle it shut. If it does NOT -- a hover-opened cell inside a
// row that is about to open its detail view -- the panel has to go on the
// press, or it hangs on the z-1200 layer above the view that just opened,
// pointing at a cell that view has covered.
const pressWillOpenFloat = (found: { element: HTMLElement; kind: AffordanceKind } | null): boolean => (
  !!found && eligible(found) && claimsClick(found.kind, insideClickableSurface(found.element))
)

export function ensureTextAffordances(next?: Partial<AffordanceLabels>): void {
  if (next) {
    labels = { ...labels, ...next }
    if (state?.kind === 'copy' && copyButton && !copyButton.dataset.copied) copyButton.textContent = labels.copy
  }
  if (installed || typeof document === 'undefined') return
  installed = true
  buildHost()

  // ONE press detector for both input kinds -- the same utils/longPress.ts
  // the Products row uses, so "press and hold" means the same duration and
  // the same move tolerance whether it lands on a copy field or on the row
  // around it. Declared before the listeners because `mouseout` cancels a
  // press that has wandered off its trigger.
  const press = createLongPressHandlers(pressState, {
    onLongPress: () => {
      // Whatever armed the press is what the hold opens. Hardcoding 'copy'
      // here was one of the two fences that kept press-and-hold away from a
      // clipped dense cell, where it is the only reveal a phone has.
      if (pressElement) apply({ type: 'gesture', element: pressElement, kind: pressKind })
    },
  })
  type MouseArg = Parameters<typeof press.onMouseDown>[0]
  type TouchArg = Parameters<typeof press.onTouchStart>[0]

  // Capture phase throughout: React attaches its listeners on the root
  // container, so stopping propagation here is what keeps a claimed tap from
  // ALSO firing the surface's own click handler, and what keeps a press on a
  // copy field from starting the Products row's long-press select-mode timer
  // (Products.tsx synthesises its row click from mouseup/touchend via
  // utils/longPress.ts, so swallowing `click` alone would not be enough).
  //
  // A click the float does NOT claim is left completely alone -- not
  // stopped, not defaulted -- so the row underneath behaves exactly as it
  // did before this lane existed.
  //
  // Every exit from here disarms a pending dwell first. A tap fires a
  // SYNTHETIC mouseover before its click, and on the dense rows the click is
  // declined -- so the 450ms timer that mouseover armed used to survive the
  // whole gesture and open the panel a third of a second later, on the z-1200
  // layer above the record the tap had just opened, pointing at a cell that
  // view now covers. Declining the click means declining the reveal.
  document.addEventListener('click', (event) => {
    if (isCompatibilityMouse()) return
    if (insideFloat(event.target)) return
    const found = targetFrom(event.target)
    if (!found || !eligible(found)) { cancelHover(); return }
    if (!claimsClick(found.kind, insideClickableSurface(found.element))) { cancelHover(); return }
    event.stopPropagation()
    apply({ type: 'click', element: found.element, kind: found.kind })
  }, true)

  document.addEventListener('dblclick', (event) => {
    if (isCompatibilityMouse()) return
    const found = targetFrom(event.target)
    if (!found || found.kind !== 'copy') return
    cancelDeferredCopySurfaceAction(found.element)
    event.stopPropagation()
    // Otherwise the browser selects the word under the pointer behind the
    // panel that is about to cover it.
    event.preventDefault()
    apply({ type: 'gesture', element: found.element, kind: 'copy' })
  }, true)

  document.addEventListener('mouseover', (event) => {
    if (isCompatibilityMouse()) return
    if (insideFloat(event.target)) return
    const found = targetFrom(event.target)
    if (!found || found.kind !== 'reveal' || !eligible(found)) return
    if (state?.element === found.element) return
    cancelHover()
    hoverTimer = setTimeout(() => {
      hoverTimer = null
      apply({ type: 'hover-in', element: found.element, kind: 'reveal' })
    }, HOVER_OPEN_DELAY_MS)
  })

  document.addEventListener('mouseout', (event) => {
    if (isCompatibilityMouse()) return
    const to = event.relatedTarget
    // A pointer that leaves the element it is pressing is dragging, not
    // holding, so the pending hold dies with it (the same call the Products
    // row makes from its own onMouseLeave).
    if (pressElement && !(to instanceof Node && pressElement.contains(to))) {
      press.onMouseLeave()
      pressElement = null
    }
    if (insideFloat(to)) return
    const found = targetFrom(event.target)
    if (!found) return
    // Moving onto a child of the same trigger is not leaving it.
    if (to instanceof Node && found.element.contains(to)) return
    cancelHover()
    apply({ type: 'hover-out', element: found.element })
  })

  document.addEventListener('mousedown', (event) => {
    if (isCompatibilityMouse()) return
    if (insideFloat(event.target)) return
    // A pointer that has come down is no longer dwelling, whatever happens to
    // the press next. Only `apply()` used to disarm the dwell, and the paths
    // below that hand the press back to the surface never call it.
    cancelHover()
    const found = targetFrom(event.target)
    // ONE ownership rule, at every entry point -- the press included.
    //
    // An earlier cut of this lane stopped the press for EVERY copy field on
    // the theory that a `click` still dispatches afterwards, so the row
    // would lose nothing. On the Products list the row's click is not where
    // its behaviour lives: outside selection mode `onClick` is `undefined`
    // and the row spreads utils/longPress.ts's onMouseDown/onMouseUp
    // instead (Products.tsx renderDesktopProductRow / renderMobileProductCard,
    // `{...(selectionModeActive ? {} : longPress)}`) -- a tap opens the
    // product and a hold enters select mode, both synthesised from the
    // press. Swallowing mousedown/mouseup there deleted BOTH, wherever a
    // copyable value happened to be drawn.
    //
    // So the press goes to whoever owns the click: `pressWillOpenFloat` is
    // that same rule, and inside a clickable surface it is false, which
    // leaves the row every event it had before this lane existed.
    //
    // Where it DOES take the press, it has to do something with it: the hint
    // on every trigger ("Double-click or hold to copy") promises a hold, and
    // a pointer device only gets one if the press is armed here. Touch
    // already routed through the same detector below.
    if (found?.kind === 'copy' && pressWillOpenFloat(found)) {
      event.stopPropagation()
      pressElement = found.element
      pressKind = found.kind
      press.onMouseDown(event as unknown as MouseArg)
      return
    }
    pressElement = null
    if (state && !pressWillOpenFloat(found)) apply({ type: 'dismiss' })
  }, true)

  document.addEventListener('mouseup', (event) => {
    if (isCompatibilityMouse()) return
    if (!pressElement) return
    event.stopPropagation()
    // A release before the threshold cancels the pending hold; the `click`
    // that follows opens the panel through the ownership rule instead.
    press.onMouseUp()
    pressElement = null
  }, true)

  document.addEventListener('touchstart', (event) => {
    if (insideFloat(event.target)) return
    // Same as `mousedown`: a finger on the glass ends any dwell, including
    // the synthetic one a previous tap left behind.
    cancelHover()
    ignoreCompatibilityMouseUntil = Date.now() + COMPATIBILITY_MOUSE_WINDOW_MS
    const found = targetFrom(event.target)
    // Touch is the one place an affordance takes the hold even inside a
    // surface that owns its own, and for both kinds it is the same argument:
    // press-and-hold is the ONLY gesture a phone has spare, and one hold
    // cannot both answer the affordance and enter the Products row's select
    // mode. It takes the hold, not the tap -- see `touchend`.
    //
    //   - copy: press-and-hold is the only way to copy on a phone at all.
    //   - reveal: a clipped `.dense-cell-truncate` cell publishes its full
    //     value through a `title`, i.e. a HOVER tooltip, i.e. nothing on a
    //     touch screen. Stock Changes, Stock-in Sessions, Returns and Fees
    //     gain the reveal here with no edit to any of those files -- and
    //     strictly additively, because the tap they already answered still
    //     reaches the row.
    //
    // `eligible` is exactly that pair of rules already: a copy field always
    // qualifies, a reveal only while its text is actually cut off. A cell
    // whose text FITS keeps the row every touch it had, and so does any
    // other target inside it.
    if (found && eligible(found)) {
      event.stopPropagation()
      // The press does not re-open a panel it is about to cover, but it must
      // not leave a DIFFERENT one floating over the record either.
      if (state && state.element !== found.element) apply({ type: 'dismiss' })
      pressElement = found.element
      pressKind = found.kind
      press.onTouchStart(event as unknown as TouchArg)
      return
    }
    pressElement = null
    if (state && !pressWillOpenFloat(found)) apply({ type: 'dismiss' })
  }, true)

  document.addEventListener('touchmove', (event) => {
    if (!pressElement) return
    // The move has to be swallowed for exactly the same reason the start
    // was. A detector that never saw the touchstart still has its start
    // point at (0, 0), and utils/longPress.ts's checkMove measures the
    // finger against THAT: the first pixel of tap jitter reads as a drag
    // hundreds of pixels past the 18px tolerance, so the row cancels its own
    // press and the release that follows fires nothing. Tapping a supplier
    // pill, a brand chip or a product name simply did not open the product.
    // Mirror the swallow: whoever did not get the start does not get the
    // moves either.
    event.stopPropagation()
    press.onTouchMove(event as unknown as TouchArg)
  }, true)

  document.addEventListener('touchend', (event) => {
    if (!pressElement) return
    ignoreCompatibilityMouseUntil = Date.now() + COMPATIBILITY_MOUSE_WINDOW_MS
    // Only a hold that actually opened the panel belongs to the copy field.
    // A tap that never reached the threshold is the surface's: the Products
    // mobile card synthesises "open this product" from touchend (its onClick
    // is undefined outside selection mode), so swallowing every release
    // would make tapping a copyable value on that card do nothing at all.
    // ...and a SCROLL that happened to start on a copy field is nobody's
    // tap: swallowing the start and the moves means the row's detector would
    // see a bare touchend from a press it never began and synthesise a
    // record-opening click out of a flick through the list. onTouchEnd()
    // CONSUMES the cancelled flag, so the answer has to be read before it
    // runs.
    //
    // Net contract on touch, all three gestures: hold -> the copy panel (the
    // release is ours); tap -> the row opens the record (the release is
    // theirs); scroll -> nothing at all (the release is ours, and dropped).
    const cancelled = pressState.cancelled
    if (pressState.fired || cancelled) event.stopPropagation()
    press.onTouchEnd()
    pressElement = null
  }, true)

  document.addEventListener('contextmenu', (event) => {
    if (pressElement) press.onContextMenu(event as unknown as MouseArg)
  }, true)

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (state) apply({ type: 'dismiss' })
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    const found = targetFrom(event.target)
    if (!found || !eligible(found)) return
    // Same ownership rule as the click: a dense row that answers Enter by
    // opening its record keeps that key. (It rarely reaches here anyway --
    // those rows carry the tabIndex, so the focused element is the row, not
    // the cell -- but the rule must not depend on which one has focus.)
    if (!claimsClick(found.kind, insideClickableSurface(found.element))) return
    // Keyboard reach for the same panel: a focused clipped cell opens it,
    // a focused copy field copies. Space would otherwise scroll the page.
    event.preventDefault()
    event.stopPropagation()
    apply({ type: found.kind === 'copy' ? 'gesture' : 'click', element: found.element, kind: found.kind })
  }, true)

  window.addEventListener('resize', position)
  window.addEventListener('scroll', position, true)
}
