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
// OPUS-H-1 (12 Oct 2026): the comparison and the stored column must be the SAME value. '1.0', 2,
// ' 1', 'yes', 'false' compared as "off" but were stored raw, and the till reads any truthy stored
// value as on, so a role without the price action could switch a dormant discount on (5.00 -> 2.50).
// So the switch and the kind are CANONICAL AT EVERY WRITE (normalizeProductDiscountBody at the routes,
// canonicalProductDiscountColumns in the shared writer): exactly 0/1 and 'percent'/'fixed', any other
// spelling refused with a coded 400 for every role. The comparison reads the stored row the way the
// readers do, and a stored value the readers disagree on can never compare as "unchanged".
//
// OPUS-H-2/H-3 (12 Oct 2026): the amounts were compared at 4 decimals but stored raw, so 10 -> 10.00004
// passed as "unchanged" and moved the till price (4.50 -> 4.49); '' and '0x0A' were stored as TEXT, which
// the SQL promoted predicate reads as > 0 while the till reads 0. The amounts are now stored as the exact
// number they were compared as (blank = null, anything that is not a plain decimal is a coded 400) and
// compared exactly; the start/end text is compared exactly too. The one tolerance is the product form's
// own rounding: keepStoredDiscountRendering drops an amount that is only the 4-decimal rendering of the
// stored one, so the stored value is kept and nothing is written.
export const PRODUCT_DISCOUNT_PRICE_FIELDS = [
  'discount_enabled', 'discount_type', 'discount_percent', 'discount_amount_usd', 'discount_amount_khr',
  'discount_starts_at', 'discount_ends_at',
] as const

type DiscountField = typeof PRODUCT_DISCOUNT_PRICE_FIELDS[number]
type Row = Record<string, unknown>

const DISCOUNT_AMOUNT_FIELDS = ['discount_percent', 'discount_amount_usd', 'discount_amount_khr'] as const
const DISCOUNT_WINDOW_FIELDS = ['discount_starts_at', 'discount_ends_at'] as const
// Plain ASCII decimal text: no spaces, no hex/octal/binary, no separators, no Infinity/NaN.
const DECIMAL_TEXT = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const finiteOrInvalid = (n: number) => Number.isFinite(n) ? (n === 0 ? 0 : n) : undefined

/** Write side: the exact stored 0/1 for a discount switch, or null when the spelling is refused. */
export function canonicalDiscountEnabled(value: unknown): 0 | 1 | null {
  if (value === undefined || value === null || value === false || value === 0 || value === '') return 0
  if (value === true || value === 1) return 1
  if (typeof value === 'string') {
    if (value === '0' || value.toLowerCase() === 'false') return 0
    if (value === '1' || value.toLowerCase() === 'true') return 1
  }
  return null
}

/** Write side: the exact stored kind ('percent' when blank, like every reader), or null when the spelling is refused. */
export function canonicalDiscountType(value: unknown): 'percent' | 'fixed' | null {
  if (value === undefined || value === null || value === '') return 'percent'
  if (typeof value !== 'string') return null
  const kind = value.toLowerCase()
  return kind === 'percent' || kind === 'fixed' ? kind : null
}

/** Write side: the exact number D1 will store for a discount amount (null when blank), or undefined when refused. */
export function canonicalDiscountAmount(value: unknown): number | null | undefined {
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number') return finiteOrInvalid(value)
  if (typeof value === 'string' && DECIMAL_TEXT.test(value)) return finiteOrInvalid(Number(value))
  return undefined
}

/** Write side: start/end text is stored as sent; anything that is not text or null is refused (undefined). */
export function canonicalDiscountWindow(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null
  return typeof value === 'string' ? value : undefined
}

// Read side. The till kernel (promotionRules.ts) reads the switch by truthiness and trims the kind; the SQL
// promoted predicate (promotionRulesSql.ts) reads `= 1` and lower() without trim. Only values both read the
// same way have a meaning; anything else is NONCANONICAL and compares as a change.
const NONCANONICAL = Symbol('noncanonical')
const INVALID = Symbol('invalid')
function storedDiscountEnabled(value: unknown): 0 | 1 | typeof NONCANONICAL {
  if (value === null || value === undefined || value === '' || value === 0) return 0
  if (value === 1) return 1
  return NONCANONICAL
}
// A REAL column holds a number or null; TEXT there ('' or '0x0A') reads as 0 on the till and > 0 in SQL.
function storedDiscountAmount(value: unknown): number | typeof NONCANONICAL {
  if (value === null || value === undefined) return 0
  return typeof value === 'number' && Number.isFinite(value) ? (value === 0 ? 0 : value) : NONCANONICAL
}
function storedDiscountWindow(value: unknown): string | typeof NONCANONICAL {
  if (value === null || value === undefined) return ''
  return typeof value === 'string' ? value : NONCANONICAL
}
function storedDiscountType(value: unknown): 'percent' | 'fixed' | typeof NONCANONICAL {
  if (value === null || value === undefined || value === '') return 'percent'
  if (typeof value !== 'string') return NONCANONICAL
  const kind = value.toLowerCase()
  return kind === 'percent' || kind === 'fixed' ? kind : NONCANONICAL
}

