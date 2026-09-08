import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sales = readFileSync(new URL('../src/components/sales/Sales.tsx', import.meta.url), 'utf8')
const detail = readFileSync(new URL('../src/components/sales/SaleDetailModal.tsx', import.meta.url), 'utf8')
const modal = readFileSync(new URL('../src/components/sales/SaleCustomerActionModal.tsx', import.meta.url), 'utf8')

assert.match(sales, /items: \[\{ id: Number\(sale\.id\), expected_updated_at: sale\.updated_at == null \? null : String\(sale\.updated_at\) \}\]/, 'one sale uses its frozen revision')
assert.match(sales, /action: \{ kind: 'customer', source_id: sale\.customer_id == null \? null : Number\(sale\.customer_id\), target_id: target\?\.id \?\? null \}/, 'replace/remove carries exact source and target ids')
assert.match(sales, /savePendingBulkFieldRequest\(payload\)[\s\S]*updateSalesBulkField\(payload\)/, 'lost responses retry the original receipt')
assert.match(sales, /if \(result\.changedCount === 0\)[\s\S]*sale_customer_conflict/, 'a stale source/revision remains visible as a conflict')
assert.match(sales, /getCustomers\(\{ ids: \[String\(id\)\] \}\)/, 'edit reads the current customer with contacts read permission')
assert.match(sales, /createCustomer\(payload\)[\s\S]*const created = Number[\s\S]*submitSaleCustomerChange\(prompt\.sale, \{ id: created/, 'create gets one id then retries only the frozen sale link')
assert.match(sales, /getCustomerRenameImpact[\s\S]*__rename_cascade = choice === 'carry' \? 'carry' : 'record_only'/, 'profile rename asks for its explicit cascade choice')
assert.match(sales, /actionHistory\.refreshServerItems\(\)[\s\S]*channel: 'sales'/, 'successful actions refresh durable history and Records')
assert.match(detail, /onCustomerAction\?: \(sale: SaleDetail\) => void/, 'sale detail exposes only the scoped action callback')
assert.match(modal, /This changes only this sale and returns linked to it\. Customer profiles and other transactions stay unchanged\./, 'modal states the attribution boundary')
assert.match(modal, /Create customer[\s\S]*Edit current[\s\S]*Remove link/, 'customer menu supports create, edit, and unlink')
console.log('PASS sale customer action contracts')
