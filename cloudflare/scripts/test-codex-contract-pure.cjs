// P2-3 Codex/legacy-data contract tests (docs/plans/codex-data-contract.md,
// step 6) -- pins the parts of the contract Codex's re-verification work
// (an external ChatGPT/Codex surface re-verifying product barcodes and
// official names against the old system) actually depends on, spanning
// BOTH decision-10 paths: the review CSV / ops script
// (ops/scripts/migration/official-name-recertification.mjs) and the
// import-hub description convention it shares with
// cloudflare/src/lib/productDescriptionSections.ts.
//
// No `cloudflare/tests/` directory exists in this repo (the brief that
// commissioned this section assumed one) -- the real, exclusively-used
// convention is `cloudflare/scripts/test-*-pure.cjs`, standalone Node
// scripts that load the REAL source (dynamic `import()` for the ops
// script's plain ESM, `typescript`'s transpileModule for the .ts lib) and
// call the actual exported functions, not a re-implementation. Same
// convention as test-barcode-import-precedence-pure.cjs and every other
// file in this directory.
//
// Covers:
//   1. REVIEW_HEADERS pin (exact 20 columns, in order)
//   2. the "Official Product Name:" description convention, round-tripped
//      through BOTH writers/readers: official-name-recertification.mjs's
//      buildGuardedSql (writer) and productDescriptionSections.ts's
//      sanitizeImportedDescription (reader) agree on one exact format
//   3. official-name-recertification.mjs's fail-closed SQL guard shape
//      (id + exact barcode incl. blank + exact prior description)
//   4. barcode_aliases in the REVIEW CSV is validated (digits-only,
//      pipe-separated) but NOT YET emitted as SQL by buildGuardedSql --
//      pinned as a known, deliberate gap (see docs/plans/
//      codex-data-contract.md), not silently "fixed" here: that script is
//      import/read-only for this section (see the brief's ownership list)
//
// Run: node scripts/test-codex-contract-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

let passed = 0
function check(name, fn) { fn(); passed += 1; console.log(`PASS ${name}`) }

// -- load productDescriptionSections.ts (real transpiled module, same
// technique as every other *-pure.cjs test in this directory) -----------

const sectionsSourcePath = path.join(__dirname, '..', 'src', 'lib', 'productDescriptionSections.ts')
const sectionsSource = fs.readFileSync(sectionsSourcePath, 'utf8')
const { outputText: sectionsOutputText } = ts.transpileModule(sectionsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'productDescriptionSections.ts',
})
const sectionsModuleObj = { exports: {} }
new Function('exports', 'require', 'module', '__filename', '__dirname', sectionsOutputText)(
  sectionsModuleObj.exports, require, sectionsModuleObj, sectionsSourcePath, path.dirname(sectionsSourcePath),
)
const { sanitizeImportedDescription } = sectionsModuleObj.exports
assert.strictEqual(typeof sanitizeImportedDescription, 'function', 'sanitizeImportedDescription should be exported from productDescriptionSections.ts')

