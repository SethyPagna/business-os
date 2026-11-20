// ops/queries/positive-stock-orphan-lots.sql: positive branch stock whose lot is missing or inactive. Healthy = no rows.
// Pins: the ops read-only guard accepts it (SELECT only, literal table names, a read ceiling, expects zero rows); on a database with
// the whole chain applied it returns nothing when healthy, flags a missing lot and an inactive lot, never flags zero stock on an
// inactive lot or positive stock on an active lot; it names only ids, a quantity and a lot state (no personal field); it reads the
// stock through the partial index of 0155. Mutation hook: ORPHAN_QUERY_SOURCE points at another copy of the file.
// Run: node scripts/test-ops-positive-stock-orphan-lots-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const Database = require('better-sqlite3')
const { seedStockFixture } = require('./harness/seed-stock-fixture.cjs')

const ROOT = path.join(__dirname, '../..')
const migrations = path.join(ROOT, 'cloudflare/migrations')
const sqlFile = process.env.ORPHAN_QUERY_SOURCE || path.join(ROOT, 'ops/queries/positive-stock-orphan-lots.sql')

let passed = 0
const check = async (name, fn) => { await fn(); passed++; console.log(`PASS ${name}`) }

;(async () => {
  const guard = await import(pathToFileURL(path.join(ROOT, 'ops/scripts/ops-sql-guard.mjs')).href)
  const text = fs.readFileSync(sqlFile, 'utf8')
  const canonical = guard.loadQuery('positive-stock-orphan-lots')
  const sql = process.env.ORPHAN_QUERY_SOURCE ? text : canonical.sql

  const db = new Database(':memory:')
  for (const name of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) db.exec(fs.readFileSync(path.join(migrations, name), 'utf8'))
  // The stock triggers would refuse the broken states this query exists to notice, so the fixture removes them on its own copy.
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'positive_lot_%' OR name LIKE '%stock%')").all()) db.exec(`DROP TRIGGER IF EXISTS "${name}"`)
  const w = (fn) => seedStockFixture(db, fn)
  w(() => {
    db.exec("INSERT INTO products(id,name) VALUES(900001,'Fixture product'); INSERT INTO branches(id,name) VALUES(900001,'Shop'),(900002,'Warehouse')")
    db.exec(`INSERT INTO product_batches(id,variant_product_id,batch_key,is_active,received_at) VALUES(900001,900001,'healthy',1,'2026-09-01'),(900002,900001,'inactive',0,'2026-09-02'),(900003,900001,'inactive-empty',0,'2026-09-03')`)
    db.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(900001,900001,4),(900003,900001,0),(900001,900002,0)')
  })

  await check('the ops guard accepts it: SELECT only, a read ceiling, healthy means zero rows', () => {
    assert.deepEqual(canonical.rules, { minRows: 0, maxRows: 0, expectZero: null })
    assert(Number.isInteger(canonical.maxRowsRead) && canonical.maxRowsRead > 0 && canonical.maxRowsRead <= 1000000, `ceiling ${canonical.maxRowsRead}`)
    assert(!canonical.refusedOnFree)
    assert(/^SELECT\b/i.test(canonical.sql.trim()))
    assert(!/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|PRAGMA|ATTACH)\b/i.test(canonical.sql))
  })
  await check('a healthy database returns no rows (zero stock on an inactive lot, positive stock on an active lot)', () => {
    assert.deepEqual(db.prepare(sql).all(), [])
  })
  await check('a missing lot and an inactive lot with positive stock are both flagged, with their ids and nothing personal', () => {
    w(() => {
      db.exec('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(999999,900001,2.5),(900002,900002,1)')
    })
    const rows = db.prepare(sql).all().map((r) => ({ ...r }))
    assert.equal(rows.length, 2, JSON.stringify(rows))
    assert.deepEqual(rows.map((r) => [r.batch_id, r.branch_id, r.quantity, r.problem]), [[999999, 900001, 2.5, 'lot_missing'], [900002, 900002, 1, 'lot_inactive']])
    assert.deepEqual(Object.keys(rows[0]), ['branch_batch_stock_id', 'batch_id', 'branch_id', 'quantity', 'problem'])
  })
  await check('it reads the positive stock through the partial index of 0155 and probes the lot by primary key', () => {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join('\n')
    assert.match(plan, /idx_branch_batch_stock_positive_batch_0155/, plan)
    assert.match(plan, /SEARCH pb USING INTEGER PRIMARY KEY/, plan)
    assert.doesNotMatch(plan, /SCAN bbs$/m, `a full scan of every stock row: ${plan}`)
  })
  await check('the output is bounded: a damaged database prints at most 50 rows', () => {
    w(() => {
      const stmt = db.prepare('INSERT INTO branch_batch_stock(batch_id,branch_id,quantity) VALUES(?,?,1)')
      for (let i = 0; i < 80; i++) stmt.run(990000 + i, 900001)
    })
    assert.equal(db.prepare(sql).all().length, 50)
  })
  console.log(`${passed} positive stock orphan lots query checks passed`)
})().catch((e) => { console.error(e); process.exit(1) })
