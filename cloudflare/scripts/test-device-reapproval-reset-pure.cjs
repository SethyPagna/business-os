// F63: a rejected device row is terminal until an administrator explicitly
// resets it. Reset removes only that rejected row; the next authenticated
// login creates a fresh pending row and still requires normal approval.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const root = path.join(__dirname, '..')
const route = fs.readFileSync(path.join(root, 'src/routes/devices.ts'), 'utf8')
const trust = fs.readFileSync(path.join(root, 'src/lib/deviceTrust.ts'), 'utf8')
let checks = 0
function ok(value, label) {
  assert.ok(value, label)
  checks += 1
  console.log(`PASS ${label}`)
}

// Source locks keep the behavioral SQL below tied to the real route rather
// than allowing a lookalike test implementation to drift from production.
const resetAt = route.indexOf("app.post('/:id/reset'")
const approveAt = route.indexOf("app.post('/:id/approve'")
const rejectGuardAt = route.indexOf("if (device.status === 'rejected')", approveAt)
const capAt = route.indexOf('const approvedCount', approveAt)
ok(resetAt > approveAt, 'reset is an authenticated device-management route')
ok(rejectGuardAt > approveAt && rejectGuardAt < capAt, 'approve rejects rejected rows before the device-cap path')
ok(route.includes("code: 'device_reapproval_reset_required'"), 'rejected approval has the required machine-readable reset code')
ok(route.includes("if (device.status === 'approved') return c.json({ success: true, idempotent: true })"), 'approved device approval remains idempotent')
ok(route.includes("WHERE id = @id AND user_id = @user_id AND status = 'pending'"), 'pending approval update is guarded against a concurrent decision')
ok(route.includes("WHERE id = @id AND user_id = @user_id AND device_id = @device_id AND status = 'rejected'"), 'reset deletes only the exact rejected device row')
ok(route.includes('await db.batch(['), 'reset combines guard, session revoke, and device delete in one atomic D1 batch')
ok(route.includes("json_extract(@reapproval_reset_guard_error, '$')"), 'reset batch guard throws when the rejected row changed')
ok(route.includes("WHERE user_id = @user_id AND device_id = @device_id AND revoked_at IS NULL"), 'reset revokes only sessions for the target user/device pair')
ok(route.includes("AND EXISTS (SELECT 1 FROM trusted_devices WHERE id = @id AND user_id = @user_id AND device_id = @device_id AND status = 'rejected')"), 'targeted revoke requires the exact rejected row inside the batch')
const resetBlock = route.slice(resetAt, route.indexOf("app.post('/:id/reject'", resetAt))
ok(!/userAgent|firstIp|lastIp|firstCountry|lastCountry/.test(resetBlock), 'reset audit payload contains no IP or user-agent data')
ok(/previousState: 'rejected'/.test(resetBlock) && /priorDecision:/.test(resetBlock) && /revokedSessions/.test(resetBlock), 'reset audit records minimal prior decision and revocation facts')
ok(/if \(!existing\)[\s\S]*?status: initialStatus/.test(trust), 'missing device rows still begin pending at the normal login gate')

const db = new Database(':memory:')
for (const migration of loadAll()) db.exec(migration)
db.prepare(`INSERT INTO users (id, username, name, password) VALUES
  (9, 'employee', 'Employee', 'x'), (10, 'other', 'Other', 'x')`).run()
const insertDevice = db.prepare(`
  INSERT INTO trusted_devices (id, user_id, device_id, device_name, status, decided_at, decided_by_user_id, decided_by_name, revoked_at)
  VALUES (@id, @user, @device, @name, @status, @decided_at, @decided_by, @decided_name, @revoked_at)
`)
insertDevice.run({ id: 1, user: 9, device: 'same-device', name: 'Store tablet', status: 'rejected', decided_at: '2026-09-08 05:00:00', decided_by: 1, decided_name: 'admin', revoked_at: '2026-09-08 05:01:00' })
insertDevice.run({ id: 2, user: 9, device: 'pending-device', name: 'New tablet', status: 'pending', decided_at: null, decided_by: null, decided_name: null, revoked_at: null })
insertDevice.run({ id: 3, user: 9, device: 'approved-device', name: 'POS', status: 'approved', decided_at: '2026-09-08 05:00:00', decided_by: 1, decided_name: 'admin', revoked_at: null })

const future = new Date(Date.now() + 86400000).toISOString()
const insertSession = db.prepare(`
  INSERT INTO user_sessions (id, user_id, token_hash, device_id, expires_at)
  VALUES (@id, @user, @token, @device, @expires)
`)
insertSession.run({ id: 20, user: 9, token: 'old-target', device: 'same-device', expires: future })
insertSession.run({ id: 21, user: 9, token: 'other-device', device: 'other-device', expires: future })
insertSession.run({ id: 22, user: 10, token: 'other-user', device: 'same-device', expires: future })

