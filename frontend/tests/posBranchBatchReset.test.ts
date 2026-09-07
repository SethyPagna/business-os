import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (relative: string): string => readFileSync(new URL(relative, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const cartItem = read('../src/components/pos/CartItem.tsx')
const pos = read('../src/components/pos/POS.tsx')

let failed = 0
function test(name: string, fn: () => void): void {
  try {
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${name}`)
    console.error(error)
  }
}

test('the cart branch selector shows Warehouse but disables every non-selling branch', () => {
  assert.match(cartItem, /\.\.\.branches\.map\(\(branch\) => \(\{[^]*?label: `\$\{branch\.name\}[^]*?disabled: !branchCanSell\(branch\.name\)/)
  assert.match(cartItem, /import \{ branchCanSell \} from '\.\.\/\.\.\/utils\/branchRoles\.ts'/)
})

test('the branch handler rejects non-selling targets even if invoked outside the selector', () => {
  assert.match(pos, /const targetBranch = nextBranchId == null \? null : branchesById\.get\(nextBranchId\)/)
  assert.match(pos, /if \(!targetBranch \|\| !branchCanSell\(targetBranch\.name\)\) \{[^]*?pos_warehouse_not_sellable[^]*?return\n    \}/)
})

test('a batch-tracked line revalidates the same batch by product and target branch before changing', () => {
  assert.match(pos, /getProductBatches\(Number\(product\.id\), targetBranchId, true\)/)
  assert.match(pos, /response\.batches\.find\(\(batch\) => Number\(batch\.id\) === Number\(currentItem\.batch_id\)\)/)
  assert.match(pos, /Number\(targetBatch\.quantity \|\| 0\) < currentItem\.quantity/)
  assert.match(pos, /Number\(currentItem\.batch_id \|\| 0\) !== Number\(item\.batch_id\)/)
  assert.match(pos, /currentItem\.branch_id == null \? null : Number\(currentItem\.branch_id\)\) !== originalBranchId/)
  assert.match(pos, /branchBatchValidationRef\.current\.get\(requestKey\) !== requestId/)
})

test('a failed or stale batch validation cannot mutate the branch or retain partial metadata', () => {
  const batchBlock = pos.slice(pos.indexOf('if (item.batch_id)'), pos.indexOf('// A plain line has no batch identity'))
  assert.match(batchBlock, /if \(!targetBatch [^]*?notify\([^]*?return/)
  assert.match(batchBlock, /catch \(error\) \{[^]*?notify\(getErrorMessage\(error\), 'error'\)[^]*?\}\n      return/)
  assert.match(batchBlock, /batch_id: targetBatch\.id/)
  assert.match(batchBlock, /batch_expiry_date: targetBatch\.expiry_date \?\? null/)
  assert.match(batchBlock, /batch_available_quantity: Number\(targetBatch\.quantity \|\| 0\)/)
})

test('plain branch changes clear every legacy batch display and quantity field', () => {
  assert.match(pos, /branch_id: targetBranchId, batch_id: null, batch_label: null, batch_expiry_date: null, batch_available_quantity: undefined/)
  assert.doesNotMatch(pos, /\? \{ \.\.\.entry, branch_id: nextBranchId \} : entry/)
})

if (failed) process.exit(1)
