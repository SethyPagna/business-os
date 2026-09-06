// BranchStockAdjuster.tsx was an UNMOUNTED per-product-row adjust form:
// commit 85294c21 (2026-09-01, in the deployed lineage) removed its last
// import from ProductForm.tsx, and every remaining mention in frontend/src
// was a comment. Two repairs then landed on it anyway (9bd6e938,
// 5809189b), running nowhere. This pins the cleanup:
//
//   1. the file, and its dedicated test, are actually gone;
//   2. nothing under frontend/src still names it, so it cannot be re-added
//      as a "just a copy of the old one" surface without this test noticing;
//   3. the two behaviours that file was repaired for -- (a) a SET that
//      RAISES a branch's stock states its supplier, and (b) the form
//      measures against the BRANCH being adjusted, not a page filter -- are
//      carried by the live surface every per-branch add/remove/set adjust
//      actually renders through: InventoryStockModals.tsx, reused verbatim
//      by both StockAdjustModal.tsx (Products page / Stock-changes ledger)
//      and Inventory.tsx (Inventory page).
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let failed = 0
function runTest(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(here, '..', '..')
const SRC = path.join(here, '..', 'src')
const DELETED_FILE = path.join(SRC, 'components', 'products', 'forms', 'BranchStockAdjuster.tsx')
const DELETED_TEST = path.join(here, 'branchStockAdjusterSetRaise.test.ts')
const THIS_FILE = path.join(here, 'branchStockAdjusterDeleted.test.ts')

function walk(dir: string, extensions: RegExp, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full, extensions, out); continue }
    if (extensions.test(entry.name)) out.push(full)
  }
  return out
}

runTest('BranchStockAdjuster.tsx no longer exists', () => {
  assert.equal(fs.existsSync(DELETED_FILE), false, 'the unmounted per-branch adjust form must stay deleted')
})

runTest('its dedicated (now-pointless) test no longer exists', () => {
  assert.equal(fs.existsSync(DELETED_TEST), false, 'a test for a deleted component must not linger')
})

runTest('no file in EITHER package still names BranchStockAdjuster (so it cannot come back as a silent copy)', () => {
  // A pin scoped to frontend/src alone is exactly why the leftover survived
  // round 1: two cloudflare/src comments and two cloudflare/scripts test
  // comments still named the deleted file after the frontend sweep called
  // itself done. The rule this test exists to enforce -- "grep the symbol
  // across both packages before and after" -- has to walk both packages
  // itself, not just the one the deletion happened to touch.
  const offenders: string[] = []
  for (const file of walk(SRC, /\.(ts|tsx)$/)) {
    if (file === THIS_FILE) continue
    const text = fs.readFileSync(file, 'utf8')
    if (text.includes('BranchStockAdjuster')) {
      offenders.push('frontend/src/' + path.relative(SRC, file).split(path.sep).join('/'))
    }
  }
  const cloudflareRoots = [
    path.join(REPO_ROOT, 'cloudflare', 'src'),
    path.join(REPO_ROOT, 'cloudflare', 'scripts'),
  ]
  for (const root of cloudflareRoots) {
    for (const file of walk(root, /\.(ts|cjs)$/)) {
      if (file === THIS_FILE) continue
      const text = fs.readFileSync(file, 'utf8')
      if (text.includes('BranchStockAdjuster')) {
        offenders.push(path.relative(REPO_ROOT, file).split(path.sep).join('/'))
      }
    }
  }
  assert.deepEqual(offenders, [], `these files still reference BranchStockAdjuster by name: ${offenders.join(', ')}`)
})

runTest('the live surface carries the ported branch-quantity rule (behaviour 1)', () => {
  const modals = fs.readFileSync(path.join(SRC, 'components', 'inventory', 'InventoryStockModals.tsx'), 'utf8')
  const stockAdjustModal = fs.readFileSync(path.join(SRC, 'components', 'products', 'forms', 'StockAdjustModal.tsx'), 'utf8')
  const inventoryPage = fs.readFileSync(path.join(SRC, 'components', 'inventory', 'Inventory.tsx'), 'utf8')
  // Every consumer resolves "what does this branch hold" through the ONE
  // shared function -- never the page's own branch filter or a stale copy.
  for (const [label, text] of [
    ['InventoryStockModals.tsx (isStockIn/isSetDown/showBatchPicker all read this prop)', modals],
    ['StockAdjustModal.tsx', stockAdjustModal],
    ['Inventory.tsx', inventoryPage],
  ] as const) {
    assert.ok(text.includes('adjustBranchQuantity') || text.includes('adjustCurrentQuantity'),
      `${label} must derive its current-quantity figure from the shared branch-scoped rule`)
  }
  assert.match(stockAdjustModal, /adjustBranchQuantity\(product\.branch_stock, adjustForm\.branch_id, stockQtyOf\(product\)\)/,
    'StockAdjustModal must resolve the ADJUSTED branch\'s own figure, not the product total')
})

runTest('the live surface carries the ported set-raise receipt rule (behaviour 2)', () => {
  const modals = fs.readFileSync(path.join(SRC, 'components', 'inventory', 'InventoryStockModals.tsx'), 'utf8')
  // The supplier and cost fields render on isStockIn -- exactly the predicate
  // the receipt gate applies -- not on a narrower "row.type === 'add'" copy
  // that would re-open the dead end a raising `set` used to hit.
  assert.match(modals, /const isStockIn = isStockInSubmission\(adjustForm\.type, adjustForm\.quantity, adjustCurrentQuantity\)/)
  assert.match(modals, /\{isStockIn \? \(\s*\n\s*<SupplierPickerField/, 'the supplier field must render on isStockIn, which covers a raising set')
  assert.ok(!modals.includes("adjustForm.type === 'add' && adjustForm.batch_id !== ''") , 'the supplier field must not be re-narrowed to adds only')
})

if (failed > 0) {
  process.exitCode = 1
  console.error(`\n${failed} branch-stock-adjuster-deleted test(s) failed`)
} else {
  console.log('\nAll branch-stock-adjuster-deleted tests passed')
}
