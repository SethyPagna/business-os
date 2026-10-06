// Refuter E4 (CUTOVER-LBCD-VERIFY.md): after the branch cutover, Undo of a stock-in recorded at the target
// branch (Warehouse, now "LC Store") was left open but could only fail with the generic "Stock ... changed".
// Owner rule: untouched products still undo. Real migration chain, real session commit and replay; the
// post-cutover state is produced by the very statements the cutover runs on the rows replay compares:
//   - the 0229 role backfill and the finalize rename/role/default UPDATEs on branches (each fired the 0124
//     branch-revision trigger),
//   - the snapshot pass's label fill on product_batches (0240 makes it revision-neutral),
//   - for a product the cutover moved: one official transfer into the target, its branch stock and lot
//     quantities, and the receipt's history row carrying the closure marker.
// Checks:
//   1. untouched product: Undo and Redo succeed after the whole post-cutover state is applied;
//   2. an older snapshot that saved 'branch' revision entries (before this change) undoes the same way;
//   3. a product the cutover moved is refused with the cutover's own code and message, never the generic one;
//   4. a plain (non-cutover) change to the stock is still the generic refusal, so check 3 does not swallow it;
//   5. a branch switched off after the session still refuses Undo (replay asserts is_active itself);
//   6. a real change to the session's own stock still refuses after the cutover state;
//   7. the marker restated in stockSession.ts equals lib/branchCutoverHistory.ts.
//
// Run (from cloudflare/): node scripts/test-stock-session-undo-after-cutover-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { fixture, loadStockSession, user, receiveRequest } = require('./test-stock-session-atomic.cjs')

const failures = []
async function check(name, run) {
  try { await run(); console.log(`PASS ${name}`) } catch (error) {
    failures.push(name); console.error(`FAIL ${name}`)
    console.error(error instanceof Error ? error.stack || error.message : error)
  }
}
const payload = (f, receipt) => JSON.parse(f.sql.prepare('SELECT undo_payload FROM action_history WHERE id=?').get(receipt.actionHistoryId).undo_payload)
const undo = (f, api, receipt) => api.replayStockSession(f.env, user, 'undo', receipt.actionHistoryId, 0, payload(f, receipt))
const redo = (f, api, receipt) => api.replayStockSession(f.env, user, 'redo', receipt.actionHistoryId, 1, payload(f, receipt))
const qty = (f, product = 1) => f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=? AND branch_id=1').get(product).quantity

async function recorded(f, api, id, quantity = 5) {
  const receipt = await api.commitStockSession(f.env, user, receiveRequest(id, quantity))
  assert.equal(receipt.success, true)
  return receipt
}
// What the cutover does to the rows a stock session's replay reads (statement shapes from branchCutoverParent.ts
// finalize, the 0229 backfill and branchCutoverCapture.ts's label fill).
function cutoverTouchesBranchesAndLabels(f) {
  f.sql.exec(`
    INSERT INTO branches(id,name,is_default,is_active) VALUES(2,'Warehouse',0,1);
    UPDATE branches SET role='warehouse', canonical_key='warehouse' WHERE id=1;
    UPDATE branches SET role='shop', canonical_key='shop' WHERE id=2;`)
  f.sql.prepare("UPDATE branches SET name='LC Store',is_active=1,is_default=1,role='shop',updated_at='2026-10-07 01:00:00' WHERE id=1").run()
  f.sql.prepare("UPDATE branches SET name='Old Shop',is_active=0,is_default=0,successor_branch_id=1,updated_at='2026-10-07 01:00:00' WHERE id=2").run()
  // A lot received before the label column existed: blank, so the pass fills it (a stamped label is left alone).
  f.sql.prepare('UPDATE product_batches SET received_branch_name = NULL').run()
  f.sql.prepare("UPDATE product_batches SET received_branch_name = CASE received_branch_id WHEN 1 THEN 'LC Store' END WHERE trim(coalesce(received_branch_name,''))=''").run()
}
// One consolidation transfer of product 1 from the retired branch (2) into the target (1).
function cutoverMovesProduct(f) {
  f.sql.exec(`
    INSERT INTO action_history(id,scope,entity,entity_id,label,status,reversible,undo_payload,redo_payload,created_by_id,last_error)
      VALUES(9001,'branches','stock_transfer','move','Move','recorded',0,'{}','{}',7,'undo_closed:branch_cutover_move');
    INSERT INTO transfer_operation_receipts(id,actor_id,request_id,request_digest,request_json,status,operation_id,provenance_version,replay_state,generation,action_history_id)
      VALUES(9001,7,'bc_op_1','d','{}','committed','op-move',1,'applied',0,9001);
    INSERT INTO stock_transfers(product_id,product_name,from_branch_id,to_branch_id,quantity,receipt_id) VALUES(1,'Serum',2,1,4,9001);
    UPDATE branch_stock SET quantity = quantity + 4 WHERE product_id=1 AND branch_id=1;`)
}
const refusal = async (promise) => { try { await promise } catch (error) { return error }; assert.fail('expected a refusal') }

