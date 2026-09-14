import { useEffect } from 'react'

// Publishes "how many pixels at the bottom of the layout viewport are
// currently covered by the on-screen keyboard" as the CSS custom property
// `--kb-inset`, so stylesheets can subtract it (styles/main.css:
// .modal-viewport-safe, .modal-panel-safe, .max-h-modal-*).
//
// Why this has to exist at all. On Android the browser SHRINKS the layout
// viewport when the keyboard opens, so `100dvh`/`100%` already exclude it and
// a sticky modal footer stays visible. iOS does not: the layout viewport keeps
// its full height and the keyboard is simply painted on top of the bottom of
// it. `dvh` follows the layout viewport, so on an iPhone a dialog sized
// `max-height: 92dvh` still ends underneath the keyboard and its Save/Cancel
// footer is unreachable while any field in it is focused -- the exact "I can't
// see the buttons once I start typing" report. `window.visualViewport` is the
// only API that reports the actually-visible rectangle, so it is the only
// thing that can measure the keyboard.
//
// The measurement (per the VisualViewport spec):
//   innerHeight            the layout viewport, unchanged by the keyboard
//   visualViewport.height  what is really visible right now
//   visualViewport.offsetTop  how far the visual viewport has been pushed
//                             down inside the layout viewport (iOS scrolls
//                             the focused field into view this way)
// so `innerHeight - height - offsetTop` is what is hidden at the BOTTOM.
export const KEYBOARD_INSET_PROPERTY = '--kb-inset'

// Below this, the difference is not a keyboard: a horizontal scrollbar on
// desktop, a browser toolbar mid-animation, and subpixel rounding all produce
// a few pixels of gap. Treating those as a keyboard would shrink every dialog
// on a desktop browser for no reason and would repaint on every scroll tick.
// No mobile keyboard is anywhere near this short (~250-330px on iPhone).
const KEYBOARD_MIN_PX = 80

let subscriberCount = 0
let published = 0
let detach: (() => void) | null = null

function readKeyboardInset(): number {
  if (typeof window === 'undefined') return 0
  const viewport = window.visualViewport
  // Not every engine has visualViewport (older WebKit/Firefox builds, and the
  // test DOM doubles in tests/). Reporting 0 leaves every consumer on its
  // existing `var(--kb-inset, 0px)` fallback, i.e. today's behaviour.
  if (!viewport) return 0
  const hidden = window.innerHeight - viewport.height - viewport.offsetTop
  return hidden >= KEYBOARD_MIN_PX ? Math.round(hidden) : 0
}

function publishKeyboardInset(): void {
  if (typeof document === 'undefined') return
  const inset = readKeyboardInset()
  // Writing an identical value would still invalidate style for the whole
  // document. Desktop sits at 0 forever, so it must cost exactly one compare
  // per event and never a style write.
  if (inset === published) return
  published = inset
  const root = document.documentElement
  if (inset === 0) root.style.removeProperty(KEYBOARD_INSET_PROPERTY)
  else root.style.setProperty(KEYBOARD_INSET_PROPERTY, `${inset}px`)
}

function attachViewportListeners(): void {
  if (typeof window === 'undefined') return
  const viewport = window.visualViewport
  if (!viewport) return
  // `resize` fires when the keyboard opens/closes; `scroll` fires when iOS
  // pans the visual viewport to reveal the focused field, which changes
  // offsetTop and therefore the inset without any resize.
  viewport.addEventListener('resize', publishKeyboardInset)
  viewport.addEventListener('scroll', publishKeyboardInset)
  window.addEventListener('orientationchange', publishKeyboardInset)
  detach = () => {
    viewport.removeEventListener('resize', publishKeyboardInset)
    viewport.removeEventListener('scroll', publishKeyboardInset)
    window.removeEventListener('orientationchange', publishKeyboardInset)
  }
}

/**
 * Keeps `--kb-inset` current for as long as at least one caller is mounted.
 *
 * Call it from the shared modal primitives, not from individual dialogs: the
 * listeners are shared through a module-level refcount, so ten stacked modals
 * still install exactly one `resize`/`scroll` pair, and the property is
 * removed again once the last one unmounts.
 */
export function useVisualViewportInset(): void {
  useEffect(() => {
    subscriberCount += 1
    if (subscriberCount === 1) attachViewportListeners()
    // A modal can be opened while the keyboard is ALREADY up (a field on the
    // page behind it was focused), so measure on mount, not only on the next
    // viewport event.
    publishKeyboardInset()
    return () => {
      subscriberCount -= 1
      if (subscriberCount > 0) return
      detach?.()
      detach = null
      published = 0
      if (typeof document !== 'undefined') {
        document.documentElement.style.removeProperty(KEYBOARD_INSET_PROPERTY)
      }
    }
  }, [])
}
