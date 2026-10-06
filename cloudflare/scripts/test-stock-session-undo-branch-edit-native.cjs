// HOTFIX-BRANCH-REV (release blocker, 2026-10-06): migration 0229 runs `UPDATE branches SET role=..,
// canonical_key=..` on the two operating branches. The 0124 trigger stock_revision_branches_update bumps the
// 'branch' revision on ANY branches UPDATE, and stock-session replay compared that revision (current state and
// the saved `expected` state), so after 0229 every stock session recorded before the deploy could only fail
// Undo/Redo with the generic "Stock, metadata, references, or revision changed". Any branch description edit
// already did the same.
//
// Real migration chain (every file in cloudflare/migrations, sorted), real commitStockSession and
// replayStockSession over better-sqlite3. Checks:
//   1. a two-line session, then the real 0229 file applied: Undo and Redo succeed with correct quantities in
//      BOTH ledgers (branch_stock + products.stock_quantity, and branch_batch_stock); a repeated Undo/Redo call
//      at the same generation is a no-op (no double apply); Undo again reverses again;
//   2. a branch description edit (location/phone/notes) between Undo and Redo, and a rename: same;
//   3. an older snapshot whose saved after/expected revisions carry 'branch' entries also undoes and redoes;
//   4. a real stock change on a session product (branch stock) still refuses, nothing written;
//   5. a real lot-ledger change (branch_batch_stock) still refuses, nothing written;
//   6. a product revision change (products row edit) still refuses, nothing written;
//   7. a deactivated branch still refuses Undo, nothing written.
// Checks 1, 2 and 3 are red on a09a84ae2's stockSession.ts (branch revisions compared).
//
// Run (from cloudflare/): node scripts/test-stock-session-undo-branch-edit-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { fixture, loadStockSession, user } = require('./test-stock-session-atomic.cjs')

const MIGRATION_0229 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '0229_branch_identity_backfill.sql'), 'utf8')