async function main() {
  const api = loadStockSession()

  await check('untouched product: Undo and Redo succeed after the post-cutover branch and label state', async () => {
    const f = fixture()
    const receipt = await recorded(f, api, 'e4-untouched-001')
    cutoverTouchesBranchesAndLabels(f)
    assert.equal(f.sql.prepare('SELECT received_branch_name n FROM product_batches').get().n, 'LC Store', 'the label fill really ran')
    await undo(f, api, receipt)
    assert.equal(qty(f), 0, 'undo took the session stock back')
    await redo(f, api, receipt)
    assert.equal(qty(f), 5)
  })

  await check('an older snapshot that saved branch revisions undoes the same way', async () => {
    const f = fixture()
    const receipt = await recorded(f, api, 'e4-older-snapshot-001')
    for (const field of ['expected', 'after']) {
      f.sql.prepare(`UPDATE undo_snapshots SET payload_json=json_insert(payload_json,'$.${field}.revisions[#]',json('{"entity_type":"branch","entity_key":"1","revision":1}'))`).run()
    }
    const saved = JSON.parse(f.sql.prepare('SELECT payload_json FROM undo_snapshots').get().payload_json)
    assert.ok(saved.expected.revisions.some((r) => r.entity_type === 'branch'), 'the fixture carries a saved branch revision')
    cutoverTouchesBranchesAndLabels(f)
    await undo(f, api, receipt)
    assert.equal(qty(f), 0)
    await redo(f, api, receipt)
    assert.equal(qty(f), 5)
  })

  await check('a product the cutover moved is refused with the cutover code, not the generic message', async () => {
    const f = fixture()
    const receipt = await recorded(f, api, 'e4-moved-001')
    cutoverTouchesBranchesAndLabels(f)
    cutoverMovesProduct(f)
    const before = f.sql.prepare('SELECT quantity FROM branch_stock WHERE product_id=1 AND branch_id=1').get().quantity
    const error = await refusal(undo(f, api, receipt))
    assert.equal(error.statusCode, 409)
    assert.equal(error.code, 'undo_closed_branch_cutover_product_moved')
    assert.match(error.message, /branch consolidation/)
    assert.doesNotMatch(error.message, /Stock, metadata, references, or revision changed/)
    assert.equal(qty(f), before, 'nothing was written')
    assert.equal(f.sql.prepare("SELECT status FROM action_history WHERE id=?").get(receipt.actionHistoryId).status, 'undoable', 'the row is still undoable-shaped; only this attempt is refused')
  })

  await check('a plain stock change (no cutover transfer) is still the generic refusal', async () => {
    const f = fixture()
    const receipt = await recorded(f, api, 'e4-plain-001')
    cutoverTouchesBranchesAndLabels(f)
    f.sql.prepare('UPDATE branch_stock SET quantity = quantity - 1 WHERE product_id=1 AND branch_id=1').run()
    const error = await refusal(undo(f, api, receipt))
    assert.equal(error.statusCode, 409)
    assert.equal(error.code, 'stock_session_rejected')
    assert.match(error.message, /Stock, metadata, references, or revision changed/)
  })

  await check('a branch switched off after the session still refuses Undo', async () => {
    const f = fixture()
    const receipt = await recorded(f, api, 'e4-inactive-001')
    f.sql.prepare('UPDATE branches SET is_active=0 WHERE id=1').run()
    const error = await refusal(undo(f, api, receipt))
    assert.equal(error.statusCode, 409)
    assert.equal(qty(f), 5)
  })

  await check('a real change to the session stock still refuses after the cutover state', async () => {
    const f = fixture()
    const receipt = await recorded(f, api, 'e4-real-001')
    cutoverTouchesBranchesAndLabels(f)
    f.sql.prepare('UPDATE product_batches SET unit_cost_usd = unit_cost_usd + 1').run()
    await refusal(undo(f, api, receipt))
    assert.equal(qty(f), 5)
  })

  await check('the cutover marker restated in stockSession.ts equals lib/branchCutoverHistory.ts', () => {
    const history = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'branchCutoverHistory.ts'), 'utf8')
    const session = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'stockSession.ts'), 'utf8')
    const canonical = /UNDO_CLOSED_BRANCH_CUTOVER_MOVE = '([^']+)'/.exec(history)[1]
    assert.equal(/BRANCH_CUTOVER_MOVE_MARKER = '([^']+)'/.exec(session)[1], canonical)
  })

  if (failures.length) { console.error(`${failures.length} FAILED`); process.exit(1) }
  console.log('all passed')
}
main().catch((error) => { console.error(error); process.exit(1) })
