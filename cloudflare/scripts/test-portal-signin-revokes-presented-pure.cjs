// G38 R2-2 (review F2): a portal sign-in revokes the session the browser presented, in the same batch as the new session,
// and the slide re-issues the cookie only when it is due.
//
// Drives the REAL routes/portal.ts and lib/portalSession.ts on in-memory SQLite with every migration. The password
// sign-in and the sign-up are the two handlers that mint a session today (the Telegram claim, S3e, must use the same
// helper: its test lives with S3e).
//
// Run (from cloudflare/): node scripts/test-portal-signin-revokes-presented-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

const SRC = path.join(__dirname, '..', 'src')
const readSrc = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
const PASSWORD = 'sup3rsecret-pass'
const SETTINGS = { customer_portal_signup_enabled: 'true' }

let passed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) }
}

function cookieOf(res) {
  const header = res.headers.get('Set-Cookie') || ''
  const match = /(?:^|,\s*)bos_portal=([^;]+)/.exec(header)
  return match ? match[1] : null
}
const withCookie = (token) => ({ Cookie: `bos_portal=${token}` })
const sessions = (h) => h.raw.prepare('SELECT id, account_id, revoked_at FROM portal_sessions ORDER BY id').all({})
const sessionCount = (h) => sessions(h).length
let phoneSeq = 0
const names = new Map()
const nameOf = (phone) => names.get(phone)

async function signUp(h, ip, headers) {
  phoneSeq += 1
  const phone = `0127${String(phoneSeq).padStart(5, '0')}`
  const res = await h.request('/auth/signup', 'POST', { name: `Visitor ${phoneSeq}`, phone, password: PASSWORD, consent: true, ageConfirmed: true, consentLocale: 'en' }, { ip, headers })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  names.set(phone, `Visitor ${phoneSeq}`)
  return { phone, res, token: cookieOf(res) }
}
const signIn = (h, phone, ip, headers) => h.request('/auth/signin', 'POST', { identifier: nameOf(phone), phone, password: PASSWORD, consent: true }, { ip, headers })
const me = (h, token) => h.request('/auth/me', 'GET', undefined, { headers: token ? withCookie(token) : {} })

