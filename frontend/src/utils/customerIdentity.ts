export type CustomerIdentityFields = {
  customer_is_anonymous?: unknown
  is_anonymous?: unknown
} | null | undefined

// Anonymous customer authority is an explicit server-owned marker. Names,
// phone numbers, membership values and historical ids are deliberately not
// considered: real customers can share placeholder-looking names.
export function isAnonymousCustomerIdentity(customer: CustomerIdentityFields): boolean {
  const marker = customer?.customer_is_anonymous ?? customer?.is_anonymous
  return marker === true || marker === 1
}

export function isSelectableCustomerIdentity(customer: CustomerIdentityFields): boolean {
  return !isAnonymousCustomerIdentity(customer)
}

export type SaleCustomerEditorRoute = 'assignment' | 'load-profile' | 'profile'

export function resolveSaleCustomerEditorRoute(
  sale: CustomerIdentityFields & { customer_id?: unknown },
  currentCustomer?: CustomerIdentityFields,
): SaleCustomerEditorRoute {
  if (isAnonymousCustomerIdentity(sale)) return 'assignment'
  const customerId = Number(sale?.customer_id)
  if (!Number.isSafeInteger(customerId) || customerId <= 0) return 'assignment'
  if (currentCustomer === undefined) return 'load-profile'
  return isAnonymousCustomerIdentity(currentCustomer) ? 'assignment' : 'profile'
}

export function filterSelectableCustomerRows<T extends CustomerIdentityFields>(rows: readonly T[]): T[] {
  return rows.filter(isSelectableCustomerIdentity)
}

export function resolveSelectableCustomerById<T extends CustomerIdentityFields & { id?: unknown }>(
  rows: readonly T[],
  id: unknown,
): T | null {
  const wanted = String(id ?? '')
  if (!wanted) return null
  return rows.find((row) => String(row?.id ?? '') === wanted && isSelectableCustomerIdentity(row)) ?? null
}
