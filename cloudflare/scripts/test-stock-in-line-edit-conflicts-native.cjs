const assert = require('node:assert/strict')
const path = require('node:path')
const root = process.env.STOCK_LINE_CONFLICT_ROOT || path.resolve(__dirname, '..')
const h = require(path.join(root, 'scripts/test-counted-quantity-exact-native.cjs'))
const t = require(path.join(root, 'scripts/test-counted-stock-in-line-edit-native.cjs'))

async function prepared(make, tier, direction) {
  const world = await t.scenario(make, tier)
  let saved
  if (direction !== 'apply') {
    saved = await world.call()
    assert.equal(saved.status, 200, JSON.stringify(saved))
    if (direction === 'redo') assert.equal((await world.f.call('/action-history/' + saved.json.action_history_id + '/undo', { expected_generation: 0 })).status, 200)
  }
  return { ...world, invoke: direction === 'apply' ? world.call : () => world.f.call('/action-history/' + saved.json.action_history_id + '/' + direction, { expected_generation: direction === 'undo' ? 0 : 1 }) }
}

async function unrelated(make) {
  for (const tier of ['free', 'paid']) for (const direction of ['apply', 'undo', 'redo']) {
    for (const fault of ['external_check', 'anonymous_check', 'constraint_text', 'other_json_path']) {
      const { f, invoke } = await prepared(make, tier, direction)
      try {
        const before = t.state(f)
        const action = {
          external_check: 'INSERT INTO ordinary_external VALUES(0)',
          anonymous_check: 'INSERT INTO anonymous_external VALUES(0)',
          constraint_text: "SELECT RAISE(ABORT,'synthetic_external_constraint_failure')",
          other_json_path: "SELECT json_extract('[]','$[stock_in_line_edit_conflict_extra]')",
        }[fault]
        f.sql.exec("CREATE TEMP TABLE ordinary_external(ordinary_external_check INTEGER CHECK(ordinary_external_check=1));CREATE TEMP TABLE anonymous_external(guard_value INTEGER CHECK(guard_value=1));CREATE TEMP TRIGGER unrelated_line_failure BEFORE INSERT ON inventory_movements WHEN NEW.reference_id LIKE 'stock-in-edit:500:%' BEGIN " + action + '; END')
        const failed = await invoke()
        console.log('LINE_EDIT_UNRELATED_RESULT ' + JSON.stringify({ tier, direction, fault, status: failed.status, code: failed.json.code }))
        assert.equal(failed.status, 500, JSON.stringify(failed))
        assert.deepEqual(t.state(f), before, 'definite unrelated failure rolls back every business row')
        assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
        f.sql.exec('DROP TRIGGER unrelated_line_failure')
        const retry = await invoke()
        assert.equal(retry.status, 200, JSON.stringify(retry))
        const committed = t.state(f)
        assert.equal((await invoke()).status, 200)
        assert.deepEqual(t.state(f), committed, 'same key/generation recovers without duplicate history or stock')
        console.log('PASS unrelated failure/rollback/same-key retry ' + JSON.stringify({ tier, direction, fault }))
      } finally { f.sql.close() }
    }
  }
}

async function known(make) {
  for (const tier of ['free', 'paid']) for (const direction of ['apply', 'undo', 'redo']) for (const fault of ['root', 'tag_set', 'actor']) {
    const { f, invoke } = await prepared(make, tier, direction)
    try {
      const sql = {
        root: "UPDATE inventory_movements SET reason='Rival original source' WHERE id=500",
        tag_set: "INSERT INTO damaged_stock_lots(id,product_id,branch_id,batch_id,quantity,quantity_remaining,condition_tag,source)VALUES(90,1,1,NULL,0,0,'damaged','remove')",
        actor: 'UPDATE users SET is_active=0 WHERE id=7',
      }[fault]
      let rival
      f.beforeCommit(async () => {
        await h.loadStockSession('lib/stockTransaction.ts').executeStockTransaction(h.loadStockSession('lib/db.ts').getDb(f.env), [{ sql }], 'once')
        rival = t.state(f)
      })
      const result = await invoke()
      assert.equal(result.status, 409, JSON.stringify(result))
      assert.deepEqual(t.state(f), rival, 'owned preimage conflict preserves rival and adds no effects')
      assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
      console.log('PASS exact owned guard conflict ' + JSON.stringify({ tier, direction, fault, code: result.json.code }))
    } finally { f.sql.close() }
  }
}

async function main() {
  const make = await h.bundle.exports.bundleWorker()
  await unrelated(make)
  await known(make)
}
module.exports = { prepared, unrelated, known }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