async function main(sources = {}) {
  const h = createPortalHarness({ settings: SETTINGS, sources })

  await check('R2-2 sign in as A, then as B in the same browser, then a late response carries A cookie: A is revoked and the request is unauthenticated', async () => {
    const a = await signUp(h, '203.0.113.31')
    const b0 = await signUp(h, '203.0.113.32')
    assert.ok(a.token && b0.token)
    // The browser holds A when B signs in.
    const res = await signIn(h, b0.phone, '203.0.113.33', withCookie(a.token))
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const bToken = cookieOf(res)
    assert.ok(bToken && bToken !== a.token)
    const late = await me(h, a.token)
    assert.equal(late.status, 200)
    assert.equal(late.body.account, null, 'the late response carrying A cookie finds no live session')
    assert.ok((await me(h, bToken)).body.account, 'B is signed in')
    const revoked = sessions(h).filter((s) => s.revoked_at)
    assert.equal(revoked.length, 1, 'exactly the presented session is revoked')
  })

  await check('R2-2 sign-up with a presented cookie revokes that session too', async () => {
    const a = await signUp(h, '203.0.113.34')
    const b = await signUp(h, '203.0.113.35', withCookie(a.token))
    assert.ok(b.token && b.token !== a.token)
    assert.equal((await me(h, a.token)).body.account, null)
    assert.ok((await me(h, b.token)).body.account)
  })

  await check('R2-2 a sign-in with no cookie, or a cookie that matches no session, writes one session and revokes nothing', async () => {
    const a = await signUp(h, '203.0.113.36')
    const before = sessions(h)
    const none = await signIn(h, a.phone, '203.0.113.37')
    assert.equal(none.status, 200)
    const stranger = await signIn(h, a.phone, '203.0.113.38', withCookie('not-a-session-token'))
    assert.equal(stranger.status, 200)
    const after = sessions(h)
    assert.equal(after.length, before.length + 2)
    assert.deepEqual(after.slice(0, before.length), before, 'earlier rows untouched')
    assert.ok(after.slice(before.length).every((s) => !s.revoked_at))
  })

  await check('R2-2 signing in again as the same account swaps the presented session for the new one', async () => {
    const a = await signUp(h, '203.0.113.39')
    const res = await signIn(h, a.phone, '203.0.113.40', withCookie(a.token))
    const next = cookieOf(res)
    assert.equal((await me(h, a.token)).body.account, null)
    assert.ok((await me(h, next)).body.account)
  })

  await check('R2-2 a failed sign-in revokes nothing', async () => {
    const a = await signUp(h, '203.0.113.41')
    const res = await h.request('/auth/signin', 'POST', { identifier: nameOf(a.phone), phone: a.phone, password: 'wrong-password-1', consent: true }, { ip: '203.0.113.42', headers: withCookie(a.token) })
    assert.equal(res.status, 401)
    assert.ok((await me(h, a.token)).body.account, 'the presented session still works')
  })

  await check('R3-1 an expired, unrevoked presented session is never written to (changes 0 on the revoke)', async () => {
    const a = await signUp(h, '203.0.113.44')
    const b = await signUp(h, '203.0.113.45')
    // A's session expired a day ago and was never revoked (a failed slide write, or clock skew).
    h.raw.prepare('UPDATE portal_sessions SET expires_at = @past WHERE account_id = (SELECT id FROM portal_accounts WHERE phone = @phone)')
      .run({ past: new Date(Date.now() - 86400000).toISOString(), phone: a.phone })
    const before = sessions(h)
    const res = await signIn(h, b.phone, '203.0.113.46', withCookie(a.token))
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const after = sessions(h)
    assert.equal(after.length, before.length + 1, 'one new row')
    assert.deepEqual(after.slice(0, before.length), before, 'the expired row (and every other) is byte-identical: no revoked_at written')
  })

  await check('R3-2 the new session and the revoke of the presented one are ONE batch of two statements, awaited, and nothing else writes portal_sessions', async () => {
    const a = await signUp(h, '203.0.113.47')
    const b = await signUp(h, '203.0.113.48')
    const log = []
    const realBatch = h.db.batch
    const realPrepare = h.db.prepare
    h.db.batch = (items) => {
      log.push({ kind: 'batch', sqls: items.map((i) => String(i.sql).replace(/\s+/g, ' ').trim()) })
      return realBatch(items)
    }
    h.db.prepare = (sql) => {
      const stmt = realPrepare(sql)
      return { ...stmt, run: async (params) => { log.push({ kind: 'run', sql: String(sql).replace(/\s+/g, ' ').trim() }); return stmt.run(params) } }
    }
    let res
    try {
      res = await signIn(h, b.phone, '203.0.113.49', withCookie(a.token))
    } finally {
      h.db.batch = realBatch
      h.db.prepare = realPrepare
    }
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const writes = log.filter((e) => (e.kind === 'run' ? [e.sql] : e.sqls).some((s) => /portal_sessions/.test(s) && /^(INSERT|UPDATE|DELETE)/.test(s)))
    assert.equal(writes.length, 1, `exactly one write call touches portal_sessions, got ${JSON.stringify(writes)}`)
    assert.equal(writes[0].kind, 'batch', 'the insert and the revoke go through one batch')
    assert.equal(writes[0].sqls.length, 2)
    assert.match(writes[0].sqls[0], /^INSERT INTO portal_sessions/)
    assert.match(writes[0].sqls[1], /^UPDATE portal_sessions SET revoked_at/)
    // awaited: the revoke has happened by the time the response is returned
    assert.equal((await me(h, a.token)).body.account, null)
  })

  await check('R3-2 a presented session that is already revoked is never written to again', async () => {
    const a = await signUp(h, '203.0.113.50')
    const b = await signUp(h, '203.0.113.51')
    const when = '2020-01-01T00:00:00.000Z'
    h.raw.prepare('UPDATE portal_sessions SET revoked_at = @when WHERE account_id = (SELECT id FROM portal_accounts WHERE phone = @phone)').run({ when, phone: a.phone })
    const before = sessions(h)
    const res = await signIn(h, b.phone, '203.0.113.52', withCookie(a.token))
    assert.equal(res.status, 200, JSON.stringify(res.body))
    const after = sessions(h)
    assert.equal(after.length, before.length + 1)
    assert.deepEqual(after.slice(0, before.length), before, 'the revoked row keeps its original revoked_at')
    assert.ok(after.slice(0, before.length).filter((s) => s.revoked_at === when).length >= 1)
  })

  await check('R3-2 only the presented session is revoked: the account\'s other devices stay signed in', async () => {
    const a = await signUp(h, '203.0.113.53')
    const a2Res = await signIn(h, a.phone, '203.0.113.54')
    const a2 = cookieOf(a2Res)
    assert.ok(a2 && a2 !== a.token)
    const b = await signUp(h, '203.0.113.55')
    const res = await signIn(h, b.phone, '203.0.113.56', withCookie(a.token))
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal((await me(h, a.token)).body.account, null, 'the presented device is signed out')
    assert.ok((await me(h, a2)).body.account, "A's other device stays signed in")
    assert.ok((await me(h, b.token)).body.account, "B's own earlier device stays signed in")
  })

  await check('B1 an ordinary authenticated response sets no cookie when no slide is due', async () => {
    const a = await signUp(h, '203.0.113.43')
    const res = await me(h, a.token)
    assert.ok(res.body.account)
    assert.equal(res.headers.get('Set-Cookie'), null)
  })

  await check('R2-2 source: both session-minting handlers use the replacing helper, never a bare createPortalSession', async () => {
    const portal = readSrc('routes/portal.ts')
    assert.equal((portal.match(/createPortalSessionReplacingPresented\(c, /g) || []).length, 2)
    assert.doesNotMatch(portal, /\bcreatePortalSession\(/)
  })
}

main().then(() => console.log(`${passed} portal sign-in revokes presented session checks passed`))
