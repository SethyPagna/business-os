// 100-riel physical-cash rounding (business rule, Aug 31 2026).
//
// 100៛ is the smallest note in circulation, so the cash a cashier physically
// COLLECTS from or RETURNS to a customer is handled in whole 100៛ steps. This
// is a COUNTER convenience only: the saved sale and the printed receipt always
// keep the EXACT calculation -- nothing here is persisted or printed.
//
// Directional matrix (confirmed by the business owner):
//   - Amount to collect, cash payment OR walk-in sale   -> exact (no rounding)
//   - Amount to collect, non-cash payment on a delivery -> round UP to 100៛
//   - Change handed back to the customer (any sale)     -> round DOWN to 100៛

export const RIEL_STEP = 100

export function roundRielDown(khr: number): number {
  if (!Number.isFinite(khr) || khr <= 0) return 0
  return Math.floor(khr / RIEL_STEP) * RIEL_STEP
}

export function roundRielUp(khr: number): number {
  if (!Number.isFinite(khr) || khr <= 0) return 0
  return Math.ceil(khr / RIEL_STEP) * RIEL_STEP
}

/**
 * The KHR a cashier should physically COLLECT from the customer. Rounds UP to
 * the nearest 100៛ only for a non-cash payment on a delivery order; a cash
 * payment, or any walk-in sale, is collected at the exact whole-riel figure.
 */
export function cashierCollectKhr(
  totalKhr: number,
  opts: { isCashPayment: boolean; isWalkIn: boolean },
): number {
  const exact = Number.isFinite(totalKhr) && totalKhr > 0 ? Math.round(totalKhr) : 0
  if (opts.isCashPayment || opts.isWalkIn) return exact
  return roundRielUp(exact)
}

/**
 * The KHR change a cashier should physically HAND BACK, always rounded DOWN to
 * the nearest 100៛ (the shop keeps the sub-100៛ remainder).
 */
export function cashierChangeKhr(changeKhr: number): number {
  return roundRielDown(changeKhr)
}
