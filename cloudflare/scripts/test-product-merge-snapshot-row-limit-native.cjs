const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const parent = '01b1404596fb012a77bb64a0fe29feeb23b6b91d'
const snapshotPath = path.resolve(__dirname, '../src/lib/productMergeSnapshot.ts')
const originalRead = fs.readFileSync
if (process.argv.includes('--parent')) {
  const source = execFileSync('git', ['show', `${parent}:cloudflare/src/lib/productMergeSnapshot.ts`], { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' })
  fs.readFileSync = function (file, ...args) {
    if (path.resolve(String(file)) === snapshotPath) return args[0] ? source : Buffer.from(source)
    return originalRead.call(this, file, ...args)
  }
}
let world, prepare, capture, executeStockTransaction
try {
  ;({ world, prepare } = require('./test-product-merge-protocol-native.cjs'))
  const { loadStockSession } = require('./test-stock-session-atomic.cjs')
  capture = loadStockSession('lib/productMergeSnapshot.ts')
  ;({ executeStockTransaction } = loadStockSession('lib/stockTransaction.ts'))
} finally { fs.readFileSync = originalRead }

function growth(productId, count, offset = 1000) {
  return { sql: `WITH RECURSIVE rows(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM rows WHERE n<@count)
    INSERT INTO branch_stock(product_id,branch_id,quantity) SELECT @productId,@offset+n,0 FROM rows`, params: { productId, count, offset } }
}
function wholeDatabase(f) {
  return Object.fromEntries(f.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({ name }) => {
    const rows = f.sql.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
    return [name, rows.map(row => JSON.stringify(row)).sort()]
  }))
}
async function read(f) {
  const plan = capture.planProductMergeCaseSnapshot(1, 2, [])
  assert.equal(plan.reads.length, 1, 'one coherent capture query')
  const rows = await capture.runProductMergeReadBatch(f.db, plan.reads)
  return { plan, rows, envelope: rows.get('capture')[0] }
}
async function directBoundary(total) {
  const f = world()
  try {
    await executeStockTransaction(f.db, [growth(1, total - 1)], 'once')
    const { plan, rows, envelope } = await read(f)
    assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM branch_stock WHERE product_id=1').get().n, total)
    if (total === 10000) {
      assert.equal(envelope.oversized, 0)
      assert.equal(plan.decode(rows).canonicalStockBefore.length, 10000)
      assert.ok(Buffer.byteLength(envelope.data) < 512 * 1024)
      console.log('PASS actual SQL 10000 rows admitted below byte bound')
    } else {
      assert.equal(envelope.oversized, 1, 'over-limit section must refuse in SQL before decoding')
      assert.equal(envelope.data, null, 'oversized SQL capture cannot become saved protocol data')
      assert.throws(() => plan.decode(rows), /merge_case_snapshot_limit/)
      console.log(`PASS actual SQL ${total} stored rows refused with NULL data`)
    }
  } finally { f.sql.close() }
}
async function separateSections() {
  const f = world()
  try {
    await executeStockTransaction(f.db, [growth(1, 5999), growth(2, 5999, 20000)], 'once')
    const { plan, rows, envelope } = await read(f)
    assert.equal(envelope.oversized, 0, 'limit is per section, not sum of captured rows')
    const snapshot = plan.decode(rows)
    assert.equal(snapshot.canonicalStockBefore.length, 6000)
    assert.equal(snapshot.duplicateStockRows.length, 6000)
    console.log('PASS separate 6000-row sections admitted despite combined rows >10000')
  } finally { f.sql.close() }
}
async function otherSection() {
  const f = world()
  try {
    await executeStockTransaction(f.db, [{ sql: `WITH RECURSIVE rows(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM rows WHERE n<10001)
      INSERT INTO product_images(id,product_id,image_path,sort_order,created_at) SELECT 1000+n,2,'x',0,NULL FROM rows` }], 'once')
    const { plan, rows, envelope } = await read(f)
    assert.equal(envelope.oversized, 1, 'non-stock section also bounded in SQL')
    assert.equal(envelope.data, null)
    assert.throws(() => plan.decode(rows), /merge_case_snapshot_limit/)
    console.log('PASS duplicate image section row limit rejects before decode')
  } finally { f.sql.close() }
}
async function postGrowth(total, witness = false) {
  const f = world()
  try {
    const before = wholeDatabase(f)
    const statements = await prepare(f)
    const sealIndex = statements.findIndex(row => row.sql.startsWith("UPDATE undo_snapshots SET status='sealing'"))
    assert.ok(sealIndex > 0)
    statements.splice(sealIndex, 0, growth(1, total - 1))
    if (witness || total === 10000) {
      await executeStockTransaction(f.db, statements, 'once')
      const sealed = f.sql.prepare('SELECT status,payload_json FROM undo_snapshots WHERE id=2').get()
      assert.equal(sealed.status, 'sealed')
      const postCapture = JSON.parse(sealed.payload_json).post_capture
      assert.equal(postCapture.canonicalStock.length, Math.min(total, 10001))
      if (witness) {
        const { plan, rows, envelope } = await read(f)
        assert.equal(envelope.oversized, 0)
        assert.throws(() => plan.decode(rows), /merge_case_snapshot_limit/)
        console.log(JSON.stringify({ parent, storedRows: total, capturedRows: postCapture.canonicalStock.length, bytes: Buffer.byteLength(envelope.data), sqlOversized: envelope.oversized, seal: sealed.status, decoder: 'merge_case_snapshot_limit' }))
      } else {
        const { plan, rows } = await read(f)
        assert.equal(plan.decode(rows).canonicalStockBefore.length, 10000)
        assert.equal(f.sql.prepare('SELECT stock_quantity FROM products WHERE id=1').get().stock_quantity, 3)
        console.log('PASS protocol publishes readable 10000-row postcapture')
      }
    } else {
      await assert.rejects(executeStockTransaction(f.db, statements, 'once'), /merge_transition_/, 'postgrowth oversized seal must refuse before publication')
      assert.deepEqual(wholeDatabase(f), before, 'complete database including stock/history/flags/sequences rolls back')
      console.log(`PASS protocol postgrowth ${total} rows rolls back whole database before sealed publication`)
    }
  } finally { f.sql.close() }
}
async function main() {
  if (process.argv.includes('--witness')) return postGrowth(10002, true)
  if (process.argv.includes('--images-only')) return otherSection()
  if (process.argv.includes('--protocol-only')) return postGrowth(10002)
  await directBoundary(10000)
  await directBoundary(10001)
  await directBoundary(10002)
  await separateSections()
  await otherSection()
  await postGrowth(10000)
  await postGrowth(10001)
  await postGrowth(10002)
}
main().catch(error => { console.error(error); process.exitCode = 1 })
