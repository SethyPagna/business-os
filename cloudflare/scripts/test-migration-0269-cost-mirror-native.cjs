'use strict'
// Pins migration 0269 (product cost mirror backfill, lane 6.0.944) on the real chain of every earlier migration:
// the write set is exactly the ACTIVE products whose purchase_price_* twin is not aligned with cost_price_* (three drift
// kinds from production plus KHR, a stale positive twin on an unknown cost and a lot-derived row), every control (in sync,
// NULL/NULL, NULL/0, recorded $0, inactive, lot-derived in sync) is byte-identical, the ledger records before and after,
// the PRE bound and each POST assertion fire (proven by mutating the file), a second apply aborts, the documented RECOVERY
// restores, and the same statements, split by wrangler's own splitter, give the same rows on workerd D1 (Miniflare) with an
// aborted batch rolled back whole.
//
// Run: node scripts/test-migration-0269-cost-mirror-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const directory = path.join(__dirname, '../migrations')
const migration = '0269_product_cost_mirror_backfill.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const PERMIT = "INSERT INTO system_flags(key,value) SELECT 'stock_transaction_permit',value FROM system_flags WHERE key='stock_schema_epoch'"

const base = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter(f => f.endsWith('.sql') && f < migration).sort()) base.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
const schema = base.serialize()
base.close()

let passed = 0
const check = (name, run) => Promise.resolve(run()).then(() => { passed++; console.log(`PASS ${name}`) })

// name, cost usd, cost khr, purchase usd, purchase khr, active, scope?, expected after [usd, khr]
const SPEC = [
  ['import 6', 6, null, 0, 0, 1, true, [6, 0]],
  ['import 33 + khr', 33, 132000, 0, 0, 1, true, [33, 132000]],
  ['import 30.5', 30.5, null, 0, 0, 1, true, [30.5, 0]],
  ['override 51 (both set, differ)', 12, null, 9, null, 1, true, [12, null]],
  ['precision a', 12.3457, null, 12.34568, 0, 1, true, [12.3457, 0]],
  ['precision b', 3.1, null, 3.10004, 0, 1, true, [3.1, 0]],
  ['unknown cost, positive twin', null, null, 5, 0, 1, true, [0, 0]],
  ['recorded $0, stale twin', 0, null, 5, 0, 1, true, [0, 0]],
  ['known cost, NULL twin', 8, null, null, 0, 1, true, [8, 0]],
  ['khr only', 5, 20000, 5, 0, 1, true, [5, 20000]],
  ['in sync', 4, null, 4, 0, 1, false],
  ['khr in sync', 4, 4000, 4, 4000, 1, false],
  ['NULL / NULL', null, null, null, null, 1, false],
  ['NULL / 0', null, null, 0, 0, 1, false],
  ['recorded $0 / 0', 0, 0, 0, 0, 1, false],
  ['inactive, drifting', 7, null, 0, 0, 0, false],
  ['inactive, unknown + positive twin', null, null, 5, 0, 0, false],
]
// Lot-derived rows: the 0195 triggers write cost = twin = the lot's cost; one is then split by hand (derive has a figure but
// the migration must still follow the cost column, not re-derive), one is left in sync.
const LOTS = [['lot derived, in sync', 5, false], ['lot derived, twin split', 6, true]]
const SCOPE_FIXTURE_ROWS = SPEC.filter(s => s[6]).length + 1 // plus the split lot-derived row

