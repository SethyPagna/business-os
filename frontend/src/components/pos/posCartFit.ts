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
