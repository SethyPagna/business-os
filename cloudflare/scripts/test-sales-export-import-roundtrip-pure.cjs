// The sales export's `sale_date` column, driven through BOTH real
// implementations on one dataset: the frontend exporter that writes the cell
// and the Worker importer that reads it back.
//
// Why this file exists. On Sep 4 2026 the app moved every displayed date to
// day-first ("change the whole app to dd-mm-yyy, just receipt id stays
// yyyy-mm-dd"). `sale_date` LOOKS like one more display cell, and formatting
// it with the day-first display formatter typechecks, renders plausibly, and
// passes every frontend test -- while silently breaking the round trip,
// because parseSalesImportDateTime reads a slash date MONTH-first and must
// keep doing so (every spreadsheet the shop already owns keeps its meaning).
// The failure is invisible for any day <= 12: 08/09/2026 exports as the 8th
// of September and re-imports as the 9th of August. Nothing throws.
//
// So the export ships ISO, and this test is the only place both halves meet.
//
// The importer half is EXTRACTED rather than imported: importEngine.ts uses
// extensionless module specifiers (Worker/bundler resolution) that plain Node
// ESM cannot resolve. The extraction takes the real source text of the real
// functions and asserts it found them, so this still exercises shipping code
// -- but if that file is ever restructured, expect to adjust the markers here.
//
// Run: node scripts/test-sales-export-import-roundtrip-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..', '..')
const url = (p) => pathToFileURL(path.join(ROOT, p)).href

/** Pull one top-level `function name(...)` out of a TS source by brace matching. */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `could not find function ${name} -- importEngine.ts was restructured`)
  let depth = 0
  let seenBrace = false
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') { depth += 1; seenBrace = true }
    else if (ch === '}') {
      depth -= 1
      if (seenBrace && depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`)
}

/** Strip TS type annotations that plain JS eval cannot parse. */
function stripTypes(fn) {
  return fn
    .replace(/\(value: unknown\)/g, '(value)')
    .replace(/\): string \| null \{/g, ') {')
    .replace(/\): string \{/g, ') {')
    .replace(/const (\w+) = raw\.match/g, 'const $1 = raw.match')
}

async function main() {
  const { buildSalesImportRows, SALES_IMPORT_COLUMNS } = await import(url('frontend/src/utils/salesImportContract.ts'))
  const { fmtDateTime24, fmtBusinessIsoDateTime } = await import(url('frontend/src/utils/formatters.ts'))

  const engineSource = fs.readFileSync(path.join(ROOT, 'cloudflare', 'src', 'lib', 'importEngine.ts'), 'utf8')
  const strFn = stripTypes(extractFunction(engineSource, 'str'))
  const parseFn = stripTypes(extractFunction(engineSource, 'parseSalesImportDateTime').replace(/^export\s+/, ''))
  assert.ok(parseFn.includes('Asia') || parseFn.includes('hour - 7'), 'the extracted parser still applies the +7 business offset')
  assert.ok(parseFn.includes('const isoFirst'), 'the extracted parser still branches on ISO-vs-slash')
  // eslint-disable-next-line no-new-func
  const parseSalesImportDateTime = new Function(`${strFn}\n${parseFn}\nreturn parseSalesImportDateTime`)()

  const sale = (createdAt) => ({
    receipt_number: 'R-1', created_at: createdAt, sale_status: 'completed',
    items: [{ product_name: 'Widget', sku: 'SKU-1', quantity: 1, applied_price_usd: 5, cost_price_usd: 3 }],
  })

  // --- 1. the cell is ISO, not the day-first display string ------------------
  assert.ok(SALES_IMPORT_COLUMNS.includes('sale_date'), 'the contract still has the column this test is about')
  const row = buildSalesImportRows([sale('2026-08-28T07:30:00.000Z')])[0]
  assert.equal(row.sale_date, '2026-08-28 14:30', 'UTC storage exports as Cambodia wall time, ISO-ordered')
  assert.match(row.sale_date, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, 'no slashes may appear in this column')

  // --- 2. it survives the real importer, unchanged --------------------------
  assert.equal(parseSalesImportDateTime(row.sale_date), '2026-08-28T07:30:00.000Z', 'export -> import returns the same instant')

  // --- 3. every day of a month round-trips, including the ambiguous ones -----
  // Days 1-12 are where a day/month swap cannot be seen by eye. Days 13+ would
  // at least throw. Both are checked, across all twelve months.
  let checked = 0
  for (let month = 1; month <= 12; month += 1) {
    for (const day of [1, 5, 8, 9, 12, 13, 25, 28]) {
      const iso = `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T03:00:00.000Z`
      const cell = buildSalesImportRows([sale(iso)])[0].sale_date
      assert.equal(parseSalesImportDateTime(cell), iso, `round trip lost ${iso} (exported as "${cell}")`)
      checked += 1
    }
  }

  // --- 4. the importer's slash branch is still month-first -------------------
  // This is the constraint that forced ISO on the export, so it is asserted
  // here rather than assumed. If a later session ever flips it to day-first,
  // this file fails and points at the sheets that would silently change
  // meaning -- do not "fix" it by updating these two lines.
  assert.equal(parseSalesImportDateTime('09/01/2026 10:00'), '2026-09-01T03:00:00.000Z', 'a slash cell is read MONTH-first: 1 September')
  assert.equal(parseSalesImportDateTime('01/09/2026 10:00'), '2026-01-09T03:00:00.000Z', 'and its transpose is 9 January, not the same day')

  // --- 5. and the display formatter really is day-first ----------------------
  // Proving the two are genuinely different functions, so that item 1 is a
  // deliberate choice rather than an accident of them agreeing.
  assert.equal(fmtDateTime24('2026-08-28T07:30:00.000Z'), '28/08/2026 14:30', 'the DISPLAY formatter is day-first')
  assert.equal(fmtBusinessIsoDateTime('2026-08-28T07:30:00.000Z'), '2026-08-28 14:30', 'the EXPORT formatter is ISO')
  assert.notEqual(fmtDateTime24('2026-08-28T07:30:00.000Z'), fmtBusinessIsoDateTime('2026-08-28T07:30:00.000Z'))

  console.log(`PASS sales export/import round trip: ${checked} dates, ISO cell, importer still month-first on slashes`)
  console.log('test-sales-export-import-roundtrip-pure: ok')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
