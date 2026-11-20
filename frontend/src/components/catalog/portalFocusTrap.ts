/**
 * Which focusable element a Tab press lands on inside a sheet that keeps focus in. `activeIndex` is the position of the focused element in
 * the sheet's list of focusable elements, or -1 when focus is on the sheet itself or somewhere outside it. Returns -1 when the sheet has
 * nothing focusable (the caller then keeps focus on the sheet).
 */
export function nextTrapIndex(count: number, activeIndex: number, backwards: boolean): number {
  if (count <= 0) return -1
  if (activeIndex < 0 || activeIndex >= count) return backwards ? count - 1 : 0
  if (backwards) return activeIndex === 0 ? count - 1 : activeIndex - 1
  return activeIndex === count - 1 ? 0 : activeIndex + 1
}

export const PORTAL_FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