function seeded(extra = 0, inactiveExtra = 0) {
  const db = new Database(schema)
  const ids = {}
  seedStockFixture(db, () => {
    const add = db.prepare('INSERT INTO products(name, cost_price_usd, cost_price_khr, purchase_price_usd, purchase_price_khr, is_active) VALUES (?,?,?,?,?,?)')
    for (const [name, cu, ck, pu, pk, active] of SPEC) ids[name] = Number(add.run(name, cu, ck, pu, pk, active).lastInsertRowid)
    db.prepare("INSERT INTO branches(name) VALUES ('Fixture')").run()
    for (const [name, lotCost] of LOTS) {
      ids[name] = Number(add.run(name, 99, null, 99, 0, 1).lastInsertRowid)
      db.prepare("INSERT INTO product_batches(variant_product_id, batch_key, is_active, unit_cost_usd, received_at) VALUES (?, 'k1', 1, ?, '2026-10-01')").run(ids[name], lotCost)
    }
    for (let i = 0; i < extra; i++) add.run(`bulk ${i}`, 10 + i, null, 0, 0, 1)
    for (let i = 0; i < inactiveExtra; i++) add.run(`retired ${i}`, 10 + i, null, 0, 0, 0)
  })
  for (const [name, , split] of LOTS) {
    assert.deepEqual(db.prepare('SELECT cost_price_usd c, purchase_price_usd p FROM products WHERE id=?').get(ids[name]), { c: LOTS.find(l => l[0] === name)[1], p: LOTS.find(l => l[0] === name)[1] }, 'the lot trigger derived both columns')
    if (split) seedStockFixture(db, () => db.prepare('UPDATE products SET purchase_price_usd = 0 WHERE id = ?').run(ids[name]))
  }
  db.prepare("INSERT OR REPLACE INTO cache_versions(namespace, version) VALUES ('products', 7)").run()
  return { db, ids }
}
const products = db => db.prepare('SELECT * FROM products ORDER BY id').all()
const scopeIds = ids => [...SPEC.filter(s => s[6]).map(s => ids[s[0]]), ids['lot derived, twin split']].sort((a, b) => a - b)
const revisions = db => Object.fromEntries(db.prepare("SELECT entity_key k, revision r FROM stock_session_revisions WHERE entity_type='product'").all().map(r => [r.k, r.r]))
const stripOnly = (rows, ids) => rows.filter(r => !ids.includes(r.id))
const abortName = (error) => (/bad JSON path: '\$\[(\w+)\]'/.exec(String(error.message)) || [])[1]
const mutate = (from, to) => { assert.ok(sql.includes(from), `mutation anchor missing: ${from.slice(0, 50)}`); assert.equal(sql.split(from).length, 2, `mutation anchor not unique: ${from.slice(0, 50)}`); return sql.replace(from, to) }

