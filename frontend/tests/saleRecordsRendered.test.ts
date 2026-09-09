import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { SALE_RECORD_FIELD_RULES, type SaleRecord, type SaleRecordValue } from '../src/utils/saleRecords.ts'

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
const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, unknown>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, unknown>
const translator = (dictionary: Record<string, unknown>) => (key: string): string => typeof dictionary[key] === 'string' ? String(dictionary[key]) : key
const tEn = translator(en)
const tKm = translator(km)
const html = (
  record: SaleRecord,
  t = tEn,
  fmtKHR: (value: number | string) => string = (amount) => `${Number(amount).toLocaleString('en-US')}៛`,
): string => renderToStaticMarkup(React.createElement(SaleRecordChangeTable, {
  record, t, fmtUSD: (amount: number | string) => `$${Number(amount).toFixed(2)}`,
  fmtKHR,
}))

const cases: Array<{ name: string; record: SaleRecord; contains: string[] }> = [
  { name: 'add', record: { id: 'add', kind: 'item_added', changes: [c('item', none, v({ name: 'Primer', sku: 'P1', line_total_usd: 10 })), c('quantity', none, v(1)), c('total_usd', v(0), v(10))] }, contains: ['Primer (P1) · $10.00', 'Quantity', '$10.00'] },
  { name: 'remove', record: { id: 'remove', kind: 'item_removed', changes: [c('item', v({ name: 'Powder', sku: 'P2', line_total_usd: 12 }), none), c('quantity', v(1), none)] }, contains: ['Powder (P2) · $12.00', 'None'] },
  { name: 'replace', record: { id: 'replace', kind: 'items_replaced', changes: [c('removed_items', v([{ name: 'Old serum', quantity: 1, line_total_usd: 9 }]), v([])), c('added_items', v([]), v([{ name: 'New serum', quantity: 2, line_total_usd: 18 }]))] }, contains: ['Old serum × 1 · $9.00', 'New serum × 2 · $18.00'] },
  { name: 'driver fee cost', record: { id: 'delivery', kind: 'delivery_added', changes: [c('driver', none, v({ id: 9, name: 'Dara', phone: '0123', address: 'Zone A' })), c('delivery_fee_usd', v(0), v(2.5)), c('actual_delivery_cost_usd', none, v(1.25))] }, contains: ['Dara · #9 · 0123 · Zone A', '$2.50', 'No actual delivery cost', '$1.25'] },
  { name: 'payment and status', record: { id: 'payment', kind: 'payment_changed', changes: [c('payment_method', v('Cash'), v('ABA')), c('payment_details', v([{ method: 'Cash', amount_usd: 20, amount_khr: 0 }]), v([{ method: 'ABA', amount_usd: 20, amount_khr: 0 }])), c('amount_paid_khr', v(0), v(80000)), c('sale_status', v('awaiting_payment'), v('completed'))] }, contains: ['Cash · $20.00', 'ABA · $20.00', '80,000៛', 'Not Paid', 'Completed'] },
  { name: 'customer and membership', record: { id: 'customer', kind: 'customer_changed', changes: [c('customer', none, v({ id: 5, name: 'Srey Mom' })), c('membership', unknown, v({ number: 'M-5', discount_usd: 1, discount_khr: null, points_redeemed: 3 }))] }, contains: ['General', 'Srey Mom', 'Historical details unavailable', 'M-5', 'Membership Discount: $1.00', 'Points Redeemed: 3'] },
  { name: 'recovered items', record: { id: 'recovered', kind: 'sale_items_recovered', changes: [c('item_count', v(0), v(2)), c('stock_effect', none, v('deducted_now')), c('revision', v(1), v(2)), c('manifest_sha256', v('old'), v('new'))] }, contains: ['Product lines', '0', '2', 'Stock action', 'None', 'Stock deducted now'] },
  { name: 'Not Paid stock correction', record: { id: 'corrected', kind: 'sale_stock_corrected', changes: [c('held_units', v(0), v(2)), c('stock_effect', v('released_allocation_only'), v('deducted_now')), c('manifest_sha256', v('old'), v('new'))] }, contains: ['Stock units', '0', '2', 'Stock action', 'Released allocation; no stock deduction', 'Stock deducted now'] },
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
  const rendered = html({ id: 'recovered-one-line', kind: 'sale_items_recovered', changes: [
    c('item_count', v(0), v(1)),
    c('stock_effect', none, v('released_allocation_only')),
  ] })
  for (const expected of ['Product lines', '>0<', '>1<', 'Stock action', 'Released allocation; no stock deduction']) {
    assert.ok(rendered.includes(expected), `recovered one line is missing ${expected}: ${rendered}`)
  }
  assert.doesNotMatch(rendered, /released_allocation_only|item_count|stock_effect/)
  console.log('PASS rendered recovery keeps zero and one product line visible')
} catch (error) {
  failed += 1
  console.error('FAIL rendered recovery keeps zero and one product line visible')
  console.error(error)
}

