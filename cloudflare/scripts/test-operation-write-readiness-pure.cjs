const assert = require('node:assert/strict')
const HARNESS = './test-transfer-operation-receipt-pure.cjs'
// operationWritesReady keeps a positive-only, per-isolate memo (6.0.882,
// 1e590bab7): once the full schema has been seen it is not re-probed, because
// migrations only add. A fail-closed probe therefore has to start from a
// fresh isolate, i.e. a fresh load of the route modules, or it would observe the
// memo of an earlier block rather than the probe.
const freshIsolate = () => {
  delete require.cache[require.resolve(HARNESS)]
  return require(HARNESS)
}
let h = freshIsolate()
const ROUTES = [['branches','/transfer'],['branches','/transfer-bulk'],['inventory','/transfer']]
function failSchemaLookup(sqlite) {
  const originalPrepare = sqlite.prepare
  sqlite.prepare = function(sql) {
    if(sql.includes('sqlite_master')) throw new Error('schema lookup unavailable')
    return originalPrepare.call(this,sql)
  }
  return () => { sqlite.prepare = originalPrepare }
}
async function main() {
  for(const beforeMigration of ['0150','0151','0152']) {
    h.fresh(3,1,beforeMigration)
    for(const [app,route] of [['branches','/transfer'],['branches','/transfer-bulk'],['inventory','/transfer']]) {
      const snapshot = h.getDb().serialize()
      const result = await h.request(app,route,h.intent(1,1,'upgrade-ready-key',route.endsWith('bulk')))
      assert.equal(result.status,503,JSON.stringify(result))
      assert.equal(result.body.code,'release_upgrade_in_progress')
      assert.deepEqual(h.getDb().serialize(),snapshot,'schema bridge must not change stock, receipt, audit or any other data')
    }
  }
  h.fresh()
  for(const [app,route] of [['branches','/transfer'],['branches','/transfer-bulk'],['inventory','/transfer']]) {
    h.fresh()
    assert.equal((await h.request(app,route,h.intent(1,1,'upgrade-ready-key',route.endsWith('bulk')))).status,200)
  }
  for(const [app,route] of ROUTES) {
    h = freshIsolate()
    h.fresh()
    const sqlite = h.getDb()
    const before = sqlite.serialize()
    const restore = failSchemaLookup(sqlite)
    const result = await h.request(app,route,h.intent(1,1,'upgrade-error-key',route.endsWith('bulk')))
    restore()
    assert.equal(result.status,503,JSON.stringify(result))
    assert.equal(result.body.code,'release_upgrade_in_progress')
    assert.deepEqual(sqlite.serialize(),before,'lookup errors fail closed before effects')
    // A failed probe is never remembered: the same isolate opens as soon as the
    // lookup succeeds against the full schema.
    assert.equal((await h.request(app,route,h.intent(1,1,'upgrade-error-key',route.endsWith('bulk')))).status,200,'a negative answer is not memoised')
  }
  // The positive memo is per isolate and deliberate: after the full schema has
  // been seen, a later lookup outage does not quiesce writes on that isolate.
  h = freshIsolate()
  for(const [app,route] of ROUTES) {
    h.fresh()
    assert.equal((await h.request(app,route,h.intent(1,1,'upgrade-memo-key',route.endsWith('bulk')))).status,200)
    h.fresh()
    const restore = failSchemaLookup(h.getDb())
    const result = await h.request(app,route,h.intent(1,1,'upgrade-memo-key-2',route.endsWith('bulk')))
    restore()
    assert.equal(result.status,200,'a remembered full schema is not re-probed: '+JSON.stringify(result))
  }
  console.log('PASS pre-0150/0151/0152 production schemas quiesce all three transfer routes without effects; full schema opens; lookup failures fail closed on a fresh isolate and are not memoised; the full-schema memo holds per isolate')
}
main().catch(error=>{console.error(error);process.exitCode=1})
