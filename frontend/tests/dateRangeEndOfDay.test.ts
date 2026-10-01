import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { normalizeTimeEntry, applyTimeEntryMask, joinLocalDateTime } from '../src/utils/dateEntry.ts'
import { reportUtcBound } from '../src/utils/businessTimeBounds.ts'
import { continuousRangeParams } from '../src/utils/continuousRangeParams.ts'
import { invoiceRangeParams } from '../src/utils/invoiceRangeParams.ts'
import { feeRangeParams } from '../src/api/feesTransport.ts'
import { returnRangeParams } from '../src/api/returnsReadTransport.ts'
import { returnsStatementParams } from '../src/utils/returnsExportWindow.ts'
import { dashboardRangeQuery } from '../src/components/dashboard/dashboardRange.ts'
import { reportQueryParams, getReportView } from '../src/components/sales/reports/reportModel.ts'

let failures = 0
function check(name: string, fn: () => void) {
  try { fn(); console.log('PASS ' + name) } catch (error) { failures++; console.error('FAIL ' + name, error) }
}
const range = { startDate: '2026-09-30', endDate: '2026-09-30', startTime: '09:00', endTime: '24:00' }
check('the actual shared picker grants end-of-day only to its end time input', () => {
  const source = readFileSync(new URL('../src/components/shared/DateTimeRangePicker.tsx', import.meta.url), 'utf8')
  const tree = ts.createSourceFile('DateTimeRangePicker.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let endGrants = 0
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'TimeEntryInput') {
      const grants = node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'allowEndOfDay')
      const value = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'value')
      if (grants) { endGrants++; assert.equal(value?.getText(tree), 'value={value.endTime}') }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.equal(endGrants, 1)
})
check('24 requires an explicit end role and only zero minutes and seconds', () => {
  for (const input of ['24', '2400', '24:00', '24:00:00', '240000']) {
    assert.deepEqual(normalizeTimeEntry(input, { allowEndOfDay: true }), { value: '24:00', minutes: 1440 })
    assert.equal(normalizeTimeEntry(input).value, null)
  }
  for (const input of ['24:01', '24:30', '24:00:30', '240030', '25:00', '24:00:0.1']) assert.equal(normalizeTimeEntry(input, { allowEndOfDay: true }).value, null, input)
  assert.equal(applyTimeEntryMask('2400', { allowEndOfDay: true }), '24:00')
  assert.equal(joinLocalDateTime('2026-09-30', '24:00'), '')
})
check('end input mask never discards nonzero24 seconds into a valid midnight', () => {
  for (const input of ['24:00:30', '240030', '24:00:01']) assert.equal(normalizeTimeEntry(applyTimeEntryMask(input, { allowEndOfDay: true }), { allowEndOfDay: true }).value, null, input)
  assert.equal(normalizeTimeEntry(applyTimeEntryMask('240000', { allowEndOfDay: true }), { allowEndOfDay: true }).value, '24:00')
})
check('24 is next midnight exclusively with no extra end minute, including calendar rollovers', () => {
  for (const date of ['2026-09-30', '2026-12-31', '2024-02-29']) {
    assert.equal(reportUtcBound(date, '24:00', 1), date + ' 17:00:00')
    assert.equal(reportUtcBound(date, '23:59', 1), date + ' 17:00:00')
    assert.equal(reportUtcBound(date, '24:00'), null)
  }
  for (const time of ['24:01', '24:30', '24:00:30']) assert.equal(reportUtcBound(range.endDate, time, 1), null)
  assert.equal(reportUtcBound('2026-02-29', '24:00', 1), null)
  assert.equal(reportUtcBound('', '24:00', 1), null)
})
check('continuous helpers use the same exclusive boundary and reject end24 as a start', () => {
  const expected = { startDate: range.startDate, endDate: range.endDate, createdFrom: '2026-09-30 02:00:00', createdTo: '2026-09-30 17:00:00' }
  assert.deepEqual(continuousRangeParams(range), expected)
  assert.deepEqual(dashboardRangeQuery(range), expected)
  assert.deepEqual(returnsStatementParams(range), expected)
  assert.equal(feeRangeParams(range).createdTo, expected.createdTo)
  assert.equal(returnRangeParams(range).createdTo, expected.createdTo)
  assert.equal(invoiceRangeParams(range).createdTo, expected.createdTo)
  assert.equal(reportQueryParams({ ...range, branchId: '', status: '', paymentMethod: '' }, getReportView('sales')).createdTo, expected.createdTo)
  assert.throws(() => continuousRangeParams({ ...range, startTime: '24:00' }))
  assert.throws(() => continuousRangeParams({ ...range, startDate: '' }))
})
check('full-day24 retains fee booking and unknown invoice clock policies; alltime remains empty', () => {
  const full = { ...range, startTime: '00:00' }
  assert.deepEqual(feeRangeParams(full), { from: range.startDate, to: range.endDate })
  assert.deepEqual(invoiceRangeParams(full), { from: range.startDate, to: range.endDate })
  assert.deepEqual(returnRangeParams(full), { startDate: range.startDate, endDate: range.endDate })
  assert.deepEqual(dashboardRangeQuery(full), { startDate: range.startDate, endDate: range.endDate })
  assert.deepEqual(reportQueryParams({ ...full, branchId: '', status: '', paymentMethod: '' }, getReportView('expenses')), { startDate: range.startDate, endDate: range.endDate })
  assert.deepEqual(invoiceRangeParams({ startDate: '', endDate: '', startTime: '', endTime: '' }), { from: '', to: '' })
})
check('one-year statement cap does not gain one minute at24', () => {
  assert.equal(returnsStatementParams({ startDate: '2025-10-01', endDate: '2026-09-30', startTime: '00:00', endTime: '24:00' }).createdTo, '2026-09-30 17:00:00')
  assert.throws(() => returnsStatementParams({ startDate: '2025-10-01', endDate: '2026-10-01', startTime: '00:00', endTime: '24:00' }))
})
process.exitCode = failures ? 1 : 0
