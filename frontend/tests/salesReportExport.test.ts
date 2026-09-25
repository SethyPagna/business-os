import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { collectSalesExport, mapExportTotals, validateExportSale, saleExportObjects, saleExportWorksheet, saleExportPrint, type SalesExportDocument } from '../src/components/sales/reports/salesReportExport.ts'
import { buildTypedWorkbook, exportDateSerial } from '../src/utils/xlsxExport.ts'
import { buildPrintDocument } from '../src/utils/exportOptions.ts'
import type { QueryParams } from '../src/api/query.ts'

const token = 'a'.repeat(64)
const totals = { gross_sales_usd: .01, store_discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, delivery_usd: 0,
  refund_usd: 0, revenue_usd: .01, pending_revenue_usd: 0, collected_total_usd: .01 }
function row(id: number) {
  return { id, cursor_at: `2026-09-24T${id === 2 ? '17:30' : '16:30'}:00.000Z`, date: `2026-09-24T${id === 2 ? '17:30' : '16:30'}:00.000Z`,
    business_date: id === 2 ? '2026-09-25' : '2026-09-24', receipt_number: '000123', customer_phone: '000123', customer: 'សុខា',
    branch: 'Shop', cashier: 'Cashier', payment_method: 'Cash', status: 'completed', gross_sales_usd: 0,
    store_discount_usd: 0, membership_discount_usd: 0, tax_usd: 0, delivery_usd: 0, refund_usd: 0,
    net_revenue_usd: 0, pending_revenue_usd: 0, collected_total_usd: 0 }
}
function page(rows: unknown[], has_more = false, row_count = 2) {
  const tail = rows[rows.length - 1] as ReturnType<typeof row>
  return { export_version: 1, export_token: token, snapshot_max_id: 2, row_count, totals, rows, has_more,
    next_cursor: has_more ? { id: tail?.id ?? 2, created_at: tail?.cursor_at ?? row(2).cursor_at } : null }
}
const verified = { export_version: 1, export_token: token, snapshot_max_id: 2, row_count: 2, verified: true }
const queries: QueryParams[] = []
const responses = [page([row(2)], true), page([row(1)]), verified]
const result = await collectSalesExport({ q: 'សុខា', branchId: '2', intent: 'view', pageSize: 1, verifyOnly: 1 }, async query => {
  queries.push(query)
  return responses.shift()
}, () => true)
assert.equal(result.rows.length, 2)
assert.equal(result.totals.net_revenue_usd, .01, 'authoritative total differs from sum of rounded receipt values (0)')
assert.equal(result.rows.reduce((sum, item) => sum + item.net_revenue_usd, 0), 0)
assert.ok(queries.every(query => query.intent === 'export' && query.pageSize === 500 && query.order === 'desc' && query.q === 'សុខា'))
assert.equal(queries[0].verifyOnly, undefined, 'caller cannot inject verification/paging controls')
assert.equal(queries[1].exportToken, token)
assert.equal(queries[1].snapshotMaxId, 2)
assert.equal(queries[1].afterId, 2)
assert.equal(queries[2].verifyOnly, 1)
assert.equal(queries[2].afterId, undefined, 'final verification omits cursor')

let published = 0
async function refuses(responseList: unknown[], code = 'invalid') {
  await assert.rejects(async () => {
    await collectSalesExport({}, async () => responseList.shift(), () => true)
    published++
  }, (error: any) => error.code === code)
}
await refuses([page([], false, 0)], 'empty')
await refuses([page([], true)])
await refuses([{ ...page([row(2)]), row_count: 10001 }], 'large')
for (const mutation of [{ id: 0 }, { net_revenue_usd: null }, { date: 'not a date' }, { date: '2026-02-30T00:00:00Z' },
  { business_date: '2026-02-30' }, { customer_phone: 123 }, { cost_usd: 0 }]) {
  assert.doesNotThrow(() => validateExportSale(row(2)), 'positive control for the targeted row validator')
  assert.throws(() => validateExportSale({ ...row(2), ...mutation }), (error: any) => error.code === 'invalid')
  await refuses([page([{ ...row(2), ...mutation }, row(1)]), verified])
}
await refuses([page([row(2)], true), page([row(2)])])
await refuses([page([row(2)], true), page([])])
await refuses([{ ...page([row(2)], true), next_cursor: { id: 1, created_at: row(1).cursor_at } }])
await refuses([page([row(2)], true), { ...page([row(1)]), export_token: 'b'.repeat(64) }], 'changed')
await refuses([page([row(2)], true), { ...page([row(1)]), totals: { ...totals, revenue_usd: 100 } }], 'changed')
await refuses([page([row(2), row(1)]), { ...verified, verified: false }], 'changed')
await refuses([page([row(2), row(1)]), { ...verified, row_count: 1 }], 'changed')
await refuses([page([row(1), row(2)])])
assert.equal(published, 0, 'malformed, changed, partial and oversized reports publish nothing')

