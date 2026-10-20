// Owner, 19 Oct 2026: the Employee default edits every product detail EXCEPT prices and the supplier.
// `products:supplier` is a narrowing switch like `products:price`: ABSENT means no opinion (every
// existing role keeps working), only an explicit false refuses. It governs changing the supplier text
// of an EXISTING product (PUT /api/products/:id), attributing a product's lots to a supplier
// (POST /api/products/:id/suppliers/backfill) and approving a queued supplier change
// (lib/reviewApprovalPermission.ts). Setting a supplier on a NEW product follows the add action, the
// same policy as the initial selling price.
//
// The product editor posts the WHOLE row on every save, so only a supplier that differs from the stored
// one is a change; trim and letter case do not make a different supplier.
export const PRODUCT_SUPPLIER_REFUSAL = {
  error: 'You do not have permission to change the product supplier',
  code: 'product_supplier_edit_required',
} as const

const supplierKey = (value: unknown): string => String(value ?? '').trim().toLowerCase()

/** True when `body` carries a supplier that names a different supplier than the stored one. */
export function productSupplierChanged(stored: unknown, body: Record<string, unknown>): boolean {
  if (!Object.prototype.hasOwnProperty.call(body, 'supplier')) return false
  return supplierKey(stored) !== supplierKey(body.supplier)
}
