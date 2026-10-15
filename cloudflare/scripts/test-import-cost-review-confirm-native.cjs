const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const harnessPath = path.join(__dirname, 'test-import-invocation-budget-native.cjs')
let harness = fs.readFileSync(harnessPath, 'utf8')
const mainStart = harness.indexOf('async function main()')
assert.ok(mainStart > 0)
harness = harness.slice(0, mainStart).replace('log: new Log(LogLevel.ERROR),', "outboundService: () => new Response('External requests blocked', { status: 503 }), log: new Log(LogLevel.ERROR),")
const loaded = { exports: {} }
new Function('require', '__dirname', 'module', harness + '\nmodule.exports = { world, waitFor, sub }')(createRequire(harnessPath), __dirname, loaded)
const { world, waitFor, sub } = loaded.exports

async function importCsv(h, csv, fields = ['cost_price_usd']) {
  const created = await h.api('POST', '/api/import-jobs', { type: 'products', policy: { import_mode: 'replace_columns', replace_columns: fields } })
  assert.equal(created.status, 200, JSON.stringify(created))
  const id = created.body.job.id
  assert.equal((await h.upload(`/api/import-jobs/${id}/csv`, 'confirmation.csv', csv)).status, 200)
  assert.equal((await h.api('POST', `/api/import-jobs/${id}/start`, {})).status, 200)
  const analyzed = await waitFor(h, id, ['awaiting_review'], 90000)
  assert.equal(analyzed.status, 'awaiting_review', JSON.stringify(analyzed))
  const approved = await h.api('POST', `/api/import-jobs/${id}/approve`, {})
  assert.equal(approved.status, 200, JSON.stringify(approved))
  const finished = await waitFor(h, id, ['completed', 'completed_with_errors', 'failed'], 90000)
  assert.equal(finished.status, 'completed', JSON.stringify(finished))
  return id
}

async function seed(h) {
  const guard = await h.q1("SELECT sql FROM sqlite_master WHERE name='product_cost_review_update_guard_0255'")
  await h.db.batch([
    h.db.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"),
    ...['Changed', 'Zero', 'Echo', 'Blank', 'KHR', 'Adjacent', 'Split', 'Mean'].map((name, i) =>
      h.db.prepare('INSERT INTO products(id,name,cost_price_usd,cost_price_khr,is_active) VALUES(?,?,?,123.456,1)').bind(61000 + i, name, ['Changed','Zero','Adjacent','Split'].includes(name) ? null : 7)),
    h.db.prepare('DROP TRIGGER product_cost_review_update_guard_0255'),
    h.db.prepare("UPDATE products SET cost_review_key='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' WHERE id BETWEEN 61000 AND 61007"),
    h.db.prepare(guard.sql),
    h.db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'"),
  ])
}

;(async () => {
  for (const plan of (process.env.IMPORT_CONFIRM_PLANS || 'free,paid').split(',')) {
    const h = await world({ plan, mutant: null })
    try {
      await seed(h)
      await h.invocations(true)
      const csv = ['name,cost_usd,_action', 'Changed,9.1234,', 'Zero,0,', 'Echo,7,', 'Blank,,', 'Mean,9,', 'Adjacent,9,', 'Adjacent,NULL,', 'Split,9,',
        ...Array.from({ length: 125 }, () => 'Echo,7,skip_row'), 'Split,NULL,'].join('\n')
      await importCsv(h, csv)
      await importCsv(h, 'name,cost_khr\nKHR,456', ['cost_price_khr'])
      const rows = await h.q('SELECT id,name,cost_price_usd,cost_review_key FROM products WHERE id BETWEEN 61000 AND 61007 ORDER BY id')
      for (const name of ['Changed', 'Zero', 'Adjacent', 'Split']) assert.equal(rows.find(row => row.name === name).cost_review_key, null, name)
      for (const name of ['Echo', 'Blank', 'KHR', 'Mean']) assert.equal(rows.find(row => row.name === name).cost_review_key, 'a'.repeat(32), name)
      assert.equal(rows.find(row => row.name === 'Changed').cost_price_usd, 9.1234)
      assert.equal(rows.find(row => row.name === 'Zero').cost_price_usd, 0)
      assert.equal(rows.find(row => row.name === 'Adjacent').cost_price_usd, rows.find(row => row.name === 'Split').cost_price_usd)
      const proofs = await h.q("SELECT entity_id,COUNT(*) n FROM audit_logs WHERE json_extract(CASE WHEN json_valid(details) THEN details ELSE '{}' END,'$.source')='explicit-cost-edit' GROUP BY entity_id")
      assert.deepEqual(proofs.map(row => [row.entity_id, row.n]).sort(), ['61000','61001','61005','61006'].map(id => [id, 1]))
      assert.equal((await h.q1("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit' OR key LIKE 'cost-review-edit:%'")).n, 0)
      const metrics = await h.invocations(true)
      const maximum = Math.max(0, ...metrics.map(sub))
      assert.ok(metrics.every(row => sub(row) <= (plan === 'free' ? 50 : 1000)), JSON.stringify({ maximum }))
      console.log('PASS actual import confirmation', JSON.stringify({ plan, maximum, invocations: metrics.length, products: rows.length, confirmations: proofs.length }))
    } finally { await h.dispose() }
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
