import type { DragEvent, MouseEvent } from 'react'

// Shared honest-deterrence attributes for any <img>/<video> shown to a
// viewer who should not be handed an easy one-click "save this" path --
// the storefront's product photos/logo/cover/avatar-like account media
// (frontend/src/components/catalog/catalogImages.tsx,
// frontend/src/components/shared/ImageGalleryLightbox.tsx), plus the admin
// app's own avatar/cover views (frontend/src/components/users/
// UserProfileModal.tsx) which had no equivalent protection at all before
// this. This is a DETERRENT, not DRM: nothing stops a screenshot or
// devtools; it only removes the ordinary desktop right-click-save and
// drag-out paths, plus the iOS long-press "Save Image" callout.
//
// `data-protected-media="true"` does double duty:
//   - It is the CSS hook (`[data-protected-media='true']` in
//     frontend/src/styles/main.css, app-wide, and the portal-scoped
//     `body[data-public-portal='true'] img` rule in public-portal.css)
//     for `-webkit-touch-callout`/`-webkit-user-drag`/`user-select: none`.
//   - It is also the marker the storefront's own root-level capture-phase
//     handlers (PublicCatalogPage.tsx's onContextMenuCapture/
//     onDragStartCapture/onAuxClickCapture) match via
//     `.closest('img, video, [data-protected-media="true"]')`, so a
//     non-<img> element (e.g. a CSS background-image tile) opts into the
//     same protection by carrying this attribute.
//
// Kept deliberately framework-thin (a plain props object, not a component)
// so it works whether the caller renders a bare <img>, wraps it in an
// existing component (CatalogProductImage), or passes it in via a
// render-prop (ImageGalleryLightbox's `renderImage`).
export function preventContextMenu(event: MouseEvent): void {
  event.preventDefault()
}

export function preventDragStart(event: DragEvent): void {
  event.preventDefault()
}

export type ProtectedImageProps = {
  draggable: false
  onContextMenu: (event: MouseEvent) => void
  onDragStart: (event: DragEvent) => void
  'data-protected-media': 'true'
}

/** Spread onto an <img> (or <video>) element: `<img {...protectedImageProps()} ... />`. */
export function protectedImageProps(): ProtectedImageProps {
  return {
    draggable: false,
    onContextMenu: preventContextMenu,
    onDragStart: preventDragStart,
    'data-protected-media': 'true',
  }
}
