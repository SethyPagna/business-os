import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildProductBranchStockAdjustments,
  recordedRemovalReplay,
  recordedTransferReplay,
} from '../src/components/products/helpers/productWriteHelpers.ts'

// REVERT-SET (owner, 6 Oct 2026: "Revert should fully revert, never leaves a
// stock effect behind"). The Products page's own History entries (edit, bulk
// update, price adjustment, Set out of stock, Change branch) used to Undo by
// putting every branch back to the snapshot's figure: snapshot - current. A
// sale between the action and its Undo was added back as stock; a delivery in
// between was taken away. Undo/Redo now replays exactly what the action moved.

type Branches = Record<number, number>
const apply = (stock: Branches, writes: Array<{ branchId: number; type: 'add' | 'remove'; quantity: number }>): Branches => {
  const next = { ...stock }
  for (const write of writes) next[write.branchId] = (next[write.branchId] || 0) + (write.type === 'add' ? write.quantity : -write.quantity)
  return next
}
const rows = (stock: Branches) => Object.entries(stock).map(([branch_id, quantity]) => ({ branch_id: Number(branch_id), quantity }))

// --- Set out of stock: 10 at branch 1 removed; a delivery of 5 arrives; Undo.
const removed = [{ productId: 7, branchId: 1, quantity: 10 }]
const afterDelivery: Branches = { 1: 5 }
const undoWrites = recordedRemovalReplay(removed, 'undo')
assert.deepEqual(undoWrites, [{ productId: 7, branchId: 1, quantity: 10, type: 'add' }])
assert.deepEqual(apply(afterDelivery, undoWrites), { 1: 15 }, 'the 10 come back and the delivery stays')
// The plausible wrong implementation (the old one) would read 10 and lose the delivery.
const snapshotWay = buildProductBranchStockAdjustments({ branch_stock: rows({ 1: 10 }) }, { branch_stock: rows(afterDelivery) })
assert.deepEqual(apply(afterDelivery, snapshotWay.map((a) => ({ branchId: Number(a.branchId), type: a.type as 'add' | 'remove', quantity: Number(a.quantity) }))), { 1: 10 },
  'control: snapshot - current erases the delivery -- the defect this replaces')
// Redo takes exactly the 10 again, not "whatever is there now".
assert.deepEqual(apply({ 1: 15 }, recordedRemovalReplay(removed, 'redo')), { 1: 5 })
assert.deepEqual(recordedRemovalReplay([{ productId: 7, branchId: 1, quantity: 0 }, { productId: 0, branchId: 1, quantity: 3 }], 'undo'), [], 'nothing recorded, nothing replayed')

// --- Change branch: 8 moved 1 -> 2; Undo moves exactly 8 back as a transfer; Redo moves 8 again.
const moved = [{ productId: 7, fromBranchId: 1, toBranchId: 2, quantity: 8 }]
assert.deepEqual(recordedTransferReplay(moved, 'undo'), [{ productId: 7, fromBranchId: 2, toBranchId: 1, quantity: 8 }])
assert.deepEqual(recordedTransferReplay(moved, 'redo'), moved)

// --- Wiring: field-only restores never touch stock; stock actions replay their record.
const products = readFileSync(new URL('../src/components/products/Products.tsx', import.meta.url), 'utf8')
const restore = products.slice(products.indexOf('const restoreProductSnapshots = useCallback'), products.indexOf('const replayRecordedRemovals = useCallback'))
assert.ok(restore.length > 0 && !/restoreProductBranchStock|adjustStock|transferStock/.test(restore), 'edit / bulk / price Undo restores fields only')
assert.match(products, /undo: \(\) => replayRecordedRemovals\(recorded, 'undo', 'Undo out-of-stock action'\)/)
assert.match(products, /redo: \(\) => replayRecordedRemovals\(recorded, 'redo', 'Redo out-of-stock action'\)/)
assert.match(products, /undo: \(\) => replayRecordedTransfers\(transfers, 'undo', 'Undo branch move'\)/)
assert.match(products, /redo: \(\) => replayRecordedTransfers\(transfers, 'redo', 'Redo bulk branch change'\)/)
assert.doesNotMatch(products, /restoreProductSnapshots\([^)]*'Undo (out-of-stock action|branch move)'/, 'no stock action undoes through a snapshot')

console.log('productHistoryStockReplay.test: OK')
