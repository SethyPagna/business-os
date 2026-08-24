// Standalone unit tests for src/lib/importImageMatch.ts -- the module
// that was missing outright (see CHANGES-VERIFIED.md). No D1/wrangler
// dependency here at all (this module is pure, no Env/db imports), so
// unlike test-import-engine-pure.cjs this needs no stubbing -- just
// transpile the real file and call its real exports.
//
// Run: node scripts/test-import-image-match.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'importImageMatch.ts')
const source = fs.readFileSync(sourcePath, 'utf8')

const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'importImageMatch.ts',
})

const moduleObj = { exports: {} }
const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)
wrapper(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))

const {
  normalizeImageMatchKey,
  matchImagesToProducts,
  buildAutoRenamePlan,
  buildImageDisplayName,
  sanitizeBaseName,
  MAX_IMAGES_PER_PRODUCT,
} = moduleObj.exports

assert.strictEqual(typeof matchImagesToProducts, 'function', 'matchImagesToProducts should be exported')
assert.strictEqual(typeof buildAutoRenamePlan, 'function', 'buildAutoRenamePlan should be exported')
assert.strictEqual(typeof buildImageDisplayName, 'function', 'buildImageDisplayName should be exported')
assert.strictEqual(MAX_IMAGES_PER_PRODUCT, 3, 'the per-product image cap should be 3, matching the product gallery cap elsewhere')

const img = (id, originalName, relativePath = null) => ({ id, originalName, relativePath, publicPath: `/uploads/${originalName}` })

// -- Test 1: exact key match, same name on multiple candidate rows (one
// uploaded image should attach to every row sharing that exact name --
// e.g. the same product listed once per branch). --
{
  const images = [img(1, 'Coca Cola.jpg')]
  const candidates = [
    { id: 'a', name: 'Coca Cola' },
    { id: 'b', name: 'Coca Cola' },
    { id: 'c', name: 'Sprite' },
  ]
  const result = matchImagesToProducts(images, candidates)
  assert.strictEqual(result.matched.length, 2, 'an exact-name image should match every candidate sharing that exact name')
  assert.deepStrictEqual(result.matched.map((m) => m.productId).sort(), ['a', 'b'], 'both Coca Cola candidates should be matched, not Sprite')
  assert.ok(result.matched.every((m) => m.matchType === 'exact' && m.score === 1), 'an exact match should be scored 1 and typed exact')
  console.log('PASS matchImagesToProducts: exact match attaches to every candidate sharing the name')
}

// -- Test 2: trailing-index-stripped exact match (a rename artifact or a
// re-exported "_2" filename should still key to the base product name). --
{
  const images = [img(1, 'coca cola_2.jpg')]
  const candidates = [{ id: 'a', name: 'Coca Cola' }]
  const result = matchImagesToProducts(images, candidates)
  assert.strictEqual(result.matched.length, 1, 'a trailing-index filename should still exact-match its base product name')
  assert.strictEqual(result.matched[0].matchType, 'exact')
  console.log('PASS matchImagesToProducts: trailing-index stripping still resolves to an exact match')
}

// -- Test 3: fuzzy fallback for a close-but-not-exact name, and no match
// at all for something too far off (stays unmatched, never guessed). --
{
  const images = [img(1, 'coca-cola-500ml.jpg'), img(2, 'totally-unrelated-thing.jpg')]
  const candidates = [{ id: 'a', name: 'Coca Cola' }]
  const result = matchImagesToProducts(images, candidates)
  assert.strictEqual(result.matched.length, 1, 'a close variant name should fuzzy-match')
  assert.strictEqual(result.matched[0].matchType, 'fuzzy')
  assert.strictEqual(result.matched[0].productId, 'a')
  assert.strictEqual(result.unmatched.length, 1, 'an unrelated filename should be left unmatched rather than force-matched')
  assert.strictEqual(result.unmatched[0].id, 2)
  console.log('PASS matchImagesToProducts: fuzzy match for close names, unmatched for unrelated ones')
}

// -- Test 4: over-limit grouping when more than MAX_IMAGES_PER_PRODUCT
// (3) images match the same product -- all candidates surfaced, winners
// are the top-`limit`-scoring ones. --
{
  const images = [1, 2, 3, 4, 5, 6].map((n) => img(n, `Blue Widget${n === 1 ? '' : ` (${n})`}.jpg`))
  const candidates = [{ id: 'w', name: 'Blue Widget' }]
  const result = matchImagesToProducts(images, candidates)
  assert.strictEqual(result.matched.length, 6, 'all 6 images should still match')
  assert.strictEqual(result.overLimit.length, 1, 'exceeding the 3-image cap should produce exactly one overLimit entry')
  const entry = result.overLimit[0]
  assert.strictEqual(entry.limit, 3)
  assert.strictEqual(entry.all.length, 6, 'overLimit.all should list every match, not just the winners')
  assert.strictEqual(entry.winners.length, 3, 'overLimit.winners should be capped at the limit')
  console.log('PASS matchImagesToProducts: over-limit grouping surfaces all candidates and caps winners at 3')
}

