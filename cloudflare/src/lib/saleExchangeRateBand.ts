// N15 (loophole review 2026-10-06): POST /api/sales books the exchange rate
// the till quoted, because the cart's riel figures were computed with it and
// the owner's rule is that a rate change applies only from that moment on.
// The Worker used to accept ANY positive rate, so a scripted or tampered
// request could value riel tender at whatever rate it liked.
//
// The till never lets a person type this rate -- it is the Settings rate,
// frozen with the cart -- so a legitimate quote differs from the current
// Settings rate only when the owner changed the rate while a cart was open
// (or while a checkout awaited retry). The band is wide enough for that and
// narrow enough that a request cannot materially revalue riel:
//
//   5% of 4,100 is 205 riel. The riel has held within a few percent of
//   4,000-4,100 per dollar for years and the shop moves its rate in small
//   steps, so one Settings change never approaches 5%; a typo (41,000 or 410)
//   or a deliberate revaluation lands far outside it.
//
// Owner decision defaulted by lane SEC-SALES: the 5% width. Change it here.
export const SALE_EXCHANGE_RATE_BAND = 0.05
export const EXCHANGE_RATE_OUT_OF_RANGE_CODE = 'exchange_rate_out_of_range'
export const EXCHANGE_RATE_OUT_OF_RANGE_MESSAGE = 'The exchange rate on this sale is too far from the rate in Settings. Refresh the till and ring the sale again. Nothing was recorded.'

/** True when a till's quoted rate sits inside the band around the Settings rate. */
export function saleExchangeRateWithinBand(quotedRate: number, settingsRate: number): boolean {
  if (!Number.isFinite(quotedRate) || quotedRate <= 0) return false
  if (!Number.isFinite(settingsRate) || settingsRate <= 0) return false
  return Math.abs(quotedRate - settingsRate) <= settingsRate * SALE_EXCHANGE_RATE_BAND
}
