// G38 Telegram (owner rules, 6 Oct 2026): website members sign in and sign up
// through @LeangCosmeticsBot with a PROVEN phone, and phone + password sign-up
// is off by default.
//
// Drives the REAL routes/portalTelegram.ts and routes/portal.ts, mounted as
// index.ts mounts them (both at /api/portal, Telegram first), and
// the real lib/portalTelegram.ts, lib/portalAccounts.ts, lib/portalSession.ts,
// lib/rateLimit.ts ... over SQLite carrying every migration, 0232 included
// (scripts/harness/load_portal_auth_route.cjs). Telegram is simulated by
// posting updates to the webhook exactly as Telegram does; fetch is replaced
// by a trap, and the run asserts it was never called: the bot answers inside
// the webhook response, so nothing ever leaves the Worker.
//
// DISCRIMINATING: every scenario runs twice in this one process. Against the
// real source it must pass. Against a named, plausible WRONG implementation
// (the same source with one rule edited, the edit asserted to apply) it must
// fail. A scenario that passes both ways would prove nothing and fails the run.
//
// Run (from cloudflare/): node scripts/test-portal-telegram-signin-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { Hono } = require('hono')
const { createPortalHarness } = require('./harness/load_portal_auth_route.cjs')

const SRC = path.join(__dirname, '..', 'src')
// LF always: a Windows checkout with core.autocrlf (the GitHub gate runner)
// hands back CRLF, and a multi-line mutant anchor must match either way.
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')

const SECRET = 'Portal_webhook_secret-0123456789abcdefXYZ'
const PORTAL_TOKEN = '7000000001:AAportal-token-made-up-for-tests'
const STAFF_TOKEN = '6000000001:AAstaff-token-made-up-for-tests'
const sha256hex = (text) => crypto.createHash('sha256').update(text).digest('hex')
const ENV = { PORTAL_TELEGRAM_WEBHOOK_SECRET: SECRET, PORTAL_TELEGRAM_BOT_TOKEN: PORTAL_TOKEN, TELEGRAM_BOT_TOKEN: STAFF_TOKEN }
const OPEN_SIGNUP = { customer_portal_signup_enabled: 'true' }
// The policy version the storefront shows today (legalContent.ts); start must carry it.
const SHOWN_VERSION = 'portal-legal-2026-09-30'
const KHMER = /[ក-៿]/

// Nothing may call out: not Telegram, not anything.
let fetchCalls = 0
globalThis.fetch = async () => { fetchCalls += 1; throw new Error('the Telegram flow must make no outbound request') }

// ---- harness -----------------------------------------------------------------
function makeHarness({ mutant = null, env = ENV, settings = {}, overrides = {}, edits = [] } = {}) {
  const sources = {}
  for (const [rel, from, to] of edits) {
    const text = sources[rel] ?? read(rel)
    assert.ok(text.includes(from), `fixture edit no longer applies to ${rel}: ${from.slice(0, 60)}`)
    sources[rel] = text.split(from).join(to)
  }
  if (mutant) {
    for (const [rel, from, to] of mutant.edits || []) {
      const text = sources[rel] ?? read(rel)
      assert.ok(text.includes(from), `mutant "${mutant.label}" no longer applies to ${rel}: ${from.slice(0, 60)}`)
      sources[rel] = text.split(from).join(to)
    }
  }
  const h = createPortalHarness({ sources, env, overrides })
  // A schema mutant (the same database without one object a migration made).
  if (mutant && mutant.schema) h.raw.exec(mutant.schema)
  for (const [key, value] of Object.entries(settings)) h.raw.prepare('INSERT INTO settings (key, value) VALUES (@key, @value)').run({ key, value })
  // index.ts: app.route('/api/portal', portalTelegramRoute) then portalRoute.
  const app = new Hono()
  app.route('/', h.load('routes/portalTelegram.ts').default)
  app.route('/', h.app)
  h.request = async (pathname, method = 'POST', body, { ip = '203.0.113.9', headers = {} } = {}) => {
    // A browser on the shop's own page sends Sec-Fetch-Site: same-origin (the
    // portal's credential guard needs it); Telegram sends none (null drops it).
    const all = { ...(ip ? { 'CF-Connecting-IP': ip } : {}), 'Sec-Fetch-Site': 'same-origin', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }
    for (const key of Object.keys(all)) if (all[key] === null) delete all[key]
    const response = await app.request(pathname, { method, headers: all, body: body === undefined ? undefined : JSON.stringify(body) }, h.env, { waitUntil() {}, passThroughOnException() {} })
    let json = null
    try { json = await response.json() } catch (_) {}
    return { status: response.status, body: json, headers: response.headers }
  }
  let ipSeq = 10
  h.browser = () => {
    const jar = {}
    const ip = `198.51.100.${ipSeq += 1}`
    const send = async (pathname, method = 'POST', body) => {
      const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
      const res = await h.request(pathname, method, body, { ip, headers: cookie ? { Cookie: cookie } : {} })
      for (const line of res.headers.getSetCookie ? res.headers.getSetCookie() : []) {
        const [pair, ...attrs] = line.split(';')
        const eq = pair.indexOf('=')
        const name = pair.slice(0, eq).trim(); const value = pair.slice(eq + 1).trim()
        if (!value || attrs.some((a) => /max-age=0\b/i.test(a.trim()))) delete jar[name]; else jar[name] = value
      }
      return res
    }
    return { jar, ip, send, start: (body = {}) => send('/auth/telegram/start', 'POST', { consent: true, consentVersion: SHOWN_VERSION, consentLocale: 'km', locale: 'km', ...body }), poll: (nonce) => send('/auth/telegram/poll', 'POST', { nonce }) }
  }
  h.bot = (message, secret = SECRET) => h.request('/telegram/webhook', 'POST', { update_id: Math.floor(Math.random() * 1e9), message },
    { ip: null, headers: { 'Sec-Fetch-Site': null, ...(secret === null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret }) } })
  h.count = (table, where = '1 = 1') => Number(h.raw.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get({}).n)
  h.one = (sql, params = {}) => h.raw.prepare(sql).get(params)
  return h
}

const chat = (tg) => ({ id: tg, type: 'private' })
const startMsg = (tg, nonce) => ({ message_id: 1, chat: chat(tg), from: { id: tg, is_bot: false, first_name: 'Dara' }, text: nonce === undefined ? '/start' : `/start ${nonce}` })
const contactMsg = (tg, contactUserId, phone, extra = {}) => ({
  message_id: 2, chat: chat(tg), from: { id: tg, is_bot: false, first_name: 'Dara', last_name: 'Sok' },
  contact: { phone_number: phone, first_name: 'Dara', last_name: 'Sok', ...(contactUserId === undefined ? {} : { user_id: contactUserId }) },
  ...extra,
})

// Start on the website, then do the Telegram side as the member would.
async function proveInTelegram(h, browser, tg, phone, startBody = {}) {
  const started = await browser.start(startBody)
  assert.equal(started.status, 200, `start: ${JSON.stringify(started.body)}`)
  const nonce = started.body.nonce
  const atStart = await h.bot(startMsg(tg, nonce))
  assert.equal(atStart.status, 200)
  const shared = await h.bot(contactMsg(tg, tg, phone))
  return { nonce, started, atStart, shared }
}

// ---- runner ------------------------------------------------------------------
const scenarios = []
const scenario = (name, mutant, run) => scenarios.push({ name, mutant, run })

