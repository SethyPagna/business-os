#!/usr/bin/env node
// The products cache version has to move for every write a cached products read depends on, and must NOT move for one it does not depend on.
//   1. Image upload (POST /api/products/upload-image) writes R2 and file_assets only: its handler carries no products bump. Every writer that attaches an image path to a product row bumps for itself
//      (listed below, each with the bump it relies on), so dropping the upload's bump hides nothing.
//   2. The groups of possible-duplicates are keyed on the products version alone (test-products-duplicates-cache-native.cjs), so every writer of a column a group is built from must announce it. The in-file paths that wrote and then returned without announcing
//      (a rename carried before the review queue, an identity write kept after a refused fold, a removal replayed after a lost acknowledgement, a merge that committed and threw) now bump.
//
// Run: node scripts/test-products-version-bumps-pure.cjs
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SRC = path.join(__dirname, '..', 'src')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
const PRODUCTS_BUMP = /bumpVersions?\([^)]*['"]products['"]/
const products = read('routes/products.ts')
const between = (text, from, to) => { const a = text.indexOf(from); assert.ok(a >= 0, `anchor ${from}`); const b = text.indexOf(to, a + from.length); return text.slice(a, b < 0 ? undefined : b) }

// 1. the upload handler and the control that the detector sees a bump where there is one
const upload = between(products, "app.post('/upload-image'", 'export default app')
assert.ok(!PRODUCTS_BUMP.test(upload), 'the upload handler does not advance the products version')
const wire = between(products, "app.post('/wire-images'", "app.post('/unwire-images'")
assert.ok(PRODUCTS_BUMP.test(wire), 'control: the wire-images handler (which attaches paths to products) bumps, and the detector sees it')

// every writer of a product's image path or gallery, with the file that carries its bump
const IMAGE_WRITERS = [
  ['routes/importJobs.ts', /INSERT INTO product_images/],
  ['routes/files.ts', /UPDATE products SET image_path = @to/],
  ['lib/importEngine.ts', /UPDATE products SET name=@name/],
  ['lib/stockSession.ts', /INSERT INTO product_images/],
  ['lib/undoAppliers.ts', /INSERT INTO product_images/],
  ['lib/productWrites.ts', /INSERT INTO product_images/],
]
for (const [file, writes] of IMAGE_WRITERS) {
  const text = read(file)
  assert.ok(writes.test(text), `${file} still writes a product image (update this list if it moved)`)
  const carriesBump = PRODUCTS_BUMP.test(text) || /notifyStockSession|invalidateCaches/.test(text)
  if (file === 'lib/productWrites.ts') assert.ok(!carriesBump, 'productWrites only builds the writes: its callers in routes/products.ts and lib/reviewApply.ts bump')
  else assert.ok(carriesBump, `${file} attaches images to products and bumps the products version itself`)
}
assert.ok(PRODUCTS_BUMP.test(read('lib/reviewApply.ts')), 'reviewApply (the other caller of the product writer) bumps')

// 2. the in-file paths that wrote without announcing
assert.ok(/if \(renamedProductIds\.length\) c\.executionCtx\.waitUntil\(bumpVersion\(c\.env, 'products'\)\)\n\s+return c\.json\(\{ success: true, pending: true, pendingActionId: pendingId \}, 202\)/.test(products), 'a group rename carried before the review queue is announced')
const identity = between(products, 'const identityRefusal = await identityFoldRefusal', 'let foldResult: Awaited')
assert.ok(PRODUCTS_BUMP.test(identity), 'the identity write kept before the fold is announced')
const removeReplay = between(products, "if (replay?.status === 'undo_ready' && replay.product_id === id", "return c.json({ success: false, code: 'review_state_conflict'")
assert.ok(PRODUCTS_BUMP.test(removeReplay), 'a removal replayed after a lost acknowledgement is announced')
const mergeThrow = between(products, 'if (applied) {', 'const errorId = crypto.randomUUID()')
assert.ok(PRODUCTS_BUMP.test(mergeThrow), 'a merge that committed and then threw is announced')

console.log('PASS image-upload bump removed with every attaching writer bumping; in-file writers announce')
