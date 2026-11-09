// Migration 0298 aborts any UPDATE that reopens a cancelled sale whose online order has a refund_noted Record ("online_refund_noted: ..."). The sale status is written by
// the Sales page, the bulk status action and the history replay of both; every one of them classifies a D1 failure through productStockGuardError, which returns this error so
// the caller answers 409 with a stable code instead of an opaque 500.
export const ONLINE_REFUND_NOTED_CODE = 'online_refund_noted'

export class OnlineRefundNotedError extends Error {
  readonly code = ONLINE_REFUND_NOTED_CODE
  readonly status = 409
  constructor() {
    super('This sale was cancelled and its online payment was refunded through ABA, so it cannot be reopened. Ring a new sale instead.')
    this.name = 'OnlineRefundNotedError'
  }
}
