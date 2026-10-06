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
//
// Delta review, 6 Oct 2026: the gate and the writer must see the SAME value. Every reader of
// discount_enabled treats any truthy stored value as on, and the POS reads discount_type exactly,
// so a value the gate called "unchanged" but the column stored differently ('1.0', ' 1', 2, 'yes',
// 'fixed ') activated a discount for a role without the price action. So the two columns are now
// NORMALISED AT THE WRITE BOUNDARY (normalizeProductDiscountBody) to exactly 0/1 and
// 'percent'/'fixed', anything else is refused, and the comparison below uses the same functions.
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

/** The exact 0/1 for a discount_enabled value, or null when it is not a recognised on/off spelling. */
export function normalizeDiscountEnabled(value: unknown): 0 | 1 | null {
  if (value === undefined || value === null || value === false || value === 0) return 0
  if (value === true || value === 1) return 1
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (text === '' || text === '0' || text === 'false') return 0
    if (text === '1' || text === 'true') return 1
  }
  return null
}

/** The exact enum for a discount_type value ('percent' when blank, like every reader), or null when unrecognised. */
export function normalizeDiscountType(value: unknown): 'percent' | 'fixed' | null {
  if (value === undefined || value === null) return 'percent'
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  if (text === '' || text === 'percent') return 'percent'
  if (text === 'fixed') return 'fixed'
  return null
}

export const PRODUCT_DISCOUNT_INVALID = {
  discount_enabled: { code: 'invalid_discount_enabled', error: 'discount_enabled must be true, false, 1 or 0.' },
  discount_type: { code: 'invalid_discount_type', error: 'discount_type must be "percent" or "fixed".' },
} as const

/**
 * Rewrites discount_enabled and discount_type in `body` to their exact stored forms (only the keys the body carries)
 * and returns the refusal for an unrecognised value, or null. Call it on every body that reaches a products write,
 * BEFORE the price gate, so the gate and the stored column agree.
 */
export function normalizeProductDiscountBody(body: Row): typeof PRODUCT_DISCOUNT_INVALID[keyof typeof PRODUCT_DISCOUNT_INVALID] | null {
  if (Object.prototype.hasOwnProperty.call(body, 'discount_enabled')) {
    const enabled = normalizeDiscountEnabled(body.discount_enabled)
    if (enabled === null) return PRODUCT_DISCOUNT_INVALID.discount_enabled
    body.discount_enabled = enabled
  }
  if (Object.prototype.hasOwnProperty.call(body, 'discount_type')) {
    const type = normalizeDiscountType(body.discount_type)
    if (type === null) return PRODUCT_DISCOUNT_INVALID.discount_type
    body.discount_type = type
  }
  return null
}

function normalised(field: DiscountField, value: unknown): string | number {
  switch (field) {
    case 'discount_enabled': {
      // An unrecognised spelling can never equal a stored 0/1, so it reads as a change (fail closed).
      const enabled = normalizeDiscountEnabled(value)
      return enabled === null ? `invalid:${String(value)}` : enabled
    }
    case 'discount_type': {
      const type = normalizeDiscountType(value)
      return type === null ? `invalid:${String(value)}` : type
    }
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

/** The columns a price-gate comparison reads from a stored product row. */
export const PRODUCT_DISCOUNT_SELECT = PRODUCT_DISCOUNT_PRICE_FIELDS.join(', ')

export const PRODUCT_DISCOUNT_PRICE_REFUSAL = {
  error: 'You do not have permission to change product prices',
  code: 'product_price_edit_required',
} as const
