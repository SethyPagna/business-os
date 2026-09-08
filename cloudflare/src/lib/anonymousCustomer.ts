export const ANONYMOUS_CUSTOMER_ERROR_CODE = 'anonymous_customer_immutable'

export const ANONYMOUS_CUSTOMER_MUTATION_ERROR =
  'This is an anonymous checkout identity, not an editable customer profile. Link the sale to a real customer instead.'

type AnonymousCustomerRow = { is_anonymous?: unknown } | null | undefined

/**
 * The persisted marker is the only authority. Names, phone blanks, membership
 * values, and row ids are deliberately excluded: each has already identified
 * both real customers and legacy anonymous checkout rows.
 */
export function isAnonymousCustomer(row: AnonymousCustomerRow): boolean {
  return Number(row?.is_anonymous ?? 0) === 1
}

export function customerIsAnonymousSql(alias = ''): string {
  if (alias && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error('Invalid SQL alias for anonymous-customer predicate')
  }
  return `COALESCE(${alias ? `${alias}.` : ''}is_anonymous, 0) = 1`
}

export function customerIsProfileSql(alias = ''): string {
  return `NOT (${customerIsAnonymousSql(alias)})`
}
