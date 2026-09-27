// F3 (Records/Performance/2026-09-25 I1): one session lookup per request.
//
// Stacked routers each ran requireAuth -- products + productCost, inventory +
// stockInCommit, system + compat -- and index.ts's staff body admission ran
// getSessionUser before the route's own requireAuth. Every one of those was a
// separate D1 round trip for the same cookie in the same request.
//
// Pins, against the real transpiled lib/auth.ts:
//   - repeated/stacked lookups on ONE request context cost one statement
//   - the memo never crosses requests (a second context looks up again)
//   - a revoked session is not served from the memo afterwards
//   - a failed lookup is not memoized
//   - the last-seen/slide side effects are scheduled once, not per lookup
//
// Run: node scripts/test-session-memo-per-request-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(relative, dependencies = {}) {
  const filename = path.join(__dirname, '../src', relative)
  const source = fs.readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)((name) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected dependency: ${name}`)
  }, module, module.exports)
  return module.exports
}

const db = { lookups: 0, writes: 0, fail: false, row: null }
const fakeDb = {
  prepare(sql) {
    return {
      get: async () => {
        assert.match(sql, /FROM user_sessions s/)
        db.lookups += 1
        if (db.fail) throw new Error('D1_ERROR: network')
        return db.row ? { ...db.row } : undefined
      },
      run: async () => { db.writes += 1; return { changes: 1, lastInsertRowid: 0 } },
    }
  },
}

const auth = load('lib/auth.ts', {
  'hono/cookie': {
    getCookie: (c, name) => c.cookies[name],
    setCookie: () => {},
    deleteCookie: () => {},
  },
  './db': { getDb: () => fakeDb },
  '../index': {},
})

function context(token = 'tok-a') {
  const vars = new Map()
  const waits = []
  return {
    env: {},
    cookies: token ? { bos_session: token } : {},
    executionCtx: { waitUntil: (p) => { waits.push(p) } },
    waits,
    get: (key) => vars.get(key),
    set: (key, value) => { vars.set(key, value) },
    json: (body, status) => ({ body, status }),
  }
}

function liveRow() {
  // last_seen far in the past and past half-life, so both side effects fire.
  return {
    id: 7, username: 'cashier', name: 'Cashier', organization_id: 1, role_id: 3,
    permissions: '{}', is_active: 1, role_code: 'employee', role_permissions: '{"pos":true}', role_name: 'Employee',
    session_created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    session_expires_at: new Date(Date.now() + 5 * 86400000).toISOString(),
    session_last_seen_at: '2000-01-01 00:00:00',
  }
}

function reset(row = liveRow()) { db.lookups = 0; db.writes = 0; db.fail = false; db.row = row }

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

async function main() {
  await check('two getSessionUser calls on one request do one lookup and return the same user', async () => {
    reset()
    const c = context()
    const a = await auth.getSessionUser(c)
    const b = await auth.getSessionUser(c)
    assert.equal(db.lookups, 1)
    assert.equal(a.id, 7)
    assert.equal(a, b)
    assert.equal('session_created_at' in a, false, 'session metadata never leaks onto the user object')
  })

  await check('stacked requireAuth (two routers) does one lookup and both reach next()', async () => {
    reset()
    const c = context()
    let nexts = 0
    await auth.requireAuth(c, async () => { nexts += 1 })
    await auth.requireAuth(c, async () => { nexts += 1 })
    assert.equal(db.lookups, 1)
    assert.equal(nexts, 2)
    assert.equal(c.get('user').id, 7)
  })

  await check('index.ts staff admission (getSessionUser) then a router requireAuth share one lookup', async () => {
    reset()
    const c = context()
    const admitted = await auth.getSessionUser(c)
    let reached = false
    await auth.requireAuth(c, async () => { reached = true })
    assert.equal(db.lookups, 1)
    assert.equal(reached, true)
    assert.equal(c.get('user'), admitted)
  })

  await check('concurrent lookups on one request share the in-flight query', async () => {
    reset()
    const c = context()
    const [a, b] = await Promise.all([auth.getSessionUser(c), auth.getSessionUser(c)])
    assert.equal(db.lookups, 1)
    assert.equal(a, b)
  })

  await check('touch and slide side effects are scheduled once per request, not per lookup', async () => {
    reset()
    const c = context()
    await auth.getSessionUser(c)
    await auth.getSessionUser(c)
    await auth.requireAuth(c, async () => {})
    assert.equal(c.waits.length, 2, 'one last_seen touch + one slide')
    await Promise.all(c.waits)
    assert.equal(db.writes, 2)
  })

  await check('the memo never crosses requests: a second context looks up again', async () => {
    reset()
    await auth.getSessionUser(context())
    await auth.getSessionUser(context())
    assert.equal(db.lookups, 2)
  })

  await check('a different cookie on another request is never answered with the first user', async () => {
    reset()
    const first = context('tok-a')
    assert.equal((await auth.getSessionUser(first)).id, 7)
    db.row = null
    const second = context('tok-b')
    assert.equal(await auth.getSessionUser(second), null)
    let reached = false
    const res = await auth.requireAuth(second, async () => { reached = true })
    assert.equal(reached, false)
    assert.equal(res.status, 401)
    assert.equal(res.body.code, 'invalid_session')
  })

  await check('no session is also memoized within the request (401 path costs one lookup)', async () => {
    reset(null)
    const c = context()
    const r1 = await auth.requireAuth(c, async () => { throw new Error('must not reach') })
    const r2 = await auth.requireAuth(c, async () => { throw new Error('must not reach') })
    assert.equal(r1.status, 401)
    assert.equal(r2.status, 401)
    assert.equal(db.lookups, 1)
    assert.equal(c.get('user'), undefined)
  })

  await check('no cookie: no lookup at all', async () => {
    reset()
    const c = context(null)
    assert.equal(await auth.getSessionUser(c), null)
    assert.equal(db.lookups, 0)
  })

  await check('revokeSession drops the memo, so a later lookup in the same request re-reads', async () => {
    reset()
    const c = context()
    assert.equal((await auth.getSessionUser(c)).id, 7)
    await auth.revokeSession(c)
    db.row = null
    assert.equal(await auth.getSessionUser(c), null)
    assert.equal(db.lookups, 2)
  })

  await check('a failed lookup is not memoized: the next call on the request retries', async () => {
    reset()
    const c = context()
    db.fail = true
    await assert.rejects(() => auth.getSessionUser(c), /network/)
    db.fail = false
    assert.equal((await auth.getSessionUser(c)).id, 7)
    assert.equal(db.lookups, 2)
  })

  await check('the memo lives on the request only: nothing is written to headers or the user var before auth', async () => {
    reset()
    const c = context()
    await auth.getSessionUser(c)
    // getSessionUser alone must not authorize: only requireAuth sets `user`.
    assert.equal(c.get('user'), undefined)
  })

  console.log(`\n${passed} session memo checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