// ---- 1. the whole happy path, and what it writes --------------------------------
scenario('sign-up through Telegram: a new W- member with the proven phone, no password, no customer, signed in',
  { label: 'the browser binding cookie is never set (poll cannot find its sign-in)', edits: [['routes/portalTelegram.ts', 'setCookie(c, BROWSER_COOKIE, browserToken, {', 'void ({']] },
  async () => {
    const h = makeHarness()
    const customersBefore = h.count('customers')
    const browser = h.browser()
    const { nonce, started, atStart, shared } = await proveInTelegram(h, browser, 5550001, '+855 12 345 678')
    assert.match(started.body.link, /^https:\/\/t\.me\/LeangCosmeticsBot\?start=[A-Za-z0-9_-]{32}$/)
    assert.equal(started.body.link.endsWith(nonce), true)
    assert.equal(started.body.expiresInSeconds, 600)
    assert.equal(h.count('portal_telegram_challenges', `nonce_hash = '${sha256hex(nonce)}'`), 1, 'only the hash of the nonce is stored')
    assert.equal(h.count('portal_telegram_challenges', `nonce_hash = '${nonce}'`), 0)
    // The bot answers IN the webhook response with one request_contact button.
    assert.equal(atStart.body.method, 'sendMessage')
    assert.equal(atStart.body.chat_id, '5550001')
    assert.deepEqual(atStart.body.reply_markup.keyboard.map((row) => row.map((b) => b.request_contact)), [[true]])
    assert.match(atStart.body.text, /Leang Cosmetics/)
    assert.match(atStart.body.text, KHMER, 'locale km was asked for')
    assert.equal(shared.body.method, 'sendMessage')
    assert.deepEqual(shared.body.reply_markup, { remove_keyboard: true })

    const done = await browser.poll(nonce)
    assert.equal(done.status, 200, JSON.stringify(done.body))
    assert.equal(done.body.status, 'signed_in')
    assert.equal(done.body.created, true)
    assert.deepEqual(Object.keys(done.body.account).sort(), ['email', 'linked', 'memberCode', 'membershipId', 'name'], 'the allowlisted member view')
    assert.match(done.body.account.memberCode, /^W-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    assert.equal(done.body.account.linked, false)
    assert.ok(browser.jar.bos_portal, 'a member session cookie')
    const account = h.one("SELECT * FROM portal_accounts WHERE phone = '012345678'")
    assert.ok(account, 'the phone is stored canonically (+855 folded to 0)')
    assert.equal(account.password_hash, null)
    assert.equal(account.contact_id, null, 'never linked to an in-store customer')
    assert.equal(account.name, 'Dara Sok')
    assert.equal(account.consent_version, 'portal-legal-2026-09-30')
    const identity = h.one('SELECT * FROM portal_login_identities WHERE account_id = @id', { id: account.id })
    assert.deepEqual([identity.provider, identity.subject_key, Boolean(identity.verified_at)], ['telegram', '5550001', true])
    assert.equal(h.count('customers'), customersBefore, 'no customer row is written')
    assert.equal(h.one('SELECT phone FROM portal_telegram_challenges').phone, null, 'the proven phone leaves the challenge row at consume')
    const me = await browser.send('/auth/me', 'GET')
    assert.equal(me.body.account.memberCode, done.body.account.memberCode)
    const methods = await browser.send('/account/telegram', 'GET')
    assert.deepEqual(methods.body, { available: true, connected: true, canConnect: false })

    // The next sign-in with the same Telegram (another device) is the same member.
    const other = h.browser()
    const again = await proveInTelegram(h, other, 5550001, '012345678')
    const second = await other.poll(again.nonce)
    assert.equal(second.body.status, 'signed_in')
    assert.equal(second.body.created, false)
    assert.equal(second.body.account.memberCode, done.body.account.memberCode)
    assert.equal(h.count('portal_accounts'), 1)
  })

// ---- 2. the phone proof ------------------------------------------------------------
scenario('a forwarded or typed contact (contact.user_id is not from.id) is refused and proves nothing',
  { label: 'no contact.user_id === from.id check (accept any shared contact)', edits: [['lib/portalTelegram.ts', 'if (telegramUserId(contact.user_id) !== tgId) {', 'if (false) {']] },
  async () => {
    const h = makeHarness()
    const browser = h.browser()
    const started = await browser.start()
    await h.bot(startMsg(5550002, started.body.nonce))
    // Someone else's contact card, forwarded (its user_id is the other person's).
    const forwarded = await h.bot(contactMsg(5550002, 5559999, '012 999 888'))
    // A contact typed in by hand carries no user_id at all.
    const typed = await h.bot(contactMsg(5550002, undefined, '012 999 777'))
    for (const answer of [forwarded, typed]) {
      assert.equal(answer.status, 200)
      assert.match(answer.body.text, /own|ផ្ទាល់ខ្លួន/)
      assert.equal(answer.body.reply_markup.keyboard[0][0].request_contact, true, 'the button is offered again')
    }
    assert.equal(h.one('SELECT status, phone FROM portal_telegram_challenges').status, 'started', 'the challenge is not verified')
    assert.equal(h.one('SELECT phone FROM portal_telegram_challenges').phone, null)
    const poll = await browser.poll(started.body.nonce)
    assert.deepEqual(poll.body, { status: 'waiting', stage: 'started' })
    assert.equal(h.count('portal_accounts'), 0)
    assert.equal(browser.jar.bos_portal, undefined)
    // Positive control in the same run: the member's OWN contact is accepted.
    await h.bot(contactMsg(5550002, 5550002, '012 999 666'))
    assert.equal((await browser.poll(started.body.nonce)).body.status, 'signed_in')
    assert.equal(h.one('SELECT phone FROM portal_accounts').phone, '012999666')
  })

// ---- 3. the webhook secret -----------------------------------------------------------
scenario('webhook: a missing, wrong or token-derived secret is 401 and writes nothing',
  { label: 'secret derived from a bot token accepted (no derived-secret refusal)', edits: [['lib/portalTelegram.ts', 'if (value && (expected === value || expected === await portalTelegramSha256Hex(value))) return false', 'void value']] },
  async () => {
    const h = makeHarness()
    const browser = h.browser()
    const started = await browser.start()
    const before = () => [h.count('portal_telegram_challenges', "status = 'pending'"), h.count('rate_limit_events'), h.count('portal_accounts'), h.count('portal_login_identities')]
    const snapshot = before()
    const wrongSameLength = SECRET.replace(/.$/, (ch) => (ch === 'Z' ? 'Y' : 'Z'))
    for (const secret of [null, '', wrongSameLength, `${SECRET}x`, SECRET.slice(1), PORTAL_TOKEN, sha256hex(PORTAL_TOKEN), STAFF_TOKEN, sha256hex(STAFF_TOKEN)]) {
      const res = await h.bot(startMsg(5550003, started.body.nonce), secret)
      assert.equal(res.status, 401, `secret ${secret === null ? '(none)' : JSON.stringify(secret.slice(0, 12))} must be refused`)
    }
    assert.deepEqual(before(), snapshot, 'a refused request reads no body and writes no row')

    // A Worker whose secret is the sha256-hex of a bot token (the staff bot's
    // scheme, or one derived from the customer bot's token) opens for nobody.
    for (const derived of [sha256hex(PORTAL_TOKEN), sha256hex(STAFF_TOKEN)]) {
      const hd = makeHarness({ env: { ...ENV, PORTAL_TELEGRAM_WEBHOOK_SECRET: derived } })
      const b = hd.browser()
      const s = await b.start()
      assert.equal(s.status, 200, 'the website side still starts')
      assert.equal((await hd.bot(startMsg(5550004, s.body.nonce), derived)).status, 401, 'a token-derived secret is never accepted')
      assert.equal(hd.count('portal_telegram_challenges', "status = 'started'"), 0)
    }
    // No secret on the Worker: the webhook opens for nobody and the website does not offer Telegram.
    const hn = makeHarness({ env: { ...ENV, PORTAL_TELEGRAM_WEBHOOK_SECRET: '' } })
    assert.equal((await hn.bot(startMsg(5550005, 'x'.repeat(32)), '')).status, 401)
    assert.equal((await hn.browser().start()).status, 503)
    assert.deepEqual((await hn.request('/auth/telegram/status', 'GET')).body, { available: false })
    // A secret Telegram would refuse (too short / bad characters) counts as unset.
    const hs = makeHarness({ env: { ...ENV, PORTAL_TELEGRAM_WEBHOOK_SECRET: 'short' } })
    assert.equal((await hs.bot(startMsg(5550006, 'x'.repeat(32)), 'short')).status, 401)
    // Positive control: the right secret is accepted.
    const ok = await h.bot(startMsg(5550003, started.body.nonce))
    assert.equal(ok.status, 200)
    assert.equal(ok.body.reply_markup.keyboard[0][0].request_contact, true)
    assert.deepEqual((await h.request('/auth/telegram/status', 'GET')).body, { available: true })
  })

scenario('webhook: a secret check that is skipped lets a forged update in',
  { label: 'webhook trusts any caller (no secret comparison)', edits: [['lib/portalTelegram.ts', "return sameText(expected, String(supplied ?? ''))", 'return true']] },
  async () => {
    const h = makeHarness()
    const browser = h.browser()
    const started = await browser.start()
    const forged = await h.bot(startMsg(5550007, started.body.nonce), 'not-the-secret-but-long-enough-0123456789')
    assert.equal(forged.status, 401)
    assert.equal(h.one('SELECT status, telegram_user_id FROM portal_telegram_challenges').telegram_user_id, null, 'a forged /start binds nothing')
  })

// ---- 4. replay -----------------------------------------------------------------------
scenario('a used sign-in cannot be replayed: the second poll is 409 and the bot calls the link dead',
  { label: 'the challenge is never marked consumed', edits: [['lib/portalTelegram.ts', "SET status = 'consumed', consumed_at = @now, phone = NULL", 'SET consumed_at = @now']] },
  async () => {
    const h = makeHarness()
    const browser = h.browser()
    const { nonce } = await proveInTelegram(h, browser, 5550010, '012 100 100')
    assert.equal((await browser.poll(nonce)).body.status, 'signed_in')
    const sessions = h.count('portal_sessions')
    delete browser.jar.bos_portal
    const replay = await browser.poll(nonce)
    assert.equal(replay.status, 409)
    assert.equal(replay.body.code, 'telegram_challenge_used')
    assert.equal(browser.jar.bos_portal, undefined, 'no second session')
    assert.equal(h.count('portal_sessions'), sessions)
    const atBot = await h.bot(startMsg(5550010, nonce))
    assert.match(atBot.body.text, /expired or was already used|ផុតកំណត់/)
    assert.equal(atBot.body.reply_markup.remove_keyboard, true)
  })

// ---- 5. expiry -----------------------------------------------------------------------
scenario('an expired sign-in (10 minutes) is refused at the bot and at the website',
  { label: 'expiry is not checked', edits: [
    ['lib/portalTelegram.ts', 'if (row.expires_at <= stamp) return EXPIRED', ''],
    ['lib/portalTelegram.ts', "WHERE id = @id AND status = 'verified' AND browser_hash = @browser_hash AND expires_at > @now", "WHERE id = @id AND status = 'verified' AND browser_hash = @browser_hash"],
  ] },
  async () => {
    const h = makeHarness()
    const browser = h.browser()
    const before = Date.now()
    const { nonce } = await proveInTelegram(h, browser, 5550020, '012 200 200')
    const expires = Date.parse(`${h.one('SELECT expires_at FROM portal_telegram_challenges').expires_at.replace(' ', 'T')}Z`)
    assert.ok(Math.abs(expires - before - 10 * 60 * 1000) < 60 * 1000, 'the challenge lives 10 minutes')
    h.raw.prepare("UPDATE portal_telegram_challenges SET expires_at = '2000-01-01 00:00:00.000'").run({})
    const late = await browser.poll(nonce)
    assert.equal(late.status, 410)
    assert.equal(late.body.code, 'telegram_challenge_expired')
    assert.equal(h.count('portal_accounts'), 0)
    // The bot side refuses an expired link too, and binds nothing.
    const second = await browser.start()
    h.raw.prepare("UPDATE portal_telegram_challenges SET expires_at = '2000-01-01 00:00:00.000'").run({})
    const atBot = await h.bot(startMsg(5550021, second.body.nonce))
    assert.match(atBot.body.text, /expired|ផុតកំណត់/)
    assert.equal(h.count('portal_telegram_challenges', "telegram_user_id = '5550021'"), 0)
  })

// ---- 6. another browser ---------------------------------------------------------------
scenario('the nonce from another browser (cookie mismatch) is refused; only the starting browser finishes',
  { label: 'the browser binding is not checked', edits: [
    ['lib/portalTelegram.ts', 'if (!row || !sameText(row.browser_hash, browserHash)) return NOT_FOUND', 'if (!row) return NOT_FOUND'],
    ['lib/portalTelegram.ts', "WHERE id = @id AND status = 'verified' AND browser_hash = @browser_hash AND expires_at > @now", "WHERE id = @id AND status = 'verified' AND expires_at > @now"],
  ] },
  async () => {
    const h = makeHarness()
    const owner = h.browser()
    const { nonce } = await proveInTelegram(h, owner, 5550030, '012 300 300')
    const thief = h.browser()
    await thief.start() // the thief has a binding cookie of its own
    for (const attempt of [thief, h.browser()]) {
      const res = await attempt.poll(nonce)
      assert.equal(res.status, 404)
      assert.equal(res.body.code, 'telegram_challenge_not_found', 'the same answer as an unknown nonce')
      assert.equal(attempt.jar.bos_portal, undefined)
    }
    assert.equal(h.count('portal_accounts'), 0, 'nothing created for the wrong browser')
    // Positive control: the browser that started still finishes.
    const mine = await owner.poll(nonce)
    assert.equal(mine.body.status, 'signed_in')
    // The cookie is httpOnly, Strict and scoped to the Telegram auth routes.
    const res = await h.request('/auth/telegram/start', 'POST', { consent: true, consentVersion: SHOWN_VERSION }, { ip: '198.51.100.250' })
    const cookie = res.headers.getSetCookie().find((line) => line.startsWith('bos_portal_tg='))
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /SameSite=Strict/i)
    assert.match(cookie, /Path=\/api\/portal\/auth\/telegram/i)
    assert.match(cookie, /Secure/i)
  })

