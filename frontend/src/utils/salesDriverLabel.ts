// N9: one canonical resolver for "which driver/delivery-contact name does
// this sale show" -- used by the Sales list's Driver column, its mobile
// card, and (via the same shape) SaleDetailModal's delivery section.
//
// GET /sales already resolves this server-side (cloudflare/src/routes/sales.ts):
// it joins the live delivery_contacts row and folds `dc.name` into
// `delivery_contact_name` when the sale's own snapshot is blank, then strips
// the raw `linked_driver_name`/`linked_driver_phone` columns out of the
// response. So today a sale object reaching the frontend never actually
// carries `linked_driver_name` -- but this resolver still prefers it when
// present, so it stays correct if a future call site (or an older cached
// response) ever sends both fields raw, instead of silently depending on
// that server-side merge staying exactly as it is now.
export interface DriverLabelSale {
  linked_driver_name?: string | null
  delivery_contact_name?: string | null
}

/**
 * Returns the trimmed driver name to display, or '' when the sale has none
 * recorded. Callers apply their own empty-state string (a dash for a dense
 * table cell, a translated "No driver" in a detail view), the same way
 * getSaleBranchLabel/branchLabel work elsewhere on this page.
 */
export interface DeliveryWaiverSale {
  is_delivery?: unknown
  delivery_fee_paid_by?: string | null
}

/**
 * True when this sale is a delivery the CUSTOMER was not charged for --
 * the shop absorbed the fee (`delivery_fee_paid_by = 'store'`), which is the
 * same fact the money block already prints as "Free".
 *
 * Owner (Sep 17): "for free it should also cross out the delivery. like if
 * free, the driver if exist should be crossed out. a line across the name.
 * so it is visually intuitive." A free delivery and a paid one used to look
 * identical wherever the driver was the thing being read -- the Sales list
 * column, the mobile card, the sale's own detail rows -- because only the
 * KHR amount was struck through. Every one of those reads this predicate, so
 * they cannot drift apart.
 *
 * Deliberately absent-safe: a row without the field reads as customer-paid,
 * so a surface that has not loaded it never strikes anything out by accident.
 */
export function isDeliveryFreeForCustomer(sale: DeliveryWaiverSale | null | undefined): boolean {
  if (!sale) return false
  if (!Number(sale.is_delivery ?? 0)) return false
  return String(sale.delivery_fee_paid_by ?? 'customer') === 'store'
}

export function resolveDriverLabel(sale: DriverLabelSale | null | undefined): string {
  const linked = String(sale?.linked_driver_name ?? '').trim()
  if (linked) return linked
  const contact = String(sale?.delivery_contact_name ?? '').trim()
  if (contact) return contact
  return ''
}