try {
  const rendered = html({ id: 'released-allocation', kind: 'sale_items_recovered', changes: [
    c('stock_effect', none, v('released_allocation_only')),
    c('item_count', v(0), v(2)),
  ] }, tKm)
  assert.match(rendered, new RegExp(String(km.recovery_stock_action)))
  assert.match(rendered, new RegExp(String(km.stock_released_allocation_only)))
  assert.match(rendered, new RegExp(String(km.product_lines)))
  assert.match(rendered, />0<[^]*>2</)
  assert.doesNotMatch(rendered, /released_allocation_only|manifest_sha256|revision/)
  console.log('PASS rendered recovery stock action uses localized safe values')
} catch (error) {
  failed += 1
  console.error('FAIL rendered recovery stock action uses localized safe values')
  console.error(error)
}

try {
  const rendered = html({ id: 'deducted-khmer', kind: 'sale_items_recovered', changes: [
    c('stock_effect', none, v('deducted_now')),
  ] }, tKm)
  assert.match(rendered, new RegExp(String(km.stock_deducted_now)))
  assert.doesNotMatch(rendered, /deducted_now/)
  console.log('PASS rendered recovery deducted stock uses Khmer safe value')
} catch (error) {
  failed += 1
  console.error('FAIL rendered recovery deducted stock uses Khmer safe value')
  console.error(error)
}

try {
  const fieldLabelKeys = [...new Set(Object.values(SALE_RECORD_FIELD_RULES).map((rule) => rule.key))]
  for (const key of fieldLabelKeys) {
    assert.equal(typeof en[key], 'string', `English is missing ${key}`)
    assert.equal(typeof km[key], 'string', `Khmer is missing ${key}`)
    assert.notEqual(km[key], en[key], `Khmer ${key} falls back to English`)
  }
  console.log('PASS real EN/KM dictionaries cover every typed field label')
} catch (error) {
  failed += 1
  console.error('FAIL real EN/KM dictionaries cover every typed field label')
  console.error(error)
}

try {
  let khrCalls = 0
  const record: SaleRecord = { id: 'km-payment-replace', kind: 'payment_changed', changes: [
    c('payment_details', v([{ method: 'ABA', amount_khr: 40000 }]), v([{ method: 'Cash', amount_khr: 80000 }])),
    c('amount_paid_khr', v(40000), v(80000)),
    c('change_khr', v(0), v(1000)),
    c('removed_items', v([{ name: 'ចាស់', quantity: 1 }]), v([])),
    c('added_items', v([]), v([{ name: 'ថ្មី', quantity: 1 }])),
  ] }
  const rendered = html(record, tKm, (amount) => { khrCalls += 1; return `KHR_SENTINEL_${amount}` })
  for (const key of ['payment_details', 'amount_paid_khr', 'change_khr', 'removed_items', 'added_items']) {
    assert.ok(rendered.includes(String(km[key])), `Khmer render is missing ${key}`)
    assert.ok(!rendered.includes(String(en[key])), `Khmer render leaked English ${key}`)
  }
  assert.ok(rendered.includes('KHR_SENTINEL_40000'))
  assert.ok(rendered.includes('KHR_SENTINEL_80000'))
  assert.ok(rendered.includes('KHR_SENTINEL_1000'))
  assert.ok(khrCalls >= 6, `expected nested and direct KHR formatter calls, got ${khrCalls}`)
  console.log('PASS rendered Khmer uses real labels and injected KHR formatter')
} catch (error) {
  failed += 1
  console.error('FAIL rendered Khmer uses real labels and injected KHR formatter')
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
