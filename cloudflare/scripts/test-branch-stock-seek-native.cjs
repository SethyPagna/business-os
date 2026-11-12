'use strict'
// W2-PAGES #3 siblings (11 Nov D1 audit, wave 2): the two branch_stock reads that ask for SEVERAL products at once -- POST /api/branches/transfer-bulk and the
// dated stock count's current-stock read (lib/datedStockCountRoute.ts) -- let the planner pick the covering branch index (branch_id=?) and read every row of the
// branch (8,353 on production). `+branch_id = CAST(? AS INTEGER)` takes the branch term out of the index choice, so the seek is on the (product_id, branch_id)
// unique index; the unary + also drops the column's INTEGER affinity, so the bound id is cast back. Without the CAST a TEXT-bound id ('1') matches no row and
// every line reads "available 0".
//
// Pinned on the REAL migration chain: (1) the statements are lifted from the source; (2) EXPLAIN: SEARCH ... idx_branch_stock_product_branch_unique for 1, 2 and 50
// products and the json_each shape; the old form picks the covering branch index (discriminating); (3) same rows as the old form for INTEGER-bound and
// TEXT-bound branch ids; a bare `+branch_id = ?` mutant returns nothing for a TEXT-bound id.
//
// Run (from cloudflare/): node scripts/test-branch-stock-seek-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n')
let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

const bulk = /SELECT product_id, quantity FROM branch_stock WHERE (\+branch_id = CAST\(@branchId AS INTEGER\)) AND product_id IN \(SELECT value FROM json_each\(@ids\)\)/.exec(read('src/routes/branches.ts'))
const datedSource = read('src/lib/datedStockCountRoute.ts')
const dated = /`(SELECT product_id AS productId, branch_id AS branchId, quantity FROM branch_stock WHERE product_id IN \(\$\{pIn\}\) AND \+branch_id IN \(\$\{bCastIn\}\))`/.exec(datedSource)

check('both statements are found in the source in their seek form', () => {
  assert.ok(bulk, 'transfer-bulk statement')
  assert.ok(dated, 'dated stock count statement')
  assert.match(datedSource, /const bCastIn = bIn\.split\(', '\)\.map\(\(name\) => `CAST\(\$\{name\} AS INTEGER\)`\)\.join\(', '\)/)
})

const db = new Database(':memory:')
for (const migration of loadAll()) db.exec(migration)
db.exec("INSERT INTO system_flags(key,value) VALUES('stock_transaction_permit','legacy-separate-pool-v1')")
const insertProduct = db.prepare('INSERT INTO products(id,name,is_active) VALUES (?,?,1)')
const insertStock = db.prepare('INSERT INTO branch_stock(product_id,branch_id,quantity) VALUES (?,?,?)')
db.exec("INSERT OR IGNORE INTO branches(id,name,is_active) VALUES (1,'A',1),(2,'B',1)")
for (let id = 930001; id <= 930200; id += 1) { insertProduct.run(id, `p${id}`); insertStock.run(id, 1, id % 7); insertStock.run(id, 2, id % 5) }

const bulkSql = bulk && bulk[0]
const bulkOld = bulkSql && bulkSql.replace('+branch_id = CAST(@branchId AS INTEGER)', 'branch_id = @branchId')
const datedFor = (n, branches, cast) => {
  const pIn = Array.from({ length: n }, (_, i) => `@p${i}`).join(', ')
  const bIn = branches.map((_, i) => `@b${i}`).join(', ')
  const bCastIn = bIn.split(', ').map((name) => `CAST(${name} AS INTEGER)`).join(', ')
  const sql = dated[1].replace('${pIn}', pIn).replace('${bCastIn}', bCastIn)
  const text = cast ? sql : sql.replace('+branch_id IN (' + bCastIn + ')', 'branch_id IN (' + bIn + ')')
  const params = { ...Object.fromEntries(Array.from({ length: n }, (_, i) => [`p${i}`, 930001 + i])), ...Object.fromEntries(branches.map((b, i) => [`b${i}`, b])) }
  return { sql: text, params }
}
const plan = (sql, params) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(params).map((r) => r.detail).join(' | ')
const ids = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => 930001 + i))

check('EXPLAIN: transfer-bulk SEARCHes the unique (product_id, branch_id) index, for 1, 2 and 50 products; the old form reads the branch index', () => {
  for (const n of [1, 2, 50]) {
    const now = plan(bulkSql, { ids: ids(n), branchId: 1 })
    assert.match(now, /idx_branch_stock_product_branch_unique/, now)
    assert.doesNotMatch(now, /idx_branch_stock_branch_qty_product_pg/, now)
  }
  assert.match(plan(bulkOld, { ids: ids(50), branchId: 1 }), /idx_branch_stock_branch_qty_product_pg/)
})
check('EXPLAIN: dated stock count SEARCHes the unique index for 1, 2 and 50 products and one or two branches; the old form reads the branch index', () => {
  for (const n of [1, 2, 50]) for (const branches of [[1], [1, 2]]) {
    const now = datedFor(n, branches, true)
    const text = plan(now.sql, now.params)
    assert.match(text, /idx_branch_stock_product_branch_unique/, text)
    assert.doesNotMatch(text, /idx_branch_stock_branch_qty_product_pg/, text)
  }
  const old = datedFor(50, [1], false)
  assert.match(plan(old.sql, old.params), /idx_branch_stock_branch_qty_product_pg/)
})
const sorted = (rows) => rows.map((r) => `${r.product_id ?? r.productId}:${r.branch_id ?? r.branchId ?? ''}:${r.quantity}`).sort()
check('same rows as the old form, integer-bound and TEXT-bound branch ids (the CAST restores the conversion)', () => {
  for (const branchId of [1, 2, '1', '2']) {
    for (const n of [1, 3, 50]) {
      assert.deepEqual(sorted(db.prepare(bulkSql).all({ ids: ids(n), branchId })), sorted(db.prepare(bulkOld).all({ ids: ids(n), branchId })), `bulk ${branchId} ${n}`)
      const a = datedFor(n, [branchId], true); const b = datedFor(n, [branchId], false)
      assert.deepEqual(sorted(db.prepare(a.sql).all(a.params)), sorted(db.prepare(b.sql).all(b.params)), `dated ${branchId} ${n}`)
    }
  }
  assert.equal(db.prepare(bulkSql).all({ ids: ids(3), branchId: '1' }).length, 3)
})
check('the pin is discriminating: a bare +branch_id = ? returns no row for a TEXT-bound id', () => {
  const bare = bulkSql.replace('+branch_id = CAST(@branchId AS INTEGER)', '+branch_id = @branchId')
  assert.equal(db.prepare(bare).all({ ids: ids(3), branchId: '1' }).length, 0)
  assert.equal(db.prepare(bare).all({ ids: ids(3), branchId: 1 }).length, 3)
})
console.log(`${passed} checks passed.`)
