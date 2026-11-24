export const CART_FIT_DIVIDER_PX = 8
export const CART_FIT_PRODUCTS_MIN_PX = 280
export const CART_FIT_FLOOR_PX = 240

/**
 * The cart width to render beside the products column. The cashier's stored width wins whenever it fits; otherwise the cart gives up
 * pixels (below its usual 300 minimum, down to CART_FIT_FLOOR_PX) so its right edge, with the shift controls and Complete Sale,
 * stays inside the panels row. An unmeasured row keeps the stored width. The result is for rendering only and is never saved.
 */
export function fitCartWidth(
  rowWidthPx: number,
  storedPx: number,
  productsMinPx: number = CART_FIT_PRODUCTS_MIN_PX,
): number {
  if (!Number.isFinite(rowWidthPx) || rowWidthPx <= 0) return storedPx
  const room = rowWidthPx - CART_FIT_DIVIDER_PX - productsMinPx
  return Math.min(storedPx, Math.max(CART_FIT_FLOOR_PX, Math.floor(room)))
}
