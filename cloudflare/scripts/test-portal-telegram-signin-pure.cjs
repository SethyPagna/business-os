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
const MIGRATIONS = path.join(__dirname, '..', 'migrations')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

const SECRET = 'Portal_webhook_secret-0123456789abcdefXYZ'
const PORTAL_TOKEN = '7000000001:AAportal-token-made-up-for-tests'
const STAFF_TOKEN = '6000000001:AAstaff-token-made-up-for-tests'
const sha256hex = (text) => crypto.createHash('sha256').update(text).digest('hex')
const ENV = { PORTAL_TELEGRAM_WEBHOOK_SECRET: SECRET, PORTAL_TELEGRAM_BOT_TOKEN: PORTAL_TOKEN, TELEGRAM_BOT_TOKEN: STAFF_TOKEN }
const OPEN_SIGNUP = { customer_portal_signup_enabled: 'true' }
const KHMER = /[ក-៿]/

// Nothing may call out: not Telegram, not anything.
let fetchCalls = 0
globalThis.fetch = async () => { fetchCalls += 1; throw new Error('the Telegram flow must make no outbound request') }

// ---- harness -----------------------------------------------------------------
function makeHarness({ mutant = null, env = ENV, settings = {}, overrides = {} } = {}) {
  const sources = {}
  if (mutant) {
    for (const [rel, from, to] of mutant.edits) {
      const text = sources[rel] ?? read(rel)
      assert.ok(text.includes(from), `mutant "${mutant.label}" no longer applies to ${rel}: ${from.slice(0, 60)}`)
      sources[rel] = text.split(from).join(to)
    }
  }
  const h = createPortalHarness({ sources, env, overrides })
  for (const [key, value] of Object.entries(settings)) h.raw.prepare('INSERT INTO settings (key, value) VALUES (@key, @value)').run({ key, value })
  // index.ts: app.route('/api/portal', portalTelegramRoute) then portalRoute.
  const app = new Hono()
  app.route('/', h.load('routes/portalTelegram.ts').default)
  app.route('/', h.app)
  h.request = async (pathname, method = 'POST', body, { ip = '203.0.113.9', headers = {} } = {}) => {
    const all = { ...(ip ? { 'CF-Connecting-IP': ip } : {}), ...headers }
    if (body !== undefined) all['Content-Type'] = 'application/json'
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
    return { jar, ip, send, start: (body = {}) => send('/auth/telegram/start', 'POST', { consent: true, consentLocale: 'km', locale: 'km', ...body }), poll: (nonce) => send('/auth/telegram/poll', 'POST', { nonce }) }
  }
  h.bot = (message, secret = SECRET) => h.request('/telegram/webhook', 'POST', { update_id: Math.floor(Math.random() * 1e9), message },
    { ip: null, headers: secret === null ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secret } })
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
    const res = await h.request('/auth/telegram/start', 'POST', { consent: true }, { ip: '198.51.100.250' })
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

// ---- 13. migration 0232 ---------------------------------------------------------------
scenario('0232 is LF only, idempotent, carries its header, and enforces one Telegram per member and per account',
  null,
  async () => {
    const name = '0232_portal_telegram_identities.sql'
    const text = fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')
    assert.equal(Buffer.from(text, 'utf8').includes(0x0d), false, 'LF only')
    for (const section of ['PURPOSE', 'PRE-ASSERTIONS', 'POST-ASSERTIONS', 'IDEMPOTENCE', 'RECOVERY']) assert.ok(text.includes(section), `header lacks ${section}`)
    const h = makeHarness()
    h.raw.exec(text) // re-run on the migrated database: changes nothing, no error
    assert.equal(h.count('portal_login_identities'), 0)
    const ins = (account, subject) => h.raw.prepare("INSERT INTO portal_login_identities (account_id, provider, subject_key, verified_at) VALUES (@a, 'telegram', @s, CURRENT_TIMESTAMP)").run({ a: account, s: subject })
    ins(1, '111')
    assert.throws(() => ins(2, '111'), /UNIQUE/, 'one member per Telegram account')
    assert.throws(() => ins(1, '222'), /UNIQUE/, 'one Telegram account per member')
    assert.throws(() => h.raw.prepare("INSERT INTO portal_telegram_challenges (nonce_hash, browser_hash, purpose, expires_at) VALUES (@n, @b, 'attach', '2999-01-01')").run({ n: 'a'.repeat(64), b: 'b'.repeat(64) }), /CHECK/, 'an attach names its account')
    assert.throws(() => h.raw.prepare("INSERT INTO portal_telegram_challenges (nonce_hash, browser_hash, purpose, expires_at) VALUES (@n, @b, 'signin', '2999-01-01')").run({ n: 'raw-nonce', b: 'b'.repeat(64) }), /CHECK/, 'only a 64-hex hash fits')
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
