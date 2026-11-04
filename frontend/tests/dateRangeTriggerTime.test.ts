import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { transformSync } from 'esbuild'
import ts from 'typescript'

// TIME-1 (owner, 4 Nov 2026): "i still see dashboard and other not showing
// time only showing date." Pages that filter by hour (showTime) printed only
// dates on the closed range button, so the hours they were covering were
// invisible. Pinned from three sides, none of which can pass on the old code:
//
//   1. the real DateTimeRangePicker is rendered closed and its trigger text is
//      read -- with showTime both times are on the button, without it none;
//   2. every JSX use of showTime in the app lands on a component that forwards
//      it to that picker (a caller cannot pass showTime and still get dates);
//   3. blank sides read as the day's edges and an empty range as the literal
//      format, in both date and time.
//
// The browser half (one line, nothing clipped, every host and width, EN/KM)
// lives in dateRangeTriggerTimeBrowser.test.ts.

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = resolve(here, '../src')
const nodeRequire = createRequire(import.meta.url)
const React = nodeRequire('react')
const renderToStaticMarkup = nodeRequire('react-dom/server').renderToStaticMarkup as (node: unknown) => string

let failed = 0
function runTest(name: string, fn: () => void): void {
  try { fn(); console.log(`PASS ${name}`) } catch (error) { failed += 1; console.error(`FAIL ${name}`); console.error(error) }
}

type Range = { startDate: string; endDate: string; startTime: string; endTime: string }
const componentDir = join(srcRoot, 'components/shared')

function loadPicker(): (props: Record<string, unknown>) => unknown {
  const source = readFileSync(join(componentDir, 'DateTimeRangePicker.tsx'), 'utf8')
  const code = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code
  const mod = { exports: {} as { default?: (props: Record<string, unknown>) => unknown } }
  const stub = (name: string) => ({ __esModule: true, default: () => React.createElement('i', { 'data-stub': name }), RailChip: () => null, TimeEntryInput: () => null })
  new Function('require', 'module', 'exports', code)((id: string) => {
    if (id.startsWith('lucide-react')) return stub('icon')
    if (/AppSelect|ChipRail|DateEntryInput/.test(id)) return stub(id)
    if (/useDialogKeyboard/.test(id)) return { useDialogKeyboard: () => {} }
    if (id.startsWith('.')) return nodeRequire(resolve(componentDir, id))
    return nodeRequire(id)
  }, mod, mod.exports)
  return mod.exports.default!
}

const Picker = loadPicker()
const noop = () => {}
const t = (key: string) => key

/** The text of each endpoint as the closed trigger prints it. */
function triggerEndpoints(value: Range, extra: Record<string, unknown> = {}): string[] {
  const html = renderToStaticMarkup(React.createElement(Picker, { value, onChange: noop, t, ...extra }))
  const track = /data-date-range-trigger-values[^>]*>([\s\S]*?)<\/span><\/button>/.exec(html)
  assert.ok(track, 'the closed trigger renders its value track')
  return [...track[1].matchAll(/<span class="inline-flex[^>]*>([\s\S]*?)<\/span><\/span>/g)]
    .map((m) => m[1].replace(/<span[^>]*>/g, '|').replace(/<\/span>/g, '').replace(/^\|/, ''))
}

const today: Range = { startDate: '2026-11-04', endDate: '2026-11-04', startTime: '00:00', endTime: '23:59' }

runTest('showTime: the Today range prints both full times next to its dates', () => {
  assert.deepEqual(triggerEndpoints(today, { showTime: true }), ['04/11/2026|00:00', '04/11/2026|23:59'])
})

runTest('without showTime the trigger stays date-only, even when the range carries times', () => {
  assert.deepEqual(triggerEndpoints(today, { showTime: false }), ['04/11/2026', '04/11/2026'])
})

runTest('showTime is the picker default, so a timed surface cannot lose its times by omission', () => {
  const html = renderToStaticMarkup(React.createElement(Picker, { value: today, onChange: noop, t }))
  assert.match(html, /00:00/)
  assert.match(html, /23:59/)
})

runTest('a custom time range prints the times that were typed, not the day edges', () => {
  const custom: Range = { startDate: '2026-10-01', endDate: '2026-10-19', startTime: '09:30', endTime: '17:45' }
  assert.deepEqual(triggerEndpoints(custom, { showTime: true }), ['01/10/2026|09:30', '19/10/2026|17:45'])
  assert.deepEqual(triggerEndpoints({ ...custom, endTime: '24:00' }, { showTime: true }), ['01/10/2026|09:30', '19/10/2026|24:00'])
  assert.deepEqual(triggerEndpoints({ ...custom, startTime: '9:05' }, { showTime: true })[0], '01/10/2026|09:05')
})

runTest('picked dates with blank times read as the day edges (00:00 start, 23:59 end)', () => {
  const blankTimes: Range = { startDate: '2026-10-01', endDate: '2026-10-19', startTime: '', endTime: '' }
  assert.deepEqual(triggerEndpoints(blankTimes, { showTime: true }), ['01/10/2026|00:00', '19/10/2026|23:59'])
})

runTest('an empty range prints the literal format for date and time, and nothing is invented', () => {
  const empty: Range = { startDate: '', endDate: '', startTime: '', endTime: '' }
  assert.deepEqual(triggerEndpoints(empty, { showTime: true }), ['DD/MM/YYYY|HH:MM', 'DD/MM/YYYY|HH:MM'])
  assert.deepEqual(triggerEndpoints(empty, { showTime: false }), ['DD/MM/YYYY', 'DD/MM/YYYY'])
})

runTest('an unreadable stored time falls back to the day edge instead of printing junk', () => {
  const junk: Range = { startDate: '2026-10-01', endDate: '2026-10-19', startTime: 'soon', endTime: '25' }
  assert.deepEqual(triggerEndpoints(junk, { showTime: true }), ['01/10/2026|00:00', '19/10/2026|23:59'])
})

// --- every caller that filters by time reaches the picker's showTime -----------

function listTsx(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    return statSync(full).isDirectory() ? listTsx(full) : /\.tsx$/.test(name) ? [full] : []
  })
}

