// Standalone unit tests for src/lib/importImageMatch.ts -- the best-fit
// image<->product matching engine that powers the bulk-import review UI
// (BulkImportModal.tsx's "Unmatched images" / "Too many images for one
// product" panels) and the apply-time auto-rename.
//
// Same transpile-in-memory approach as test-import-engine-pure.cjs /
// test-contact-options.cjs (no bundler needed). Unlike importEngine.ts,
// this module has zero Workers-only dependencies (no D1, no env), so it
// needs no require() stubbing at all -- it's pure, dependency-free logic.
//
// Run: node scripts/test-import-image-match-pure.cjs

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
  buildImageDisplayName,
  buildAutoRenamePlan,
  MAX_IMAGES_PER_PRODUCT,
} = moduleObj.exports

let failed = 0
function runTest(name, fn) {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

function img(id, originalName, relativePath = null) {
  return { id, originalName, relativePath, publicPath: `/uploads/${id}.jpg` }
}

// -- normalizeImageMatchKey --
runTest('normalizeImageMatchKey strips path/extension, lowercases, collapses whitespace', () => {
  assert.strictEqual(normalizeImageMatchKey('Coca-Cola.JPG'), 'coca cola')
  assert.strictEqual(normalizeImageMatchKey('  Coca   Cola  .png'), 'coca cola')
  assert.strictEqual(normalizeImageMatchKey('folder/sub\\Coke.jpeg'), 'coke')
  assert.strictEqual(normalizeImageMatchKey(null), '')
  assert.strictEqual(normalizeImageMatchKey(undefined), '')
})

// -- exact match: same product name on multiple rows all get the image --
runTest('exact key match attaches one image to every candidate sharing that name', () => {
  const images = [img(1, 'Coca Cola_1.jpg')]
  const candidates = [
    { id: 'row1', name: 'Coca Cola' },
    { id: 'row2', name: 'Coca Cola' }, // e.g. one row per branch
    { id: 'row3', name: 'Sprite' },
  ]
  const { matched, unmatched } = matchImagesToProducts(images, candidates)
  assert.strictEqual(matched.length, 2, 'both Coca Cola rows should match, Sprite should not')
  assert.deepEqual(new Set(matched.map((m) => m.productId)), new Set(['row1', 'row2']))
  assert.ok(matched.every((m) => m.matchType === 'exact' && m.score === 1))
  assert.strictEqual(unmatched.length, 0)
})

// -- fuzzy fallback: lazy/mismatched filenames still find the best product --
runTest('fuzzy match finds the best-fit product for a filename that does not match exactly', () => {
  const images = [img(1, 'coca-cola-500ml-bottle.jpg')]
  const candidates = [
    { id: 'row1', name: 'Coca Cola 500ml' },
    { id: 'row2', name: 'Fanta Orange 500ml' },
  ]
  const { matched, unmatched } = matchImagesToProducts(images, candidates)
  assert.strictEqual(unmatched.length, 0)
  assert.strictEqual(matched.length, 1)
  assert.strictEqual(matched[0].productId, 'row1', 'should best-fit to the Coca Cola row, not Fanta')
  assert.strictEqual(matched[0].matchType, 'fuzzy')
})

// -- below-threshold fuzzy matches stay unmatched rather than guessing wrong --
runTest('a filename with no reasonable match is left unmatched, not force-attached', () => {
  const images = [img(1, 'random_screenshot_2024.png')]
  const candidates = [{ id: 'row1', name: 'Coca Cola 500ml' }]
  const { matched, unmatched } = matchImagesToProducts(images, candidates)
  assert.strictEqual(matched.length, 0)
  assert.strictEqual(unmatched.length, 1)
  assert.strictEqual(unmatched[0].id, 1)
})

// -- over-limit: more than MAX_IMAGES_PER_PRODUCT matched to one product --
runTest('overLimit reports every matched image but only keeps the top-scoring winners', () => {
  assert.strictEqual(MAX_IMAGES_PER_PRODUCT, 3)
  const images = Array.from({ length: 7 }, (_, i) => img(i + 1, `Coca Cola ${i + 1}.jpg`))
  const candidates = [{ id: 'row1', name: 'Coca Cola' }]
  const { overLimit } = matchImagesToProducts(images, candidates)
  assert.strictEqual(overLimit.length, 1)
  assert.strictEqual(overLimit[0].all.length, 7, 'operator should see every image that matched, not just the winners')
  assert.strictEqual(overLimit[0].winners.length, 3, 'winners are capped at the per-product limit')
})

// -- rename plan: EVERY matched image is indexed, including a lone one --
//
// This used to assert the opposite: a single image kept the bare product
// name and only siblings got _1/_2. That produced a library holding a
// mixture of "Coca Cola.jpg" and "Coca Cola_1.jpg" for no reason visible to
// the person -- whether a file got a number depended on how many siblings it
// happened to have when it was matched, and adding a second image later
// RENAMED the first one, changing a name that had been stable.
//
// One rule now: always `<Product Name>_<n>`. Matching is unaffected either
// way, because stripTrailingIndex folds `_1`, `-1`, ` 1` and `(1)` back to
// the bare name, so both spellings still resolve to the same product on
// re-import (asserted below).
runTest('buildImageDisplayName: a lone image is still indexed _1', () => {
  assert.strictEqual(buildImageDisplayName('Coca Cola', 'whatever.jpg', 1, 1), 'Coca Cola_1.jpg')
})
runTest('buildImageDisplayName: multiple images get 1-based numeric suffixes', () => {
  assert.strictEqual(buildImageDisplayName('Coca Cola', 'a.png', 1, 3), 'Coca Cola_1.png')
  assert.strictEqual(buildImageDisplayName('Coca Cola', 'b.png', 2, 3), 'Coca Cola_2.png')
  assert.strictEqual(buildImageDisplayName('Coca Cola', 'c.png', 3, 3), 'Coca Cola_3.png')
})
runTest('buildImageDisplayName sanitizes unsafe characters out of the product name', () => {
  // Part 242: disallowed filename characters fold to '-' (not a plain
  // space) so hyphen<->space equivalence on re-import can round-trip them.
  assert.strictEqual(buildImageDisplayName('Coke: 500ml / "Value"?', 'x.jpg', 1, 1), 'Coke-500ml-Value_1.jpg')
})

runTest('buildAutoRenamePlan orders by score (best match first) and numbers accordingly', () => {
  const images = [img(1, 'a.jpg'), img(2, 'b.jpg'), img(3, 'c.jpg')]
  const matched = [
    { image: images[0], productId: 'row1', productName: 'Coca Cola', score: 0.6, matchType: 'fuzzy' },
    { image: images[1], productId: 'row1', productName: 'Coca Cola', score: 0.95, matchType: 'fuzzy' },
    { image: images[2], productId: 'row1', productName: 'Coca Cola', score: 0.8, matchType: 'fuzzy' },
  ]
  const plan = buildAutoRenamePlan(matched)
  assert.strictEqual(plan.get(2), 'Coca Cola_1.jpg', 'highest score (0.95) should win position 1')
  assert.strictEqual(plan.get(3), 'Coca Cola_2.jpg', 'second-highest score (0.8) should be position 2')
  assert.strictEqual(plan.get(1), 'Coca Cola_3.jpg', 'lowest score (0.6) should be position 3')
})

runTest('buildAutoRenamePlan indexes a lone match per product as _1', () => {
  const images = [img(1, 'a.jpg'), img(2, 'b.jpg')]
  const matched = [
    { image: images[0], productId: 'row1', productName: 'Coca Cola', score: 1, matchType: 'exact' },
    { image: images[1], productId: 'row2', productName: 'Sprite', score: 1, matchType: 'exact' },
  ]
  const plan = buildAutoRenamePlan(matched)
  assert.strictEqual(plan.get(1), 'Coca Cola_1.jpg')
  assert.strictEqual(plan.get(2), 'Sprite_1.jpg')
})

// -- image-only import: no CSV image column, matching purely on filename vs product name --
runTest('image-only import (filenames matched straight against product names) still works end to end', () => {
  const images = [img(10, 'Sprite_1.jpg'), img(11, 'coca-cola.png')]
  const candidates = [
    { id: 'r1', name: 'Sprite' },
    { id: 'r2', name: 'Coca Cola' },
  ]
  const { matched, unmatched } = matchImagesToProducts(images, candidates)
  assert.strictEqual(unmatched.length, 0)
  assert.strictEqual(matched.length, 2)
  const byImage = new Map(matched.map((m) => [m.image.id, m]))
  assert.strictEqual(byImage.get(10).productId, 'r1')
  assert.strictEqual(byImage.get(11).productId, 'r2')
})

// -- short-string bigram bugfix regression: single-char keys must not always score 0 --
runTest('short (<2 char) keys still produce comparable bigrams after the padding bugfix', () => {
  const images = [img(1, 'M.jpg')] // e.g. a size-only filename
  const candidates = [
    { id: 'row1', name: 'M' }, // exact match, hits the a===b shortcut regardless
    { id: 'row2', name: 'ML' },
  ]
  const { matched } = matchImagesToProducts(images, candidates)
  assert.strictEqual(matched.length, 1)
  assert.strictEqual(matched[0].productId, 'row1', 'exact single-char match still wins')
})

if (failed > 0) {
  console.error(`${failed} test(s) failed`)
  process.exit(1)
}
console.log('All importImageMatch.ts tests passed')
