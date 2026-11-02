'use strict'
// Pins migration 0285 (inventory_check_items(product_id, branch_id, updated_at)) on the REAL migration chain: schema only, the PRE/POST
// assertions fire, and the latest-observation lookups the simplified Inventory Check issues search the index instead of scanning the items table.
//
// Run: node scripts/test-migration-0285-inventory-check-items-latest-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0285_inventory_check_items_latest.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
assert.equal(sql.includes('\r'), false, 'trigger and migration SQL is LF-only')
const files = fs.readdirSync(directory).filter(file => file.endsWith('.sql') && file < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const file of files) db.exec(fs.readFileSync(path.join(directory, file), 'utf8')); return db }
const plan = (db, statement, params) => { const prepared = db.prepare(`EXPLAIN QUERY PLAN ${statement}`); prepared.setAllowUnknownNamedParameters(true); return prepared.all(params).map(row => row.detail).join(' | ') }

let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }
const NAME = 'inventory_check_items_product_latest'

check('the index is new, schema only, idempotent, and no row changes', () => {
  const db = chain()
  db.exec("INSERT INTO inventory_check_sessions(id,organization_id,branch_id,created_by,title,scope_json,started_at,updated_at) VALUES('s',1,1,1,'t','{}','2026-10-19','2026-10-19')")
  db.exec("INSERT INTO inventory_check_items(session_id,product_id,branch_id,product_snapshot_json,baseline_quantity,baseline_json,state,counted_quantity,updated_at) VALUES('s',5,1,'{}',1,'{}','done',1,'2026-10-19')")
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?").get(NAME).n, 0, 'absent before')
  const before = db.prepare('SELECT * FROM inventory_check_items').all()
  const objects = db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
  db.exec(sql)
  assert.deepEqual(db.prepare('SELECT * FROM inventory_check_items').all().map(row => ({ ...row })), before.map(row => ({ ...row })), 'rows unchanged')
  const after = db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
  assert.deepEqual(after.filter(row => !objects.some(old => old.name === row.name)).map(row => ({ ...row })), [{ type: 'index', name: NAME }], 'exactly one object is added')
  assert.deepEqual(db.prepare(`SELECT name FROM pragma_index_info('${NAME}') ORDER BY seqno`).all().map(row => row.name), ['product_id', 'branch_id', 'updated_at'])
  db.exec(sql)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?').get(NAME).n, 1, 'applying twice leaves one index')
})

check('the PRE assertion aborts when the table is missing a column', () => {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE inventory_check_items(session_id TEXT, product_id INTEGER)')
  assert.throws(() => db.exec(sql), /inventory_check_items_latest_0285_pre_columns/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name=?').get(NAME).n, 0)
})

check('the latest-observation lookups seek the new index; without it they scan the items table', () => {
  const db = chain()
  const lookups = {
    latest: `SELECT i.state FROM inventory_check_items i WHERE i.product_id=@product AND i.state IN ('done','issue') AND (@branch IS NULL OR i.branch_id=@branch) ORDER BY i.updated_at DESC,i.session_id DESC LIMIT 1`,
    open: `SELECT 1 FROM inventory_check_items i WHERE i.product_id=@product AND i.state='unstarted' AND i.branch_id=@branch LIMIT 1`,
  }
  for (const statement of Object.values(lookups)) assert.match(plan(db, statement, { product: 5, branch: 1 }), /SCAN i|SEARCH i USING (?:COVERING )?INDEX inventory_check_items_state/, 'before: no per-product index exists')
  db.exec(sql)
  for (const [name, statement] of Object.entries(lookups)) {
    const detail = plan(db, statement, { product: 5, branch: 1 })
    assert.match(detail, new RegExp(`SEARCH i USING (?:COVERING )?INDEX ${NAME} \\(product_id=\\?`), `${name}: ${detail}`)
  }
})

console.log(`${passed} groups passed`)
