// A horizontal swipe at 1x steps the full-screen image viewer to the next or
// previous photo (ImageGalleryLightbox, variant="immersive"; owner
// 2026-09-25). It must travel far enough and be clearly more horizontal than
// vertical, so a vertical scroll or a sloppy tap is never read as a swipe.
export const SWIPE_MIN_DISTANCE_PX = 48

export function swipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_DISTANCE_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return 0
  // Finger moves left -> the next photo slides in from the right.
  return dx < 0 ? 1 : -1
}
