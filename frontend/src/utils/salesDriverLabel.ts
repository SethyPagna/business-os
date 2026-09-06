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
export function resolveDriverLabel(sale: DriverLabelSale | null | undefined): string {
  const linked = String(sale?.linked_driver_name ?? '').trim()
  if (linked) return linked
  const contact = String(sale?.delivery_contact_name ?? '').trim()
  if (contact) return contact
  return ''
}
