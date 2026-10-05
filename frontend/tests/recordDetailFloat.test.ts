// The "more details" float of a Records row, RENDERED.
//
// The owner, 5 Oct 2026: "Keep the click-a-record-to-view-details hint. A
// record shows before and after. A more-details option opens another float
// that is VIEW ONLY: no edits, no actions, just viewing. Products have no
// created-date filter; the created date lives in the product's own Records."
//
// What is pinned, each against the real component (components/shared/
// RecordDetailFloat.tsx, loaded by recordsFloatModule.ts) and the real
// entityRecords adapters:
//
//   * VIEW ONLY: the rendered float has no input, textarea, select or button of
//     its own, and its source imports no writer.
//   * ONLY what changed: an unchanged column is not listed; a changed one reads
//     old -> new with the app's money formatter and the pack's field name.
//   * COST: a viewer without product_cost_view never gets a cost line, and the
//     viewer with it does -- the positive control that makes the first half
//     capable of failing. The default is fail-closed.
//   * the Records row offers the details icon (translated name, icon only) only
//     where the caller can open it, and the hint stays.
//   * the product's created date becomes its Records line, once.
//   * both packs, no English in Khmer.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { loadRecordDetailFloatModule, loadRecordsFloatModule } from './recordsFloatModule.ts'
import {
  ENTITY_RECORDS_ADAPTER,
  auditRowsToRecords,
  isAcquisitionCostField,
  recordForViewer,
  withCreatedRecord,
  type RecordItem,
} from '../src/utils/entityRecords.ts'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server')

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const en = JSON.parse(read('../src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('../src/lang/km.json')) as Record<string, string>
const translator = (dictionary: Record<string, string>) => (key: string): string => typeof dictionary[key] === 'string' ? dictionary[key] : key
const tEn = translator(en)
const tKm = translator(km)

const DetailFloat = loadRecordDetailFloatModule().default as React.ComponentType<Record<string, unknown>>
const RecordRow = loadRecordsFloatModule().RecordRow as React.ComponentType<Record<string, unknown>>

const fmt = {
  fmtUSD: (amount: number | string) => `$${Number(amount).toFixed(2)}`,
  fmtKHR: (amount: number | string) => `${Number(amount).toLocaleString('en-US')}៛`,
}
const detail = (record: RecordItem, extra: Record<string, unknown> = {}, t = tEn): string => renderToStaticMarkup(
  React.createElement(DetailFloat, { record, adapter: ENTITY_RECORDS_ADAPTER, onClose: () => {}, t, ...fmt, ...extra }),
)

let failed = 0
const check = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) }
  catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

// A product edit that moved the price AND the cost, and left the barcode alone.
const [EDIT] = auditRowsToRecords([{
  id: 900,
  action: 'update',
  entity: 'product',
  user_name: 'sokha',
  created_at: '2026-09-22 10:15:00',
  details: JSON.stringify({ reason: 'Supplier raised the price' }),
  old_value: JSON.stringify({ id: 12, name: 'Serum 30ml', selling_price_usd: 3, cost_price_usd: 1.25, barcode: '885' }),
  new_value: JSON.stringify({ id: 12, name: 'Serum 30ml', selling_price_usd: 4.5, cost_price_usd: 1.8, barcode: '885' }),
}])

check('view only: no input, no select, no textarea, no button, no form', () => {
  const html = detail(EDIT, { canViewCosts: true })
  for (const tag of ['<input', '<textarea', '<select', '<button', '<form', 'contenteditable']) {
    assert.ok(!html.includes(tag), `a view-only float rendered ${tag}`)
  }
  // POSITIVE CONTROL: the row that OPENS it does render a button, so the
  // assertion above is capable of failing on this renderer.
  const row = renderToStaticMarkup(React.createElement(RecordRow, { record: EDIT, adapter: ENTITY_RECORDS_ADAPTER, open: true, onToggle: () => {}, onOpenDetails: () => {}, t: tEn, ...fmt }))
  assert.ok(row.includes('<button'), 'the control renderer must contain a button')
})

