// G38 S3a: the pure shopper Telegram library (lib/portalTelegramToken.ts). No D1, no network.
// Tests T-A1 to T-A13 of AMEND-g38-lean-writes-1.2 section 11.1; T-A14 lives in test-plan-tier-pure.cjs.
// Run: node scripts/test-portal-telegram-token-pure.cjs
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const cloudflareRoot = path.join(__dirname, '..')
const libRoot = path.join(cloudflareRoot, 'src', 'lib')
const ts = require(path.join(cloudflareRoot, 'node_modules', 'typescript'))

const compiled = new Map()
function loadLib(name) {
  if (compiled.has(name)) return compiled.get(name).exports
  const file = path.join(libRoot, `${name}.ts`)
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  })
  const mod = { exports: {} }
  compiled.set(name, mod)
  const localRequire = (request) => (request.startsWith('./') ? loadLib(request.slice(2)) : require(request))
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(mod.exports, localRequire, mod, file, libRoot)
  return mod.exports
}

const sourceText = fs.readFileSync(path.join(libRoot, 'portalTelegramToken.ts'), 'utf8').replace(/\r\n/g, '\n')
const lib = loadLib('portalTelegramToken')
const { PLAN_LIMITS_BY_TIER } = loadLib('planTier')
const TTL = PLAN_LIMITS_BY_TIER.paid.portalTelegramTokenTtlSeconds

const SECRET = 'portal-test-secret-that-is-at-least-32-chars'
const OLD_SECRET = 'previous-test-secret-that-is-at-least-32-chars'
const BOT_TOKEN = '123456:TEST'
const WEBHOOK_SECRET = 'webhook-test-secret-with-at-least-32-chars-ok'
const T0 = Date.UTC(2026, 10, 21, 8, 0, 0)
const baseEnv = () => ({ PORTAL_ABUSE_HMAC_SECRET: SECRET, PORTAL_TELEGRAM_BOT_TOKEN: BOT_TOKEN, PORTAL_TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET })

let passed = 0
const tests = []
function check(name, fn) { tests.push({ name, fn }) }

const b64 = (bytes) => Buffer.from(bytes).toString('base64url')
const unb64 = (text) => new Uint8Array(Buffer.from(text, 'base64url'))
const sha = (bytes) => new Uint8Array(crypto.createHash('sha256').update(bytes).digest())
const hex = (bytes) => Buffer.from(bytes).toString('hex')
const S = new Uint8Array(32).map((_, i) => i + 1)
const B16 = sha(S).slice(0, 16)

async function mint(env, overrides = {}, nowMs = T0) {
  return lib.mintStartToken(env, { locale: 1, termsAccepted: true, ageConfirmed: true, code: 99, binding: B16, ...overrides }, nowMs)
}

// ---------------------------------------------------------------- T-A1
check('T-A1 a token with every field at its maximum is 51 characters, its callback 53 bytes', async () => {
  const token = await mint(baseEnv())
  assert.equal(token.length, 51)
  assert.match(token, /^[A-Za-z0-9_-]{51}$/)
  const bytes = unb64(token)
  assert.equal(bytes.length, 38)
  assert.deepEqual([...bytes.slice(6, 22)], [...B16], 'b is the first 16 bytes of SHA-256(S)')
  const data = `c${token}2`
  assert.equal(Buffer.byteLength(data), 53)
  assert.deepEqual(lib.parseCallbackData(data), { token, choice: 2 })
  assert.deepEqual([...await lib.startBinding(S)], [...B16])
})

// ---------------------------------------------------------------- T-A2
check('T-A2 every single-byte change of the MAC or the body is refused', async () => {
  const env = baseEnv()
  const token = await mint(env)
  assert.ok(await lib.verifyStartToken(env, token, T0 + 1000), 'the untouched token verifies')
  const bytes = unb64(token)
  for (let i = 0; i < bytes.length; i++) {
    for (const mask of [0x01, 0x80]) {
      const copy = bytes.slice()
      copy[i] ^= mask
      assert.equal(await lib.verifyStartToken(env, b64(copy), T0 + 1000), null, `byte ${i} xor ${mask} must be refused`)
    }
  }
})

// ---------------------------------------------------------------- T-A3
check('T-A3 expiry: past refused, later than now + TTL + 5 refused', async () => {
  const env = baseEnv()
  const token = await mint(env)
  assert.ok(await lib.verifyStartToken(env, token, T0 + (TTL - 1) * 1000))
  assert.equal(await lib.verifyStartToken(env, token, T0 + TTL * 1000), null, 'now_s = expiry is expired')
  assert.equal(await lib.verifyStartToken(env, token, T0 + (TTL + 60) * 1000), null)
  const farFuture = await mint(env, {}, T0 + 30 * 1000)
  assert.equal(await lib.verifyStartToken(env, farFuture, T0), null, 'minted 30 s ahead of the verifier: expiry > now + TTL + 5')
  const slightLead = await mint(env, {}, T0 + 3 * 1000)
  assert.ok(await lib.verifyStartToken(env, slightLead, T0), 'a minting isolate leading by 3 s is allowed')
})

