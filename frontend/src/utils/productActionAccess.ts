import { effectivePermissions, type PermissionUser } from './permissions.ts'

// Per-action gates for the two Products writes that used to check the section grant alone (loophole N6 and N8, 6 Oct
// 2026). Each mirrors the Worker's check in cloudflare/src/routes/products.ts line for line, so a control that is
// hidden here is one the API refuses, and a control that is shown is one it accepts.

/**
 * POST /api/products/variant creates a product row. The Worker needs the Add variant action AND Add product, both at
 * Full tier (variant is not a review-queued action).
 */
export function canAddProductVariant(user: PermissionUser): boolean {
  const { isAdmin, getPermissionTier, can } = effectivePermissions(user)
  return isAdmin || (getPermissionTier('products') === 'full' && can('products', 'variant') && can('products', 'add'))
}

/**
 * POST /api/products/bulk-price-adjust ("Apply to ALL products in the system") reprices the whole catalog. The Worker
 * needs Products at Full tier and the Edit product action not switched off.
 */
export function canAdjustAllProductPrices(user: PermissionUser): boolean {
  const { isAdmin, getPermissionTier, can } = effectivePermissions(user)
  return isAdmin || (getPermissionTier('products') === 'full' && can('products', 'edit'))
}
