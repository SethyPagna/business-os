// N9 (loophole review 2026-10-06): who may record the money a cancellation
// records as lost, and who may remove it.
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
//     with a reason rather than queued.
//
// The fee has NO ceiling, by the owner's ruling (6 Oct 2026): a lost fee may
// exceed the sale total -- a delivery the shop paid for can cost more than the
// small sale it carried.
//
// Writers: PATCH /api/sales/:id/status (routes/sales.ts) and the grouped
// status change with its undo/redo (lib/saleBulkStatus.ts). The till mirrors
// the rule in frontend/src/utils/cancelFeeRules.ts.
import { getActionTier } from './permissions'
import type { SessionUser } from './auth'

export const CANCEL_FEE_ADD_DENIED_CODE = 'cancel_fee_requires_expense_add'
export const CANCEL_FEE_DELETE_DENIED_CODE = 'uncancel_requires_expense_delete'
export const CANCEL_FEE_MESSAGES = {
  [CANCEL_FEE_ADD_DENIED_CODE]: 'Recording a lost fee adds an expense, and your role cannot add expenses. Cancel without the fee, or ask an administrator. Nothing was changed.',
  [CANCEL_FEE_DELETE_DENIED_CODE]: 'Un-cancelling removes this sale\'s lost-fee expense, and your role cannot delete expenses. Ask an administrator. Nothing was changed.',
} as const
export type CancelFeeRefusalCode = keyof typeof CANCEL_FEE_MESSAGES

export function canRecordCancelFee(user: SessionUser): boolean {
  return getActionTier(user, 'fees', 'add') !== 'none'
}
export function canRemoveCancelFee(user: SessionUser): boolean {
  return getActionTier(user, 'fees', 'delete') === 'full'
}