// ---------------------------------------------------------------- T-A4
check('T-A4 reserved bits, locale 6 or 7, code 9 or 100 are refused', async () => {
  const env = baseEnv()
  const keys = await lib.deriveTelegramKeys(SECRET, '123456')
  async function forge(flags) {
    const body = new Uint8Array(22)
    body[0] = flags >> 8
    body[1] = flags & 255
    new DataView(body.buffer).setUint32(2, Math.floor(T0 / 1000) + TTL)
    body.set(B16, 6)
    const mac = new Uint8Array(await crypto.webcrypto.subtle.sign('HMAC', keys.start, body)).slice(0, 16)
    const out = new Uint8Array(38)
    out.set(body)
    out.set(mac, 22)
    return b64(out)
  }
  const flags = (locale, code, reserved = 0) => locale | (1 << 3) | (1 << 4) | (code << 5) | (reserved << 12)
  assert.ok(await lib.verifyStartToken(env, await forge(flags(1, 50)), T0), 'the forging helper makes valid tokens')
  assert.equal(await lib.verifyStartToken(env, await forge(flags(1, 50, 1)), T0), null, 'reserved bit 12')
  assert.equal(await lib.verifyStartToken(env, await forge(flags(1, 50, 8)), T0), null, 'reserved bit 15')
  assert.equal(await lib.verifyStartToken(env, await forge(flags(6, 50)), T0), null, 'locale 6')
  assert.equal(await lib.verifyStartToken(env, await forge(flags(7, 50)), T0), null, 'locale 7')
  assert.equal(await lib.verifyStartToken(env, await forge(flags(1, 9)), T0), null, 'code 9')
  assert.equal(await lib.verifyStartToken(env, await forge(flags(1, 100)), T0), null, 'code 100')
  assert.ok(await lib.verifyStartToken(env, await forge(flags(1, 10)), T0), 'code 10')
  assert.ok(await lib.verifyStartToken(env, await forge(flags(1, 99)), T0), 'code 99')
  assert.equal(await lib.verifyStartToken(env, await forge(flags(2, 50)), T0), null, 'locales 2 to 5 stay refused until S4 lands')
  assert.equal(await lib.mintStartToken(env, { locale: 6, termsAccepted: true, ageConfirmed: true, code: 50, binding: B16 }, T0), null)
  assert.equal(await lib.mintStartToken(env, { locale: 1, termsAccepted: true, ageConfirmed: true, code: 9, binding: B16 }, T0), null)
})

// ---------------------------------------------------------------- T-A5
check('T-A5 HKDF is RFC 5869 and its keys never equal a portalAbuseKey output', async () => {
  const h = (s) => new Uint8Array(Buffer.from(s, 'hex'))
  const okm = await lib.hkdfSha256(h('0b'.repeat(22)), h('000102030405060708090a0b0c'), h('f0f1f2f3f4f5f6f7f8f9'), 42)
  assert.equal(hex(okm), '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865')
  const abuse = loadLib('portalAbuseKey')
  const env = { PORTAL_ABUSE_HMAC_SECRET: SECRET }
  const labels = ['portal-telegram-start-v1', 'portal-telegram-ticket-v1']
  const derived = new Set()
  for (const kind of ['start', 'ticket']) derived.add(hex(await lib.deriveTelegramKeyBytes(SECRET, '123456', kind)))
  assert.equal(derived.size, 2, 'the two keys differ')
  const seen = []
  for (const scope of [...labels, 'kdf']) {
    for (const value of ['123456', ...labels.map((l) => `${l}\u0000123456`)]) {
      const out = await abuse.portalAbuseKey(env, scope, value)
      if (out) seen.push(out.replace('hmac-v1:', ''))
    }
  }
  assert.ok(seen.length >= 9)
  for (const value of seen) assert.ok(!derived.has(value), 'a stored abuse key equals a derived key')
})

// ---------------------------------------------------------------- T-A6
check('T-A6 a token minted for bot A is refused under bot B', async () => {
  const tokenA = await mint({ ...baseEnv(), PORTAL_TELEGRAM_BOT_TOKEN: '111111:AAA' })
  assert.ok(await lib.verifyStartToken({ ...baseEnv(), PORTAL_TELEGRAM_BOT_TOKEN: '111111:AAA' }, tokenA, T0))
  assert.equal(await lib.verifyStartToken({ ...baseEnv(), PORTAL_TELEGRAM_BOT_TOKEN: '222222:BBB' }, tokenA, T0), null)
})

