'use strict'
// Pins migration 0304 (shop devices) on the REAL migration chain: LF-only, keeps rowid, applies on a fresh chain,
// adds exactly the table, the column and the three indexes, changes no existing row, passes its own POST check,
// aborts on a second run (PRE check), allows one ACTIVE marking per device id and a new one after an unmark,
// and the sign-in lookups use the new indexes.
//
// Run (from cloudflare/): node scripts/test-migration-0304-shop-devices-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const directory = path.join(__dirname, '../migrations')
const migration = '0304_shop_devices.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const files = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
const chain = () => { const db = new DatabaseSync(':memory:'); for (const f of files) db.exec(fs.readFileSync(path.join(directory, f), 'utf8')); return db }
const objects = (db) => db.prepare("SELECT type,name FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex%' ORDER BY name").all().map((r) => `${r.type}:${r.name}`)
const plan = (db, statement) => db.prepare(`EXPLAIN QUERY PLAN ${statement}`).all().map((r) => r.detail).join(' | ')

let passed = 0
const check = (name, run) => { run(); passed += 1; console.log(`PASS ${name}`) }

check('the file is LF-only, append-only numbered 0304, keeps rowid, and carries recovery notes', () => {
  assert.equal(sql.includes('\r'), false)
  assert.equal(/WITHOUT\s+ROWID/i.test(sql.replace(/^--.*$/gm, '')), false)
  assert.match(sql, /RECOVERY:/)
  assert.deepEqual(fs.readdirSync(directory).filter((f) => f.startsWith('0304_')), [migration], 'one 0304 file')
  assert.ok(!fs.readdirSync(directory).some((f) => f.startsWith('0301_') && /shop/i.test(f)))
})

const pre = chain()
for (const [id, user, device] of [[1, 10, 'dev-a'], [2, 11, 'dev-a'], [3, 10, 'dev-b']]) {
  pre.prepare("INSERT INTO trusted_devices(id,user_id,device_id,status) VALUES(?,?,?,'approved')").run(id, user, device)
}
pre.exec("INSERT INTO users(id,username,name,password) VALUES (10,'u10','U10','x'),(11,'u11','U11','x')")
pre.exec("INSERT INTO user_sessions(id,user_id,token_hash,device_id,expires_at) VALUES (1,10,'h1','dev-a','2999-01-01')")
const objectsBefore = objects(pre)
const rowsBefore = JSON.stringify([pre.prepare('SELECT * FROM trusted_devices ORDER BY id').all(), pre.prepare('SELECT * FROM user_sessions ORDER BY id').all()])
const post = new DatabaseSync(':memory:')
for (const f of files) post.exec(fs.readFileSync(path.join(directory, f), 'utf8'))
post.exec("INSERT INTO users(id,username,name,password) VALUES (10,'u10','U10','x'),(11,'u11','U11','x')")

check('applies on a fresh chain and adds exactly the table and three indexes', () => {
  pre.exec(sql)
  const added = objects(pre).filter((o) => !objectsBefore.includes(o))
  assert.deepEqual(added, ['index:idx_shop_devices_active', 'index:idx_trusted_devices_device', 'index:idx_user_sessions_shop_device', 'table:shop_devices'])
  assert.equal(pre.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('user_sessions') WHERE name = 'shop_device_id'").get().n, 1)
  assert.equal(pre.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('trusted_devices') WHERE name = 'cookie_bound_at'").get().n, 1)
  assert.equal(pre.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('trusted_devices') WHERE name = 'claimed_approval_ref'").get().n, 1)
  assert.equal(pre.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE claimed_approval_ref IS NOT NULL').get().n, 0)
})

check('no existing row changed (the new column is NULL everywhere) and shop_devices is empty', () => {
  const boundNull = pre.prepare('SELECT COUNT(*) AS n FROM trusted_devices WHERE cookie_bound_at IS NOT NULL').get().n
  assert.equal(boundNull, 0, 'no row is bound by the migration')
  const asNew = pre.prepare('SELECT * FROM user_sessions ORDER BY id').all().map(({ shop_device_id, ...rest }) => { assert.equal(shop_device_id, null); return rest })
  assert.equal(JSON.stringify([pre.prepare('SELECT * FROM trusted_devices ORDER BY id').all().map(({ cookie_bound_at, claimed_approval_ref, ...rest }) => rest), asNew]), rowsBefore)
  assert.equal(pre.prepare('SELECT COUNT(*) AS n FROM shop_devices').get().n, 0)
})

check('a second run aborts on its PRE check and leaves the schema as it was', () => {
  const before = objects(pre)
  assert.throws(() => pre.exec(sql), /shop_devices_0304_pre/)
  assert.deepEqual(objects(pre), before)
})

check('PRE also refuses a half-applied schema (column exists, table missing)', () => {
  const half = chain()
  half.exec('ALTER TABLE user_sessions ADD COLUMN shop_device_id INTEGER')
  assert.throws(() => half.exec(sql), /shop_devices_0304_pre/)
})

check('one ACTIVE marking per device id; a new one is allowed after the old is unmarked; other devices are independent', () => {
  post.exec(sql)
  const mark = (device) => post.prepare("INSERT INTO shop_devices(device_id,label) VALUES(?, 'Till')").run(device)
  mark('dev-a')
  assert.throws(() => mark('dev-a'), /UNIQUE/)
  mark('dev-b')
  post.prepare("UPDATE shop_devices SET unmarked_at = CURRENT_TIMESTAMP WHERE device_id = 'dev-a'").run()
  mark('dev-a')
  assert.equal(post.prepare("SELECT COUNT(*) AS n FROM shop_devices WHERE device_id = 'dev-a'").get().n, 2)
  assert.equal(post.prepare('SELECT label, marked_at FROM shop_devices WHERE id = 1').get().label, 'Till')
  assert.ok(post.prepare('SELECT marked_at FROM shop_devices WHERE id = 1').get().marked_at, 'marked_at defaults')
})

check('the sign-in lookups use the new indexes', () => {
  assert.match(plan(post, "SELECT id FROM shop_devices WHERE device_id = 'x' AND unmarked_at IS NULL"), /idx_shop_devices_active/)
  assert.match(plan(post, "SELECT 1 FROM trusted_devices WHERE device_id = 'x' AND user_id != 1 LIMIT 1"), /idx_trusted_devices_device/)
  assert.match(plan(post, 'UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE shop_device_id = 1'), /idx_user_sessions_shop_device/)
})

console.log(`\n${passed} passed`)
console.log('test-migration-0304-shop-devices-pure: all checks passed')
