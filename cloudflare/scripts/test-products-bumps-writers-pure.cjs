'use strict'
// D1 wave 2 (d1-writes): writers outside routes/products.ts that change what the product lists show must turn the 'products' cache version over, or the lists
// serve the old rows until their TTL. Pins the four sites closed here, each inside its own handler (a bump moved to another route is red):
//   - POST /api/inventory/dated-stock-count/resolve            when it creates a branch (a new branch_stock column on every product row)
//   - POST /api/inventory/dated-stock-count/resolve/apply-decisions   new products, or a price decision on an existing one
//   - PUT  /api/branches/:id                                   a branch rename/activate changes the branch list every product row carries
//   - the product-removal Undo/Redo applier (lib/undoAppliers.ts replayProductRemove); actionHistory's generic bump only moves 'stock'
// Run (from cloudflare/): node scripts/test-products-bumps-writers-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n')
const slice = (text, startMarker, endMarker) => {
  const a = text.indexOf(startMarker); assert.ok(a >= 0, `missing ${startMarker}`)
  const b = text.indexOf(endMarker, a + startMarker.length); assert.ok(b > a, `missing end ${endMarker}`)
  return text.slice(a, b)
}
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }
const inventory = read('src/routes/inventory.ts')

check('dated-stock-count/resolve bumps products when it creates a branch, and only then', () => {
  const handler = slice(inventory, "app.post('/dated-stock-count/resolve', async", "app.post('/dated-stock-count/resolve/apply-decisions'")
  const block = slice(handler, 'if (branchesCreated.length) {', 'return c.json({ success: true, resolved')
  assert.match(block, /bumpVersion\(c\.env, 'products'\)/)
  assert.equal([...handler.matchAll(/bumpVersion\(c\.env, 'products'\)/g)].length, 1)
})
check('apply-decisions bumps products for created products and for price decisions', () => {
  const handler = slice(inventory, "app.post('/dated-stock-count/resolve/apply-decisions', async", "app.post('/dated-stock-count/preview'")
  assert.match(handler, /if \(result\.productsCreated\.length \|\| decisionsIn\.length\) await bumpVersion\(c\.env, 'products'\)/)
})
check('PUT /api/branches/:id bumps products after a committed edit', () => {
  const branches = read('src/routes/branches.ts')
  const handler = slice(branches, "app.put('/:id', async", "app.delete('/:id', async")
  // W3 Slice A: the bump is awaited BEFORE the broadcast, so a peer that refetches on it never keys on the old version.
  assert.match(handler, /await bumpVersion\(c\.env, 'products'\)\n\s*c\.executionCtx\.waitUntil\(broadcast\(c\.env, 'branches', \{ action: 'update', id \}\)\)/)
})
check('the product-removal replay bumps products before it broadcasts', () => {
  const text = read('src/lib/undoAppliers.ts')
  const fn = slice(text, 'async function replayProductRemove(', '// branch.update records')
  const bump = fn.indexOf("bumpChange(ctx, ['products'])")
  const cast = fn.indexOf("await announceChange(ctx, 'products'")
  assert.ok(bump > 0 && cast > bump, 'bump precedes the broadcast')
})
console.log(`${passed} checks passed.`)