// ---------------------------------------------------------------- T-A7
check('T-A7 rotation: previous key accepted only inside ROTATED_AT + TTL', async () => {
  const oldEnv = { ...baseEnv(), PORTAL_ABUSE_HMAC_SECRET: OLD_SECRET }
  const token = await mint(oldEnv)
  const iso = (ms) => new Date(ms).toISOString()
  const rotated = (extra) => ({ ...baseEnv(), PORTAL_ABUSE_HMAC_SECRET_PREVIOUS: OLD_SECRET, PORTAL_ABUSE_HMAC_SECRET_ROTATED_AT: iso(T0 + 10_000), ...extra })
  const ok = await lib.verifyStartToken(rotated(), token, T0 + 20_000)
  assert.ok(ok, 'previous key accepted inside the window')
  assert.equal(ok.keySet, 'previous')
  assert.equal(await lib.verifyStartToken(baseEnv(), token, T0 + 20_000), null, 'refused without the previous variables')
  assert.equal(await lib.verifyStartToken(rotated({ PORTAL_ABUSE_HMAC_SECRET_ROTATED_AT: undefined }), token, T0 + 20_000), null, 'refused without ROTATED_AT')
  assert.equal(await lib.verifyStartToken(rotated({ PORTAL_ABUSE_HMAC_SECRET_PREVIOUS: undefined }), token, T0 + 20_000), null, 'refused without PREVIOUS')
  assert.equal(await lib.verifyStartToken(rotated(), token, T0 + (TTL + 11) * 1000), null, 'refused after ROTATED_AT + TTL')
  assert.equal(await lib.verifyStartToken(rotated({ PORTAL_ABUSE_HMAC_SECRET_ROTATED_AT: iso(T0 - 60_000) }), token, T0 + 20_000), null, 'token expiry later than ROTATED_AT + TTL')
  assert.equal(await lib.verifyStartToken(rotated({ PORTAL_ABUSE_HMAC_SECRET_ROTATED_AT: iso(T0 + 86_400_000) }), token, T0 + 20_000), null, 'ROTATED_AT one day ahead')
  assert.equal(await lib.verifyStartToken(rotated({ PORTAL_ABUSE_HMAC_SECRET_ROTATED_AT: 'yesterday' }), token, T0 + 20_000), null, 'ROTATED_AT unparsable')
  assert.equal(await lib.verifyStartToken(rotated({ PORTAL_ABUSE_HMAC_SECRET_ROTATED_AT: '2026-02-30T00:00:00Z' }), token, T0 + 20_000), null, 'ROTATED_AT not a real date')
  assert.equal(await lib.verifyStartToken(rotated({ PORTAL_ABUSE_HMAC_SECRET_PREVIOUS: SECRET }), token, T0 + 20_000), null, 'PREVIOUS equal to the current secret')
  const short = 'short-previous-secret-31-char-x'
  assert.equal(short.length, 31)
  const shortKey = Buffer.from(await lib.deriveTelegramKeyBytes(short, '123456', 'start'))
  const body = Buffer.alloc(22)
  body.writeUInt16BE(1 | (1 << 3) | (1 << 4) | (50 << 5), 0)
  body.writeUInt32BE(Math.floor(T0 / 1000) + TTL, 2)
  Buffer.from(B16).copy(body, 6)
  const shortToken = b64(Buffer.concat([body, crypto.createHmac('sha256', shortKey).update(body).digest().subarray(0, 16)]))
  assert.equal(await lib.verifyStartToken(rotated({ PORTAL_ABUSE_HMAC_SECRET_PREVIOUS: short }), shortToken, T0 + 20_000), null, 'PREVIOUS under 32 characters')
  assert.ok(await lib.verifyStartToken(rotated({ PORTAL_ABUSE_HMAC_SECRET_PREVIOUS: short + 'xx' }), shortToken, T0 + 20_000) === null, 'a different 32-character secret does not verify it')
  const fresh = await mint(baseEnv())
  assert.equal((await lib.verifyStartToken(rotated(), fresh, T0 + 20_000)).keySet, 'current', 'new tokens verify under the current keys')
})

// ---------------------------------------------------------------- T-A8
check('T-A8 the ticket is 68 characters and can never equal hashToken of anything', async () => {
  const env = baseEnv()
  const token = await mint(env)
  const verified = await lib.verifyStartToken(env, token, T0)
  const ticket = await lib.ticketValue(env, verified)
  assert.equal(ticket.length, 68)
  assert.ok(lib.isTicketValue(ticket))
  assert.ok(ticket.startsWith('tg1:'))
  assert.equal(await lib.ticketValue(env, verified), ticket, 'deterministic')
  const hashToken = (x) => hex(sha(Buffer.from(x)))
  const keys = await lib.deriveTelegramKeyBytes(SECRET, '123456', 'ticket')
  const macHex = ticket.slice(4)
  const candidates = [token, b64(unb64(token)), macHex, b64(Buffer.from(macHex, 'hex')), ticket, b64(S), hex(S), hex(keys)]
  for (const x of candidates) assert.notEqual(ticket, hashToken(x))
  for (let i = 0; i < 10_000; i++) assert.ok(!lib.isTicketValue(hashToken(crypto.randomBytes(8 + (i % 40)).toString('base64url'))))
  assert.ok(!lib.isTicketValue(ticket + '0'))
  assert.ok(!lib.isTicketValue('tg1:' + macHex.toUpperCase()))
  assert.ok(!lib.isTicketValue(macHex))
  const prev = await lib.verifyStartToken({ ...baseEnv(), PORTAL_ABUSE_HMAC_SECRET: OLD_SECRET }, await mint({ ...baseEnv(), PORTAL_ABUSE_HMAC_SECRET: OLD_SECRET }), T0)
  assert.ok(lib.isTicketValue(await lib.ticketValue({ ...baseEnv(), PORTAL_ABUSE_HMAC_SECRET: OLD_SECRET }, prev)))
})

