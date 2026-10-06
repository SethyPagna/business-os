// Companion for cloudflare/migrations/0240_stock_revision_ignores_batch_label.sql
// (cutover lane LD follow-up; owner rule: untouched products still undo).
//
// The cutover snapshot pass fills product_batches.received_branch_name on every
// lot. 0124's trigger bumped the 'batch' and 'batch_identity' revisions on ANY
// lot UPDATE, so that fill made every untouched stock-in session refuse Undo as
// stale. 0240 recreates the trigger as AFTER UPDATE OF <all columns but the
// label>. Real chain, real SQLite, the real stock-session replay. Checks:
//   1. text: LF only, one DROP and one CREATE of the update trigger, the OF list
//      names EVERY product_batches column except received_branch_name (so a
//      future column turns this red until it is added), and the body and WHEN
//      clause equal 0124's;
//   2. session recorded -> label fill (the exact statement shape of the cutover
//      capture pass) -> Undo succeeds, Redo succeeds, and no revision moved;
//   3. control: with 0124's trigger put back, the same fill makes Undo refuse
//      409 stale_state, so the fixture discriminates;
//   4. a real change to the lot still refuses Undo: cost, quantity, attribution
//      (received_branch_id), is_active, and a label write that ALSO sets one of
//      them;
//   5. insert and delete triggers are unchanged (still bump).
//
// Run (from cloudflare/): node scripts/test-stock-revision-ignores-batch-label-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')

