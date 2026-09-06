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

check('the merge carries the highest selling and WHOLESALE prices onto the keeper', () => {
  assert.ok(/resolveMergedPricing\(\[canonicalBefore \|\| \{\}, dupPricing \|\| \{\}\]\)/.test(mergeBlock), 'price resolution must compare both rows')
  assert.ok(/selling_price_usd = @sellingUsd/.test(mergeBlock), 'highest USD selling price must be written to the keeper')
  // The discounted tier lives in wholesale_price_* since migration 0111.
  // While this path still named special_price_* the merge resolved max(0, 0)
  // and the folded-away duplicate's wholesale price left the catalogue with
  // its row -- silently, with no error and no failing test anywhere.
  assert.ok(/wholesale_price_usd = @wholesaleUsd/.test(mergeBlock), 'highest USD wholesale price must be written to the keeper')
  assert.ok(/wholesale_price_khr = @wholesaleKhr/.test(mergeBlock), 'and the KHR half of the same tier')
  assert.ok(!/special_price_(usd|khr) = @/.test(mergeBlock), 'the retired special_price_* pair must never be written by a merge again')
  assert.ok(/wholesale_price_usd, wholesale_price_khr/.test(mergeBlock), 'both pricing SELECTs must read the wholesale columns, not the zeroed pair')
  assert.ok(/keeperPricingBefore:/.test(routeSrc), 'the keeper price before-image must be captured so undo is exact')
})

check('the audit entry reports what was moved, including images', () => {
  const auditBlock = routeSrc.slice(mergeEnd, mergeEnd + 2000)
  assert.ok(/batchesMoved:/.test(auditBlock))
  assert.ok(/imagesMoved:/.test(auditBlock), 'a merge that moved imagery must say so rather than doing it invisibly')
  assert.ok(/stockDisposition,/.test(auditBlock), 'the audit must say WHICH answer was given for the discarded row\'s stock')
  assert.ok(/priceChanges: priceChangesForAudit/.test(auditBlock),
    'a merge adopts the higher selling/special price, so a price it moved must be recorded, not applied invisibly')
  assert.ok(/returnsReparented,/.test(auditBlock))
})

check('the merge carries the discarded row\'s RETURNS, not just its sales', () => {
  // The gap this check exists for: return_items.product_id kept pointing at a
  // row the merge had just deactivated, so a refund of a merged-away twin
  // dropped out of the survivor's history entirely.
  const appliersSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'undoAppliers.ts'), 'utf8')
  const listStart = appliersSrc.indexOf('export const MERGE_REPARENT_TABLES')
  assert.ok(listStart > 0, 'the shared reparent list not found -- update this test')
  const list = appliersSrc.slice(listStart, appliersSrc.indexOf(']', listStart))
  for (const table of [
    'sale_items', 'return_items', 'return_replacement_items', 'inventory_movements',
    'damaged_stock_lots', 'stock_transfers', 'rfid_tags', 'rfid_events', 'rfid_session_items', 'promotions',
  ]) {
    assert.ok(new RegExp(`table: '${table}'`).test(list), `${table} must be relinked onto the survivor, never orphaned`)
  }
  assert.ok(/for \(const \{ table, column \} of MERGE_REPARENT_TABLES\)/.test(mergeBlock),
    'the fold must walk the ONE shared list, so a table added there is moved without a second edit here')
  assert.ok(/reparentedByTable,/.test(routeSrc), 'undo cannot put back a link the reversal never recorded')
})

check('the merge carries the links that are NOT integer product FKs', () => {
  // The walk above can only see INTEGER columns named *product_id, and the
  // migration sweep that keeps its list honest sweeps for exactly that shape.
  // Two live links have neither shape, and both were being orphaned:
  //   * promotion_rules.product_ids -- a JSON id ARRAY in a TEXT column.
  //     ruleAppliesToProduct does product_ids.includes(product.id), so a rule
  //     scoped to the discarded row stopped applying to anything at all the
  //     moment the fold deactivated it: the discount left the catalogue.
  //   * products.parent_id -- a product FK not named *product_id, on products
  //     itself. A child variant was left rooted on the deactivated parent.
  assert.ok(/SELECT id, product_ids FROM promotion_rules/.test(mergeBlock),
    'the fold must read the promotion scopes it might have to rewrite')
  assert.ok(/UPDATE promotion_rules SET product_ids = @ids/.test(mergeBlock),
    'a promotion rule scoped to the discarded row must follow it onto the survivor')
  assert.ok(/promotionRulesBefore\.push\(/.test(mergeBlock) && /promotionRulesBefore,/.test(routeSrc),
    'undo must be able to restore the scope list exactly, so the previous array is recorded')
  assert.ok(/UPDATE products SET parent_id = @canonicalId/.test(mergeBlock),
    'children of the discarded row must be reparented onto the survivor')
  assert.ok(/id != @canonicalId/.test(mergeBlock),
    'and the keeper must never be made its own parent')
  assert.ok(/reparentedChildProductIds,/.test(routeSrc), 'undo must be able to put the children back')
  const appliersSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'undoAppliers.ts'), 'utf8')
  assert.ok(/UPDATE promotion_rules SET product_ids = @ids/.test(appliersSrc),
    'the undo applier must restore the scope list, not merely record it')
  assert.ok(/UPDATE products SET parent_id = @dupId/.test(appliersSrc),
    'the undo applier must put the children back on the discarded row')
})

