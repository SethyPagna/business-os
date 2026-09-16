const assert = require('node:assert/strict')
const h = require('./test-transfer-operation-receipt-pure.cjs')
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
  for(const [app,route] of [['branches','/transfer'],['branches','/transfer-bulk'],['inventory','/transfer']]) {
    h.fresh()
    const sqlite = h.getDb()
    const before = sqlite.serialize()
    const originalPrepare = sqlite.prepare
    sqlite.prepare = function(sql) {
      if(sql.includes('sqlite_master')) throw new Error('schema lookup unavailable')
      return originalPrepare.call(this,sql)
    }
    const result = await h.request(app,route,h.intent(1,1,'upgrade-error-key',route.endsWith('bulk')))
    sqlite.prepare = originalPrepare
    assert.equal(result.status,503)
    assert.equal(result.body.code,'release_upgrade_in_progress')
    assert.deepEqual(sqlite.serialize(),before,'lookup errors fail closed before effects')
  }
  console.log('PASS pre-0150/0151/0152 production schemas quiesce all three transfer routes without effects; full schema opens; lookup failures fail closed')
}
main().catch(error=>{console.error(error);process.exitCode=1})