// ---- 7. no takeover of an existing phone member -----------------------------------
async function seedPhoneMember(h, phone, password = 'member-pass') {
  h.raw.prepare("INSERT INTO settings (key, value) VALUES ('customer_portal_signup_enabled', 'true')").run({})
  const browser = h.browser()
  const res = await browser.send('/auth/signup', 'POST', { name: 'Phone Member', phone, password, consent: true, consentLocale: 'en' })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  h.raw.prepare("DELETE FROM settings WHERE key = 'customer_portal_signup_enabled'").run({})
  return { browser, account: h.one('SELECT id FROM portal_accounts WHERE phone = @p', { p: phone.replace(/\D/g, '') }) }
}

scenario('an existing phone + password member is NOT taken over by proving the same phone in Telegram',
  { label: 'sign in whoever owns the proven phone', edits: [['lib/portalTelegram.ts', 'if (holder) return PHONE_HAS_ACCOUNT', "if (holder) return { ok: true, kind: 'signed_in', accountId: Number(holder.id), created: false }"]] },
  async () => {
    const h = makeHarness()
    const { account } = await seedPhoneMember(h, '012400400')
    const sessionsBefore = h.count('portal_sessions', `account_id = ${account.id}`)
    const stranger = h.browser()
    const { nonce } = await proveInTelegram(h, stranger, 5550040, '012 400 400')
    const res = await stranger.poll(nonce)
    assert.equal(res.status, 409)
    assert.equal(res.body.code, 'telegram_phone_has_account')
    assert.match(res.body.error, /Sign in with your phone number and password/)
    assert.equal(stranger.jar.bos_portal, undefined, 'no session')
    assert.equal(h.count('portal_sessions', `account_id = ${account.id}`), sessionsBefore)
    assert.equal(h.count('portal_login_identities'), 0, 'Telegram is not attached')
    assert.equal(h.count('portal_accounts'), 1, 'and no second account is made for the phone')
  })

