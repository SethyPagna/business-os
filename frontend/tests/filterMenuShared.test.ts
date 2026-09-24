// Lock: FilterMenu's shared "All" convention and localization.
//
// DEFECT 1 (All-row rule): summarizeOptions/SectionOptionList used to
// unconditionally treat a section's FIRST option as the pinned "All" row and
// text summary. A section with no real All option (Returns' Scope, any
// sort/group-by pair, the AND/OR search mode, FilesPage's rows-per-page) is a
// mandatory single-choice list with no "show everything" entry at all, so its
// first option is just its default choice -- rendering it as a dark pinned
// "All" row, and reporting its own active label as the word "All" in the
// collapsed summary, is wrong. Fixed by isAllOptionId, which recognizes only
// the marking convention every section builder in this codebase already uses
// (id 'all', '' or ending '-all'). sectionIsActive (row highlight + the
// panel's initial-open pick) is unchanged by that rule, by owner rule "keep
// existing behaviour": a section is active when it is off its default -- the
// first option, All or not -- so Returns Scope = Supplier still highlights and
// auto-opens, and a no-All section sitting on its default does not.
//
// DEFECT 2 (i18n): "Clear", "Search...", "No matches", "{n} selected" in
// FilterMenu.tsx, the " (Default)" branch suffix in
// AvailabilityFilterOptions.tsx, and English-only month abbreviations in
// periodFilterOptions.ts stayed in English even in Khmer mode.
//
// FilterMenu.tsx and AvailabilityFilterOptions.tsx return JSX, so (matching
// tests/floatingFilterMenus.test.ts's own approach to this exact file) their
// rendering shape is checked as source text. isAllOptionId / summarizeOptions
// / sectionIsActive are plain functions with no JSX in their own bodies, so
// they are extracted and transpiled standalone and exercised with real
// inputs -- the same extract-and-transpile technique
// tests/taxSettingsParity.test.ts uses for a Worker function with no external
// module dependencies.
//
// Run: node tests/filterMenuShared.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { buildPeriodFilterOptions } from '../src/utils/periodFilterOptions.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const filterMenuPath = path.resolve(here, '..', 'src', 'components', 'shared', 'FilterMenu.tsx')
const availabilityPath = path.resolve(here, '..', 'src', 'components', 'shared', 'AvailabilityFilterOptions.tsx')
const periodPath = path.resolve(here, '..', 'src', 'utils', 'periodFilterOptions.ts')
const enPath = path.resolve(here, '..', 'src', 'lang', 'en.json')
const kmPath = path.resolve(here, '..', 'src', 'lang', 'km.json')

const filterMenuSource = fs.readFileSync(filterMenuPath, 'utf8')
const availabilitySource = fs.readFileSync(availabilityPath, 'utf8')
const periodSource = fs.readFileSync(periodPath, 'utf8')
const en = JSON.parse(fs.readFileSync(enPath, 'utf8')) as Record<string, unknown>
const km = JSON.parse(fs.readFileSync(kmPath, 'utf8')) as Record<string, unknown>

