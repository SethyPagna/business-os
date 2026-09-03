// Source-shape lock: every date a member of staff TYPES goes through the one
// shared field, and no surface quietly falls back to a native picker.
//
// User direction (Sep 3): "for date in date range, in date for batch, edit
// stock, add stock, remove stock, set stock, the dates in all date related
// if enter must be automatic move so if I write 9032026, it will auto
// 09/03/2026". A rule that has to hold on ~15 surfaces is exactly the kind
// that decays one modal at a time, so it is pinned here rather than trusted
// to review.
//
// Run: node tests/dateEntrySurfaces.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, '..', 'src')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error: unknown) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (relative: string): string => fs.readFileSync(path.join(SRC, relative), 'utf8')

// Every surface that renders a date the operator types, and what it is.
const SURFACES: Array<{ file: string; what: string }> = [
  { file: 'components/shared/DateTimeRangePicker.tsx', what: 'the Start -> End range row on every data page (Sales, Returns, Inventory, Branches, Expenses, Contacts, Dashboard, Audit log, Stock changes, reports)' },
  { file: 'components/inventory/ReceiveBatchModal.tsx', what: 'batch received date, expiry, credit due' },
  { file: 'components/inventory/ManageBatchesModal.tsx', what: 'batch date (the lot code) and expiry' },
  { file: 'components/inventory/FastStockInModal.tsx', what: 'fast stock-in received date, expiry, credit due' },
  { file: 'components/inventory/InventoryStockModals.tsx', what: 'the add / remove / set stock dialog received date' },
  { file: 'components/products/forms/BranchStockAdjuster.tsx', what: 'per-branch add-stock received date' },
  { file: 'components/products/forms/BulkAddStockModal.tsx', what: 'bulk add-stock received date' },
  { file: 'components/products/forms/ProductForm.tsx', what: 'product expiry date' },
  { file: 'components/products/StockInSessionsSection.tsx', what: 'stock-in session received date and credit due date' },
  { file: 'components/products/CreatedDateFilterOptions.tsx', what: 'the Products "Created" from/to range' },
  { file: 'components/fees/FeeForm.tsx', what: 'the Expenses record date' },
  { file: 'components/sales/ExportModal.tsx', what: 'the sales export custom range' },
  { file: 'components/promotions/PromotionsPage.tsx', what: 'promotion and discount start/end' },
  { file: 'components/catalog/ManagePromotionsModal.tsx', what: 'storefront promo show-from / show-until' },
]

for (const surface of SURFACES) {
  runTest(`${surface.file} enters dates through DateEntryInput (${surface.what})`, () => {
    const source = read(surface.file)
    assert.ok(
      /import\s+DateEntryInput\s+from\s+'[^']*DateEntryInput(\.tsx)?'/.test(source),
      `${surface.file} must import the shared DateEntryInput`,
    )
    assert.ok(source.includes('<DateEntryInput'), `${surface.file} must render <DateEntryInput`)
  })
}

// The allow-list is EMPTY on purpose. Every date field in the admin app is
// typed by staff on a numeric keypad, and <input type="date"> is exactly what
// makes '9032026' impossible: it hands entry to the browser's own segmented
// widget, which accepts neither a bare digit run nor a paste of mm/dd/yyyy,
// and it renders in the DEVICE locale (dd/mm on a phone set to en-GB) against
// the app's settled mm/dd/yyyy convention. There is no surface where the
// native control buys something the shared field does not. If one ever turns
// up, add it here WITH the reason -- do not weaken the sweep.
const NATIVE_DATE_ALLOW_LIST: string[] = []

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full, out); continue }
    if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