// ---------------------------------------------------------------- T-A9
check('T-A9 contacts: only a Telegram-verified own number with a real phone is accepted', async () => {
  const ok = (phone, fromId = 5000, userId = 5000) => lib.contactVerdict(fromId, { userId, phoneNumber: phone })
  assert.deepEqual(ok('85588123456'), { ok: true, phone: '088123456', firstName: null, lastName: null }, 'a Cambodian 088 number is not anonymous')
  assert.deepEqual(ok('+855 12 345 678'), { ok: true, phone: '012345678', firstName: null, lastName: null })
  assert.deepEqual(ok('+855 88 812 3456'), { ok: true, phone: '0888123456', firstName: null, lastName: null }, 'a Cambodian 088 8xx number contains 888 and is accepted')
  assert.deepEqual(ok('+888 0123 4567'), { ok: false, reply: 'R-ANON' })
  assert.deepEqual(ok('88812345678'), { ok: false, reply: 'R-ANON' })
  assert.deepEqual(ok('00888 1234 5678'), { ok: false, reply: 'R-ANON' }, 'the 00 international prefix of +888')
  assert.deepEqual(ok('0085512345678'), { ok: true, phone: '012345678', firstName: null, lastName: null }, 'the 00 prefix of a Cambodian number')
  const named = (first, last) => lib.contactVerdict(5000, { userId: 5000, phoneNumber: '012345678', firstName: first, lastName: last })
  assert.deepEqual(named('  Sok ', 'Dara'), { ok: true, phone: '012345678', firstName: 'Sok', lastName: 'Dara' }, 'names carried and trimmed')
  assert.deepEqual(named(undefined, '   '), { ok: true, phone: '012345678', firstName: null, lastName: null }, 'missing or blank names are null')
  assert.deepEqual(named(7, null), { ok: true, phone: '012345678', firstName: null, lastName: null }, 'non-strings are null')
  assert.equal(named('a'.repeat(100), 'b'.repeat(64)).firstName, 'a'.repeat(64), 'an over-long name is cut to 64')
  assert.equal(named('a'.repeat(100), 'b'.repeat(64)).lastName, 'b'.repeat(64))
  assert.equal(named('a'.repeat(63) + ' z', 'x').firstName, 'a'.repeat(63), 'a cut never leaves a trailing space')
  assert.deepEqual(ok('+855 12 345 678', 5000, 5001), { ok: false, reply: 'R-OWN-NUMBER' }, 'forwarded contact')
  assert.deepEqual(lib.contactVerdict(5000, { userId: undefined, phoneNumber: '012345678' }), { ok: false, reply: 'R-OWN-NUMBER' }, 'missing user_id')
  assert.deepEqual(ok('012345678', 2 ** 53, 2 ** 53), { ok: false, reply: 'R-OWN-NUMBER' }, 'unsafe id')
  assert.deepEqual(ok(12345678), { ok: false, reply: 'R-PHONE-BAD' }, 'phone not a string')
  assert.deepEqual(ok('0123abc'), { ok: false, reply: 'R-PHONE-BAD' })
  assert.deepEqual(ok('1'.repeat(33)), { ok: false, reply: 'R-PHONE-BAD' })
  assert.deepEqual(ok('+ - ()'), { ok: false, reply: 'R-PHONE-BAD' }, 'no digits')
  const update = (message) => lib.classifyUpdate({ update_id: 1, message })
  const base = { chat: { id: 5000, type: 'private' }, from: { id: 5000, is_bot: false } }
  assert.equal(update({ ...base, contact: { user_id: 5000, phone_number: '012345678' } }).kind, 'contact')
  const withNames = update({ ...base, from: { id: 5000, is_bot: false, first_name: 'Sok', last_name: 7 }, contact: { user_id: 5000, phone_number: '012345678' } })
  assert.equal(withNames.contact.firstName, 'Sok', 'the sender first name rides on the contact variant')
  assert.equal(withNames.contact.lastName, null, 'a non-string last name is null')
  assert.deepEqual(lib.contactVerdict(withNames.fromId, withNames.contact), { ok: true, phone: '012345678', firstName: 'Sok', lastName: null })
  assert.equal(update({ ...base, from: { id: 5000, is_bot: true }, contact: { user_id: 5000, phone_number: '012345678' } }).kind, 'ignore', 'bot')
  assert.equal(update({ ...base, chat: { id: 5000, type: 'group' }, contact: { user_id: 5000, phone_number: '012345678' } }).kind, 'ignore', 'group')
})

// ---------------------------------------------------------------- T-A2b decodeStartFlags
check('T-A2b decodeStartFlags round-trips every flag and refuses reserved bits', async () => {
  const env = baseEnv()
  for (const locale of [0, 1]) for (const terms of [false, true]) for (const age of [false, true]) for (const code of [10, 37, 99]) {
    const verified = await lib.verifyStartToken(env, await mint(env, { locale, termsAccepted: terms, ageConfirmed: age, code }), T0)
    const decoded = lib.decodeStartFlags(verified.flags)
    assert.deepEqual(decoded, { localeIndex: locale, locale: ['en', 'km'][locale], termsAccepted: terms, ageConfirmed: age, code })
  }
  const base = 1 | (1 << 3) | (50 << 5)
  assert.deepEqual(lib.decodeStartFlags(base), { localeIndex: 1, locale: 'km', termsAccepted: true, ageConfirmed: false, code: 50 })
  assert.equal(lib.decodeStartFlags(base | (1 << 4)).ageConfirmed, true)
  assert.equal(lib.decodeStartFlags(base & ~(1 << 3)).termsAccepted, false)
  assert.equal(lib.decodeStartFlags(2).locale, null, 'a locale index with no language is null, not a crash')
  for (const bit of [12, 13, 14, 15]) assert.equal(lib.decodeStartFlags(base | (1 << bit)), null, 'reserved bit ' + bit)
  for (const bad of [-1, 65536, 1.5, NaN, '1']) assert.equal(lib.decodeStartFlags(bad), null, String(bad))
})

// ---------------------------------------------------------------- T-A2c isUsableSecret
check('T-A2c isUsableSecret: 31 characters refused, 32 accepted', async () => {
  assert.equal(lib.isUsableSecret('x'.repeat(31)), false)
  assert.equal(lib.isUsableSecret('x'.repeat(32)), true)
  assert.equal(lib.isUsableSecret('x'.repeat(200)), true)
  for (const bad of [undefined, null, 5, '', {}]) assert.equal(lib.isUsableSecret(bad), false)
  assert.equal(await mint({ ...baseEnv(), PORTAL_ABUSE_HMAC_SECRET: 'x'.repeat(31) }), null, 'the mint uses the same rule')
  assert.ok(await mint({ ...baseEnv(), PORTAL_ABUSE_HMAC_SECRET: 'x'.repeat(32) }), 'the mint accepts 32')
})

