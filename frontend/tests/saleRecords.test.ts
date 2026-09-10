import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SALE_RECORD_FIELD_RULES, SALE_RECORD_KINDS, SALE_RECORD_KIND_KEYS, filterSaleRecords, normalizeSaleRecordsResponse,
  saleRecordFieldRows, saleRecordKind, saleRecordKindCounts, saleRecordsCount,
  type SaleRecord, type SaleRecordValue,
} from '../src/utils/saleRecords.ts'
import { formatSaleRecordValueLinesLocalized } from '../src/components/sales/saleRecordValue.ts'

let failed = 0
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}
const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const value = (entry: unknown): SaleRecordValue => ({ state: 'known_value', value: entry })
const none = (): SaleRecordValue => ({ state: 'known_none' })
const unknown = (): SaleRecordValue => ({ state: 'unknown' })
const change = (field: string, before: SaleRecordValue, after: SaleRecordValue) => ({ field, before, after })

const RECORDS: SaleRecord[] = [
  { id: 'sale:77', kind: 'sale_created', changes: [
    change('receipt_number', none(), value('LOCAL-77')),
    change('items', none(), value([{ name: 'Primer', quantity: 1, line_total_usd: 10 }])),
    change('payment', none(), value({ method: 'Cash', details: [{ method: 'Cash', amount_usd: 10, amount_khr: 0 }], amount_paid_usd: 10, amount_paid_khr: 0, change_usd: 0, change_khr: 0 })),
    change('delivery', none(), unknown()), change('customer', none(), none()), change('membership', none(), unknown()),
  ] },
  { id: 'amendment:1', kind: 'item_quantity_changed', changes: [
    change('item', value({ sale_item_id: 1, product_id: 2, name: 'Primer', sku: 'P1', unit_price_usd: 10, line_total_usd: 10 }), value({ sale_item_id: 1, product_id: 2, name: 'Primer', sku: 'P1', unit_price_usd: 10, line_total_usd: 20 })),
    change('quantity', value(1), value(2)), change('total_usd', value(10), value(20)),
  ] },
  { id: 'amendment:2', kind: 'delivery_added', changes: [
    change('is_delivery', value(false), value(true)),
    change('driver', none(), value({ id: 9, name: 'Dara', phone: '0123', address: 'Zone A' })),
    change('delivery_fee_usd', value(0), value(2.5)), change('actual_delivery_cost_usd', none(), value(1.25)),
    change('total_usd', value(20), value(22.5)),
  ] },
  { id: 'audit:3', kind: 'payment_changed', changes: [
    change('payment_method', value('Cash'), value('ABA')),
    change('payment_details', value([{ method: 'Cash', amount_usd: 22.5, amount_khr: 0 }]), value([{ method: 'ABA', amount_usd: 22.5, amount_khr: 0 }])),
    change('amount_paid_usd', value(22.5), value(22.5)),
  ] },
  { id: 'legacy:4', kind: 'legacy_sale_change', summary: 'Historical details unavailable', changes: [] },
]

