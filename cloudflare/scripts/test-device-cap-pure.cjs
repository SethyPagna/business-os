// Device cap (Aug 28 rule): an account holds at most 3 APPROVED devices.
// Proven against the real migration schema with the real counting helper
// SQL, plus source assertions that the approve endpoint is the enforcing
// gate (the only path to 'approved') and excludes the device's own row.
const fs = require('fs')
const path = require('path')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8')

// ---- 1. The counting SQL against the real schema ----
const sqlite = new Database(':memory:')
for (const migration of loadAll()) sqlite.exec(migration)
sqlite.prepare(`INSERT INTO users (id, username, name, password) VALUES (5, 'za', 'Za', 'x')`).run()
const insert = sqlite.prepare(`
  INSERT INTO trusted_devices (user_id, device_id, status) VALUES (@u, @d, @s)
`)
insert.run({ u: 5, d: 'dev-1', s: 'approved' })
insert.run({ u: 5, d: 'dev-2', s: 'approved' })
insert.run({ u: 5, d: 'dev-3', s: 'approved' })
insert.run({ u: 5, d: 'dev-4', s: 'pending' })
insert.run({ u: 5, d: 'dev-5', s: 'rejected' })

const trust = read(path.join('lib', 'deviceTrust.ts'))
const countMatch = trust.match(/`\s*\n\s*(SELECT COUNT\(\*\) AS n FROM trusted_devices[\s\S]*?)\n\s*`/)
assert.ok(countMatch, 'deviceTrust.ts still contains the approved-device count query')
const countSql = countMatch[1].replace(/@(\w+)/g, (_, name) => ({ user_id: '5', exclude_id: '-1' })[name])
assert.equal(sqlite.prepare(countSql).get().n, 3, 'counts only APPROVED devices (pending/rejected excluded)')
const excludeSql = countMatch[1].replace(/@(\w+)/g, (_, name) => ({ user_id: '5', exclude_id: '1' })[name])
assert.equal(sqlite.prepare(excludeSql).get().n, 2, 'excluding a row id works (idempotent re-approval)')

// ---- 2. The constant and the enforcing gate ----
assert.match(trust, /export const MAX_APPROVED_DEVICES_PER_USER = 3/, 'the limit is 3, defined once in deviceTrust')
const devices = read(path.join('routes', 'devices.ts'))
assert.match(devices, /countApprovedDevices\(c\.env, device\.user_id, device\.id\)/, 'approve endpoint counts the OTHER approved devices')
assert.match(devices, /approvedCount >= MAX_APPROVED_DEVICES_PER_USER/, 'approve endpoint refuses past the cap')
assert.match(devices, /device_limit_reached/, 'the refusal carries a machine-readable code')
assert.match(devices, /WHERE id = @id AND user_id = @user_id AND status = 'pending'[\s\S]*?status = 'approved' AND id != @id\) < @approved_device_limit/, 'the pending-to-approved write enforces the cap atomically for its own user')
assert.match(devices, /currentApprovedCount >= MAX_APPROVED_DEVICES_PER_USER/, 'a zero-row stale approval rechecks the current cap before responding')
// The refusal must come BEFORE the status flip to approved.
const refusalAt = devices.indexOf('device_limit_reached')
const approveAt = devices.indexOf(`SET status = 'approved'`)
assert.ok(refusalAt > 0 && approveAt > refusalAt, 'cap check precedes the approval UPDATE')

// Two administrators can both read two approved devices and decide different
// pending rows are eligible. Only the atomic predicate on the write is the
// authority: the first transition reaches three, the second changes zero.
sqlite.prepare('DELETE FROM trusted_devices WHERE user_id = 5').run()
insert.run({ u: 5, d: 'approved-a', s: 'approved' })
insert.run({ u: 5, d: 'approved-b', s: 'approved' })
insert.run({ u: 5, d: 'pending-a', s: 'pending' })
insert.run({ u: 5, d: 'pending-b', s: 'pending' })
const pendingRows = sqlite.prepare("SELECT id FROM trusted_devices WHERE user_id = 5 AND status = 'pending' ORDER BY id").all()
assert.equal(pendingRows.length, 2, 'two pending rows begin the stale-count interleaving')
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = 5 AND status = 'approved'").get().n, 2, 'both administrators could pre-read two approved devices')
const atomicApproveSql = devices.match(/UPDATE trusted_devices\s+SET status = 'approved',[\s\S]*?@approved_device_limit/)?.[0]
assert.ok(atomicApproveSql, 'lifted atomic approve SQL is present')
const atomicApprove = sqlite.prepare(atomicApproveSql)
const paramsFor = (id) => ({ id, user_id: 5, admin_id: 1, admin_name: 'admin', approved_device_limit: 3 })
assert.equal(atomicApprove.run(paramsFor(pendingRows[0].id)).changes, 1, 'first stale approval claims the final available device slot')
assert.equal(atomicApprove.run(paramsFor(pendingRows[1].id)).changes, 0, 'second stale approval cannot exceed the cap')
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = 5 AND status = 'approved'").get().n, 3, 'interleaving leaves exactly three approved devices')
assert.equal(sqlite.prepare('SELECT status FROM trusted_devices WHERE id = ?').get(pendingRows[1].id).status, 'pending', 'cap-blocked row stays pending for normal later action')

console.log('test-device-cap-pure: all checks passed')
