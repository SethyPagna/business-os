// G38 Phase 1 (design S6) and owner answer 5:
//   - a storefront session lives at most 90 days from sign-in and ends after
//     30 days without a visit, including rows written under the old 399-day
//     sliding rule (no data migration needed);
//   - a suspended member's session stops working at once;
//   - the slide never pushes a session past its 90-day limit;
//   - the retention sweep deletes every session the read already refuses;
//   - members who are unlinked, never verified and inactive for 180 days are
//     closed with their personal fields cleared (row kept for history), and
//     nobody else is: linked, recently seen, waiting on a request, suspended,
//     or (once Phase 2 adds it) holding a verified sign-in method.
//
// Through the REAL routes/portal.ts (/auth/me) and lib/ephemeralRetention.ts
// on migrated SQLite. SECURITY_TEST_BASE=<sha> loads that commit's
// portalSession.ts: 4ab47676e must FAIL the lifetime checks.
//
// Run: node scripts/test-portal-members-session-lifetime-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')
// Sign-up is off unless explicitly enabled (owner ruling 6 Oct); these checks need it on.
const SIGNUP_OPEN = { customer_portal_signup_enabled: 'true' }

const root = path.resolve(__dirname, '..')
const base = process.env.SECURITY_TEST_BASE
const sources = base
  ? { 'lib/portalSession.ts': execFileSync('git', ['show', `${base}:cloudflare/src/lib/portalSession.ts`], { cwd: root, encoding: 'utf8' }) }
  : {}

const DAY = 24 * 60 * 60 * 1000
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString()
const sqlTime = (offsetMs) => iso(offsetMs).slice(0, 19).replace('T', ' ')
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; process.exitCode = 1; console.log(`FAIL ${name}: ${error.message}`) }
}

async function signedIn(h, name, phone) {
  const res = await h.request('/auth/signup', 'POST', { name, phone, password: 'visitor-pass', consent: true }, { ip: `203.0.113.${Math.floor(Math.random() * 200)}` })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  const cookie = (res.headers.get('Set-Cookie') || '').split(';')[0]
  const accountId = h.raw.prepare('SELECT id FROM portal_accounts WHERE phone = @p').get({ p: phone.replace(/\D/g, '') }).id
  return { cookie, accountId }
}
const me = async (h, cookie) => (await h.request('/auth/me', 'GET', undefined, { headers: { Cookie: cookie } })).body
const setSession = (h, accountId, fields) => {
  const sets = Object.keys(fields).map((key) => `${key} = @${key}`).join(', ')
  h.raw.prepare(`UPDATE portal_sessions SET ${sets} WHERE account_id = @accountId`).run({ ...fields, accountId })
}

