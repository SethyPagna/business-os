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
const render = hub.slice(hub.lastIndexOf('  return ('))

// Order on the page: controls, then the report body, then the two shift
// blocks -- which still exist, unchanged (shiftManagement pins their props).
const at = (needle: string) => {
  const i = render.indexOf(needle)
  assert.ok(i >= 0, `render block contains ${needle}`)
  return i
}
const controls = at('className="reports-mobile-controls"')
const body = at('{body}')
const shift = at('<CurrentShiftSummary showHistory={false} />')
const history = at('<ShiftHistoryPanel compact limit={50} />')
assert.ok(controls < body, 'controls come before the report')
assert.ok(body < shift && shift < history, 'the shift summary and shift history sit below the report')
assert.equal((hub.match(/<CurrentShiftSummary showHistory=\{false\} \/>/g) || []).length, 1, 'one shift summary mount')

// Compact tier: Show folds the card; the folded line is a handle that
// unfolds it, names the view and the range, and keeps the Filters button
// (the options fold anchors to it).
assert.match(hub, /const \[controlsFolded, setControlsFolded\] = useState\(false\)/, 'the card starts open')
assert.match(hub, /setSearch\(searchText\.trim\(\)\); setOptionsOpen\(false\); setControlsFolded\(true\)/, 'Show folds the card')
assert.match(hub, /\{compact \? \(controlsFolded \? foldedControls : \(/, 'only the compact tier folds')
const folded = hub.slice(hub.indexOf('const foldedControls'), hub.indexOf('  return (', hub.indexOf('const foldedControls')))
assert.match(folded, /className="reports-mobile-controls"/, 'the folded line keeps the sticky card chrome')
assert.match(folded, /aria-expanded=\{false\}/)
assert.match(folded, /onClick=\{\(\) => setControlsFolded\(false\)\}/, 'the handle unfolds')
assert.match(folded, /trh\(view\.labelKey, view\.fallback\)/, 'the folded line names the view')
assert.match(folded, /rangeSubtitle\(filters, trh\)/, 'and the range, through the shared subtitle helper')
assert.match(folded, /\{filtersButton\}/, 'the Filters button stays mounted while folded')
// The fold shrinks the content, never the tap area: 44px like the rest of
// the compact tier (a2 measured 18-20px targets on the first cut, Sep 6 2026).
assert.match(folded, /<button\s+type="button"\s+className="flex min-h-\[44px\] min-w-0 flex-1/, 'the handle keeps a 44px tap height')
assert.match(folded, /<div className="flex h-11 w-11 shrink-0 items-center justify-center \[&_button\]:h-11 \[&_button\]:w-11">\{filtersButton\}<\/div>/, 'the folded Filters button is a 44px square')
assert.match(hub, /import \{[^}]*rangeSubtitle[^}]*\} from '\.\/reports\/reportTypes\.ts'/)

// The desktop tier is untouched: sticky ControlRow plus the preset row.
assert.match(hub, /<ControlRow className="reports-desktop-primary" sticky/)
assert.equal((hub.match(/\{presetControls\}/g) || []).length, 2, 'both tiers offer the same presets')

// Both packs carry the handle's label.
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>
assert.equal(en.show_filters, 'Show filters')
assert.ok(km.show_filters && km.show_filters.trim(), 'km.json carries show_filters')

console.log('PASS report hub layout order')
