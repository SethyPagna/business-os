'use strict'
// The read-only census for lane 6.0.967 (ops/queries/perm-consistency-census.sql): it must pass the ops SQL guard, run on the
// schema BEFORE migration 0270 with the oracle's fixtures, count every principal exactly once, and surface the dormant grants.
// Run: node scripts/test-perm-consistency-census-native.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const oracle = require('./harness/permission_extras_oracle.cjs')

const root = path.join(__dirname, '..', '..')
const sql = fs.readFileSync(path.join(root, 'ops', 'queries', 'perm-consistency-census.sql'), 'utf8')
const directory = path.join(__dirname, '../migrations')
const db = new Database(':memory:')
for (const file of fs.readdirSync(directory).filter((f) => f.endsWith('.sql') && f < '0270').sort()) db.exec(fs.readFileSync(path.join(directory, file), 'utf8'))
let passed = 0
const check = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }

check('the census file is accepted by the production read-only SQL guard', () => {
  const { spawnSync } = require('node:child_process')
  const probe = `import { guardSql } from ${JSON.stringify(require('node:url').pathToFileURL(path.join(root, 'ops/scripts/ops-sql-guard.mjs')).href)}; import fs from 'node:fs'; const r = guardSql(fs.readFileSync(${JSON.stringify(path.join(root, 'ops/queries/perm-consistency-census.sql'))}, 'utf8')); console.log(JSON.stringify({ ok: r.ok !== false, r: String(r.error || r.reason || '') }))`
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' })
  assert.equal(out.status, 0, out.stderr)
  assert.equal(JSON.parse(out.stdout.trim().split('\n').pop()).ok, true, out.stdout)
})

oracle.seed(db, { fuzz: true, userCount: 800, roleCount: 120 })
const total = db.prepare('SELECT (SELECT COUNT(*) FROM roles) + (SELECT COUNT(*) FROM users) AS n').get().n
const rows = db.prepare(sql).all()

check('every principal is counted exactly once, roles and users', () => {
  assert.ok(rows.length > 5)
  assert.equal(rows.reduce((sum, row) => sum + row.principals, 0), total)
  assert.ok(rows.every((row) => row.total_principals === total))
  assert.ok(new Set(rows.map((r) => r.kind)).size === 2)
})
check('the shapes the migration writes and neutralises are visible', () => {
  assert.ok(rows.some((r) => r.writes_extras === 1 && r.principals > 0), 'a Settings Full shape that gets the extras')
  assert.ok(rows.some((r) => r.writes_count_sessions === 1 && r.principals > 0), 'a count-sessions-follows-Inventory shape')
  assert.ok(rows.some((r) => r.neutralises_dormant === 1 && r.dormant_grant === 1), 'a dormant grant shape')
  assert.ok(rows.every((r) => r.admin === 0 || (r.writes_extras === 0 && r.writes_count_sessions === 0 && r.neutralises_dormant === 0)), 'an admin is never written')
})
check('only shapes are reported: no principal text leaks', () => {
  const columns = new Set(Object.keys(rows[0]))
  for (const forbidden of ['name', 'username', 'permissions', 'phone', 'email', 'password']) assert.equal(columns.has(forbidden), false, forbidden)
})
console.log(`\n${passed} checks passed: perm-consistency census`)
