const assert = require('node:assert/strict')
const h = require('./test-transfer-operation-receipt-pure.cjs')
const { operationWritesReady } = h.load('lib/operationWriteReadiness.ts')
async function main() {
  for(const beforeMigration of ['0150','0151','0152']) {
    h.fresh(3,1,beforeMigration)
    assert.equal(await operationWritesReady(h.wrapDb()),false)
    for(const [app,route] of [['branches','/transfer'],['branches','/transfer-bulk'],['inventory','/transfer']]) {
      const snapshot = h.getDb().serialize()
      const result = await h.request(app,route,h.intent(1,1,'upgrade-ready-key',route.endsWith('bulk')))
      assert.equal(result.status,503,JSON.stringify(result))
      assert.equal(result.body.code,'release_upgrade_in_progress')
      assert.deepEqual(h.getDb().serialize(),snapshot,'schema bridge must not change stock, receipt, audit or any other data')
    }
  }
  h.fresh()
  assert.equal(await operationWritesReady(h.wrapDb()),true)
  for(const [app,route] of [['branches','/transfer'],['branches','/transfer-bulk'],['inventory','/transfer']]) {
    h.fresh()
    assert.equal((await h.request(app,route,h.intent(1,1,'upgrade-ready-key',route.endsWith('bulk')))).status,200)
  }
  assert.equal(await operationWritesReady({prepare(){throw new Error('database unavailable')}}),false)
  assert.equal(await operationWritesReady({prepare(){return {get:async()=>{throw new Error('query unavailable')}}}}),false)
  console.log('PASS pre-0150/0151/0152 production schemas quiesce all three transfer routes without effects; full schema opens; lookup failures fail closed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
