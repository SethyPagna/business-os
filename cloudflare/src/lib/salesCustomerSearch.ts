import { buildContactMatchClause, type ContactMatchClause } from './contactSearch'

// The Sales/POS picker searches exactly like the Contacts directory: the digit and separator handling of a typed number lives in
// buildContactMatchClause, so the two surfaces cannot disagree about who a number names.
export function buildSalesCustomerMatchClause(rawSearch: unknown): ContactMatchClause | undefined {
  return buildContactMatchClause('customers', rawSearch, 'picker')
}
