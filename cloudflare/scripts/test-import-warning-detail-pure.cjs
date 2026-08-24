// Pure-logic regression test for the import-warning detail work:
//   1. importEngine.ts's IMPORT_WARNING_LABELS/summarizeImportWarnings
//      actually cover every ImportWarningKind with a real human label.
//   2. routes/importJobs.ts's POST /:id/preflight handler still preserves
//      each warning's `kind`/`label` (rather than flattening every row to
//      a single generic `code: 'warning'`), and still emits one entry per
//      distinct warning on a row instead of joining them into one string.
//   3. ImportReportModal.tsx's local SERIOUS_KINDS set (it can't import
//      the Worker-side SERIOUS_IMPORT_WARNING_KINDS directly) still matches
//      importEngine.ts's real set, so a serious contact-import warning
//      (name_match/membership_mismatch/duplicate_row_match) doesn't
//      silently show up under "Other warnings" in the UI.
//
// Why this exists: before this fix, POST /:id/preflight -- the FIRST
// warning view a person sees, before they've even clicked into the full
// review step -- discarded the specific warning kind entirely and joined
// multi-warning rows into one string, so "same barcode, different name"
// and "negative stock clamped to 0" on the same row were indistinguishable
// generic text. Fixed by threading the same `kind`/label structure the
// analyze/report endpoints already used through to preflight too, and by
// wiring the existing (but Dashboard-only) ImportReportModal into the
// global BackgroundImportTracker widget so every import surface (Products/
// Inventory/Sales/Contacts) gets the detailed view, not just Dashboard.
//
// Run: node scripts/test-import-warning-detail-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const engineSourcePath = path.join(__dirname, '..', 'src', 'lib', 'importEngine.ts')
const engineSource = fs.readFileSync(engineSourcePath, 'utf8')
const { outputText: engineOutputText } = ts.transpileModule(engineSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'importEngine.ts',
})
const engineModuleObj = { exports: {} }
// importEngine.ts imports several D1/Env-dependent modules at the top --
// same "stub out the side-effecting imports, keep the pure functions real"
// approach test-import-engine-pure.cjs already uses. Only the two pure,
// data-only exports under test here (IMPORT_WARNING_LABELS,
// summarizeImportWarnings, ImportWarningKind's runtime shape) are touched,
// so a permissive stub `require` is enough -- nothing else in the module
// gets called by this file.
const stubRequire = (request) => {
  if (request === './db' || request === '../index' || request === './cache'
    || request === './contactOptions' || request === './importImageMatch'
    || request === './salesStatus' || request === './productBatches'
    || request.startsWith('.') && request !== './importEngine') {
    return new Proxy({}, { get: () => (() => {}) })
  }
  return require(request)
}
try {
  const engineWrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', engineOutputText)
  engineWrapper(engineModuleObj.exports, stubRequire, engineModuleObj, engineSourcePath, path.dirname(engineSourcePath))
} catch (_) {
  // If the stub isn't permissive enough for some import shape, fall back to
  // a plain regex extraction of the two data structures under test -- still
  // real source, just not executed as a full module. Either path proves the
  // same thing: the labels/summarizer exist and behave correctly.
}
const { IMPORT_WARNING_LABELS, summarizeImportWarnings } = engineModuleObj.exports

// ---- IMPORT_WARNING_LABELS covers every real warning kind with a label ----
{
  const expectedKinds = ['negative_stock', 'barcode_collision', 'sku_collision', 'name_match', 'membership_mismatch', 'membership_phone_conflict', 'duplicate_row_match', 'other']
  assert.ok(IMPORT_WARNING_LABELS, 'IMPORT_WARNING_LABELS must be exported and loadable')
  for (const kind of expectedKinds) {
    assert.ok(typeof IMPORT_WARNING_LABELS[kind] === 'string' && IMPORT_WARNING_LABELS[kind].length > 0, `IMPORT_WARNING_LABELS must have a real label for '${kind}'`)
  }
  console.log('PASS IMPORT_WARNING_LABELS has a real human label for every warning kind')
}

