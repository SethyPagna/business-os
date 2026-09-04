// Shift schema invariants. No route-source regex extraction: route refactors
// cannot silently turn this guard off.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const root = path.join(__dirname, '..')
const db = new Database(':memory:')
db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT)')
db.exec(fs.readFileSync(path.join(root, 'migrations', '0116_shift_sessions.sql'), 'utf8'))
db.exec(fs.readFileSync(path.join(root, 'migrations', '0118_shift_policy_and_amendments.sql'), 'utf8'))

const insert = db.prepare(`INSERT INTO shift_sessions
  (shift_code,scope_mode,user_id,branch_id,business_date,opened_at)
  VALUES (@code,@scope,@user,@branch,@day,@opened)`)
const base = { code: 'S-1', scope: 'per_account', user: 7, branch: null, day: '2026-09-05', opened: '2026-09-05T01:00:00.000Z' }
insert.run(base)
assert.throws(() => insert.run({ ...base, code: 'S-2' }), /UNIQUE/)
insert.run({ ...base, code: 'S-3', user: 8 })
db.prepare('DELETE FROM shift_sessions').run()
insert.run({ ...base, code: 'S-4', scope: 'shop_wide' })
assert.throws(() => insert.run({ ...base, code: 'S-5', scope: 'shop_wide', user: 8 }), /UNIQUE/)
insert.run({ ...base, code: 'S-6', scope: 'shop_wide', user: 8, branch: 2 })

const shiftId = db.prepare("SELECT id FROM shift_sessions WHERE shift_code='S-4'").get().id
db.prepare(`INSERT INTO shift_session_amendments
 (shift_session_id,actor_user_id,actor_name,reason,before_json,after_json) VALUES (?,?,?,?,?,?)`)
  .run(shiftId, 1, 'Manager', 'Correct count', '{"x":0}', '{"x":1}')
assert.throws(() => db.prepare('UPDATE shift_session_amendments SET reason=? WHERE shift_session_id=?').run('rewrite', shiftId), /immutable/)
assert.throws(() => db.prepare('DELETE FROM shift_session_amendments WHERE shift_session_id=?').run(shiftId), /immutable/)
const settings = Object.fromEntries(db.prepare("SELECT key,value FROM settings WHERE key LIKE 'shift_%'").all().map((r) => [r.key, r.value]))
assert.deepEqual(settings, { shift_admin_exempt: 'true', shift_scope_mode: 'per_account' })
console.log('OK shift schema: account/shop concurrency, branch separation, safe defaults, immutable history')
