/*
 * useScannerWedge -- a barcode gun (keyboard wedge) on any keyboard layout.
 *
 * CONTRACT, for every surface that calls this (each page or dialog whose search
 * box has a camera scan button: POS, Products, Inventory and its count page,
 * stock sessions, transfers, returns, sales, promotions, branch stock):
 *
 *   useScannerWedge({ enabled, searchRef, onScan })
 *
 *   enabled    false while the surface is not on screen or something of its own
 *              covers it (a sheet, a confirm). A disabled surface is not
 *              registered at all.
 *   searchRef  the surface's search field. It anchors "is this surface visible
 *              and not under a dialog" and tells the hook which field is the
 *              search. No rendered field, no scans.
 *   onScan     called once per scan with the text rebuilt from the physical keys
 *              (event.code), so the Khmer layout's ៣ arrives as 3. It MUST do
 *              exactly what typing the same text into the search does (same
 *              change handler: persistence, paging, pinned rows) and nothing
 *              more: a scan never adds or picks a product. `origin` says where
 *              the burst landed; 'field' means it was typed into a quantity /
 *              price / date / select box and has been put back, so the surface
 *              can tell the person the code moved to search.
 *
 * A scan is a burst: keys under 35 ms apart, at least 6 of them, closed by
 * Enter or Tab (utils/scannerWedge.ts). Ordinary typing, IME composition, held
 * keys and shortcuts never look like one.
 *
 * Where the burst lands (utils/scannerWedge.ts classifyWedgeFocus):
 *   nothing editable focused  -> onScan, so a scan is no longer lost;
 *   the surface's own search  -> onScan replaces its text with the code;
 *   a number / date / select  -> the field gets its pre-burst value back, then onScan;
 *   any other text field      -> left alone, the person is typing there, unless the
 *                                field spreads SCAN_GUARD_PROPS (utils/scannerWedge.ts): then it
 *                                is put back and the code goes to search, as for a quantity.
 *
 * The terminating Enter / Tab is cancelled and stopped before any other handler
 * sees it, so a focused button is not clicked and an `onEnter={add}` field does
 * not add a line whose quantity is a barcode.
 *
 * Several surfaces may be enabled at once (a page and a dialog above it). The
 * latest registered one that is visible and not covered by an aria-modal dialog
 * outside it answers; the others hear nothing.
 *
 * Known limit: a burst is only recognised when its Enter / Tab arrives, so every
 * key before it has already reached a focused quantity field and its onChange
 * has seen each transient value (the POS cart may flash "not enough stock"
 * before the notice that the code moved). The restore goes through the same
 * onChange, so the field and the state behind it end where they started.
 */
import { useEffect, useRef, type RefObject } from 'react'
import { classifyWedgeFocus, createWedgeDetector } from '../../utils/scannerWedge.ts'

export type ScanOrigin = 'idle' | 'search' | 'field'

export interface ScannerWedgeOptions {
  enabled: boolean
  searchRef: RefObject<HTMLElement | null>
  onScan: (code: string, origin: ScanOrigin) => void
}

interface Registration {
  latest: { current: ScannerWedgeOptions }
}

interface FieldSnapshot {
  element: HTMLInputElement | HTMLSelectElement
  value: string
}

// One listener and one detector for the whole window: a keystroke belongs to
// no surface until a burst completes and the topmost one is chosen.
const registrations: Registration[] = []
const detector = createWedgeDetector()
let snapshot: FieldSnapshot | null = null

function snapshotOf(element: Element | null): FieldSnapshot | null {
  return element instanceof HTMLInputElement || element instanceof HTMLSelectElement
    ? { element, value: element.value }
    : null
}

function visible(element: HTMLElement | null): element is HTMLElement {
  return !!element && element.isConnected && element.getClientRects().length > 0
}

function topmostRegistration(): Registration | null {
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).filter(visible)
  const topDialog = dialogs[dialogs.length - 1] ?? null
  for (let index = registrations.length - 1; index >= 0; index -= 1) {
    const anchor = registrations[index].latest.current.searchRef.current
    if (!visible(anchor)) continue
    if (topDialog && !topDialog.contains(anchor)) continue
    return registrations[index]
  }
  return null
}

// The native setter, not `element.value =`: React remembers the last value it
// wrote and drops a change event when the DOM already holds that value, so the
// state behind a controlled field only follows a restore made this way.
function restoreField({ element, value }: FieldSnapshot): void {
  const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value)
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
}

function onKeyDown(event: KeyboardEvent): void {
  const step = detector.push({
    code: event.code,
    timeStamp: event.timeStamp,
    shiftKey: event.shiftKey,
    capsLock: event.getModifierState?.('CapsLock'),
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    repeat: event.repeat,
    isComposing: event.isComposing || event.keyCode === 229,
  })
  // keydown runs before the key is inserted, so this is the value from before the burst.
  if (step.kind === 'char' && step.startsBurst) snapshot = snapshotOf(document.activeElement)
  if (step.kind !== 'burst') return
  const registration = topmostRegistration()
  if (!registration) return
  const { searchRef, onScan } = registration.latest.current
  const focused = document.activeElement
  const focus = classifyWedgeFocus(focused as HTMLElement | null, focused !== null && focused === searchRef.current)
  if (focus === 'text') return
  event.preventDefault()
  event.stopPropagation()
  if (focus === 'restore') {
    if (snapshot && snapshot.element === focused) restoreField(snapshot)
    onScan(step.code, 'field')
    return
  }
  onScan(step.code, focus)
}

export function useScannerWedge(options: ScannerWedgeOptions): void {
  const latest = useRef(options)
  latest.current = options
  const { enabled } = options
  useEffect(() => {
    if (!enabled) return undefined
    const registration: Registration = { latest }
    registrations.push(registration)
    if (registrations.length === 1) window.addEventListener('keydown', onKeyDown, true)
    return () => {
      registrations.splice(registrations.indexOf(registration), 1)
      if (registrations.length === 0) {
        window.removeEventListener('keydown', onKeyDown, true)
        detector.reset()
        snapshot = null
      }
    }
  }, [enabled])
}