scenario('connecting Telegram to that account needs a signed-in session AND the password again, and the same phone',
  { label: 'attach without the fresh password check', edits: [['routes/portalTelegram.ts', 'if (!check.ok) return c.json({ error: check.error, code: check.code }, check.status)', 'void check']] },
  async () => {
    const h = makeHarness()
    const { browser, account } = await seedPhoneMember(h, '012500500')
    const anon = h.browser()
    assert.equal((await anon.start({ mode: 'attach', password: 'member-pass' })).status, 401, 'attach needs a session')
    const noPassword = await browser.start({ mode: 'attach' })
    assert.equal(noPassword.status, 400)
    const wrong = await browser.start({ mode: 'attach', password: 'not-it' })
    assert.equal(wrong.status, 401)
    assert.equal(wrong.body.code, 'invalid_credentials')
    assert.equal(h.count('portal_telegram_challenges'), 0, 'no challenge without the password')
    // A different Telegram phone is not this account's phone.
    const other = await proveInTelegram(h, browser, 5550051, '012 999 000', { mode: 'attach', password: 'member-pass' })
    const mismatch = await browser.poll(other.nonce)
    assert.equal(mismatch.status, 409)
    assert.equal(mismatch.body.code, 'telegram_phone_mismatch')
    // The right password and the account's own phone: attached.
    const { nonce } = await proveInTelegram(h, browser, 5550050, '+85512500500', { mode: 'attach', password: 'member-pass' })
    const attached = await browser.poll(nonce)
    assert.equal(attached.status, 200, JSON.stringify(attached.body))
    assert.equal(attached.body.status, 'attached')
    assert.equal(h.one("SELECT account_id FROM portal_login_identities WHERE subject_key = '5550050'").account_id, account.id)
    // From now on Telegram signs in to that same account.
    const later = h.browser()
    const again = await proveInTelegram(h, later, 5550050, '012500500')
    const signedIn = await later.poll(again.nonce)
    assert.equal(signedIn.body.status, 'signed_in')
    assert.equal(signedIn.body.created, false)
    assert.equal(h.count('portal_accounts'), 1)
  })

scenario('an attach finishes only in the same signed-in session it started in',
  { label: 'attach ignores the session at completion', edits: [['lib/portalTelegram.ts', 'if (row.account_id == null || sessionAccount !== Number(row.account_id)) {', 'if (row.account_id == null) {']] },
  async () => {
    const h = makeHarness()
    const { browser } = await seedPhoneMember(h, '012600600')
    const started = await browser.start({ mode: 'attach', password: 'member-pass' })
    await h.bot(startMsg(5550060, started.body.nonce))
    await h.bot(contactMsg(5550060, 5550060, '012600600'))
    await browser.send('/auth/signout', 'POST', {})
    const res = await browser.poll(started.body.nonce)
    assert.equal(res.status, 401)
    assert.equal(h.count('portal_login_identities'), 0)
  })

scenario('a Telegram account already attached elsewhere is refused, not moved',
  { label: 'attach replaces an existing identity row', edits: [['lib/portalTelegram.ts', "INSERT INTO portal_login_identities (account_id, provider, subject_key, verified_at, last_used_at)\n      SELECT @id, 'telegram'", "INSERT OR REPLACE INTO portal_login_identities (account_id, provider, subject_key, verified_at, last_used_at)\n      SELECT @id, 'telegram'"]] },
  async () => {
    const h = makeHarness()
    // Member A joined with Telegram 5550070.
    const a = h.browser()
    const first = await proveInTelegram(h, a, 5550070, '012700700')
    assert.equal((await a.poll(first.nonce)).body.status, 'signed_in')
    const aId = h.one("SELECT account_id FROM portal_login_identities WHERE subject_key = '5550070'").account_id
    // Member B, a phone + password account holding the phone that Telegram
    // account proves (A's phone was changed so B could exist), tries to connect
    // the SAME Telegram account with a correct password.
    h.raw.prepare("UPDATE portal_accounts SET phone = '012700799' WHERE id = @id").run({ id: aId })
    const { browser: b, account: bAccount } = await seedPhoneMember(h, '012700700')
    const { nonce } = await proveInTelegram(h, b, 5550070, '012700700', { mode: 'attach', password: 'member-pass' })
    const res = await b.poll(nonce)
    assert.equal(res.status, 409)
    assert.equal(res.body.code, 'telegram_already_attached')
    assert.equal(h.one("SELECT account_id FROM portal_login_identities WHERE subject_key = '5550070'").account_id, aId, 'still A\'s')
    assert.equal(h.count('portal_login_identities', `account_id = ${bAccount.id}`), 0)
  })

// ---- 8. sign-up by phone + password is paused by default ----------------------------
scenario('phone + password sign-up is paused by default (403 portal_signup_paused) while Telegram sign-up works',
  { label: 'the sign-up switch defaults to on', edits: [['routes/portal.ts', 'normalizeBoolean(settings.customer_portal_signup_enabled, false)', 'normalizeBoolean(settings.customer_portal_signup_enabled, true)']] },
  async () => {
    const h = makeHarness()
    const b = h.browser()
    const res = await b.send('/auth/signup', 'POST', { name: 'Typed Phone', phone: '012 800 800', password: 'typed-pass', consent: true })
    assert.equal(res.status, 403)
    assert.equal(res.body.code, 'portal_signup_paused')
    assert.equal(h.count('portal_accounts'), 0)
    const config = await h.request('/config', 'GET')
    assert.equal(config.body.signupEnabled, false)
    assert.deepEqual((await h.request('/auth/telegram/status', 'GET')).body, { available: true })
    const { nonce } = await proveInTelegram(h, b, 5550080, '012 800 800')
    assert.equal((await b.poll(nonce)).body.status, 'signed_in')
  })

// ---- 9. the staff bot is untouched ----------------------------------------------------
scenario('the staff webhook keeps its own route and secret; the two bots share nothing',
  { label: 'the customer webhook accepts the staff bot secret', edits: [['lib/portalTelegram.ts', "return sameText(expected, String(supplied ?? ''))", "return sameText(expected, String(supplied ?? '')) || String(supplied ?? '') === await portalTelegramSha256Hex(String((env as PortalTelegramEnv)?.TELEGRAM_BOT_TOKEN || ''))"]] },
  async () => {
    const h = makeHarness()
    const b = h.browser()
    const s = await b.start()
    // The staff bot's secret is sha256-hex(TELEGRAM_BOT_TOKEN) (lib/telegram.ts, pinned by
    // test-telegram-webhook-secret-pure.cjs). It must open nothing on the customer webhook.
    assert.equal((await h.bot(startMsg(5550090, s.body.nonce), sha256hex(STAFF_TOKEN))).status, 401)
    // Source facts: the staff route and lib never read the customer bot's settings, the
    // staff secret is still derived from the staff token, and index.ts still mounts the
    // staff webhook at /api/telegram while the customer one lives under /api/portal.
    const staffRoute = read('routes/telegram.ts'); const staffLib = read('lib/telegram.ts'); const index = read('index.ts')
    assert.equal(/PORTAL_TELEGRAM|portalTelegram/.test(staffRoute + staffLib), false)
    assert.match(staffLib, /const token = String\(env\.TELEGRAM_BOT_TOKEN \|\| ''\)\.trim\(\)\r?\n\s+const expected = token \? await webhookSecretFromToken\(token\) : ''/)
    assert.match(index, /app\.route\('\/api\/telegram', telegramRoute\)/)
    assert.match(index, /app\.route\('\/api\/portal', portalTelegramRoute\)\r?\napp\.route\('\/api\/portal', portalRoute\)/)
    assert.equal(/telegram\/webhook/.test(read('lib/originGuard.ts').replace("'/api/telegram/webhook'", '')), false, 'the origin guard exemption list is unchanged')
  })

// ---- 10. the bot's friendly answers ------------------------------------------------
scenario('/start with no nonce or an unknown one gets a friendly bilingual answer and writes nothing',
  { label: 'a bare /start is looked up as a nonce', edits: [['lib/portalTelegram.ts', 'if (!isPortalTelegramNonce(payload)) return reply(tgId, botText(env, BOT_TEXT.welcome, \'both\'))', '']] },
  async () => {
    const h = makeHarness()
    const before = h.count('portal_telegram_challenges')
    const bare = await h.bot(startMsg(5550100))
    assert.equal(bare.status, 200)
    assert.match(bare.body.text, /Continue with Telegram/)
    assert.match(bare.body.text, KHMER)
    assert.match(bare.body.text, /Leang Cosmetics/)
    assert.match(bare.body.text, /leangbeauty\.com/)
    const junk = await h.bot(startMsg(5550100, '../../etc'))
    assert.match(junk.body.text, /Continue with Telegram/)
    const unknown = await h.bot(startMsg(5550100, 'A'.repeat(32)))
    assert.match(unknown.body.text, /expired or was already used/)
    assert.match(unknown.body.text, KHMER)
    const stray = await h.bot({ message_id: 3, chat: chat(5550100), from: { id: 5550100 }, text: 'hello' })
    assert.match(stray.body.text, /Continue with Telegram/)
    const noWait = await h.bot(contactMsg(5550100, 5550100, '012 000 111'))
    assert.match(noWait.body.text, /No website sign-in is waiting/)
    // Groups and other bots get no answer at all.
    const group = await h.bot({ message_id: 4, chat: { id: -100123, type: 'group' }, from: { id: 5550100 }, text: '/start' })
    assert.deepEqual(group.body, { ok: true })
    assert.equal(h.count('portal_telegram_challenges'), before)
    assert.equal(h.count('portal_accounts'), 0)
  })

