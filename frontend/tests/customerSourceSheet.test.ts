// Customer add/edit from the POS and from a sale (owner, 30 Sep 2026): the browser
// half. The Worker keeps only sales-safe columns for a request with a `source`
// (cloudflare/scripts/test-contacts-sales-editor-pure.cjs); this pins that the
// sheet sends exactly that shape, that the screens offer it only to a role the
// Worker will serve, and that the sale's records can read what the Worker writes.
//
// Run: node tests/customerSourceSheet.test.ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildCustomerSourcePayload, customerSourceFields, customerSourceRestorePayload, SALES_CUSTOMER_COLUMNS } from '../src/components/contacts/customerSource.ts'
import { SALE_RECORD_FIELD_RULES, saleRecordFieldRows, type SaleRecord } from '../src/utils/saleRecords.ts'
import { formatSaleRecordValueLinesLocalized } from '../src/components/sales/saleRecordValue.ts'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const workerSource = read('../../cloudflare/src/lib/contactSalesSource.ts')
const workerColumns = [...(workerSource.match(/SALES_CUSTOMER_COLUMNS = \[([^\]]*)\]/)?.[1] || '').matchAll(/'([^']+)'/g)].map((match) => match[1])
assert.deepEqual([...SALES_CUSTOMER_COLUMNS], workerColumns, 'the sheet and the Worker keep the same customer columns')
assert.ok(!workerColumns.includes('membership_number') && !workerColumns.includes('created_at'), 'identity and joined date stay out')
console.log('PASS the sheet and the Worker agree on the sales-safe customer columns')

const loaded = { id: 5, name: 'Dara', phone: '012 345 678', updated_at: '2026-09-30 10:00:00', membership_number: 'LC-5' }
const form = { name: ' Dara ', phone: '012 999 888', email: '', address: '[]', notes: 'n', gender: 'female', membership_number: 'LC-HACK', created_at: '2020-01-01', points_balance: 99 }
const edit = buildCustomerSourcePayload(form, loaded, { kind: 'sale', saleId: 21 })
assert.deepEqual(Object.keys(edit).sort(), ['address', 'email', 'gender', 'name', 'notes', 'phone', 'sale_id', 'source', 'updated_at'].sort())
assert.equal(edit.name, 'Dara')
assert.equal(edit.source, 'sale')
assert.equal(edit.sale_id, 21)
assert.equal(edit.updated_at, '2026-09-30 10:00:00', 'the loaded version rides along so a stale edit is refused')
assert.ok(!('__rename_cascade' in edit), 'no rename question when the name is unchanged')
assert.equal(buildCustomerSourcePayload({ ...form, name: 'Dara B' }, loaded, { kind: 'pos' }).__rename_cascade, 'record_only', 'a rename never rewrites other records from a till')
assert.equal(buildCustomerSourcePayload({ ...form, name: 'dara' }, loaded, { kind: 'pos' }).__rename_cascade, undefined, 'case-only differences are not a rename')
const posEdit = buildCustomerSourcePayload(form, loaded, { kind: 'pos' })
assert.equal(posEdit.source, 'pos')
assert.ok(!('sale_id' in posEdit))
const created = buildCustomerSourcePayload({ ...form, membership_number: '' }, null, { kind: 'sale', saleId: 21 })
assert.ok(!('updated_at' in created) && !('membership_number' in created) && !('created_at' in created))
assert.deepEqual(customerSourceFields({ kind: 'pos' }), { source: 'pos' })
const restore = customerSourceRestorePayload({ ...loaded, email: 'a', address: 'b', notes: 'c', gender: 'male' }, { kind: 'sale', saleId: 21 })
assert.equal(restore.source, 'sale')
assert.equal(restore.__rename_cascade, 'record_only')
assert.ok(!('membership_number' in restore) && !('updated_at' in restore), 'an undo replays sales-safe columns only, unversioned')
console.log('PASS payloads: sales-safe columns only, source fields, version token, record-only rename, undo restore')

