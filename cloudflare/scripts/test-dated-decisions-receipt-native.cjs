const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const f = require('./test-stock-bridge-core-native.cjs')
const oldSource = execFileSync('git', ['show', 'df1f7a3090c432a8bb9145161dcdf448526fa57b:cloudflare/src/lib/datedStockCountDecisions.ts'], { encoding: 'utf8' })
async function oldLostAcknowledgementControl() {
  const old = f.load('lib/datedStockCountDecisions.ts', oldSource)
  const name = 'Frozen dated lost acknowledgement'
  const rows = [{ rowNumber: 1, branchId: 1, reason: 'product_not_found', suggestedActions: ['create_new'], raw: { rowNumber: 1, date: '2026-10-09', branchName: 'Shop', productName: name, count: 1 } }]
  f.loseNextAcknowledgement()
  await old.applyDatedStockCountDecisions(f.db, [], rows, [{ rowNumber: 1, action: 'create_new' }])
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM products WHERE name=?').get(name).n, 2)
  assert.equal(f.permits(), 0)
  console.log('PASS frozen df1f lost acknowledgement creates two products under actual0243')
}
oldLostAcknowledgementControl().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => f.sql.close())