scenario('a link forwarded to a second Telegram user stays with the first one',
  { label: 'a second Telegram user can take over a started link', edits: [['lib/portalTelegram.ts', 'AND (telegram_user_id IS NULL OR telegram_user_id = @tg)', ''], ['lib/portalTelegram.ts', ' || (row.telegram_user_id != null && row.telegram_user_id !== tgId)', '']] },
  async () => {
    const h = makeHarness()
    const browser = h.browser()
    const s = await browser.start()
    await h.bot(startMsg(5550110, s.body.nonce))
    const intruder = await h.bot(startMsg(5550111, s.body.nonce))
    assert.match(intruder.body.text, /expired or was already used|ផុតកំណត់/)
    assert.equal(h.one('SELECT telegram_user_id FROM portal_telegram_challenges').telegram_user_id, '5550110')
  })

// ---- 11. rate limits ------------------------------------------------------------------
scenario('rate limits: starts per network, and updates per Telegram user',
  { label: 'no per-network start limit', edits: [['routes/portalTelegram.ts', 'if (!window.allowed) {', 'if (false) {']] },
  async () => {
    const h = makeHarness()
    const browser = h.browser()
    for (let i = 0; i < 20; i += 1) assert.equal((await browser.start()).status, 200)
    const blocked = await browser.start()
    assert.equal(blocked.status, 429)
    assert.ok(blocked.headers.get('Retry-After'))
    assert.equal(h.count('portal_telegram_challenges'), 20)
    assert.equal((await h.browser().start()).status, 200, 'another network is not blocked')
  })

scenario('rate limits: a Telegram user flooding the bot is told to wait and binds nothing',
  { label: 'no per-Telegram-user limit', edits: [['lib/portalTelegram.ts', 'if (!rate.allowed) return reply(tgId, botText(env, BOT_TEXT.tooMany, \'both\'))', '']] },
  async () => {
    const h = makeHarness()
    for (let i = 0; i < 20; i += 1) await h.bot({ message_id: i, chat: chat(5550120), from: { id: 5550120 }, text: 'spam' })
    const s = await h.browser().start()
    const res = await h.bot(startMsg(5550120, s.body.nonce))
    assert.match(res.body.text, /Too many messages/)
    assert.equal(h.one('SELECT telegram_user_id FROM portal_telegram_challenges').telegram_user_id, null)
    // Another Telegram user is unaffected.
    assert.equal((await h.bot(startMsg(5550121, s.body.nonce))).body.reply_markup.keyboard[0][0].request_contact, true)
  })

// ---- 12. suspended members, staff chip -------------------------------------------------
scenario('a suspended member is refused; staff see a Telegram member as Verified',
  { label: 'the staff chip ignores verified identities', edits: [['routes/portalMembers.ts', 'verified: Number(row.verified) === 1 })', 'verified: false })']] },
  async () => {
    // A signed-in administrator for the staff Members API (routes/portalMembers.ts).
    const admin = { id: 1, username: 'owner', name: 'Owner', role_code: 'admin', permissions: '{}', role_permissions: '{}' }
    const h = makeHarness({ overrides: { '../lib/auth': { requireAuth: async (c, next) => { c.set('user', admin); await next() } } } })
    const browser = h.browser()
    const first = await proveInTelegram(h, browser, 5550130, '012130130')
    assert.equal((await browser.poll(first.nonce)).body.status, 'signed_in')
    const id = h.one("SELECT account_id FROM portal_login_identities WHERE subject_key = '5550130'").account_id
    // Staff view (routes/portalMembers.ts) for that member.
    const members = createStaffApp(h)
    const view = await members(`/${id}`)
    assert.equal(view.status, 200, JSON.stringify(view.body))
    assert.equal(view.body.member.chip, 'verified')
    assert.deepEqual(view.body.member.methods, { password: false, telegram: true })
    // Suspend, then try to sign in with Telegram again.
    h.raw.prepare("UPDATE portal_accounts SET status = 'suspended' WHERE id = @id").run({ id })
    const later = h.browser()
    const again = await proveInTelegram(h, later, 5550130, '012130130')
    const res = await later.poll(again.nonce)
    assert.equal(res.status, 403)
    assert.equal(res.body.code, 'portal_account_suspended')
    assert.equal(later.jar.bos_portal, undefined)
  })

function createStaffApp(h) {
  const app = h.load('routes/portalMembers.ts').default
  return async (pathname) => {
    const response = await app.request(pathname, { method: 'GET', headers: { Host: 'admin.leangbeauty.com' } }, h.env, { waitUntil() {}, passThroughOnException() {} })
    return { status: response.status, body: await response.json().catch(() => null) }
  }
}