const record: SaleRecord = {
  id: 'event:1', kind: 'customer_changed',
  changes: [{
    field: 'customer_details',
    before: { state: 'known_value', value: { name: 'Dara', phone: 'not_recorded', gender: 'Female' } },
    after: { state: 'known_value', value: { name: 'Dara B', phone: 'changed', gender: 'Male' } },
  }],
} as unknown as SaleRecord
assert.ok(SALE_RECORD_FIELD_RULES.customer_details, 'the record field has a browser rule')
const rows = saleRecordFieldRows(record)
assert.equal(rows.length, 1)
assert.equal(rows[0].labelKey, 'customer_details')
const fmt = (n: number | string) => `$${n}`
assert.deepEqual(formatSaleRecordValueLinesLocalized('customer_details', { name: 'Dara', phone: 'not_recorded', email: 'not_recorded', gender: 'Female' }, fmt, fmt), ['Name: Dara', 'Phone: Not recorded', 'Email: Not recorded', 'Gender: Female'])
assert.deepEqual(formatSaleRecordValueLinesLocalized('customer_details', { name: 'Dara B', phone: 'changed', address: 'changed', notes: 'changed', gender: 'male' }, fmt, fmt), ['Name: Dara B', 'Phone: Value changed', 'Address: Value changed', 'Notes: Value changed', 'Gender: Male'])
const khmer: Record<string, string> = { male: 'ប្រុស', female: 'ស្រី', phone: 'ទូរស័ព្ទ', value_changed: 'តម្លៃបានប្តូរ', not_recorded: 'មិនបានកត់ត្រា' }
const inKhmer = (key: string, fallback: string) => khmer[key] || fallback
assert.deepEqual(formatSaleRecordValueLinesLocalized('customer_details', { phone: 'changed', gender: 'Female' }, fmt, fmt, inKhmer), ['ទូរស័ព្ទ: តម្លៃបានប្តូរ', 'Gender: ស្រី'], 'gender is translated, never shown raw')
assert.ok(!formatSaleRecordValueLinesLocalized('customer_details', { phone: '012 999 888', notes: 'allergic' }, fmt, fmt).join(' ').match(/012|allergic/), 'a quoted phone or note is never rendered, even if one were stored')
console.log('PASS the sale records show what the Worker writes for a customer-details edit')

const pos = read('../src/components/pos/POS.tsx')
assert.match(pos, /createCustomer\(\{ \.\.\.payload, source: 'pos' \}\)/, 'the POS quick-add names its source')
assert.match(pos, /const canAddCustomer = can\('contacts', 'add'\)/)
assert.match(pos, /const canEditCustomer = can\('contacts', 'edit'\)/)
assert.match(pos, /\{canAddCustomer \? <button/, 'the + New button is offered only to a role that may add')
assert.match(pos, /canEditCustomer && active\.customer\.id/, 'the edit button needs a saved customer and the edit action')
assert.match(pos, /source=\{\{ kind: 'pos' \}\}/)
const sales = read('../src/components/sales/Sales.tsx')
assert.match(sales, /can\('contacts', 'edit'\) && getPermissionTier\('sales'\) === 'full'/, 'sales offers the edit only where the Worker will serve it')
assert.match(sales, /can\('contacts', 'add'\) && getPermissionTier\('sales'\) === 'full'/)
assert.match(sales, /source=\{\{ kind: 'sale', saleId: Number\(saleCustomerProfile\.sale\.id\) \}\}/)
assert.match(sales, /pushAction=\{saleCustomerProfile\.mode === 'edit' \? actionHistory\.pushAction : undefined\}/, 'an edit from a sale stays undoable')
const detail = read('../src/components/sales/SaleDetailModal.tsx')
assert.match(detail, /onCustomerDetails && !customerIsAnonymous && sale\.customer_id/, 'never offered for a walk-in or an unlinked sale')
const modal = read('../src/components/contacts/CustomerSourceModal.tsx')
for (const code of ['sale_not_found', 'sale_customer_mismatch', 'sale_not_editable']) assert.match(modal, new RegExp(code), `the sheet words the Worker's ${code} refusal`)
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
for (const key of ['customer_details_edit', 'customer_edit_not_found', 'customer_details', 'customer_sale_mismatch', 'customer_sale_not_editable', 'sale_not_found']) {
  assert.ok(en[key] && km[key], `${key} exists in both packs`)
  assert.notEqual(en[key], km[key], `${key} is translated`)
}
console.log('PASS POS and Sales wiring: gates, source, undo, both packs')
