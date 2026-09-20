import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getReportView, reportQueryParams, reportUtcBound, REPORT_VIEWS, type ReportFilters } from '../src/components/sales/reports/reportModel.ts'
import { dashboardRangeQuery } from '../src/components/dashboard/dashboardRange.ts'
import { rangeSubtitle } from '../src/components/sales/reports/reportTypes.ts'

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

test('partial clocks preserve the entered boundary across all timed report views', () => {
  for (const view of REPORT_VIEWS.filter((v) => v.supportsTime)) {
    for (const patch of [{ startTime: '' }, { endTime: '' }]) {
      const range = filters(patch)
      assert.deepEqual(reportQueryParams(range, view), dashboardRangeQuery(range), `${view.id} partial-clock parity`)
      assert.ok(rangeSubtitle(range, (_key, fallback) => fallback).endsWith(`${range.startTime || '00:00'}–${range.endTime || '23:59'}`), 'report and print-export labels retain effective endpoint clocks')
    }
    assert.deepEqual(reportQueryParams(filters({ startTime: '', endTime: '' }), view), { startDate: '2026-08-30', endDate: '2026-09-05' })
    assert.deepEqual(reportQueryParams(filters({ startDate: '', endDate: '', startTime: '', endTime: '' }), view), {})
    for (const patch of [{ startTime: '24:00' }, { endTime: '12:60' }, { startTime: 'bad', endTime: '' }, { startDate: '' }, { endDate: '' }]) {
      assert.throws(() => reportQueryParams(filters(patch), view), RangeError, `${view.id} invalid bound must never become full-day`)
    }
  }
})

test('actual Reports hub validation renders an alert without mounting request/export children', () => {
  const source = fs.readFileSync(new URL('../src/components/sales/ReportsHub.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('ReportsHub.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const initializers = new Map<string, ts.Expression>()
  function visit(node: ts.Node) { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) initializers.set(node.name.text, node.initializer); ts.forEachChild(node, visit) }
  visit(ast)
  const guard = (initializers.get('rangeError') as ts.CallExpression).arguments[0].getText(ast)
  const body = initializers.get('body')!.getText(ast)
  const evaluate = (expression: string, env: Record<string, unknown>) => {
    const code = ts.transpileModule(`const result = (${expression});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText
    return new Function('env', `with(env){${code};return result}`)(env)
  }
  const view = getReportView('sales')
  const invalid = filters({ endTime: '25:00' })
  const rangeError = evaluate(guard, { view, filters: invalid, reportQueryParams })()
  assert.match(rangeError, /must be after/)
  assert.equal(invalid.endTime, '25:00', 'validation preserves the entered draft')
  let mounts = 0
  const SalesListReport = () => { mounts++; return React.createElement('div', null, 'valid-report') }
  const env = { React, view, viewProps: {}, rangeError, trh: (_key: string, fallback: string) => fallback, SalesListReport }
  assert.match(renderToStaticMarkup(evaluate(body, env)), /role="alert"/)
  assert.equal(mounts, 0, 'invalid range mounts no fetching or export-capable child')
  assert.match(renderToStaticMarkup(evaluate(body, { ...env, rangeError: '' })), /valid-report/)
  assert.equal(mounts, 1, 'valid selection restores the existing report')
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
