// Regression test for the storefront customer-account system (§2), as changed
// by G38 Phase 1 (website members are separate from in-store customers):
// lib/phone.ts, lib/portalAccounts.ts, lib/portalAuthLockout.ts -- the REAL
// source, transpiled and run against an in-memory SQLite with every real
// migration (0087 ... 0230/0231) applied. No logic is reimplemented here.
//
// What changed in G38 and is pinned here:
//   - sign-up never reads or writes `customers`, and never links one: a
//     membershipId in the body is ignored (the claim path is gone);
//   - a new member gets a random W-XXXX-XXXX code (lib/memberCode.ts), never
//     an LC-##### number; a code collision re-mints, bounded;
//   - an account from before G38 keeps signing in by name, by its old LC id or
//     by its W- code (minted lazily), and a linked member also by the store
//     number of its customer;
//   - a suspended member is told so only after a correct password.
//
// Run (from cloudflare/): node scripts/test-portal-accounts-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { loadRealPasswordHash } = require('./harness/password_hash_stub.cjs')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const portalAccountSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'portalAccounts.ts'), 'utf8')

function transpile(relPath) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
  return outputText
}

function loadReal(relPath, requireOverrides = {}) {
  const outputText = transpile(relPath)
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in requireOverrides) return requireOverrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
    return moduleObj.exports
  } finally {
    Module._load = originalLoad
  }
}

const phone = loadReal('lib/phone.ts')
const passwordPolicy = loadReal('lib/passwordPolicy.ts')
const anonymousCustomer = loadReal('lib/anonymousCustomer.ts')
const memberCode = loadReal('lib/memberCode.ts')
const { canonicalizePhone } = phone