// -- Test 5: auto-rename plan -- single image per product gets the bare
// product name; multiple get _1/_2/... in score-descending order. --
{
  const entries = [
    { image: img(1, 'a.jpg'), productId: 'p1', productName: 'Red Shirt', score: 1, matchType: 'exact' },
  ]
  const singlePlan = buildAutoRenamePlan(entries)
  assert.strictEqual(singlePlan.get(1), 'Red Shirt.jpg', 'a single matched image should be renamed to just the product name, no suffix')

  const multiEntries = [
    { image: img(2, 'b.png'), productId: 'p2', productName: 'Blue Shirt', score: 0.6, matchType: 'fuzzy' },
    { image: img(3, 'c.png'), productId: 'p2', productName: 'Blue Shirt', score: 0.95, matchType: 'fuzzy' },
  ]
  const multiPlan = buildAutoRenamePlan(multiEntries)
  assert.strictEqual(multiPlan.get(3), 'Blue Shirt_1.png', 'the highest-scoring match should be numbered _1')
  assert.strictEqual(multiPlan.get(2), 'Blue Shirt_2.png', 'the lower-scoring match should be numbered _2')
  console.log('PASS buildAutoRenamePlan: single match gets bare name, multiple get score-ordered _1/_2 suffixes')
}

// -- Test 6: sanitization strips unsafe filename characters and caps length. --
{
  const name = buildImageDisplayName('Weird/Name:*?"<>|Product', 'orig.PNG', 1, 1)
  assert.ok(!/[<>:"/\\|?*]/.test(name), 'unsafe filename characters must be stripped from the display name')
  assert.ok(name.endsWith('.png'), 'the original file extension (lowercased) should be preserved')
  console.log('PASS buildImageDisplayName: strips unsafe characters, preserves extension')
}

// -- Test: sanitizeBaseName substitutes '-' for disallowed characters,
// not a plain space (Part 242 -- the user asked for a visible substitute
// character, since a slash or colon in a product name can't survive in a
// real filename either way). --
{
  assert.strictEqual(sanitizeBaseName('10/20ml'), '10-20ml', 'a single disallowed character becomes a single hyphen')
  assert.strictEqual(sanitizeBaseName('Weird / Name: Test*?'), 'Weird-Name-Test', 'runs of disallowed characters (and any spaces touching them) collapse to one hyphen, with edges trimmed')
  assert.strictEqual(sanitizeBaseName('Coca-Cola'), 'Coca-Cola', 'a hyphen the product name already had on purpose is left alone')
  console.log('PASS sanitizeBaseName: disallowed characters become \'-\', not a space')
}

assert.strictEqual(normalizeImageMatchKey('Coca-Cola.JPG'), 'coca cola', 'hyphen is folded into a space for matching purposes (Part 242), same as underscore')
assert.strictEqual(normalizeImageMatchKey(''), '')
// Underscore <-> space equivalence (the fix this session made real --
// BulkImportModal.tsx's image-matching-rules panel has always told the
// person these are equivalent, but the normalization didn't actually
// fold underscores into spaces before this, so it only "worked" for
// short names close enough to pass the fuzzy fallback's similarity
// threshold, not as a guaranteed exact match).
assert.strictEqual(normalizeImageMatchKey('Product_Name.jpg'), 'product name', 'underscore should be treated as equivalent to a space')
assert.strictEqual(normalizeImageMatchKey('Product_Name.jpg'), normalizeImageMatchKey('Product Name.jpg'), 'an underscored filename and a spaced filename for the same name should normalize identically')
console.log('PASS normalizeImageMatchKey: basic normalization sanity check')

// -- Test: a hyphenated re-import (the file having gone through
// sanitizeBaseName's '/' -> '-' substitution on a prior export, or simply
// hand-renamed with hyphens by the person) should match a product name
// that still has the original special character, exactly the same
// guarantee the underscore fix already gives "product_name_1.jpg". Also
// exercises the "candidate name with a literal '/' must not be truncated
// as if it were a folder path" fix (see normalizeImageMatchKey's own
// comment) -- "Men/Women Fragrance" used to silently become just "Women
// Fragrance" before this fix. --
{
  const images = [img(1, 'Men-Women-Fragrance_1.jpg'), img(2, 'Men-Women-Fragrance_2.jpg')]
  const candidates = [{ id: 'p1', name: 'Men/Women Fragrance' }]
  const result = matchImagesToProducts(images, candidates)
  assert.strictEqual(result.matched.length, 2, 'both hyphenated, indexed images should match the same product')
  assert.ok(result.matched.every((m) => m.matchType === 'exact' && m.score === 1), 'hyphen-for-special-character filenames should hit the exact-match pass, not just fuzzy')
  console.log('PASS matchImagesToProducts: hyphen-as-space filenames (from a special character in the product name) exact-match the product name, and the product name itself is not truncated at its own \'/\'')
}

// -- Test: a multi-word product name uploaded with underscores throughout
// (the "product_name_1.jpg" convention) should now hit the exact-match
// pass, not just squeak by on fuzzy similarity. --
{
  const images = [img(1, 'Abercrombie_Authentic_10ml_1.jpg'), img(2, 'Abercrombie_Authentic_10ml_2.jpg')]
  const candidates = [{ id: 'p1', name: 'Abercrombie Authentic 10ml' }]
  const result = matchImagesToProducts(images, candidates)
  assert.strictEqual(result.matched.length, 2, 'both underscored, indexed images should match the same product')
  assert.ok(result.matched.every((m) => m.matchType === 'exact' && m.score === 1), 'underscore-for-space filenames should hit the exact-match pass, not just fuzzy')
  console.log('PASS matchImagesToProducts: underscore-as-space filenames with trailing _1/_2 index exact-match the product name')
}

console.log('\nAll importImageMatch.ts tests passed.')
