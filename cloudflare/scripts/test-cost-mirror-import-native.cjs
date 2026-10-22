'use strict'
// Lane 6.0.944: the product import writes the purchase_price_* twin with the cost in the same statement, in every mode that
// writes one: a new product (INSERT), a matched row in the default merge mode and with an explicit override_replace (full
// UPDATE), fill_blank, and replace_columns with the cost columns selected. The real Worker (bundled), queue consumer, D1 and
// import tables run in Miniflare (the harness of test-import-invocation-budget-native.cjs); 18 of the 21 products behind
// health-catalog-cost.active_mirror_drift came from a product import.
//
// Run: node scripts/test-cost-mirror-import-native.cjs
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')

const harnessPath = path.join(__dirname, 'test-import-invocation-budget-native.cjs')
let harness = fs.readFileSync(harnessPath, 'utf8')
const mainStart = harness.indexOf('async function main()')
assert.ok(mainStart > 0, 'the import harness moved')
harness = harness.slice(0, mainStart).replace('log: new Log(LogLevel.ERROR),', "outboundService: () => new Response('External requests blocked', { status: 503 }), log: new Log(LogLevel.ERROR),")
const loaded = { exports: {} }
new Function('require', '__dirname', 'module', `${harness}\nmodule.exports = { world, waitFor }`)(createRequire(harnessPath), __dirname, loaded)
const { world, waitFor } = loaded.exports

async function importCsv(h, csv, policy = {}) {
  const created = await h.api('POST', '/api/import-jobs', { type: 'products', policy })
  assert.equal(created.status, 200, JSON.stringify(created))
  const id = created.body.job.id
  assert.equal((await h.upload(`/api/import-jobs/${id}/csv`, 'cost-mirror.csv', csv)).status, 200)
  assert.equal((await h.api('POST', `/api/import-jobs/${id}/start`, {})).status, 200)
  const analyzed = await waitFor(h, id, ['awaiting_review'], 120000)
  assert.equal(analyzed.status, 'awaiting_review', JSON.stringify(analyzed))
  assert.equal((await h.api('POST', `/api/import-jobs/${id}/approve`, {})).status, 200)
  const finished = await waitFor(h, id, ['completed', 'completed_with_errors', 'failed'], 120000)
  assert.equal(finished.status, 'completed', JSON.stringify(finished))
}

// (name, cost usd, cost khr, twin usd, twin khr): the split rows are what a cost-only writer leaves behind
const SEED = [['Merge target', 5, null, 0, 0], ['Override target', 5, 20000, 0, 0], ['Fill target', null, null, 0, 0], ['Replace target', 5, 20000, 0, 0], ['Untouched', 4, 16000, 0, 0]]

async function main() {
  const h = await world({ plan: 'paid', mutant: null })
  try {
    const statements = [
      h.db.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"),
      ...SEED.map(([name, cu, ck, pu, pk], i) => h.db.prepare('INSERT INTO products(id,name,cost_price_usd,cost_price_khr,purchase_price_usd,purchase_price_khr,is_active) VALUES(?,?,?,?,?,?,1)').bind(63000 + i, name, cu, ck, pu, pk)),
      h.db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'"),
    ]
    await h.db.batch(statements)
    const read = async name => { const r = await h.q1('SELECT cost_price_usd, purchase_price_usd, cost_price_khr, purchase_price_khr FROM products WHERE name = ?', name); return r && { ...r } }

    // The full UPDATEs: an override_add and an override_replace row of a matched product, and a new product's INSERT. A matched
    // row with no _action in merge mode is a stock merge and writes no field. The file's cost is merged with the stored one (a mean),
    // so these assert the twin IS the stored cost, and that the write happened.
    await importCsv(h, ['name,cost_usd,cost_khr,stock_quantity,_action', 'Merge target,7,28000,0,override_add', 'Override target,8.5,34000,0,override_replace', 'New costed,6,24000,0,', 'New unknown,,,0,'].join('\n'))
    const twinned = async (name, before) => {
      const row = await read(name)
      assert.notEqual(row.cost_price_usd, before.cost_price_usd, `${name}: the import wrote the cost`)
      assert.deepEqual(row, { cost_price_usd: row.cost_price_usd, purchase_price_usd: row.cost_price_usd, cost_price_khr: row.cost_price_khr, purchase_price_khr: row.cost_price_khr }, `${name}: cost and twin move together`)
      assert.ok(row.cost_price_khr > 0, `${name}: the KHR cost was written`)
    }
    await twinned('Merge target', { cost_price_usd: 5 })
    await twinned('Override target', { cost_price_usd: 5 })
    assert.deepEqual(await read('New costed'), { cost_price_usd: 6, purchase_price_usd: 6, cost_price_khr: 24000, purchase_price_khr: 24000 }, 'INSERT of a new product')
    assert.deepEqual(await read('New unknown'), { cost_price_usd: null, purchase_price_usd: 0, cost_price_khr: null, purchase_price_khr: 0 }, 'a new product with no cost: unknown, twin 0')

    // fill_blank: the blank cost is filled and its twin with it
    await importCsv(h, ['name,cost_usd,cost_khr,stock_quantity', 'Fill target,9.5,38000,0'].join('\n'), { import_mode: 'fill_blank' })
    assert.deepEqual(await read('Fill target'), { cost_price_usd: 9.5, purchase_price_usd: 9.5, cost_price_khr: 38000, purchase_price_khr: 38000 }, 'fill_blank UPDATE')

    // replace_columns: only the selected columns are written, a selected cost column carries its twin, an unselected one does not
    await importCsv(h, ['name,cost_usd,cost_khr', 'Replace target,11,44000'].join('\n'), { import_mode: 'replace_columns', replace_columns: ['cost_price_usd'] })
    assert.deepEqual(await read('Replace target'), { cost_price_usd: 11, purchase_price_usd: 11, cost_price_khr: 20000, purchase_price_khr: 0 }, 'replace_columns writes only the selected cost column and its twin')
    await importCsv(h, ['name,cost_usd,cost_khr', 'Replace target,11,44000'].join('\n'), { import_mode: 'replace_columns', replace_columns: ['cost_price_khr'] })
    assert.deepEqual(await read('Replace target'), { cost_price_usd: 11, purchase_price_usd: 11, cost_price_khr: 44000, purchase_price_khr: 44000 })

    assert.deepEqual(await read('Untouched'), { cost_price_usd: 4, purchase_price_usd: 0, cost_price_khr: 16000, purchase_price_khr: 0 }, 'a product the file does not name is not touched (0269 repairs what exists)')
    assert.equal((await h.q1("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'")).n, 0)
    // 0269 ran on the empty chain in workerd D1 as part of the migrations the harness applies
    assert.ok(await h.q1("SELECT name FROM sqlite_master WHERE type='table' AND name='product_cost_mirror_0269'"), '0269 is part of the chain workerd applied')
    console.log('test-cost-mirror-import-native: 6 checks passed (INSERT, override_add, override_replace, fill_blank, replace_columns usd and khr)')
  } finally { await h.dispose() }
}

main().catch(error => { console.error(error); process.exit(1) })
