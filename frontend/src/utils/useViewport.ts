import { useEffect, useState } from 'react'

// One shared "are we on a small/compact screen" signal for JS-level
// branching, matching the Tailwind `md:` breakpoint (768px) already used
// throughout this app's CSS. Before this hook existed, every component that
// needed the answer in JS (not just CSS) read `window.innerWidth` ad hoc
// (App.tsx, CatalogPage.tsx, AppSelect.tsx, ...) -- there was no reusable
// version (Gate 1 audit, Area 5). Built for the mobile three-layer hub
// navigation (components/shared/HubSectionNav.tsx), but generic enough for
// any component that needs to branch on viewport size in JS.
const COMPACT_MEDIA_QUERY = '(max-width: 767px)'

function readIsCompact(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(COMPACT_MEDIA_QUERY).matches
}

export function useIsCompactViewport(): boolean {
  // SSR-safe: readIsCompact() returns false when window/matchMedia are
  // unavailable (no layout thrash guess, no window.innerWidth read before
  // hydration) -- the effect below reconciles to the real value on mount.
  const [isCompact, setIsCompact] = useState(readIsCompact)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(COMPACT_MEDIA_QUERY)
    const onChange = (): void => setIsCompact(mql.matches)
    onChange()
    // Modern addEventListener path; Safari < 14's MediaQueryList only has
    // the older addListener/removeListener pair.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    }
    mql.addListener(onChange)
    return () => mql.removeListener(onChange)
  }, [])

  return isCompact
}
