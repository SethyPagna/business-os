// ops/queries/devices-shared-ids-predeploy.sql counts shared device ids with a LIVE session on two or more of their accounts.
// user_sessions.expires_at is stored as ISO text (2026-11-13T05:00:00.000Z) while datetime('now') is 2026-11-13 05:00:00, so a plain text
// comparison treats every session that expired earlier the same UTC day as live (the B7 delta review's L-f). The census compares julianday
// values on both sides. The mutant at the end puts the text comparison back and must turn the check red.
//
// Run: node scripts/test-devices-census-expiry-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')

const file = path.join(__dirname, '..', '..', 'ops', 'queries', 'devices-shared-ids-predeploy.sql')
const sql = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')

function liveSharedIds(querySql, expiries) {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE trusted_devices (id INTEGER PRIMARY KEY, user_id INTEGER, device_id TEXT, status TEXT);
    CREATE TABLE user_sessions (id INTEGER PRIMARY KEY, user_id INTEGER, device_id TEXT, revoked_at TEXT, expires_at TEXT);
    INSERT INTO trusted_devices (user_id, device_id, status) VALUES (1, 'shared-device-01', 'approved'), (2, 'shared-device-01', 'approved');`)
  expiries.forEach((expiresAt, index) => db.prepare('INSERT INTO user_sessions (user_id, device_id, expires_at) VALUES (?, ?, ?)').run(index + 1, 'shared-device-01', expiresAt))
  const row = db.prepare(querySql.replace(/^--.*$/gm, '')).get()
  db.close()
  return Number(row.shared_ids_live_session)
}

// Same UTC day, already past: one minute after midnight UTC is always earlier than "now" unless the run itself is in that minute; use now minus one second.
const justExpired = new Date(Date.now() - 1000).toISOString()
const stillLive = new Date(Date.now() + 3600 * 1000).toISOString()

function run(querySql) {
  return {
    bothExpired: liveSharedIds(querySql, [justExpired, justExpired]),
    oneExpired: liveSharedIds(querySql, [justExpired, stillLive]),
    bothLive: liveSharedIds(querySql, [stillLive, stillLive]),
  }
}

const real = run(sql)
assert.deepEqual(real, { bothExpired: 0, oneExpired: 0, bothLive: 1 }, 'the census counts only ids whose two accounts both have an unexpired session')

const mutantSql = sql.replace("julianday(s.expires_at) > julianday('now')", "s.expires_at > datetime('now')")
assert.notEqual(mutantSql, sql, 'the mutant needs the julianday comparison, which moved')
const mutant = run(mutantSql)
assert.equal(mutant.bothLive, 1, 'mutant control: live sessions are still counted')
assert.equal(mutant.bothExpired, 1, 'mutant: the text comparison counts sessions that expired earlier today as live, which is the defect this test pins')

console.log('PASS devices census compares expires_at as time: expired sessions are not live; text-comparison mutant over-counts')
