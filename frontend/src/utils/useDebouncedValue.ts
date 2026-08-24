import { useEffect, useState } from 'react'

// Generic trailing-edge debounce: `debounced` only updates after `value`
// has held steady for `delayMs`. Used to keep server round-trips (and the
// visible result list they drive) from firing on every keystroke -- the
// input itself should always update immediately (uncontrolled inputs feel
// laggy otherwise); only the *derived* value fed into a fetch/effect should
// wait out the pause.
//
// Canonical home for what used to be three near-identical copies:
// Products.tsx and POS.tsx each defined their own local version (POS.tsx's
// was a byte-for-byte duplicate), and Inventory.tsx had none at all --
// its search box aliased `deferredSearch` straight to the raw, undebounced
// `search` state, so every keystroke triggered a full bootstrap/products/
// stats/movements re-fetch and replaced the visible list mid-request. That
// was the actual mechanism behind the long-standing "search results render
// incrementally / one at a time instead of settling once" report -- not a
// rendering/animation issue, a missing debounce on one of the four search
// surfaces. Fixed by consolidating here and wiring Inventory.tsx up to it
// the same way the other three surfaces already work.
export function useDebouncedValue<T>(value: T, delayMs = 180): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [delayMs, value])
  return debounced
}
