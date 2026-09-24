// The shared RECORDS float, RENDERED, once per entity that now has one.
//
// The owner, Sep 22 2026: "having records in sales, returns, stock changes,
// products, invoices, etc... make sure these records are having them there as
// well as in the actual audit log, all + filters + sections etc... like sales
// do before and after, by who etc... Compact rows, press to open etc..."
//
// "like sales do" is the contract under test here, and it is a contract about
// what is on screen, not about which module exports what. So each entity gets
// a real fixture rendered through the real component:
//
//   * the row shows WHO (the acting username), WHERE (the branch, only when
//     the record genuinely carries one) and WHEN;
//   * the row is closed until pressed -- aria-expanded, and no table;
//   * pressed, it shows Field | Before | After with the values formatted the
//     way that entity formats them, in the reader's language.
//
// The positive control is the branch: the sale fixture carries one and must
// print it, the audit-sourced fixtures do not and must print nothing rather
// than inventing the reader's own branch. A test where every case answers the
// same way cannot tell a working renderer from a broken one.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import { loadRecordsFloatModule } from './recordsFloatModule.ts'
import {
  ENTITY_RECORDS_ADAPTER,
  RETURN_RECORDS_ADAPTER,
  auditRowsToRecords,
  type RecordItem,
  type RecordsAdapter,
} from '../src/utils/entityRecords.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')

const floatModule = loadRecordsFloatModule()
const RecordRow = floatModule.RecordRow as React.ComponentType<Record<string, unknown>>