// ---------------------------------------------------------------- T-A3b exact limits
check('T-A3b the 5 s clock lead and the 60 s ROTATED_AT lead are exact', async () => {
  const env = baseEnv()
  assert.ok(await lib.verifyStartToken(env, await mint(env, {}, T0 + 5000), T0), 'expiry = now + TTL + 5 is accepted')
  assert.equal(await lib.verifyStartToken(env, await mint(env, {}, T0 + 6000), T0), null, 'expiry = now + TTL + 6 is refused')
  const oldEnv = { ...baseEnv(), PORTAL_ABUSE_HMAC_SECRET: OLD_SECRET }
  const token = await mint(oldEnv)
  const now = T0 + 20_000
  const rotatedAt = (ms) => ({ ...baseEnv(), PORTAL_ABUSE_HMAC_SECRET_PREVIOUS: OLD_SECRET, PORTAL_ABUSE_HMAC_SECRET_ROTATED_AT: new Date(ms).toISOString() })
  assert.ok(await lib.verifyStartToken(rotatedAt(now + 60_000), token, now), 'ROTATED_AT exactly 60 s ahead is accepted')
  assert.equal(await lib.verifyStartToken(rotatedAt(now + 60_001), token, now), null, 'ROTATED_AT 60.001 s ahead is refused')
  assert.equal(await lib.verifyStartToken(rotatedAt(now + 61_000), token, now), null, 'ROTATED_AT 61 s ahead is refused')
})

// ---------------------------------------------------------------- T-A12b constant time, behaviourally
check('T-A12b sameBytes reads every byte whatever differs; secretsEqual hashes both sides on every path', async () => {
  const counted = (bytes) => {
    const box = { reads: 0 }
    const proxy = new Proxy(bytes, { get(target, prop) { if (typeof prop === 'string' && /^[0-9]+$/.test(prop)) box.reads++; return Reflect.get(target, prop) } })
    return { proxy, box }
  }
  const make = (n, fill) => new Uint8Array(n).fill(fill)
  const cases = []
  for (const n of [0, 1, 16, 1000]) {
    const base = make(n, 7)
    cases.push([base, make(n, 7), true, 'equal'])
    if (n > 0) {
      const first = make(n, 7); first[0] = 8
      const last = make(n, 7); last[n - 1] = 8
      cases.push([base, first, false, 'first byte'], [base, last, false, 'last byte'])
    }
    cases.push([base, make(n + 1, 7), false, 'right longer'], [make(n + 1, 7), base, false, 'left longer'], [base, make(n + 5, 0), false, 'longer zeros'])
  }
  for (const [a, b, expected, label] of cases) {
    const left = counted(a)
    const right = counted(b)
    assert.equal(lib.sameBytes(left.proxy, right.proxy), expected, label + ' result')
    assert.equal(left.box.reads + right.box.reads, 2 * Math.max(a.length, b.length), label + ' reads every position of the longer input on both sides')
  }
  const subtle = globalThis.crypto.subtle
  const original = subtle.digest
  let digests = 0
  subtle.digest = function (...args) { digests++; return original.apply(this, args) }
  try {
    const pairs = [['abc', 'abc', true], ['abc', 'xbc', false], ['abc', 'abx', false], ['abc', 'abcd', false], ['abc', '', false], ['', 'abc', false], ['', '', true], ['a'.repeat(5000), 'a', false]]
    for (const [expected, supplied, want] of pairs) {
      digests = 0
      assert.equal(await lib.secretsEqual(expected, supplied), want, expected.slice(0, 5) + ' vs ' + supplied.slice(0, 5))
      assert.equal(digests, 2, 'both inputs are hashed before any answer: ' + expected.slice(0, 5) + ' vs ' + supplied.slice(0, 5))
    }
  } finally {
    subtle.digest = original
  }
})

