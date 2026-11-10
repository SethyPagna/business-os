import { buildContactMatchClause, type ContactMatchClause } from './contactSearch'
import type { PhoneSearchAccess } from './phoneSearchGuard'

// The Sales/POS picker searches exactly like the Contacts directory: the digit and separator handling of a typed number lives in
// buildContactMatchClause, so the two surfaces cannot disagree about who a number names.
export function buildSalesCustomerMatchClause(rawSearch: unknown, access: PhoneSearchAccess): ContactMatchClause | undefined {
  return buildContactMatchClause('customers', rawSearch, 'picker', access)
}
