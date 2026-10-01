import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { transformSync } from 'esbuild'
import ts from 'typescript'
import { STATS_PRESETS, statsPresetRange, type StatsPresetKey } from '../src/components/shared/statsStripPresets.ts'

const require = createRequire(import.meta.url)
const read = (file: string) => readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8')
const evaluate = (source: string, scope: Record<string, unknown> = {}) => {
  const module = { exports: {} as any }
  const code = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  new Function('require', 'module', 'exports', ...Object.keys(scope), code)(require, module, module.exports, ...Object.values(scope))
  return module.exports
}
const StatsRangeRow = evaluate(read('shared/StatsRangeRow.tsx').replace(/import DateTimeRangePicker[^\n]+/, 'const DateTimeRangePicker = "test-picker"').replace(/import \{ activeStatsPreset[^\n]+/, 'const { activeStatsPreset, statsPresetRange, STATS_PRESETS } = require("../src/components/shared/statsStripPresets.ts")')).default
const initial = { startDate: '2026-09-18', endDate: '2026-09-19', startTime: '09:30', endTime: '17:15' }

for (const file of [
  'inventory/InventoryMovementsSurface.tsx',
  'review/LegacyDeletedSalesSection.tsx', 'contacts/DeliveryContactReportModal.tsx',
  'shared/ExportRangeDialog.tsx',
]) {
  const source = read(file)
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const hosts: ts.JsxSelfClosingElement[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'StatsRangeRow') hosts.push(node)
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.equal(hosts.length, 1, `${file}: exactly one shared range/preset owner`)
  assert.doesNotMatch(source, /<DateTimeRangePicker/, `${file}: no direct picker left to duplicate presets`)
  for (const showTime of file.includes('ExportRangeDialog') ? [false, true] : [file.includes('DeliveryContact')]) {
    let state: any = { ...initial }
    const scope = {
      StatsRangeRow, t: (key: string) => key, range: { ...initial }, showTime,
      fromDate: initial.startDate, toDate: initial.endDate,
      rangeStart: initial.startDate, rangeEnd: initial.endDate,
      movementStartDate: initial.startDate, movementEndDate: initial.endDate,
      changeFilter: (fn: () => void) => fn(), setRange: (next: unknown) => { state = next },
      setRangeStart: (value: string) => { state.startDate = value },
      setRangeEnd: (value: string) => { state.endDate = value },
      setFromDate: (value: string) => { state.startDate = value },
      setToDate: (value: string) => { state.endDate = value },
      setMovementStartDate: (value: string) => { state.startDate = value },
      setMovementEndDate: (value: string) => { state.endDate = value },
    }
    const element = evaluate(`module.exports = (${hosts[0].getText(ast)})`, scope)
    assert.equal(element.props.showPresets, true, `${file}: explicitly requests external presets`)
    assert.equal(element.props.showTime, showTime, `${file}: preserves time capability`)
    const row = StatsRangeRow(element.props)
    const picker = row.props.children[0].props.children[1]
    assert.equal(picker.props.showQuickRanges, false, `${file}: shared picker explicitly disables internal presets`)
    const rail = row.props.children[1]
    assert.match(rail.props.className, /stats-date-presets.*flex-nowrap.*overflow-x-auto/)
    assert.deepEqual(rail.props.children.map((preset: { key: string }) => preset.key), STATS_PRESETS.map(({ id }) => id), `${file}: one complete shared preset row in the standard order`)
    for (const preset of rail.props.children) {
      preset.props.onClick()
      const expected = statsPresetRange(preset.key as StatsPresetKey)
      assert.equal(state.startDate, expected.startDate)
      assert.equal(state.endDate, expected.endDate)
      if (showTime) {
        assert.equal(state.startTime, expected.startTime)
        assert.equal(state.endTime, expected.endTime)
      }
    }
    const custom = { ...initial, startTime: '10:45' }
    picker.props.onChange(custom, 'custom')
    assert.equal(state.startDate, initial.startDate)
    assert.equal(state.endDate, initial.endDate)
    if (showTime) assert.equal(state.startTime, '10:45', `${file}: time-aware callbacks retain edited times`)
    if (file.includes('ExportRangeDialog') && !showTime) assert.deepEqual(state, { startDate: initial.startDate, endDate: initial.endDate }, 'date-only export payload remains date-only')
    picker.props.onChange({ startDate: '', endDate: '', startTime: '', endTime: '' }, 'all')
    assert.equal(state.startDate, '')
    assert.equal(state.endDate, '')
  }
  console.log(`PASS ${file}: external presets, preserved time capability, custom selection and clear`)
}

// The Audit Log owns a compact time control instead of the eight-preset rail:
// Today / 7 days / 30 days / Custom in one select (owner, 30 Sep 2026). Its
// custom range still goes through the one shared StatsRangeRow, with the
// picker's own quick ranges, and is only mounted while Custom is chosen.
{
  const source = read('utils-settings/AuditLog.tsx')
  assert.equal((source.match(/<StatsRangeRow/g) || []).length, 1, 'AuditLog: exactly one shared range owner')
  assert.doesNotMatch(source, /<DateTimeRangePicker/, 'AuditLog: no direct picker')
  assert.match(source, /view\.preset === 'custom' \? \(\s*<StatsRangeRow[\s\S]*?showPresets=\{false\}/, 'AuditLog: the range picker appears only for Custom, without a second preset rail')
  // Clearing the custom range does not mean "all time" here: the view state
  // falls back to the last 30 days, because an unbounded audit read is not on
  // offer (tests/auditLogView.test.ts pins the fallback).
  assert.match(source, /onRangeChange=\{\(next\) => setView\(\(current\) => setAuditRange\(current, next\.startDate \|\| '', next\.endDate \|\| ''\)\)\}/, 'AuditLog: the picker writes the custom range through setAuditRange')
  console.log('PASS utils-settings/AuditLog.tsx: compact time select owns the presets; custom range uses the shared row')
}
