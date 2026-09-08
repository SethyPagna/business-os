import assert from 'node:assert/strict'
import fs from 'node:fs'
import { actionAllowed } from '../src/utils/permissionActions.ts'

assert.equal(actionAllowed('contacts', 'financial_history', 'review'), false)
assert.equal(actionAllowed('contacts', 'financial_history', 'full'), true)

const customers = fs.readFileSync(new URL('../src/components/contacts/CustomersTab.tsx', import.meta.url), 'utf8')
assert.match(customers, /const canViewFinancialHistory = can\('contacts', 'financial_history'\)/)
assert.match(customers, /canViewFinancialHistory \? \[\{ key: 'invoices'/)
assert.match(customers, /extraButtons=\{canViewFinancialHistory \? \[\{ label: tr\(t, 'customer_purchases'/)
assert.match(customers, /canViewFinancialHistory && modal === 'purchases'/)
assert.match(customers, /setSection\('directory'\)/, 'revoking the capability must leave the protected section')

const delivery = fs.readFileSync(new URL('../src/components/contacts/DeliveryTab.tsx', import.meta.url), 'utf8')
assert.match(delivery, /const canViewFinancialHistory = can\('contacts', 'financial_history'\)/)
assert.match(delivery, /extraButtons=\{canViewFinancialHistory \? \[\{ label: tr\('delivery_report'/)
assert.match(delivery, /canViewFinancialHistory && modal === 'report'/)
assert.match(delivery, /current === 'report' \? 'detail'/, 'revoking the capability must close the protected report')

console.log('PASS Contacts financial-history controls hide and close immediately when permission is absent or revoked')