// ---------------------------------------------------------------- T-A10
check('T-A10 updates and callbacks follow the sender and callback rules', async () => {
  const token = await mint(baseEnv())
  const priv = (id = 7000) => ({ chat: { id, type: 'private' }, from: { id, is_bot: false, language_code: 'km' } })
  const msg = (extra, update = {}) => lib.classifyUpdate({ update_id: 1, message: { ...priv(), ...extra }, ...update })
  assert.deepEqual(msg({ text: `/start ${token}` }), { kind: 'start', fromId: 7000, token, languageCode: 'km' })
  assert.equal(msg({ text: '/start' }).kind, 'help', 'a bare /start')
  assert.equal(msg({ text: `/start ${token}x` }).kind, 'help', 'a payload of another length')
  assert.equal(msg({ text: 'hello' }).kind, 'help')
  assert.equal(msg({ sticker: {} }).kind, 'help')
  assert.equal(lib.classifyUpdate({ update_id: 1.5, message: { ...priv(), text: 'x' } }).kind, 'ignore')
  assert.equal(lib.classifyUpdate({ update_id: 1, message: { ...priv(), text: 'x' }, callback_query: {} }).kind, 'ignore', 'both message and callback_query')
  assert.equal(lib.classifyUpdate({ update_id: 1 }).kind, 'ignore', 'neither')
  assert.equal(lib.classifyUpdate({ update_id: 1, edited_message: priv() }).kind, 'ignore')
  assert.equal(lib.classifyUpdate(null).kind, 'ignore')
  assert.equal(lib.classifyUpdate([]).kind, 'ignore')
  assert.equal(lib.classifyUpdate({ update_id: 1, message: { chat: { id: 8000, type: 'private' }, from: { id: 7000, is_bot: false }, text: 'x' } }).kind, 'ignore', 'chat.id differs from from.id')
  assert.equal(msg({ chat: { id: 7000, type: 'supergroup' }, text: 'x' }).kind, 'ignore', 'group')
  assert.equal(msg({ from: { id: 7000, is_bot: true }, text: 'x' }).kind, 'ignore', 'bot')
  assert.equal(lib.classifyUpdate({ update_id: 1, message: { ...priv(2 ** 52), text: 'x' } }).kind, 'ignore', 'id above 52 bits')
  assert.equal(lib.classifyUpdate({ update_id: 1, message: { ...priv(0), text: 'x' } }).kind, 'ignore', 'id 0')
  assert.equal(lib.classifyUpdate({ update_id: 1, message: { ...priv(2 ** 52 - 1), text: 'x' } }).kind, 'help', 'largest id')

  const cbBase = () => ({ id: 'cb1', from: { id: 7000, is_bot: false, language_code: 'en' }, message: { chat: { id: 7000, type: 'private' } }, data: `c${token}1` })
  const cb = (change) => lib.classifyUpdate({ update_id: 2, callback_query: { ...cbBase(), ...change } })
  assert.deepEqual(cb({}), { kind: 'callback', callbackId: 'cb1', fromId: 7000, token, choice: 1, languageCode: 'en' })
  const stale = { kind: 'stale', callbackId: 'cb1' }
  assert.deepEqual(cb({ inline_message_id: 'x' }), stale, 'inline_message_id')
  assert.deepEqual(cb({ message: undefined }), stale, 'missing message')
  assert.deepEqual(cb({ message: { chat: { id: 9, type: 'private' } } }), stale, 'chat.id differs from from.id')
  assert.deepEqual(cb({ message: { chat: { id: 7000, type: 'group' } } }), stale, 'group')
  assert.deepEqual(cb({ from: { id: 7000, is_bot: true } }), stale, 'bot')
  assert.deepEqual(cb({ data: `c${token.slice(0, 50)}1` }), stale, '52-byte data')
  assert.deepEqual(cb({ data: `c${token}1x` }), stale, '54-byte data')
  assert.deepEqual(cb({ data: `c${token}3` }), stale, 'choice 3')
  assert.deepEqual(cb({ data: `x${token}1` }), stale, 'wrong prefix')
  assert.deepEqual(cb({ data: undefined }), stale, 'no data')
  assert.equal(cb({ id: '' }).kind, 'ignore', 'empty callback id')
  assert.equal(cb({ id: 'x'.repeat(65) }).kind, 'ignore', 'callback id over 64')
  assert.equal(cb({ id: 5 }).kind, 'ignore', 'callback id not a string')
  assert.equal(lib.parseCallbackData(`c${token}0`).choice, 0)
  assert.equal(lib.parseCallbackData(`c${token}3`), null)
  assert.equal(lib.parseCallbackData(5), null)
})

// ---------------------------------------------------------------- T-A11
check('T-A11 webhook ranges: defaults, strict parsing, fail closed, edge addresses', async () => {
  const inDefault = (ip) => lib.ipv4InRanges(ip, lib.parseWebhookCidrs(undefined))
  assert.equal(lib.DEFAULT_WEBHOOK_CIDRS, '149.154.160.0/20,91.108.4.0/22')
  for (const unset of [undefined, null, '', '   ']) assert.ok(lib.parseWebhookCidrs(unset), 'unset or empty uses the default')
  for (const ip of ['149.154.160.0', '149.154.175.255', '91.108.4.0', '91.108.7.255']) assert.ok(inDefault(ip), ip)
  for (const ip of ['149.154.159.255', '149.154.176.0', '91.108.3.255', '91.108.8.0', '0.0.0.0', '255.255.255.255', '127.0.0.1']) assert.ok(!inDefault(ip), ip)
  for (const bad of ['0.0.0.0/0', '10.0.0.0/15', '10.0.0.1/24', '010.0.0.0/16', '10.0.0.0/016', '10.0.0.0', '10.0.0.0/33', '256.0.0.0/16', '10.0.0/16', '::1/16', '10.0.0.0/16,', 'x', '10.0.0.0/16;10.1.0.0/16'])
    assert.equal(lib.parseWebhookCidrs(bad), null, `invalid: ${bad}`)
  const seventeen = Array.from({ length: 17 }, (_, i) => `10.${i}.0.0/24`).join(',')
  assert.equal(lib.parseWebhookCidrs(seventeen), null, '17 entries')
  assert.ok(lib.parseWebhookCidrs(seventeen.split(',').slice(0, 16).join(',')), '16 entries of /24')
  assert.equal(lib.parseWebhookCidrs('10.0.0.0/16,10.1.0.0/16'), null, 'two /16 = 131,072 addresses')
  assert.ok(lib.parseWebhookCidrs('10.0.0.0/16'), 'one /16 alone is valid')
  assert.ok(lib.parseWebhookCidrs(' 10.0.0.0/16 '), 'whitespace around an entry is trimmed')
  assert.ok(!lib.ipv4InRanges('::1', lib.parseWebhookCidrs(undefined)))
  assert.ok(!lib.ipv4InRanges('::ffff:149.154.160.1', lib.parseWebhookCidrs(undefined)))
  assert.ok(!lib.ipv4InRanges('149.154.160.01', lib.parseWebhookCidrs(undefined)), 'a leading zero')
  assert.ok(!lib.ipv4InRanges(undefined, lib.parseWebhookCidrs(undefined)))
  const requestWith = (headers) => ({ get: (name) => headers[name.toLowerCase()] ?? null })
  const env = baseEnv()
  const good = { 'cf-connecting-ip': '149.154.160.9', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }
  assert.deepEqual(await lib.isAuthenticWebhookRequest(env, 'POST', requestWith({ ...good, 'x-forwarded-for': '1.2.3.4' })), { ok: true }, 'X-Forwarded-For is ignored')
  assert.deepEqual(await lib.isAuthenticWebhookRequest(env, 'POST', requestWith({ ...good, 'cf-connecting-ip': undefined, 'x-forwarded-for': '149.154.160.9' })), { ok: false, status: 401 })
})

