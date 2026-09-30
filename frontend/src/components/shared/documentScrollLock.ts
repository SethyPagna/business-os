// One counted document scroll lock for overlays that cover the page (the
// storefront product sheet, the immersive photo viewer and the policy
// reader in legal/LegalPages.tsx; refuter follow-up
// to P-public-6, 2026-09-25).
//
// Why a shared, counted helper instead of each overlay writing
// `document.body.style.overflow = 'hidden'`:
//  - The storefront's scroll owner is <html>, declared
//    `overflow-y: auto !important` (styles/main.css). A plain inline
//    `overflow: hidden` loses to that !important, so a body/html write
//    without priority locks nothing. The lock must set the html property
//    with 'important'.
//  - Overlays nest (the viewer opens inside the product sheet). A counter
//    means the inner one closing cannot unlock the page under the outer one,
//    and the page is restored exactly once, to what it was before the first
//    lock.
//  - A lock left armed leaves the storefront unscrollable (one of the ways
//    storefrontScrollRoot.test.ts pins). Every lock here returns its
//    release, callers take it in a useEffect and release it in the cleanup
//    (so unmount always releases), and a release is idempotent.

type SavedProperty = { value: string; priority: string }
type SavedState = { html: SavedProperty; body: SavedProperty }

let depth = 0
let saved: SavedState | null = null

type StyleLike = {
  getPropertyValue: (name: string) => string
  getPropertyPriority: (name: string) => string
  setProperty: (name: string, value: string, priority?: string) => void
  removeProperty: (name: string) => string
}

function read(style: StyleLike): SavedProperty {
  return { value: style.getPropertyValue('overflow'), priority: style.getPropertyPriority('overflow') }
}

function restore(style: StyleLike, previous: SavedProperty) {
  if (previous.value) style.setProperty('overflow', previous.value, previous.priority)
  else style.removeProperty('overflow')
}

export function documentScrollLockDepth(): number {
  return depth
}

/** Lock document scrolling; returns an idempotent release. */
export function lockDocumentScroll(): () => void {
  if (typeof document === 'undefined' || !document.documentElement || !document.body) return () => {}
  const htmlStyle = document.documentElement.style as unknown as StyleLike
  const bodyStyle = document.body.style as unknown as StyleLike
  if (depth === 0) {
    saved = { html: read(htmlStyle), body: read(bodyStyle) }
    htmlStyle.setProperty('overflow', 'hidden', 'important')
    bodyStyle.setProperty('overflow', 'hidden', 'important')
  }
  depth += 1
  let released = false
  return () => {
    if (released) return
    released = true
    depth = Math.max(0, depth - 1)
    if (depth === 0 && saved) {
      restore(htmlStyle, saved.html)
      restore(bodyStyle, saved.body)
      saved = null
    }
  }
}