test('browser kind vocabulary is the frozen v2 contract and every label is localized', () => {
  assert.deepEqual(SALE_RECORD_KINDS, [
    'sale_created', 'driver_changed', 'delivery_cost_changed', 'delivery_fee_changed', 'delivery_added',
    'item_added', 'item_removed', 'item_quantity_changed', 'item_price_changed', 'items_replaced', 'customer_changed',
    'membership_changed', 'status_changed', 'payment_changed', 'payment_settled', 'cancelled', 'sale_items_recovered', 'sale_stock_corrected', 'legacy_sale_change',
  ])
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
  for (const kind of SALE_RECORD_KINDS) {
    const key = SALE_RECORD_KIND_KEYS[kind]
    assert.ok(en[key], `en.json is missing ${key}`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.notEqual(km[key], en[key], `${key} is not translated`)
  }
})

test('unknown kinds close to one meaningful legacy kind, never raw snake case', () => {
  assert.equal(saleRecordKind('driver_changed'), 'driver_changed')
  assert.equal(saleRecordKind('something_invented_later'), 'legacy_sale_change')
  assert.equal(saleRecordKind(undefined), 'legacy_sale_change')
})

test('selling-price records have a typed money field', () => {
  const record: SaleRecord = { id: 'amendment:price', kind: 'item_price_changed', changes: [
    change('item', value({ name: 'Serum' }), value({ name: 'Serum' })),
    change('unit_price_usd', value(3), value(4.5)),
    change('total_usd', value(6), value(9)),
  ] }
  const rows = saleRecordFieldRows(record)
  assert.deepEqual(rows.map((row) => [row.field, row.format]), [
    ['unit_price_usd', 'money'], ['total_usd', 'money'],
  ])
})

test('detail rows consume only tri-state changes and omit unchanged context', () => {
  const rows = saleRecordFieldRows(RECORDS[3])
  assert.deepEqual(rows.map((row) => row.field), ['payment_method', 'payment_details'])
  assert.equal(rows.every((row) => row.changed), true)
  assert.deepEqual(saleRecordFieldRows({ id: 'old', before: { sale_status: 'completed' }, after: { sale_status: 'cancelled' } } as unknown as SaleRecord), [])
})

test('recovered sale items expose only product lines and the safe stock action', () => {
  const recovered: SaleRecord = { id: 'recovery:77', kind: 'sale_items_recovered', changes: [
    change('item_count', value(0), value(2)),
    change('stock_effect', none(), value('deducted_now')),
    change('revision', value(1), value(2)),
    change('manifest_sha256', value('before'), value('after')),
  ] }
  const rows = saleRecordFieldRows(recovered)
  assert.deepEqual(rows.map((row) => row.field), ['item_count', 'stock_effect'])
  assert.deepEqual(rows.map((row) => row.labelKey), ['product_lines', 'recovery_stock_action'])
  const usd = (n: number | string) => `$${Number(n).toFixed(2)}`
  const khr = (n: number | string) => `${Number(n).toLocaleString('en-US')}៛`
  const tr = (key: string, fallback: string) => key === 'stock_deducted_now' ? 'Stock deducted now' : fallback
  assert.deepEqual(formatSaleRecordValueLinesLocalized('stock_effect', 'deducted_now', usd, khr, tr), ['Stock deducted now'])
  assert.deepEqual(formatSaleRecordValueLinesLocalized('stock_effect', 'unexpected_value', usd, khr, tr), ['Value changed'])
})

test('Not Paid stock correction exposes held units and a localized safe stock action only', () => {
  const corrected: SaleRecord = { id: 'audit:16954', kind: 'sale_stock_corrected', changes: [
    change('held_units', value(0), value(1)),
    change('stock_effect', value('released_allocation_only'), value('deducted_now')),
    change('manifest_sha256', value('before'), value('after')),
    change('revision', value(1), value(2)),
  ] }
  const rows = saleRecordFieldRows(corrected)
  assert.deepEqual(rows.map((row) => row.field), ['held_units', 'stock_effect'])
  assert.deepEqual(rows.map((row) => row.labelKey), ['held_units', 'recovery_stock_action'])
  assert.deepEqual(rows.map((row) => [row.before, row.after]), [
    [value(0), value(1)],
    [value('released_allocation_only'), value('deducted_now')],
  ])
})

test('known none and unknown remain different facts', () => {
  const rows = saleRecordFieldRows(RECORDS[0])
  assert.equal(rows.find((row) => row.field === 'customer')?.after.state, 'known_none')
  assert.equal(rows.find((row) => row.field === 'membership')?.after.state, 'unknown')
  assert.equal(rows.find((row) => row.field === 'delivery')?.after.state, 'unknown')
})

test('money, KHR, quantity and composite fields use friendly render contracts', () => {
  assert.equal(saleRecordFieldRows(RECORDS[1]).find((row) => row.field === 'quantity')?.format, 'quantity')
  assert.equal(saleRecordFieldRows(RECORDS[2]).find((row) => row.field === 'actual_delivery_cost_usd')?.format, 'money')
  assert.equal(saleRecordFieldRows({ id: 'pay', changes: [change('amount_paid_khr', value(0), value(40000))] })[0].format, 'money_khr')
  const usd = (n: number | string) => `$${Number(n).toFixed(2)}`
  const khr = (n: number | string) => `${Number(n).toLocaleString('en-US')}៛`
  const tr = (_key: string, fallback: string) => fallback
  assert.deepEqual(formatSaleRecordValueLinesLocalized('driver', { id: 9, name: 'Dara', phone: '0123', address: 'Zone A' }, usd, khr, tr), ['Dara · #9 · 0123 · Zone A'])
  assert.deepEqual(formatSaleRecordValueLinesLocalized('items', [{ name: 'Primer', quantity: 2, line_total_usd: 20 }], usd, khr, tr), ['Primer × 2 · $20.00'])
  assert.deepEqual(formatSaleRecordValueLinesLocalized('membership', { number: 'M-1', discount_usd: 2, discount_khr: null, points_redeemed: 5 }, usd, khr, tr), ['M-1', 'Membership discount: $2.00', 'Points redeemed: 5'])
  const payment = formatSaleRecordValueLinesLocalized('payment', { method: 'ABA', details: [{ method: 'ABA', amount_usd: 10, amount_khr: 0 }], amount_paid_usd: 10, amount_paid_khr: 0, change_usd: 0, change_khr: 0 }, usd, khr, tr)
  assert.ok(payment.includes('ABA · $10.00'))
  assert.doesNotMatch(payment.join(' '), /amount_paid_usd|payment_details|\{|\}/)
  assert.equal(SALE_RECORD_FIELD_RULES.payment?.key, 'payment')
  assert.equal(SALE_RECORD_FIELD_RULES.delivery?.key, 'delivery')
})

test('every typed field label exists in both real language packs', () => {
  const en = JSON.parse(read('../src/lang/en.json')) as Record<string, unknown>
  const km = JSON.parse(read('../src/lang/km.json')) as Record<string, unknown>
  const keys = [...new Set(Object.values(SALE_RECORD_FIELD_RULES).map((rule) => rule.key))]
  for (const key of keys) {
    assert.equal(typeof en[key], 'string', `English is missing ${key}`)
    assert.ok(String(en[key]).trim(), `English ${key} is blank`)
    assert.equal(typeof km[key], 'string', `Khmer is missing ${key}`)
    assert.ok(String(km[key]).trim(), `Khmer ${key} is blank`)
    assert.notEqual(km[key], en[key], `Khmer ${key} must not fall back to English`)
  }
})

test('payment detail KHR uses the injected formatter in direct and nested payment shapes', () => {
  const usd = (n: number | string) => `$${Number(n).toFixed(2)}`
  const calls: Array<number | string> = []
  const khr = (n: number | string) => { calls.push(n); return `KHR:${n}` }
  const direct = formatSaleRecordValueLinesLocalized('payment_details', [{ method: 'Cash', amount_khr: 40000 }], usd, khr)
  const nested = formatSaleRecordValueLinesLocalized('payment', { details: [{ method: 'ABA', amount_khr: 80000 }] }, usd, khr)
  assert.deepEqual(direct, ['Cash · KHR:40000'])
  assert.deepEqual(nested, ['ABA · KHR:80000'])
  assert.deepEqual(calls, [40000, 80000])
})

test('filters and counts use closed normalized kinds', () => {
  assert.equal(filterSaleRecords(RECORDS, new Set()).length, RECORDS.length)
  assert.deepEqual(filterSaleRecords(RECORDS, new Set(['delivery_added'])).map((row) => row.id), ['amendment:2'])
  assert.deepEqual(saleRecordKindCounts(RECORDS), [
    { kind: 'sale_created', count: 1 }, { kind: 'delivery_added', count: 1 },
    { kind: 'item_quantity_changed', count: 1 }, { kind: 'payment_changed', count: 1 },
    { kind: 'legacy_sale_change', count: 1 },
  ])
})

test('list counts distinguish missing from zero and malformed payloads stay visible', () => {
  assert.equal(saleRecordsCount({ records_count: 0 }), 0)
  assert.equal(saleRecordsCount({}), null)
  assert.equal(saleRecordsCount({ records_count: -1 }), null)
  const parsed = normalizeSaleRecordsResponse({ records: [{ kind: 'item_added' }, null, 'bad'] })
  assert.equal(parsed.length, 1)
  assert.equal(parsed[0].id, 'record-0')
})

test('the float renders a shared read-only surface and never exposes raw variables', () => {
  const source = read('../src/components/sales/SaleRecordsFloat.tsx')
  assert.match(source, /unsavedChanges="read-only"/)
  assert.match(source, /SaleRecordChangeTable record=\{record\}/)
  assert.match(source, /record\.provenance_unknown \|\| !record\.actor_username[\s\S]*label\('unknown', 'Unknown'\)/)
  assert.doesNotMatch(source, /\{record\.via\}<\/span>/)
  assert.doesNotMatch(source, /\{row\.field\}<\/td>/)
  assert.doesNotMatch(source, /record\.summary \|\| t\('historical_details_unavailable'\)/, 'legacy backend summaries must not bypass localization')
})

test('Records stays inside expanded sale details and uses the union endpoint', () => {
  const list = read('../src/components/sales/SalesListSurface.tsx')
  assert.doesNotMatch(list, /SaleRecordsLine|openSaleRecords|sale_records/)
  const detail = read('../src/components/sales/SaleDetailModal.tsx')
  assert.match(detail, /onClick=\{\(\) => onOpenRecords\(sale\)\}/)
  const transport = read('../src/api/salesTransport.ts')
  assert.match(transport, /\/api\/sales\/\$\{encodeId\(id\)\}\/records/)
  assert.match(transport, /raceLocalFallback: false/)
})

if (failed) { console.error(`${failed} sale-records case(s) failed`); process.exit(1) }
console.log('sale records (browser): all cases pass')
