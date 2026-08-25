// Import description whitelist: only five section labels are accepted, and
// anything else is dropped rather than imported.
//
// Real supplier CSVs put structured text inside the `description` cell --
// the user's own 8,727-row file embeds blocks like `"Official Product
// Name": ...`. Only these five may come through:
//
//     Official Product Name / Introduction / Features & Benefits /
//     Who is it for? / Ingredients
//
// Any other `"Something":` block is ignored outright, together with the text
// under it. Letting an unrecognised block through as loose prose would be
// worse than dropping it: it would silently pollute every product page with
// vendor boilerplate no display surface knows how to render.
//
// Caution and Need More Details are deliberately NOT importable even though
// the portal renders them -- they are portal-wide defaults authored in the
// Customer Portal editor, and a supplier's wording must never silently
// override the shop's own.
//
// Run: node scripts/test-description-sections-pure.cjs
const assert = require('node:assert/strict')
const { execSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desc-sections-'))
const tsPath = path.join(tmpDir, 'productDescriptionSections.ts')
fs.writeFileSync(tsPath, fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'productDescriptionSections.ts'), 'utf8'))
const tscBin = path.join(cloudflareRoot, 'node_modules', 'typescript', 'bin', 'tsc')
execSync(`node ${tscBin} --module commonjs --target es2020 --outDir ${tmpDir} ${tsPath}`, { cwd: tmpDir, stdio: 'inherit' })
const { sanitizeImportedDescription } = require(path.join(tmpDir, 'productDescriptionSections.js'))

let passed = 0
function check(name, fn) {
  try {
    fn()
    console.log('PASS', name)
    passed++
  } catch (e) {
    console.log('FAIL', name, '-', e.message)
    process.exitCode = 1
  }
}

check('a plain unlabelled description passes through untouched', () => {
  const result = sanitizeImportedDescription('A light daily moisturiser.')
  assert.equal(result.text, 'A light daily moisturiser.')
  assert.deepEqual(result.ignored, [])
})

check('all five whitelisted sections are kept, in canonical order', () => {
  const result = sanitizeImportedDescription([
    '"Ingredients": Water, Glycerin',
    '"Who is it for?": All skin types',
    '"Official Product Name": Rose Serum',
    '"Introduction": A gentle serum.',
    '"Features & Benefits": Hydrates',
  ].join('\n'))
  assert.deepEqual(result.kept, ['introduction', 'official_name', 'features_benefits', 'who_for', 'ingredients'])
  const order = ['A gentle serum.', 'Official Product Name:', 'Features & Benefits:', 'Who is it for?:', 'Ingredients:']
  let cursor = -1
  for (const token of order) {
    const at = result.text.indexOf(token)
    assert.ok(at > cursor, `"${token}" should appear after the previous section`)
    cursor = at
  }
})

check('ONE recognised section is valid -- the labels are a whitelist, not a required schema', () => {
  const result = sanitizeImportedDescription('"Ingredients": Water')
  assert.deepEqual(result.kept, ['ingredients'])
  assert.equal(result.text, 'Ingredients:\nWater')
})

check('an unrecognised section is dropped WITH its content, not leaked as loose text', () => {
  const result = sanitizeImportedDescription([
    '"Ingredients": Water',
    '"Supplier Notes": ship by air only',
    'do not stack pallets',
    '"Who is it for?": everyone',
  ].join('\n'))
  assert.ok(!/Supplier Notes/i.test(result.text), 'the heading must be gone')
  assert.ok(!/ship by air/i.test(result.text), 'the text under it must be gone too')
  assert.ok(!/do not stack/i.test(result.text), 'continuation lines under a dropped heading must also go')
  assert.ok(/Water/.test(result.text) && /everyone/.test(result.text), 'accepted sections either side must survive')
  assert.deepEqual(result.ignored, ['Supplier Notes'])
})

check('Caution is NOT importable -- it is a portal-wide default, not a per-product field', () => {
  const result = sanitizeImportedDescription('"Caution": avoid eye area\n"Ingredients": Water')
  assert.ok(!/avoid eye area/i.test(result.text))
  assert.ok(/Water/.test(result.text))
  assert.deepEqual(result.ignored, ['Caution'])
})

check('Need More Details is likewise not importable', () => {
  const result = sanitizeImportedDescription('"Need More Details": call us\n"Ingredients": Water')
  assert.ok(!/call us/i.test(result.text))
})