// ---------------------------------------------------------------- T-A12
check('T-A12 isAuthenticWebhookRequest: method, address, secret; constant-time compare', async () => {
  const headers = (h) => ({ get: (name) => h[name.toLowerCase()] ?? null })
  const good = { 'cf-connecting-ip': '91.108.5.5', 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET }
  const env = baseEnv()
  const run = (e, method, h) => lib.isAuthenticWebhookRequest(e, method, headers(h))
  assert.deepEqual(await run(env, 'POST', good), { ok: true })
  assert.deepEqual(await run(env, 'GET', good), { ok: false, status: 405 })
  assert.deepEqual(await run(env, 'POST', { ...good, 'cf-connecting-ip': '8.8.8.8' }), { ok: false, status: 401 }, 'wrong address')
  assert.deepEqual(await run(env, 'POST', { 'cf-connecting-ip': good['cf-connecting-ip'] }), { ok: false, status: 401 }, 'missing header')
  assert.deepEqual(await run(env, 'POST', { ...good, 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET + 'x' }), { ok: false, status: 401 }, 'wrong secret')
  assert.deepEqual(await run(env, 'POST', { ...good, 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET.slice(0, -1) }), { ok: false, status: 401 }, 'a prefix of the secret')
  assert.deepEqual(await run({ ...env, PORTAL_TELEGRAM_WEBHOOK_SECRET: undefined }, 'POST', { ...good, 'x-telegram-bot-api-secret-token': '' }), { ok: false, status: 401 }, 'no secret configured and none supplied')
  const tokenA = 'a'.repeat(8) + ':' + 'B'.repeat(40)
  const asSecret = (value) => ({ ...env, PORTAL_TELEGRAM_BOT_TOKEN: tokenA, PORTAL_TELEGRAM_WEBHOOK_SECRET: value })
  for (const value of [hex(sha(Buffer.from(tokenA)))]) {
    const e = { ...asSecret(value), TELEGRAM_BOT_TOKEN: tokenA }
    assert.deepEqual(await run(e, 'POST', { ...good, 'x-telegram-bot-api-secret-token': value }), { ok: false, status: 401 })
  }
  const hexSecret = hex(sha(Buffer.from(BOT_TOKEN)))
  assert.deepEqual(await run({ ...env, PORTAL_TELEGRAM_WEBHOOK_SECRET: hexSecret }, 'POST', { ...good, 'x-telegram-bot-api-secret-token': hexSecret }), { ok: false, status: 401 }, 'secret equal to the sha256 hex of the bot token')
  const longBot = 'q'.repeat(40)
  assert.deepEqual(await run({ ...env, PORTAL_TELEGRAM_BOT_TOKEN: '123456:' + longBot, PORTAL_TELEGRAM_WEBHOOK_SECRET: '123456:' + longBot }, 'POST', { ...good, 'x-telegram-bot-api-secret-token': '123456:' + longBot }), { ok: false, status: 401 }, 'secret equal to the bot token (also fails the alphabet)')
  const sameAlphabet = 'Z'.repeat(40)
  assert.deepEqual(await run({ ...env, TELEGRAM_BOT_TOKEN: sameAlphabet, PORTAL_TELEGRAM_WEBHOOK_SECRET: sameAlphabet }, 'POST', { ...good, 'x-telegram-bot-api-secret-token': sameAlphabet }), { ok: false, status: 401 }, 'secret equal to TELEGRAM_BOT_TOKEN')
  assert.deepEqual(await run({ ...env, PORTAL_TELEGRAM_WEBHOOK_SECRET: 'short' }, 'POST', { ...good, 'x-telegram-bot-api-secret-token': 'short' }), { ok: false, status: 401 }, 'too short')
  assert.deepEqual(await run({ ...env, PORTAL_TELEGRAM_WEBHOOK_CIDRS: '0.0.0.0/0' }, 'POST', good), { ok: false, status: 401 }, 'an invalid range list fails closed')
  assert.deepEqual(await run({ ...env, PORTAL_TELEGRAM_WEBHOOK_CIDRS: '8.8.8.0/24' }, 'POST', { ...good, 'cf-connecting-ip': '8.8.8.8' }), { ok: true }, 'an owner range replaces the default')
  assert.equal(await lib.webhookSecretConfigured(env), true)
  assert.equal(await lib.webhookSecretConfigured({ ...env, PORTAL_TELEGRAM_WEBHOOK_SECRET: hexSecret }), false)

  assert.equal(lib.sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true)
  assert.equal(lib.sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false)
  assert.equal(lib.sameBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2])), false)
  assert.equal(lib.sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 0])), false, 'a zero-padded prefix')
  assert.equal(lib.sameBytes(new Uint8Array(0), new Uint8Array(0)), true)
  assert.equal(await lib.secretsEqual('abc', 'abc'), true)
  assert.equal(await lib.secretsEqual('abc', 'abcd'), false)
  assert.equal(await lib.secretsEqual('', ''), true)
  const sameBytesSource = /export function sameBytes[\s\S]*?\n}\n/.exec(sourceText)[0]
  assert.ok(!/\.length\s*!==|\.length\s*!=\b/.test(sameBytesSource), 'sameBytes must not return early on a length difference')
  const secretsEqualSource = /export async function secretsEqual[\s\S]*?\n}\n/.exec(sourceText)[0]
  assert.equal((secretsEqualSource.match(/sha256Bytes\(/g) || []).length, 2, 'both sides are hashed before comparing')
  assert.ok(!/\.length\s*!==|\.length\s*!=\b/.test(secretsEqualSource), 'secretsEqual must not return early on a length difference')
})

