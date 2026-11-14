'use strict'
// B-C7 end to end (audit 14 Nov): importing the same CSV a second time must write ~0 product / contact rows and leave the data
// identical. Before the fix every matched row was rewritten in full (all columns, updated_at, three FTS triggers, the stock-revision
// trigger); now a contact row that changes nothing is a skip, and a product's whole-row UPDATE is conditional on a real difference.
//
// The real Worker (bundled), queue consumer, D1 and import tables run in Miniflare (the harness of
// test-import-invocation-budget-native.cjs, as test-cost-mirror-import-native.cjs does). After the FIRST import every touched row's
// updated_at is moved to a fixed old stamp; a second import of the identical file must leave that stamp (a rewrite sets "now"), the
// stock-revision counters and the rows themselves exactly as they were. A changed cell in a third import is still written.
//
// Run: node scripts/test-import-twice-writes-nothing-native.cjs
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

async function importCsv(h, type, csv, policy = {}) {
  const created = await h.api('POST', '/api/import-jobs', { type, policy })
  assert.equal(created.status, 200, JSON.stringify(created))
  const id = created.body.job.id
  assert.equal((await h.upload(`/api/import-jobs/${id}/csv`, `${type}.csv`, csv)).status, 200)
  assert.equal((await h.api('POST', `/api/import-jobs/${id}/start`, {})).status, 200)
  const analyzed = await waitFor(h, id, ['awaiting_review'], 120000)
  assert.equal(analyzed.status, 'awaiting_review', JSON.stringify(analyzed))
  assert.equal((await h.api('POST', `/api/import-jobs/${id}/approve`, {})).status, 200)
  const finished = await waitFor(h, id, ['completed', 'completed_with_errors', 'failed'], 120000)
  assert.equal(finished.status, 'completed', JSON.stringify(finished))
  return { id, finished }
}

const OLD = '2001-01-01T00:00:00.000Z'

async function main() {
  const h = await world({ plan: 'paid', mutant: null })
  try {
    const rowsOf = async (sql) => (await h.db.prepare(sql).all()).results.map((r) => ({ ...r }))
    const revisions = async () => JSON.stringify(await rowsOf("SELECT entity_type, entity_key, revision FROM stock_session_revisions WHERE entity_type IN ('product','product_catalog') ORDER BY entity_type, entity_key"))

    // ---- contacts: customers, suppliers, delivery contacts ----
    const CONTACTS = {
      customers: ['name,phone,address,notes,email,gender', 'Sopheap,012345678,Phnom Penh,VIP,a@b.co,female', 'Dara,098765432,Siem Reap,,,male'].join('\n'),
      suppliers: ['name,phone,address,notes,email,company,contact_person', 'Acme Co,023111222,PP,,,Acme,Dara'].join('\n'),
      delivery_contacts: ['name,phone,area,notes', 'Rider One,077000111,Daun Penh,fast'].join('\n'),
    }
    for (const [table, csv] of Object.entries(CONTACTS)) {
      await importCsv(h, table, csv)
      const created = await rowsOf(`SELECT * FROM ${table} ORDER BY id`)
      assert.ok(created.length >= 1, `${table}: the first import created rows`)
      await h.db.prepare(`UPDATE ${table} SET updated_at = ?`).bind(OLD).run()
      const before = JSON.stringify(await rowsOf(`SELECT * FROM ${table} ORDER BY id`))

      const second = await importCsv(h, table, csv)
      assert.equal(JSON.stringify(await rowsOf(`SELECT * FROM ${table} ORDER BY id`)), before, `${table}: the second import of the same file wrote no row (updated_at is still the old stamp, data identical)`)
      const review = (await h.api('GET', `/api/import-jobs/${second.id}/review?pageSize=50`)).body
      const counts = review && review.counts
      assert.ok(counts, `${table}: the job report still carries its row counts`)
      assert.equal(Number(counts.update || 0), 0, `${table}: no row is an update`)
      assert.equal(Number(counts.skip || 0), created.length, `${table}: every row shows in the report as a skip, none vanished`)
      assert.equal(Number(counts.error || 0), 0, `${table}: no row errored`)
      const reviewRows = (review && review.rows) || []
      assert.ok(reviewRows.length === created.length && reviewRows.every((r) => r.action === 'skip' && r.code === 'contact_import_unchanged'), `${table}: the review lists each row as an unchanged skip with its code: ${JSON.stringify(reviewRows).slice(0, 300)}`)

      // a real change in a later file is still written
      const changed = csv.replace(/\n/, '\n').split('\n').map((line, index) => (index === 1 ? line.replace(/,[^,]*$/, ',changed note') : line)).join('\n')
      assert.notEqual(changed, csv)
      await importCsv(h, table, changed, { conflictMode: 'overwrite' })
      const after = await rowsOf(`SELECT * FROM ${table} ORDER BY id`)
      assert.notEqual(JSON.stringify(after), before, `${table}: a changed cell is still written by a later import`)
      assert.notEqual(after[0].updated_at, OLD, `${table}: and its updated_at moves`)
      console.log(`PASS ${table}: second import of the same file wrote 0 rows and reported ${created.length} unchanged skip(s); a changed file still writes`)
    }

    // ---- products: the whole-row UPDATE ----
    const PRODUCTS = ['name,sku,barcode,category,brand,unit,selling_price_usd,cost_usd,stock_quantity', 'Twice A,TW-A,885100000001,Care,Acme,pcs,2.5,1.25,0', 'Twice B,TW-B,885100000002,Care,Acme,pcs,3.5,2,0'].join('\n')
    await importCsv(h, 'products', PRODUCTS)
    const made = await rowsOf("SELECT id, name FROM products WHERE sku IN ('TW-A','TW-B') ORDER BY id")
    assert.equal(made.length, 2, 'the first import created both products')
    await h.db.batch([
      h.db.prepare("INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"),
      h.db.prepare("UPDATE products SET updated_at = ? WHERE sku IN ('TW-A','TW-B')").bind(OLD),
      h.db.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'"),
    ])
    const productsBefore = JSON.stringify(await rowsOf("SELECT * FROM products WHERE sku IN ('TW-A','TW-B') ORDER BY id"))
    const revisionsBefore = await revisions()
    await importCsv(h, 'products', PRODUCTS, { productImportMode: 'merge' })
    assert.equal(JSON.stringify(await rowsOf("SELECT * FROM products WHERE sku IN ('TW-A','TW-B') ORDER BY id")), productsBefore, 'products: the second import of the same file wrote no product row')
    assert.equal(await revisions(), revisionsBefore, 'products: no product trigger fired (stock-revision counters did not move)')
    // a changed price in a later file is still written
    await importCsv(h, 'products', PRODUCTS.replace('2.5,1.25', '2.75,1.25'), { productImportMode: 'merge' })
    const priced = await rowsOf("SELECT selling_price_usd, updated_at FROM products WHERE sku = 'TW-A'")
    assert.equal(priced[0].selling_price_usd, 2.75, 'products: the changed price was written')
    assert.notEqual(priced[0].updated_at, OLD, 'products: and updated_at moved')
    const untouched = await rowsOf("SELECT updated_at FROM products WHERE sku = 'TW-B'")
    assert.equal(untouched[0].updated_at, OLD, 'products: the row whose cells did not change was still not written')
    console.log('PASS products: second import of the same file wrote 0 product rows and fired no product trigger; a changed price writes only its own row')
  } finally {
    await h.dispose?.()
  }
  console.log('test-import-twice-writes-nothing-native: all checks passed')
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1) })
