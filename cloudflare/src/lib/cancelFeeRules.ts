// N9 (loophole review 2026-10-06): the money a cancellation records as lost.
//
// Cancelling a sale may record a "lost fee" -- e.g. a delivery fee the shop
// already paid that the buyer refused to cover -- as a linked row on the
// Expenses page, and un-cancelling deletes that row again. Both used to need
// only the Sales status permission, and the fee had no ceiling, so a role
// that may not touch Expenses could book any expense, or remove one, through
// a sale. Every writer of that row now asks the Expenses questions:
//
//   - recording the fee needs Expenses -> Add, the same gate as POST /api/fees
//     (routes/fees.ts: any tier but none, per-action override honoured);
//   - removing it needs Expenses -> Delete at FULL access. routes/fees.ts
//     queues a Review-tier delete for approval instead, and a cancellation
//     cannot be half-reverted while its expense waits, so Review is refused
//     with a reason rather than queued;
//   - the fee cannot exceed what the sale was worth: USD plus riel at the
//     sale's own rate, within the half-cent the shop treats as paid in full.
//
// Writers: PATCH /api/sales/:id/status (routes/sales.ts) and the grouped
// status change with its undo/redo (lib/saleBulkStatus.ts). The till mirrors
// the rule in frontend/src/utils/cancelFeeRules.ts.
import { getActionTier } from './permissions'
import type { SessionUser } from './auth'

export const CANCEL_FEE_EXCEEDS_SALE_CODE = 'cancel_fee_exceeds_sale_total'
export const CANCEL_FEE_ADD_DENIED_CODE = 'cancel_fee_requires_expense_add'
export const CANCEL_FEE_DELETE_DENIED_CODE = 'uncancel_requires_expense_delete'
export const CANCEL_FEE_MESSAGES = {
  [CANCEL_FEE_EXCEEDS_SALE_CODE]: 'The lost fee cannot be more than the sale total. Nothing was changed.',
  [CANCEL_FEE_ADD_DENIED_CODE]: 'Recording a lost fee adds an expense, and your role cannot add expenses. Cancel without the fee, or ask an administrator. Nothing was changed.',
  [CANCEL_FEE_DELETE_DENIED_CODE]: 'Un-cancelling removes this sale\'s lost-fee expense, and your role cannot delete expenses. Ask an administrator. Nothing was changed.',
} as const
export type CancelFeeRefusalCode = keyof typeof CANCEL_FEE_MESSAGES

const PAID_IN_FULL_TOLERANCE_USD = 0.005

export function canRecordCancelFee(user: SessionUser): boolean {
  return getActionTier(user, 'fees', 'add') !== 'none'
}
export function canRemoveCancelFee(user: SessionUser): boolean {
  return getActionTier(user, 'fees', 'delete') === 'full'
}

/** True when the fee (USD + riel at the sale's rate) is within the sale's total. */
export function cancelFeeWithinSaleTotal(input: { feeUsd: number; feeKhr: number; saleTotalUsd: number; exchangeRate: number }): boolean {
  const rate = Number(input.exchangeRate) > 0 ? Number(input.exchangeRate) : 4100
  const feeUsd = Math.max(0, Number(input.feeUsd) || 0) + Math.max(0, Number(input.feeKhr) || 0) / rate
  return feeUsd <= Math.max(0, Number(input.saleTotalUsd) || 0) + PAID_IN_FULL_TOLERANCE_USD
}