async function main() {
  await check('the file is LF-only and carries PRE, POST and RECOVERY notes; it splits into 16 whole statements', () => {
    assert.equal(sql.includes('\r'), false)
    for (const word of ['PRE:', 'POST:', 'RECOVERY']) assert.ok(sql.includes(word), word)
    const chunks = require('wrangler').unstable_splitSqlQuery(sql)
    assert.equal(chunks.length, 16, 'a CASE closed by END, or END) swallows the rest of the file in wrangler\'s splitter')
    assert.ok(chunks.every(c => /^(SELECT|CREATE TABLE|INSERT INTO|UPDATE|DELETE FROM|DROP TABLE) /.test(c)), chunks.map(c => c.slice(0, 20)).join(' | '))
    assert.doesNotMatch(sql, /CREATE\s+TRIGGER/i)
  })

  await check('writes exactly the active, non-aligned twins; every control is byte-identical; costs and updated_at never move', () => {
    const { db, ids } = seeded()
    const before = products(db)
    const revBefore = revisions(db)
    db.exec(sql)
    const after = products(db)
    assert.equal(after.length, before.length)
    const scope = scopeIds(ids)
    assert.deepEqual(stripOnly(after, scope), stripOnly(before, scope), 'controls (in sync, NULL/NULL, NULL/0, $0, inactive, lot-derived in sync)')
    for (const row of after.filter(r => scope.includes(r.id))) {
      const was = before.find(r => r.id === row.id)
      for (const column of Object.keys(row).filter(c => c !== 'purchase_price_usd' && c !== 'purchase_price_khr')) assert.deepEqual(row[column], was[column], `${row.name}.${column} is not the twin`)
    }
    for (const [name, , , , , , in_scope, expected] of SPEC.filter(s => s[6])) {
      const row = after.find(r => r.id === ids[name])
      assert.deepEqual([row.purchase_price_usd, row.purchase_price_khr], expected, name)
    }
    const split = after.find(r => r.id === ids['lot derived, twin split'])
    assert.deepEqual([split.cost_price_usd, split.purchase_price_usd], [6, 6], 'the twin follows the cost column')
    // the revision trigger fired once per written row (open editors see a new revision), and for no other row
    const revAfter = revisions(db)
    for (const [key, revision] of Object.entries(revAfter)) if (key !== 'all') assert.equal(revision - (revBefore[key] || 0), scope.includes(Number(key)) ? 1 : 0, `revision of product ${key}`)
    assert.equal(db.prepare("SELECT version FROM cache_versions WHERE namespace='products'").get().version, 8, 'products cache version bumped')
    assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0, 'no permit left behind')
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = '_product_cost_mirror_0269_fingerprint'").get().n, 0, 'the helper table is dropped')
  })

  await check('the ledger holds one row per written product: cost at repair, before and after twin, exactly as stored', () => {
    const { db, ids } = seeded()
    const before = products(db)
    db.exec(sql)
    const ledger = db.prepare('SELECT product_id, cost_price_usd, cost_price_khr, before_purchase_usd, before_purchase_khr, after_purchase_usd, after_purchase_khr FROM product_cost_mirror_0269 ORDER BY product_id').all()
    assert.deepEqual(ledger.map(r => r.product_id), scopeIds(ids))
    const row = (name) => ledger.find(r => r.product_id === ids[name])
    assert.deepEqual(row('override 51 (both set, differ)'), { product_id: ids['override 51 (both set, differ)'], cost_price_usd: 12, cost_price_khr: null, before_purchase_usd: 9, before_purchase_khr: null, after_purchase_usd: 12, after_purchase_khr: null },
      'an aligned twin (NULL/NULL khr) is neither coerced nor rewritten; the stale usd twin 9 becomes the cost 12')
    assert.deepEqual(row('known cost, NULL twin'), { product_id: ids['known cost, NULL twin'], cost_price_usd: 8, cost_price_khr: null, before_purchase_usd: null, before_purchase_khr: 0, after_purchase_usd: 8, after_purchase_khr: 0 })
    assert.deepEqual(row('precision a'), { product_id: ids['precision a'], cost_price_usd: 12.3457, cost_price_khr: null, before_purchase_usd: 12.34568, before_purchase_khr: 0, after_purchase_usd: 12.3457, after_purchase_khr: 0 })
    for (const r of ledger) {
      const was = before.find(p => p.id === r.product_id)
      assert.deepEqual([r.cost_price_usd, r.cost_price_khr, r.before_purchase_usd, r.before_purchase_khr], [was.cost_price_usd, was.cost_price_khr, was.purchase_price_usd, was.purchase_price_khr])
    }
    assert.deepEqual(db.prepare("SELECT typeof(before_purchase_usd) t FROM product_cost_mirror_0269 WHERE product_id = ?").get(ids['known cost, NULL twin']), { t: 'null' }, 'untyped columns keep NULL as NULL')
  })

  await check('PRE: a scope of exactly 100 applies, 101 aborts before anything is written', () => {
    const hundred = seeded(100 - SCOPE_FIXTURE_ROWS, 150) // inactive rows never count toward the bound
    hundred.db.exec(sql)
    assert.equal(hundred.db.prepare('SELECT COUNT(*) n FROM product_cost_mirror_0269').get().n, 100)
    const over = seeded(100 - SCOPE_FIXTURE_ROWS + 1)
    const snapshot = products(over.db)
    assert.throws(() => over.db.exec(sql), error => abortName(error) === 'cost_mirror_0269_pre_scope_over_100')
    assert.deepEqual(products(over.db), snapshot)
    assert.equal(over.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name = 'product_cost_mirror_0269'").get().n, 0, 'nothing was created')
  })

  await check('PRE: a maintenance flag, a leftover permit or an epoch other than legacy-separate-pool-v1 aborts before anything is written', () => {
    for (const [label, setup] of [['maintenance', db => seedStockFixture(db, () => db.prepare("INSERT INTO system_flags(key,value) VALUES('maintenance','{\"mode\":\"import\"}')").run())],
      ['permit', db => db.exec(PERMIT)],
      ['another epoch', db => db.exec("UPDATE system_flags SET value = 'other-epoch-v2' WHERE key = 'stock_schema_epoch'")]]) {
      const { db } = seeded()
      setup(db)
      const snapshot = products(db)
      assert.throws(() => db.exec(sql), error => abortName(error) === 'cost_mirror_0269_pre_state', label)
      assert.deepEqual(products(db), snapshot, label)
    }
  })

  await check('a database built without 0243 and 0258 (the stock-bridge harnesses apply them last) has no epoch and no guard: it repairs without a permit', () => {
    const bare = new Database(':memory:')
    for (const file of fs.readdirSync(directory).filter(f => f.endsWith('.sql') && f < migration && !/^0(243|258)_/.test(f)).sort()) bare.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
    assert.equal(bare.prepare("SELECT COUNT(*) n FROM system_flags WHERE key = 'stock_schema_epoch'").get().n, 0, 'no epoch in this chain')
    bare.exec("INSERT INTO products(id, name, cost_price_usd, purchase_price_usd, is_active) VALUES (1, 'split', 6, 0, 1), (2, 'in sync', 4, 4, 1)")
    bare.exec(sql)
    assert.deepEqual(bare.prepare('SELECT id, cost_price_usd c, purchase_price_usd p FROM products ORDER BY id').all(), [{ id: 1, c: 6, p: 6 }, { id: 2, c: 4, p: 4 }])
    assert.deepEqual(bare.prepare('SELECT product_id FROM product_cost_mirror_0269').all(), [{ product_id: 1 }])
    assert.equal(bare.prepare("SELECT COUNT(*) n FROM system_flags WHERE key IN ('stock_transaction_permit', 'stock_schema_epoch')").get().n, 0, 'no permit was invented')
  })

  await check('a second apply aborts without writing; with the ledger dropped it finds nothing to do', () => {
    const { db } = seeded()
    db.exec(sql)
    const migrated = products(db)
    assert.throws(() => db.exec(sql), /table product_cost_mirror_0269 already exists/)
    assert.deepEqual(products(db), migrated)
    db.exec('DROP TABLE product_cost_mirror_0269')
    db.exec(sql)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM product_cost_mirror_0269').get().n, 0, 'the scope is empty once nothing drifts')
    assert.deepEqual(products(db), migrated)
  })

  await check('POST: every assertion is live (each mutation of the file aborts with its own name)', () => {
    // a stray write inside the permit window, where 0258 still lets it through: only the POST checks can catch it
    const stray = statement => mutate("DELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';",
      `${statement}\nDELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';`)
    const cases = [
      ['permit left behind', mutate("DELETE FROM system_flags WHERE key = 'stock_transaction_permit' AND value = 'legacy-separate-pool-v1';", 'SELECT 1;'), 'cost_mirror_0269_post_permit_left'],
      ['a drifting row is missed by the write', mutate('WHERE id IN (SELECT product_id FROM product_cost_mirror_0269);', 'WHERE id IN (SELECT product_id FROM product_cost_mirror_0269) AND id <> (SELECT MIN(product_id) FROM product_cost_mirror_0269);'), 'cost_mirror_0269_post_active_drift'],
      ['the ledger disagrees with the row it describes', mutate('SELECT id, cost_price_usd, cost_price_khr, purchase_price_usd,', 'SELECT id, cost_price_usd + 0.5, cost_price_khr, purchase_price_usd,'), 'cost_mirror_0269_post_ledger'],
      ['an in-sync row has its cost and twin changed together', stray("UPDATE products SET cost_price_usd = 99, purchase_price_usd = 99 WHERE name = 'in sync';"), 'cost_mirror_0269_post_rows_or_costs_changed'],
      ['an inactive row has its twin changed', stray("UPDATE products SET purchase_price_usd = 77 WHERE name = 'inactive, drifting';"), 'cost_mirror_0269_post_outside_scope_changed'],
    ]
    for (const [label, text, expected] of cases) {
      const { db } = seeded()
      assert.throws(() => db.exec(text), error => abortName(error) === expected, `${label}: expected ${expected}`)
    }
  })

  await check('RECOVERY as documented in the file puts the old twins back, and leaves a row edited since alone', () => {
    const { db, ids } = seeded()
    const before = products(db)
    db.exec(sql)
    const edited = ids['import 6']
    seedStockFixture(db, () => db.prepare('UPDATE products SET cost_price_usd = 6.5, purchase_price_usd = 6.5 WHERE id = ?').run(edited))
    const lines = sql.split('\n')
    const from = lines.findIndex(l => l.startsWith('-- RECOVERY')) + 1
    const recovery = lines.slice(from, from + lines.slice(from).findIndex(l => !l.startsWith('--   '))).map(l => l.slice(5)).join('\n')
    assert.match(recovery, /UPDATE products SET/)
    db.exec(recovery)
    const after = products(db)
    for (const row of after) {
      const was = before.find(r => r.id === row.id)
      if (row.id === edited) assert.deepEqual([row.cost_price_usd, row.purchase_price_usd], [6.5, 6.5], 'edited after the migration: kept')
      else assert.deepEqual(row, was, `${row.name} restored`)
    }
    assert.equal(db.prepare("SELECT COUNT(*) n FROM system_flags WHERE key='stock_transaction_permit'").get().n, 0)
  })

  await check('workerd D1 (Miniflare): the wrangler-split statements give the same rows, and a failing batch rolls back whole', async () => {
    const { Miniflare } = require('miniflare')
    const split = require('wrangler').unstable_splitSqlQuery
    const local = seeded()
    const source = new Database(local.db.serialize())
    const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok") } }', d1Databases: { DB: 'cost-mirror-0269' }, d1Persist: false })
    try {
      const d1 = await mf.getD1Database('DB')
      const objects = source.prepare(`SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
        AND name NOT IN (SELECT name FROM pragma_table_list WHERE type = 'shadow') ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid`).all()
      for (let i = 0; i < objects.length; i += 40) await d1.batch(objects.slice(i, i + 40).map(o => d1.prepare(o.sql)))
      const rows = table => source.prepare(`SELECT * FROM ${table}`).all()
      const insert = (table, row) => d1.prepare(`INSERT INTO ${table} (${Object.keys(row).map(k => `"${k}"`).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).bind(...Object.values(row))
      // the stock epoch and cache version, then the fixture under the stock permit (as the Worker's own writers hold it)
      await d1.batch([...rows('system_flags').map(r => insert('system_flags', r)), ...rows('cache_versions').map(r => insert('cache_versions', r))])
      await d1.batch([d1.prepare(PERMIT), ...rows('products').map(r => insert('products', r)), d1.prepare("DELETE FROM system_flags WHERE key='stock_transaction_permit'")])
      const read = async table => (await d1.prepare(`SELECT * FROM ${table} ORDER BY ${table === 'products' ? 'id' : 'product_id'}`).all()).results
      const workerdBefore = await read('products')
      assert.deepEqual(workerdBefore, products(local.db), 'workerd holds the same fixture')
      // a failing POST assertion rolls the whole batch back: no ledger, no write, no permit
      const broken = split(mutate('WHERE id IN (SELECT product_id FROM product_cost_mirror_0269);', 'WHERE id IN (SELECT product_id FROM product_cost_mirror_0269) AND id <> (SELECT MIN(product_id) FROM product_cost_mirror_0269);'))
      await assert.rejects(d1.batch(broken.map(s => d1.prepare(s))), /cost_mirror_0269_post_active_drift/)
      assert.deepEqual(await read('products'), workerdBefore, 'an aborted batch changed no row')
      assert.equal((await d1.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE '%0269%'").first()).n, 0, 'and created no table')
      assert.equal((await d1.prepare("SELECT COUNT(*) n FROM system_flags WHERE key = 'stock_transaction_permit'").first()).n, 0, 'and left no permit')
      await d1.batch(split(sql).map(s => d1.prepare(s)))
      local.db.exec(sql)
      assert.deepEqual(await read('products'), products(local.db), 'workerd and SQLite agree on every product row')
      const ledger = rowsOf => rowsOf.map(({ created_at, ...r }) => r)
      assert.deepEqual(ledger(await read('product_cost_mirror_0269')), ledger(local.db.prepare('SELECT * FROM product_cost_mirror_0269 ORDER BY product_id').all()))
      assert.equal((await d1.prepare("SELECT COUNT(*) n FROM system_flags WHERE key = 'stock_transaction_permit'").first()).n, 0)
      assert.equal((await d1.prepare("SELECT version FROM cache_versions WHERE namespace = 'products'").first()).version, 8)
    } finally { await mf.dispose() }
  })

  console.log(`test-migration-0269-cost-mirror-native: ${passed} checks passed`)
}

main().catch(error => { console.error(error); process.exit(1) })
