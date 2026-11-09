import { parseShiftCount, shiftCountPairBlocker, type ShiftCountBlocker } from '../../api/shiftTransport.ts'
import { rielCashAmountValid } from '../../utils/saleStatusResolution.ts'

/**
 * The riel-cash rule for a shift count typed into a form (owner, 27 Oct 2026: riel cash is whole 100-riel notes, and the Worker refuses
 * the rest with riel_cash_not_hundreds). It lives HERE, with the shift forms that ask the question, and not in api/shiftTransport.ts:
 * that transport is bundled into app-api-methods, which every page including the storefront loads, and importing the shared riel rule
 * (utils/saleStatusResolution.ts, the money-core chunk) from it put money-core into the storefront and index closures. Only the till,
 * shift and sale code imports the rule; chunkBoundaryPolicy --bundle keeps money-core out of the boot closures.
 */
export type ShiftCountIssue = ShiftCountBlocker | 'riel_cash'

/** A riel count that is not whole 100-riel notes. A count stored before the rule and left unchanged (`storedKhr`) is kept. */
export function shiftRielCountInvalid(khr: unknown, storedKhr?: unknown): boolean {
  if (typeof khr === 'string' && khr.trim() === '') return false
  const typed = parseShiftCount(khr)
  if (typed != null && storedKhr != null && storedKhr !== '' && Math.abs(typed - Number(storedKhr)) < 0.5) return false
  return !rielCashAmountValid(khr)
}

/**
 * shiftCountPairBlocker's answer, then the riel rule: why a two-currency count cannot be submitted yet, or null when it can. A blank or
 * invalid entry is reported first, exactly as before the riel rule.
 */
export function shiftCountIssue(
  usd: unknown,
  khr: unknown,
  options: { blankMeansUncounted?: boolean; storedKhr?: unknown } = {},
): ShiftCountIssue | null {
  const blocker = shiftCountPairBlocker(usd, khr, options)
  if (blocker) return blocker
  return shiftRielCountInvalid(khr, options.storedKhr) ? 'riel_cash' : null
}