;(async () => {
  // -- load official-name-recertification.mjs (real ESM, dynamic import,
  // same technique as its own colocated test-official-name-recertification-
  // pure.cjs) --------------------------------------------------------------
  const scriptPath = path.join(__dirname, '..', '..', 'ops', 'scripts', 'migration', 'official-name-recertification.mjs')
  assert.ok(fs.existsSync(scriptPath), 'ops/scripts/migration/official-name-recertification.mjs must exist')
  const recert = await import(`file:///${scriptPath.replace(/\\/g, '/')}`)

  // -- 1. REVIEW_HEADERS pin ------------------------------------------------

  check('REVIEW_HEADERS: exact 20 columns, in order', () => {
    assert.deepStrictEqual(recert.REVIEW_HEADERS, [
      'id',
      'expected_shop_name',
      'expected_barcode',
      'expected_brand',
      'expected_category',
      'expected_old_description',
      'proposed_official_name',
      'barcode_aliases',
      'official_source_url',
      'independent_source_url',
      'barcode_source_url',
      'confidence',
      'review_status',
      'unresolved_notes',
      'evidence_notes',
      'prior_confidence',
      'prior_evidence',
      'approved_for_apply',
      'reviewed_by',
      'reviewed_at_utc',
    ])
  })

  // -- 2. "Official Product Name:" convention round-trip -------------------

  check('description convention: buildGuardedSql\'s exact write format is exactly what sanitizeImportedDescription reads back as official_name', () => {
    const officialName = 'Aveeno Positively Radiant Daily Moisturizer SPF 30'
    // This is the LITERAL string official-name-recertification.mjs's
    // buildGuardedSql writes into `UPDATE products SET description=...`
    // (via its private exactExpectedDescription/nextDescription -- same
    // template, `Official Product Name:\n${name}`, pinned here since the
    // function itself isn't exported).
    const written = `Official Product Name:\n${officialName}`
    const sanitized = sanitizeImportedDescription(written)
    assert.deepStrictEqual(sanitized.kept, ['official_name'], 'the writer\'s exact format must be recognised as the official_name section, not fall through as unlabelled intro text')
    assert.strictEqual(sanitized.text, written, 'round-tripping the writer\'s own format through the reader must reproduce it byte-for-byte (single-section case)')
    assert.deepStrictEqual(sanitized.ignored, [])
    assert.deepStrictEqual(sanitized.autoWired, [])
  })

  check('description convention: a multi-section import description keeps official_name as its own canonical block, reserialized in SECTION_ORDER', () => {
    const raw = [
      'Official Product Name: Neutrogena Hydro Boost Water Gel',
      'Ingredients:',
      'Water, Dimethicone, Glycerin',
      'Introduction:',
      'A lightweight, oil-free gel moisturizer.',
    ].join('\n')
    const sanitized = sanitizeImportedDescription(raw)
    assert.deepStrictEqual(sanitized.kept, ['introduction', 'official_name', 'ingredients'], 'introduction sorts first per SECTION_ORDER, regardless of source order')
    assert.match(sanitized.text, /^A lightweight, oil-free gel moisturizer\.\n\nOfficial Product Name:\nNeutrogena Hydro Boost Water Gel/)
  })

  // -- 3. official-name-recertification.mjs's fail-closed SQL guard shape --

  function makeReviewRow(overrides = {}) {
    const id = 6032
    const shopName = 'Shop Product 6032'
    return {
      id: String(id), expected_shop_name: shopName, expected_barcode: '6923644012345',
      expected_brand: 'Brand', expected_category: '', expected_old_description: `Official Product Name:\n${shopName}`,
      proposed_official_name: 'Verified Official Product 6032', barcode_aliases: '',
      official_source_url: 'https://brand.example/product', independent_source_url: 'https://retailer.example/product',
      barcode_source_url: 'https://barcode.example/item', confidence: 'high', review_status: 'approved',
      unresolved_notes: '', evidence_notes: '', prior_confidence: '', prior_evidence: '',
      approved_for_apply: 'true', reviewed_by: 'Reviewer', reviewed_at_utc: '2026-09-02T12:00:00Z',
      ...overrides,
    }
  }
  // buildGuardedSql itself hard-requires exactly ids 6032-6104 (validateReviewRows'
  // own firstId/lastId default and "missing required id" check) -- fill the
  // rest of the required range with untouched, non-approved rows so this
  // test can focus its one interesting row without fighting that guard.
  function makeFullRowset(row0Overrides = {}) {
    const rows = []
    for (let id = 6032; id <= 6104; id += 1) {
      if (id === 6032) { rows.push(makeReviewRow(row0Overrides)); continue }
      const shopName = `Shop Product ${id}`
      rows.push({
        id: String(id), expected_shop_name: shopName, expected_barcode: String(900000000000 + id),
        expected_brand: '', expected_category: '', expected_old_description: `Official Product Name:\n${shopName}`,
        proposed_official_name: '', barcode_aliases: '', official_source_url: '', independent_source_url: '', barcode_source_url: '',
        confidence: 'pending', review_status: 'pending_recertification', unresolved_notes: '', evidence_notes: '',
        prior_confidence: '', prior_evidence: '', approved_for_apply: 'false', reviewed_by: '', reviewed_at_utc: '',
      })
    }
    return rows
  }

  check('buildGuardedSql: the UPDATE is fail-closed on exact id + COALESCE(barcode,\'\') + COALESCE(description,\'\')', () => {
    const rows = makeFullRowset()
    const { sql, validation } = recert.buildGuardedSql(rows)
    assert.deepStrictEqual(validation.errors, [])
    assert.strictEqual(validation.approved.length, 1)
    assert.ok(sql.includes(`UPDATE products SET description='Official Product Name:\nVerified Official Product 6032', updated_at=CURRENT_TIMESTAMP`))
    assert.match(sql, /WHERE id=6032/)
    assert.match(sql, /AND COALESCE\(barcode,''\)='6923644012345'/)
    assert.ok(sql.includes(`AND COALESCE(description,'')='Official Product Name:\nShop Product 6032'`))
  })

  check('buildGuardedSql: a blank expected_barcode guards on an exact BLANK predicate, not a wildcard', () => {
    const rows = makeFullRowset({ expected_barcode: '', barcode_source_url: '' })
    const { sql, validation } = recert.buildGuardedSql(rows)
    assert.deepStrictEqual(validation.errors, [])
    assert.match(sql, /AND COALESCE\(barcode,''\)=''/)
  })

  check("buildGuardedSql: never writes to products.barcode -- only products.description", () => {
    const rows = makeFullRowset()
    const { sql } = recert.buildGuardedSql(rows)
    assert.doesNotMatch(sql, /SET[^;]*barcode\s*=/i, 'the recertification script must only ever touch description, never barcode directly')
  })

  // -- 4. barcode_aliases: validated, but NOT YET wired into buildGuardedSql

  check('KNOWN GAP (pinned, not fixed here): barcode_aliases is validated (digits-only) but buildGuardedSql never emits SQL for it', () => {
    const rows = makeFullRowset({ barcode_aliases: '111111111111|222222222222' })
    const { sql, validation } = recert.buildGuardedSql(rows)
    assert.deepStrictEqual(validation.errors, [], 'a well-formed digits-only barcode_aliases cell must not fail validation')
    assert.doesNotMatch(sql, /barcode_aliases/i, 'buildGuardedSql does not (yet) emit any barcode_aliases INSERT -- see docs/plans/codex-data-contract.md for the follow-up recommendation')
  })

  check('barcode_aliases validation: a non-digit alias is rejected', () => {
    const rows = makeFullRowset({ barcode_aliases: '6923-644-012345' })
    const validation = recert.validateReviewRows(rows)
    assert.ok(validation.errors.some((e) => /barcode alias .* is not digits-only/.test(e)))
  })

  console.log(`\n${passed} passed`)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
