// The Set hold (lib/inventoryCheckFixStock.ts) and its switch read (lib/readSwitches.ts) are imported LAZILY by
// routes/inventory.ts runAdjustAction and routes/batches.ts, only for a Set or a named count. The stock harnesses that load those
// routes run on a fixture with no Inventory Check tables, so they answer "no count waits for approval" and "switch off" -- the answer
// a product with no queued count gets in production. The hold itself is pinned by test-inventory-check-approvals-http.cjs and
// test-inventory-check-lot-counts-http.cjs against the real module, never by these stubs.
const FIX_STOCK_COUNT_PENDING = { error: 'This count is waiting for approval. Approve or reject it first.', code: 'inventory_check_count_pending' }
const libs = {
  '../lib/inventoryCheckFixStock': { fixStockHeldByApproval: async () => false, scopedSetHeld: async () => false, approvalClaimSession: () => undefined, FIX_STOCK_COUNT_PENDING },
  '../lib/readSwitches': { readSwitch: async () => false },
}
function withFixStockHoldStub(nextRequire) {
  return request => Object.hasOwn(libs, request) ? libs[request] : nextRequire(request)
}
module.exports = { withFixStockHoldStub }
