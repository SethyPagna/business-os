'use strict'
// Pins migration 0288 (the data epoch, lane 6.0.1048) on the REAL chain of every earlier migration: one random 32-hex value per database,
// two databases never share it, the PRE assertion fires on a second apply, the POST assertion fires when the file is mutated to store a
// malformed value, and the documented RECOVERY rotates it. A positive control (the mutated file) proves the POST assertion can fire.
//
// Run: node scripts/test-migration-0288-data-epoch-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const directory = path.join(__dirname, '../migrations')
const migration = '0288_data_epoch.sql'
const sql = fs.readFileSync(path.join(directory, migration), 'utf8')
const chain = fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < migration).sort()
const upTo = (db) => { for (const file of chain) db.exec(fs.readFileSync(path.join(directory, file), 'utf8')) }
const abortName = (error) => (/bad JSON path: '\$\[(\w+)\]'/.exec(String(error.message)) || [])[1]
const epoch = (db) => db.prepare("SELECT value FROM system_flags WHERE key = 'data_epoch'").all().map((r) => r.value)
let passed = 0
const check = (name, run) => { run(); passed++; console.log(`PASS ${name}`) }

check('the file is LF-only and the number is above 0273', () => {
  assert.equal(sql.includes('\r'), false)
  assert.ok(Number(migration.slice(0, 4)) > 273)
})

const a = new Database(':memory:'); upTo(a)
const b = new Database(':memory:'); upTo(b)

check('before it, no data_epoch row exists', () => assert.deepEqual(epoch(a), []))

check('applying it stores exactly one 32-hex value', () => {
  a.exec(sql)
  assert.equal(epoch(a).length, 1)
  assert.match(epoch(a)[0], /^[0-9a-f]{32}$/)
})

check('two databases never get the same value', () => {
  b.exec(sql)
  assert.notEqual(epoch(a)[0], epoch(b)[0])
})

check('the PRE assertion aborts a second apply and leaves the value alone', () => {
  const before = epoch(a)[0]
  assert.throws(() => a.exec(sql), (error) => abortName(error) === 'data_epoch_0288_pre')
  assert.deepEqual(epoch(a), [before])
})

check('positive control: a mutated file that stores 32 non-hex characters trips the POST assertion', () => {
  const c = new Database(':memory:'); upTo(c)
  const mutated = sql.replace("VALUES ('data_epoch', lower(hex(randomblob(16)))", "VALUES ('data_epoch', 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ'")
  assert.notEqual(mutated, sql)
  assert.throws(() => c.exec(mutated), (error) => abortName(error) === 'data_epoch_0288_post')
})

check('positive control: a value of the wrong length also trips it', () => {
  const c = new Database(':memory:'); upTo(c)
  const mutated = sql.replace("VALUES ('data_epoch', lower(hex(randomblob(16)))", "VALUES ('data_epoch', lower(hex(randomblob(8)))")
  assert.throws(() => c.exec(mutated), (error) => abortName(error) === 'data_epoch_0288_post')
})

check('the documented RECOVERY rotates the value to another 32-hex one', () => {
  const before = epoch(a)[0]
  a.exec("UPDATE system_flags SET value = lower(hex(randomblob(16))), updated_at = CURRENT_TIMESTAMP WHERE key = 'data_epoch'")
  assert.match(epoch(a)[0], /^[0-9a-f]{32}$/)
  assert.notEqual(epoch(a)[0], before)
})

check('it touches nothing else in system_flags', () => {
  const c = new Database(':memory:'); upTo(c)
  const rows = () => JSON.stringify(c.prepare("SELECT key, value FROM system_flags WHERE key <> 'data_epoch' ORDER BY key").all())
  const before = rows()
  c.exec(sql)
  assert.equal(rows(), before)
})

console.log(`${passed} checks passed`)
