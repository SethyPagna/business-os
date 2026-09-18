import { normalizeTypedDate } from './batchCode.ts'

/** Optional fields preserve unknown payment facts in drafts saved before P10-18. */
export type SessionPayment = {
  paymentStatus?: 'paid' | 'credit' | null
  creditDueDate?: string
}

export function sessionPaymentDueInvalid(payment: SessionPayment, quantity: number): boolean {
  return quantity > 0 && payment.paymentStatus === 'credit' && !normalizeTypedDate(payment.creditDueDate)
}

export function sessionPaymentFields(payment: SessionPayment) {
  return {
    payment_status: payment.paymentStatus === 'paid' || payment.paymentStatus === 'credit' ? payment.paymentStatus : null,
    credit_due_date: payment.paymentStatus === 'credit' ? normalizeTypedDate(payment.creditDueDate) : null,
  }
}
