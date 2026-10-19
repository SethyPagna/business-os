const assert = require('node:assert/strict')
const { world, begin } = require('./test-branch-cutover-parent-native.cjs')

function snapshot(raw) {
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  return tables.map(({ name }) => [name, raw.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()])
}

async function main() {
  const current = world(true, { currentSchema: true })
  try {
    const before = snapshot(current.raw)
    await assert.rejects(begin(current), error => error.code === 'branch_cutover_parent_capability'
      && error.message === 'unclassified_scalar_reference:inventory_check_items.branch_id;unclassified_scalar_reference:inventory_check_sessions.branch_id')
    assert.equal(current.stats.batches, 0, 'the archived cutover refuses new immutable count references before writing')
    assert.deepEqual(snapshot(current.raw), before)
    console.log('PASS archived cutover refuses the additive Inventory schema before any write')
  } finally { current.raw.close() }
  const w = world(true, { currentSchema: true, through: 258 })
  try {
    assert.equal(w.raw.prepare("SELECT value FROM system_flags WHERE key='stock_schema_epoch'").get().value, 'legacy-separate-pool-v1')
    const before = snapshot(w.raw)
    await assert.rejects(begin(w), error => error.code === 'branch_cutover_parent_outcome_unknown' && /stock_transaction_required/.test(String(error.cause)))
    assert.ok(w.stats.batches > 0)
    assert.deepEqual(snapshot(w.raw), before)
    assert.equal(w.raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    console.log('PASS archived cutover still reaches and rolls back the stock transaction guard on the pre-Inventory guarded schema')
  } finally {
    w.raw.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
