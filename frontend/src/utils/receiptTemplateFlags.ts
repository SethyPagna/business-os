// Template switches the receipt reads as "on unless exactly false". The Receipt
// renderer treats every other switch as on only when truthy. A settings toggle
// must read a key the same way the renderer does, or a stored null/0 shows OFF
// in settings while the paper still prints the section.
export const RECEIPT_DEFAULT_ON_FLAGS: ReadonlySet<string> = new Set([
  'show_customer_membership',
  'delivery_show_contact',
  'delivery_show_driver_name',
  'delivery_show_driver_phone',
  'delivery_show_address',
  'delivery_show_fee',
  'show_item_unit_price',
  'show_item_discount',
  'show_discount',
  'show_discount_khr',
  'show_membership_discount',
  'show_membership_discount_khr',
  'show_membership_points',
  'show_delivery',
  'show_delivery_khr',
  'qr_show_portal',
])

export function receiptFlagOn(template: Record<string, unknown> | null | undefined, key: string): boolean {
  const value = template ? template[key] : undefined
  return RECEIPT_DEFAULT_ON_FLAGS.has(key) ? value !== false : !!value
}