// The harness D1Compat's .run() returns the RAW D1 shape ({ meta: { last_row_id
// }}); the real lib/db.ts D1Compat flattens that to { changes, lastInsertRowid
// }. Wrap the harness db in that same flattening, Promise-returning like the
// real async D1Compat, and count INSERT attempts into portal_accounts.
function makePortal(memberCodeModule = memberCode) {
  const rawDb = openDb(loadAll())
  let insertAttempts = 0
  const db = {
    prepare(sql) {
      const stmt = rawDb.prepare(sql)
      const isInsert = /INSERT INTO portal_accounts/i.test(sql)
      return {
        get: async (p) => stmt.get(p),
        all: async (p) => stmt.all(p) || [],
        run: async (p) => {
          if (isInsert) insertAttempts += 1
          const r = stmt.run(p)
          return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (items) => rawDb.batch(items),
  }
  const dbModule = { getDb: () => db }
  const accounts = loadReal('lib/portalAccounts.ts', {
    './db': dbModule,
    './phone': phone,
    './passwordPolicy': passwordPolicy,
    './anonymousCustomer': anonymousCustomer,
    './passwordHash': loadRealPasswordHash(),
    './memberCode': memberCodeModule,
  })
  const lockout = loadReal('lib/portalAuthLockout.ts', { './db': dbModule })
  return { rawDb, db, accounts, lockout, getInsertAttempts: () => insertAttempts }
}

const main = makePortal()
const { rawDb } = main
const { signupPortalAccount, signinPortalAccount, ensurePortalMemberCode, loadPortalMemberView, portalMemberView, PORTAL_MEMBER_VIEW_KEYS, PORTAL_CONSENT_VERSION } = main.accounts
const { getPortalLockoutState, recordPortalFailure, clearPortalLockout } = main.lockout

const env = {}
let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

function seedCustomer(db, fields) {
  const r = db.prepare(
    'INSERT INTO customers (name, phone, phone_normalized, address, membership_number, is_anonymous) VALUES (@name, @phone, @phone_normalized, @address, @membership_number, @is_anonymous)',
  ).run({
    name: fields.name,
    phone: fields.phone ?? null,
    phone_normalized: fields.phone_normalized ?? null,
    address: fields.address ?? null,
    membership_number: fields.membership_number ?? null,
    is_anonymous: fields.is_anonymous ?? 0,
  })
  return Number(r.meta.last_row_id)
}

// An account exactly as the pre-G38 sign-up left it: an LC id, a linked
// customer, no W- code. The hash is real so sign-in can verify it.
async function seedLegacyAccount(db, { name, phoneNumber, membershipId, contactId, password = 'secret123' }) {
  const hash = await loadRealPasswordHash().hashPassword(password, env)
  const r = db.prepare(`INSERT INTO portal_accounts (membership_id, name, phone, password_hash, contact_id, consent_version, consent_at, consent_locale)
    VALUES (@m, @n, @p, @h, @c, 'portal-legal-2026-09-07', CURRENT_TIMESTAMP, 'en')`)
    .run({ m: membershipId, n: name, p: phoneNumber, h: hash, c: contactId ?? null })
  return Number(r.meta.last_row_id)
}

const count = (db, table) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)

async function run() {
  await check('canonicalizePhone collapses local / +855 / 855 to one key', () => {
    assert.strictEqual(canonicalizePhone('012 345 678'), '012345678')
    assert.strictEqual(canonicalizePhone('+855 12 345 678'), '012345678')
    assert.strictEqual(canonicalizePhone('85512345678'), '012345678')
    assert.strictEqual(canonicalizePhone('(012) 345-678'), '012345678')
    assert.strictEqual(canonicalizePhone(''), null)
    assert.strictEqual(canonicalizePhone(null), null)
  })

  await check('the 0087 SQL backfill produces the same canonical key as lib/phone.ts', () => {
    seedCustomer(rawDb, { name: 'Backfill One', phone: '+855 77 111 222', phone_normalized: null })
    rawDb.exec(`UPDATE customers SET phone_normalized = replace(replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '') WHERE name = 'Backfill One'`)
    rawDb.exec(`UPDATE customers SET phone_normalized = '0' || substr(phone_normalized, 4) WHERE phone_normalized LIKE '855%' AND length(phone_normalized) IN (11, 12)`)
    const row = rawDb.prepare("SELECT phone_normalized FROM customers WHERE name = 'Backfill One'").get()
    assert.strictEqual(row.phone_normalized, canonicalizePhone('+855 77 111 222'))
    assert.strictEqual(row.phone_normalized, '077111222')
  })

  await check('sign-up creates a member only: a W- code, no customer row, no link, no LC id', async () => {
    const customersBefore = count(rawDb, 'customers')
    const res = await signupPortalAccount(env, { name: 'Dara', phone: '099 888 777', password: 'secret123', consent: true })
    assert.strictEqual(res.ok, true, JSON.stringify(res))
    assert.match(res.account.memberCode, memberCode.MEMBER_CODE_PATTERN)
    assert.strictEqual(memberCode.isValidMemberCode(res.account.memberCode), true, 'the check character is valid')
    assert.deepStrictEqual(res.account, { membershipId: res.account.memberCode, memberCode: res.account.memberCode, name: 'Dara', email: null, linked: false })
    const account = rawDb.prepare('SELECT phone, contact_id, membership_id, member_code, status, link_version, consent_version, last_seen_at FROM portal_accounts WHERE id = ?').get([res.accountId])
    assert.strictEqual(account.phone, '099888777', 'stored phone is canonical')
    assert.strictEqual(account.contact_id, null, 'sign-up links no customer')
    assert.strictEqual(account.membership_id, null, 'a new member gets no LC number')
    assert.strictEqual(account.member_code, res.account.memberCode)
    assert.strictEqual(account.status, 'active')
    assert.strictEqual(account.link_version, 0)
    assert.strictEqual(account.consent_version, PORTAL_CONSENT_VERSION)
    assert.ok(account.last_seen_at, 'last_seen_at starts at sign-up (180-day retention reads it)')
    assert.strictEqual(count(rawDb, 'customers'), customersBefore, 'no customer row is written')
    assert.ok(!portalAccountSource.includes('Math.random('), 'account identifiers must never use Math.random')
    assert.ok(!/FROM customers/i.test(portalAccountSource.slice(portalAccountSource.indexOf('export async function signupPortalAccount'), portalAccountSource.indexOf('export async function ensurePortalMemberCode'))),
      'signupPortalAccount reads no customer')
  })

  await check('a phone that IS a customer signs up exactly like one that is not (no oracle, no CRM row)', async () => {
    seedCustomer(rawDb, { name: 'Old Buyer', phone: '011 222 333', phone_normalized: '011222333', membership_number: 'LC-00001' })
    const customersBefore = count(rawDb, 'customers')
    const known = await signupPortalAccount(env, { name: 'Old Buyer', phone: '011 222 333', password: 'secret123', consent: true })
    const fresh = await signupPortalAccount(env, { name: 'New Person', phone: '011 444 555', password: 'secret123', consent: true })
    assert.strictEqual(known.ok, true)
    assert.strictEqual(fresh.ok, true)
    assert.deepStrictEqual(Object.keys(known.account).sort(), Object.keys(fresh.account).sort())
    assert.strictEqual(known.account.linked, false)
    assert.strictEqual(count(rawDb, 'customers'), customersBefore, 'neither sign-up writes a customer')
    assert.strictEqual(rawDb.prepare('SELECT contact_id FROM portal_accounts WHERE id = ?').get([known.accountId]).contact_id, null)
  })

  await check('a membershipId (LC number) + matching phone does NOT claim the customer', async () => {
    const contactId = seedCustomer(rawDb, { name: 'Receipt Holder', phone: '012 600 600', phone_normalized: '012600600', membership_number: 'LC-00005' })
    const res = await signupPortalAccount(env, { name: 'Receipt Holder', phone: '012 600 600', membershipId: 'LC-00005', password: 'secret123', consent: true })
    assert.strictEqual(res.ok, true)
    const account = rawDb.prepare('SELECT contact_id, membership_id FROM portal_accounts WHERE id = ?').get([res.accountId])
    assert.strictEqual(account.contact_id, null, 'the claim path is gone')
    assert.strictEqual(account.membership_id, null, 'the supplied LC number is not stored')
    assert.notStrictEqual(res.account.membershipId, 'LC-00005')
    assert.strictEqual(rawDb.prepare('SELECT COUNT(*) AS n FROM portal_accounts WHERE contact_id = ?').get([contactId]).n, 0)
  })

  await check('a phone that already has an ACCOUNT (any format) gets one generic 409, counted as abuse', async () => {
    const res = await signupPortalAccount(env, { name: 'Someone Else', phone: '+855 99 888 777', password: 'secret123', consent: true })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.status, 409)
    assert.strictEqual(res.code, 'signup_unavailable')
    assert.strictEqual(res.abuse, true)
    assert.ok(!JSON.stringify(res).includes('Dara'), 'the existing member is not named')
  })

  await check('signup with a short password is a benign form error (not counted as abuse)', async () => {
    const res = await signupPortalAccount(env, { name: 'Shorty', phone: '070 111 222', password: '123', consent: true })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.code, 'password_weak')
    assert.strictEqual(res.abuse, false)
  })

  await check('the portal preserves the existing six-character password minimum', async () => {
    const res = await signupPortalAccount(env, { name: 'Sevenish', phone: '070 111 333', password: 'abcdefg', consent: true })
    assert.strictEqual(res.ok, true, JSON.stringify(res))
  })

  await check('a long passphrase with no symbols or digits is accepted', async () => {
    const res = await signupPortalAccount(env, { name: 'Passphrase', phone: '070 111 666', password: 'correct horse battery', consent: true })
    assert.strictEqual(res.ok, true, JSON.stringify(res))
  })

  await check('sign-in by name or by W- code (case, spaces and dashes forgiven) + phone + password', async () => {
    const dara = rawDb.prepare("SELECT member_code FROM portal_accounts WHERE name = 'Dara'").get()
    const byName = await signinPortalAccount(env, { identifier: 'dara', phone: '+855 99 888 777', password: 'secret123', consent: true })
    assert.strictEqual(byName.ok, true)
    const loose = dara.member_code.toLowerCase().replace(/-/g, ' ')
    const byCode = await signinPortalAccount(env, { identifier: loose, phone: '099 888 777', password: 'secret123', consent: true })
    assert.strictEqual(byCode.ok, true, `signed in with ${loose}`)
  })

  await check('an account from before G38 keeps signing in by name and by its old LC id, and gets a W- code lazily', async () => {
    const contactId = seedCustomer(rawDb, { name: 'Legacy Lina', phone: '015 151 515', phone_normalized: '015151515', membership_number: 'LC-00042' })
    const id = await seedLegacyAccount(rawDb, { name: 'Legacy Lina', phoneNumber: '015151515', membershipId: 'LC-00042', contactId })
    assert.strictEqual((await signinPortalAccount(env, { identifier: 'legacy lina', phone: '015 151 515', password: 'secret123', consent: true })).ok, true)
    assert.strictEqual((await signinPortalAccount(env, { identifier: 'lc-00042', phone: '015 151 515', password: 'secret123', consent: true })).ok, true)
    assert.strictEqual(rawDb.prepare('SELECT member_code FROM portal_accounts WHERE id = ?').get([id]).member_code, null, 'no code until first read')
    const first = await ensurePortalMemberCode(env, id)
    assert.match(first, memberCode.MEMBER_CODE_PATTERN)
    assert.strictEqual(await ensurePortalMemberCode(env, id), first, 'compare-and-set: a second read keeps the first code')
    assert.strictEqual((await signinPortalAccount(env, { identifier: first, phone: '015 151 515', password: 'secret123', consent: true })).ok, true, 'the lazy code signs in too')
  })

  await check('a linked member sees and signs in with the store number; the W- code stays a working alias', async () => {
    const contactId = seedCustomer(rawDb, { name: 'Store Sophea', phone: '016 161 616', phone_normalized: '016161616', membership_number: 'LC-00077' })
    const id = await seedLegacyAccount(rawDb, { name: 'Web Sophea', phoneNumber: '016161616', membershipId: null, contactId })
    const code = await ensurePortalMemberCode(env, id)
    const view = await loadPortalMemberView(env, id)
    assert.deepStrictEqual(view, { membershipId: 'LC-00077', memberCode: code, name: 'Web Sophea', email: null, linked: true })
    assert.strictEqual((await signinPortalAccount(env, { identifier: 'LC-00077', phone: '016 161 616', password: 'secret123', consent: true })).ok, true)
    assert.strictEqual((await signinPortalAccount(env, { identifier: code, phone: '016 161 616', password: 'secret123', consent: true })).ok, true)
  })

  await check('the member view is an allowlist: no customer id, name, points or phone ever', () => {
    const view = portalMemberView({
      member_code: 'W-0000-0000', name: 'X', email: null, contact_id: 9, customer_membership_number: 'LC-00009',
      customer_name: 'Secret Customer', points: 999, phone: '012345678', id: 5,
    })
    assert.deepStrictEqual(Object.keys(view), [...PORTAL_MEMBER_VIEW_KEYS])
    assert.ok(!JSON.stringify(view).includes('Secret Customer'))
    assert.ok(!JSON.stringify(view).includes('999'))
    assert.ok(!JSON.stringify(view).includes('012345678'))
  })

  await check('marking a linked contact invalidates portal signin without exposing the marker', async () => {
    const contactId = seedCustomer(rawDb, { name: 'Later Marker', phone: '010 555 012', phone_normalized: '010555012', membership_number: 'LC-00088' })
    await seedLegacyAccount(rawDb, { name: 'Later Marker', phoneNumber: '010555012', membershipId: 'LC-00088', contactId })
    assert.strictEqual((await signinPortalAccount(env, { identifier: 'Later Marker', phone: '010 555 012', password: 'secret123', consent: true })).ok, true)
    rawDb.prepare('UPDATE customers SET is_anonymous=1 WHERE id=?').run([contactId])
    const signin = await signinPortalAccount(env, { identifier: 'Later Marker', phone: '010 555 012', password: 'secret123', consent: true })
    assert.strictEqual(signin.ok, false)
    assert.strictEqual(signin.code, 'invalid_credentials')
    assert.ok(!JSON.stringify(signin).includes('anonymous'))
  })

  await check('a suspended member hears "paused" only after the right password; a closed one never signs in', async () => {
    const res = await signupPortalAccount(env, { name: 'Paused Pich', phone: '017 171 717', password: 'secret123', consent: true })
    rawDb.prepare("UPDATE portal_accounts SET status = 'suspended' WHERE id = ?").run([res.accountId])
    const wrong = await signinPortalAccount(env, { identifier: 'Paused Pich', phone: '017 171 717', password: 'nope-nope', consent: true })
    assert.strictEqual(wrong.code, 'invalid_credentials')
    const right = await signinPortalAccount(env, { identifier: 'Paused Pich', phone: '017 171 717', password: 'secret123', consent: true })
    assert.strictEqual(right.ok, false)
    assert.strictEqual(right.status, 403)
    assert.strictEqual(right.code, 'portal_account_suspended')
    rawDb.prepare("UPDATE portal_accounts SET status = 'closed' WHERE id = ?").run([res.accountId])
    assert.strictEqual((await signinPortalAccount(env, { identifier: 'Paused Pich', phone: '017 171 717', password: 'secret123', consent: true })).code, 'invalid_credentials')
  })

  await check('signin fails on wrong password, unknown phone, and identifier mismatch — all generic', async () => {
    const wrongPw = await signinPortalAccount(env, { identifier: 'dara', phone: '099 888 777', password: 'nope', consent: true })
    assert.strictEqual(wrongPw.code, 'invalid_credentials')
    const unknownPhone = await signinPortalAccount(env, { identifier: 'dara', phone: '060 000 001', password: 'secret123', consent: true })
    assert.strictEqual(unknownPhone.code, 'invalid_credentials')
    const wrongId = await signinPortalAccount(env, { identifier: 'not-dara', phone: '099 888 777', password: 'secret123', consent: true })
    assert.strictEqual(wrongId.code, 'invalid_credentials')
    const someoneElsesCode = rawDb.prepare("SELECT member_code FROM portal_accounts WHERE name = 'Sevenish'").get().member_code
    const otherCode = await signinPortalAccount(env, { identifier: someoneElsesCode, phone: '099 888 777', password: 'secret123', consent: true })
    assert.strictEqual(otherCode.code, 'invalid_credentials', "another member's code is not this phone's identifier")
  })

  await check('the flat 10-fail cap locks a key, then clears on success', async () => {
    const key = '099888777'
    for (let i = 1; i <= 9; i += 1) {
      const state = await recordPortalFailure(env, 'signin', key)
      assert.strictEqual(state.locked, false, `failure ${i} should not lock yet`)
    }
    const tenth = await recordPortalFailure(env, 'signin', key)
    assert.strictEqual(tenth.locked, true, 'the 10th failure locks')
    assert.ok(tenth.retryAfterSeconds > 0)
    assert.strictEqual((await getPortalLockoutState(env, 'signin', key)).locked, true)
    await clearPortalLockout(env, 'signin', key)
    const cleared = await getPortalLockoutState(env, 'signin', key)
    assert.strictEqual(cleared.locked, false)
    assert.strictEqual(cleared.failedCount, 0)
  })

  await check('two concurrent sign-ups get distinct W- codes and write no customer', async () => {
    const iso = makePortal()
    const [a, b] = await Promise.all([
      iso.accounts.signupPortalAccount(env, { name: 'Dara', phone: '099 111 222', password: 'secret123', consent: true }),
      iso.accounts.signupPortalAccount(env, { name: 'Sokha', phone: '099 333 444', password: 'secret123', consent: true }),
    ])
    assert.strictEqual(a.ok, true)
    assert.strictEqual(b.ok, true)
    assert.notStrictEqual(a.account.memberCode, b.account.memberCode)
    assert.strictEqual(count(iso.rawDb, 'customers'), 0)
  })

  await check('a member-code collision re-mints (it is this function\'s own doing), not a 409', async () => {
    const taken = memberCode.mintMemberCode()
    let calls = 0
    const stub = { ...memberCode, mintMemberCode: () => (calls++ === 0 ? taken : memberCode.mintMemberCode()) }
    const iso = makePortal(stub)
    iso.rawDb.prepare("INSERT INTO portal_accounts (name, phone, member_code) VALUES ('Holder', '099700700', @c)").run({ c: taken })
    const res = await iso.accounts.signupPortalAccount(env, { name: 'Next', phone: '099 800 901', password: 'secret123', consent: true })
    assert.strictEqual(res.ok, true, JSON.stringify(res))
    assert.notStrictEqual(res.account.memberCode, taken)
    assert.strictEqual(iso.getInsertAttempts(), 2)
  })

  await check('exhausting every retry (5) on a code that never varies THROWS -- never a misleading 409', async () => {
    const taken = memberCode.mintMemberCode()
    const stuck = { ...memberCode, mintMemberCode: () => taken }
    const iso = makePortal(stuck)
    iso.rawDb.prepare("INSERT INTO portal_accounts (name, phone, member_code) VALUES ('Holder', '099700700', @c)").run({ c: taken })
    await assert.rejects(
      () => iso.accounts.signupPortalAccount(env, { name: 'New', phone: '099 800 900', password: 'secret123', consent: true }),
      /UNIQUE constraint failed/,
    )
    assert.strictEqual(iso.getInsertAttempts(), 5)
    assert.strictEqual(count(iso.rawDb, 'portal_accounts'), 1)
  })
}

run().then(() => {
  console.log(`\n${passed} checks passed`)
}).catch((error) => {
  console.error('FAIL', error)
  process.exit(1)
})
