const assert = require('node:assert/strict')
const { loadStockSession } = require('./test-stock-session-atomic.cjs')
const { planReturnLot } = loadStockSession('lib/returnsStock.ts')

const base = { saleLineBatchId: null, operatorBatchId: null, lotTracked: false }
const split = planReturnLot({ ...base, quantity: 0.3, allocations: [
  { batch_id: 1, outstanding: 0.2 }, { batch_id: 2, outstanding: 0.1 },
] })
assert.deepEqual(split, { splits: [{ batchId: 2, quantity: 0.1 }, { batchId: 1, quantity: 0.2 }], plainQuantity: 0, requiresLotPick: false })

const residual = planReturnLot({ ...base, quantity: 0.3, allocations: [{ batch_id: 1, outstanding: 0.1 }] })
assert.deepEqual(residual, { splits: [{ batchId: 1, quantity: 0.1 }], plainQuantity: 0.2, requiresLotPick: false })
const originalReceipt = planReturnLot({ ...base, saleLineBatchId: 3, quantity: 0.3, allocations: [{ batch_id: 1, outstanding: 0.1 }] })
assert.deepEqual(originalReceipt, { splits: [{ batchId: 1, quantity: 0.1 }, { batchId: 3, quantity: 0.2 }], plainQuantity: 0, requiresLotPick: false })

assert.deepEqual(planReturnLot({ ...base, operatorBatchId: 9, quantity: 0.3, allocations: [{ batch_id: 1, outstanding: 0.1 }] }),
  { splits: [{ batchId: 9, quantity: 0.3 }], plainQuantity: 0, requiresLotPick: false }, 'explicit receipt remains authoritative')
assert.deepEqual(planReturnLot({ ...base, lotTracked: true, quantity: 0.3, allocations: [{ batch_id: 1, outstanding: 0.1 }] }),
  { splits: [{ batchId: 1, quantity: 0.1 }], plainQuantity: 0, requiresLotPick: true }, 'unresolved tracked residual still requires a receipt choice')
assert.deepEqual(planReturnLot({ ...base, quantity: 0, allocations: [{ batch_id: 1, outstanding: 0.1 }] }),
  { splits: [], plainQuantity: 0, requiresLotPick: false }, 'zero-stock control')
console.log('PASS exact fractional return allocations and receipt/NULL/choice/zero controls')