// ---------------------------------------------------------------- T-A13
check('T-A13 matchOptions: three distinct labels in 10 to 99, the code once, only the right choice accepted', async () => {
  for (let code = 10; code <= 99; code++) {
    for (let mac0 = 0; mac0 < 6; mac0++) {
      const opts = lib.matchOptions(code, mac0)
      assert.equal(opts.length, 3)
      assert.equal(new Set(opts).size, 3, `distinct for ${code}/${mac0}`)
      for (const o of opts) assert.ok(Number.isInteger(o) && o >= 10 && o <= 99)
      assert.equal(opts.filter((o) => o === code).length, 1)
      const right = opts.indexOf(code)
      for (const choice of [0, 1, 2]) assert.equal(lib.isCorrectChoice(code, mac0, choice), choice === right)
      assert.equal(lib.isCorrectChoice(code, mac0, 3), false)
      assert.equal(lib.isCorrectChoice(code, mac0, -1), false)
    }
  }
  assert.deepEqual(lib.matchOptions(10, 0), [10, 41, 72])
  assert.deepEqual(lib.matchOptions(50, 1), [81, 22, 50])
  assert.deepEqual(lib.matchOptions(50, 2), [22, 50, 81])
})

// ---------------------------------------------------------------- helpers (section 1.3, 2.4, 2.6)
check('pollScheduleMs: the five delays are positive, strictly increasing and end inside the poll window', async () => {
  for (const tier of ['paid', 'free']) {
    const limits = PLAN_LIMITS_BY_TIER[tier]
    const delays = lib.pollScheduleMs(limits)
    assert.deepEqual([...delays], [2000, 3000, 5000, 8000, 10000])
    assert.ok(delays.every((d) => d > 0))
    for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1], 'strictly increasing')
    assert.ok(delays[delays.length - 1] <= limits.portalTelegramPollWindowMs)
  }
})

check('portalNowIso and secondsAgoModifier follow section 1.3', async () => {
  const iso = lib.portalNowIso(T0)
  assert.equal(iso, '2026-11-21T08:00:00.000Z')
  assert.equal(iso.length, 24)
  assert.match(lib.portalNowIso(), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  assert.equal(lib.secondsAgoModifier(3600), '-3600 seconds')
  assert.equal(lib.secondsAgoModifier(1), '-1 seconds')
  for (const bad of [0, -1, 1.5, NaN, Infinity]) assert.throws(() => lib.secondsAgoModifier(bad), `n = ${bad}`)
  assert.deepEqual([...lib.PORTAL_TELEGRAM_LOCALES.slice(0, 2)], ['en', 'km'])
  assert.equal(lib.botIdFromToken('123456:TEST'), '123456')
  for (const bad of ['', 'abc:def', '0123456:x', '1234:x', '12345678901234567:x', '123456', undefined, 5]) assert.equal(lib.botIdFromToken(bad), null, String(bad))
  assert.equal(lib.botIdFromToken('12345:x'), '12345')
  const cookie = b64(S)
  assert.equal(cookie.length, 43)
  assert.deepEqual([...lib.parseCookieS(cookie)], [...S])
  for (const bad of [undefined, '', cookie.slice(1), cookie + 'A', cookie.slice(0, 42) + '+', cookie.slice(0, 42) + 'B']) assert.equal(lib.parseCookieS(bad), null, String(bad))
  const env = baseEnv()
  const verified = await lib.verifyStartToken(env, await mint(env), T0)
  assert.equal(verified.startedAtSeconds, Math.floor(T0 / 1000))
  assert.equal(verified.code, 99)
  assert.equal(verified.locale, 'km')
  assert.equal(verified.termsAccepted && verified.ageConfirmed, true)
  assert.equal(await lib.cookieMatchesBinding(verified, S), true)
  assert.equal(await lib.cookieMatchesBinding(verified, new Uint8Array(32)), false)
  for (const bad of [undefined, 5, 'x', 'x'.repeat(50), '']) assert.equal(await lib.verifyStartToken(env, bad, T0), null)
  assert.equal(await lib.verifyStartToken({ ...env, PORTAL_ABUSE_HMAC_SECRET: 'short' }, await mint(env), T0), null)
  assert.equal(await lib.verifyStartToken({ ...env, PORTAL_TELEGRAM_BOT_TOKEN: 'nonsense' }, await mint(env), T0), null)
  assert.equal(await mint({ ...env, PORTAL_ABUSE_HMAC_SECRET: 'short' }), null)
  assert.equal(await mint({ ...env, PORTAL_TELEGRAM_BOT_TOKEN: undefined }), null)
  assert.equal(await mint(env, { binding: new Uint8Array(15) }), null)
  const km = await lib.verifyStartToken(env, await mint(env, { locale: 0, termsAccepted: false, ageConfirmed: true, code: 10 }), T0)
  assert.deepEqual([km.locale, km.termsAccepted, km.ageConfirmed, km.code], ['en', false, true, 10])
})

check('the library imports nothing that touches D1 or the network, and holds no shop, host or bot literal', async () => {
  assert.ok(!/getDb|fetch\(|c\.env\.DB|\.prepare\(|api\.telegram\.org|t\.me\//.test(sourceText))
  assert.deepEqual([...sourceText.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]).sort(), ['../index', './phone', './planTier'])
})

async function main() {
  for (const { name, fn } of tests) {
    try {
      await fn()
      passed++
      console.log(`PASS ${name}`)
    } catch (error) {
      console.log(`FAIL ${name} - ${error.message.split('\n')[0]}`)
      console.error(error)
      process.exitCode = 1
    }
  }
  console.log(`\n${passed} check(s) passed.`)
  if (process.exitCode) console.log('SOME CHECKS FAILED')
}
main()