const failures = []
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`) } catch (error) {
    failures.push(name); console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? error.stack || error.message : error)
  }
}

function seed(f) {
  f.sql.exec(`
    INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Warehouse',0,1);
    INSERT INTO products(id,name,barcode,cost_price_usd,cost_price_khr,stock_quantity,is_active) VALUES(2,'Toner','TON-1',3,0,0,1);
    INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES(2,1,0);`)
}
const request = (id) => ({
  client_request_id: id, mode: 'stock_in',
  defaults: { supplier_name: 'Fixture Supplier', branch_id: 1, received_date: '2026-09-05' },
  items: [
    { line_id: 'line-001', kind: 'receive', product_id: 1, quantity: 5, unit_cost_usd: 2 },
    { line_id: 'line-002', kind: 'receive', product_id: 2, quantity: 3, unit_cost_usd: 3 },
  ],
})
const history = (f, receipt) => f.sql.prepare('SELECT * FROM action_history WHERE id=?').get(receipt.actionHistoryId)
const replay = (api, f, receipt, direction, generation) => {
  const row = history(f, receipt)
  const payload = JSON.parse(direction === 'undo' ? row.undo_payload : row.redo_payload)
  return api.replayStockSession(f.env, user, direction, receipt.actionHistoryId, generation, { ...payload, generation })
}
// Both ledgers for products 1 and 2 at branch 1.
function ledgers(f) {
  const out = {}
  for (const id of [1, 2]) {
    out[`branch${id}`] = f.sql.prepare('SELECT quantity q FROM branch_stock WHERE product_id=? AND branch_id=1').get(id).q
    out[`product${id}`] = f.sql.prepare('SELECT stock_quantity q FROM products WHERE id=?').get(id).q
    out[`lots${id}`] = f.sql.prepare(`SELECT COALESCE(SUM(s.quantity),0) q FROM branch_batch_stock s
      JOIN product_batches b ON b.id=s.batch_id WHERE b.variant_product_id=? AND s.branch_id=1`).get(id).q
  }
  return out
}
const APPLIED = { branch1: 5, product1: 5, lots1: 5, branch2: 3, product2: 3, lots2: 3 }
const REVERSED = { branch1: 0, product1: 0, lots1: 0, branch2: 0, product2: 0, lots2: 0 }
const branchRevision = (f) => f.sql.prepare("SELECT COALESCE((SELECT revision FROM stock_session_revisions WHERE entity_type='branch' AND entity_key='1'),0) r").get().r
const status = (f, receipt) => history(f, receipt).status
async function refusal(promise) {
  try { await promise } catch (error) { return error }
  assert.fail('expected a refusal')
}

async function main() {
  const api = loadStockSession()

  await check('0229 backfill after the session: Undo/Redo succeed in both ledgers, no double apply', async () => {
    const f = fixture(); seed(f)
    const receipt = await api.commitStockSession(f.env, user, request('hotfix-0229-001'))
    assert.deepEqual(ledgers(f), APPLIED)
    const revisionBefore = branchRevision(f)
    f.sql.exec(MIGRATION_0229)
    assert.deepEqual(f.sql.prepare('SELECT id,role,canonical_key FROM branches ORDER BY id').all(),
      [{ id: 1, role: 'shop', canonical_key: 'shop' }, { id: 2, role: 'warehouse', canonical_key: 'warehouse' }], 'the real 0229 ran')
    assert.ok(branchRevision(f) > revisionBefore, 'positive control: 0229 bumped the branch revision')
    await replay(api, f, receipt, 'undo', 0)
    assert.deepEqual(ledgers(f), REVERSED)
    assert.equal(status(f, receipt), 'redoable')
    await replay(api, f, receipt, 'undo', 0) // the same call again (lost acknowledgement retry)
    assert.deepEqual(ledgers(f), REVERSED, 'a repeated Undo does not take the stock out twice')
    await replay(api, f, receipt, 'redo', 1)
    assert.deepEqual(ledgers(f), APPLIED)
    await replay(api, f, receipt, 'redo', 1)
    assert.deepEqual(ledgers(f), APPLIED, 'a repeated Redo does not add the stock twice')
    await replay(api, f, receipt, 'undo', 2)
    assert.deepEqual(ledgers(f), REVERSED, 'the reversal reverses again')
    assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE reason LIKE 'Stock session %'").get().n, 6,
      'three replays x two lines, each logged once')
  })

  await check('branch description edits and a rename between replays do not block Undo/Redo', async () => {
    const f = fixture(); seed(f)
    const receipt = await api.commitStockSession(f.env, user, request('hotfix-edit-001'))
    f.sql.prepare("UPDATE branches SET location='Street 271', phone='012 345 678', notes='front counter' WHERE id=1").run()
    await replay(api, f, receipt, 'undo', 0)
    assert.deepEqual(ledgers(f), REVERSED)
    f.sql.prepare("UPDATE branches SET manager='Dara', name='LC Store' WHERE id=1").run()
    await replay(api, f, receipt, 'redo', 1)
    assert.deepEqual(ledgers(f), APPLIED)
  })

  await check('an older snapshot carrying saved branch revisions undoes and redoes', async () => {
    const f = fixture(); seed(f)
    const receipt = await api.commitStockSession(f.env, user, request('hotfix-older-001'))
    const rev = branchRevision(f)
    for (const field of ['after', 'expected']) {
      f.sql.prepare(`UPDATE undo_snapshots SET payload_json=json_insert(payload_json,'$.${field}.revisions[#]',
        json_object('entity_type','branch','entity_key','1','revision',?))`).run(rev)
    }
    const saved = JSON.parse(f.sql.prepare("SELECT payload_json FROM undo_snapshots WHERE kind='stock.session'").get().payload_json)
    assert.ok(saved.expected.revisions.some((r) => r.entity_type === 'branch'), 'fixture carries a saved branch revision')
    f.sql.exec(MIGRATION_0229)
    await replay(api, f, receipt, 'undo', 0)
    assert.deepEqual(ledgers(f), REVERSED)
    await replay(api, f, receipt, 'redo', 1)
    assert.deepEqual(ledgers(f), APPLIED)
  })

  const refuses = (name, mutate) => check(name, async () => {
    const f = fixture(); seed(f)
    const receipt = await api.commitStockSession(f.env, user, request(`hotfix-refuse-${name.length}`))
    f.sql.exec(MIGRATION_0229)
    mutate(f)
    const before = ledgers(f)
    const error = await refusal(replay(api, f, receipt, 'undo', 0))
    assert.equal(error.statusCode, 409)
    assert.deepEqual(ledgers(f), before, 'nothing was reversed')
    assert.equal(status(f, receipt), 'undoable')
  })
  await refuses('a real branch-stock change on a session product still refuses',
    (f) => f.sql.prepare('UPDATE branch_stock SET quantity=quantity-1 WHERE product_id=1 AND branch_id=1').run())
  await refuses('a real lot-ledger change on a session lot still refuses',
    (f) => f.sql.prepare('UPDATE branch_batch_stock SET quantity=quantity-1 WHERE branch_id=1 AND batch_id=(SELECT id FROM product_batches WHERE variant_product_id=2)').run())
  await refuses('a product row edit still refuses (product revision kept)',
    (f) => f.sql.prepare("UPDATE products SET name='Serum v2' WHERE id=1").run())
  await refuses('a deactivated branch still refuses',
    (f) => f.sql.prepare('UPDATE branches SET is_active=0, is_default=0 WHERE id=1').run())

  if (failures.length) { console.error(`${failures.length} FAILED`); process.exit(1) }
  console.log('all passed')
}
main().catch((error) => { console.error(error); process.exit(1) })