const root = path.resolve(__dirname, '..')
const MIGRATION = '0240_stock_revision_ignores_batch_label.sql'
const read = (file) => fs.readFileSync(path.join(root, 'migrations', file), 'utf8')
const triggerBody = (text) => text.slice(text.indexOf('WHEN NOT EXISTS')).replace(/\s+/g, ' ').trim()
const failures = []
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`) } catch (error) {
    failures.push(name); console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? error.stack || error.message : error)
  }
}
const payload = (f, receipt) => JSON.parse(f.sql.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(receipt.actionHistoryId).undo_payload)
const revisions = (f) => f.sql.prepare('SELECT entity_type,entity_key,revision FROM stock_session_revisions ORDER BY entity_type,entity_key').all()
const stale = (error) => error.statusCode === 409

async function recorded(f, api, id) {
  const receipt = await api.commitStockSession(f.env, user, receiveRequest(id, 5))
  assert.equal(receipt.success, true)
  return receipt
}
const undo = (f, api, receipt) => api.replayStockSession(f.env, user, 'undo', receipt.actionHistoryId, 0, payload(f, receipt))
const redo = (f, api, receipt) => api.replayStockSession(f.env, user, 'redo', receipt.actionHistoryId, 1, payload(f, receipt))
// The cutover capture statement shape: the label column ALONE.
const fillLabel = (f) => f.sql.prepare("UPDATE product_batches SET received_branch_name = CASE received_branch_id WHEN 1 THEN 'Shop' END").run()

async function main() {
  const api = loadStockSession()
  const migration = read(MIGRATION)

  await check('text: LF only, OF list covers every column but the label, body equals 0124', () => {
    assert.ok(!migration.includes('\r'), 'LF only')
    assert.equal((migration.match(/DROP TRIGGER IF EXISTS stock_revision_product_batches_update;/g) || []).length, 1)
    assert.equal((migration.match(/CREATE TRIGGER stock_revision_product_batches_update/g) || []).length, 1)
    const ofList = /CREATE TRIGGER stock_revision_product_batches_update AFTER UPDATE OF([\s\S]*?)ON product_batches/.exec(migration)[1].split(',').map((s) => s.trim()).filter(Boolean)
    const f = fixture()
    const columns = f.sql.prepare("SELECT name FROM pragma_table_info('product_batches')").all().map((c) => c.name)
    assert.deepEqual([...ofList].sort(), columns.filter((c) => c !== 'received_branch_name').sort(),
      'every product_batches column except received_branch_name must be listed; add a new column here')
    assert.ok(columns.includes('received_branch_name'))
    const original = read('0124_stock_session_operations.sql')
    const originalTrigger = original.slice(original.indexOf('CREATE TRIGGER stock_revision_product_batches_update'), original.indexOf('CREATE TRIGGER stock_revision_product_batches_delete'))
    assert.equal(triggerBody(migration.slice(migration.indexOf('CREATE TRIGGER'))), triggerBody(originalTrigger), 'same WHEN clause and body as 0124')
  })

  await check('recorded session -> label fill -> Undo and Redo succeed, no revision moves', async () => {
    const f = fixture()
    const receipt = await recorded(f, api, 'label-fill-undo-001')
    const before = revisions(f)
    assert.equal(fillLabel(f).changes, 1)
    assert.equal(f.sql.prepare('SELECT received_branch_name n FROM product_batches').get().n, 'Shop', 'the label really was written')
    assert.deepEqual(revisions(f), before, 'a label-only write bumps nothing')
    await undo(f, api, receipt)
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 0, 'undo took the stock back')
    await redo(f, api, receipt)
    assert.equal(f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity, 5)
  })

  await check('control: with 0124 restored, the same fill makes Undo refuse stale', async () => {
    const f = fixture()
    const original = read('0124_stock_session_operations.sql')
    const originalTrigger = original.slice(original.indexOf('CREATE TRIGGER stock_revision_product_batches_update'), original.indexOf('CREATE TRIGGER stock_revision_product_batches_delete'))
    f.sql.exec('DROP TRIGGER stock_revision_product_batches_update;' + originalTrigger)
    const receipt = await recorded(f, api, 'label-fill-control-001')
    fillLabel(f)
    await assert.rejects(undo(f, api, receipt), stale)
  })

  const realChanges = [
    ['cost', 'unit_cost_usd = unit_cost_usd + 1'],
    ['received quantity', 'received_quantity = received_quantity + 1'],
    ['attribution', 'received_branch_id = NULL'],
    ['notes', "notes = 'edited'"],
    ['label together with cost', "received_branch_name = 'Shop', unit_cost_usd = unit_cost_usd + 1"],
  ]
  for (const [label, set] of realChanges) {
    await check(`a real lot change (${label}) still refuses Undo`, async () => {
      const f = fixture()
      const receipt = await recorded(f, api, `real-change-${label.replace(/\W+/g, '-')}`)
      f.sql.prepare(`UPDATE product_batches SET ${set}`).run()
      await assert.rejects(undo(f, api, receipt), stale)
    })
  }

  await check('a real stock change on the branch quantity still refuses Undo after a label fill', async () => {
    const f = fixture()
    const receipt = await recorded(f, api, 'real-stock-after-fill-001')
    fillLabel(f)
    f.sql.prepare('UPDATE branch_stock SET quantity = quantity - 1 WHERE product_id=1 AND branch_id=1').run()
    await assert.rejects(undo(f, api, receipt), stale)
  })

  await check('insert and delete triggers still bump the lot revisions', () => {
    const f = fixture()
    f.sql.exec("INSERT INTO product_batches(id,variant_product_id,batch_key,received_at,unit_cost_usd,received_quantity) VALUES(901,1,'K1','2026-10-01',1,1)")
    const afterInsert = revisions(f).filter((r) => r.entity_type === 'batch' && r.entity_key === '901')[0].revision
    f.sql.exec('DELETE FROM product_batches WHERE id=901')
    const afterDelete = revisions(f).filter((r) => r.entity_type === 'batch' && r.entity_key === '901')[0].revision
    assert.equal(afterInsert, 1)
    assert.equal(afterDelete, 2)
  })

  if (failures.length) { console.error(`${failures.length} FAILED`); process.exit(1) }
  console.log('all passed')
}
main().catch((error) => { console.error(error); process.exit(1) })
