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

/** The Products bulk toolbar's controls, in the order they appear. */
export type ProductBulkControl = 'delete' | 'info' | 'pricing' | 'stock' | 'branch' | 'out'

/** Above this many selected rows a bulk delete runs as a server job (Products.tsx BULK_DELETE_JOB_THRESHOLD). */
export const PRODUCT_BULK_DELETE_JOB_THRESHOLD = 300

/**
 * Which bulk-toolbar controls a role may use. Each answers with the action the Worker checks for the writes the
 * control performs, so a role is never offered a control whose first request is a 403:
 *   delete   DELETE /products/:id (Delete product); past the job threshold POST /bulk-delete-jobs (Bulk delete, Full)
 *   info     PUT /products/:id (Edit product), once per row
 *   pricing  PUT /products/:id (Edit product), once per row
 *   stock    the Stock Session Add / Remove / Set -> POST /inventory/adjust (Adjust / receive stock)
 *   out      POST /inventory/adjust, one remove per branch (Adjust / receive stock)
 *   branch   POST /inventory/transfer (Transfer stock)
 */
export function productBulkControlAccess(user: PermissionUser, selectedCount: number): Record<ProductBulkControl, boolean> {
  const { isAdmin, can } = effectivePermissions(user)
  const everything = isAdmin
  const edit = everything || can('products', 'edit')
  const adjust = everything || can('inventory', 'adjust')
  return {
    delete: everything || (can('products', 'delete')
      && (selectedCount <= PRODUCT_BULK_DELETE_JOB_THRESHOLD || can('products', 'bulk_delete'))),
    info: edit,
    pricing: edit,
    stock: adjust,
    out: adjust,
    branch: everything || can('inventory', 'transfer'),
  }
}
