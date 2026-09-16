// Executes ops/scripts/migration/legacy-preflight.mjs::barcodeKey against the
// real adversarial inputs from the legacy source files.  It does not grep for
// the fix; it calls the helper and asserts the key.
//
// WHY THIS LIVES UNDER cloudflare/scripts/ RATHER THAN NEXT TO THE SCRIPT IT
// TESTS: nothing globs `ops/scripts/migration/test-*.cjs` -- not the root, not
// cloudflare/package.json, not frontend/package.json -- so a test placed there
// is run only by hand.  `cloudflare/scripts/test-*.cjs` is the sweep the gate
// runs, and test-receipt-number-format-pure.cjs already reaches into
// ops/scripts/migration from here, so this is the established home.
//
// Every path is anchored to __dirname, never the cwd: the sweep is run from
// both `cloudflare/` and `cloudflare/scripts/`.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const repoRoot = path.join(__dirname, '..', '..')
const migrationDir = path.join(repoRoot, 'ops', 'scripts', 'migration')

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`  ok  ${name}`)
  } catch (error) {
    failures += 1
    console.error(`  FAIL ${name}\n       ${error.message}`)
  }
}

// The three "Created By:..." banner rows are the literal `Item Code` cells of
// `Migration from old system/stock branch transfer.xls`.  That workbook is not
// in git, so they are pinned here as source evidence rather than read at run
// time -- this test must stay pure.
const TRANSFER_BANNERS = [
  'Created By:Super AdminDate:2026-09-0118:20From Branch:WarehouseDone By:Super AdminDone Date:2026-09-0118:20To Branch:Leang Cosmetic ShopTransfer #:2609001724',
  'Created By:Super AdminDate:2026-09-0118:13From Branch:WarehouseDone By:Super AdminDone Date:2026-09-0118:13To Branch:Leang Cosmetic ShopTransfer #:2609001723',
  'Created By:Super AdminDate:2026-08-2911:58From Branch:WarehouseDone By:Super AdminDone Date:2026-08-2911:58To Branch:Leang Cosmetic ShopTransfer #:2608001722',
]

