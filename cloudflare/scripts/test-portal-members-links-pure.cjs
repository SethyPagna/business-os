// G38 Phase 1 acceptance, staff side: Contacts > Members, through the REAL
// routes/portalMembers.ts + lib/portalMemberLinks.ts + lib/portalAccounts.ts
// on migrated SQLite (harness/load_portal_auth_route.cjs; only the staff
// session and the audit sink are stubbed).
//
// Acceptance bullets covered (design §6 Phase 1):
//   - link with a stale link_version -> 409 and no event row; a double-submit
//     of the same link -> exactly one event;
//   - linking B to a customer already linked to A without move -> 409
//     member_link_customer_taken; with move -> one batch, two events, same
//     group_id, A unlinked;
//   - revert after another staff relinked -> 409 member_link_stale; revert of
//     the latest event restores the prior customer and appends (+1 event);
//     UPDATE/DELETE on events raise member_link_events_append_only;
//   - a user without portal_member_links gets 403 on every route (a Contacts
//     user included: the badge on the customer row is all they get);
//   - suggestions: phone+name, phone-only, email and name-only fixtures return
//     exactly Strong, Possible, Possible, none, and nothing is pre-selected;
// plus evidence rules, sessions revoked on unlink / suspend / reset, link
// requests approved through the link action, list filters and conflicts.
//
// Verifier follow-ups (G38 P1 re-certification):
//   E1 customer search and suggestions also need Contacts view;
//   E2 a closed member cannot be reverted (route check AND batch guard);
//   E3 a revert that re-creates a link needs link evidence, recorded on the
//      revert event; a revert that only removes a link needs none;
//   E6 (owner default, round 2) EVERY staff password reset is admin-only and
//      needs a note, which reaches the audit log;
//   E1 (owner ruling, round 2) a links-only user (no Contacts view) never sees
//      a customer's name, LC or phone, nor whether a customer exists: list,
//      detail, history, link requests and every write response are redacted;
//      LC search and filter=conflicts are off; /link and a relinking revert
//      are refused before any customer lookup. A links + Contacts user sees
//      everything (control);
//   E8 filter=legacy_claims lists links the old sign-up made to an existing
//      customer that no staff action has replaced since.
//
// Discriminating controls in-run: the CAS check is repeated against a mutant
// builder whose version guard is removed, under a real concurrent change, and
// the mutant must write the event the real code refuses.
//
// SECURITY_TEST_BASE=<sha> loads that commit's routes/portalMembers.ts and
// lib/portalMemberLinks.ts: at 9300c775e the E1, E2, E3, E6 and E8 checks FAIL.
//
// Run: node scripts/test-portal-members-links-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

