const assert = require('node:assert/strict')
const { world, begin } = require('./test-branch-cutover-parent-native.cjs')

function snapshot(raw) {
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  return tables.map(({ name }) => [name, raw.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()])
}

async function main() {
  const w = world(true, { currentSchema: true })
  try {
    assert.equal(w.raw.prepare("SELECT value FROM system_flags WHERE key='stock_schema_epoch'").get().value, 'legacy-separate-pool-v1')
    const before = snapshot(w.raw)
    await assert.rejects(begin(w), error => error.code === 'branch_cutover_parent_outcome_unknown' && /stock_transaction_required/.test(String(error.cause)))
    assert.ok(w.stats.batches > 0)
    assert.deepEqual(snapshot(w.raw), before)
    assert.equal(w.raw.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
    console.log('PASS archived cutover begin refuses on the current schema without changing any table')
  } finally {
    w.raw.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