function runTest(name: string, test: () => void): void {
  try {
    test()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

function extractFunction(source: string, name: string): string {
  const re = new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`)
  const match = source.match(re)
  assert.ok(match, `${name} not found in FilterMenu.tsx -- source may have changed`)
  return match![0]
}

// isAllOptionId, optionLabelText, summarizeOptions and sectionIsActive have no
// JSX and no imports beyond an erased FilterOption type reference, so they
// transpile and run standalone, exercised with real inputs instead of a
// source-text guess at their behaviour.
type FilterOptionLike = { id: string | number; label?: string; title?: string; active?: boolean }
const combined = [
  extractFunction(filterMenuSource, 'isAllOptionId'),
  extractFunction(filterMenuSource, 'optionLabelText'),
  extractFunction(filterMenuSource, 'summarizeOptions'),
  extractFunction(filterMenuSource, 'sectionIsActive'),
  'export { isAllOptionId, summarizeOptions, sectionIsActive }',
].join('\n')
const { outputText } = ts.transpileModule(combined, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'filter-menu-shared.ts',
})
type ModuleShape = {
  isAllOptionId: (id: string | number) => boolean
  summarizeOptions: (options: FilterOptionLike[], t?: (key: string) => string) => string
  sectionIsActive: (options: FilterOptionLike[]) => boolean
}
const moduleObj: { exports: Partial<ModuleShape> } = { exports: {} }
new Function('exports', outputText)(moduleObj.exports)
const { isAllOptionId, summarizeOptions, sectionIsActive } = moduleObj.exports as ModuleShape
assert.equal(typeof isAllOptionId, 'function', 'isAllOptionId must extract to a callable function')
assert.equal(typeof summarizeOptions, 'function', 'summarizeOptions must extract to a callable function')
assert.equal(typeof sectionIsActive, 'function', 'sectionIsActive must extract to a callable function')

runTest('isAllOptionId recognizes every real All marking convention used by section builders', () => {
  for (const id of ['all', '', 'cat-all', 'gender-all', 'period-all', 'group-all', '-all']) {
    assert.equal(isAllOptionId(id), true, `expected '${id}' to be a real All id`)
  }
})

runTest('isAllOptionId rejects mandatory single-choice ids that only resemble All', () => {
  for (const id of ['date-desc', 'AND', 'OR', 'CUSTOMER_SCOPE', 'sort-newest', 'allx', 'all-time', 12, 24, 48, 0]) {
    assert.equal(isAllOptionId(id), false, `expected '${id}' to NOT be treated as All`)
  }
})

// DEFECT 1, case 1: a section with NO real All option (a mandatory
// single-choice pair, like a sort direction or the AND/OR search mode) -- the
// active option must report its own label, never the word "All". This is the
// case the pre-fix code gets wrong: summarizeOptions unconditionally
// destructured the first entry as the All row, so an active first option
// read as 'All' instead of its own label.
const sortSection: FilterOptionLike[] = [
  { id: 'newest', label: 'Newest first', active: true },
  { id: 'oldest', label: 'Oldest first', active: false },
]
runTest('DEFECT 1 case 1 (RED on old code): a section without a real All reports its active label, not All', () => {
  assert.equal(summarizeOptions(sortSection), 'Newest first')
})
runTest('sectionIsActive: a no-real-All section at its default (first option) is not active', () => {
  assert.equal(sectionIsActive(sortSection), false)
})
// Owner rule: keep existing behaviour -- a no-All section OFF its default is
// active, e.g. Returns Scope = Supplier highlights and auto-opens as before.
const returnsScopeSupplier: FilterOptionLike[] = [
  { id: 'customer', label: 'Customer Returns', active: false },
  { id: 'supplier', label: 'Supplier Returns', active: true },
]
runTest('sectionIsActive: a no-real-All section off its default is active (Returns Scope = Supplier)', () => {
  assert.equal(sectionIsActive(returnsScopeSupplier), true)
  assert.equal(summarizeOptions(returnsScopeSupplier), 'Supplier Returns')
})

// DEFECT 1, case 2: a section WITH a real All option -- every prior summary
// and isActive shape must be unchanged.
const stockAllActive: FilterOptionLike[] = [
  { id: 'all', label: 'All', active: true },
  { id: 'in_stock', label: 'In Stock', active: false },
  { id: 'low', label: 'Low', active: false },
]
const stockOnePicked: FilterOptionLike[] = [
  { id: 'all', label: 'All', active: false },
  { id: 'in_stock', label: 'In Stock', active: true },
  { id: 'low', label: 'Low', active: false },
]
const stockTwoPicked: FilterOptionLike[] = [
  { id: 'all', label: 'All', active: false },
  { id: 'in_stock', label: 'In Stock', active: true },
  { id: 'low', label: 'Low', active: true },
]
runTest('DEFECT 1 case 2: a section with a real All option keeps every prior summary shape', () => {
  assert.equal(summarizeOptions(stockAllActive), 'All')
  assert.equal(summarizeOptions(stockOnePicked), 'In Stock')
  assert.equal(summarizeOptions(stockTwoPicked), '2 selected')
})
runTest('DEFECT 1 case 2: a section with a real All option keeps every prior isActive shape', () => {
  assert.equal(sectionIsActive(stockAllActive), false)
  assert.equal(sectionIsActive(stockOnePicked), true)
  assert.equal(sectionIsActive(stockTwoPicked), true)
})

runTest('summarizeOptions localizes the N-selected summary through the optional t() argument', () => {
  const fakeT = (key: string) => (key === 'filter_selected_count' ? 'ខ្មែរ {count}' : key)
  assert.equal(summarizeOptions(stockTwoPicked, fakeT), 'ខ្មែរ 2')
})

// --- SectionOptionList rendering: JSX, so checked as source text (same
// technique tests/floatingFilterMenus.test.ts already uses for this file).
// Scoped to SectionOptionList's own body -- sectionIsActive legitimately
// reuses the same `[allOption, ...restOptions]` destructure AFTER it has
// already confirmed options[0] is a real All id, so a whole-file search for
// that literal text would false-positive against that correct, gated reuse.
//
// A plain `function NAME(...[\s\S]*?\n}` non-greedy match (as extractFunction
// above uses) stops at the FIRST unindented '}', which for a component whose
// props are destructured with an inline type annotation --
// `function X({ a }: { a: string }) {` -- is the type annotation's OWN
// closing brace, not the function body's. extractBalancedBlock instead finds
// the body's real opening '{' (the one right after the parameter list's
// closing ')') and walks brace depth (skipping quoted/template strings) to
// its true matching close.
function extractBalancedBlock(source: string, startMarker: string): string {
  const startIdx = source.indexOf(startMarker)
  assert.ok(startIdx >= 0, `marker '${startMarker}' not found in FilterMenu.tsx -- source may have changed`)
  const bodyOpen = /\)\s*\{\r?\n/.exec(source.slice(startIdx))
  assert.ok(bodyOpen, `could not find the body opening brace after '${startMarker}'`)
  let i = startIdx + (bodyOpen as RegExpExecArray).index + (bodyOpen as RegExpExecArray)[0].indexOf('{')
  let depth = 0
  for (; i < source.length; i++) {
    const c = source[i]
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      i++
      while (i < source.length && source[i] !== quote) { if (source[i] === '\\') i++; i++ }
      continue
    }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return source.slice(startIdx, i + 1) }
  }
  throw new Error(`unbalanced braces extracting '${startMarker}'`)
}
const sectionOptionListSource = extractBalancedBlock(filterMenuSource, 'export function SectionOptionList(')
runTest('SectionOptionList only pins a REAL All option, not just options[0]', () => {
  assert.doesNotMatch(
    sectionOptionListSource,
    /const \[allOption, \.\.\.restOptions\] = options/,
    'SectionOptionList must not unconditionally destructure the first option as All',
  )
  assert.match(sectionOptionListSource, /const hasRealAllOption = options\.length > 0 && isAllOptionId\(options\[0\]\.id\)/)
})

// --- DEFECT 2: no hardcoded English left in the three files, both packs
// carry every key the fix references. ---
runTest('FilterMenu.tsx no longer hardcodes Clear/Search/No matches/selected-count', () => {
  assert.doesNotMatch(filterMenuSource, /placeholder="Search\.\.\."/)
  assert.doesNotMatch(filterMenuSource, />No matches</)
  assert.doesNotMatch(filterMenuSource, />\s*Clear\s*</)
  assert.doesNotMatch(filterMenuSource, /\$\{activeOptions\.length\} selected/)
  assert.match(filterMenuSource, /useApp\(\)/, 'FilterMenu.tsx must read the app translator to localize its own strings')
})

runTest('AvailabilityFilterOptions.tsx no longer hardcodes the "(Default)" suffix', () => {
  assert.doesNotMatch(availabilitySource, /' \(Default\)'/)
  // default_label ("Default"), not the bare `default` key, which is lowercase
  // in en.json for other callers -- the label must stay "Main (Default)".
  assert.match(availabilitySource, /T\('default_label', 'Default'\)/)
  assert.equal(en.default_label, 'Default', 'en default_label is capitalized')
})

runTest('periodFilterOptions.ts offers Khmer month names, not only English', () => {
  assert.doesNotMatch(periodSource, /\bDEFAULT_MONTH_OPTIONS\b/, 'the single English-only table must be gone, not just renamed and kept as the default')
  assert.match(periodSource, /KHMER_MONTH_ABBREVIATIONS/)
  // The language is a parameter from the caller's React state, not the
  // <html lang> attribute (written by an effect one commit late).
  assert.doesNotMatch(periodSource, /documentElement/)
})

runTest('buildPeriodFilterOptions switches month names with the language argument', () => {
  const build = (language: string) => buildPeriodFilterOptions({
    yearFilter: '2026', setYearFilter: () => {}, monthFilter: 'all', setMonthFilter: () => {},
    availableYears: [2026], allTimeLabel: 'All time', language,
  }).map((option) => String(option.label))
  assert.ok(build('km').includes('មករា'), 'km gets Khmer month names')
  assert.ok(!build('km').includes('Jan'))
  assert.ok(build('en').includes('Jan'), 'en gets English month names')
  for (const caller of ['utils-settings/AuditLog.tsx', 'contacts/CustomersTab.tsx', 'contacts/SuppliersTab.tsx', 'contacts/DeliveryTab.tsx']) {
    const callerSource = fs.readFileSync(path.resolve(here, '..', 'src', 'components', caller), 'utf8')
    assert.match(callerSource, /buildPeriodFilterOptions\(\{[\s\S]{0,200}?\blanguage,/, `${caller} passes its language`)
  }
})

const usedKeys = ['search', 'noMatches', 'clear', 'all', 'default_label', 'filter_selected_count']
runTest('both language packs carry every key this fix reuses or adds, with real (non-English) Khmer text', () => {
  for (const key of usedKeys) {
    assert.ok(Object.prototype.hasOwnProperty.call(en, key), `en.json missing '${key}'`)
    assert.ok(Object.prototype.hasOwnProperty.call(km, key), `km.json missing '${key}'`)
    const enValue = String(en[key])
    const kmValue = String(km[key])
    assert.notEqual(kmValue, enValue, `km.json['${key}'] is identical to the English string -- looks like an English placeholder`)
    assert.ok(/[ក-៿]/.test(kmValue), `km.json['${key}'] ('${kmValue}') has no Khmer script -- looks like an English placeholder`)
  }
})

console.log('Shared FilterMenu contracts (All-row rule + localization) passed')
