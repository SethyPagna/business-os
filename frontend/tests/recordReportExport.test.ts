import assert from 'node:assert/strict'
import * as XLSX from 'xlsx'
import { collectRecordExport, selectRecordExport, recordExportTotals, validateRecordExportRow, recordExportWorksheet, recordExportObjects, recordExportPrint, type RecordExportDocument, type RecordExportRow } from '../src/components/sales/reports/recordReportExport.ts'
import { buildTypedWorkbook } from '../src/utils/xlsxExport.ts'
import { buildPrintDocument } from '../src/utils/exportOptions.ts'
const token = 'a'.repeat(64)
for (const kind of ['returns', 'expenses'] as const) {
  const rows = Array.from({ length: 603 }, (_, i) => ({ id: 603 - i, cursor_at: '2026-09-24 03:00:00', date: kind === 'returns' ? '2026-09-24 03:00:00' : '2026-09-24', created_at: '2026-09-24 03:00:00', business_date: '2026-09-24',
    return_number: `000${603 - i}`, sale_receipt_number: null, party: 'សុខា', scope: 'customer', type: 'store_credit', reason: '<script>', status: 'completed', refund_usd: .105, refund_khr: 420,
    label: 'អគ្គិសនី', branch: 'Shop', linked_sale_receipt_number: null, notes: '', amount_usd: .105, amount_khr: 7 }))
  const totals = kind === 'returns' ? { count: 603, refund_usd: 63.32 } : { count: 603, amount_usd: 63.32, amount_khr: 4221 }
  const header = { export_version: 1, export_token: token, snapshot_max_id: 603, row_count: 603 }
  const calls: any[] = []
  const transport = async (q: any) => { calls.push(q); if (q.verifyOnly) return { ...header, verified: true }; const page = q.afterId ? rows.slice(500) : rows.slice(0, 500);
    return { ...header, rows: page, totals, has_more: !q.afterId, next_cursor: q.afterId ? null : { id: page.at(-1)!.id, created_at: page.at(-1)!.cursor_at } } }
  const result = await collectRecordExport(kind, { q: 'translated display text', scope: 'customer' }, transport, () => true)
  for (const legacy of ['2026-09-24', '2026-09-24 03:00', '2026-09-24T03:00+07:00']) {
    const raw = { ...rows[0], cursor_at: '2026-09-23T20:00:00.000Z', ...(kind === 'returns' ? { date: legacy } : { created_at: legacy }) }
    assert.doesNotThrow(() => validateRecordExportRow(kind, raw))
    assert.equal((validateRecordExportRow(kind, raw) as any)[kind === 'returns' ? 'date' : 'created_at'], legacy, 'legacy visible history remains unchanged')
  }
  assert.equal(result.rows.length, 603); assert.equal(calls.length, 3); assert(calls.every(q => q.q === undefined)); assert.deepEqual(recordExportTotals(kind, result.rows), totals)
  const selected = selectRecordExport(kind, result, row => row.id <= 103)
  assert.equal(selected.rows.length, 103); assert.deepEqual(selected.totals, kind === 'returns' ? { count: 103, refund_usd: 10.82 } : { count: 103, amount_usd: 10.82, amount_khr: 721 })
  assert.throws(() => selectRecordExport(kind, result, () => false), (e: any) => e.code === 'empty')
  for (const patch of [{ id: '1' }, { cursor_at: '2026-02-30 03:00:00' }, { type: [] }, { reason: {} }, { label: [] }, { date: null }, { ...(kind === 'returns' ? { refund_usd: '1' } : { amount_khr: {} }) }]) {
    if (kind === 'returns' && 'label' in patch || kind === 'expenses' && 'reason' in patch) continue
    assert.throws(() => validateRecordExportRow(kind, { ...rows[0], ...patch }), (e: any) => e.code === 'invalid')
  }
  const footer: RecordExportRow = { ...result.rows[0], id: 0, date: '', created_at: '', ...totals } as RecordExportRow
  const doc: RecordExportDocument = { ...result, totals: footer, title: 'របាយការណ៍', subtitle: '24/09/2026', language: 'km', metadata: ['Shop', '603 records'], filename: kind,
    fmtMoney: (usd, khr) => `$${usd.toFixed(2)}${khr ? ' · '+khr+'៛' : ''}`, columns: [
      { key: 'date', label: 'Date', kind: kind === 'returns' ? 'datetime' : 'date', value: row => row.date },
      { key: 'reference', label: 'Receipt', value: row => 'return_number' in row ? row.return_number : row.label },
      { key: 'amount', label: 'Amount', kind: 'money', value: row => 'refund_usd' in row ? row.refund_usd : row.amount_usd, ...(kind === 'expenses' ? { khr: (row: RecordExportRow) => 'amount_khr' in row ? row.amount_khr : 0 } : {}) },
    ] }
  const input = recordExportWorksheet(doc), book = buildTypedWorkbook(input)
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }), roundtrip = XLSX.read(bytes, { type: 'buffer', cellNF: true })
  const sheet = roundtrip.Sheets[roundtrip.SheetNames[0]]
  assert(input.columns.some(c => c.label === 'Amount (USD)' && c.kind === 'money'))
  if (kind === 'expenses') assert(input.columns.some(c => c.label === 'Amount (KHR)' && c.kind === 'int'))
  assert.equal(input.rows.length, 603); assert.equal(recordExportObjects(doc, true).length, 604)
  assert(Object.values(sheet).some((cell: any) => cell?.t === 'n' && cell.z?.includes('dd/mm/yyyy')))
  const print = recordExportPrint(doc); assert.equal(print.rows.length, 603)
  const html = buildPrintDocument(print); assert(html.includes('24/09/2026')); assert(!html.includes('<script>\n'))
  if (kind === 'returns') assert(!JSON.stringify(print.rows).includes('420៛'), 'same refund KHR is never added')
}
assert.deepEqual(recordExportTotals('returns', [{ refund_usd: .00499 }] as any), { count: 1, refund_usd: 0 }, 'no premature4dp rounding')
assert.deepEqual(recordExportTotals('expenses', [{ amount_usd: .005, amount_khr: .5 }, { amount_usd: .005, amount_khr: .5 }] as any), { count: 2, amount_usd: .01, amount_khr: 1 }, 'round only after exact full sum')
console.log('PASS returns/expenses603 cohort, strict primitive/date controls, exact filtered money, independent typed USD/KHR Excel and complete CSV/print')