check('label spelling variants are accepted (quotes, case, punctuation, ampersand)', () => {
  for (const label of ['"Features & Benefits"', 'FEATURES AND BENEFITS', 'features benefits', "'Features & Benefits'"]) {
    const result = sanitizeImportedDescription(`${label}: Hydrates`)
    assert.deepEqual(result.kept, ['features_benefits'], `${label} should be recognised`)
  }
  for (const label of ['"Who is it for?"', 'Who is it for', 'WHO IS IT FOR?']) {
    const result = sanitizeImportedDescription(`${label}: everyone`)
    assert.deepEqual(result.kept, ['who_for'], `${label} should be recognised`)
  }
})

check('a colon inside prose is not mistaken for a section heading', () => {
  const result = sanitizeImportedDescription('Apply twice daily.\nNote: avoid the eye area.')
  // "Note" is not whitelisted, so it is dropped -- but the point here is that
  // the FIRST line survives as intro rather than the whole thing collapsing.
  assert.ok(/Apply twice daily/.test(result.text))
})

check('multi-line section bodies are preserved', () => {
  const result = sanitizeImportedDescription('"Features & Benefits":\n- Hydrates\n- Soothes\n- Absorbs fast')
  assert.ok(/Hydrates/.test(result.text) && /Soothes/.test(result.text) && /Absorbs fast/.test(result.text))
})

check('leading unlabelled text becomes the intro and stays at the top', () => {
  const result = sanitizeImportedDescription('A gentle serum.\n"Ingredients": Water')
  assert.ok(result.text.indexOf('A gentle serum.') < result.text.indexOf('Ingredients:'))
  assert.ok(!/^Introduction:/m.test(result.text), 'intro is emitted unlabelled, matching parseProductDescription')
})

check('empty, blank and non-string input is handled without throwing', () => {
  for (const input of ['', '   ', null, undefined, 0, {}]) {
    const result = sanitizeImportedDescription(input)
    assert.equal(typeof result.text, 'string')
  }
  assert.equal(sanitizeImportedDescription('').text, '')
})

check('a description with ONLY unrecognised sections comes back empty rather than partially imported', () => {
  const result = sanitizeImportedDescription('"Vendor Code": XY-12\n"Internal Notes": reorder monthly')
  assert.equal(result.text, '')
  assert.deepEqual(result.ignored, ['Vendor Code', 'Internal Notes'])
})

// ---- the import path must actually use it ----
check('classifyProducts routes imported descriptions through the whitelist', () => {
  const engine = fs.readFileSync(path.join(cloudflareRoot, 'src', 'lib', 'importEngine.ts'), 'utf8')
  assert.ok(
    /description: sanitizeImportedDescription\(/.test(engine),
    'importEngine must sanitize the description rather than storing the raw cell',
  )
})

// ---------------------------------------------------------------------------
// Brand / Category / Shop's Product Name are dropped for a DIFFERENT reason
// than an unrecognised block: the app already holds those values in real
// columns and every display surface wires them in from there. Importing a
// supplier's prose copy would store the value twice, let the two drift, and
// spend description bytes on every row of an 8,700-row file for text nothing
// reads.
// ---------------------------------------------------------------------------
check("Brand, Category and Shop's Product Name are dropped -- they are auto-wired from real columns", () => {
  const result = sanitizeImportedDescription([
    '"Brand": Abercrombie',
    '"Category": Fragrance - Perfume',
    '"Shop\'s Product Name": Abercrombie Authantic 10ml',
    '"Ingredients": Alcohol Denat.',
  ].join('\n'))
  assert.ok(!/Abercrombie/.test(result.text), 'the brand block must not reach the description')
  assert.ok(!/Fragrance/.test(result.text), 'the category block must not reach the description')
  assert.ok(!/Authantic/.test(result.text), "the shop's name block must not reach the description")
  assert.ok(/Alcohol Denat\./.test(result.text), 'a real section either side still survives')
})

check('auto-wired labels are reported separately from genuinely unknown ones', () => {
  const result = sanitizeImportedDescription('"Brand": X\n"Vendor SKU": ZZ-9\n"Ingredients": Water')
  assert.deepEqual(result.autoWired, ['Brand'], 'Brand is expected, not suspicious')
  assert.deepEqual(result.ignored, ['Vendor SKU'], 'only genuinely unknown labels belong in ignored')
})

check('auto-wired label spellings are tolerated (plural, possessive, missing apostrophe)', () => {
  for (const label of ['Brands', 'Categories', 'Shops Product Name', 'Shop Product Name', 'Product Name']) {
    const result = sanitizeImportedDescription(`"${label}": something\n"Ingredients": Water`)
    assert.equal(result.ignored.length, 0, `${label} should be classified as auto-wired, not unknown`)
    assert.equal(result.autoWired.length, 1, `${label} should be recorded as auto-wired`)
  }
})

fs.rmSync(tmpDir, { recursive: true, force: true })
console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