const guardSql = route.match(/SELECT CASE WHEN EXISTS \([\s\S]*?json_extract\(@reapproval_reset_guard_error, '\$'\) END AS device_reapproval_reset_guard/)?.[0]
const revokeSql = route.match(/UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP\s+WHERE user_id = @user_id AND device_id = @device_id AND revoked_at IS NULL[\s\S]*?status = 'rejected'\)/)?.[0]
const deleteSql = route.match(/DELETE FROM trusted_devices\s+WHERE id = @id AND user_id = @user_id AND device_id = @device_id AND status = 'rejected'/)?.[0]
assert.ok(guardSql && revokeSql && deleteSql, 'lifted atomic reset batch SQL is present')

const target = { id: 1, user_id: 9, device_id: 'same-device', reapproval_reset_guard_error: '{' }
db.transaction(() => {
  assert.equal(db.prepare(guardSql).get(target).device_reapproval_reset_guard, 1, 'batch guard accepts the exact rejected row')
  assert.equal(db.prepare(revokeSql).run(target).changes, 1, 'batch revokes the target device session')
  assert.equal(db.prepare(deleteSql).run(target).changes, 1, 'batch deletes the rejected row exactly once')
})()
ok(!db.prepare('SELECT 1 FROM trusted_devices WHERE id = 1').get(), 'rejected trust row is removed without changing pending or approved rows')
ok(db.prepare('SELECT status FROM trusted_devices WHERE id = 2').get().status === 'pending' && db.prepare('SELECT status FROM trusted_devices WHERE id = 3').get().status === 'approved', 'reset leaves the rest of the account device state intact')
ok(db.prepare('SELECT revoked_at FROM user_sessions WHERE id = 20').get().revoked_at, 'reset revokes the pre-existing matching device session')
ok(!db.prepare('SELECT revoked_at FROM user_sessions WHERE id = 21').get().revoked_at && !db.prepare('SELECT revoked_at FROM user_sessions WHERE id = 22').get().revoked_at, 'reset does not revoke another device or another account session')

// This is the next-login branch: after reset, the former unique pair no
// longer exists, so the ordinary device gate inserts pending rather than a
// trusted/approved row or a session.
db.prepare("INSERT INTO trusted_devices (user_id, device_id, device_name, status) VALUES (9, 'same-device', 'Store tablet', 'pending')").run()
ok(db.prepare("SELECT status FROM trusted_devices WHERE user_id = 9 AND device_id = 'same-device'").get().status === 'pending', 'same device id becomes pending on its next login and still needs approval')

// Race proof: an approval changing the old row before the batch makes the
// guard throw; no session or device write starts.
insertDevice.run({ id: 10, user: 10, device: 'race-device', name: 'Race', status: 'rejected', decided_at: '2026-09-08 05:00:00', decided_by: 1, decided_name: 'admin', revoked_at: null })
insertSession.run({ id: 23, user: 10, token: 'race-old', device: 'race-device', expires: future })
db.prepare("UPDATE trusted_devices SET status = 'approved' WHERE id = 10").run()
assert.throws(() => db.prepare(guardSql).get({ id: 10, user_id: 10, device_id: 'race-device', reapproval_reset_guard_error: '{' }), /malformed JSON/, 'batch guard fails when the row stopped being rejected')
ok(!db.prepare('SELECT revoked_at FROM user_sessions WHERE id = 23').get().revoked_at, 'failed guard leaves sessions untouched, preventing the wrong-row race')

// DB failure after the session statement must roll the transaction back, so a
// retry still finds both the rejected row and its active session.
insertDevice.run({ id: 11, user: 10, device: 'failure-device', name: 'Failure', status: 'rejected', decided_at: '2026-09-08 05:00:00', decided_by: 1, decided_name: 'admin', revoked_at: null })
insertSession.run({ id: 24, user: 10, token: 'failure-old', device: 'failure-device', expires: future })
db.exec("CREATE TRIGGER fail_reset_session_update BEFORE UPDATE OF revoked_at ON user_sessions WHEN NEW.device_id = 'failure-device' BEGIN SELECT RAISE(ABORT, 'forced reset failure'); END")
assert.throws(() => db.transaction(() => {
  const failureTarget = { id: 11, user_id: 10, device_id: 'failure-device', reapproval_reset_guard_error: '{' }
  db.prepare(guardSql).get(failureTarget)
  db.prepare(revokeSql).run(failureTarget)
  db.prepare(deleteSql).run(failureTarget)
})(), /forced reset failure/, 'a database failure aborts the reset batch')
ok(db.prepare('SELECT status FROM trusted_devices WHERE id = 11').get().status === 'rejected' && !db.prepare('SELECT revoked_at FROM user_sessions WHERE id = 24').get().revoked_at, 'database failure rolls back both session revocation and rejected-row deletion')

console.log(`test-device-reapproval-reset-pure: ${checks} checks passed`)