// ---- 12b. login CSRF ---------------------------------------------------------------------
scenario('start and poll are same-origin JSON only (415 / 403), like the portal /auth/* writes; the webhook is exempt',
  { label: 'the Telegram routes skip the credential guard', edits: [['routes/portalTelegram.ts', "app.use('/auth/*', requireJsonSameOriginCredentialPost)", '']] },
  async () => {
    const h = makeHarness()
    const body = { consent: true, consentVersion: SHOWN_VERSION, consentLocale: 'km', locale: 'km' }
    const send = (pathname, payload, headers) => h.request(pathname, 'POST', payload, { ip: '198.51.100.200', headers })
    const textPlain = await send('/auth/telegram/start', body, { 'Content-Type': 'text/plain' })
    assert.equal(textPlain.status, 415)
    assert.equal(textPlain.body.code, 'credential_json_required')
    for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': null }, { 'Sec-Fetch-Site': null, Origin: 'https://evil.example' }]) {
      const res = await send('/auth/telegram/start', body, headers)
      assert.equal(res.status, 403, JSON.stringify(headers))
      assert.equal(res.body.code, 'credential_origin_refused')
    }
    assert.equal((await send('/auth/telegram/poll', { nonce: 'A'.repeat(32) }, { 'Content-Type': 'text/plain' })).status, 415)
    assert.equal((await send('/auth/telegram/poll', { nonce: 'A'.repeat(32) }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
    assert.equal(h.count('portal_telegram_challenges'), 0, 'a refused start writes nothing')
    assert.equal(h.count('rate_limit_events'), 0, 'refused before the rate limiter')
    // Safari before 16.4 sends no Sec-Fetch-Site but a same-origin Origin: allowed.
    const safari = await h.request('http://localhost/auth/telegram/start', 'POST', body, { ip: '198.51.100.201', headers: { 'Sec-Fetch-Site': null, Origin: 'http://localhost' } })
    assert.equal(safari.status, 200, JSON.stringify(safari.body))
    // Positive control and the exemption: a browser start works, and the bot's
    // webhook (no browser headers at all) is still answered.
    const ok = await send('/auth/telegram/start', body, {})
    assert.equal(ok.status, 200)
    assert.equal((await h.bot(startMsg(5550140, ok.body.nonce))).body.reply_markup.keyboard[0][0].request_contact, true)
  })

// ---- 14. owner ruling: the relay warning ---------------------------------------------------
// Owner wording (6 Oct 2026, revised to name the button), EN verbatim.
const WARNING_EN = 'Only share your number with our bot if you just pressed Continue with Telegram on leangbeauty.com. We will never ask you to share it for any other reason.'
const WARNING_KM = 'សូមចែករំលែកលេខរបស់អ្នកជាមួយបូតរបស់យើង លុះត្រាតែអ្នកទើបតែបានចុច "បន្តជាមួយ Telegram" នៅលើ leangbeauty.com។ យើងនឹងមិនដែលសុំឱ្យអ្នកចែករំលែកវា ដោយហេតុផលផ្សេងទៀតឡើយ។'
// The share-phone request names the button; every request message quotes it.
const REQUEST_EN = '"Share my phone number"'
const REQUEST_KM = '"ចែករំលែកលេខទូរស័ព្ទរបស់ខ្ញុំ"'
scenario('owner ruling: every share-phone request carries the relay warning in EN and KM, before the request',
  { label: 'the share-phone message without the warning', edits: [['lib/portalTelegram.ts', '`${BOT_TEXT.relayWarning[language]}\\n\\n${text[language]}`', 'text[language]']] },
  async () => {
    const h = makeHarness()
    const withButton = []
    const keep = (res) => { if (res.body?.reply_markup?.keyboard?.[0]?.[0]?.request_contact) withButton.push(res.body.text); return res }
    for (const locale of ['km', 'en']) {
      const b = h.browser()
      const s = await b.start({ locale })
      const tg = locale === 'km' ? 5550150 : 5550151
      keep(await h.bot(startMsg(tg, s.body.nonce)))              // the request itself
      keep(await h.bot(contactMsg(tg, 5559999, '012 999 888')))  // a forwarded contact: the request again
      keep(await h.bot(startMsg(tg, s.body.nonce)))              // /start pressed twice
    }
    assert.equal(withButton.length, 6, 'every path that offers the button was exercised')
    for (const text of withButton) {
      for (const [warning, request] of [[WARNING_EN, REQUEST_EN], [WARNING_KM, REQUEST_KM]]) {
        const w = text.indexOf(warning)
        assert.ok(w >= 0, `the warning is missing: ${warning.slice(0, 30)}`)
        const r = text.indexOf(request, w)
        const anyRequest = text.indexOf(request)
        assert.ok(r > w && anyRequest > w, 'the warning comes before the share-phone request')
      }
    }
    // A contact is only ever accepted after that message: without a /start
    // that delivered it, the bot has nothing waiting and binds nothing.
    const cold = await h.bot(contactMsg(5550152, 5550152, '012 152 152'))
    assert.match(cold.body.text, /No website sign-in is waiting/)
    assert.equal(h.count('portal_telegram_challenges', "telegram_user_id = '5550152'"), 0)
  })

// The website shows the same warning while it waits. One text, three places:
// the bot (what it actually sends), the language packs, and the component's
// fallbacks. The button it names is the website's own button label.
const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'src')
scenario('the warning is word for word the same in the bot, both language packs and the website panel, and names the real button',
  { label: 'the bot\'s English warning drifts from the website', edits: [['lib/portalTelegram.ts', 'We will never ask you to share it for any other reason.', 'We never ask for it otherwise.']] },
  async () => {
    const h = makeHarness()
    const sent = {}
    for (const locale of ['en', 'km']) {
      const s = await h.browser().start({ locale })
      const tg = locale === 'en' ? 5550155 : 5550156
      const res = await h.bot(startMsg(tg, s.body.nonce))
      sent[locale] = res.body.text
    }
    const packs = {}
    for (const lang of ['en', 'km']) packs[lang] = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'lang', `${lang}.json`), 'utf8'))
    const component = fs.readFileSync(path.join(FRONTEND, 'components', 'catalog', 'PortalTelegramSignIn.tsx'), 'utf8')
    const fallback = /copy\('portal_telegram_warning', '([^']+)', '([^']+)'\)/.exec(component)
    assert.ok(fallback, 'the waiting panel shows portal_telegram_warning')
    const website = { en: packs.en.portal_telegram_warning, km: packs.km.portal_telegram_warning }
    assert.deepEqual(website, { en: WARNING_EN, km: WARNING_KM }, 'the packs carry the owner wording')
    assert.deepEqual({ en: fallback[1], km: fallback[2] }, website, 'the component fallbacks match the packs')
    for (const locale of ['en', 'km']) {
      for (const lang of ['en', 'km']) assert.ok(sent[locale].includes(website[lang]), `the ${locale} bot reply carries the website's ${lang} warning`)
    }
    // "Continue with Telegram" is the button the member pressed, in each language.
    assert.ok(WARNING_EN.includes(packs.en.portal_telegram_continue), packs.en.portal_telegram_continue)
    assert.ok(WARNING_KM.includes(`"${packs.km.portal_telegram_continue}"`), packs.km.portal_telegram_continue)
    // Shown before the member is sent to Telegram.
    assert.ok(component.indexOf("copy('portal_telegram_warning'") < component.indexOf("copy('portal_telegram_open'"), 'the warning is above Open Telegram')
  })

// ---- 15. owner ruling: the consent-version bump hook ----------------------------------------
const NEXT_VERSION = 'portal-legal-2026-10-20'
// The flip as the lead will make it in lib/portalAccounts.ts: the new literal,
// the old one kept accepted. (The frontend half is the policy text itself.)
const FLIPPED = [
  ['lib/portalAccounts.ts', "export const PORTAL_CONSENT_VERSION = 'portal-legal-2026-09-30'", `export const PORTAL_CONSENT_VERSION = '${NEXT_VERSION}'`],
  ['lib/portalAccounts.ts', "const EARLIER_ACCEPTED_CONSENT_VERSIONS: readonly string[] = ['portal-legal-2026-09-07']", "const EARLIER_ACCEPTED_CONSENT_VERSIONS: readonly string[] = ['portal-legal-2026-09-30', 'portal-legal-2026-09-07']"],
]
scenario('consent-version hook: start must carry the version the page showed; after a flip, an old page is refused and members stay valid',
  { label: 'start ignores the shown version', edits: [['routes/portalTelegram.ts', '} else if (body.consentVersion !== PORTAL_CONSENT_VERSION) {', '} else if (false) {']] },
  async () => {
    const h = makeHarness()
    const b = h.browser()
    for (const consentVersion of [undefined, 'portal-legal-2026-09-07', NEXT_VERSION]) {
      const res = await b.start({ consentVersion })
      assert.equal(res.status, 409, String(consentVersion))
      assert.equal(res.body.code, 'portal_consent_version_changed')
      assert.equal(res.body.consentVersion, SHOWN_VERSION)
    }
    assert.equal(h.count('portal_telegram_challenges'), 0, 'a refused start writes nothing')
    const first = await proveInTelegram(h, b, 5550160, '012 160 160')
    assert.equal((await b.poll(first.nonce)).body.status, 'signed_in')
    assert.equal(h.one("SELECT consent_version FROM portal_accounts WHERE phone = '012160160'").consent_version, SHOWN_VERSION)

    // The flip, ready as described in routes/portalTelegram.ts.
    const f = makeHarness({ edits: FLIPPED })
    const existing = f.browser()
    const joined = await proveInTelegram(f, existing, 5550161, '012 161 161', { consentVersion: NEXT_VERSION })
    assert.equal((await existing.poll(joined.nonce)).body.status, 'signed_in')
    // A member stamped with the old version before the flip is still signed in...
    f.raw.prepare("UPDATE portal_accounts SET consent_version = @v WHERE phone = '012161161'").run({ v: SHOWN_VERSION })
    assert.ok((await existing.send('/auth/me', 'GET')).body.account, 'the old version stays accepted')
    // ...a tab still showing the old text cannot start...
    const stale = await f.browser().start({ consentVersion: SHOWN_VERSION })
    assert.equal(stale.status, 409)
    assert.equal(stale.body.consentVersion, NEXT_VERSION)
    // ...and a fresh page signs the old member in, stamped with the new version.
    const fresh = f.browser()
    const again = await proveInTelegram(f, fresh, 5550161, '012 161 161', { consentVersion: NEXT_VERSION })
    assert.equal((await fresh.poll(again.nonce)).body.status, 'signed_in')
    assert.equal(f.one("SELECT consent_version FROM portal_accounts WHERE phone = '012161161'").consent_version, NEXT_VERSION)
  })

