export const CART_FIT_DIVIDER_PX = 8
export const CART_FIT_PRODUCTS_MIN_MD_PX = 288
export const CART_FIT_PRODUCTS_MIN_LG_PX = 352
export const CART_FIT_LG_BREAKPOINT_PX = 1024
export const CART_FIT_FLOOR_PX = 240

/** The products column's own CSS minimum (POS.tsx: md:min-w-[18rem] lg:min-w-[22rem]) for the current viewport. */
export function cartProductsMinPx(viewportIsLg: boolean): number {
  return viewportIsLg ? CART_FIT_PRODUCTS_MIN_LG_PX : CART_FIT_PRODUCTS_MIN_MD_PX
}

/**
 * The cart width to render beside the products column. The cashier's stored width wins whenever it fits; otherwise the cart gives up
 * pixels (below its usual 300 minimum, down to CART_FIT_FLOOR_PX) so its right edge, with the shift controls and Complete Sale,
 * stays inside the panels row. An unmeasured row keeps the stored width. The result is for rendering only and is never saved.
 */
export function fitCartWidth(
  rowWidthPx: number,
  storedPx: number,
  productsMinPx: number = CART_FIT_PRODUCTS_MIN_MD_PX,
): number {
  if (!Number.isFinite(rowWidthPx) || rowWidthPx <= 0) return storedPx
  const room = rowWidthPx - CART_FIT_DIVIDER_PX - productsMinPx
  return Math.min(storedPx, Math.max(CART_FIT_FLOOR_PX, Math.floor(room)))
}

/**
 * The width a drag of the divider may apply and save: the pointer's wish, held to the cart's own min/max and then to the same fit the
 * render uses, so the saved width is what the cashier saw. Null when the fit is below the smallest storable width (the row is too
 * narrow for the cart's usual minimum): the divider does not move and nothing is saved.
 */
export function dragCartWidth(
  rowWidthPx: number,
  wantedPx: number,
  productsMinPx: number,
  minPx: number,
  maxPx: number,
): number | null {
  const fitted = fitCartWidth(rowWidthPx, Math.min(maxPx, Math.max(minPx, wantedPx)), productsMinPx)
  return fitted < minPx ? null : fitted
}

/** A press that moves less than this many px is a click or a tap, not a drag: it changes and saves nothing. */
export const CART_DRAG_THRESHOLD_PX = 3

export interface CartDragSession {
  readonly startX: number
  readonly moved: boolean
  /** The last width the drag applied (and the one to save on release); null while nothing was applied. */
  readonly widthPx: number | null
}

export function beginCartDrag(startX: number): CartDragSession {
  return { startX, moved: false, widthPx: null }
}

/**
 * One pointer move. Inside the threshold of the press point nothing is applied, so a click leaves the stored width alone; the first
 * move past it makes the press a drag for good. `widthFor` returns the width the divider may take at that pointer position (the drag
 * clamp) or null when the fit refuses it. `apply` is the width to show now, or null to leave the cart as it is.
 */
export function moveCartDrag(
  session: CartDragSession,
  clientX: number,
  widthFor: (clientX: number) => number | null,
): { session: CartDragSession; apply: number | null } {
  if (!session.moved && Math.abs(clientX - session.startX) < CART_DRAG_THRESHOLD_PX) return { session, apply: null }
  const width = widthFor(clientX)
  if (width === null) return { session: { ...session, moved: true }, apply: null }
  return { session: { ...session, moved: true, widthPx: width }, apply: width }
}

/** The width to save when the press is released: exactly the last width the drag showed, or null when nothing was shown. */
export function cartDragSavedWidth(session: CartDragSession): number | null {
  return session.widthPx
}

/** The one place the products column's minimum is chosen from the viewport; the render measure and the drag clamp both call it. */
export function viewportProductsMinPx(matchMedia: (query: string) => { matches: boolean }): number {
  return cartProductsMinPx(matchMedia(`(min-width: ${CART_FIT_LG_BREAKPOINT_PX}px)`).matches)
}

/** What the render fit needs from the panels row: its own width and the products minimum for this viewport. */
export function measurePanelsRow(
  row: { getBoundingClientRect(): { width: number } },
  matchMedia: (query: string) => { matches: boolean },
): { rowPx: number; productsMinPx: number } {
  return { rowPx: row.getBoundingClientRect().width, productsMinPx: viewportProductsMinPx(matchMedia) }
}
