// The Reports hub's page order and the compact fold-away filter card, from
// the owner's old-POS reference (Sep 5 2026, screenshots #3 / #4): filters
// first, results second, nothing above the filters; once SHOW is pressed the
// filter panel collapses behind a handle and the results take the screen.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(rootPath, rel), 'utf8')
const hub = read('src/components/sales/ReportsHub.tsx')
const overview = read('src/components/sales/reports/OverviewReport.tsx')
const render = hub.slice(hub.lastIndexOf('  return ('))

// Order on the page: controls, then exactly one selected report body.
const at = (needle: string) => {
  const i = render.indexOf(needle)
  assert.ok(i >= 0, `render block contains ${needle}`)
  return i
}
const controls = at('className="reports-mobile-controls"')
const body = at('{body}')
assert.ok(controls < body, 'controls come before the report')
assert.match(hub, /view\.id === 'shift' \? <ShiftReport/, 'Shift is selectable through the same report switch')
assert.doesNotMatch(hub, /CurrentShiftSummary|ShiftHistoryPanel/, 'no shift overview is appended beneath every report')

// Overview's breakdown choices sit at the top of its body, immediately after
// the hub controls. The statement no longer repeats those controls with a
// prose summary before showing the canonical rows.
const overviewRender = overview.slice(overview.lastIndexOf('  return ('))
const tabs = overviewRender.indexOf('className="reports-overview-tabs"')
const frame = overviewRender.indexOf('<ReportFrame')
assert.ok(tabs >= 0 && tabs < frame, 'Overview breakdown tabs precede the statement frame')
assert.doesNotMatch(overviewRender, /summary=\{|summaryNote=/, 'Overview does not render the redundant summary prose')

// Compact tier: Show folds only the date/search card. The one active title,
// Filters and Show remain together in every report frame.
assert.match(hub, /const \[controlsFolded, setControlsFolded\] = useState\(false\)/, 'the card starts open')
assert.match(hub, /if \(compact\) setControlsFolded\(true\)/, 'Show folds the compact date card')
assert.match(hub, /\{compact \? \(controlsFolded \? foldedControls : \(/, 'only the compact tier folds')
const folded = hub.slice(hub.indexOf('const foldedControls'), hub.indexOf('  return (', hub.indexOf('const foldedControls')))
assert.match(folded, /className="reports-mobile-controls"/, 'the folded line keeps the sticky card chrome')
assert.match(folded, /aria-expanded=\{false\}/)
assert.match(folded, /onClick=\{\(\) => setControlsFolded\(false\)\}/, 'the handle unfolds')
assert.match(folded, /rangeSubtitle\(filters, trh\)/, 'and the range, through the shared subtitle helper')
assert.doesNotMatch(folded, /view\.labelKey|\{filtersButton\}/, 'the folded date handle does not duplicate the active title or Filters')
// The fold shrinks the content, never the tap area: 44px like the rest of
// the compact tier (a2 measured 18-20px targets on the first cut, Sep 6 2026).
assert.match(folded, /<button\s+type="button"\s+className="flex min-h-\[44px\] min-w-0 flex-1/, 'the handle keeps a 44px tap height')
assert.match(hub, /import \{[^}]*rangeSubtitle[^}]*\} from '\.\/reports\/reportTypes\.ts'/)

const reportControl = hub.slice(hub.indexOf('const reportControlRow'), hub.indexOf('const viewProps'))
const viewPicker = hub.slice(hub.indexOf('const viewPicker'), hub.indexOf('const searchSlot'))
assert.match(hub, /const views = useMemo\(\(\) => visibleReportViews\(perms\), \[perms\]\)/, 'report views remain derived from effective permissions')
assert.match(hub, /const viewOptions = views\.map\(\(v\) => \(\{ value: v\.id, label: trh\(v\.labelKey, v\.fallback\) \}\)\)/, 'picker options preserve every permission-scoped view and its translated label')
assert.match(viewPicker, /options=\{viewOptions\}/, 'the title picker receives the permission-scoped report options')
assert.match(viewPicker, /onChange=\{\(value\) => \{ if \(isReportViewId\(value\)\) setViewId\(value\) \}\}/, 'every valid report option selects its corresponding report view')
assert.match(reportControl, /\{viewPicker\}[\s\S]*\{filtersButton\}[\s\S]*trh\('show', 'Show'\)/, 'option title, Filters and Show are in one ordered row')
assert.match(hub, /titleControl: reportControlRow/, 'all report types receive that same row')
assert.equal((reportControl.match(/\{viewPicker\}/g) || []).length, 1, 'the report header renders one report-option control')
const frameSource = read('src/components/sales/reports/ReportFrame.tsx')
assert.match(frameSource, /const activeTitle = titleControl \?\? title/)
assert.doesNotMatch(
  frameSource,
  /import InfoHint|infoHint=\{/,
  'the removed report Info trigger does not return beside the selected report option',
)
assert.doesNotMatch(frameSource, /count=\{count\}/, 'result counts stay out of the four-control report header')
assert.match(frameSource, /actions=\{menuAction \? <span className="reports-frame-menu">\{menuAction\}<\/span> : undefined\}/, 'only the overflow menu occupies the header action slot')
assert.match(frameSource, /secondaryActions \? <div className="reports-frame-secondary-actions">/, 'mode chips and Shift History move to the secondary rail')
assert.match(frameSource, /title=\{activeTitle\}/)

// The desktop tier is untouched: sticky ControlRow plus the preset row.
assert.match(hub, /<ControlRow className="reports-desktop-primary" sticky/)
assert.equal((hub.match(/\{presetControls\}/g) || []).length, 2, 'both tiers offer the same presets')

// Both packs carry the handle's label.
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
assert.equal(en.show_filters, 'Show filters')
assert.ok(km.show_filters && km.show_filters.trim(), 'km.json carries show_filters')

console.log('PASS report hub layout order')
