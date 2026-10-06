// N9 (SEC-SALES, loophole review 2026-10-06): the till's mirror of the
// Worker's lost-fee rule (cloudflare/src/lib/cancelFeeRules.ts).
//
// Recording a lost fee while cancelling a sale adds an expense, so it needs
// Expenses -> Add; un-cancelling a sale that has one deletes that expense, so
// it needs Expenses -> Delete at Full access; and the fee may not exceed the
// sale's total (USD plus riel at the sale's own rate, within half a cent).
// cancelFeeWithinSaleTotal is the Worker's function verbatim;
// tests/cancelFeeRules.test.ts pins the two copies to the same answers.

/** The Worker's refusal codes; each is also the pack key the till shows. */
export const CANCEL_FEE_REFUSAL_CODES = ['cancel_fee_exceeds_sale_total', 'cancel_fee_requires_expense_add', 'uncancel_requires_expense_delete'] as const

const PAID_IN_FULL_TOLERANCE_USD = 0.005

/** True when the fee (USD + riel at the sale's rate) is within the sale's total. */
export function cancelFeeWithinSaleTotal(input: { feeUsd: number; feeKhr: number; saleTotalUsd: number; exchangeRate: number }): boolean {
  const rate = Number(input.exchangeRate) > 0 ? Number(input.exchangeRate) : 4100
  const feeUsd = Math.max(0, Number(input.feeUsd) || 0) + Math.max(0, Number(input.feeKhr) || 0) / rate
  return feeUsd <= Math.max(0, Number(input.saleTotalUsd) || 0) + PAID_IN_FULL_TOLERANCE_USD
}

/** The typed fee fields of one cancellation against the sale they cancel. */
export function cancelFieldsFeeWithinSale(fields: { cancel_fee_usd: string; cancel_fee_khr: string }, sale: { total_usd?: unknown; exchange_rate?: unknown }): boolean {
  return cancelFeeWithinSaleTotal({
    feeUsd: Number(fields.cancel_fee_usd) || 0,
    feeKhr: Number(fields.cancel_fee_khr) || 0,
    saleTotalUsd: Number(sale.total_usd) || 0,
    exchangeRate: Number(sale.exchange_rate) || 0,
  })
}

/** The pack key for a lost-fee refusal from the Worker, or null for any other error. */
export function cancelFeeRefusalKey(code: unknown): string | null {
  return typeof code === 'string' && (CANCEL_FEE_REFUSAL_CODES as readonly string[]).includes(code) ? code : null
}