for (const code of ['report_export_changed', 'report_export_too_large']) {
  await assert.rejects(collectSalesExport({}, async () => { throw { code } }, () => true),
    (error: any) => error.code === (code.endsWith('changed') ? 'changed' : 'large'))
}
let current = true
await assert.rejects(collectSalesExport({}, async () => { current = false; return page([row(2), row(1)]) }, () => current),
  (error: any) => error.code === 'unavailable', 'permission revoked mid-walk')
let calls = 0
await assert.rejects(collectSalesExport({}, async () => {
  calls++
  const item = { ...row(1), id: 22 - calls, cursor_at: `2026-09-24T00:00:${String(22 - calls).padStart(2, '0')}Z` }
  return { ...page([item], true, 21), snapshot_max_id: 21 }
}, () => true), (error: any) => error.code === 'large')
assert.equal(calls, 20, 'walk ceiling stops exactly at 20 requests')

const inputQuery = { q: 'first' }
const frozenCalls: QueryParams[] = []
await collectSalesExport(inputQuery, async query => {
  frozenCalls.push(query); inputQuery.q = 'changed'
  return query.verifyOnly ? verified : page([row(2), row(1)])
}, () => true)
assert.ok(frozenCalls.every(query => query.q === 'first'), 'query values are copied at start')
assert.equal(mapExportTotals(totals).cost_usd, undefined, 'hidden costs are not zero')
const costTotals = mapExportTotals({ ...totals, cost_usd: 0, profit_usd: .01, money_unknown_cost_lines: 1 })
assert.equal(costTotals.cost_usd, 0)
assert.equal(costTotals.cost_missing_snapshot_lines, 1, 'unknown snapshots remain explicit beside known zero')
assert.equal(validateExportSale({ ...row(1), cost_usd: 0, cost_before_floor_usd: 0, gross_profit_usd: 0, cost_missing_snapshot_lines: 1 }).cost_missing_snapshot_lines, 1)

const document: SalesExportDocument = { ...result, totals: { ...result.totals, receipt_number: 'Total' }, title: 'របាយការណ៍/លក់', subtitle: '24/09/2026 – 25/09/2026',
  metadata: ['ហាង', '2 receipts', 'Generated 25/09/2026 00:31 (UTC+7)'], filename: 'sales', language: 'km', fmtMoney: n => `$${n.toFixed(2)}`,
  columns: [
    { key: 'receipt_number', label: 'Receipt', value: r => r.receipt_number },
    { key: 'customer_phone', label: 'Phone', value: r => r.customer_phone },
    { key: 'customer', label: 'Customer', value: r => r.customer },
    { key: 'business_date', label: 'Date', kind: 'date', value: r => r.business_date },
    { key: 'date', label: 'Time', kind: 'datetime', value: r => r.date },
    { key: 'net_revenue_usd', label: 'Revenue', kind: 'money', value: r => r.net_revenue_usd },
    { key: 'pct', label: 'Margin', kind: 'pct', value: r => r.id ? 12.5 : null },
  ] }
const worksheet = saleExportWorksheet(document)
const workbook = buildTypedWorkbook(worksheet)
const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', compression: true })
const roundtrip = XLSX.read(bytes, { type: 'buffer', cellNF: true, cellText: true })
const sheet = roundtrip.Sheets[roundtrip.SheetNames[0]]
const start = worksheet.metadata!.length + 2
assert.equal(sheet[`A${start}`].v, '000123'); assert.equal(sheet[`A${start}`].t, 's'); assert.equal(sheet[`A${start}`].z, '@')
assert.equal(sheet[`B${start}`].v, '000123'); assert.equal(sheet[`C${start}`].v, 'សុខា')
assert.equal(sheet[`D${start}`].w, '25/09/2026')
assert.equal(sheet[`E${start}`].w, '25/09/2026 00:30', 'UTC+7 midnight independent of device timezone')
assert.equal(sheet[`E${start + 1}`].w, '24/09/2026 23:30')
assert.equal(sheet[`F${start}`].t, 'n'); assert.equal(sheet[`F${start}`].v, 0)
assert.equal(sheet[`F${start + 2}`].v, .01, 'Excel totals use canonical result')
assert.equal(sheet[`G${start}`].v, .125); assert.equal(sheet[`G${start}`].w, '12.50%')
assert.ok(!roundtrip.SheetNames[0].includes('/'))
assert.throws(() => buildTypedWorkbook({ ...worksheet, rows: [] }), /No rows/)
assert.throws(() => exportDateSerial('2026-02-30T00:00:00Z', true), /Invalid export date/)
const objects = saleExportObjects(document, true)
assert.equal(objects.at(-1)!.Revenue, '$0.01')
const printed = saleExportPrint(document)
assert.deepEqual(printed.rows, objects.slice(0, -1)); assert.deepEqual(printed.totals, objects.at(-1))
const html = buildPrintDocument(printed)
for (const fragment of ['lang="km"', 'ហាង', 'UTC+7', 'class="numeric"', 'class="totals"', 'size: A4 landscape', 'table-header-group', '$0.01']) assert.ok(html.includes(fragment), fragment)
console.log('PASS verified Sales full walk, strict failure cases, frozen query, authoritative totals and typed Excel/CSV/print roundtrip')
