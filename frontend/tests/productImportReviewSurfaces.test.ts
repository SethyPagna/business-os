// The product-import REVIEW surfaces, held to the same contract their
// contact-import siblings already meet.
//
// Two defects this pins, both found by the import-review audit against
// 6e3abfea:
//
//  1. ProductImportConflictsModal.tsx had no i18n hook at ALL -- title,
//     intro, search placeholder, the two per-row decision buttons, the
//     empty state and the footer were English string literals baked into
//     the JSX, while the lazy-loaded sibling it was copied from
//     (contacts/ContactImportConflictsModal.tsx) routes every equivalent
//     string through tr('contacts_import_conflicts_*'). Khmer mode showed
//     an English conflict-resolution screen -- and verify:i18n cannot see
//     it, because a string that never calls t() references no key to be
//     missing. Only a source-level check like this one can.
//
//  2. BulkImportModal.tsx's done screen ended in a full-width `btn-primary`
//     Close wired to onClose, duplicating the shared Modal's own header X.
//     One close affordance per modal is the project rule.
//
// Source-level (same pattern as actionStability.test.ts /
// importModeDetectionWiring.test.ts): exercising these components' real
// React state would need a DOM harness this project's test scripts do not
// have, but every property below is decidable from the source plus the two
// language packs.
//
// Run: node tests/productImportReviewSurfaces.test.ts
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.join(here, '..')

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const read = (rel: string): string => fs.readFileSync(path.join(frontend, 'src', rel), 'utf8')

function flatten(input: unknown, target: Record<string, string> = {}): Record<string, string> {
  if (!input || typeof input !== 'object') return target
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value == null || Array.isArray(value)) continue
    if (typeof value === 'object') { flatten(value, target); continue }
    target[key] = String(value)
  }
  return target
}
const readPack = (name: string): Record<string, string> =>
  flatten(JSON.parse(fs.readFileSync(path.join(frontend, 'src', 'lang', name), 'utf8')))

const en = readPack('en.json')
const km = readPack('km.json')

const conflicts = read('components/products/import/ProductImportConflictsModal.tsx')
const contacts = read('components/contacts/ContactImportConflictsModal.tsx')
const tracker = read('components/shared/BackgroundImportTracker.tsx')

// --- 1. the modal has an i18n hook at all --------------------------------

