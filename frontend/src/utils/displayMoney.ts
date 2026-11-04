import { roundMoney2 } from './moneyPrecision.ts'
import { toFiniteNumber } from './pricing.ts'

/**
 * DISPLAYED money: the nearest cent, half away from zero, read from the exact decimal value (owner, 24 Sep 2026: normal
 * displayed money rounds to the nearest cent, never always up; internal money stays at four decimals). Tax of 2.161 reads
 * 2.16 and 2.165 reads 2.17. Rounding is a display step only: a stored or computed value is never passed back through it.
 *
 * This lives apart from utils/pricing.ts on purpose: pricing.ts is the 'pricing-utils' chunk that the storefront and the index
 * closure load, and the storefront never formats an amount through the app context (only the signed-in app's fmtUSD / fmtKHR and the
 * export chunks do), so these two functions ride the 'app-auth' chunk (vite.config.ts) and add nothing to the storefront boot path.
 */
export function roundDisplayMoney(value: unknown): number {
  const num = toFiniteNumber(value, 0)
  let rounded: number
  try { rounded = roundMoney2(num) } catch { rounded = Math.round(num * 100) / 100 }
  return Object.is(rounded, -0) ? 0 : rounded
}

/** Displayed money as a two-decimal string, rounded to the NEAREST cent (roundDisplayMoney). */
export function formatMoneyNumber(value: unknown): string {
  return roundDisplayMoney(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
