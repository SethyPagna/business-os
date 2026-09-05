// Display-only money formatting for the Reports hub, driven by the
// `display_currency` setting (USD / KHR / BOTH) — the same persisted setting
// `formatPrice` reads, and deliberately SEPARATE from the sale/change
// exchange rates (user, Aug 31 2026: "just one source of truth but shown
// differently based on the settings ... this is different from the exchange
// rates for sale and change").
//
// The invariant that makes this safe: the row's RAW stored amounts
// (`amount_usd` + `amount_khr` for fees, `refund_usd` + `refund_khr` for
// returns, `revenue_usd` for sales) are the ONE source of truth. This
// function NEVER mutates or persists anything and NEVER chains a previously
// converted value — every render recomputes straight from the raw pair. So
// toggling the setting USD -> KHR -> BOTH -> USD is lossless: you always get
// the original figure back, because nothing downstream of the raw pair is
// ever stored. Conversion (for the single-currency USD/KHR views) uses the
// MAIN exchange rate via khrToUsd/usdToKhr, exactly like every other display
// conversion in the app.

import { actualUsdValue } from './financialPrecision.ts'

export interface ReportMoneyDeps {
  /** The persisted display_currency setting, any case ('USD'|'KHR'|'BOTH'). */
  displayCurrency: string
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
  khrToUsd: (value: unknown) => number
  usdToKhr: (value: unknown) => number
}

/**
 * Render a row's raw (usd, khr) amounts per the display_currency setting.
 * Fees/returns rows are single-currency (one of usd/khr is 0); sales pass
 * (revenue_usd, 0). In BOTH mode nothing is converted — each non-zero raw
 * amount is shown as-is ("$X · Y៛"), so BOTH is always rate-independent.
 */
export function formatReportMoney(usd: number, khr: number | undefined, deps: ReportMoneyDeps): string {
  const u = Number(usd) || 0
  const k = Number(khr) || 0
  const cur = String(deps.displayCurrency || 'usd').trim().toLowerCase()
  if (cur === 'khr') return deps.fmtKHR(k + (deps.usdToKhr(u) || 0))
  if (cur === 'both') {
    const parts: string[] = []
    if (u) parts.push(deps.fmtUSD(u))
    if (k) parts.push(deps.fmtKHR(k))
    return parts.length ? parts.join(' · ') : deps.fmtUSD(0)
  }
  // usd (default): fold any KHR portion into USD at the main rate.
  // Reports use ordinary nearest-cent display rounding. Quantize the final
  // folded value exactly once, at this display boundary, before handing it to
  // the global pricing formatter (which intentionally rounds prices upward).
  // Do not round the USD and converted-KHR portions separately: that creates
  // double-rounding artifacts and can move the displayed total by a cent.
  return deps.fmtUSD(actualUsdValue(u + (deps.khrToUsd(k) || 0)))
}

/** Curry the deps once per render so callers just pass (usd, khr?). `khr`
 * defaults to 0 so USD-canonical figures (sales revenue/profit) can call
 * `fmtMoney(x)` and still honor the setting. */
export function makeReportMoneyFormatter(deps: ReportMoneyDeps): (usd: number, khr?: number) => string {
  return (usd: number, khr?: number) => formatReportMoney(usd, khr, deps)
}
