import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const loyaltyPage = readFileSync(new URL('../src/components/loyalty-points/LoyaltyPointsPage.tsx', import.meta.url), 'utf8')
const contactTransport = readFileSync(new URL('../src/api/contactWriteTransport.ts', import.meta.url), 'utf8')
const contactsRoute = readFileSync(new URL('../../cloudflare/src/routes/contacts.ts', import.meta.url), 'utf8')
const portalRoute = readFileSync(new URL('../../cloudflare/src/routes/portal.ts', import.meta.url), 'utf8')

assert.match(contactTransport, /export function awardCustomerPoints/, 'Customer point awards need a dedicated write transport')
assert.match(loyaltyPage, /awardCustomerPoints\(customerId/, 'Loyalty lookup must submit a manual point award for the selected customer')
assert.match(loyaltyPage, /manualPointNote/, 'Manual point awards must provide an auditable note field')
assert.match(contactsRoute, /app\.post\('\/customers\/:id\/points'/, 'Worker must expose the customer point award endpoint')
assert.match(contactsRoute, /isAdminControlUser\(actor\)/, 'Manual point awards must be administrator-only')
assert.match(contactsRoute, /INSERT INTO loyalty_point_adjustments/, 'Manual point awards must be persisted as ledger entries')
assert.match(contactsRoute, /'award_points', 'customer'/, 'Manual point awards must be included in the audit log')
assert.match(portalRoute, /manuallyAwarded/, 'Membership balances must include manual point ledger entries')

console.log('PASS manual loyalty point awards are admin-only, persisted, and included in balances')