runTest('ProductImportConflictsModal accepts an optional t and defines the sibling tr() helper', () => {
  assert.match(conflicts, /\bt\?: TranslateFn\b/, 'the modal must accept the app translator as an optional prop')
  assert.match(
    conflicts,
    /const tr = \(key: string, fallbackEn: string\): string => \{/,
    'mirror ContactImportConflictsModal\'s tr(key, fallbackEn) helper, not a second idiom',
  )
  // The sibling's helper is the reference implementation -- same shape here.
  assert.match(contacts, /const tr = \(key: string, fallbackEn: string\): string => \{/)
})

runTest('BackgroundImportTracker hands the product conflicts modal the same t it hands the contacts one', () => {
  const start = tracker.indexOf('<ProductImportConflictsModal')
  assert.ok(start >= 0, 'the tracker renders ProductImportConflictsModal')
  const block = tracker.slice(start, tracker.indexOf('/>', start))
  assert.match(block, /\bt=\{t\}/, 'without t={t} the tr() helper can only ever return its English fallback')
})

// --- 2. every operator-visible string routes through a key ---------------

// key -> the exact English the audit found hardcoded at 6e3abfea.
const REQUIRED_KEYS: Array<[key: string, english: string]> = [
  ['products_import_conflicts_title', 'Resolve product import conflicts'],
  ['products_import_conflicts_intro', 'Choose what happens for every barcode, SKU, or negative-stock warning.'],
  ['products_import_conflicts_intro_apply', 'keeps the server preview (a colliding identifier stays a separate product; negative stock becomes 0).'],
  ['products_import_conflicts_intro_skip', 'makes no change for that row.'],
  ['products_import_conflicts_remaining', '{count} unresolved of {total} flagged rows'],
  ['products_import_conflicts_search', 'Search product, barcode, or SKU'],
  ['products_import_conflicts_row', 'Row {row}: {name}'],
  ['products_import_conflicts_unnamed', 'Unnamed product'],
  ['products_import_conflicts_review_required', 'Review required'],
  ['products_import_conflicts_apply', 'Use safe result'],
  ['products_import_conflicts_skip', 'Skip row'],
  ['products_import_conflicts_no_matches', 'No matching unresolved or reviewed product conflicts.'],
  ['products_import_conflicts_done', 'Done reviewing'],
  ['products_import_conflicts_load_failed', 'Could not load product conflicts.'],
  ['products_import_conflicts_save_failed', 'Could not save this decision.'],
]

runTest('every string the audit found hardcoded now goes through tr() with a products_import_conflicts_* key', () => {
  for (const [key] of REQUIRED_KEYS) {
    assert.match(conflicts, new RegExp(`tr\\(\\s*'${key}'`), `${key} is never looked up`)
  }
})

runTest('both packs carry every products_import_conflicts_* key, really translated', () => {
  for (const [key, english] of REQUIRED_KEYS) {
    assert.equal(en[key], english, `en.json ${key} must be the string the screen actually shows`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.notEqual(km[key], en[key], `km.json ${key} is still the English string`)
    // Khmer script, not a romanised placeholder.
    assert.match(km[key], /[ក-៿]/, `km.json ${key} carries no Khmer script`)
  }
})

runTest('the barcode-scanner button label is looked up too, not a hardcoded ternary', () => {
  assert.doesNotMatch(
    conflicts,
    /key === 'scan_barcode' \? 'Scan barcode' : key/,
    "the scanner's label must resolve through tr(), not a literal English ternary",
  )
  assert.match(conflicts, /ScanSearchButton[\s\S]{0,200}t=\{scannerText\}/)
  assert.match(conflicts, /scannerText[\s\S]{0,120}tr\(/, 'scannerText must delegate to tr()')
})

runTest('no English literal is left in the conflicts modal JSX', () => {
  const leftovers: Array<[label: string, pattern: RegExp]> = [
    ['modal title', /title="Resolve product import conflicts"/],
    ['search placeholder', /placeholder="Search product, barcode, or SKU"/],
    ['done footer', />Done reviewing</],
    ['empty state', />No matching unresolved or reviewed product conflicts\.</],
    ['row heading', />Row \{row\.rowNumber\}: /],
    ['unnamed fallback', /name \|\| 'Unnamed product'/],
    ['review-required fallback', /\|\| 'Review required'/],
    ['load failure', /: 'Could not load product conflicts\.'/],
    ['save failure', /: 'Could not save this decision\.'/],
  ]
  for (const [label, pattern] of leftovers) {
    assert.doesNotMatch(conflicts, pattern, `${label} is still a bare English literal`)
  }
  // The decision buttons: their text must not sit directly in the JSX.
  assert.doesNotMatch(conflicts, /\/>Use safe result</)
  assert.doesNotMatch(conflicts, />Skip row</)
})

runTest('the pagination row is labelled through the pack, like the contacts sibling', () => {
  assert.doesNotMatch(conflicts, /label="records"/, 'a literal "records" never translates')
  assert.match(conflicts, /label=\{tr\('records', 'records'\)\}/)
  assert.match(contacts, /label=\{tr\('records', 'records'\)\}/, 'sibling reference')
})

// --- 3. one close affordance on the import result screen -----------------

// The done screen (step 3) ended in `<button className="btn-primary w-full"
// onClick={onClose}>Close</button>`: a second close competing with the
// shared Modal's header X, and -- being full width and primary -- the
// loudest control on a phone, outranking "Wire images to these rows" and
// "Download failed rows", which are the only actions on that screen that
// still do something.
const bulk = read('components/products/import/BulkImportModal.tsx')

function doneScreenOf(src: string): string {
  const start = src.indexOf('{step === 3 && result ? (')
  assert.ok(start >= 0, 'the result screen exists')
  const end = src.indexOf('<FilePickerModal', start)
  assert.ok(end > start, 'the result screen ends before the file picker')
  return src.slice(start, end)
}

runTest('the import result screen has no second Close of its own -- the header X is the one affordance', () => {
  const done = doneScreenOf(bulk)
  assert.doesNotMatch(done, /onClick=\{onClose\}/, 'a terminal Close duplicates the shared Modal header X')
  assert.doesNotMatch(done, /btn-primary w-full/, 'and it outranked the actions the operator may still need')
  // The affordance that must still be there: the shared Modal owns it.
  assert.match(bulk, /<Modal title=\{mode === 'products' \?[\s\S]{0,160}onClose=\{onClose\}/)
})

runTest('removing it left the result screen\'s real actions untouched', () => {
  const done = doneScreenOf(bulk)
  assert.match(done, /T\('wire_import_images_action', 'Wire images to these rows'\)/)
  assert.match(done, /T\('download_failed_rows', 'Download failed rows'\)/)
})

// --- 4. the review step of the flow this lane made reachable -------------

// DatedStockReconciliationModal routes 45 strings through T() and two maps
// around it: REASON_LABEL and ACTION_LABEL were plain code -> English and
// rendered straight into the unresolved-row list, so every reason an import
// row needs a decision, and every decision offered for it, read English in
// Khmer mode. Nothing could open this screen at all until this lane wired
// the suggestion banner to it, which is why the gap survived.
const dated = read('components/products/import/DatedStockReconciliationModal.tsx')

const DATED_LABEL_KEYS: Array<[key: string, english: string]> = [
  ['dated_count_reason_invalid_date', 'Invalid or missing date'],
  ['dated_count_reason_invalid_count', 'Invalid or missing count'],
  ['dated_count_reason_missing_branch', 'Missing branch'],
  ['dated_count_reason_missing_identifier', 'No product name, SKU, or barcode given'],
  ['dated_count_reason_product_not_found', 'No matching product found'],
  ['dated_count_reason_ambiguous_barcode', 'Multiple products share this barcode'],
  ['dated_count_reason_ambiguous_name', 'Multiple products share this name'],
  ['dated_count_action_create_new', 'Create as a new, standalone product'],
  ['dated_count_action_link_variant', 'Link this count to an existing product'],
  ['dated_count_action_create_child', "Create as a child row (keeps the linked product's name)"],
  ['dated_count_action_skip', "Skip this row -- don't import it"],
]

runTest('the unresolved-row reason and action labels carry a pack key, not bare English', () => {
  for (const [key, english] of DATED_LABEL_KEYS) {
    assert.match(dated, new RegExp(`\\{ key: '${key}', en: `), `${key} is not declared on its label entry`)
    assert.ok(dated.includes(english), `${key} lost its English fallback`)
  }
  assert.match(dated, /const REASON_LABEL: Record<string, \{ key: string; en: string \}>/)
  assert.match(dated, /const ACTION_LABEL: Record<string, \{ key: string; en: string \}>/)
})

runTest('the review step renders those labels through T(), and still shows an unknown code as itself', () => {
  assert.doesNotMatch(dated, /\{REASON_LABEL\[row\.reason\] \|\| row\.reason\}/, 'the map value went straight to the screen')
  assert.doesNotMatch(dated, /\{ACTION_LABEL\[action\] \|\| action\}/)
  assert.match(dated, /\{reasonLabel\(row\.reason\)\}/)
  assert.match(dated, /\{actionLabel\(action\)\}/)
  assert.match(dated, /const reasonLabel = \(reason: string\): string => \{[\s\S]{0,160}return entry \? T\(entry\.key, entry\.en\) : reason/)
  assert.match(dated, /const actionLabel = \(action: string\): string => \{[\s\S]{0,160}return entry \? T\(entry\.key, entry\.en\) : action/)
})

runTest('both packs carry every dated-count reason and action label, really translated', () => {
  for (const [key, english] of DATED_LABEL_KEYS) {
    assert.equal(en[key], english, `en.json ${key} must be the string the screen actually shows`)
    assert.ok(km[key], `km.json is missing ${key}`)
    assert.notEqual(km[key], en[key], `km.json ${key} is still the English string`)
    assert.match(km[key], /[ក-៿]/, `km.json ${key} carries no Khmer script`)
  }
})

if (failed > 0) {
  console.error(`\n${failed} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll productImportReviewSurfaces tests passed')
}