function showTimeUses(): Array<{ file: string; tag: string; forwarded: boolean }> {
  const uses: Array<{ file: string; tag: string; forwarded: boolean }> = []
  for (const file of listTsx(srcRoot)) {
    const source = readFileSync(file, 'utf8')
    if (!source.includes('showTime')) continue
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) {
        const attribute = node.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(tree) === 'showTime')
        if (attribute) {
          // `showTime` alone and `showTime={true}` both turn it on; a literal false does not.
          const off = attribute.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression?.kind === ts.SyntaxKind.FalseKeyword
          if (!off) uses.push({ file: file.slice(srcRoot.length + 1).replace(/\\/g, '/'), tag: node.tagName.getText(tree), forwarded: false })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(tree)
  }
  return uses
}

/** Does `file` hand its own `showTime` on as `<tag showTime={showTime}>`? */
function forwardsShowTime(file: string, tag: string): boolean {
  const source = readFileSync(join(srcRoot, file), 'utf8')
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found = false
  const visit = (node: ts.Node): void => {
    if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && node.tagName.getText(tree) === tag) {
      found ||= node.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText(tree) === 'showTime'
        && !!a.initializer && ts.isJsxExpression(a.initializer) && a.initializer.expression?.getText(tree) === 'showTime')
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}

runTest('every showTime in the app lands on a component that forwards it to the picker', () => {
  const uses = showTimeUses()
  assert.ok(uses.length >= 15, `the scan reached the callers (${uses.length})`)
  const forwarders: Record<string, string> = {
    StatsStrip: 'components/shared/StatsStrip.tsx',
    StatsRangeRow: 'components/shared/StatsRangeRow.tsx',
    DateTimeRangePicker: 'components/shared/DateTimeRangePicker.tsx',
    ExportRangeDialog: 'components/shared/ExportRangeDialog.tsx',
  }
  const strangers = uses.filter((use) => !(use.tag in forwarders) && !/DateTimeRangePicker\.tsx$/.test(use.file))
  assert.deepEqual(strangers, [], 'a showTime on a component outside the picker chain would print dates only; route it through StatsRangeRow or the picker')
  // Each hop of the chain hands the flag on, ending at the picker's own trigger.
  assert.ok(forwardsShowTime('components/shared/StatsStrip.tsx', 'StatsRangeRow'), 'StatsStrip -> StatsRangeRow')
  assert.ok(forwardsShowTime('components/shared/StatsRangeRow.tsx', 'DateTimeRangePicker'), 'StatsRangeRow -> DateTimeRangePicker')
  assert.ok(forwardsShowTime('components/shared/ExportRangeDialog.tsx', 'StatsRangeRow'), 'ExportRangeDialog -> StatsRangeRow')
  const picker = readFileSync(join(srcRoot, 'components/shared/DateTimeRangePicker.tsx'), 'utf8')
  assert.match(picker, /rangeTriggerEndpoints\(value, showTime\)/, 'the picker prints its trigger from showTime')
  // The pages the owner named, by file.
  const pages = new Set(uses.map((use) => use.file))
  for (const page of [
    'components/dashboard/Dashboard.tsx', 'components/sales/Sales.tsx', 'components/returns/Returns.tsx', 'components/fees/FeesPage.tsx',
    'components/inventory/Inventory.tsx', 'components/inventory/InventoryMovementsSurface.tsx', 'components/products/StockChangeSection.tsx',
    'components/utils-settings/AuditLog.tsx', 'components/contacts/ApInvoicesSection.tsx', 'components/contacts/ArInvoicesSection.tsx',
    'components/branches/Branches.tsx', 'components/contacts/CustomerPurchasesReportModal.tsx', 'components/contacts/DeliveryContactReportModal.tsx',
    'components/sales/ReportsHub.tsx',
  ]) assert.ok(pages.has(page), `${page} passes showTime`)
})

runTest('the trigger text comes from one pure helper, so the date-only branch cannot come back inline', () => {
  const picker = readFileSync(join(componentDir, 'DateTimeRangePicker.tsx'), 'utf8')
  assert.doesNotMatch(picker, /fmtDateOnly\(value\.(?:start|end)Date\)/, 'the picker no longer formats dates for the trigger by itself')
  const helper = readFileSync(join(componentDir, 'dateRangeTriggerText.ts'), 'utf8')
  assert.match(helper, /fmtDateOnly/, 'dates still go through the shared dd/mm/yyyy formatter')
  assert.doesNotMatch(helper, /toLocale|new Date|Intl\./, 'wall-clock range values are printed as typed, never re-zoned')
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
}
