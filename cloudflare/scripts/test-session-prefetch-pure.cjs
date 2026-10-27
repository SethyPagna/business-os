'use strict'
// lib/auth.ts prefetchWithSession / takePrefetched: a route's first read rides in the session lookup's db.batch.
//
// The rule that makes this safe: the rows are handed to a handler only after requireAuth ACCEPTED the session. The
// handler never runs on a refusal (no session, a revoked or expired one, a forced password change), so the only thing
// that stands between a refused request and the prefetched rows is takePrefetched's own user check. The native test
// (test-session-next-request-native.cjs) can only see responses; this one calls takePrefetched directly after each
// refusal, so removing that check turns it red.
//
// Pins, against the real transpiled lib/auth.ts:
//   - the lookup and the prefetched statements are ONE batch (no separate get), and the rows come back by index
//   - a forced password change (403), a missing session and a request that never authenticated release no rows,
//     although the batch already read them
//   - a lookup that ran before the prefetch was registered leaves the handler to read for itself
//   - a failing prefetched statement does not make the isolate forget the must_change_password column
//
// Run: node scripts/test-session-prefetch-pure.cjs
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(relative, dependencies = {}) {
  const filename = path.join(__dirname, '../src', relative)
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)((name) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected dependency: ${name}`)
  }, module, module.exports)
  return module.exports
}

const state = { batches: [], gets: 0, row: null, extra: [[{ id: 1, name: 'Shop' }]], failBatch: null }
const fakeDb = {
  prepare() { return { get: async () => { state.gets += 1; return state.row ? { ...state.row } : undefined }, run: async () => ({ changes: 1, lastInsertRowid: 0 }) } },
  async batch(statements) {
    state.batches.push(statements.map((statement) => statement.sql))
    if (state.failBatch) throw new Error(state.failBatch)
    return [{ results: state.row ? [{ ...state.row }] : [] }, ...state.extra.map((rows) => ({ results: rows }))]
  },
}
const auth = load('lib/auth.ts', {
  'hono/cookie': { getCookie: (c, name) => c.cookies[name], setCookie() {}, deleteCookie() {} },
  './db': { getDb: () => fakeDb },
  'node:async_hooks': require('node:async_hooks'),
  '../index': {},
})

function context(method = 'GET', route = '/api/branches') {
  const vars = new Map()
  return {
    env: {}, cookies: { bos_session: 'tok-a' }, req: { method, path: route },
    executionCtx: { waitUntil() {} },
    get: (key) => vars.get(key), set: (key, value) => { vars.set(key, value) },
    json: (body, status) => ({ body, status }),
  }
}
const liveRow = (extra = {}) => ({
  id: 7, username: 'cashier', name: 'Cashier', organization_id: 1, role_id: 3, permissions: '{}', is_active: 1, role_code: 'employee',
  role_permissions: '{"pos":true}', role_name: 'Employee',
  session_created_at: new Date(Date.now() - 86400000).toISOString(), session_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
  session_last_seen_at: new Date().toISOString(), ...extra,
})
const PREFETCH = [{ sql: 'SELECT * FROM branches' }]
const reset = (row = liveRow()) => { state.batches = []; state.gets = 0; state.row = row; state.failBatch = null }

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function main() {
  await check('the lookup and the prefetched read are one batch; the rows come back by index after requireAuth', async () => {
    reset()
    const c = context()
    auth.prefetchWithSession(c, PREFETCH)
    let reached = false
    await auth.requireAuth(c, async () => { reached = true })
    assert.equal(reached, true)
    assert.equal(state.batches.length, 1)
    assert.equal(state.gets, 0, 'no separate session read')
    assert.match(state.batches[0][0], /FROM user_sessions s/)
    assert.equal(state.batches[0][1], 'SELECT * FROM branches')
    assert.deepEqual(auth.takePrefetched(c, 0), [{ id: 1, name: 'Shop' }])
    assert.equal(auth.takePrefetched(c, 5), undefined)
  })

  await check('a forced password change is refused (403) and releases no rows, although the batch already read them', async () => {
    reset(liveRow({ must_change_password: 1 }))
    const c = context()
    auth.prefetchWithSession(c, PREFETCH)
    const response = await auth.requireAuth(c, async () => { throw new Error('must not reach') })
    assert.equal(response.status, 403)
    assert.equal(response.body.code, 'password_change_required')
    assert.equal(state.batches.length, 1, 'control: the rows WERE read in the batch')
    assert.equal(c.get('user'), undefined)
    assert.equal(auth.takePrefetched(c, 0), undefined, 'but a refused request is handed none of them')
  })

  await check('no live session (revoked, expired, deactivated): 401 and no rows', async () => {
    reset(null)
    const c = context()
    auth.prefetchWithSession(c, PREFETCH)
    const response = await auth.requireAuth(c, async () => { throw new Error('must not reach') })
    assert.equal(response.status, 401)
    assert.equal(auth.takePrefetched(c, 0), undefined)
  })

  await check('a session looked up but not yet accepted by requireAuth (the staff body admission) releases nothing', async () => {
    reset()
    const c = context()
    auth.prefetchWithSession(c, PREFETCH)
    assert.equal((await auth.getSessionUser(c)).id, 7)
    assert.equal(c.get('user'), undefined)
    assert.equal(auth.takePrefetched(c, 0), undefined)
  })

  await check('a lookup that already ran leaves the handler to read for itself (registration is ignored, one plain read)', async () => {
    reset()
    const c = context()
    await auth.getSessionUser(c)
    auth.prefetchWithSession(c, PREFETCH)
    await auth.requireAuth(c, async () => {})
    assert.equal(state.batches.length, 0)
    assert.equal(state.gets, 1)
    assert.equal(auth.takePrefetched(c, 0), undefined)
  })

  await check('prefetched rows never cross requests', async () => {
    reset()
    const first = context()
    auth.prefetchWithSession(first, PREFETCH)
    await auth.requireAuth(first, async () => {})
    const second = context()
    await auth.requireAuth(second, async () => {})
    assert.equal(auth.takePrefetched(second, 0), undefined)
  })

  await check('a failing prefetched statement is an error for the request and does not make the isolate drop must_change_password', async () => {
    reset()
    state.failBatch = 'D1_ERROR: no such column: bogus: SQLITE_ERROR'
    const c = context()
    auth.prefetchWithSession(c, PREFETCH)
    await assert.rejects(() => auth.requireAuth(c, async () => {}), /no such column: bogus/)
    reset(liveRow({ must_change_password: 1 }))
    const next = context()
    const response = await auth.requireAuth(next, async () => { throw new Error('must not reach') })
    assert.equal(response.status, 403, 'the forced-change gate still works: the column is still read')
    const sql = []
    const probe = context()
    auth.prefetchWithSession(probe, PREFETCH)
    state.row = liveRow()
    await auth.requireAuth(probe, async () => {})
    sql.push(state.batches[state.batches.length - 1][0])
    assert.match(sql[0], /u\.must_change_password/)
  })

  console.log(`${passed} checks passed`)
}

main().catch((error) => { console.error(error); process.exit(1) })