const BASE_SOURCES = process.env.SECURITY_TEST_BASE
  ? Object.fromEntries(['routes/portalMembers.ts', 'lib/portalMemberLinks.ts'].map((rel) => [rel,
    execFileSync('git', ['show', `${process.env.SECURITY_TEST_BASE}:cloudflare/src/${rel}`], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' })]))
  : {}

const USERS = {
  owner: { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: '{}', role_permissions: '{}' },
  linker: { id: 2, username: 'linker', name: 'Linker', role_code: 'staff', permissions: JSON.stringify({ portal_member_links: true, contacts: true }), role_permissions: '{}' },
  linksOnly: { id: 5, username: 'linksonly', name: 'Links Only', role_code: 'staff', permissions: JSON.stringify({ portal_member_links: true }), role_permissions: '{}' },
  clerk: { id: 3, username: 'clerk', name: 'Clerk', role_code: 'staff', permissions: JSON.stringify({ contacts: true }), role_permissions: '{}' },
  nobody: { id: 4, username: 'nobody', name: 'Nobody', role_code: 'staff', permissions: '{}', role_permissions: '{}' },
}

function harness(sources = BASE_SOURCES) {
  const state = { user: USERS.linker, audits: [], auditDetails: [], beforeBatch: null }
  const h = createPortalHarness({
    sources,
    overrides: {
      '../lib/auth': { requireAuth: async (c, next) => { c.set('user', state.user); await next() } },
      '../lib/audit': { audit: async (...args) => { state.audits.push(args.slice(3, 6)); state.auditDetails.push(args[6]) } },
    },
  })
  const batch = h.db.batch
  h.db.batch = async (items) => {
    if (state.beforeBatch) { const hook = state.beforeBatch; state.beforeBatch = null; await hook(items) }
    return batch(items)
  }
  const app = h.load('routes/portalMembers.ts').default
  async function call(method, pathname, body, user = USERS.linker) {
    state.user = user
    const response = await app.request(pathname, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, h.env, { waitUntil() {}, passThroughOnException() {} })
    let json = null
    try { json = await response.json() } catch (_) {}
    return { status: response.status, body: json }
  }
  const raw = h.raw
  const q = (sql, params = {}) => raw.prepare(sql).all(params)
  const one = (sql, params = {}) => raw.prepare(sql).get(params)
  const code = h.load('lib/memberCode.ts')
  function member(name, phoneNumber, extra = {}) {
    const r = raw.prepare(`INSERT INTO portal_accounts (name, phone, member_code, email, contact_id, password_hash, consent_version, consent_at)
      VALUES (@name, @phone, @code, @email, @contact, 'hash:x', 'portal-legal-2026-09-30', CURRENT_TIMESTAMP)`)
      .run({ name, phone: phoneNumber, code: code.mintMemberCode(), email: extra.email ?? null, contact: extra.contactId ?? null })
    const id = Number(r.meta.last_row_id)
    raw.prepare("INSERT INTO portal_sessions (account_id, token_hash, expires_at) VALUES (@id, @t, '2999-01-01T00:00:00Z')").run({ id, t: `t-${id}-${Math.random()}` })
    return id
  }
  function customer(id, name, phoneNumber, extra = {}) {
    raw.prepare(`INSERT INTO customers (id, name, phone, phone_normalized, address, email, membership_number, is_anonymous)
      VALUES (@id, @name, @phone, @norm, @address, @email, @lc, @anon)`).run({
      id, name, phone: phoneNumber, norm: phoneNumber ? phoneNumber.replace(/\D/g, '') : null,
      address: extra.address ?? null, email: extra.email ?? null, lc: extra.lc ?? null, anon: extra.anonymous ? 1 : 0,
    })
    return id
  }
  const events = (accountId) => q('SELECT * FROM portal_member_link_events WHERE account_id = @a ORDER BY id', { a: accountId })
  const liveSessions = (accountId) => Number(one('SELECT COUNT(*) AS n FROM portal_sessions WHERE account_id = @a AND revoked_at IS NULL', { a: accountId }).n)
  const account = (accountId) => one('SELECT * FROM portal_accounts WHERE id = @a', { a: accountId })
  return { h, state, call, raw, q, one, member, customer, events, liveSessions, account }
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; process.exitCode = 1; console.log(`FAIL ${name}\n  ${error.stack}`) }
}

const link = (t, accountId, customerId, extra = {}) => t.call('POST', `/${accountId}/link`, {
  customerId, expectedLinkVersion: t.account(accountId).link_version, evidence: 'in_person', ...extra,
}, extra.user)

async function main() {
  await check('without portal_member_links every route is 403 (a Contacts-only user included); with it, 200', async () => {
    const t = harness()
    const m = t.member('Perm Test', '012000001')
    t.customer(500, 'Perm Customer', '012 000 500', { lc: 'LC-00500' })
    t.raw.prepare("INSERT INTO portal_member_link_requests (account_id, status) VALUES (@a, 'pending')").run({ a: m })
    const routes = [
      ['GET', '/'], ['GET', '/link-requests'], ['POST', '/link-requests/1/reject', {}], ['GET', '/customer-search?q=Perm'],
      ['GET', `/${m}`], ['GET', `/${m}/history`], ['GET', `/${m}/suggestions`],
      ['POST', `/${m}/link`, { customerId: 500, expectedLinkVersion: 0, evidence: 'in_person' }],
      ['POST', `/${m}/unlink`, { expectedLinkVersion: 0, reasonCode: 'duplicate' }],
      ['POST', `/${m}/revert`, { eventId: 1 }], ['POST', `/${m}/suspend`, {}], ['POST', `/${m}/reactivate`, {}],
      ['POST', `/${m}/reset-password`, { evidence: 'in_person' }],
    ]
    for (const user of [USERS.clerk, USERS.nobody]) {
      for (const [method, url, body] of routes) {
        const res = await t.call(method, url, body, user)
        assert.equal(res.status, 403, `${user.username} ${method} ${url} -> ${res.status}`)
      }
    }
    assert.equal(t.account(m).contact_id, null, 'nothing was written by a refused call')
    assert.equal(t.one("SELECT status FROM portal_member_link_requests").status, 'pending')
    assert.equal((await t.call('GET', '/', undefined, USERS.linker)).status, 200, 'positive control: the permission opens it')
    assert.equal((await t.call('GET', '/', undefined, USERS.owner)).status, 200, 'admins hold it by default')
    const contacts = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
    assert.match(contacts, /SELECT id, contact_id, member_code, membership_id, created_at FROM portal_accounts WHERE contact_id IN/, 'Contacts keeps the badge (with the W- code)')
  })

  await check('the staff Members API is 404 on the storefront host and open on the admin host', async () => {
    const t = harness()
    const gate = t.h.load('lib/publicHostGate.ts')
    assert.equal(gate.isBlockedOnStorefrontHost('https://leangbeauty.com/api/portal-members'), true)
    assert.equal(gate.isBlockedOnStorefrontHost('https://leangbeauty.com/api/portal-members/1/link'), true)
    assert.equal(gate.isBlockedOnStorefrontHost('https://admin.leangbeauty.com/api/portal-members/1/link'), false)
    assert.equal(gate.isBlockedOnStorefrontHost('https://leangbeauty.com/api/portal/account/link-request'), false, "the member's own endpoints stay public")
    const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8')
    assert.match(index, /app\.route\('\/api\/portal-members', portalMembersRoute\)/)
  })

  await check('link: one event with evidence and actor; linking never signs the member out', async () => {
    const t = harness()
    const m = t.member('Sokha', '012111111')
    t.customer(101, 'Sokha Chan', '012 111 111', { lc: 'LC-00101' })
    const res = await link(t, m, 101, { clientRequestId: 'req-link-0001', matchBasis: { strength: 'strong', basis: ['phone', 'name'] } })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.member.customer.id, 101)
    assert.equal(res.body.member.chip, 'linked')
    assert.equal(res.body.member.linkVersion, 1)
    const [event] = t.events(m)
    assert.equal(t.events(m).length, 1)
    assert.equal(event.action, 'link')
    assert.equal(event.to_customer_id, 101)
    assert.equal(event.from_customer_id, null)
    assert.equal(event.evidence, 'in_person')
    assert.equal(event.link_version_after, 1)
    assert.equal(event.actor_user_id, 2)
    assert.equal(event.actor_name, 'linker')
    assert.deepEqual(JSON.parse(event.match_basis), { strength: 'strong', basis: ['phone', 'name'] })
    assert.equal(t.liveSessions(m), 1, 'a first link does not sign the member out')
    assert.deepEqual(t.state.audits.at(-1), ['member_link', 'portal_member', m])
  })

  await check('double-submit: same clientRequestId replays (one event); without it, the second is 409 stale (one event)', async () => {
    const t = harness()
    const m = t.member('Twice', '012111112')
    t.customer(102, 'Twice Customer', '012 111 112')
    const body = { customerId: 102, expectedLinkVersion: 0, evidence: 'in_person', clientRequestId: 'req-twice-0001' }
    const first = await t.call('POST', `/${m}/link`, body)
    const second = await t.call('POST', `/${m}/link`, body)
    assert.equal(first.status, 200)
    assert.equal(second.status, 200)
    assert.equal(second.body.replayed, true)
    assert.equal(t.events(m).length, 1)
    const third = await t.call('POST', `/${m}/link`, { ...body, clientRequestId: undefined })
    assert.equal(third.status, 409)
    assert.equal(third.body.code, 'member_link_stale')
    assert.equal(t.events(m).length, 1)
  })

  await check('a stale link_version is refused with 409 member_link_stale and writes nothing', async () => {
    const t = harness()
    const m = t.member('Stale', '012111113')
    t.customer(103, 'Stale Customer', '012 111 113')
    const res = await t.call('POST', `/${m}/link`, { customerId: 103, expectedLinkVersion: 5, evidence: 'in_person' })
    assert.equal(res.status, 409)
    assert.equal(res.body.code, 'member_link_stale')
    assert.equal(res.body.member.linkVersion, 0, 'the answer carries the current state to refresh from')
    assert.equal(t.events(m).length, 0)
    assert.equal(t.account(m).contact_id, null)
  })

  // The route pre-checks the version, so only a change BETWEEN its read and
  // its batch exercises the batch's own guard. Inject exactly that change.
  async function concurrentLinkRace(sources) {
    const t = harness(sources)
    const m = t.member('Race', '012111114')
    t.customer(104, 'Race One', '012 111 114')
    t.customer(105, 'Race Two', '012 111 115')
    t.state.beforeBatch = () => { t.raw.prepare('UPDATE portal_accounts SET contact_id = 105, link_version = link_version + 1 WHERE id = @m').run({ m }) }
    const res = await t.call('POST', `/${m}/link`, { customerId: 104, expectedLinkVersion: 0, evidence: 'in_person' })
    return { res, events: t.events(m).length, contact: t.account(m).contact_id }
  }
  await check('CAS under a concurrent change: the batch guard refuses (409, no event, the other change stands)', async () => {
    const { res, events, contact } = await concurrentLinkRace()
    assert.equal(res.status, 409)
    assert.equal(res.body.code, 'member_link_stale')
    assert.equal(events, 0)
    assert.equal(contact, 105)
  })
  await check('mutant control: the same race against a builder WITHOUT the version guard writes the event', async () => {
    const real = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'portalMemberLinks.ts'), 'utf8')
    const mutant = real
      .replace("AND link_version = @version AND contact_id IS @fromCustomerId AND status <> 'closed'", "AND status <> 'closed'")
      .replace('WHERE id = @accountId AND link_version = @version\',\n      params: { customerId: toCustomerId', 'WHERE id = @accountId\',\n      params: { customerId: toCustomerId')
    assert.notEqual(mutant, real, 'the mutation applied')
    const { res, events } = await concurrentLinkRace({ 'lib/portalMemberLinks.ts': mutant })
    assert.equal(res.status, 200, 'without the guard the stale link goes through')
    assert.equal(events, 1, 'and an event is written over the concurrent change')
  })

  await check('customer already linked to A: 409 member_link_customer_taken; with move, one batch, two events, one group', async () => {
    const t = harness()
    const a = t.member('Member A', '012222221')
    const b = t.member('Member B', '012222222')
    t.customer(201, 'Shared Customer', '012 222 220', { lc: 'LC-00201' })
    assert.equal((await link(t, a, 201)).status, 200)
    const taken = await link(t, b, 201)
    assert.equal(taken.status, 409)
    assert.equal(taken.body.code, 'member_link_customer_taken')
    assert.equal(taken.body.holder.id, a)
    assert.equal(t.account(b).contact_id, null)
    assert.equal(t.account(a).contact_id, 201)
    assert.equal(t.events(b).length, 0)

    const moved = await link(t, b, 201, { move: true })
    assert.equal(moved.status, 200, JSON.stringify(moved.body))
    assert.equal(t.account(a).contact_id, null, 'A is unlinked')
    assert.equal(t.account(b).contact_id, 201, 'B holds the customer')
    const aLast = t.events(a).at(-1)
    const bLast = t.events(b).at(-1)
    assert.equal(aLast.action, 'unlink')
    assert.equal(aLast.reason_code, 'moved')
    assert.equal(bLast.action, 'link')
    assert.ok(aLast.group_id && aLast.group_id === bLast.group_id, 'both halves share one group_id')
    assert.equal(t.liveSessions(a), 0, 'A lost its customer, so its sessions are revoked')
    assert.equal(t.liveSessions(b), 1)
    assert.deepEqual(t.state.audits.at(-1), ['member_move', 'portal_member', b])
  })

  await check('revert: stale after another staff relinked; the latest event reverts and appends; history is append-only', async () => {
    const t = harness()
    const m = t.member('Reverter', '012333331')
    t.customer(301, 'First Customer', '012 333 301')
    t.customer(302, 'Second Customer', '012 333 302')
    await link(t, m, 301)
    const linkEvent = t.events(m).at(-1)
    await link(t, m, 302, { user: USERS.owner })
    const relinkEvent = t.events(m).at(-1)
    assert.equal(relinkEvent.action, 'relink')
    assert.equal(t.liveSessions(m), 0, 'a relink revokes: the member lost customer 301')

    const stale = await t.call('POST', `/${m}/revert`, { eventId: linkEvent.id })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.code, 'member_link_stale')
    const before = t.events(m).length
    const snapshot = JSON.stringify(t.events(m))

    const ok = await t.call('POST', `/${m}/revert`, { eventId: relinkEvent.id, note: 'wrong customer picked', evidence: 'in_person' })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(t.account(m).contact_id, 301, 'the prior customer is restored')
    const after = t.events(m)
    assert.equal(after.length, before + 1, 'exactly one event appended')
    assert.equal(JSON.stringify(after.slice(0, before)), snapshot, 'no earlier event changed')
    assert.equal(after.at(-1).action, 'revert')
    assert.equal(after.at(-1).reverts_event_id, relinkEvent.id)
    assert.equal(after.at(-1).from_customer_id, 302)
    assert.equal(after.at(-1).to_customer_id, 301)
    assert.equal(after.at(-1).evidence, 'in_person', 'the relinking revert records its evidence')

    const again = await t.call('POST', `/${m}/revert`, { eventId: relinkEvent.id })
    assert.equal(again.status, 409)
    assert.equal(again.body.code, 'member_link_already_reverted')
    assert.equal((await t.call('POST', `/${m}/revert`, { eventId: after.at(-1).id })).body.code, 'member_link_not_revertible')

    assert.throws(() => t.raw.prepare('UPDATE portal_member_link_events SET note = @n WHERE id = @id').run({ n: 'edited', id: linkEvent.id }), /member_link_events_append_only/)
    assert.throws(() => t.raw.prepare('DELETE FROM portal_member_link_events WHERE id = @id').run({ id: linkEvent.id }), /member_link_events_append_only/)
    assert.equal(t.events(m).length, before + 1)
  })

  await check('revert of a Move restores both members in one batch', async () => {
    const t = harness()
    const a = t.member('Holder', '012444441')
    const b = t.member('Mover', '012444442')
    t.customer(401, 'Moved Customer', '012 444 400')
    await link(t, a, 401)
    await link(t, b, 401, { move: true })
    const moveEvent = t.events(b).at(-1)
    const res = await t.call('POST', `/${b}/revert`, { eventId: moveEvent.id, evidence: 'in_person' })
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(t.account(a).contact_id, 401)
    assert.equal(t.account(b).contact_id, null)
    const ra = t.events(a).at(-1)
    const rb = t.events(b).at(-1)
    assert.equal(ra.action, 'revert')
    assert.equal(rb.action, 'revert')
    assert.ok(ra.group_id && ra.group_id === rb.group_id)
    assert.equal(ra.evidence, 'in_person', 'the holder is relinked: evidence recorded')
    assert.equal(rb.evidence, null, 'the mover is only unlinked: no evidence claimed')
  })

  await check('E1: customer search and suggestions need Contacts view; the member list does not', async () => {
    const t = harness()
    const m = t.member('Viewer Test', '012000077')
    t.customer(577, 'Viewer Customer', '012 000 077', { lc: 'LC-00577' })
    for (const url of ['/customer-search?q=Viewer', `/${m}/suggestions`]) {
      const refused = await t.call('GET', url, undefined, USERS.linksOnly)
      assert.equal(refused.status, 403, url)
      assert.equal(refused.body.code, 'contacts_view_required', url)
      assert.equal(JSON.stringify(refused.body).includes('Viewer Customer'), false, 'no customer data in the refusal')
      assert.equal((await t.call('GET', url, undefined, USERS.linker)).status, 200, `positive control ${url}`)
      assert.equal((await t.call('GET', url, undefined, USERS.owner)).status, 200, `admin ${url}`)
    }
    assert.equal((await t.call('GET', '/', undefined, USERS.linksOnly)).status, 200, 'the member list stays open to the link permission')
  })

  await check('E1.1-E1.9: a links-only user never sees a customer or learns one exists; links + Contacts sees all', async () => {
    const t = harness()
    const SECRET = ['Secret Linked Name', 'LC-00100', '012 100 100', 'Unlinked Stranger', 'LC-00101', 'Phone Holder', 'LC-00102']
    const leaks = (body) => SECRET.filter((s) => JSON.stringify(body).includes(s))
    t.customer(100, 'Secret Linked Name', '012 100 100', { lc: 'LC-00100' })
    t.customer(101, 'Unlinked Stranger', '012 101 101', { lc: 'LC-00101' })
    t.customer(102, 'Phone Holder', '012 102 102', { lc: 'LC-00102' })
    const one = t.member('Member One', '012000101')
    await link(t, one, 100)
    const holder = t.member('Holder', '012000102')
    await link(t, holder, 102)
    const clash = t.member('Same Phone', '012102102') // phone_customer_taken: customer 102's phone, held by another member
    t.raw.prepare("UPDATE portal_accounts SET membership_id = 'LC-00100' WHERE id = @id").run({ id: clash })
    t.raw.prepare("INSERT INTO portal_member_link_requests (account_id, note) VALUES (@a, 'please link')").run({ a: clash })
    const L = USERS.linksOnly
    const hidden = (member) => {
      assert.equal(member.customer, null)
      assert.equal(member.legacyMembershipId, null)
      assert.deepEqual(member.conflicts, [])
      assert.equal(member.createdFromSignup, null, 'provenance withheld')
      assert.equal(member.legacyClaim, null, 'provenance withheld')
      assert.equal(member.customerVisible, false)
    }
    // Round 3: provenance and history detail. A carried-forward sign-up claim,
    // a link made with a Strong phone+name match, and a Move (shared group id).
    t.raw.prepare(`INSERT INTO portal_member_link_events (account_id, action, to_customer_id, evidence, reason_code, link_version_after)
      VALUES (@a, 'legacy_import', 100, 'system', 'signup_claimed_customer', 0)`).run({ a: one })
    const matched = t.member('Matched', '012000104')
    t.customer(103, 'Matched Customer', '012 000 104', { lc: 'LC-00103' })
    await link(t, matched, 103, { matchBasis: { strength: 'strong', basis: ['phone', 'name'] } })
    const mover = t.member('Mover R3', '012000105')
    await link(t, mover, 103, { move: true })

    // E1.1 list
    const list = await t.call('GET', '/?filter=all', undefined, L)
    assert.equal(list.status, 200)
    assert.deepEqual(leaks(list.body), [], 'E1.1 list')
    list.body.items.forEach(hidden)
    assert.equal(list.body.items.find((m) => m.id === one).chip, 'linked', 'the member\'s own link state stays visible')
    // E1.2 detail
    const detail = await t.call('GET', `/${one}`, undefined, L)
    assert.deepEqual(leaks(detail.body), [], 'E1.2 detail')
    hidden(detail.body.member)
    // E1.3 history
    const history = await t.call('GET', `/${one}/history`, undefined, L)
    assert.deepEqual(leaks(history.body), [], 'E1.3 history')
    assert.equal(history.body.customerVisible, false)
    assert.deepEqual(history.body.events.map((e) => [e.fromCustomer, e.toCustomer]), [[null, null], [null, null]])
    assert.deepEqual(history.body.events.map((e) => e.reasonCode), [null, null], 'reasonCode withheld (signup_claimed_customer)')
    for (const id of [matched, mover]) {
      const h = (await t.call('GET', `/${id}/history`, undefined, L)).body
      assert.ok(h.events.length >= 1)
      for (const e of h.events) {
        assert.equal(e.matchBasis, null, 'matchBasis withheld')
        assert.equal(e.groupId, null, 'groupId withheld')
        assert.equal(e.reasonCode, null, 'reasonCode withheld')
      }
    }
    const legacyFilter = await t.call('GET', '/?filter=legacy_claims', undefined, L)
    assert.equal(legacyFilter.status, 403)
    assert.equal(legacyFilter.body.code, 'contacts_view_required')
    // E1.4 link requests
    const requests = await t.call('GET', '/link-requests', undefined, L)
    assert.equal(requests.status, 200)
    assert.deepEqual(leaks(requests.body), [], 'E1.4 link requests')
    hidden(requests.body.requests[0].member)
    // E1.5 search by LC: neither the linked customer's LC nor a legacy LC matches
    assert.deepEqual((await t.call('GET', '/?q=LC-00100', undefined, L)).body.items, [], 'E1.5 LC search is off')
    assert.deepEqual((await t.call('GET', '/?q=lc-00102', undefined, L)).body.items, [])
    // E1.6 conflicts
    const conflicts = await t.call('GET', '/?filter=conflicts', undefined, L)
    assert.equal(conflicts.status, 403)
    assert.equal(conflicts.body.code, 'contacts_view_required')
    // E1.7 search and suggestions (round 1)
    assert.equal((await t.call('GET', '/customer-search?q=Secret', undefined, L)).status, 403)
    assert.equal((await t.call('GET', `/${clash}/suggestions`, undefined, L)).status, 403)
    // E1.8 /link: no existence oracle -- an existing held id, an existing free id
    // and a missing id all answer the same 403, and nothing is written.
    const eventsBefore = t.q('SELECT COUNT(*) AS n FROM portal_member_link_events')[0].n
    const answers = []
    for (const customerId of [100, 101, 99999]) {
      const res = await t.call('POST', `/${clash}/link`, { customerId, expectedLinkVersion: 0, evidence: 'in_person', move: true }, L)
      answers.push([res.status, JSON.stringify(res.body)])
    }
    assert.equal(answers[0][0], 403)
    assert.deepEqual(answers.map((a) => a.join(' ')), Array(3).fill(answers[0].join(' ')), 'E1.8 identical refusal for every id')
    assert.ok(answers[0][1].includes('contacts_view_required'))
    // E1.9 the refused link wrote nothing and returned no customer
    assert.deepEqual(leaks(answers), [], 'E1.9')
    assert.equal(t.q('SELECT COUNT(*) AS n FROM portal_member_link_events')[0].n, eventsBefore)
    assert.equal(t.account(clash).contact_id, null)
    // Write responses links-only users may still make are redacted.
    const unlink = await t.call('POST', `/${one}/unlink`, { expectedLinkVersion: t.account(one).link_version, reasonCode: 'duplicate' }, L)
    assert.equal(unlink.status, 200, JSON.stringify(unlink.body))
    assert.deepEqual(leaks(unlink.body), [])
    hidden(unlink.body.member)
    // ... a revert that would relink is a link (refused); its history row says so.
    const unlinkEvent = t.events(one).at(-1)
    const linksOnlyHistory = await t.call('GET', `/${one}/history`, undefined, L)
    assert.equal(linksOnlyHistory.body.events[0].revertible, false, 'no revert icon for a relink the user cannot do')
    const relink = await t.call('POST', `/${one}/revert`, { eventId: unlinkEvent.id, evidence: 'in_person' }, L)
    assert.equal(relink.status, 403)
    assert.equal(relink.body.code, 'contacts_view_required')
    assert.equal(t.account(one).contact_id, null)
    for (const [path, body] of [[`/${holder}/suspend`, {}], [`/${holder}/reactivate`, {}]]) {
      const res = await t.call('POST', path, body, L)
      assert.equal(res.status, 200, path)
      assert.deepEqual(leaks(res.body), [], path)
      hidden(res.body.member)
    }
    // A revert that only removes a link stays open to links-only, redacted.
    const holderLink = t.events(holder).find((e) => e.action === 'link')
    const unlinkOnly = await t.call('POST', `/${holder}/revert`, { eventId: holderLink.id }, L)
    assert.equal(unlinkOnly.status, 200, JSON.stringify(unlinkOnly.body))
    assert.deepEqual(leaks(unlinkOnly.body), [])

    // Control: links + Contacts view sees everything the redaction removed.
    const t2 = harness()
    t2.customer(100, 'Secret Linked Name', '012 100 100', { lc: 'LC-00100' })
    t2.customer(101, 'Unlinked Stranger', '012 101 101', { lc: 'LC-00101' })
    const m2 = t2.member('Member One', '012000101')
    await link(t2, m2, 100)
    const full = await t2.call('GET', `/${m2}`)
    assert.deepEqual(full.body.member.customer, { id: 100, name: 'Secret Linked Name', membershipNumber: 'LC-00100', available: true })
    assert.equal(full.body.member.customerVisible, true)
    assert.deepEqual((await t2.call('GET', '/?q=LC-00100')).body.items.map((m) => m.id), [m2])
    assert.equal((await t2.call('GET', '/?filter=conflicts')).status, 200)
    assert.deepEqual((await t2.call('GET', `/${m2}/history`)).body.events[0].toCustomer, { id: 100, name: 'Secret Linked Name', membershipNumber: 'LC-00100' })
    // Control for round 3: the same provenance and history fields are present.
    // (`one` was unlinked above, so a fresh carried-forward claim is used here;
    // the links-only user is shown it is withheld for it too.)
    t.customer(104, 'Claimed Again', '012 000 106', { lc: 'LC-00104' })
    const claimed = t.member('Claimed R3', '012000106', { contactId: 104 })
    t.raw.prepare(`INSERT INTO portal_member_link_events (account_id, action, to_customer_id, evidence, reason_code, link_version_after)
      VALUES (@a, 'legacy_import', 104, 'system', 'signup_claimed_customer', 0)`).run({ a: claimed })
    hidden((await t.call('GET', `/${claimed}`, undefined, L)).body.member)
    const fullClaimed = (await t.call('GET', `/${claimed}`)).body.member
    assert.equal(fullClaimed.legacyClaim, true)
    assert.equal(fullClaimed.createdFromSignup, false)
    assert.deepEqual((await t.call('GET', '/?filter=legacy_claims')).body.items.map((m) => m.id), [claimed])
    const oneHistory = (await t.call('GET', `/${one}/history`)).body.events
    assert.ok(oneHistory.some((e) => e.reasonCode === 'signup_claimed_customer'))
    const matchedHistory = (await t.call('GET', `/${matched}/history`)).body.events
    assert.ok(matchedHistory.some((e) => e.matchBasis && e.matchBasis.strength === 'strong'))
    const moverGroup = (await t.call('GET', `/${mover}/history`)).body.events[0].groupId
    assert.ok(moverGroup)
    assert.equal((await t.call('GET', `/${matched}/history`)).body.events[0].groupId, moverGroup, 'the Move group id is shared')
    const m3 = t2.member('Another', '012000103')
    const linked = await link(t2, m3, 101)
    assert.equal(linked.status, 200)
    assert.equal(linked.body.member.customer.name, 'Unlinked Stranger')
  })

  await check('E2: history never offers Revert on a closed member', async () => {
    const t = harness()
    const m = t.member('Closing', '012000087')
    t.customer(587, 'Closing Customer', '012 000 587')
    await link(t, m, 587)
    await t.call('POST', `/${m}/unlink`, { expectedLinkVersion: t.account(m).link_version, reasonCode: 'duplicate' })
    assert.equal((await t.call('GET', `/${m}/history`)).body.events[0].revertible, true, 'control: open member')
    t.raw.prepare("UPDATE portal_accounts SET status = 'closed' WHERE id = @id").run({ id: m })
    assert.deepEqual((await t.call('GET', `/${m}/history`)).body.events.map((e) => e.revertible), [false, false])
  })

  await check('E2: a closed member cannot be reverted -- refused up front and by the batch guard under a race', async () => {
    const t = harness()
    const m = t.member('Closer', '012000088')
    t.customer(588, 'Closer Customer', '012 000 088')
    await link(t, m, 588)
    const linkEvent = t.events(m).at(-1)
    t.raw.prepare("UPDATE portal_accounts SET status = 'closed' WHERE id = @id").run({ id: m })
    const before = t.events(m).length
    const refused = await t.call('POST', `/${m}/revert`, { eventId: linkEvent.id })
    assert.equal(refused.status, 409)
    assert.equal(refused.body.code, 'member_closed')
    assert.equal(t.events(m).length, before)
    assert.equal(t.account(m).contact_id, 588)

    const t2 = harness()
    const m2 = t2.member('Racer', '012000089')
    t2.customer(589, 'Racer Customer', '012 000 089')
    await link(t2, m2, 589)
    const event2 = t2.events(m2).at(-1)
    t2.state.beforeBatch = async () => { t2.raw.prepare("UPDATE portal_accounts SET status = 'closed' WHERE id = @id").run({ id: m2 }) }
    const raced = await t2.call('POST', `/${m2}/revert`, { eventId: event2.id })
    assert.equal(raced.status, 409)
    assert.equal(raced.body.code, 'member_closed')
    assert.equal(t2.events(m2).length, 1, 'no revert event')
    assert.equal(t2.account(m2).contact_id, 589, 'the closed member was not touched')
  })

  await check('E3: a revert that re-creates a link needs link evidence; one that only removes a link does not', async () => {
    const t = harness()
    const m = t.member('Evidence Revert', '012000099')
    t.customer(599, 'Old Customer', '012 000 599')
    await link(t, m, 599)
    await t.call('POST', `/${m}/unlink`, { expectedLinkVersion: t.account(m).link_version, reasonCode: 'wrong_person' })
    const unlinkEvent = t.events(m).at(-1)
    assert.equal(unlinkEvent.action, 'unlink')
    const count = t.events(m).length
    const none = await t.call('POST', `/${m}/revert`, { eventId: unlinkEvent.id })
    assert.equal(none.status, 400)
    assert.equal(none.body.code, 'member_link_evidence_required')
    const wrong = await t.call('POST', `/${m}/revert`, { eventId: unlinkEvent.id, evidence: 'called_number_on_file', checkCode: '000000' })
    assert.equal(wrong.status, 422)
    assert.equal(wrong.body.code, 'member_link_check_failed')
    assert.equal((await t.call('POST', `/${m}/revert`, { eventId: unlinkEvent.id, evidence: 'owner_override', note: 'boss' })).status, 403, 'override is admin-only')
    assert.equal(t.events(m).length, count, 'nothing written by a refused revert')
    assert.equal(t.account(m).contact_id, null)
    const accounts = t.h.load('lib/portalAccounts.ts')
    const { code } = await accounts.portalLinkCheckCode(t.h.env, m, t.account(m).link_version)
    const ok = await t.call('POST', `/${m}/revert`, { eventId: unlinkEvent.id, evidence: 'called_number_on_file', checkCode: code })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(t.account(m).contact_id, 599)
    assert.equal(t.events(m).at(-1).evidence, 'called_number_on_file')
    assert.equal(t.state.auditDetails.at(-1).evidence, 'called_number_on_file')

    // Reverting a first link only removes it: no evidence asked or recorded.
    const n = t.member('Unlink Only', '012000098')
    t.customer(598, 'Unlink Customer', '012 000 598')
    await link(t, n, 598)
    const first = await t.call('POST', `/${n}/revert`, { eventId: t.events(n).at(-1).id })
    assert.equal(first.status, 200, JSON.stringify(first.body))
    assert.equal(t.account(n).contact_id, null)
    assert.equal(t.events(n).at(-1).evidence, null)

    // A Move that relinks TWO members cannot be proved by one member's code.
    const a = t.member('Holder Two', '012000097')
    const b = t.member('Mover Two', '012000096')
    t.customer(597, 'Contested', '012 000 597')
    t.customer(596, 'Mover Before', '012 000 596')
    await link(t, a, 597)
    await link(t, b, 596)
    await link(t, b, 597, { move: true })
    const moveEvent = t.events(b).at(-1)
    const twoCode = await accounts.portalLinkCheckCode(t.h.env, b, t.account(b).link_version)
    const ambiguous = await t.call('POST', `/${b}/revert`, { eventId: moveEvent.id, evidence: 'called_number_on_file', checkCode: twoCode.code })
    assert.equal(ambiguous.status, 400)
    assert.equal(ambiguous.body.code, 'member_revert_check_one_member')
    const inPerson = await t.call('POST', `/${b}/revert`, { eventId: moveEvent.id, evidence: 'in_person' })
    assert.equal(inPerson.status, 200, JSON.stringify(inPerson.body))
    assert.deepEqual([t.account(a).contact_id, t.account(b).contact_id], [597, 596])

    // The builder refuses a relinking revert without evidence, so no caller can skip it.
    const lib = t.h.load('lib/portalMemberLinks.ts')
    const target = { accountId: 1, eventId: 1, linkVersionAfter: 1, currentCustomerId: null, restoreCustomerId: 5 }
    assert.throws(() => lib.buildMemberRevertStatements({ targets: [target], groupId: null, note: null, clientRequestId: null, actor: { userId: 1, userName: 'x' } }), /member_link_revert_evidence_required/)
    assert.doesNotThrow(() => lib.buildMemberRevertStatements({ targets: [{ ...target, restoreCustomerId: null, currentCustomerId: 5 }], groupId: null, note: null, clientRequestId: null, actor: { userId: 1, userName: 'x' } }))
  })

  await check('evidence: required; the phone check needs the member\'s code; owner override needs an admin and a note', async () => {
    const t = harness()
    const m = t.member('Evidence', '012555551')
    t.customer(501, 'Evidence Customer', '012 555 501')
    const base = { customerId: 501, expectedLinkVersion: 0 }
    assert.equal((await t.call('POST', `/${m}/link`, base)).body.code, 'member_link_evidence_required')
    assert.equal((await t.call('POST', `/${m}/link`, { ...base, evidence: 'receipt' })).body.code, 'member_link_evidence_required')
    const wrong = await t.call('POST', `/${m}/link`, { ...base, evidence: 'called_number_on_file', checkCode: '000000' })
    assert.equal(wrong.status, 422)
    assert.equal(wrong.body.code, 'member_link_check_failed')
    assert.equal((await t.call('POST', `/${m}/link`, { ...base, evidence: 'owner_override', note: 'boss said' })).status, 403, 'not an admin')
    assert.equal((await t.call('POST', `/${m}/link`, { ...base, evidence: 'owner_override' }, USERS.owner)).body.code, 'member_link_note_required')
    assert.equal(t.events(m).length, 0)
    const accounts = t.h.load('lib/portalAccounts.ts')
    const { code } = await accounts.portalLinkCheckCode(t.h.env, m, 0)
    const ok = await t.call('POST', `/${m}/link`, { ...base, evidence: 'called_number_on_file', checkCode: code })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
    assert.equal(t.events(m)[0].evidence, 'called_number_on_file')
  })

  await check('the anonymous walk-in record and a missing customer cannot be linked', async () => {
    const t = harness()
    const m = t.member('Walk In', '012555552')
    t.customer(502, 'General', null, { anonymous: true })
    const anon = await link(t, m, 502)
    assert.equal(anon.status, 409)
    assert.equal(anon.body.code, 'member_link_customer_unavailable')
    assert.equal((await link(t, m, 99999)).body.code, 'customer_not_found')
    assert.equal(t.events(m).length, 0)
  })

  await check('unlink: needs a reason (a note for "other"), appends, revokes the member\'s sessions', async () => {
    const t = harness()
    const m = t.member('Unlinker', '012666661')
    t.customer(601, 'Unlinked Customer', '012 666 601')
    await link(t, m, 601)
    const v = t.account(m).link_version
    assert.equal((await t.call('POST', `/${m}/unlink`, { expectedLinkVersion: v })).body.code, 'member_unlink_reason_required')
    assert.equal((await t.call('POST', `/${m}/unlink`, { expectedLinkVersion: v, reasonCode: 'other' })).body.code, 'member_link_note_required')
    const res = await t.call('POST', `/${m}/unlink`, { expectedLinkVersion: v, reasonCode: 'wrong_person' })
    assert.equal(res.status, 200)
    assert.equal(t.account(m).contact_id, null)
    assert.equal(t.events(m).at(-1).action, 'unlink')
    assert.equal(t.events(m).at(-1).reason_code, 'wrong_person')
    assert.equal(t.events(m).at(-1).from_customer_id, 601)
    assert.equal(t.liveSessions(m), 0)
    assert.equal((await t.call('POST', `/${m}/unlink`, { expectedLinkVersion: v + 1, reasonCode: 'duplicate' })).body.code, 'member_not_linked')
  })

  await check('link requests: approve IS the link action (decided_event_id = the link event); reject once', async () => {
    const t = harness()
    const m = t.member('Requester', '012777771')
    const n = t.member('Rejected', '012777772')
    t.customer(701, 'Requested Customer', '012 777 701')
    t.raw.prepare("INSERT INTO portal_member_link_requests (account_id, note) VALUES (@a, 'please'), (@b, 'me too')").run({ a: m, b: n })
    const pending = await t.call('GET', '/link-requests')
    assert.equal(pending.body.requests.length, 2)
    const requestId = pending.body.requests.find((r) => r.member.id === m).id
    const approved = await link(t, m, 701, { linkRequestId: requestId })
    assert.equal(approved.status, 200, JSON.stringify(approved.body))
    const request = t.one('SELECT * FROM portal_member_link_requests WHERE id = @id', { id: requestId })
    assert.equal(request.status, 'approved')
    assert.equal(request.decided_event_id, t.events(m).at(-1).id)
    assert.equal(t.events(m).at(-1).link_request_id, requestId)
    assert.equal(request.decided_by_name, 'linker')
    const otherId = pending.body.requests.find((r) => r.member.id === n).id
    assert.equal((await t.call('POST', `/link-requests/${otherId}/reject`, { note: 'no matching record' })).status, 200)
    assert.equal(t.one('SELECT status FROM portal_member_link_requests WHERE id = @id', { id: otherId }).status, 'rejected')
    assert.equal((await t.call('POST', `/link-requests/${otherId}/reject`, {})).body.code, 'member_link_request_not_pending')
    assert.equal((await link(t, n, 701, { linkRequestId: otherId, move: true })).body.code, 'member_link_request_not_pending')
    assert.equal(t.account(m).contact_id, 701, 'the refused approval moved nothing')
  })

  await check('suspend revokes sessions; reactivate restores; both are CAS on status (the session read refusing a suspended member is in test-portal-members-session-lifetime-pure.cjs)', async () => {
    const t = harness()
    const m = t.member('Paused', '012888881')
    assert.equal((await t.call('POST', `/${m}/suspend`, { note: 'misuse' })).status, 200)
    assert.equal(t.account(m).status, 'suspended')
    assert.equal(t.liveSessions(m), 0)
    assert.equal((await t.call('POST', `/${m}/suspend`, {})).body.code, 'member_status_conflict')
    assert.equal((await t.call('POST', `/${m}/reactivate`, {})).status, 200)
    assert.equal(t.account(m).status, 'active')
  })

  await check('staff password reset: identity evidence required, temp password once, every session revoked', async () => {
    const t = harness()
    const m = t.member('Forgetful', '012999991')
    assert.equal((await t.call('POST', `/${m}/reset-password`, { note: 'x' }, USERS.owner)).body.code, 'member_link_evidence_required')
    const before = t.account(m).password_hash
    // E6 (owner default): no path lets the member prove identity from a
    // signed-in account, so every reset is an admin's word, with a note.
    for (const evidence of ['in_person', 'called_number_on_file', 'owner_override']) {
      const notAdmin = await t.call('POST', `/${m}/reset-password`, { evidence, note: 'seen at the till' })
      assert.equal(notAdmin.status, 403, evidence)
      assert.equal(notAdmin.body.code, 'member_reset_admin_only', evidence)
      const noNote = await t.call('POST', `/${m}/reset-password`, { evidence }, USERS.owner)
      assert.equal(noNote.status, 400, evidence)
      assert.equal(noNote.body.code, 'member_link_note_required', evidence)
    }
    assert.equal((await t.call('POST', `/${m}/reset-password`, { note: 'x' }, USERS.owner)).body.code, 'member_link_evidence_required')
    const inPerson = t.member('In Person Reset', '012999992')
    const ip = await t.call('POST', `/${inPerson}/reset-password`, { evidence: 'in_person', note: 'member at the till with ID card' }, USERS.owner)
    assert.equal(ip.status, 200, 'an admin with a note can reset in person')
    assert.deepEqual(t.state.auditDetails.at(-1), { evidence: 'in_person', note: 'member at the till with ID card' })
    assert.equal(t.account(m).password_hash, before, 'refused resets change nothing')
    assert.equal(t.liveSessions(m), 1)
    const res = await t.call('POST', `/${m}/reset-password`, { evidence: 'called_number_on_file', note: 'called 012 999 991, member confirmed name' }, USERS.owner)
    assert.equal(res.status, 200)
    assert.deepEqual(t.state.auditDetails.at(-1), { evidence: 'called_number_on_file', note: 'called 012 999 991, member confirmed name' })
    assert.match(res.body.temporaryPassword, /^[A-HJ-NP-Z2-9]{10}$/)
    assert.notEqual(t.account(m).password_hash, before)
    assert.equal(t.liveSessions(m), 0)
    assert.deepEqual(t.state.audits.at(-1), ['portal_reset', 'portal_member', m])
    const noPhone = Number(t.raw.prepare("INSERT INTO portal_accounts (name, phone) VALUES ('Email Only', NULL)").run({}).meta.last_row_id)
    assert.equal((await t.call('POST', `/${noPhone}/reset-password`, { evidence: 'in_person', note: 'x' }, USERS.owner)).body.code, 'member_reset_unavailable')
  })

  await check('suggestions: phone+name Strong, phone-only Possible, email Possible, name-only none; nothing pre-selected', async () => {
    const t = harness()
    const m = t.member('Srey Mom', '097555000', { email: 'srey@example.com' })
    t.customer(801, 'srey  MOM', '097 555 000', { lc: 'LC-00801' })
    t.customer(802, 'Grandma Sok', '011 000 802', { address: JSON.stringify([{ label: 'Home', phone: '097 555 000' }]) })
    t.customer(803, 'Someone', '011 000 803', { email: ' SREY@example.com ' })
    t.customer(804, 'Srey Mom', '011 000 804')
    t.customer(805, 'General', '097 555 000', { anonymous: true })
    const res = await t.call('GET', `/${m}/suggestions`)
    assert.equal(res.status, 200)
    const got = res.body.suggestions.map((s) => [s.customerId, s.strength, s.basis.join('+')])
    assert.deepEqual(got, [[801, 'strong', 'phone+name'], [802, 'possible', 'phone'], [803, 'possible', 'email']])
    for (const suggestion of res.body.suggestions) {
      assert.deepEqual(Object.keys(suggestion).sort(), ['basis', 'customerId', 'linkedMemberId', 'membershipNumber', 'name', 'phone', 'strength'])
    }
    assert.deepEqual(Object.keys(res.body), ['suggestions'], 'no selected / default field anywhere')
    assert.equal(t.events(m).length, 0, 'suggesting never links')
    const other = t.member('Other Holder', '012121212')
    await link(t, other, 801)
    const again = await t.call('GET', `/${m}/suggestions`)
    assert.equal(again.body.suggestions[0].linkedMemberId, other, 'a held customer says so (linking it is a Move)')
  })

  await check('list: filters, conflicts and search by W- code / legacy LC / phone', async () => {
    const t = harness()
    t.customer(901, 'Held Customer', '012 901 901', { lc: 'LC-00901' })
    const linked = t.member('Linked One', '012901000')
    await link(t, linked, 901)
    const clash = t.member('Same Phone Other', '012901901')
    const ghost = t.member('Ghost Link', '012901902', { contactId: 999999 })
    const paused = t.member('Paused One', '012901903')
    t.raw.prepare("UPDATE portal_accounts SET status = 'suspended' WHERE id = @id").run({ id: paused })
    const asker = t.member('Asker One', '012901904')
    t.raw.prepare("INSERT INTO portal_member_link_requests (account_id) VALUES (@a)").run({ a: asker })
    t.raw.prepare("UPDATE portal_accounts SET membership_id = 'LC-00555' WHERE id = @id").run({ id: asker })
    const ids = async (query) => (await t.call('GET', `/?${query}`)).body.items.map((item) => item.id).sort((x, y) => x - y)
    assert.deepEqual(await ids('filter=linked'), [linked, ghost].sort((x, y) => x - y))
    assert.deepEqual(await ids('filter=unlinked'), [clash, paused, asker].sort((x, y) => x - y))
    assert.deepEqual(await ids('filter=requests'), [asker])
    assert.deepEqual(await ids('filter=suspended'), [paused])
    assert.deepEqual(await ids('filter=conflicts'), [clash, ghost].sort((x, y) => x - y))
    const all = (await t.call('GET', '/?filter=all')).body
    assert.equal(all.total, 5)
    const ghostRow = all.items.find((item) => item.id === ghost)
    assert.deepEqual(ghostRow.conflicts, ['customer_unavailable'])
    assert.equal(ghostRow.customer.available, false)
    assert.deepEqual(all.items.find((item) => item.id === clash).conflicts, ['phone_customer_taken'])
    assert.equal(all.items.find((item) => item.id === asker).pendingRequest.id > 0, true)
    assert.equal(all.items.find((item) => item.id === asker).legacyMembershipId, 'LC-00555')
    const memberCode = t.account(paused).member_code
    assert.deepEqual(await ids(`q=${encodeURIComponent(memberCode.toLowerCase().replace(/-/g, ''))}`), [paused])
    assert.deepEqual(await ids('q=lc-00555'), [asker])
    assert.deepEqual(await ids('q=lc-00901'), [linked], 'the linked customer\'s store number finds the member')
    assert.deepEqual(await ids(`q=${encodeURIComponent('+855 12 901 903')}`), [paused])
    assert.equal((await t.call('GET', '/?filter=everything')).status, 400)
  })

  await check('E8: filter=legacy_claims lists only carried-forward sign-up claims still in place', async () => {
    const t = harness()
    t.customer(1101, 'Claimed', '012 110 101')
    t.customer(1102, 'Created', '012 110 102')
    t.customer(1103, 'Claimed Then Fixed', '012 110 103')
    t.customer(1104, 'Staff Checked', '012 110 104')
    const claimed = t.member('Claimer', '012110101', { contactId: 1101 })
    const created = t.member('Creator', '012110102', { contactId: 1102 })
    const fixed = t.member('Fixed', '012110103', { contactId: 1103 })
    const legacy = (accountId, customerId, reason) => t.raw.prepare(`INSERT INTO portal_member_link_events
      (account_id, action, from_customer_id, to_customer_id, evidence, reason_code, link_version_after)
      VALUES (@a, 'legacy_import', NULL, @c, 'system', @r, 0)`).run({ a: accountId, c: customerId, r: reason })
    legacy(claimed, 1101, 'signup_claimed_customer')
    legacy(created, 1102, 'signup_created_customer')
    legacy(fixed, 1103, 'signup_claimed_customer')
    await link(t, fixed, 1104)
    const res = await t.call('GET', '/?filter=legacy_claims')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.items.map((item) => item.id), [claimed])
    assert.equal(res.body.total, 1)
    const all = (await t.call('GET', '/?filter=all')).body.items
    assert.deepEqual(all.filter((item) => item.legacyClaim).map((item) => item.id), [claimed])
    assert.equal((await t.call('GET', `/${claimed}`)).body.member.legacyClaim, true)
    assert.equal((await t.call('GET', `/${created}`)).body.member.legacyClaim, false)
  })

  await check('history lists every event with customers and marks only the latest revertible one', async () => {
    const t = harness()
    const m = t.member('Historian', '012131313')
    t.customer(1001, 'Hist One', '012 131 001', { lc: 'LC-01001' })
    t.customer(1002, 'Hist Two', '012 131 002', { lc: 'LC-01002' })
    await link(t, m, 1001)
    await link(t, m, 1002)
    const res = await t.call('GET', `/${m}/history`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.events.map((e) => [e.action, e.revertible]), [['relink', true], ['link', false]])
    assert.deepEqual(res.body.events[0].fromCustomer, { id: 1001, name: 'Hist One', membershipNumber: 'LC-01001' })
    assert.equal(res.body.events[0].actorName, 'linker')
  })

  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`)
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