export const PRODUCT_DISCOUNT_INVALID = {
  discount_enabled: { code: 'invalid_discount_enabled', error: 'discount_enabled must be true, false, 1 or 0.' },
  discount_type: { code: 'invalid_discount_type', error: 'discount_type must be "percent" or "fixed".' },
  discount_percent: { code: 'invalid_discount_value', error: 'discount_percent must be a plain number.' },
  discount_amount_usd: { code: 'invalid_discount_value', error: 'discount_amount_usd must be a plain number.' },
  discount_amount_khr: { code: 'invalid_discount_value', error: 'discount_amount_khr must be a plain number.' },
  discount_starts_at: { code: 'invalid_discount_window', error: 'discount_starts_at must be text or empty.' },
  discount_ends_at: { code: 'invalid_discount_window', error: 'discount_ends_at must be text or empty.' },
} as const
type DiscountRefusal = { code: string; error: string; field: string }

export class ProductDiscountInputError extends Error {
  readonly status = 400
  constructor(readonly code: string, message: string, readonly field: string) { super(message); this.name = 'ProductDiscountInputError' }
}

function discountRefusal(field: string): DiscountRefusal {
  const known = PRODUCT_DISCOUNT_INVALID[field as keyof typeof PRODUCT_DISCOUNT_INVALID]
  return { ...known, field }
}

/** The canonical stored value of one discount column, or INVALID. Columns outside the canonical set pass through. */
function canonicalColumn(field: string, value: unknown): unknown {
  if (field === 'discount_enabled') return canonicalDiscountEnabled(value) ?? INVALID
  if (field === 'discount_type') return canonicalDiscountType(value) ?? INVALID
  if ((DISCOUNT_AMOUNT_FIELDS as readonly string[]).includes(field)) { const n = canonicalDiscountAmount(value); return n === undefined ? INVALID : n }
  if ((DISCOUNT_WINDOW_FIELDS as readonly string[]).includes(field)) { const t = canonicalDiscountWindow(value); return t === undefined ? INVALID : t }
  return value
}
const CANONICAL_FIELDS = PRODUCT_DISCOUNT_PRICE_FIELDS

/**
 * Rewrites every canonical discount column the body carries to its exact stored form and returns the coded
 * refusal for the first spelling that has none (the body is then left unchanged). Call it on every body that
 * reaches a product write, BEFORE the price gate, so the gate compares the value that will be stored.
 */
export function normalizeProductDiscountBody(body: Row): DiscountRefusal | null {
  const next: Row = {}
  for (const field of CANONICAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue
    const value = canonicalColumn(field, body[field])
    if (value === INVALID) return discountRefusal(field)
    next[field] = value
  }
  Object.assign(body, next)
  return null
}

/** The shared writer's guard (productWrites.cleanPayload): canonical in place, or a coded 400 error. */
export function canonicalProductDiscountColumns(payload: Row): void {
  const refusal = normalizeProductDiscountBody(payload)
  if (refusal) throw new ProductDiscountInputError(refusal.code, refusal.error, refusal.field)
}

function normalised(field: DiscountField, value: unknown, stored: boolean): string | number | symbol {
  switch (field) {
    case 'discount_enabled':
      return stored ? storedDiscountEnabled(value) : canonicalDiscountEnabled(value) ?? INVALID
    case 'discount_type':
      return stored ? storedDiscountType(value) : canonicalDiscountType(value) ?? INVALID
    case 'discount_starts_at':
    case 'discount_ends_at': {
      if (stored) return storedDiscountWindow(value)
      const text = canonicalDiscountWindow(value)
      return text === undefined ? INVALID : text ?? ''
    }
    default: {
      if (stored) return storedDiscountAmount(value)
      const n = canonicalDiscountAmount(value)
      return n === undefined ? INVALID : n ?? 0
    }
  }
}

const render4 = (n: number) => Math.round(n * 10000) / 10000
/**
 * The product form rounds the discount amounts it posts back to 4 decimals, so a stored amount with more
 * decimals (older data) comes back as its 4-decimal rendering. Such a value is not an edit: drop it from the
 * body so the stored value is kept and nothing is written. Never changes what the till reads.
 */
export function keepStoredDiscountRendering(stored: Row | null | undefined, body: Row): void {
  if (!stored) return
  for (const field of DISCOUNT_AMOUNT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue
    const next = canonicalDiscountAmount(body[field])
    const previous = stored[field]
    if (typeof next !== 'number' || typeof previous !== 'number' || !Number.isFinite(previous) || next === previous) continue
    if (render4(next) === next && render4(previous) === next) delete body[field]
  }
}

/**
 * True when the body writes a discount price field to a value other than the stored one. `before` is
 * the stored row (a PUT) or null (a create, where the stored state is "no discount"). A field the body
 * does not carry is not a change. A refused spelling, or a stored value the readers disagree on, is
 * always a change (fail closed).
 */
export function productDiscountChanged(before: Row | null | undefined, body: Row): boolean {
  return PRODUCT_DISCOUNT_PRICE_FIELDS.some((field) => {
    if (!Object.prototype.hasOwnProperty.call(body, field)) return false
    const next = normalised(field, body[field], false)
    const previous = normalised(field, before ? before[field] : null, true)
    return typeof next === 'symbol' || typeof previous === 'symbol' || next !== previous
  })
}

export const PRODUCT_DISCOUNT_SELECT = PRODUCT_DISCOUNT_PRICE_FIELDS.join(', ')

export const PRODUCT_DISCOUNT_PRICE_REFUSAL = {
  error: 'You do not have permission to change product prices',
  code: 'product_price_edit_required',
} as const
