import { tapLandsOnControl } from '../../utils/longPress.ts'
import { COPY_SELECTOR } from '../shared/textAffordances.ts'

// How long the swallow outlives the release of the dismissing press. A mouse click follows its mouseup at once; a touch tap's synthesized click follows its touchend by a few milliseconds.
const DISMISS_CLICK_GRACE_MS = 300
// A press that never gets released (focus lost mid-gesture) must not leave the page eating clicks.
const DISMISS_CLICK_GIVE_UP_MS = 10000

/**
 * Eats exactly the click that completes the press which just dismissed a menu, so tapping a ROW to close the menu does not also open that row. It listens in the capture phase on the document, so the click
 * reaches neither the element under the finger nor React's root handlers. A click on a real control (button, link, input, select, textarea, label, role=button...; the same rule the rows use to leave
 * their own open handler alone) is NOT eaten: the control acts on its first tap and the swallow is over. A copy target is plain text that happens to carry role=button, so it is eaten like blank row
 * space, and so is a pointer-only duplicate of the row's open handler (data-row-open: the row's picture button). It is gone after that one click; if the press turns into a scroll or a long hold there is no click, so it also expires a moment after the press is released.
 */
export function swallowDismissClick() {
  let timer = 0
  const events = ['mouseup', 'touchend', 'touchcancel', 'pointercancel'] as const
  const release = () => {
    window.clearTimeout(timer)
    document.removeEventListener('click', eat, true)
    for (const name of events) document.removeEventListener(name, released, true)
  }
  function eat(event: Event) {
    const target = event.target instanceof Element ? event.target : null
    if (target && !target.closest(`${COPY_SELECTOR}, [data-row-open]`) && tapLandsOnControl(target, null)) {
      release()
      return
    }
    event.stopPropagation()
    event.preventDefault()
    release()
  }
  function released() {
    window.clearTimeout(timer)
    timer = window.setTimeout(release, DISMISS_CLICK_GRACE_MS)
  }
  document.addEventListener('click', eat, true)
  for (const name of events) document.addEventListener(name, released, true)
  timer = window.setTimeout(release, DISMISS_CLICK_GIVE_UP_MS)
}
