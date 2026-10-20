import { effectivePermissions, type PermissionUser } from './permissions.ts'

// Owner, 19 Oct 2026: the Employee default edits every product detail except prices and the supplier. Mirrors
// cloudflare/src/lib/productSupplierGate.ts and the PUT /api/products/:id gate: `products:supplier` narrows (absent
// is no opinion, only an explicit false refuses); an unchanged supplier is never a change; a NEW product's supplier
// follows the Add action. tests/productSupplierAccess.test.ts compares this with the Worker on a shared case table.

const supplierKey = (value: unknown): string => String(value ?? '').trim().toLowerCase()

/** May change the supplier of an existing product. */
export function canChangeProductSupplier(user: PermissionUser): boolean {
  return effectivePermissions(user).can('products', 'supplier')
}

/** True when `submitted` names a different supplier than `stored` (trim and letter case are not a change). */
export function productSupplierChanged(stored: unknown, submitted: unknown): boolean {
  return supplierKey(stored) !== supplierKey(submitted)
}

/** The supplier input is read-only: an existing product, and the supplier action is off. */
export function isProductSupplierLocked(user: PermissionUser, isNewProduct: boolean): boolean {
  return !isNewProduct && !canChangeProductSupplier(user)
}

/** The Worker refuses this save (403 product_supplier_edit_required). */
export function productSupplierSaveRefused(user: PermissionUser, stored: unknown, submitted: unknown): boolean {
  return !canChangeProductSupplier(user) && productSupplierChanged(stored, submitted)
}