// ---- 16. G38 E1 redaction: the Verified chip for a links-only user ----------------------------
scenario('a links-only staff user sees Verified and the sign-in methods on the member, nothing about its customer',
  { label: 'the member view skips the links-only redaction', edits: [['routes/portalMembers.ts', 'return redactStaffMember(staffMemberView(row), viewerCanSeeCustomers(c))', 'return staffMemberView(row)']] },
  async () => {
    const linksOnly = { id: 2, username: 'linker', name: 'Linker', role_code: 'staff', permissions: JSON.stringify({ portal_member_links: true }), role_permissions: '{}' }
    const h = makeHarness({ overrides: { '../lib/auth': { requireAuth: async (c, next) => { c.set('user', linksOnly); await next() } } } })
    const b1 = h.browser()
    const one = await proveInTelegram(h, b1, 5550170, '012170170')
    assert.equal((await b1.poll(one.nonce)).body.status, 'signed_in')
    const b2 = h.browser()
    const two = await proveInTelegram(h, b2, 5550171, '012171171')
    assert.equal((await b2.poll(two.nonce)).body.status, 'signed_in')
    const idOf = (tg) => h.one('SELECT account_id FROM portal_login_identities WHERE subject_key = @s', { s: String(tg) }).account_id
    // The second member is linked to an in-store customer the links-only user may not see.
    h.raw.prepare("INSERT INTO customers (id, name, phone, phone_normalized, membership_number) VALUES (901, 'Hidden Customer Name', '099 111 222', '099111222', 'LC-00901')").run({})
    h.raw.prepare('UPDATE portal_accounts SET contact_id = 901 WHERE id = @id').run({ id: idOf(5550171) })
    const members = createStaffApp(h)

    const unlinked = await members(`/${idOf(5550170)}`)
    assert.equal(unlinked.status, 200, JSON.stringify(unlinked.body))
    assert.equal(unlinked.body.member.chip, 'verified', 'a links-only user sees Verified on the member')
    assert.deepEqual(unlinked.body.member.methods, { password: false, telegram: true })

    const linked = await members(`/${idOf(5550171)}`)
    assert.equal(linked.status, 200, JSON.stringify(linked.body))
    assert.deepEqual(linked.body.member.methods, { password: false, telegram: true }, 'the member\'s own methods stay visible')
    assert.equal(linked.body.member.customer, null)
    assert.equal(linked.body.member.customerVisible, false)
    const text = JSON.stringify(linked.body)
    for (const secret of ['Hidden Customer Name', 'LC-00901', '099 111 222', '099111222', '"id":901', ':901']) {
      assert.ok(!text.includes(secret), `a links-only user saw ${secret}`)
    }
    const list = await members('/?filter=all')
    assert.equal(list.status, 200, JSON.stringify(list.body))
    assert.ok(!JSON.stringify(list.body).includes('Hidden Customer Name'))
    assert.deepEqual(list.body.items.filter((m) => m.methods.telegram).length, 2)
  })

// ---- 16b. the staff Audit Log ----------------------------------------------------------------
scenario('a Telegram sign-up and a Telegram attach are written to the staff Audit Log, without the phone or the Telegram id; plain sign-ins are not',
  { label: 'the sign-up is not audited', edits: [['routes/portalTelegram.ts', "await audit(c.env, null, null, 'member_telegram_signup'", "void (c.env, null, null, 'member_telegram_signup'"]] },
  async () => {
    const calls = []
    const h = makeHarness({ overrides: { '../lib/audit': { audit: async (...args) => { calls.push(args.slice(1)) } } } })
    const b = h.browser()
    const joined = await proveInTelegram(h, b, 5550180, '012 180 180')
    assert.equal((await b.poll(joined.nonce)).body.status, 'signed_in')
    const again = h.browser()
    const second = await proveInTelegram(h, again, 5550180, '012180180')
    assert.equal((await again.poll(second.nonce)).body.created, false)
    const { browser: member, account } = await seedPhoneMember(h, '012180199')
    const attach = await proveInTelegram(h, member, 5550181, '012180199', { mode: 'attach', password: 'member-pass' })
    assert.equal((await member.poll(attach.nonce)).body.status, 'attached')
    const created = h.one("SELECT account_id FROM portal_login_identities WHERE subject_key = '5550180'").account_id
    assert.deepEqual(calls.map(([userId, , action, entity, entityId]) => [userId, action, entity, entityId]), [
      [null, 'member_telegram_signup', 'portal_member', created],
      [null, 'member_telegram_attach', 'portal_member', account.id],
    ], 'one row per account change; the second sign-in writes none')
    const text = JSON.stringify(calls)
    for (const secret of ['5550180', '5550181', '012180180', '012180199']) assert.ok(!text.includes(secret), `the audit row carries ${secret}`)
  })

// ---- 17. owner ruling: a closed member loses its Telegram link -------------------------------
// Migration 0232's trigger portal_accounts_close_drops_identities deletes a
// member's identities and open handshakes inside the UPDATE that closes it.
// Every close path goes through that UPDATE: today the 180-day purge
// (lib/ephemeralRetention.ts) is the only writer that sets status 'closed';
// staff only suspend and reactivate (routes/portalMembers.ts).
const NO_CLOSE_TRIGGER = { label: 'the database without the close trigger', schema: 'DROP TRIGGER portal_accounts_close_drops_identities' }
const OLD = "'2000-01-01 00:00:00'"
const openChallenge = (h, purpose, accountId, tg) => h.raw.prepare(`INSERT INTO portal_telegram_challenges (nonce_hash, browser_hash, purpose, account_id, status, telegram_user_id, phone, expires_at)
  VALUES (@n, @b, @purpose, @account, 'verified', @tg, '012000000', '2999-01-01 00:00:00.000')`).run({ n: crypto.randomBytes(32).toString('hex'), b: 'c'.repeat(64), purpose, account: accountId, tg })

scenario('the 180-day purge closes a member and drops its identities and open handshakes in the same batch; a verified member is exempt',
  NO_CLOSE_TRIGGER,
  async () => {
    const h = makeHarness()
    // P: a phone + password member, idle 200 days, with an open attach and an
    // UNverified identity (a later provider; Telegram ones are always verified).
    const { account: p } = await seedPhoneMember(h, '012170100')
    h.raw.prepare('INSERT INTO portal_login_identities (account_id, provider, subject_key, verified_at) VALUES (@id, \'email\', \'p-mail-key\', NULL)').run({ id: p.id })
    openChallenge(h, 'attach', p.id, '5550172')
    // T: a Telegram member, also idle 200 days: verified, so the purge keeps it.
    const t = h.browser()
    const joined = await proveInTelegram(h, t, 5550173, '012170300')
    assert.equal((await t.poll(joined.nonce)).body.status, 'signed_in')
    openChallenge(h, 'signin', null, '5550173')
    h.raw.exec(`UPDATE portal_accounts SET created_at = ${OLD}, last_seen_at = ${OLD}`)

    const result = await h.load('lib/ephemeralRetention.ts').maybeRunScheduledEphemeralRetention(h.env)
    assert.equal(result.deleted.portal_members_inactive, 1, JSON.stringify(result))
    assert.equal(h.one('SELECT status FROM portal_accounts WHERE id = @id', { id: p.id }).status, 'closed')
    assert.equal(h.count('portal_login_identities', `account_id = ${p.id}`), 0, 'the closed member\'s identities are gone')
    assert.equal(h.count('portal_telegram_challenges', `account_id = ${p.id} OR telegram_user_id = '5550172'`), 0, 'and its open attach')
    assert.equal(h.count('portal_login_identities', "subject_key = '5550173'"), 1, 'the verified member is untouched')
    assert.equal(h.count('portal_telegram_challenges', "telegram_user_id = '5550173' AND status = 'verified'"), 1, 'and so is its open sign-in')
  })