check('a WRITE-OFF zeroes the lots in place and leaves a balancing ledger line', () => {
  assert.ok(/const writeOffStock = stockDisposition === 'write_off'/.test(mergeBlock))
  assert.ok(/quantity: -qty,/.test(mergeBlock), 'the write-off must post a NEGATIVE movement, not just delete stock')
  assert.ok(/reason: writeOffReason\(dup, mergeContext\)/.test(mergeBlock), 'the ledger line must say why the stock left')
  assert.ok(/DELETE FROM branch_batch_stock WHERE batch_id = @id/.test(mergeBlock), 'the written-off lots must be emptied')
  assert.ok(/writtenOffBatches\.push\(/.test(mergeBlock), 'undo must be able to bring the written-off lots back')
  // The RECON lots in production stored TEXT in this INTEGER column; the
  // write-off path must not add to that, so it writes no batch_number at all.
  const writeOffBlock = mergeBlock.slice(mergeBlock.indexOf('if (writeOffStock) {', mergeBlock.indexOf('for (const batchRow of dupBatchRows)')))
  const writeOffBody = writeOffBlock.slice(0, writeOffBlock.indexOf('continue'))
  assert.ok(!/batch_number\s*=\s*@/.test(writeOffBody),
    'the write-off path must never write batch_number -- production already carries TEXT values in that INTEGER column')
  assert.ok(/batchNumber: batchRow\.batch_number == null \? null : Number\(batchRow\.batch_number\)/.test(writeOffBody),
    'the batch number it merely REPORTS must still be coerced to a number, so a legacy TEXT lot is not echoed back as text')
  assert.ok(/batchNumber: nextCanonicalBatchNumber/.test(mergeBlock),
    'the merge path must renumber from its own integer counter, never copy a possibly-TEXT value across')
})

check('both merge endpoints route through the ONE shared fold helper -- they can never drift', () => {
  const groupLoopAt = routeSrc.indexOf('for (const dup of group.duplicates)')
  assert.ok(groupLoopAt > 0, 'whole-catalog merge loop not found')
  // The bulk path destructures the fold's return ({ reversal, and since S4-32
  // costOutliers }) to record one composite undo for the whole run -- and since
  // N15 it may REFUSE a pair before folding it at all (an un-averageable cost
  // pair; a stock-in session that can still be undone). So the loop BODY is
  // searched for the fold call rather than the fold being pinned to the loop's
  // first statement, and the refusal is required to come first.
  const bulkLoop = routeSrc.slice(groupLoopAt, routeSrc.indexOf('mergedProductsCount += 1', groupLoopAt))
  assert.ok(/const \{ reversal(?:, [A-Za-z]+)* \} = await foldDuplicateProductInto\(/.test(bulkLoop),
    'POST /merge-duplicates must fold via the shared helper')
  assert.ok(bulkLoop.indexOf('refusals.push(') > 0 && bulkLoop.indexOf('refusals.push(') < bulkLoop.indexOf('await foldDuplicateProductInto('),
    'a refused pair must be skipped BEFORE the fold, never reported after the write')
  const pairRouteAt = routeSrc.indexOf("app.post('/possible-duplicates/merge'")
  assert.ok(pairRouteAt > 0, 'the one-pair review merge route must exist')
  assert.ok(routeSrc.indexOf('foldDuplicateProductInto(', pairRouteAt) > pairRouteAt, 'POST /possible-duplicates/merge must fold via the shared helper')
})

check('the review merge refuses inactive or group rows and recomputes the keeper stock cache', () => {
  const pairRouteAt = routeSrc.indexOf("app.post('/possible-duplicates/merge'")
  // Wide enough to reach past the two N15 refusals (an un-averageable cost
  // pair, a still-reversible stock session) that now run before the fold.
  const pairBlock = routeSrc.slice(pairRouteAt, pairRouteAt + 8000)
  assert.ok(/Both products must be active/.test(pairBlock), 'merging an already-merged row must 409, not double-fold')
  assert.ok(/is_group \|\| dup\.is_group/.test(pairBlock), 'group rows must be refused')
  assert.ok(/SET stock_quantity = \(SELECT COALESCE\(SUM\(quantity\), 0\) FROM branch_stock/.test(pairBlock), 'the keeper\'s denormalized stock cache must be recomputed after the fold')
})

console.log(`\n${passed} check(s) passed.`)
if (process.exitCode) console.log('SOME CHECKS FAILED')
