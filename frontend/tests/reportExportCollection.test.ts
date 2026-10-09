import assert from 'node:assert/strict'
import { collectReportExport, record, finite, integer, timestamp } from '../src/components/sales/reports/reportExportCollection.ts'
const rows = Array.from({ length: 603 }, (_, i) => ({ id: 603 - i, cursor_at: '2026-09-24 03:00:00', amount: .105 }))
const token = 'a'.repeat(64), calls: any[] = []
const options = { queryKeys: ['scope'], validateRow(raw: unknown) { const row = record(raw); timestamp(row.cursor_at); return { id: integer(row.id, 1), cursor_at: row.cursor_at as string, amount: finite(row.amount) } }, validateTotals: (raw: unknown) => record(raw) }
const header = { export_version: 1, export_token: token, snapshot_max_id: 603, row_count: 603 }
const fetch = async (query: any) => {
  calls.push(query)
  if (query.verifyOnly) return { ...header, verified: true }
  const page = query.afterId ? rows.slice(500) : rows.slice(0, 500)
  return { ...header, totals: { amount: 63.32 }, rows: page, has_more: !query.afterId, next_cursor: query.afterId ? null : { id: page.at(-1)!.id, created_at: page.at(-1)!.cursor_at } }
}
const result = await collectReportExport({ scope: 'customer', q: 'display text', afterId: 999 }, fetch, () => true, options)
assert.equal(result.rows.length, 603)
assert.equal(calls.length, 3)
assert(calls.every(query => query.scope === 'customer' && query.q === undefined && query.pageSize === 500))
assert.equal(calls[1].afterId, 104)
let current = false
await assert.rejects(collectReportExport({}, fetch, () => current, options), (error: any) => error.code === 'unavailable')
current = true
await assert.rejects(collectReportExport({}, async query => { const page = await fetch(query); return query.afterId ? { ...page, export_token: 'b'.repeat(64) } : page }, () => current, options), (error: any) => error.code === 'changed')
console.log('PASS shared strict603 cohort, frozen allowed query keys, final verification and authority/changed continuation refusal')
