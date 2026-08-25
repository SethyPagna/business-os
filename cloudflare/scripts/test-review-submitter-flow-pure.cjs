// The submitter's half of the review/approval loop.
//
//   "for review required, when user does an action, it shows for them
//    pending... for admin, will see it, if approve, keep in record, then
//    applied... also, if deny, it doesn't delete, but shows to the user,
//    denies and can review and submit review again... for deny admin can
//    also send why, and user can check."
//
// The reviewer half already existed (routes/reviewQueue.ts: list, approve,
// reject-with-reason). The submitter half did not: every route on that
// router sat behind `hasPermission(user, 'review')`, so a Review Required
// user -- who by definition does NOT hold `review` -- got 403 on all of it
// and could not see their own requests at all, let alone read why one was
// turned down or ask again.
//
// This covers the two things that make that safe, because both are easy to
// get subtly wrong and neither fails loudly:
//
//   1. SCOPING. /mine must return the caller's own rows and nobody else's,
//      and resubmit must be unreachable for another person's row -- not
//      merely hidden from a list.
//   2. STATE. Resubmitting reopens the SAME row (one identity across
//      rounds, reason cleared, reviewer fields cleared) and only ever from
//      'rejected', so it can never resurrect something already approved
//      and applied.
//
// Exercises the real lib/pendingActions.ts against the real migrated
// schema, not a hand-written mock of either.
//
// Run: node scripts/test-review-submitter-flow-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Database = require('better-sqlite3')

function loadTs(relPath) {
  const src = fs.readFileSync(path.join(__dirname, '..', relPath), 'utf8')
  const { outputText } = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(relPath),
  })
  const mod = { exports: {} }
  new Function('exports', 'require', 'module', outputText)(mod.exports, require, mod)
  return mod.exports
}

let passed = 0
// Awaits `fn` -- several of these drive async lib functions, and a
// non-awaiting helper let their assertions run after db.close(), which
// surfaced as a teardown crash rather than as a failing test.
const checks = []
function check(name, fn) {
  checks.push(async () => {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  })
}

// --- real schema ----------------------------------------------------------

const db = new Database(':memory:')
const migrationsDir = path.join(__dirname, '..', 'migrations')
const pendingMigration = fs.readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(migrationsDir, f), 'utf8'))
  .find((sql) => /CREATE TABLE (?:IF NOT EXISTS )?pending_actions/i.test(sql))
assert.ok(pendingMigration, 'no migration creates pending_actions')
const ddl = pendingMigration.match(/CREATE TABLE (?:IF NOT EXISTS )?pending_actions\s*\([\s\S]*?\n\);/i)
assert.ok(ddl, 'could not extract the pending_actions DDL')
db.exec(ddl[0])

// Minimal D1-compatible shim: the lib calls prepare().run()/get()/all() with
// named @params and reads result.changes.
const env = {}
const dbModule = require.cache[require.resolve(path.join(__dirname, '..', 'src', 'lib', 'db.ts'))]
void dbModule

const fakeDb = {
  prepare(sql) {
    const stmt = db.prepare(sql.replace(/@(\w+)/g, ':$1'))
    return {
      run: (params = {}) => ({ changes: stmt.run(params).changes }),
      get: (params = {}) => stmt.get(params),
      all: (params = {}) => stmt.all(params),
    }
  },
}

// lib/pendingActions.ts imports getDb from './db'; stub that one module.
const libPath = path.join(__dirname, '..', 'src', 'lib', 'pendingActions.ts')
const libSrc = fs.readFileSync(libPath, 'utf8')
const { outputText } = ts.transpileModule(libSrc, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: 'pendingActions.ts',
})
const mod = { exports: {} }
const fakeRequire = (id) => (id === './db' ? { getDb: () => fakeDb } : require(id))
new Function('exports', 'require', 'module', outputText)(mod.exports, fakeRequire, mod)
const { listPendingActions, resubmitPendingAction, markPendingActionRejected } = mod.exports

// --- fixtures -------------------------------------------------------------

const ALICE = 900
const BOB = 1

const insert = db.prepare(`
  INSERT INTO pending_actions (id, section, action_type, entity_type, entity_id, payload_json, summary, status, requested_by, requested_by_name)
  VALUES (@id, 'products', 'update', 'product', 5001, @payload, @summary, @status, @by, @byName)
`)
insert.run({ id: 1, payload: '{"a":1}', summary: 'Alice open', status: 'open', by: ALICE, byName: 'Alice' })
insert.run({ id: 2, payload: '{"a":2}', summary: 'Alice rejected', status: 'rejected', by: ALICE, byName: 'Alice' })
insert.run({ id: 3, payload: '{"a":3}', summary: 'Bob rejected', status: 'rejected', by: BOB, byName: 'Bob' })
insert.run({ id: 4, payload: '{"a":4}', summary: 'Alice approved', status: 'approved', by: ALICE, byName: 'Alice' })
// Row 5 exists solely to stay 'open' for the last check. Row 1 cannot serve
// that purpose: an earlier check deliberately rejects it to prove the
// reviewer's reason reaches the submitter, so by the end of the file it is
// no longer open. (That ordering dependency was invisible while the runner
// did not await its checks -- the assertions ran after teardown.)
insert.run({ id: 5, payload: '{"a":5}', summary: 'Alice still open', status: 'open', by: ALICE, byName: 'Alice' })

// --- 1. scoping -----------------------------------------------------------

check('/mine returns every status by default -- a submitter is asking "what happened to my requests?"', async () => {
  const rows = await listPendingActions(env, { status: 'all', requestedBy: ALICE })
  assert.deepEqual(rows.map((r) => r.id).sort(), [1, 2, 4, 5], 'all of Alice\'s rows regardless of status')
})