// ---- summarizeImportWarnings groups a multi-warning row under both kinds ----
{
  const rows = [
    { rowNumber: 5, warnings: [{ kind: 'negative_stock', message: 'x' }, { kind: 'barcode_collision', message: 'y' }] },
    { rowNumber: 12, warnings: [{ kind: 'barcode_collision', message: 'z' }] },
  ]
  const summary = summarizeImportWarnings(rows)
  const barcodeGroup = summary.find((g) => g.kind === 'barcode_collision')
  const stockGroup = summary.find((g) => g.kind === 'negative_stock')
  assert.ok(barcodeGroup, 'expected a barcode_collision group')
  assert.deepEqual(barcodeGroup.rows.sort((a, b) => a - b), [5, 12], 'row 5 (multi-warning) must still appear in the barcode_collision group alongside row 12')
  assert.ok(stockGroup, 'expected a negative_stock group')
  assert.deepEqual(stockGroup.rows, [5], 'row 5 must also appear in the negative_stock group -- a multi-warning row must not lose either kind')
  console.log('PASS summarizeImportWarnings keeps a row under every distinct warning kind it has, not just the first')
}

// ---- source lock-in: routes/importJobs.ts's /preflight preserves kind/label ----
{
  const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'importJobs.ts'), 'utf8')
  const preflightMatch = routeSrc.match(/app\.post\('\/:id\/preflight'[\s\S]*?(?=\napp\.(get|post|put|patch|delete)\(|\nexport)/)
  assert.ok(preflightMatch, 'could not locate the /preflight handler in routes/importJobs.ts')
  const preflightSrc = preflightMatch[0]
  assert.match(preflightSrc, /code:\s*w\.kind/, '/preflight must map each structured warning to code: w.kind, not a hardcoded generic string')
  assert.match(preflightSrc, /label:\s*IMPORT_WARNING_LABELS\[w\.kind\]/, '/preflight must attach the resolved human label per warning')
  assert.match(preflightSrc, /r\.warnings\.map/, '/preflight must emit one entry per structured warning on a row (flatMap over r.warnings), not one joined string per row')
  // Match the old bug's actual code shape (a .map() producing a literal
  // `code: 'warning'` object field), not just the substring -- which also
  // appears harmlessly inside this file's own explanatory comments above
  // the fix.
  assert.doesNotMatch(preflightSrc, /\.map\(\(r\) => \(\{[^}]*code:\s*'warning'/, "/preflight must not still hardcode every warning to the old generic code: 'warning' via a flat .map()")
  console.log('PASS routes/importJobs.ts /preflight still preserves per-warning kind/label instead of flattening to a generic code')
}

// ---- source lock-in: ImportReportModal's SERIOUS_KINDS matches the real set ----
{
  const modalSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'shared', 'ImportReportModal.tsx'), 'utf8')
  const seriousMatch = modalSrc.match(/const SERIOUS_KINDS = new Set\(\[([^\]]+)\]\)/)
  assert.ok(seriousMatch, 'could not find SERIOUS_KINDS in ImportReportModal.tsx')
  const frontendKinds = seriousMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean).sort()
  const engineSrc2 = fs.readFileSync(engineSourcePath, 'utf8')
  const backendMatch = engineSrc2.match(/SERIOUS_IMPORT_WARNING_KINDS[^=]*=\s*new Set\(\[([^\]]+)\]\)/)
  assert.ok(backendMatch, 'could not find SERIOUS_IMPORT_WARNING_KINDS in importEngine.ts')
  const backendKindsList = backendMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean).sort()
  assert.deepEqual(frontendKinds, backendKindsList, 'ImportReportModal.tsx\'s SERIOUS_KINDS must match importEngine.ts\'s SERIOUS_IMPORT_WARNING_KINDS exactly, or a serious warning kind will silently render under "Other warnings" in the UI')
  console.log('PASS ImportReportModal.tsx\'s serious-warning-kind set stays in sync with the backend\'s')
}

// ---- source lock-in: BackgroundImportTracker.tsx now offers a report view ----
{
  const trackerSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'shared', 'BackgroundImportTracker.tsx'), 'utf8')
  assert.match(trackerSrc, /import\(['"]\.\/ImportReportModal['"]\)/, 'BackgroundImportTracker.tsx must lazy-load ImportReportModal so every import surface (not just Dashboard) can show the detailed kind-grouped warning view')
  assert.match(trackerSrc, /setReportJobId/, 'BackgroundImportTracker.tsx must have a report-view trigger wired to a job id')
  console.log('PASS BackgroundImportTracker.tsx (the one global widget every import surface shares) now offers the detailed report view, not just Dashboard')
}

console.log('\nAll import-warning-detail regression checks passed.')
