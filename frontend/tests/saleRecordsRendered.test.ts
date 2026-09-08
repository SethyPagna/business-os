import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import type { SaleRecord, SaleRecordValue } from '../src/utils/saleRecords.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')
const source = readFileSync(new URL('../src/components/sales/SaleRecordsFloat.tsx', import.meta.url), 'utf8')
const mod = { exports: {} as Record<string, unknown> }
const compiled = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
new Function('require', 'module', 'exports', compiled)((id: string) => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id)
  if (id.includes('utils/saleRecords')) return require('../src/utils/saleRecords.ts')
  if (id.includes('saleRecordValue')) return require('../src/components/sales/saleRecordValue.ts')
  if (id.includes('StatusBadge')) return { getStatusLabel: (status: unknown, translate: (key: string) => string) => translate(`status_${String(status)}`) }
  if (id.includes('utils/formatters')) return { fmtDateTime24: () => '08/09/2026 12:00' }
  if (id.includes('salesTransport')) return { getSaleRecords: async () => ({ records: [] }) }
  if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
  return { __esModule: true, default: ({ children }: { children?: unknown }) => React.createElement(React.Fragment, null, children) }
}, mod, mod.exports)
const SaleRecordChangeTable = mod.exports.SaleRecordChangeTable as React.ComponentType<{
  record: SaleRecord
  t: (key: string) => string
  fmtUSD: (value: number | string) => string
  fmtKHR: (value: number | string) => string
}>

const v = (value: unknown): SaleRecordValue => ({ state: 'known_value', value })
const none: SaleRecordValue = { state: 'known_none' }
const unknown: SaleRecordValue = { state: 'unknown' }
const c = (field: string, before: SaleRecordValue, after: SaleRecordValue) => ({ field, before, after })
const labels: Record<string, string> = {
  field: 'Field', before: 'Before', after: 'After', none: 'None', general: 'General',
  no_membership: 'No membership', no_driver: 'No driver', no_actual_delivery_cost: 'No actual delivery cost',
  historical_details_unavailable: 'Historical details unavailable', value_changed: 'Value changed',
  item: 'Product', items: 'Products', removed_items: 'Removed products', added_items: 'Added products',
  quantity: 'Quantity', total: 'Sale total', driver: 'Driver', delivery_fee: 'Delivery fee',
  delivery_actual_cost: 'Actual delivery cost', payment_method: 'Payment method', payment_details: 'Payment details',
  amount_paid: 'Amount paid', amount_paid_khr: 'Amount paid (KHR)', change: 'Change', change_khr: 'Change (KHR)',
  status: 'Status', customer: 'Customer', membership: 'Membership', membership_discount: 'Membership discount',
  points_redeemed: 'Points redeemed', delivery: 'Delivery', yes: 'Yes', no: 'No',
  status_completed: 'Completed', status_awaiting_payment: 'Not Paid',
}
const t = (key: string): string => labels[key] || key
const html = (record: SaleRecord): string => renderToStaticMarkup(React.createElement(SaleRecordChangeTable, {
  record, t, fmtUSD: (amount: number | string) => `$${Number(amount).toFixed(2)}`,
  fmtKHR: (amount: number | string) => `${Number(amount).toLocaleString('en-US')}៛`,
}))

const cases: Array<{ name: string; record: SaleRecord; contains: string[] }> = [
  { name: 'add', record: { id: 'add', kind: 'item_added', changes: [c('item', none, v({ name: 'Primer', sku: 'P1', line_total_usd: 10 })), c('quantity', none, v(1)), c('total_usd', v(0), v(10))] }, contains: ['Primer (P1) · $10.00', 'Quantity', '$10.00'] },
  { name: 'remove', record: { id: 'remove', kind: 'item_removed', changes: [c('item', v({ name: 'Powder', sku: 'P2', line_total_usd: 12 }), none), c('quantity', v(1), none)] }, contains: ['Powder (P2) · $12.00', 'None'] },
  { name: 'replace', record: { id: 'replace', kind: 'items_replaced', changes: [c('removed_items', v([{ name: 'Old serum', quantity: 1, line_total_usd: 9 }]), v([])), c('added_items', v([]), v([{ name: 'New serum', quantity: 2, line_total_usd: 18 }]))] }, contains: ['Old serum × 1 · $9.00', 'New serum × 2 · $18.00'] },
  { name: 'driver fee cost', record: { id: 'delivery', kind: 'delivery_added', changes: [c('driver', none, v({ id: 9, name: 'Dara', phone: '0123', address: 'Zone A' })), c('delivery_fee_usd', v(0), v(2.5)), c('actual_delivery_cost_usd', none, v(1.25))] }, contains: ['Dara · #9 · 0123 · Zone A', '$2.50', 'No actual delivery cost', '$1.25'] },
  { name: 'payment and status', record: { id: 'payment', kind: 'payment_changed', changes: [c('payment_method', v('Cash'), v('ABA')), c('payment_details', v([{ method: 'Cash', amount_usd: 20, amount_khr: 0 }]), v([{ method: 'ABA', amount_usd: 20, amount_khr: 0 }])), c('amount_paid_khr', v(0), v(80000)), c('sale_status', v('awaiting_payment'), v('completed'))] }, contains: ['Cash · $20.00', 'ABA · $20.00', '80,000៛', 'Not Paid', 'Completed'] },
  { name: 'customer and membership', record: { id: 'customer', kind: 'customer_changed', changes: [c('customer', none, v({ id: 5, name: 'Srey Mom' })), c('membership', unknown, v({ number: 'M-5', discount_usd: 1, discount_khr: null, points_redeemed: 3 }))] }, contains: ['General', 'Srey Mom', 'Historical details unavailable', 'M-5', 'Membership discount: $1.00', 'Points redeemed: 3'] },
]

let failed = 0
for (const fixture of cases) {
  try {
    const rendered = html(fixture.record)
    for (const expected of fixture.contains) assert.ok(rendered.includes(expected), `${fixture.name} missing ${expected}: ${rendered}`)
    assert.doesNotMatch(rendered, /\{&quot;|\{"|sale_item_id|product_id|discount_usd|points_redeemed|amount_paid_usd/)
    console.log(`PASS rendered ${fixture.name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL rendered ${fixture.name}`)
    console.error(error)
  }
}

try {
  const rendered = html({ id: 'equal', changes: [c('total_usd', v(10), v(10)), c('customer', none, unknown)] })
  assert.doesNotMatch(rendered, /Sale total|\$10\.00/, 'unchanged context must not render')
  assert.match(rendered, /General/)
  assert.match(rendered, /Historical details unavailable/)
  console.log('PASS rendered unchanged and tri-state distinction')
} catch (error) {
  failed += 1
  console.error('FAIL rendered unchanged and tri-state distinction')
  console.error(error)
}

try {
  const rendered = html({ id: 'legacy', kind: 'legacy_sale_change', summary: 'RAW ENGLISH SUMMARY', changes: [] })
  assert.match(rendered, /Historical details unavailable/)
  assert.doesNotMatch(rendered, /RAW ENGLISH SUMMARY/)
  console.log('PASS rendered legacy detail uses localized unavailable copy')
} catch (error) {
  failed += 1
  console.error('FAIL rendered legacy detail uses localized unavailable copy')
  console.error(error)
}

if (failed) process.exit(1)
console.log('sale records rendered: all cases pass')
