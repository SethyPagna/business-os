import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

// Owner ruling 17 (13 Oct 2026): in a Replace-entire-catalog import a skipped row
// keeps its product. The server reports how many skipped rows did (summary
// `skippedKept`, a subset of `skipped`); these tests pin how the person is told,
// in both languages, on the three surfaces that show an import's result.

const read = (rel: string) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const tracker = read('src/components/shared/BackgroundImportTracker.tsx')
const report = read('src/components/shared/ImportReportModal.tsx')
const review = read('src/components/products/import/ProductServerImportReviewScreen.tsx')
const en = JSON.parse(read('src/lang/en.json')) as Record<string, string>
const km = JSON.parse(read('src/lang/km.json')) as Record<string, string>

// getJobResultParts is module-private and the file is a React component, so the
// function itself is lifted out of the source and run for real.
function loadResultParts(): (job: unknown, labels?: Record<string, string>) => string[] {
  const start = tracker.indexOf('function getJobResultParts(')
  assert.ok(start > 0, 'getJobResultParts exists')
  const end = tracker.indexOf('\n}\n', start)
  const source = tracker.slice(start, end + 3)
  const js = ts.transpileModule(`${source}\nexport { getJobResultParts }`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} as Record<string, unknown> }
  new Function('module', 'exports', js)(module, module.exports)
  return module.exports.getJobResultParts as (job: unknown, labels?: Record<string, string>) => string[]
}
const resultParts = loadResultParts()
const labelsFor = (pack: Record<string, string>) => ({ duplicate: pack.skipped, skippedKept: pack.import_skipped_kept })

test('replace-all skipped rows that kept their product get their own chip, taken out of the plain skipped count', () => {
  const parts = resultParts({ summary: { created: 4, skipped: 5, skippedKept: 2 } }, labelsFor(en))
  assert.deepEqual(parts, ['4 created', '3 skipped', '2 skipped (kept)'])
  assert.ok(!parts.some((part) => part.startsWith('5 ')), 'no row is counted twice')
})

test('the chip reads in Khmer from the Khmer pack, never the English fallback', () => {
  const parts = resultParts({ summary: { skipped: 5, skippedKept: 2 } }, labelsFor(km))
  assert.deepEqual(parts, [`3 ${km.skipped}`, `2 ${km.import_skipped_kept}`])
  assert.notEqual(km.import_skipped_kept, en.import_skipped_kept)
  assert.match(km.import_skipped_kept, /[ក-៿]/)
})

test('every skipped row kept: only the kept chip shows', () => {
  assert.deepEqual(resultParts({ summary: { skipped: 3, skippedKept: 3 } }, labelsFor(en)), ['3 skipped (kept)'])
})

test('a job with no kept rows reads exactly as before', () => {
  assert.deepEqual(resultParts({ summary: { created: 1, skipped: 2 } }, labelsFor(en)), ['1 created', '2 skipped'])
  assert.deepEqual(resultParts({ summary: { created: 1, skipped: 2, skippedKept: 0 } }, labelsFor(en)), ['1 created', '2 skipped'])
  assert.deepEqual(resultParts({ summary: {} }, labelsFor(en)), [])
})

test('a kept count larger than the skipped count can never show more kept rows than skipped ones', () => {
  assert.deepEqual(resultParts({ summary: { skipped: 1, skippedKept: 9 } }, labelsFor(en)), ['1 skipped (kept)'])
  assert.deepEqual(resultParts({ summary: { skippedKept: 4 } }, labelsFor(en)), [])
})

test('the tracker, the import report and the server review screen all use translated keys', () => {
  assert.match(tracker, /skippedKept: t\('import_skipped_kept'\)/)
  assert.match(report, /t\('import_report_skipped_kept'\)/)
  assert.match(review, /tr\('import_skip_row_kept'/)
  assert.match(review, /tr\('import_replace_skip_note'/)
  assert.match(review, /import_mode === 'replace_all'/, 'the replace-all wording is driven by the job policy, not guessed from rows')
})

test('both packs carry every key, and the {n} slot survives in Khmer', () => {
  for (const key of ['import_skipped_kept', 'import_report_skipped_kept', 'import_skip_row_kept', 'import_replace_skip_note']) {
    assert.ok(en[key], `en.json has ${key}`)
    assert.ok(km[key], `km.json has ${key}`)
    assert.match(km[key], /[ក-៿]/, `${key} is Khmer`)
  }
  assert.ok(en.import_report_skipped_kept.includes('{n}') && km.import_report_skipped_kept.includes('{n}'))
})

test('the replace-all warnings tell the person that a skipped row keeps its product, in both languages', () => {
  assert.match(en.csv_mode_replace_warning, /skip keeps its product/)
  assert.match(en.confirm_replace_all_import, /skip keeps its product/)
  for (const key of ['csv_mode_replace_warning', 'confirm_replace_all_import']) {
    assert.match(km[key], /ជួរដែលអ្នករំលងនឹងរក្សាផលិតផលរបស់វាទុក/, `${key} says it in Khmer`)
  }
})
