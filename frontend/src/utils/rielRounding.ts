// 100-riel physical-cash rounding (business rule, Aug 31 2026).
//
// 100៛ is the smallest note in circulation, so the cash a cashier physically
// COLLECTS from or RETURNS to a customer is handled in whole 100៛ steps. This
// is a COUNTER convenience only: the saved sale and the printed receipt always
// keep the EXACT calculation -- nothing here is persisted or printed.
//
// Directional matrix (confirmed by the business owner):
//   - Amount to collect, cash payment                   -> round DOWN to 100៛ (27 Oct 2026: cash riel is whole
//     100៛ notes, and a riel tender short by under 100៛ is fully paid)
//   - Amount to collect, non-cash walk-in sale          -> exact (no rounding)
//   - Amount to collect, non-cash payment on a delivery -> round UP to 100៛
//   - Change handed back to the customer (any sale)     -> round DOWN to 100៛

import { RIEL_CASH_STEP_KHR, rielCashFloor } from './saleStatusResolution.ts'

export const RIEL_STEP = RIEL_CASH_STEP_KHR

/** Down to whole 100៛ notes: the shared rielCashFloor (utils/saleStatusResolution.ts). */
export function roundRielDown(khr: number): number {
  return rielCashFloor(khr)
}

export function roundRielUp(khr: number): number {
  if (!Number.isFinite(khr) || khr <= 0) return 0
  return Math.ceil(khr / RIEL_STEP) * RIEL_STEP
}

/**
 * The KHR a cashier should physically COLLECT from the customer. Cash rounds
 * DOWN to whole 100៛ notes; a non-cash payment on a delivery order rounds UP;
 * a non-cash walk-in sale is collected at the exact whole-riel figure.
 */
export function cashierCollectKhr(
  totalKhr: number,
  opts: { isCashPayment: boolean; isWalkIn: boolean },
): number {
  const exact = Number.isFinite(totalKhr) && totalKhr > 0 ? Math.round(totalKhr) : 0
  if (opts.isCashPayment) return roundRielDown(exact)
  if (opts.isWalkIn) return exact
  return roundRielUp(exact)
}

/**
 * The KHR change a cashier should physically HAND BACK, always rounded DOWN to
 * the nearest 100៛ (the shop keeps the sub-100៛ remainder).
 */
export function cashierChangeKhr(changeKhr: number): number {
  return roundRielDown(changeKhr)
}
