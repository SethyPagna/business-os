#!/usr/bin/env node
// Fixture checks for ops/queries/session-device-unlinked.sql (SEC1-01): the
// query runs, after the read-only guard canonicalises it, against the REAL
// migration chain in an in-memory SQLite seeded with one known positive and
// at least one known negative for every class.
'use strict'

const assert = require('assert')
const path = require('path')
const { pathToFileURL } = require('url')
const { DatabaseSync } = require('node:sqlite')
const { loadAll } = require('./harness/load_migrations.cjs')

const ROOT = path.resolve(__dirname, '..', '..')
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href)

const FUTURE = '2036-01-01T00:00:00.000Z'
const PAST = '2020-01-01T00:00:00.000Z'

;(async () => {
  const guard = await load('ops/scripts/ops-sql-guard.mjs')
  const q = guard.loadQuery('session-device-unlinked')
  assert.deepStrictEqual(q.rules, { minRows: 0, maxRows: 5000, expectZero: null })
  for (const secret of ['token_hash', 'last_ip', 'user_agent', 'device_name']) {
    assert.ok(!new RegExp(`\\b${secret}\\b`).test(q.sql), `the query must not read ${secret}`)
  }

  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = OFF;')
  for (const sql of loadAll()) db.exec(sql)
  db.exec(`INSERT INTO users (id, username, name, password) VALUES
    (2, 'cashier', 'Cashier', 'x'), (3, 'owner', 'Owner', 'x')`)
  db.exec("INSERT INTO trusted_devices (user_id, device_id, status) VALUES (2, 'phone-D', 'approved')")
  const session = db.prepare(`INSERT INTO user_sessions (id, user_id, token_hash, device_id, limit_family_id, expires_at, revoked_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  const add = (id, userId, deviceId, family, { expires = FUTURE, revoked = null, created = '2026-09-28 01:00:00' } = {}) =>
    session.run(id, userId, `h${id}`, deviceId, family, expires, revoked, created)
  const audit = (userId, at) => db.prepare("INSERT INTO audit_logs (user_id, action, entity, created_at) VALUES (?, 'session_duration_updated', 'user', ?)").run(userId, at)

  add(1, 2, 'phone-D', null)                                   // negative: a sign-in with its device
  add(2, 2, null, 1)                                           // a_family_null
  add(3, 2, 'somewhere-else', 1)                               // a_family_other
  add(4, 2, 'phone-D', 1)                                      // negative: re-issue that kept its device
  add(5, 2, null, 1, { revoked: '2026-09-28 02:00:00' })       // negative: revoked
  add(6, 2, null, 1, { expires: PAST })                        // negative: expired
  add(7, 2, 'phone-D', null, { created: '2026-09-01 08:00:00' })
  add(8, 2, null, null, { created: '2026-09-10 09:00:00' })    // b_prefamily_reissue
  audit(2, '2026-09-10 09:00:01')
  add(9, 2, null, null, { created: '2026-09-12 10:00:00' })    // c: audit an hour away is not a match
  audit(2, '2026-09-12 11:00:00')
  add(10, 3, null, null, { created: '2026-09-10 09:00:00' })   // c: the audit row at that second is another user's
  add(11, 2, null, 9)                                          // c: re-issue of a sign-in that had no device

  const rows = db.prepare(q.sql).all()
  const byId = Object.fromEntries(rows.map((r) => [r.session_id, r]))
  assert.deepStrictEqual(rows.map((r) => [r.session_id, r.class]), [
    [2, 'a_family_null'],
    [3, 'a_family_other'],
    [8, 'b_prefamily_reissue'],
    [9, 'c_signin_no_device'],
    [11, 'c_signin_no_device'],
    [10, 'c_signin_no_device'],
  ])
  for (const id of [1, 4, 5, 6, 7]) assert.ok(!byId[id], `session ${id} is not listed`)
  assert.strictEqual(byId[2].user_device_rows, 1)
  assert.strictEqual(byId[10].user_device_rows, 0)
  assert.strictEqual(byId[2].username, 'cashier')
  for (const row of rows) assert.ok(!('device_id' in row) && !('token_hash' in row), 'no device id or token in the output')

  console.log(`ok - session-device-unlinked: ${rows.length} rows, classes a/a/b/c/c/c, 5 negatives excluded`)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
