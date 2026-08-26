import type { CSSProperties } from 'react'

// One source of truth for how a portal logo image is cropped inside its
// circular frame, used by BOTH the editor's live preview and the actual
// rendered header (CatalogPreviewSurface). They used to compute this
// separately with DIFFERENT zoom clamps (editor 0.8-1.8, live 1-1.35), so
// the preview never matched what shipped -- the "previews in media are
// redundant / don't show how it looks when applied" report. Now they are
// the same function, so the preview IS the applied result.
//
// The other half of that report -- "vertical and horizontal don't actually
// work" -- was a real CSS bug: `object-position` set the crop focus, but
// the accompanying `transform: scale()` zoomed from `transform-origin:
// center`, so once you zoomed in the image always zoomed toward the middle
// and the position sliders stopped moving anything visible. Setting the
// transform origin to the SAME focus point makes the zoom happen around the
// chosen point, so horizontal and vertical stay meaningful at every zoom.

export interface LogoCropInput {
  fit?: string | null
  zoom?: number | string | null
  positionX?: number | string | null
  positionY?: number | string | null
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value))
}

function toNum(value: unknown, fallback: number): number {
  // '' and null both coerce to 0 via Number(), which would silently drop a
  // blank field to a 0% focus / 0 zoom instead of the intended default.
  if (value === '' || value === null || value === undefined) return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Percent focus point, clamped 0-100, matching the editor's sliders. */
export function logoFocus(input: LogoCropInput): { x: number; y: number } {
  return {
    x: clamp(0, 100, toNum(input.positionX, 50)),
    y: clamp(0, 100, toNum(input.positionY, 50)),
  }
}

/** Zoom as a scale factor, clamped to the editor slider's 80-180% range. */
export function logoZoomScale(input: LogoCropInput): number {
  return clamp(0.8, 1.8, (toNum(input.zoom, 100) || 100) / 100)
}

/**
 * The `style` for the logo `<img>` (h-full w-full). Compose it after the
 * element's own layout classes: `style={buildLogoImageStyle(cfg)}`.
 */
export function buildLogoImageStyle(input: LogoCropInput): CSSProperties {
  const { x, y } = logoFocus(input)
  const scale = logoZoomScale(input)
  return {
    objectFit: input.fit === 'contain' ? 'contain' : 'cover',
    objectPosition: `${x}% ${y}%`,
    transform: `scale(${scale})`,
    // The fix: zoom around the focus point, not the centre, so the
    // horizontal/vertical sliders keep working when zoomed in.
    transformOrigin: `${x}% ${y}%`,
  }
}
