import assert from 'node:assert/strict'
import { getReportView, reportQueryParams, reportUtcBound, type ReportFilters } from '../src/components/sales/reports/reportModel.ts'

let failed = 0
const test = (name: string, fn: () => void): void => {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

const filters = (patch: Partial<ReportFilters> = {}): ReportFilters => ({
  startDate: '2026-08-30',
  endDate: '2026-09-05',
  startTime: '12:00',
  endTime: '14:00',
  branchId: '',
  status: '',
  paymentMethod: '',
  ...patch,
})

test('Cambodia wall-clock bounds serialize to fixed UTC without device-timezone dependence', () => {
  assert.equal(reportUtcBound('2026-08-30', '12:00'), '2026-08-30 05:00:00')
  assert.equal(reportUtcBound('2026-09-05', '14:00', 1), '2026-09-05 07:01:00')
  assert.equal(reportUtcBound('2026-01-01', '00:00'), '2025-12-31 17:00:00')
  assert.equal(reportUtcBound('2026-02-29', '10:00'), null, 'invalid calendar dates are rejected')
})

test('endpoint times become one continuous range and never a recurring daily mask', () => {
  const query = reportQueryParams(filters(), getReportView('sales'))
  assert.deepEqual(query, {
    startDate: '2026-08-30',
    endDate: '2026-09-05',
    createdFrom: '2026-08-30 05:00:00',
    createdTo: '2026-09-05 07:01:00',
  })
  assert.ok(!('startTime' in query) && !('endTime' in query))
})

test('the selected end minute is inclusive through the next-minute exclusive bound', () => {
  const query = reportQueryParams(filters({ startDate: '2026-09-05', endDate: '2026-09-05', startTime: '23:59', endTime: '23:59' }), getReportView('returns'))
  assert.equal(query.createdFrom, '2026-09-05 16:59:00')
  assert.equal(query.createdTo, '2026-09-05 17:00:00')
})

test('returns and expenses expose endpoint time only with their created_at backend contract', () => {
  assert.equal(getReportView('returns').supportsTime, true)
  assert.equal(getReportView('expenses').supportsTime, true)
  assert.ok('createdFrom' in reportQueryParams(filters(), getReportView('returns')))
  assert.ok('createdFrom' in reportQueryParams(filters(), getReportView('expenses')))
})

test('full-day reports omit exact bounds and preserve date-only historical semantics', () => {
  assert.deepEqual(reportQueryParams(filters({ startTime: '00:00', endTime: '23:59' }), getReportView('expenses')), {
    startDate: '2026-08-30',
    endDate: '2026-09-05',
  })
})

test('reversed or invalid endpoint ranges fail instead of becoming overnight masks', () => {
  assert.throws(
    () => reportQueryParams(filters({ startDate: '2026-09-05', endDate: '2026-09-05', startTime: '14:00', endTime: '12:00' }), getReportView('sales')),
    /must be after/,
  )
  assert.throws(
    () => reportQueryParams(filters({ startDate: '2026-02-29' }), getReportView('sales')),
    /must be after/,
  )
})

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1) }
console.log('\nAll continuous report date-time tests passed')
