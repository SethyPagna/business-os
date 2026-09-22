// Source lock-in: merging a duplicate product must carry EVERYTHING it owns
// onto the canonical row, not just the parts someone remembered.
//
// /api/products/merge-duplicates already moved branch_stock, wrote
// inventory_movements, and either re-pointed or folded product_batches --
// but it never touched product_images or image_path. The duplicate was then
// deactivated, so any photo it carried that the canonical did not simply
// disappeared from the catalog. Silent, irreversible, and a direct breach of
// the standing rule that images follow a product through a rename or regroup.
//
// This is a source-level check because the merge is a long sequence of
// statements inside a route handler batched against D1; asserting on the
// generated statement set is what actually pins "nothing was forgotten".
// Each assertion names the table so a future edit that drops one fails here
// with the reason rather than shipping quietly.
//
// Run: node scripts/test-merge-duplicates-carries-all-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'products.ts'), 'utf8')

// The whole per-duplicate fold now lives in the shared helper
// foldDuplicateProductInto (used by both POST /merge-duplicates and
// POST /possible-duplicates/merge), so the assertions scope to the helper
// body up to its audit call. Scoping keeps them from being satisfied by an
// unrelated mention of the same table elsewhere in this large file.
const mergeStart = routeSrc.indexOf('async function foldDuplicateProductInto')
assert.ok(mergeStart > 0, 'foldDuplicateProductInto not found -- update this test')
const mergeEnd = routeSrc.indexOf("'merge_duplicate'", mergeStart)
assert.ok(mergeEnd > mergeStart, 'merge audit call not found -- update this test')
const mergeBlock = routeSrc.slice(mergeStart, mergeEnd)

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

check('the merge carries branch_stock onto the canonical row', () => {
  assert.ok(/INSERT INTO branch_stock[\s\S]*?ON CONFLICT\(product_id, branch_id\) DO UPDATE SET quantity = quantity \+ excluded\.quantity/.test(mergeBlock))
  assert.ok(/DELETE FROM branch_stock WHERE product_id = @id/.test(mergeBlock), 'the duplicate\'s own branch_stock must be cleared')
})

check('the merge records inventory_movements for the transferred quantity', () => {
  assert.ok(/INSERT INTO inventory_movements/.test(mergeBlock))
})

check('the merge re-points or folds product_batches', () => {
  assert.ok(/UPDATE product_batches SET variant_product_id = @canonicalId/.test(mergeBlock), 'non-colliding batches must move to the canonical product')
  assert.ok(/INSERT INTO branch_batch_stock[\s\S]*?quantity = quantity \+ excluded\.quantity/.test(mergeBlock), 'colliding batches must fold their per-branch stock in')
})

check('the merge carries product_images onto the canonical row (the bug this test exists for)', () => {
  assert.ok(
    /INSERT INTO product_images \(product_id, image_path, sort_order\) VALUES \(@canonicalId/.test(mergeBlock),
    'the duplicate\'s gallery images must be moved to the canonical product, not orphaned on a deactivated row',
  )
  assert.ok(
    /DELETE FROM product_images WHERE product_id = @id/.test(mergeBlock),
    'the duplicate\'s own gallery rows must be cleared once moved',
  )
})

check('the merge lets the canonical adopt the duplicate primary image only when it has none', () => {
  assert.ok(
    /UPDATE products SET image_path = COALESCE\(NULLIF\(image_path, ''\), @dupImagePath\)/.test(mergeBlock),
    'a merge may only ever ADD imagery -- never replace the canonical\'s existing primary image',
  )
})

check('moved images are deduped by path rather than blindly copied', () => {
  assert.ok(/canonicalImagePaths\.has\(imagePath\)/.test(mergeBlock), 'two duplicates of one product commonly reference the same stored object')
})

check('the merge deactivates the duplicate only after everything is carried over', () => {
  const deactivateAt = mergeBlock.indexOf("UPDATE products SET is_active = 0")
  const imagesAt = mergeBlock.indexOf('INSERT INTO product_images')
  assert.ok(deactivateAt > 0, 'the duplicate must end up deactivated')
  assert.ok(imagesAt > 0 && imagesAt < deactivateAt, 'images must be moved before the duplicate is deactivated')
})

check('the merge carries the highest selling and special prices onto the keeper', () => {
  assert.ok(/resolveMergedPricing\(\[canonicalBefore \|\| \{\}, dupPricing \|\| \{\}\]\)/.test(mergeBlock), 'price resolution must compare both rows')
  assert.ok(/selling_price_usd = @sellingUsd/.test(mergeBlock), 'highest USD selling price must be written to the keeper')
  assert.ok(/special_price_usd = @specialUsd/.test(mergeBlock), 'highest USD special price must be written to the keeper')
  assert.ok(/keeperPricingBefore:/.test(routeSrc), 'the keeper price before-image must be captured so undo is exact')
})

check('the audit entry reports what was moved, including images', () => {
  const auditBlock = routeSrc.slice(mergeEnd, mergeEnd + 700)
  assert.ok(/batchesMoved:/.test(auditBlock))
  assert.ok(/imagesMoved:/.test(auditBlock), 'a merge that moved imagery must say so rather than doing it invisibly')
})

check('both merge endpoints route through the ONE shared fold helper -- they can never drift', () => {
  const groupLoopAt = routeSrc.indexOf('for (const dup of group.duplicates)')
  assert.ok(groupLoopAt > 0, 'whole-catalog merge loop not found')
  // The bulk path now destructures the fold's return ({ reversal }) to record
  // one composite undo for the whole run, so allow that optional prefix.
  assert.ok(/for \(const dup of group\.duplicates\) \{\s*\n\s*(?:const \{ reversal \} = )?await foldDuplicateProductInto\(/.test(routeSrc), 'POST /merge-duplicates must fold via the shared helper')
  const pairRouteAt = routeSrc.indexOf("app.post('/possible-duplicates/merge'")
  assert.ok(pairRouteAt > 0, 'the one-pair review merge route must exist')
  assert.ok(routeSrc.indexOf('foldDuplicateProductInto(', pairRouteAt) > pairRouteAt, 'POST /possible-duplicates/merge must fold via the shared helper')
})

check('the review merge refuses inactive or group rows and recomputes the keeper stock cache', () => {
  const pairRouteAt = routeSrc.indexOf("app.post('/possible-duplicates/merge'")
  const pairBlock = routeSrc.slice(pairRouteAt, pairRouteAt + 4000)
  assert.ok(/Both products must be active/.test(pairBlock), 'merging an already-merged row must 409, not double-fold')
  assert.ok(/is_group \|\| dup\.is_group/.test(pairBlock), 'group rows must be refused')
  assert.ok(/SET stock_quantity = \(SELECT COALESCE\(SUM\(quantity\), 0\) FROM branch_stock/.test(pairBlock), 'the keeper\'s denormalized stock cache must be recomputed after the fold')
})

console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