// The sale adapter lives with the sale's vocabulary; compiled the same way the
// sale's own rendered test compiles it.
const saleSource = readFileSync(new URL('../src/components/sales/SaleRecordsFloat.tsx', import.meta.url), 'utf8')
const saleMod = { exports: {} as Record<string, unknown> }
new Function('require', 'module', 'exports', transformSync(saleSource, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code)((id: string) => {
  if (id === 'react' || id === 'react/jsx-runtime') return require(id)
  if (id.includes('shared/RecordsFloat')) return floatModule
  if (id.includes('utils/saleRecords')) return require('../src/utils/saleRecords.ts')
  if (id.includes('utils/entityRecords')) return require('../src/utils/entityRecords.ts')
  if (id.includes('saleRecordValue')) return require('../src/components/sales/saleRecordValue.ts')
  if (id.includes('StatusBadge')) return { getStatusLabel: (status: unknown, translate: (key: string) => string) => translate(`status_${String(status)}`) }
  if (id.includes('salesTransport')) return { getSaleRecords: async () => ({ records: [] }) }
  if (id.includes('lucide-react')) return { __esModule: true, default: () => null }
  return { __esModule: true, default: ({ children }: { children?: unknown }) => React.createElement(React.Fragment, null, children) }
}, saleMod, saleMod.exports)
const SALE_RECORDS_ADAPTER = saleMod.exports.SALE_RECORDS_ADAPTER as RecordsAdapter

const en = JSON.parse(readFileSync(new URL('../src/lang/en.json', import.meta.url), 'utf8')) as Record<string, string>
const km = JSON.parse(readFileSync(new URL('../src/lang/km.json', import.meta.url), 'utf8')) as Record<string, string>
const translator = (dictionary: Record<string, string>) => (key: string): string => typeof dictionary[key] === 'string' ? dictionary[key] : key
const tEn = translator(en)
const tKm = translator(km)

const render = (record: RecordItem, adapter: RecordsAdapter, open = true, t = tEn): string => renderToStaticMarkup(
  React.createElement(RecordRow, {
    record,
    adapter,
    open,
    onToggle: () => {},
    t,
    fmtUSD: (amount: number | string) => `$${Number(amount).toFixed(2)}`,
    fmtKHR: (amount: number | string) => `${Number(amount).toLocaleString('en-US')}៛`,
  }),
)

let failed = 0
const check = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const value = (raw: unknown) => ({ state: 'known_value' as const, value: raw })

// --- sale -------------------------------------------------------------------
const SALE_RECORD: RecordItem = {
  id: 'amendment:7',
  kind: 'item_quantity_changed',
  at: '2026-09-22 08:30:00',
  actor_username: 'dara',
  branch_name: 'Toul Kork',
  subject: 'Serum 30ml',
  via: 'undo',
  changes: [
    { field: 'quantity', before: value(1), after: value(2) },
    { field: 'total_usd', before: value(10), after: value(20) },
  ],
}

check('sale: kind, who, branch, and money before/after', () => {
  const html = render(SALE_RECORD, SALE_RECORDS_ADAPTER)
  assert.ok(html.includes(en.record_kind_item_quantity_changed), 'the kind label is missing')
  assert.ok(html.includes('dara'), 'the acting username is missing')
  assert.ok(html.includes('Toul Kork'), 'the branch this record carries is missing')
  assert.ok(html.includes('Serum 30ml'), 'the subject is missing')
  assert.ok(html.includes(en.undo), 'the replay direction is missing')
  for (const expected of [en.field, en.before, en.after, en.quantity, '>1<', '>2<', '$10.00', '$20.00']) {
    assert.ok(html.includes(String(expected)), `missing ${expected}`)
  }
  assert.ok(!html.includes('total_usd'), 'a raw field name reached the screen')
})

// --- return -----------------------------------------------------------------
const RETURN_RECORD: RecordItem = {
  id: 'audit:41',
  kind: 'return_updated',
  at: '2026-09-22 09:00:00',
  actor_username: 'sophea',
  // audit_logs has no branch column: a return's audit-sourced record has none.
  branch_name: null,
  subject: 'RET-20260922-01',
  via: 'apply',
  changes: [
    { field: 'status', before: value('pending'), after: value('completed') },
    { field: 'reason', before: { state: 'unknown' }, after: value('Damaged on arrival') },
  ],
}

check('return: its own kind vocabulary and the shared field table', () => {
  const html = render(RETURN_RECORD, RETURN_RECORDS_ADAPTER)
  assert.ok(html.includes(en.record_kind_return_updated), 'the return kind label is missing')
  assert.ok(html.includes('sophea'))
  assert.ok(html.includes('RET-20260922-01'))
  assert.ok(html.includes(en.status) && html.includes('pending') && html.includes('completed'))
  assert.ok(html.includes(en.reason) && html.includes('Damaged on arrival'))
  assert.ok(html.includes(en.historical_details_unavailable), 'an unknown before must say so, not read as None')
  assert.ok(!html.includes('data-records-branch'), 'a record with no branch must not print one')
  assert.ok(!html.includes(en.undo) && !html.includes(en.redo), 'an ordinary apply must not wear a replay badge')
})

check('return: an unknown kind from a newer Worker never prints a raw identifier', () => {
  const html = render({ ...RETURN_RECORD, kind: 'return_teleported' }, RETURN_RECORDS_ADAPTER)
  assert.ok(html.includes(en.record_kind_other))
  assert.ok(!html.includes('return_teleported'))
})

// --- product ----------------------------------------------------------------
const [PRODUCT_RECORD] = auditRowsToRecords([{
  id: 900,
  action: 'update',
  entity: 'product',
  user_name: 'sokha',
  created_at: '2026-09-22 10:15:00',
  details: JSON.stringify({ reason: 'Supplier raised the price' }),
  old_value: JSON.stringify({ id: 12, name: 'Serum 30ml', selling_price_usd: 3, barcode: '885' }),
  new_value: JSON.stringify({ id: 12, name: 'Serum 30ml', selling_price_usd: 4.5, barcode: '885' }),
}])

check('product: only the changed column, with the form word for it', () => {
  const html = render(PRODUCT_RECORD, ENTITY_RECORDS_ADAPTER)
  assert.ok(html.includes(en.edit), 'the update action label is missing')
  assert.ok(html.includes('sokha'))
  assert.ok(html.includes(en.label_selling_price), 'the pack word for the price column is missing')
  assert.ok(html.includes('3') && html.includes('4.5'))
  assert.ok(html.includes(en.reason) && html.includes('Supplier raised the price'), 'the typed reason must be its own row')
  assert.ok(!html.includes('885'), 'an unchanged column is context, not a change')
  assert.ok(!html.includes('selling_price_usd'), 'a raw column name reached the screen')
  assert.ok(!html.includes('data-records-branch'), 'audit rows carry no branch and must claim none')
})

check('product: both packs, no English leaking into Khmer', () => {
  const html = render(PRODUCT_RECORD, ENTITY_RECORDS_ADAPTER, true, tKm)
  for (const key of ['edit', 'label_selling_price', 'reason', 'field', 'before', 'after'] as const) {
    assert.ok(html.includes(km[key]), `the Khmer pack word for ${key} is missing`)
    assert.ok(!html.includes(en[key]), `English ${key} leaked into the Khmer render`)
  }
})

// --- contact ----------------------------------------------------------------
const [CONTACT_RECORD] = auditRowsToRecords([{
  id: 901,
  action: 'update',
  entity: 'customer',
  user_name: 'chan',
  created_at: '2026-09-22 11:00:00',
  old_value: JSON.stringify({ id: 5, name: 'Srey Mom', phone: '012000111', address: 'Zone A' }),
  new_value: JSON.stringify({ id: 5, name: 'Srey Mom', phone: '012999888', address: 'Zone A' }),
}])

check('contact: the same float answers a customer edit', () => {
  const html = render(CONTACT_RECORD, ENTITY_RECORDS_ADAPTER)
  assert.ok(html.includes('chan'))
  assert.ok(html.includes(en.phone))
  assert.ok(html.includes('012000111') && html.includes('012999888'))
  assert.ok(!html.includes('Zone A'), 'an unchanged column is context, not a change')
})

// --- press to open ----------------------------------------------------------
check('compact rows: closed by default, the table only once pressed', () => {
  const closed = render(SALE_RECORD, SALE_RECORDS_ADAPTER, false)
  assert.ok(closed.includes('aria-expanded="false"'))
  assert.ok(closed.includes('data-records-row'))
  assert.ok(!closed.includes('<table'), 'a closed row must not render its change table')
  assert.ok(!closed.includes(en.before), 'a closed row must not render the Before column')
  // The row header itself stays: this is a compact row, not a hidden one.
  assert.ok(closed.includes('dara') && closed.includes(en.record_kind_item_quantity_changed))

  const open = render(SALE_RECORD, SALE_RECORDS_ADAPTER, true)
  assert.ok(open.includes('aria-expanded="true"'))
  assert.ok(open.includes('<table'))
})

check('a record with no diff says so instead of rendering an empty table', () => {
  const html = render({ id: 'audit:902', kind: 'delete', actor_username: 'chan', changes: [] }, ENTITY_RECORDS_ADAPTER)
  assert.ok(html.includes(en.historical_details_unavailable))
  assert.ok(!html.includes('<table'))
  assert.ok(html.includes(en.delete), 'who deleted it is still a record')
})

check('provenance: an unattributed record names nobody rather than guessing', () => {
  const html = render({ ...SALE_RECORD, actor_username: 'dara', provenance_unknown: true }, SALE_RECORDS_ADAPTER)
  assert.ok(html.includes(en.unknown))
  assert.ok(!html.includes('>dara<'))
})

if (failed) { console.error(`${failed} records float case(s) failed`); process.exit(1) }
console.log('records float rendered: all cases pass')