async function main() {
  await check('control: a session signed in 89 days ago and used yesterday still works', async () => {
    const h = createPortalHarness({ sources, settings: SIGNUP_OPEN })
    const { cookie, accountId } = await signedIn(h, 'Control', '012 401 401')
    setSession(h, accountId, { created_at: sqlTime(-89 * DAY), last_seen_at: sqlTime(-1 * DAY), expires_at: iso(5 * DAY) })
    assert.ok((await me(h, cookie)).account, 'the control must authenticate, or the checks below prove nothing')
  })

  await check('90-day absolute limit: a session signed in 91 days ago stops, however recently used', async () => {
    const h = createPortalHarness({ sources, settings: SIGNUP_OPEN })
    const { cookie, accountId } = await signedIn(h, 'Absolute', '012 402 402')
    setSession(h, accountId, { created_at: sqlTime(-91 * DAY), last_seen_at: sqlTime(-60 * 1000), expires_at: iso(200 * DAY) })
    assert.equal((await me(h, cookie)).account, null)
  })

  await check('30-day idle limit: a session not seen for 31 days stops', async () => {
    const h = createPortalHarness({ sources, settings: SIGNUP_OPEN })
    const { cookie, accountId } = await signedIn(h, 'Idle', '012 403 403')
    setSession(h, accountId, { created_at: sqlTime(-40 * DAY), last_seen_at: sqlTime(-31 * DAY), expires_at: iso(300 * DAY) })
    assert.equal((await me(h, cookie)).account, null)
  })

  await check('a row from the old 399-day rule (signed in 100 days ago, expiring next year) stops', async () => {
    const h = createPortalHarness({ sources, settings: SIGNUP_OPEN })
    const { cookie, accountId } = await signedIn(h, 'Legacy Row', '012 404 404')
    setSession(h, accountId, { created_at: sqlTime(-100 * DAY), last_seen_at: sqlTime(-1 * DAY), expires_at: iso(299 * DAY) })
    assert.equal((await me(h, cookie)).account, null)
  })

  await check('a suspended member is signed out at once (the status gate in the session read)', async () => {
    const h = createPortalHarness({ sources, settings: SIGNUP_OPEN })
    const { cookie, accountId } = await signedIn(h, 'Suspended', '012 405 405')
    assert.ok((await me(h, cookie)).account)
    h.raw.prepare("UPDATE portal_accounts SET status = 'suspended' WHERE id = @id").run({ id: accountId })
    assert.equal((await me(h, cookie)).account, null)
  })

  await check('a new session is 30 days; a slide never goes past sign-in + 90 days', async () => {
    const h = createPortalHarness({ sources, settings: SIGNUP_OPEN })
    const { cookie, accountId } = await signedIn(h, 'Slider', '012 406 406')
    const row = () => h.raw.prepare('SELECT created_at, expires_at FROM portal_sessions WHERE account_id = @id').get({ id: accountId })
    const ttlDays = (Date.parse(row().expires_at) - Date.now()) / DAY
    assert.ok(ttlDays > 29.9 && ttlDays <= 30.01, `new session ${ttlDays.toFixed(2)} days`)
    const created = iso(-80 * DAY)
    setSession(h, accountId, { created_at: created, last_seen_at: sqlTime(0), expires_at: iso(5 * DAY) })
    assert.ok((await me(h, cookie)).account)
    await settle()
    const slid = Date.parse(row().expires_at)
    assert.ok(Math.abs(slid - (Date.parse(created) + 90 * DAY)) < 60 * 1000, `slid to ${new Date(slid).toISOString()}, expected sign-in + 90 days`)
  })

  await check('the retention sweep deletes exactly the sessions the read refuses', async () => {
    const h = createPortalHarness({ sources, settings: SIGNUP_OPEN })
    const retention = h.load('lib/ephemeralRetention.ts')
    const insert = (label, fields) => h.raw.prepare(`INSERT INTO portal_sessions (account_id, token_hash, expires_at, created_at, last_seen_at, revoked_at)
      VALUES (1, @t, @e, @c, @l, @r)`).run({ t: label, e: fields.e, c: fields.c, l: fields.l ?? null, r: fields.r ?? null })
    insert('revoked', { e: iso(DAY), c: sqlTime(-DAY), l: sqlTime(0), r: sqlTime(0) })
    insert('expired', { e: iso(-DAY), c: sqlTime(-10 * DAY), l: sqlTime(-2 * DAY) })
    insert('absolute', { e: iso(200 * DAY), c: sqlTime(-91 * DAY), l: sqlTime(0) })
    insert('idle', { e: iso(200 * DAY), c: sqlTime(-40 * DAY), l: sqlTime(-31 * DAY) })
    insert('fresh', { e: iso(20 * DAY), c: sqlTime(-10 * DAY), l: sqlTime(0) })
    h.raw.prepare(`DELETE FROM portal_sessions WHERE ${retention.PORTAL_SESSION_SWEEP_WHERE}`).run({})
    assert.deepEqual(h.raw.prepare('SELECT token_hash FROM portal_sessions').all({}).map((r) => r.token_hash), ['fresh'])
  })

  await check('180-day retention closes only unlinked, unverified, inactive members, clearing their personal fields', async () => {
    const h = createPortalHarness({ sources, settings: SIGNUP_OPEN })
    const retention = h.load('lib/ephemeralRetention.ts')
    h.raw.prepare("INSERT INTO customers (id, name) VALUES (77, 'Linked Customer')").run({})
    const add = (name, fields = {}) => Number(h.raw.prepare(`INSERT INTO portal_accounts (name, phone, password_hash, email, cart_json, member_code, contact_id, status, created_at, last_seen_at)
      VALUES (@name, @phone, 'hash', @email, '[1]', NULL, @contact, @status, @created, @seen)`).run({
      name, phone: `0129${String(Math.floor(Math.random() * 1e5)).padStart(5, '0')}`, email: `${name.replace(/\s/g, '')}@x.test`,
      contact: fields.contact ?? null, status: fields.status ?? 'active', created: fields.created ?? sqlTime(-400 * DAY), seen: fields.seen ?? null,
    }).meta.last_row_id)
    const gone = add('Gone Quiet', { seen: sqlTime(-181 * DAY) })
    const neverSeen = add('Never Seen', { created: sqlTime(-200 * DAY) })
    const recent = add('Recent', { seen: sqlTime(-179 * DAY) })
    const linked = add('Linked', { contact: 77, seen: sqlTime(-400 * DAY) })
    const waiting = add('Waiting', { seen: sqlTime(-300 * DAY) })
    const paused = add('Paused', { status: 'suspended', seen: sqlTime(-300 * DAY) })
    const verified = add('Verified', { seen: sqlTime(-300 * DAY) })
    h.raw.prepare("INSERT INTO portal_member_link_requests (account_id, status) VALUES (@a, 'pending')").run({ a: waiting })
    h.raw.prepare("INSERT INTO portal_member_link_requests (account_id, status, note) VALUES (@a, 'withdrawn', 'call me on 012 345 678')").run({ a: gone })
    h.raw.prepare("INSERT INTO portal_sessions (account_id, token_hash, expires_at) VALUES (@a, 'gone-session', '2999-01-01')").run({ a: gone })
    // Phase 2's table, as the design specifies it: a verified identity exempts.
    h.raw.exec('CREATE TABLE portal_login_identities (id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL, provider TEXT, subject_key TEXT, verified_at TEXT)')
    h.raw.prepare("INSERT INTO portal_login_identities (account_id, provider, subject_key, verified_at) VALUES (@a, 'email', 'k', '2026-01-01')").run({ a: verified })

    const closed = await retention.purgeInactivePortalMembers(h.db)
    assert.equal(closed, 2)
    const row = (id) => h.raw.prepare('SELECT * FROM portal_accounts WHERE id = @id').get({ id })
    for (const id of [gone, neverSeen]) {
      const r = row(id)
      assert.equal(r.status, 'closed')
      assert.ok(r.closed_at)
      assert.deepEqual([r.name, r.phone, r.password_hash, r.email, r.cart_json], ['', null, null, null, null], 'personal fields cleared')
    }
    for (const id of [recent, linked, waiting, paused, verified]) {
      const r = row(id)
      assert.ok(r.status !== 'closed' && r.phone, `${r.name} must be left alone`)
    }
    assert.equal(h.raw.prepare('SELECT COUNT(*) AS n FROM portal_sessions WHERE account_id = @a').get({ a: gone }).n, 0)
    assert.equal(h.raw.prepare('SELECT note FROM portal_member_link_requests WHERE account_id = @a').get({ a: gone }).note, null)
    assert.equal(await retention.purgeInactivePortalMembers(h.db), 0, 'a second run finds nothing')

    // Mutant control: without the "unlinked" term the linked member would go too.
    const mutant = retention.portalMemberPurgeWhere(true).replace('AND a.contact_id IS NULL', '')
    const wouldClose = h.raw.prepare(`SELECT a.id FROM portal_accounts a WHERE ${mutant}`).all({}).map((r) => r.id)
    assert.ok(wouldClose.includes(linked), 'the fixture can tell the unlinked term apart')
  })

  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
