// A server stamp such as "2026-10-13 18:00:00" is UTC with no marker, which is 01:00 on 14/10/2026 in Phnom Penh. Every place that
// reads one must name the same day and time on a Los Angeles, Phnom Penh or UTC device.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { batchReceivedIsoDay, formatBatchReceivedDate } from '../src/utils/batchLabel.ts'
import { fmtDate, fmtDateTime24, parseServerTimestampMs } from '../src/utils/formatters.ts'
import { sortRecords } from '../src/utils/listSort.ts'
import { getTimeParts, matchesYearMonthFilters } from '../src/utils/recordFilters.ts'
import { stockInLineDraft, type StockInLineEditRow } from '../src/utils/stockInLineEdit.ts'

const sourceOf = (path: string): string => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')

// The real function from a component file (module-level or a const inside the component), run with the names it closes over.
function extract<T>(path: string, name: string, scope: Record<string, unknown>): T {
  const file = ts.createSourceFile(path, sourceOf(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let text = ''
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(file)
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) text = node.parent.parent.getText(file)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.ok(text, `${name} is defined in ${path}`)
  const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  return new Function(...Object.keys(scope), `${compiled}; return ${name}`)(...Object.values(scope)) as T
}

const filesDateTime = extract<(value: unknown) => string>('components/files/FilesPage.tsx', 'formatDateTime', { fmtDateTime24, parseServerTimestampMs })
const zeroSince = extract<(value: string | null) => string>('components/products/ZeroQuantityCleanupModal.tsx', 'formatZeroSince', {
  T: (_key: string, fallback: string) => fallback, formatDate: undefined, fmtDate, parseServerTimestampMs,
})

const RAW = '2026-10-13 18:00:00'
const SAME_WITH_T = '2026-10-13T18:00:00'
assert.equal(fmtDateTime24('2026-10-13T18:00:00Z'), '14/10/2026 01:00', 'the reference time is 01:00 on 14/10/2026 in Phnom Penh')

const original = process.env.TZ
for (const zone of ['America/Los_Angeles', 'Asia/Phnom_Penh', 'UTC']) {
  process.env.TZ = zone
  const at = (what: string): string => `${zone}: ${what}`

  assert.equal(filesDateTime(RAW), '14/10/2026 01:00', at('Files shows the upload time'))
  assert.equal(filesDateTime(SAME_WITH_T), '14/10/2026 01:00', at('Files reads the T form the same way'))
  assert.equal(filesDateTime(''), '-')
  assert.equal(filesDateTime('not a date'), 'not a date')

  assert.equal(zeroSince(RAW), '14/10/2026', at('"Sold out since" names the Phnom Penh day'))
  assert.equal(zeroSince(null), 'Unknown')
  assert.equal(zeroSince('not a date'), 'not a date')

  const parts = getTimeParts(RAW)
  assert.deepEqual([parts.dayKey, parts.dayLabel, parts.monthKey, parts.yearLabel], ['2026-10-14', '14/10/2026', '2026-10', '2026'], at('record sections name the business day'))
  const newYear = getTimeParts('2026-12-31 18:00:00')
  assert.deepEqual([newYear.yearLabel, newYear.monthKey, newYear.monthLabel, newYear.dayKey], ['2027', '2027-01', 'January 2027', '2027-01-01'], at('a record created after midnight Phnom Penh on New Year belongs to the new year'))
  assert.equal(matchesYearMonthFilters('2026-12-31 18:00:00', { year: '2027', month: '01' }), true, at('and passes the 2027 / January filter'))
  assert.equal(matchesYearMonthFilters('2026-12-31 18:00:00', { year: '2026' }), false)
  assert.equal(getTimeParts(new Date('2026-12-31T18:00:00Z')).dayKey, '2027-01-01', at('a Date is read as the instant it is'))
  assert.equal(getTimeParts('not a date').date, null)

  const rows = [{ id: 'c', at: '2026-10-13T11:00:00Z' }, { id: 'a', at: '2026-10-13 10:00:00' }, { id: 'b', at: '2026-10-13T10:30:00' }]
  const sorted = sortRecords(rows, { field: 'at', direction: 'asc' }, [{ id: 'at', label: 'At', kind: 'date', get: (row) => row.at }])
  assert.deepEqual(sorted.map((row) => row.id), ['a', 'b', 'c'], at('date sorting reads a stamp with no offset as UTC beside one with a Z'))

  const lotRow = (received: string | null): StockInLineEditRow => ({ id: 1, quantity: 1, batch_id: 1, batch_received_at: received } as StockInLineEditRow)
  assert.equal(formatBatchReceivedDate('2026-09-01 20:00:00'), '02/09/2026')
  assert.equal(stockInLineDraft(lotRow('2026-09-01 20:00:00')).receivedDate, '2026-09-02', at('the stock-in edit field holds the day the label shows'))
  assert.equal(batchReceivedIsoDay('2026-09-01 20:00:00'), '2026-09-02', at('a lot received after midnight Phnom Penh is that Phnom Penh day'))
  assert.equal(batchReceivedIsoDay('2026-09-01'), '2026-09-01', at('a typed date stays as typed'))
  assert.equal(batchReceivedIsoDay('2026-09-01T10:00:00'), '2026-09-01')
  assert.equal(batchReceivedIsoDay(null), '')
  assert.equal(batchReceivedIsoDay('not a date'), '')
}
if (original === undefined) delete process.env.TZ
else process.env.TZ = original

// The batch editor is a component; its three reads of the received day must all go through the one helper.
const batches = sourceOf('components/inventory/ManageBatchesModal.tsx')
assert.equal((batches.match(/batchReceivedIsoDay\(batch\.received_at\)/g) || []).length, 3, 'edit draft, day drill-down and the Received link use the business day')
assert.doesNotMatch(batches, /received_at \|\| ''\)\.slice\(0, 10\)/, 'no read of the UTC day is left')

console.log('PASS server stamps with no offset read the same day and time in Los Angeles, Phnom Penh and UTC at every fixed site')
