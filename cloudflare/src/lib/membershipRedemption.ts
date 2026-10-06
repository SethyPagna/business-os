// N14 (loophole review 2026-10-06): the dollar value of redeemed membership
// points is the Worker's to compute, not the till's to assert.
//
// POST /api/sales checked that the customer HAD the points, then booked
// whatever membership_discount_usd the request carried -- so a request
// redeeming 100 points could take $500 off. The value is now
//   units = points redeemed / customer_portal_redeem_points  (whole units)
//   discount = units x customer_portal_redeem_value_usd       (4 decimals)
// exactly as the till's v1 basket computes it (POS.tsx handleMembershipUnits:
// parseInt(redeem_points || '100') || 100, at least 1; the value parsed at
// four decimals with '1' when unset). A request whose discount differs is
// refused rather than silently repriced: the till showed the customer a
// total, and recording a different one is a money difference at the counter.
// The riel figure is derived from the USD value at the sale's rate, the
// same multiplication the till does, never taken from the request.
//
// Dormant while membership points are switched off: POST /api/sales refuses
// any redemption before this runs, and a sale with no redemption books $0.
//
// ONE READER for the value per unit (owner ruling, 6 Oct 2026):
// redeemValueUsdPerUnit is how both the sale route and the customer portal
// (routes/portal.ts buildPortalConfig) read customer_portal_redeem_value_usd,
// so the value a member is shown is the value a redemption is booked at. The
// portal used to round it to whole dollars, so a $0.50 unit showed as $1.
import { multiplyMoney4, roundMoney4 } from './moneyPrecision'

export const MEMBERSHIP_DISCOUNT_MISMATCH_CODE = 'membership_discount_mismatch'
export const MEMBERSHIP_DISCOUNT_MISMATCH_MESSAGE = 'The membership discount does not match the points redeemed. Refresh the till and redeem the points again. Nothing was recorded.'

export type MembershipRedemptionInput = {
  pointsRedeemed: number
  claimedDiscountUsd: number
  redeemPointsSetting: unknown
  redeemValueUsdSetting: unknown
  exchangeRate: number
}

/**
 * The configured USD value of one redemption unit, at four decimals: '1' when
 * the setting is absent, 0 when it is blank, null when it is negative or not a
 * number (no redemption can be valued from it).
 */
export function redeemValueUsdPerUnit(setting: unknown): number | null {
  const valueText = String(setting ?? '1').trim()
  if (valueText.startsWith('-')) return null
  if (!valueText) return 0
  try {
    return roundMoney4(valueText)
  } catch {
    return null
  }
}

/** The server's value for a redemption, or null when the request's claim is not it. */
export function membershipRedemptionDiscount(input: MembershipRedemptionInput): { discountUsd: number; discountKhr: number } | null {
  const pointsPerUnit = Math.max(1, parseInt(String(input.redeemPointsSetting || '100'), 10) || 100)
  const units = input.pointsRedeemed / pointsPerUnit
  if (!Number.isSafeInteger(units) || units <= 0) return null
  const valuePerUnit = redeemValueUsdPerUnit(input.redeemValueUsdSetting)
  if (valuePerUnit === null) return null
  let discountUsd: number
  try {
    discountUsd = multiplyMoney4(valuePerUnit, units)
  } catch {
    return null
  }
  if (discountUsd !== input.claimedDiscountUsd) return null
  return { discountUsd, discountKhr: multiplyMoney4(discountUsd, input.exchangeRate) }
}
