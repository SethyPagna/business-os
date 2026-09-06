// The ONE rule for a delivery money field typed by a person (N41).
//
// A sale carries two delivery numbers and the owner asked (Sep 6 2026) for
// both to be editable from the sale detail: "i see the delivery fees it should
// show options to change delivery actual cost and the delivery fees. both."
//
//   delivery_fee_usd          what the CUSTOMER is charged. Part of the total.
//   delivery_actual_cost_usd  what the SHOP paid the courier. Never on a
//                             receipt; it feeds the profit kernel
//                             (salesAnalytics.ts's deliveryActualCostExpr).
//
// Both are money a cashier types, so both get the same acceptance rule, and
// that rule has to be the SAME rule in the browser and in the Worker -- a form
// that accepts "-2" in front of a server that refuses it is a failed save with
// no explanation, and a form that refuses what the server accepts is a feature
// nobody can reach.
//
// This module is deliberately dependency-free and mirrored byte-for-behaviour
// at frontend/src/utils/deliveryAmounts.ts; the two packages do not import each
// other, so frontend/tests/deliveryAmountParity.test.ts runs BOTH copies over
// the same matrix and fails when they disagree. Same shape, and for the same
// reason, as lib/branchRoles.ts <-> utils/branchRoles.ts.
//
// KHR is NOT validated here. The riel figure for both fields is derived
// server-side from the USD value and the reviewed exchange rate (see
// saleAmendments.ts's calculatedKhr), never accepted from a client, so
// "currency-consistent" is a structural property rather than a check that
// could be forgotten.

/** Why a typed delivery amount was refused. One code per distinct sentence. */
export type DeliveryAmountError = 'blank' | 'not_a_number' | 'negative' | 'too_large'

export type DeliveryAmountResult =
  | { ok: true; usd: number }
  | { ok: false; code: DeliveryAmountError }

/**
 * A delivery amount can be large (a bulk run) but not absurd. The ceiling
 * exists so a mistyped "2500000" -- a riel figure typed into a dollar field,
 * which is the realistic slip here -- is refused at the point of entry instead
 * of landing in the profit kernel as a million-dollar courier bill.
 */
export const MAX_DELIVERY_AMOUNT_USD = 1_000_000

/**
 * Parse and validate one typed delivery amount.
 *
 * Zero IS valid and means zero: a free delivery has a $0 fee, and a courier
 * run the shop did itself has a $0 actual cost. Blank is a separate answer
 * ("nothing typed"), so the caller can leave a field alone rather than writing
 * a zero the person never chose.
 */
export function parseDeliveryAmountUsd(raw: unknown): DeliveryAmountResult {
  const text = typeof raw === 'string' ? raw.trim() : raw === null || raw === undefined ? '' : String(raw).trim()
  if (text === '') return { ok: false, code: 'blank' }
  const value = Number(text)
  if (!Number.isFinite(value)) return { ok: false, code: 'not_a_number' }
  if (value < 0) return { ok: false, code: 'negative' }
  if (value > MAX_DELIVERY_AMOUNT_USD) return { ok: false, code: 'too_large' }
  // Round the way every other money value in this codebase rounds, so the
  // number the form shows is the number the ledger stores.
  return { ok: true, usd: Math.round((value + Number.EPSILON) * 100) / 100 }
}

/** Cents, or null for "no value recorded". Exported only for the parity test. */
export function deliveryAmountCents(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const text = typeof value === 'string' ? value.trim() : String(value).trim()
  if (text === '') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? Math.round((parsed + Number.EPSILON) * 100) : null
}

/**
 * True when the two amounts describe a change worth writing.
 *
 * Compared at cent precision, because `1.004` and `1.0049` both store as 1.00
 * and a "change" that stores the same number is a ledger entry saying nothing
 * happened.
 *
 * NULL is its own value, not another way of writing zero. `sales.delivery_actual_cost_usd`
 * is NULL when nobody ever recorded a courier cost and 0 when someone recorded
 * that it cost nothing -- salesAnalytics.ts counts those apart
 * (delivery_actual_cost_count) so a near-empty column reads as missing data
 * rather than free delivery. So NULL -> 0 IS a change and gets a record.
 */
export function deliveryAmountChanged(beforeUsd: unknown, afterUsd: unknown): boolean {
  return deliveryAmountCents(beforeUsd) !== deliveryAmountCents(afterUsd)
}

/**
 * The sentence for each refusal. The browser renders its own translated
 * string (utils/deliveryAmounts.ts's DELIVERY_AMOUNT_ERROR_KEYS); this is what
 * a direct API caller -- or a browser whose pack is missing the key -- reads,
 * and it exists here so the Worker's four 400s are one list rather than four
 * hand-written strings that drift apart.
 */
export const DELIVERY_AMOUNT_ERROR_MESSAGES: Record<DeliveryAmountError, string> = {
  blank: 'Enter a delivery amount.',
  not_a_number: 'A delivery amount must be a number.',
  negative: 'A delivery amount must be zero or more.',
  too_large: `A delivery amount must be ${MAX_DELIVERY_AMOUNT_USD} or less.`,
}