scenario('any close drops the Telegram link and its handshakes in the same statement; a failed close keeps them; suspend keeps them',
  NO_CLOSE_TRIGGER,
  async () => {
    const h = makeHarness()
    const b = h.browser()
    const joined = await proveInTelegram(h, b, 5550174, '012170400')
    assert.equal((await b.poll(joined.nonce)).body.status, 'signed_in')
    const id = h.one("SELECT account_id FROM portal_login_identities WHERE subject_key = '5550174'").account_id
    openChallenge(h, 'signin', null, '5550174')          // a sign-in its Telegram user has open
    openChallenge(h, 'signin', null, '5550199')          // someone else's: must survive
    const mine = () => h.count('portal_login_identities', `account_id = ${id}`) + h.count('portal_telegram_challenges', "telegram_user_id = '5550174'")
    const held = mine()
    assert.ok(held >= 2, 'the link plus at least the open sign-in (the finished one stays until expiry)')
    // Suspend is not a close.
    h.raw.prepare("UPDATE portal_accounts SET status = 'suspended' WHERE id = @id").run({ id })
    assert.equal(mine(), held, 'a suspension keeps the link')
    h.raw.prepare("UPDATE portal_accounts SET status = 'active' WHERE id = @id").run({ id })
    // A close whose batch fails later leaves everything as it was.
    await assert.rejects(() => h.raw.batch([
      { sql: "UPDATE portal_accounts SET status = 'closed', phone = NULL WHERE id = @id", params: { id } },
      { sql: "INSERT INTO portal_login_identities (account_id, provider, subject_key) VALUES (@id, 'sms', 'x')", params: { id } },
    ]), /CHECK/)
    assert.equal(h.one('SELECT status FROM portal_accounts WHERE id = @id', { id }).status, 'active')
    assert.equal(mine(), held, 'a failed close keeps the link')
    // The close (any path: the purge's UPDATE, a later self-close or staff close).
    h.raw.prepare("UPDATE portal_accounts SET status = 'closed', closed_at = CURRENT_TIMESTAMP, name = '', phone = NULL WHERE id = @id").run({ id })
    assert.equal(mine(), 0, 'the link and its handshake went with the close')
    assert.equal(h.count('portal_telegram_challenges', "telegram_user_id = '5550199'"), 1, 'nobody else\'s')
  })

scenario('after a close the same Telegram account and phone join as a NEW member and can never reach the closed one',
  NO_CLOSE_TRIGGER,
  async () => {
    const h = makeHarness()
    const b = h.browser()
    const first = await proveInTelegram(h, b, 5550175, '012170500')
    assert.equal((await b.poll(first.nonce)).body.status, 'signed_in')
    const old = h.one("SELECT a.id, a.member_code FROM portal_accounts a JOIN portal_login_identities i ON i.account_id = a.id WHERE i.subject_key = '5550175'")
    // An attach the member had open on another account of theirs is part of the close too.
    const { browser: other } = await seedPhoneMember(h, '012170599')
    const attach = await other.start({ mode: 'attach', password: 'member-pass' })
    assert.equal(attach.status, 200)
    await h.bot(startMsg(5550175, attach.body.nonce))  // bound to the same Telegram user
    // The member is closed, as the purge closes: phone and personal fields cleared.
    h.raw.prepare("UPDATE portal_accounts SET status = 'closed', closed_at = CURRENT_TIMESTAMP, name = '', phone = NULL, password_hash = NULL WHERE id = @id").run({ id: old.id })
    assert.equal(h.count('portal_telegram_challenges', "telegram_user_id = '5550175'"), 0, 'the open handshake of that Telegram user is gone')
    // The old browser's session no longer opens anything, and cannot attach.
    assert.equal((await b.send('/auth/me', 'GET')).body?.account ?? null, null)
    assert.equal((await b.start({ mode: 'attach', password: 'member-pass' })).status, 401)
    // The same Telegram account and phone sign up again: a NEW member.
    const fresh = h.browser()
    const again = await proveInTelegram(h, fresh, 5550175, '012170500')
    const res = await fresh.poll(again.nonce)
    assert.equal(res.status, 200, JSON.stringify(res.body))
    assert.equal(res.body.status, 'signed_in')
    assert.equal(res.body.created, true, 'a new member, not the closed one')
    const now = h.one("SELECT a.id, a.member_code, a.status FROM portal_accounts a JOIN portal_login_identities i ON i.account_id = a.id WHERE i.subject_key = '5550175'")
    assert.notEqual(now.id, old.id)
    assert.notEqual(now.member_code, old.member_code, 'a closed W- code is never issued again')
    assert.equal(now.status, 'active')
    const closed = h.one('SELECT status, phone, member_code FROM portal_accounts WHERE id = @id', { id: old.id })
    assert.deepEqual({ ...closed }, { status: 'closed', phone: null, member_code: old.member_code }, 'the closed row keeps its history and stays closed')
    assert.equal(h.count('portal_login_identities', `account_id = ${old.id}`), 0, 'nothing points at the closed row')
    // Signing in again later lands on the new member, never the closed one.
    const later = h.browser()
    const third = await proveInTelegram(h, later, 5550175, '012170500')
    const sessionsBefore = h.count('portal_sessions', `account_id = ${old.id}`)
    const back = await later.poll(third.nonce)
    assert.equal(back.body.status, 'signed_in')
    assert.equal(back.body.created, false)
    assert.equal(back.body.account.memberCode, now.member_code)
    assert.equal(h.count('portal_sessions', `account_id = ${old.id}`), sessionsBefore, 'no session is ever made for the closed row')
    assert.equal((await later.send('/auth/me', 'GET')).body.account.memberCode, now.member_code)
    assert.equal(h.one('SELECT status FROM portal_accounts WHERE id = @id', { id: old.id }).status, 'closed')
  })

// ---- 13. retention -----------------------------------------------------------------------
// The 0232 schema itself (header assertions, idempotence, constraints) is
// test-migration-0232-portal-telegram-pure.cjs.
scenario('the retention sweep deletes expired Telegram handshakes and keeps live ones',
  { label: 'the sweep has no step for the challenges', edits: [['lib/ephemeralRetention.ts', "await step('portal_telegram_challenges', ", "void ('portal_telegram_challenges', "]] },
  async () => {
    const h = makeHarness()
    // Retention: the real scheduled sweep removes expired challenges (consumed
    // or not) and keeps live ones.
    const challenge = (n, status, expires) => h.raw.prepare(`INSERT INTO portal_telegram_challenges (nonce_hash, browser_hash, purpose, status, expires_at)
      VALUES (@n, @b, 'signin', @status, @expires)`).run({ n: String(n).repeat(64).slice(0, 64), b: 'b'.repeat(64), status, expires })
    challenge(1, 'consumed', '2000-01-01 00:00:00.000')
    challenge(2, 'pending', '2000-01-01 00:00:00.000')
    challenge(3, 'started', '2999-01-01 00:00:00.000')
    const result = await h.load('lib/ephemeralRetention.ts').maybeRunScheduledEphemeralRetention(h.env)
    assert.equal(result.deleted.portal_telegram_challenges, 2)
    assert.deepEqual(h.raw.prepare('SELECT status FROM portal_telegram_challenges').all({}).map((r) => r.status), ['started'])
  })

// ---- run ------------------------------------------------------------------------------
async function main() {
  let failed = 0
  for (const { name, mutant, run } of scenarios) {
    try {
      await run(makeHarness)
    } catch (error) {
      failed += 1
      console.log(`FAIL ${name}\n  ${String(error && error.stack || error).split('\n').slice(0, 3).join('\n  ')}`)
      continue
    }
    if (!mutant) { console.log(`PASS ${name}`); continue }
    const realMake = makeHarness
    let caught = null
    try {
      await withMutant(mutant, run)
    } catch (error) {
      caught = error
    }
    if (!caught || /no longer applies/.test(String(caught.message))) {
      failed += 1
      console.log(`FAIL ${name}: the plausible wrong implementation "${mutant.label}" ${caught ? `could not be built: ${caught.message}` : 'ALSO passed, so this check proves nothing'}`)
      continue
    }
    void realMake
    console.log(`PASS ${name}\n     mutant "${mutant.label}" fails it: ${String(caught.message).split('\n')[0].slice(0, 110)}`)
  }
  assert.equal(fetchCalls, 0, 'no outbound request was made')
  console.log(`\n${scenarios.length - failed} of ${scenarios.length} passed${failed ? `, ${failed} FAILED` : ''}; outbound requests: ${fetchCalls}`)
  if (failed) process.exitCode = 1
}

// Re-run a scenario with every makeHarness() call building the mutated source.
async function withMutant(mutant, run) {
  const original = makeHarness
  makeHarness = (options = {}) => original({ ...options, mutant })
  try { await run() } finally { makeHarness = original }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
