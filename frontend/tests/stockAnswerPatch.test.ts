import assert from 'node:assert/strict'
import { patchProductFromStockAnswer, patchProductFromStockConflict, stockConflictFigures, type StockWriteAnswer } from '../src/api/stockAnswerPatch.ts'

// INV-A S2 (Inventory replan 2.7): a Set's answer, or its stale-quantity refusal, patches the Products row. Nothing re-reads stock.

const row = () => ({
  id: 12, name: 'Serum', stock_quantity: 10,
  branch_stock: [{ branch_id: 1, branch_name: 'Shop', quantity: 8 }, { branch_id: 2, branch_name: 'Store', quantity: '2' }],
  lots: [
    { id: 100, received_at: '2026-09-02', branches: [{ branch_id: 1, quantity: 3 }] },
    { id: 101, received_at: '2026-09-09', branches: [{ branch_id: 1, quantity: 5 }, { branch_id: 2, quantity: 2 }] },
  ],
})
const answer = (patch: Partial<StockWriteAnswer> = {}): StockWriteAnswer => ({ productId: 12, branchId: 1, batchId: 100, before: { lotQuantity: 3, branchQuantity: 8 }, after: { lotQuantity: 1, branchQuantity: 6 }, ...patch })

// A successful Set: the branch entry, stock_quantity and the lot's branch figure move; everything else is the same object.
const before = row()
const done = patchProductFromStockAnswer(before, answer())
assert.equal(done.branch_stock[0].quantity, 6); assert.equal(done.branch_stock[0].branch_name, 'Shop', 'the entry keeps its other fields')
assert.equal(done.branch_stock[1], before.branch_stock[1], 'the other branch is the same object')
assert.equal(done.stock_quantity, 8, 'stock_quantity moved by exactly what the branch entry moved (10 - 2)')
assert.equal(done.lots[0].branches[0].quantity, 1); assert.equal(done.lots[1], before.lots[1], 'the other lot is the same object')
assert.equal(before.branch_stock[0].quantity, 8, 'the input row is not modified')
assert.equal(before.stock_quantity, 10)

// stock_quantity stays the sum of the branch entries even when the row was already stale against `before` (the patch is on the row's own figures).
const stale = { ...row(), branch_stock: [{ branch_id: 1, quantity: 9 }, { branch_id: 2, quantity: 2 }], stock_quantity: 11 }
const fixed = patchProductFromStockAnswer(stale, answer())
assert.equal(fixed.branch_stock[0].quantity, 6); assert.equal(fixed.stock_quantity, 8, '9 -> 6 moved it by 3 (11 - 3), the sum of 6 and 2')

// Strings from the wire: a quantity that came as text is read as a number and written as a number.
const text = patchProductFromStockAnswer(row(), answer({ branchId: 2, batchId: 101, after: { lotQuantity: 0, branchQuantity: 0 } }))
assert.equal(text.branch_stock[1].quantity, 0); assert.equal(text.stock_quantity, 8); assert.equal(text.lots[1].branches[1].quantity, 0)

// A lot with no row for the branch gains one when the Set puts units there; a Set to 0 adds nothing.
const landed = patchProductFromStockAnswer(row(), answer({ branchId: 2, batchId: 100, after: { lotQuantity: 4, branchQuantity: 6 } }))
assert.deepEqual(landed.lots[0].branches, [{ branch_id: 1, quantity: 3 }, { branch_id: 2, quantity: 4 }])
const none = patchProductFromStockAnswer(row(), answer({ branchId: 2, batchId: 100, after: { lotQuantity: 0, branchQuantity: 2 } }))
assert.deepEqual(none.lots[0].branches, [{ branch_id: 1, quantity: 3 }])

// Nothing to change: the same object comes back (a store can skip the render).
const unchanged = row()
assert.equal(patchProductFromStockAnswer(unchanged, answer({ after: { lotQuantity: 3, branchQuantity: 8 } })), unchanged)
assert.equal(patchProductFromStockAnswer(unchanged, answer({ productId: 99 })), unchanged, 'another product is not this row')
assert.equal(patchProductFromStockAnswer(unchanged, answer({ branchId: 7, batchId: 555, after: { lotQuantity: 2, branchQuantity: 2 } })), unchanged, 'a branch or lot the row does not list is not invented')
assert.equal(patchProductFromStockAnswer(unchanged, answer({ after: { lotQuantity: Number.NaN, branchQuantity: 1 } })), unchanged, 'a malformed answer changes nothing')
assert.equal(patchProductFromStockAnswer({ id: '12', stock_quantity: 5, branch_stock: [{ branch_id: '1', quantity: 5 }] }, answer({ after: { lotQuantity: 0, branchQuantity: 4 } })).stock_quantity, 4, 'ids compare as text, so 12 and "12" are one product')

// A row without lots (a Products list read without the token) is patched on its branch figures only.
const bare = patchProductFromStockAnswer({ id: 12, stock_quantity: 10, branch_stock: [{ branch_id: 1, quantity: 8 }] }, answer())
assert.deepEqual(bare, { id: 12, stock_quantity: 8, branch_stock: [{ branch_id: 1, quantity: 6 }] })

// The refusal's figures patch the row the same way, and are read off the error the transport threw (error.current).
const refusal = Object.assign(new Error('Stock changed'), { status: 409, code: 'stock_conflict', current: { lotQuantity: 2, branchQuantity: 7 } })
const figures = stockConflictFigures(refusal)
assert.deepEqual(figures, { lotQuantity: 2, branchQuantity: 7 })
const shown = patchProductFromStockConflict(row(), { productId: 12, branchId: 1, batchId: 100, current: figures! })
assert.equal(shown.branch_stock[0].quantity, 7); assert.equal(shown.stock_quantity, 9); assert.equal(shown.lots[0].branches[0].quantity, 2)
assert.equal(stockConflictFigures(Object.assign(new Error('Stock changed'), { status: 409, code: 'stock_conflict', current: null })), null, 'an older server sends none')
assert.equal(stockConflictFigures(Object.assign(new Error('x'), { current: { lotQuantity: 'a', branchQuantity: 1 } })), null)
assert.equal(stockConflictFigures(null), null)

console.log('stockAnswerPatch: Set answers and stale-quantity refusals patch the Products row, nothing is re-read')
