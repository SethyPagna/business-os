export function toFiniteNumber(value: unknown, fallback?: number): number
export function roundUpToDecimals(value: unknown, decimals?: number): number
export function normalizePriceValue(value: unknown, fallback?: number): number
export function formatPriceNumber(value: unknown): string
export function normalizeDiscountPercent(value: unknown): number
export function normalizeDiscountType(value: unknown): 'fixed' | 'percent'
export function isProductDiscountActive(product?: Record<string, unknown>, now?: Date | string | number): boolean
export function calculateProductDiscount(product?: Record<string, unknown>, exchangeRate?: number): {
  active: boolean
  applied_price_usd: number
  applied_price_khr: number
  discount_amount_usd: number
  discount_amount_khr: number
  percent_off: number
}
