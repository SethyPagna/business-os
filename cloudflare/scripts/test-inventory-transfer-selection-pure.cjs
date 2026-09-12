// Reuse the established real Hono/SQLite loader without executing its suite.
const fs = require('fs')
const path = require('path')
const Module = require('module')
const file = path.join(__dirname, 'test-inventory-transfer-lots-pure.cjs')
const source = fs.readFileSync(file, 'utf8')
const harness = new Module(file, module)
harness.filename = file
harness.paths = Module._nodeModulePaths(__dirname)
harness._compile(source.slice(0, source.indexOf('async function main()')) + `
(async () => {
  routeDb = freshDb()
  routeUser = { id: 7, name: 'Stock manager', tier: 'full' }
  routeWaits = []; routeAudits = []
  const body = { productId: 1, fromBranchId: 1, toBranchId: 2, quantity: 2, batchId: 102, reason: 'Selected newer date', client_request_id: 'selected-date' }
  const first = await routeRequest(body)
  assert.equal(first.status, 200, JSON.stringify(first.json))
  assert.equal(first.json.destBatchId, 102)
  assert.equal(lotQty(routeDb, 101, 1), 6)
  assert.equal(lotQty(routeDb, 102, 1), 2)
  assert.equal(lotQty(routeDb, 102, 2), 2)
  assert.equal(stockQty(routeDb, 1), 10)
  assert.equal(stockQty(routeDb, 2), 2)
  const replay = await routeRequest(body)
  assert.equal(replay.status, 200)
  assert.equal(replay.json.replayed, true)
  assert.equal(lotQty(routeDb, 102, 2), 2)
  assert.equal((await routeRequest({ ...body, batchId: 101 })).status, 409)
  assert.equal((await routeRequest({ ...body, batchId: null })).status, 409)
  for (const batchId of ['new', 0, -1, '102bad', 1.2]) {
    assert.equal((await routeRequest({ ...body, batchId, client_request_id: 'bad-' + batchId })).status, 400)
  }
  for (const batchId of [999, 101]) {
    const result = await routeRequest({ ...body, batchId, fromBranchId: 2, toBranchId: 1, client_request_id: 'unavailable-' + batchId })
    assert.equal(result.status, 409, JSON.stringify(result))
  }
  assert.equal((await routeRequest({ ...body, quantity: 3, client_request_id: 'shortage' })).status, 409)
  assert.equal(lotQty(routeDb, 102, 2), 2)
  assert.equal(routeDb.prepare('SELECT COUNT(*) n FROM transfer_operation_receipts').get().n, 1)
  await Promise.all(routeWaits)
  console.log('PASS real Inventory route explicit lot, opposite FIFO, replay identity, invalid ID and source shortage')
})().catch(error => { console.error(error); process.exitCode = 1 })
`, file)
