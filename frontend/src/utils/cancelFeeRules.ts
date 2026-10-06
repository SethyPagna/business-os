// N9 (SEC-SALES, loophole review 2026-10-06): the till's mirror of the
// Worker's lost-fee rule (cloudflare/src/lib/cancelFeeRules.ts).
//
// Recording a lost fee while cancelling a sale adds an expense, so it needs
// Expenses -> Add; un-cancelling a sale that has one deletes that expense, so
// it needs Expenses -> Delete at Full access. The fee has no ceiling: the
// owner ruled (6 Oct 2026) that a lost fee may exceed the sale total.
// tests/cancelFeeRules.test.ts pins the till to the Worker's refusal codes.

/** The Worker's refusal codes; each is also the pack key the till shows. */
export const CANCEL_FEE_REFUSAL_CODES = ['cancel_fee_requires_expense_add', 'uncancel_requires_expense_delete'] as const

/** The pack key for a lost-fee refusal from the Worker, or null for any other error. */
export function cancelFeeRefusalKey(code: unknown): string | null {
  return typeof code === 'string' && (CANCEL_FEE_REFUSAL_CODES as readonly string[]).includes(code) ? code : null
}