runTest('no source file renders a native <input type="date">', () => {
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    const relative = path.relative(SRC, file).split(path.sep).join('/')
    if (NATIVE_DATE_ALLOW_LIST.includes(relative)) continue
    const source = fs.readFileSync(file, 'utf8')
    source.split('\n').forEach((line, index) => {
      // Comments explaining why the native control was dropped are fine.
      if (/^\s*(\/\/|\*)/.test(line)) return
      if (/type=(["'])date\1/.test(line)) offenders.push(`${relative}:${index + 1}`)
    })
  }
  assert.deepEqual(offenders, [], `native date inputs found -- route them through DateEntryInput:\n  ${offenders.join('\n  ')}`)
})

runTest('no surface keeps a free-typed date field outside the shared component', () => {
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    const relative = path.relative(SRC, file).split(path.sep).join('/')
    if (relative === 'components/shared/DateEntryInput.tsx' || relative === 'utils/dateEntry.ts') continue
    const source = fs.readFileSync(file, 'utf8')
    source.split('\n').forEach((line, index) => {
      if (/^\s*(\/\/|\*)/.test(line)) return
      // A plain <input> carrying an mm/dd/yyyy placeholder is a date field
      // that never learned to normalise -- exactly what FastStockInModal had.
      if (/<input\b/.test(line) && /mm\/dd\/yyyy/i.test(line)) offenders.push(`${relative}:${index + 1}`)
    })
  }
  assert.deepEqual(offenders, [], `free-typed date fields found:\n  ${offenders.join('\n  ')}`)
})

runTest('DateEntryInput carries the entry contract the direction asked for', () => {
  const source = read('components/shared/DateEntryInput.tsx')
  assert.ok(source.includes('inputMode="numeric"'), 'the field must open a numeric keypad')
  assert.ok(source.includes("placeholder = 'mm/dd/yyyy'"), 'the placeholder must be the literal display format')
  assert.ok(source.includes('applyDateEntryMask'), 'the as-you-type mask must come from the shared helper')
  assert.ok(source.includes('normalizeDateEntry'), 'commit must go through the shared normalizer')
  assert.ok(source.includes('setSelectionRange'), 'the caret must be restored after masking')
  assert.ok(/event\.key !== 'Enter'/.test(source), 'Enter must be handled explicitly')
  assert.ok(/if \(!settled\) return\s*\r?\n\s*event\.preventDefault\(\)/.test(source), 'Enter must preventDefault ONLY after a successful normalise')
  assert.ok(source.includes('moveToNextField'), 'a committed Enter must move focus to the next field')
  assert.ok(source.includes('InfoHint'), 'an unreadable entry must raise an InfoHint')
  assert.ok(!/onChange\(''\)[^\n]*invalid/.test(source), 'an unreadable entry must never clear the field')
})

runTest('the shared field is 13px on desktop and >=16px under 768px', () => {
  const css = fs.readFileSync(path.join(SRC, 'styles', 'main.css'), 'utf8')
  const base = /input\.date-entry-input\s*\{[^}]*font-size:[^;]*16px/.exec(css)
  assert.ok(base, 'input.date-entry-input must floor at 16px (the iOS focus-zoom floor)')
  const desktop = /@media \(min-width: 768px\)\s*\{\s*input\.date-entry-input\s*\{[^}]*font-size:[^;]*13px/.exec(css)
  assert.ok(desktop, 'input.date-entry-input must drop to 13px at >=768px')
  // The regression this pins: a BARE '.date-entry-input { font-size }' rule
  // has the same specificity as this file's own '.text-sm { ... !important }'
  // text-scale rules and loses to them on source order, so every adopted
  // field that passes text-sm rendered at 14px on a phone -- under the very
  // floor the rule exists to guarantee (measured live at 375px, Sep 3). The
  // element-qualified selector is what makes that floor real.
  assert.ok(
    !/(^|[^a-zA-Z.])\.date-entry-input\s*\{[^}]*font-size/m.test(css),
    'the font-size rule must stay element-qualified (input.date-entry-input), or .text-sm !important wins',
  )
  assert.ok(
    /\.text-sm\s*\{[^}]*font-size:[^;]*!important/.test(css),
    'the .text-sm !important scale rule this has to outrank must still exist',
  )
})

runTest('the range picker still scopes list and stats through the same onChange', () => {
  const source = read('components/shared/DateTimeRangePicker.tsx')
  // Only the ENTRY changed. The range contract -- one apply() that keeps
  // start <= end and calls the caller's onChange with the whole range -- is
  // what every page uses to scope its list AND its stats together.
  assert.ok(/const apply = \(patch: Partial<DateTimeRange>\) => \{/.test(source), 'apply(patch) must survive')
  assert.ok(source.includes('onChange(next)'), 'apply must still hand the whole range back to the caller')
  assert.ok(/next\.endDate < next\.startDate/.test(source), 'the start<=end swap must survive')
  assert.ok(source.includes('commitManual'), 'the typed endpoints must still commit through commitManual')
  assert.ok(source.includes('<DateEntryInput'), 'the endpoint boxes must use the shared field')
  assert.ok(!source.includes('function parseManualDate'), 'the old local parser must be gone, not left as a second source of truth')
})

runTest('the normalizer and the field are both reachable from one place', () => {
  const helper = read('utils/dateEntry.ts')
  for (const exported of ['normalizeDateEntry', 'applyDateEntryMask', 'isoToDisplayDate']) {
    assert.ok(helper.includes(`export function ${exported}`), `dateEntry.ts must export ${exported}`)
  }
  // Nothing may re-implement the parse locally.
  const offenders: string[] = []
  for (const file of walk(SRC)) {
    const relative = path.relative(SRC, file).split(path.sep).join('/')
    if (relative === 'utils/dateEntry.ts' || relative === 'utils/batchCode.ts') continue
    const source = fs.readFileSync(file, 'utf8')
    if (/function parseManualDate\b/.test(source)) offenders.push(relative)
  }
  assert.deepEqual(offenders, [], `a second hand-rolled date parser exists in:\n  ${offenders.join('\n  ')}`)
})

runTest('both language packs carry every date-entry string', () => {
  const flatten = (input: Record<string, unknown>, target: Record<string, string> = {}): Record<string, string> => {
    for (const [key, value] of Object.entries(input)) {
      if (value == null) continue
      if (typeof value === 'object' && !Array.isArray(value)) flatten(value as Record<string, unknown>, target)
      else target[key] = String(value)
    }
    return target
  }
  const en = flatten(JSON.parse(fs.readFileSync(path.join(SRC, 'lang', 'en.json'), 'utf8')))
  const km = flatten(JSON.parse(fs.readFileSync(path.join(SRC, 'lang', 'km.json'), 'utf8')))
  for (const key of ['date_entry_invalid', 'date_entry_help', 'date_entry_hint_label', 'date_entry_ambiguous']) {
    assert.ok(en[key], `en.json must define ${key}`)
    assert.ok(km[key], `km.json must define ${key}`)
    assert.ok(/[ក-៿]/.test(km[key]), `km.json's ${key} must actually be Khmer, not the English string copied over`)
  }
})

if (failed > 0) {
  process.exitCode = 1
} else {
  console.log(`PASS dateEntrySurfaces: ${SURFACES.length} surfaces type dates through one field, 0 native pickers left`)
}
