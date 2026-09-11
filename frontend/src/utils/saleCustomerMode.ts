export type SaleCustomerMode = 'denied' | 'assignment' | 'name-only'

export function saleCustomerMode(canEdit: boolean, canReassign: boolean): SaleCustomerMode {
  return !canEdit ? 'denied' : canReassign ? 'assignment' : 'name-only'
}

// Every lookup/write captures this ticket. Closing, another sale/query, or a
// meaningful security change invalidates old callbacks without resetting on
// ordinary profile/name refreshes (the caller uses its stable security scope).
export function customerRequestIsCurrent(ticket: { security: string; generation: number }, security: string, generation: number): boolean {
  return ticket.security === security && ticket.generation === generation
}
