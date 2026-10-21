import type { D1Compat } from './db'
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

/**
 * True when relabelling or merging supplier contacts would rewrite a product's supplier: a product whose supplier
 * text is one of `names`, or a lot attributed (by id) to one of `supplierIds`. A supplier no product or lot uses is
 * pure contact housekeeping and needs no products:supplier.
 */
export async function supplierContactChangeReachesProducts(
  db: D1Compat,
  input: { names: string[]; supplierIds?: number[] },
): Promise<boolean> {
  const names = [...new Set(input.names.map(supplierKey).filter(Boolean))]
  if (names.length) {
    const hit = await db.prepare(
      "SELECT 1 AS hit FROM products WHERE lower(trim(COALESCE(supplier, ''))) IN (SELECT value FROM json_each(@names)) LIMIT 1",
    ).get<{ hit: number }>({ names: JSON.stringify(names) })
    if (hit) return true
  }
  const ids = [...new Set((input.supplierIds ?? []).filter((id) => Number.isSafeInteger(id) && id > 0))]
  if (!ids.length) return false
  const lot = await db.prepare(
    'SELECT 1 AS hit FROM product_batches WHERE supplier_id IN (SELECT value FROM json_each(@ids)) LIMIT 1',
  ).get<{ hit: number }>({ ids: JSON.stringify(ids) })
  return Boolean(lot)
}

/** True when `body` names a supplier (id or name) that differs from the lot's stored one; an absent field is no change. */
export function lotSupplierChanged(stored: { supplier_id: number | null; supplier_name: string | null }, body: Record<string, unknown>): boolean {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key)
  if (has('supplier_name') && supplierKey(stored.supplier_name) !== supplierKey(body.supplier_name)) return true
  if (has('supplier_id')) {
    const next = Number(body.supplier_id)
    const nextId = Number.isFinite(next) && next > 0 ? next : null
    if ((stored.supplier_id ?? null) !== nextId) return true
  }
  return false
}
