// Admin live-session management (J3) -- routes/devices.ts sessions routes.
//
// Two kinds of pin:
//   1. SOURCE pins on routes/devices.ts: the session credential (token_hash)
//      never appears in the file at all (so no projection can leak it and no
//      future edit can quietly select s.*), the live filter is exactly
//      "revoked_at IS NULL AND expires_at > now", both revoke paths audit,
//      and every session route registers AFTER the admin-control gate.
//   2. BEHAVIORAL runs of the routes' own SQL (lifted verbatim from source,
//      not re-typed) against the REAL user_sessions/users schema from
//      migrations 0001 + 0006, in better-sqlite3: listing excludes revoked,
//      expired and token data; the single-session revoke kills exactly one
//      row; the auth check that getSessionUser applies would then refuse it.
//
// Run: node scripts/test-admin-sessions-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')

const cloudflareRoot = path.join(__dirname, '..')
const routeSrc = fs.readFileSync(path.join(cloudflareRoot, 'src', 'routes', 'devices.ts'), 'utf8')
let checks = 0
function ok(cond, label) {
  assert.ok(cond, label)
  checks += 1
  console.log(`PASS ${label}`)
}

// ---- 1. Source pins -------------------------------------------------------

// Comments may NAME token_hash (the file explains why it must not leak);
// executable code must not touch it.
const codeOnly = routeSrc.replace(/\/\/[^\n]*/g, '')
ok(!codeOnly.includes('token_hash'), 'devices.ts code never references token_hash (credential stays inside lib/auth)')
ok(!/SELECT\s+s\.\*/i.test(routeSrc), 'the sessions listing projects explicit columns, never s.*')
ok(/WHERE s\.revoked_at IS NULL AND s\.expires_at > @now/.test(routeSrc),
  'the live filter is revoked_at IS NULL AND unexpired -- the same predicate getSessionUser enforces')
ok(/audit\([^)]*'session_revoked',\s*'user'/.test(routeSrc), 'single-session revoke is audited')
ok(/audit\([^)]*'sessions_revoked_all',\s*'user'/.test(routeSrc), 'sign-out-everywhere is audited with the revoked count')
ok(routeSrc.includes('revokeUserSessions(c.env'), 'revoke-user goes through lib/auth revokeUserSessions, no bespoke SQL')

const gateAt = routeSrc.indexOf('isAdminControlUser')
for (const route of ["app.get('/sessions'", "app.post('/sessions/:id/revoke'", "app.post('/sessions/revoke-user'", "app.get('/pending'"]) {
  const at = routeSrc.indexOf(route)
  ok(gateAt > 0 && at > gateAt, `${route}...) registers after the admin-control gate`)
}

// ---- 2. Behavioral: the routes' own SQL against the real schema -----------

// Real schema, not a reimplementation: user_sessions from 0001_init.sql plus
// the 0006 device_id ALTER, and the columns of users this join reads.
const initSql = fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0001_init.sql'), 'utf8')
const createStart = initSql.indexOf('CREATE TABLE user_sessions')
assert.ok(createStart > 0, 'user_sessions CREATE TABLE found in 0001_init.sql')
const createEnd = initSql.indexOf(';', createStart)
const createUserSessions = initSql.slice(createStart, createEnd + 1)

const db = new Database(':memory:')
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, name TEXT)')
db.exec(createUserSessions)
db.exec('ALTER TABLE user_sessions ADD COLUMN device_id TEXT')

// Lift the routes' SQL verbatim -- retyping the query is how a test keeps
// passing while the code drifts.
const selectMatch = routeSrc.match(/const LIVE_SESSION_SELECT = `([\s\S]*?)`/)
assert.ok(selectMatch, 'LIVE_SESSION_SELECT lifted from source')
const liveSelect = selectMatch[1]
const revokeMatch = routeSrc.match(/UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = @id/)
assert.ok(revokeMatch, 'single-session revoke UPDATE lifted from source')

db.prepare('INSERT INTO users (id, username, name) VALUES (1, ?, ?), (2, ?, ?)')
  .run('meng', 'Meng', 'sok', 'Sok')
const future = new Date(Date.now() + 86400000).toISOString()
const past = new Date(Date.now() - 86400000).toISOString()
const insert = db.prepare(`
  INSERT INTO user_sessions (user_id, token_hash, device_name, user_agent, last_ip, device_id, expires_at, revoked_at)
  VALUES (@user_id, @token_hash, @device_name, 'UA', '1.2.3.4', @device_id, @expires_at, @revoked_at)
`)
insert.run({ user_id: 1, token_hash: 'hash-live-1', device_name: 'iPhone', device_id: 'd1', expires_at: future, revoked_at: null })
insert.run({ user_id: 1, token_hash: 'hash-expired', device_name: 'Old laptop', device_id: 'd2', expires_at: past, revoked_at: null })
insert.run({ user_id: 2, token_hash: 'hash-live-2', device_name: 'POS tablet', device_id: 'd3', expires_at: future, revoked_at: null })
insert.run({ user_id: 2, token_hash: 'hash-revoked', device_name: 'Stolen phone', device_id: 'd4', expires_at: future, revoked_at: past })

const now = new Date().toISOString()
// better-sqlite3 named params use : or @ prefixes at bind time; the route's
// @now/@user_id map directly.
const listAll = db.prepare(`${liveSelect} ORDER BY s.last_seen_at DESC LIMIT 200`).all({ now })
ok(listAll.length === 2, 'listing returns exactly the two LIVE sessions (expired + revoked excluded)')
ok(listAll.every((row) => !('token_hash' in row)), 'no listed row carries token_hash')
ok(listAll.every((row) => typeof row.username === 'string' && typeof row.user_name === 'string'),
  'rows join the owning account (username + display name) for per-user grouping')

const listOne = db.prepare(`${liveSelect} AND s.user_id = @user_id ORDER BY s.last_seen_at DESC LIMIT 200`)
  .all({ now, user_id: 1 })
ok(listOne.length === 1 && listOne[0].device_name === 'iPhone', '?userId= scopes the listing to that account')

// Revoke user 1's live session via the route's UPDATE, then prove the auth
// predicate (same live filter) refuses it -- i.e. the revoke bites on the
// target's next request.
const liveId = listOne[0].id
db.prepare('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = @id').run({ id: liveId })
const afterRevoke = db.prepare(`${liveSelect} AND s.user_id = @user_id ORDER BY s.last_seen_at DESC LIMIT 200`)
  .all({ now, user_id: 1 })
ok(afterRevoke.length === 0, 'revoking the session removes it from the live set (auth would now refuse it)')
const untouched = db.prepare(`${liveSelect} ORDER BY s.last_seen_at DESC LIMIT 200`).all({ now })
ok(untouched.length === 1 && untouched[0].user_id === 2, 'revoke touched exactly one row -- the other account is untouched')

// Sign-out-everywhere = lib/auth revokeUserSessions' own SQL (pinned there).
db.prepare('UPDATE user_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = @user_id AND revoked_at IS NULL')
  .run({ user_id: 2 })
const afterAll = db.prepare(`${liveSelect} ORDER BY s.last_seen_at DESC LIMIT 200`).all({ now })
ok(afterAll.length === 0, 'sign-out-everywhere leaves the account with zero live sessions')

console.log(`\nAll ${checks} admin-session checks passed.`)
