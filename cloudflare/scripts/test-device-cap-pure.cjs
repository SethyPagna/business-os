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
// The refusal must come BEFORE the status flip to approved.
const refusalAt = devices.indexOf('device_limit_reached')
const approveAt = devices.indexOf(`SET status = 'approved'`)
assert.ok(refusalAt > 0 && approveAt > refusalAt, 'cap check precedes the approval UPDATE')

console.log('test-device-cap-pure: all checks passed')
