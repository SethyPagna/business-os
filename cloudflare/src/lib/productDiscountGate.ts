// Owner, 6 Oct 2026: a product-level discount IS a price change. It lowers the effective selling
// price on every till and on the storefront, so it sits behind the same `products:price` action
// as the default selling and wholesale price (routes/products.ts PRODUCT_DEFAULT_PRICE_FIELDS).
// Cart discounts at sale time are a different thing and are not touched by this.
//
// What counts as the price: whether the discount applies, which kind, how much (percent, USD, KHR)
// and when (start/end). The label and badge colour only change how the discount is described, so
// they stay editable with Edit product alone.
//
// The editors post the WHOLE discount block back with every save (ProductForm carries it, the
// Promotions page sends it), so only a value that differs from the stored one is a change. Values
// are compared in their normalised form: null / '' / 0 / false are the same "no discount", and the
// kind falls back to percent the way every reader of the column does.
export const PRODUCT_DISCOUNT_PRICE_FIELDS = [
  'discount_enabled', 'discount_type', 'discount_percent', 'discount_amount_usd', 'discount_amount_khr',
  'discount_starts_at', 'discount_ends_at',
] as const

type DiscountField = typeof PRODUCT_DISCOUNT_PRICE_FIELDS[number]
type Row = Record<string, unknown>

const money4 = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 10000) / 10000 : 0
}

function normalised(field: DiscountField, value: unknown): string | number {
  switch (field) {
    case 'discount_enabled':
      return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' ? 1 : 0
    case 'discount_type':
      return String(value ?? '').trim().toLowerCase() === 'fixed' ? 'fixed' : 'percent'
    case 'discount_starts_at':
    case 'discount_ends_at':
      return String(value ?? '').trim()
    default:
      return money4(value)
  }
}

/**
 * True when the body writes a discount price field to a value other than the stored one. `before` is
 * the stored row (a PUT) or null (a create, where the stored state is "no discount"). A field the body
 * does not carry is not a change.
 */
export function productDiscountChanged(before: Row | null | undefined, body: Row): boolean {
  return PRODUCT_DISCOUNT_PRICE_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field)
    && normalised(field, body[field]) !== normalised(field, before ? before[field] : null))
}

export const PRODUCT_DISCOUNT_SELECT = PRODUCT_DISCOUNT_PRICE_FIELDS.join(', ')

export const PRODUCT_DISCOUNT_PRICE_REFUSAL = {
  error: 'You do not have permission to change product prices',
  code: 'product_price_edit_required',
} as const