check('view only: the source imports no writer and declares itself read-only', () => {
  const source = read('../src/components/shared/RecordDetailFloat.tsx')
  assert.doesNotMatch(source, /from '\.\.\/\.\.\/api\//, 'a view-only float must not import a transport')
  assert.doesNotMatch(source, /useState|useEffect|apiFetch|onClick|onChange|onSubmit/, 'nothing here may hold state or act')
  assert.match(source, /unsavedChanges="read-only"/)
  assert.match(source, /layer="nested"/, 'it opens over the Records float')
})

check('only what changed: the unchanged column is absent, the changed one reads old -> new', () => {
  const html = detail(EDIT, { canViewCosts: true })
  assert.ok(html.includes(en.label_selling_price), 'the pack word for the price column')
  assert.ok(html.includes('$3.00') && html.includes('$4.50'), 'money goes through the app formatter, before and after')
  assert.ok(html.includes('data-record-before') && html.includes('data-record-after'))
  assert.ok(html.indexOf('$3.00') < html.indexOf('$4.50'), 'old comes before new')
  assert.ok(html.includes('Supplier raised the price'), 'the typed reason is part of the record')
  assert.ok(!html.includes('885'), 'an unchanged column is not a change')
  assert.ok(!html.includes('selling_price_usd'), 'a raw column name reached the screen')
  assert.ok(html.includes('sokha') && html.includes('#900'), 'who, and which entry')
  assert.ok(html.includes('08/09/2026 12:00'), 'the time comes through the business-zone formatter')
})

check('a field with no recorded old side shows its value alone in the float, and explicitly in the table', () => {
  const html = detail(EDIT, { canViewCosts: true })
  assert.ok(!html.includes(en.historical_details_unavailable), 'no arrow from "details unavailable"')
  assert.equal(html.split('data-record-before').length - 1, 2, 'price and cost have an old side; the typed reason does not')
  assert.equal(html.split('data-record-after').length - 1, 3)
  const table = renderToStaticMarkup(React.createElement(RecordRow, { record: EDIT, adapter: ENTITY_RECORDS_ADAPTER, open: true, onToggle: () => {}, canViewCosts: true, t: tEn, ...fmt }))
  assert.ok(table.includes(en.historical_details_unavailable), 'the inline table keeps its three columns and says so')
})

check('cost: hidden without permission, shown with it, and the default is fail-closed', () => {
  const denied = detail(EDIT, { canViewCosts: false })
  const byDefault = detail(EDIT)
  const granted = detail(EDIT, { canViewCosts: true })
  for (const html of [denied, byDefault]) {
    assert.ok(!html.includes('$1.25') && !html.includes('$1.80'), 'a cost value reached a viewer without cost permission')
    assert.ok(!html.includes(en.label_cost_purchase), 'a cost label reached a viewer without cost permission')
    assert.ok(html.includes('$4.50'), 'the price they may see is still there')
  }
  assert.ok(granted.includes('$1.25') && granted.includes('$1.80') && granted.includes(en.label_cost_purchase), 'the viewer WITH cost permission sees it')
})

check('cost: the inline table obeys the same gate as the float', () => {
  const row = (canViewCosts?: boolean) => renderToStaticMarkup(React.createElement(RecordRow, { record: EDIT, adapter: ENTITY_RECORDS_ADAPTER, open: true, onToggle: () => {}, t: tEn, canViewCosts, ...fmt }))
  assert.ok(!row().includes('$1.25'))
  assert.ok(!row(false).includes('$1.80'))
  assert.ok(row(true).includes('$1.25'))
})

check('cost rule is the Worker rule: same key test, and a delivery cost is not an acquisition cost', () => {
  for (const key of ['cost_price_usd', 'purchase_price_khr', 'profit_usd', 'margin', 'stock_value_usd', 'total_cost', 'supplier_loss_usd', 'items.cost_price_usd']) {
    assert.ok(isAcquisitionCostField(key), `${key} must be a cost field`)
  }
  for (const key of ['selling_price_usd', 'delivery_actual_cost', 'actual_delivery_cost_usd', 'courier_cost_usd', 'name', 'barcode', 'amount_usd']) {
    assert.ok(!isAcquisitionCostField(key), `${key} must NOT be a cost field`)
  }
  // The client rule is a copy; the Worker file is the authority. Both carry the
  // same regular expression text, so one cannot drift from the other unseen.
  const worker = readFileSync(new URL('../../cloudflare/src/lib/acquisitionCostAccess.ts', import.meta.url), 'utf8')
  const client = read('../src/utils/entityRecords.ts')
  for (const fragment of [
    '(^|_)(cost|costs|cogs|profit|margin|purchase_price|stock_value|removal_loss)(_|$)',
    '(^|_)(delivery|courier)(_|$)',
    '^(supplier_)?(compensation|loss)_(usd|khr)$',
  ]) {
    assert.ok(worker.includes(fragment), `the Worker no longer carries ${fragment}`)
    assert.ok(client.includes(fragment), `the client rule drifted from ${fragment}`)
  }
  assert.equal(recordForViewer(EDIT, true), EDIT, 'a viewer with cost permission gets the record untouched')
  assert.ok(recordForViewer(EDIT, false).changes!.every((change) => !isAcquisitionCostField(change.field)))
})

check('the row offers the details icon only where it can open one; it is icon-only with a translated name', () => {
  const html = renderToStaticMarkup(React.createElement(RecordRow, { record: EDIT, adapter: ENTITY_RECORDS_ADAPTER, open: true, onToggle: () => {}, onOpenDetails: () => {}, t: tEn, ...fmt }))
  assert.ok(html.includes('data-records-more-details'))
  assert.ok(html.includes(`aria-label="${en.more_details}"`) && html.includes(`title="${en.more_details}"`))
  const khmer = renderToStaticMarkup(React.createElement(RecordRow, { record: EDIT, adapter: ENTITY_RECORDS_ADAPTER, open: true, onToggle: () => {}, onOpenDetails: () => {}, t: tKm, ...fmt }))
  assert.ok(khmer.includes(`aria-label="${km.more_details}"`) && !khmer.includes(en.more_details))
  const without = renderToStaticMarkup(React.createElement(RecordRow, { record: EDIT, adapter: ENTITY_RECORDS_ADAPTER, open: true, onToggle: () => {}, t: tEn, ...fmt }))
  assert.ok(!without.includes('data-records-more-details'), 'no handler, no icon')
  const closed = renderToStaticMarkup(React.createElement(RecordRow, { record: EDIT, adapter: ENTITY_RECORDS_ADAPTER, open: false, onToggle: () => {}, onOpenDetails: () => {}, t: tEn, ...fmt }))
  assert.ok(!closed.includes('data-records-more-details'), 'a closed row shows its before/after first, then the icon')
  // The visible text of the button is nothing: icon only.
  assert.match(html, /data-records-more-details=""[^>]*><svg|data-records-more-details=""[^>]*><\/button>/)
})

check('the hint stays and the float wires the details float over itself', () => {
  const source = read('../src/components/shared/RecordsFloat.tsx')
  assert.match(source, /data-records-hint/)
  assert.match(source, /label\('tap_to_view_details', 'Tap a record to view details\.'\)/)
  assert.match(source, /<RecordDetailFloat/)
  assert.match(source, /onOpenDetails=\{\(\) => setDetailId\(record\.id\)\}/)
  assert.ok(en.tap_to_view_details && km.tap_to_view_details, 'the hint exists in both packs')
  assert.ok(en.more_details && km.more_details, 'the tooltip exists in both packs')
  // Every record float passes the viewer's cost permission down; none relies on the default.
  assert.match(read('../src/components/sales/Sales.tsx'), /<SaleRecordsFloat[^>]*[^]{0,200}canViewCosts=\{canViewAcquisitionCosts\(user\)\}/)
  assert.match(read('../src/components/returns/Returns.tsx'), /adapter=\{RETURN_RECORDS_ADAPTER\}\s+canViewCosts=\{canViewAcquisitionCosts\(user\)\}/)
  for (const pane of ['../src/components/products/surfaces/ProductDetailModal.tsx', '../src/components/inventory/ProductDetailModal.tsx']) {
    const text = read(pane)
    assert.match(text, /createdAt=\{.*created_at.*\}\s+canViewCosts=\{canViewCosts\}/, `${pane} must pass the created date and the cost permission`)
  }
})

check('product created date: becomes the first Records line, once, and never doubles a real create', () => {
  const stamp = '2026-08-01 09:30:00'
  const withCreated = withCreatedRecord([EDIT], stamp, 'product:12')
  assert.equal(withCreated.length, 2)
  assert.equal(withCreated[0].kind, 'create')
  assert.equal(withCreated[0].at, stamp)
  assert.equal(withCreated[0].actor_username, null, 'the column does not say who; none is claimed')
  const [real] = auditRowsToRecords([{ id: 5, action: 'create', entity: 'product', user_name: 'dara', created_at: '2026-08-01 09:31:00', new_value: JSON.stringify({ name: 'Serum 30ml' }) }])
  assert.equal(withCreatedRecord([real, EDIT], stamp, 'product:12').length, 2, 'a real create row is not doubled')
  assert.equal(withCreatedRecord([EDIT], null, 'product:12').length, 1, 'no created date, no invented line')
  assert.equal(withCreatedRecord([EDIT], '  ', 'product:12').length, 1)
  // It reads in the details float with its date and no fabricated comparison.
  const html = detail(withCreated[0])
  assert.ok(html.includes(en.create) && html.includes('08/09/2026 12:00'))
  assert.ok(!html.includes('data-record-change'), 'a creation line carries no before/after rows of its own')
  assert.ok(!html.includes(en.historical_details_unavailable), 'and does not claim details are missing')
})

check('a record with nothing comparable says so, and a delete still names who', () => {
  const html = detail({ id: 'audit:902', kind: 'delete', actor_username: 'chan', at: '2026-09-22 11:00:00', changes: [] })
  assert.ok(html.includes(en.historical_details_unavailable))
  assert.ok(html.includes('chan') && html.includes(en.delete))
})

check('both packs: no English field, fact or heading leaks into the Khmer float', () => {
  const html = detail(EDIT, { canViewCosts: true }, tKm)
  for (const key of ['edit', 'label_selling_price', 'user', 'recorded_at', 'changed_fields', 'reason'] as const) {
    assert.ok(html.includes(km[key]), `the Khmer pack word for ${key} is missing`)
    assert.ok(!html.includes(en[key]), `English ${key} leaked into the Khmer render`)
  }
  // Khmer glyphs need vertical room.
  assert.match(html, /leading-relaxed/)
  assert.doesNotMatch(html, /leading-none|leading-tight/)
})

if (failed) { console.error(`${failed} record detail case(s) failed`); process.exit(1) }
console.log('record detail float: all cases pass')