;(async () => {
  const helpers = await import(pathToFileURL(path.join(migrationDir, 'legacy-preflight.mjs')).href)
  const { barcodeKey, resolveUniqueBarcode } = helpers

  check('a code is a barcode only when it is entirely digits', () => {
    const cases = [
      // input, expected key, why
      ['Libre10ml', '', 'SKU-style code must not become the key "10"'],
      ['CompletelyClean45g', '', 'SKU-style code must not become the key "45"'],
      ['10', '10', 'a real all-digit barcode still keys as itself'],
      ['0012345', '12345', 'leading-zero normalisation survives for digits-only codes'],
      ['', '', 'a blank cell has no barcode'],
      ['  ', '', 'a whitespace-only cell has no barcode'],
      ['Item Code', '', 'a repeated spreadsheet header row is not a barcode'],
      ...TRANSFER_BANNERS.map((banner) => [banner, '', 'a transfer banner row is not a barcode']),
      // Neighbours of the rule, pinned so the boundary cannot drift silently.
      ['0', '0', 'the "0" placeholder is preserved for callers that reject it'],
      ['  041554539462  ', '41554539462', 'surrounding whitespace is trimmed rather than read as a non-digit, then the existing leading-zero normalisation applies'],
      ['112158 815142', '', 'an internal space means this is not a digits-only code'],
      [null, '', 'null is not a barcode'],
      [undefined, '', 'undefined is not a barcode'],
    ]
    for (const [input, expected, why] of cases) {
      assert.strictEqual(barcodeKey(input), expected, `${JSON.stringify(input)} -> ${JSON.stringify(barcodeKey(input))}, expected ${JSON.stringify(expected)}: ${why}`)
    }
  })

  check('a non-digit code falls through: empty key, no throw, no resolution', () => {
    for (const input of ['Libre10ml', 'CompletelyClean45g', 'Item Code', '', '  ', ...TRANSFER_BANNERS]) {
      // Handing it a single candidate is the whole hazard: with digit
      // extraction this returned `resolved` and booked the wrong product.
      const resolution = resolveUniqueBarcode(input, [{ id: 10111, name: 'YSL Libre 10ml' }])
      assert.strictEqual(resolution.status, 'missing_barcode', `${JSON.stringify(input)} must not resolve a product`)
      assert.strictEqual(resolution.product, null)
      assert.strictEqual(resolution.key, '')
    }
    // ...while a genuine barcode still resolves exactly as before.
    assert.strictEqual(resolveUniqueBarcode('10', [{ id: 7 }]).status, 'resolved')
    assert.strictEqual(resolveUniqueBarcode('00123', [{ id: 8 }]).key, '123')
    assert.strictEqual(resolveUniqueBarcode('0', [{ id: 9 }]).status, 'missing_barcode')
  })

  check('the mis-book that the duplicate quarantine was accidentally hiding', () => {
    // Rebuild the Sep-1 index exactly as import-sep01-legacy-reports.mjs does,
    // but with only ONE active product on barcode "10" -- the case the peer
    // review found.  In production 44 products carry the literal barcode "10"
    // (the 10ml-perfume placeholder) and the duplicate quarantine caught it;
    // relax the quarantine and this becomes silent mis-booking.
    const products = [
      { id: 9001, barcode: '10', name: 'Unrelated 10ml Perfume Placeholder' },
      { id: 10111, barcode: 'Libre10ml', name: 'YSL Libre 10ml' },
      { id: 1369, barcode: 'CompletelyClean45g', name: 'Clinical Completely Clean 45g' },
    ]
    const byBarcode = new Map()
    for (const product of products) {
      const key = barcodeKey(product.barcode)
      if (key && key !== '0') (byBarcode.get(key) || byBarcode.set(key, []).get(key)).push(product)
    }
    // A SKU-barcoded live product must never be indexed under a short key.
    assert.deepStrictEqual([...byBarcode.keys()], ['10'], 'only the genuinely all-digit barcode is indexed')
    assert.deepStrictEqual(byBarcode.get('10').map((p) => p.id), [9001], 'no SKU-barcoded product joins the "10" bucket')

    for (const code of ['Libre10ml', 'CompletelyClean45g']) {
      const key = barcodeKey(code)
      const matches = key ? (byBarcode.get(key) || []) : []
      const resolution = resolveUniqueBarcode(code, matches)
      assert.strictEqual(resolution.status, 'missing_barcode', `${code} must not book against product 9001`)
      assert.strictEqual(resolution.product, null)
    }
  })

  check('the transfer path, which has no name fallback, reports rather than guesses', () => {
    const sep01 = fs.readFileSync(path.join(migrationDir, 'import-sep01-legacy-reports.mjs'), 'utf8')
    // resolveUniqueBarcode is the only route to a product on that path, so a
    // non-barcode code must land in `failures`, under its own type.
    assert.match(sep01, /type: resolved\.status === 'missing_barcode' \? 'non_barcode_transfer_code' : 'quarantined_transfer_barcode'/)
    assert.match(sep01, /const transferKey = barcodeKey\(first\)/)
  })

  check('one rule, one implementation: no migration script redefines it', () => {
    const scripts = fs.readdirSync(migrationDir).filter((name) => name.endsWith('.mjs'))
    assert.ok(scripts.length >= 5, `expected the migration scripts to be present, found ${scripts.length}`)
    for (const name of scripts) {
      const text = fs.readFileSync(path.join(migrationDir, name), 'utf8')
      if (name !== 'legacy-preflight.mjs') {
        assert.doesNotMatch(text, /(const|let|var|function)\s+barcodeKey\s*[=(]/, `${name} must import barcodeKey, not redefine it`)
        assert.doesNotMatch(text, /(const|let|var|function)\s+isNumericCode\s*[=(]/, `${name} must use barcodeKey directly; a second "is it numeric" helper is a second rule`)
      }
      // Digit extraction must never reach a barcode again, anywhere here.
      assert.doesNotMatch(text, /barcode[A-Za-z]*\s*(=|=>)[^\n]*replace\(\/\\D\/g/, `${name} still derives a barcode key by stripping non-digits`)
    }
    const preflight = fs.readFileSync(path.join(migrationDir, 'legacy-preflight.mjs'), 'utf8')
    assert.match(preflight, /if \(!\/\^\[0-9\]\+\$\/\.test\(code\)\) return ''/, 'the shared helper must carry the entirely-digits rule')
  })

  check('the Aug-30/Aug-31 ruling stays true: digits() is phone-only there', () => {
    // Read rather than assumed. If a future edit calls digits() for a barcode
    // in either already-applied importer, this goes red.
    for (const [name, expectedCallers] of [['import-aug30-legacy-reports.mjs', 1], ['import-aug31-legacy-reports.mjs', 1]]) {
      const text = fs.readFileSync(path.join(migrationDir, name), 'utf8')
      const lines = text.split('\n')
      const callers = lines
        .map((line, index) => ({ line, number: index + 1 }))
        .filter((entry) => /\bdigits\s*\(/.test(entry.line) && !/^\s*const digits =/.test(entry.line))
      assert.strictEqual(callers.length, expectedCallers, `${name}: digits() callers are ${callers.map((c) => c.number).join(',')}`)
      assert.match(callers[0].line, /const phoneKey = \(value\) => digits\(value\)/, `${name}: the only digits() caller must be phoneKey`)
    }
    // aug31:160's `barcodeKey` is a loadMapping parameter holding a mapping
    // COLUMN NAME, not the shared helper -- and the file imports no barcodeKey.
    const aug31 = fs.readFileSync(path.join(migrationDir, 'import-aug31-legacy-reports.mjs'), 'utf8')
    assert.match(aug31, /function loadMapping\(filename, nameKey, barcodeKey, targetKeys\)/)
    assert.match(aug31, /String\(row\[barcodeKey\] \|\| ''\)/, 'it is used as a column key, never called')
    assert.doesNotMatch(aug31, /barcodeKey\(/, 'aug31 must never call a barcodeKey function')
  })

  if (failures) {
    console.error(`FAIL legacy barcode key: ${failures} check(s) failed`)
    process.exitCode = 1
  } else {
    console.log('PASS legacy migration barcode key -- a code is a barcode only when it is entirely digits')
  }
})().catch((error) => { console.error(error); process.exitCode = 1 })