check('/mine never leaks another submitter\'s rows', async () => {
  const rows = await listPendingActions(env, { status: 'all', requestedBy: ALICE })
  assert.ok(!rows.some((r) => r.id === 3), "Bob's row must not appear in Alice's list")
  const bobRows = await listPendingActions(env, { status: 'all', requestedBy: BOB })
  assert.deepEqual(bobRows.map((r) => r.id), [3])
})

check('the reviewer listing is unchanged -- no requestedBy means everyone\'s rows', async () => {
  const rows = await listPendingActions(env, { status: 'all' })
  assert.deepEqual(rows.map((r) => r.id).sort(), [1, 2, 3, 4, 5])
})

check('a rejection carries the reviewer\'s reason through to the submitter\'s own list', async () => {
  await markPendingActionRejected(env, 1, { reviewedBy: BOB, reviewedByName: 'Bob', rejectReason: 'Below cost.' })
  const rows = await listPendingActions(env, { status: 'rejected', requestedBy: ALICE })
  const row = rows.find((r) => r.id === 1)
  assert.equal(row.reject_reason, 'Below cost.', 'the submitter must be able to read WHY')
  assert.equal(row.reviewed_by_name, 'Bob')
})

// --- 2. resubmit state machine -------------------------------------------

check('a submitter can reopen their OWN rejected request, carrying a revised payload', async () => {
  const ok = await resubmitPendingAction(env, 2, { requestedBy: ALICE, payloadJson: '{"a":"fixed"}', summary: 'Alice revised' })
  assert.equal(ok, true)
  const row = db.prepare('SELECT * FROM pending_actions WHERE id = 2').get()
  assert.equal(row.status, 'open', 'back in front of the reviewers')
  assert.equal(row.payload_json, '{"a":"fixed"}')
  assert.equal(row.summary, 'Alice revised')
  assert.equal(row.reject_reason, null, 'the superseded reason must be cleared')
  assert.equal(row.reviewed_by, null, 'and the stale reviewer fields with it')
  assert.equal(row.reviewed_at, null)
})

check('resubmitting unchanged is allowed -- "please look again" is legitimate', async () => {
  await markPendingActionRejected(env, 2, { reviewedBy: BOB, reviewedByName: 'Bob', rejectReason: 'Still no.' })
  const ok = await resubmitPendingAction(env, 2, { requestedBy: ALICE })
  assert.equal(ok, true)
  const row = db.prepare('SELECT * FROM pending_actions WHERE id = 2').get()
  assert.equal(row.status, 'open')
  assert.equal(row.payload_json, '{"a":"fixed"}', 'an omitted payload keeps the previous one, it does not blank it')
})

check('a rejection is never a delete -- the row survives every round', () => {
  const row = db.prepare('SELECT id, created_at FROM pending_actions WHERE id = 2').get()
  assert.ok(row, 'the row still exists after reject -> resubmit -> reject -> resubmit')
})

// The security-critical half: these must fail at the UPDATE, so another
// person's row is unreachable rather than merely absent from a listing.
check('a submitter CANNOT reopen someone else\'s rejected request', async () => {
  const ok = await resubmitPendingAction(env, 3, { requestedBy: ALICE })
  assert.equal(ok, false, "Alice must not be able to touch Bob's row")
  assert.equal(db.prepare('SELECT status FROM pending_actions WHERE id = 3').get().status, 'rejected', 'and it must be unchanged')
})

check('an ALREADY-APPROVED request can never be reopened', async () => {
  const ok = await resubmitPendingAction(env, 4, { requestedBy: ALICE })
  assert.equal(ok, false, 'resurrecting an applied change would re-run a write that already happened')
  assert.equal(db.prepare('SELECT status FROM pending_actions WHERE id = 4').get().status, 'approved')
})

check('an already-OPEN request cannot be resubmitted (no duplicate queue entries)', async () => {
  const ok = await resubmitPendingAction(env, 5, { requestedBy: ALICE })
  assert.equal(ok, false)
  assert.equal(db.prepare('SELECT status FROM pending_actions WHERE id = 5').get().status, 'open')
})

// --- 3. route wiring ------------------------------------------------------
//
// The scoping above is enforced by the lib, but only if the ROUTES call it
// correctly. Two things must stay true in routes/reviewQueue.ts and neither
// is visible from the lib: the submitter routes have to be declared BEFORE
// the `review` permission gate (Hono runs the chain in registration order,
// so a handler declared first responds without the later middleware ever
// running), and they must take the user id from the SESSION, never the
// request.
const routeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'reviewQueue.ts'), 'utf8')

check('submitter routes are declared before the `review` permission gate', () => {
  const minePos = routeSrc.indexOf("app.get('/mine'")
  const resubmitPos = routeSrc.indexOf("app.post('/:id/resubmit'")
  const gatePos = routeSrc.indexOf("hasPermission(user, 'review')")
  assert.ok(minePos > 0 && resubmitPos > 0 && gatePos > 0, 'expected routes and gate to exist')
  assert.ok(minePos < gatePos, '/mine must be registered before the review gate or it 403s for the very users it exists for')
  assert.ok(resubmitPos < gatePos, '/:id/resubmit must be registered before the review gate')
})

check('submitter routes scope to the session user, never a request-supplied id', () => {
  const mineBlock = routeSrc.slice(routeSrc.indexOf("app.get('/mine'"), routeSrc.indexOf("app.post('/:id/resubmit'"))
  assert.match(mineBlock, /requestedBy: Number\(user\.id\)/, '/mine must scope to the session user')
  assert.doesNotMatch(mineBlock, /req\.query\('user|requested_by/, 'must not accept a user id from the query string')
})

async function main() {
  for (const run of checks) await run()
  db.close()
  console.log(`\n${passed} review-submitter-flow checks passed`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
