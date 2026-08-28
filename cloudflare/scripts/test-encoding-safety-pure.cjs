// M7: the backend half of the encoding-safety contract, against the REAL
// transpiled parsers (never re-writes):
//
//   - importCsv.ts's csvValuesToRow applies BOTH Excel text-protection
//     unescapes (="text" wrap, leading-' injection guard) identically to
//     the frontend parser -- the backend parse is the one that COMMITS,
//     Screen 1's preview parses the same bytes in the browser, and the two
//     MUST agree or the operator confirms one value and a different one
//     lands. Pinned as a literal PARITY check: both parsers, one nasty
//     fixture, deep-equal output.
//   - the backend parser NFC-normalizes values (decomposed Khmer collapses
//     to composed) and strips the BOM, CRLF, quoted newlines.
//   - errors.csv ships with the UTF-8 BOM (Excel-bound; Khmer product
//     names inside error messages read as '?' without it).
//   - the xlsx→text bridge and the export guard keep their machine/human
//     split (source locks).
//
// Run: node scripts/test-encoding-safety-pure.cjs
const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

function compileAt(absPath, stubs = {}) {
  const output = ts.transpileModule(fs.readFileSync(absPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const moduleObj = { exports: {} }
  const localRequire = (request) => {
    const key = request.replace(/\.ts$/, '')
    if (Object.prototype.hasOwnProperty.call(stubs, key)) return stubs[key]
    return require(request)
  }
  new Function('exports', 'require', 'module', output)(moduleObj.exports, localRequire, moduleObj)
  return moduleObj.exports
}

const backendRoot = path.join(__dirname, '..')
const frontendRoot = path.join(backendRoot, '..', 'frontend')

const backendCsv = compileAt(path.join(backendRoot, 'src', 'lib', 'importCsv.ts'))
const pricing = compileAt(path.join(frontendRoot, 'src', 'utils', 'pricing.ts'))
const frontendCsv = compileAt(path.join(frontendRoot, 'src', 'utils', 'csvImport.ts'), { './pricing': pricing })

// One fixture exercising every guarded/at-risk shape. Deliberately NFC
// already, so frontend (which NFC-normalizes at DECODE time, not parse
// time) and backend (which normalizes per value) see identical input --
// the decomposed-input case is asserted separately below as the backend's
// own guarantee.
const FIXTURE = [
  'name,phone,formula,handle,barcode,qty,khmer,note',
  '"\'-Minus Name","\'+855 12 345 678","\'=SUM(A1:A9)","\'@handle","=""0123456789012""","\'-5",ស្តុកចូល,"has, comma and ""quotes"""',
  '"\'O\'Brien",,,,8850006330012,3,,plain',
].join('\r\n')

;(() => {
  const rows = backendCsv.parseCsvRows(FIXTURE)
  assert.strictEqual(rows.length, 2)
  const [first, second] = rows
  assert.strictEqual(first.name, '-Minus Name', 'injection guard stripped')
  assert.strictEqual(first.phone, '+855 12 345 678')
  assert.strictEqual(first.formula, '=SUM(A1:A9)')
  assert.strictEqual(first.handle, '@handle')
  assert.strictEqual(first.barcode, '0123456789012', '="..." wrap unwrapped, leading zero intact')
  assert.strictEqual(first.qty, '-5', 'guarded negative quantity is the plain number text again')
  assert.strictEqual(first.khmer, 'ស្តុកចូល')
  assert.strictEqual(first.note, 'has, comma and "quotes"')
  assert.strictEqual(second.name, "'O'Brien", 'a real leading apostrophe (not the guard shape) is preserved')
  assert.strictEqual(second.barcode, '8850006330012')
  console.log('PASS backend parser applies both unescapes and preserves literals')
})()

;(() => {
  const bom = String.fromCharCode(0xFEFF)
  const backendRows = backendCsv.parseCsvRows(bom + FIXTURE)
  const frontendRows = frontendCsv.parseCsvRows(bom + FIXTURE)
  assert.deepStrictEqual(backendRows, frontendRows, 'preview (frontend) and commit (backend) parse the SAME rows')
  console.log(`PASS frontend↔backend parse PARITY on the nasty fixture (${backendRows.length} rows, BOM included)`)
})()

;(() => {
  // Decomposed Khmer input: the backend normalizes per value (its own
  // guarantee -- it parses raw stored bytes); the frontend's NFC step lives
  // in decodeTextBuffer instead, before its parser ever runs.
  const decomposed = 'name\nសំរាំង'.normalize('NFD')
  const [row] = backendCsv.parseCsvRows(decomposed)
  assert.strictEqual(row.name, 'សំរាំង'.normalize('NFC'), 'backend values come out NFC-composed')
  console.log('PASS backend NFC-normalizes decomposed input')
})()

;(() => {
  const multiline = 'name,description\n"A","line one\nline two, still one cell"'
  const backendRows = backendCsv.parseCsvRows(multiline)
  assert.strictEqual(backendRows[0].description, 'line one\nline two, still one cell')
  assert.deepStrictEqual(backendRows, frontendCsv.parseCsvRows(multiline), 'quoted-newline parity too')
  console.log('PASS quoted multi-line cells survive both parsers identically')
})()

// ---- source locks ----------------------------------------------------------
;(() => {
  const importJobs = fs.readFileSync(path.join(backendRoot, 'src', 'routes', 'importJobs.ts'), 'utf8')
  assert.match(importJobs, /String\.fromCharCode\(0xFEFF\) \+ csv/, 'errors.csv ships with the UTF-8 BOM')

  const bridge = fs.readFileSync(path.join(frontendRoot, 'src', 'utils', 'spreadsheetImport.ts'), 'utf8')
  assert.ok(bridge.includes('csvFieldForMachine'), 'the xlsx→text bridge uses machine quoting')
  assert.ok(!/\bescapeCsvValue\b/.test(bridge.replace(/\/\/[^\n]*/g, '')), 'the injection-guard escape is out of the machine path (comments aside)')

  const csvUtil = fs.readFileSync(path.join(frontendRoot, 'src', 'utils', 'csv.ts'), 'utf8')
  assert.match(csvUtil, /\.csv\$\/i\.test\(name\) && !text\.startsWith\(UTF8_BOM\)/, 'zip .csv entries gain the BOM')

  const backendSrc = fs.readFileSync(path.join(backendRoot, 'src', 'lib', 'importCsv.ts'), 'utf8')
  const frontendSrc = fs.readFileSync(path.join(frontendRoot, 'src', 'utils', 'csvImport.ts'), 'utf8')
  for (const src of [backendSrc, frontendSrc]) {
    assert.ok(src.includes(`/^="([^"]*)"$/`), 'both parsers carry the ="..." unwrap')
    assert.ok(src.includes(`/^'[=+\\-@\\t\\r]/`), 'both parsers carry the guard strip, same pattern')
  }
  console.log('PASS source locks: BOM on errors.csv, machine quoting on the bridge, twin unescapes')
})()

console.log('ALL PASS test-encoding-safety-pure')
