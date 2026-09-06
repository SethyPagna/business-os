// Regression test for the storefront customer-account system (§2):
// lib/phone.ts, lib/portalAccounts.ts, lib/portalAuthLockout.ts — the REAL
// source, transpiled and run against an in-memory SQLite with every real
// migration (including 0087_portal_accounts.sql) applied. No logic is
// reimplemented here. Same transpile-and-run harness as
// test-login-lockout-pure.cjs.
//
// Run (from cloudflare/): node scripts/test-portal-accounts-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const rawDb = openDb(loadAll())
const portalAccountSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'portalAccounts.ts'), 'utf8')

// The harness D1Compat's .run() returns the RAW D1 shape ({ meta: { last_row_id
// }}); the real lib/db.ts D1Compat flattens that to { changes, lastInsertRowid
// }. portalAccounts reads res.lastInsertRowid, so wrap the harness db in that
// same flattening (and make the calls Promise-returning like the real async
// D1Compat) before injecting it as getDb()'s result.
const db = {
  prepare(sql) {
    const stmt = rawDb.prepare(sql)
    return {
      get: async (p) => stmt.get(p),
      all: async (p) => stmt.all(p) || [],
      run: async (p) => {
        const r = stmt.run(p)
        return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
      },
    }
  },
  batch: (items) => rawDb.batch(items),
}

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

const dbModule = { getDb: () => db }
const phone = loadReal('lib/phone.ts')
const passwordPolicy = loadReal('lib/passwordPolicy.ts')
const contactOptions = loadReal('lib/contactOptions.ts')
// The ONE membership-number minter (house `LC-#####` format, gap-filling).
// portalAccounts no longer generates its own id, so this must be the REAL module.
const membershipNumber = loadReal('lib/membershipNumber.ts')
const contactDuplicates = loadReal('lib/contactDuplicates.ts', { './contactOptions': contactOptions })
const { canonicalizePhone } = phone
const { getPortalLockoutState, recordPortalFailure, clearPortalLockout } = loadReal('lib/portalAuthLockout.ts', { './db': dbModule })
const { signupPortalAccount, signinPortalAccount } = loadReal('lib/portalAccounts.ts', {
  './db': dbModule,
  './membershipNumber': membershipNumber,
  './phone': phone,
  './passwordPolicy': passwordPolicy,
  './contactDuplicates': contactDuplicates,
})

const env = {}
let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

// A fully independent DB + wiring, for the concurrency checks below: two
// signups racing on a blank slate must not be able to see each other's
// prior rows, and neither may collide with anything the checks above wrote
// into the shared `db` above. Returns both the signup entry point and the
// raw db handle so a test can seed rows directly before racing.
function makeIsolatedPortal() {
  const rawDb2 = openDb(loadAll())
  const db2 = {
    prepare(sql) {
      const stmt = rawDb2.prepare(sql)
      return {
        get: async (p) => stmt.get(p),
        all: async (p) => stmt.all(p) || [],
        run: async (p) => {
          const r = stmt.run(p)
          return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (items) => rawDb2.batch(items),
  }
  const { signupPortalAccount: signup2 } = loadReal('lib/portalAccounts.ts', {
    './db': { getDb: () => db2 },
    './membershipNumber': membershipNumber,
    './phone': phone,
    './passwordPolicy': passwordPolicy,
    './contactDuplicates': contactDuplicates,
  })
  return { signup: signup2, rawDb: rawDb2 }
}

function freshSignup() {
  return makeIsolatedPortal().signup
}

function seedCustomer(fields) {
  rawDb.prepare(
    'INSERT INTO customers (name, phone, phone_normalized, address, membership_number) VALUES (@name, @phone, @phone_normalized, @address, @membership_number)',
  ).run({
    name: fields.name,
    phone: fields.phone ?? null,
    phone_normalized: fields.phone_normalized ?? null,
    address: fields.address ?? null,
    membership_number: fields.membership_number ?? null,
  })
  return Number(rawDb.prepare('SELECT last_insert_rowid() AS id').get().id)
}

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
    seedCustomer({ name: 'Backfill One', phone: '+855 77 111 222', phone_normalized: null })
    // The exact backfill statements from 0087.
    rawDb.exec(`UPDATE customers SET phone_normalized = replace(replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '') WHERE name = 'Backfill One'`)
    rawDb.exec(`UPDATE customers SET phone_normalized = '0' || substr(phone_normalized, 4) WHERE phone_normalized LIKE '855%' AND length(phone_normalized) IN (11, 12)`)
    const row = rawDb.prepare("SELECT phone_normalized FROM customers WHERE name = 'Backfill One'").get()
    assert.strictEqual(row.phone_normalized, canonicalizePhone('+855 77 111 222'))
    assert.strictEqual(row.phone_normalized, '077111222')
  })

  await check('signup (new customer, no membership id) creates account + folded contact + auto id', async () => {
    const res = await signupPortalAccount(env, { name: 'Dara', phone: '099 888 777', password: 'secret123' })
    assert.strictEqual(res.ok, true)
    // New IDs use the shared house LC- gap-fill contract -- this is the
    // first LC- customer in this fresh in-memory DB, so it lands on 1.
    // Existing supplied membership IDs retain their separate compatibility
    // coverage (see the next few checks below).
    assert.strictEqual(res.membershipId, 'LC-00001', 'auto membership id gap-fills the house LC- sequence')
    assert.ok(!portalAccountSource.includes('Math.random('), 'account identifiers must never use Math.random')
    assert.ok(!portalAccountSource.includes('getRandomValues'), 'portalAccounts no longer mints its own id -- lib/membershipNumber.ts is the one authority')
    const account = rawDb.prepare('SELECT phone, contact_id, membership_id FROM portal_accounts WHERE id = ?').get([res.accountId])
    assert.strictEqual(account.phone, '099888777', 'stored phone is canonical')
    assert.ok(account.contact_id, 'a contact was folded and linked')
    const contact = rawDb.prepare('SELECT membership_number, phone_normalized FROM customers WHERE id = ?').get([account.contact_id])
    assert.strictEqual(contact.membership_number, res.membershipId)
    assert.strictEqual(contact.phone_normalized, '099888777')
  })

  await check('signup rejects a phone that already exists in ANY format (canonical uniqueness)', async () => {
    const res = await signupPortalAccount(env, { name: 'Someone Else', phone: '+855 99 888 777', password: 'secret123' })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.code, 'verification_failed')
    assert.strictEqual(res.abuse, true)
  })

  await check('signup (existing customer) succeeds with membership id + MATCHING phone, links the contact', async () => {
    const contactId = seedCustomer({ name: 'Old Buyer', phone: '011 222 333', phone_normalized: '011222333', membership_number: 'LCMN-OLDBUYER' })
    const res = await signupPortalAccount(env, { name: 'Old Buyer', phone: '855 11 222 333', membershipId: 'lcmn-oldbuyer', password: 'secret123' })
    assert.strictEqual(res.ok, true)
    const account = rawDb.prepare('SELECT contact_id, membership_id FROM portal_accounts WHERE id = ?').get([res.accountId])
    assert.strictEqual(account.contact_id, contactId, 'linked to the existing contact, no new one')
    assert.strictEqual(account.membership_id, 'lcmn-oldbuyer')
  })

  await check('signup (existing customer) with a PHONE MISMATCH is rejected with the reminder', async () => {
    seedCustomer({ name: 'Mismatch', phone: '012 000 000', phone_normalized: '012000000', membership_number: 'LCMN-MISMATCH' })
    const res = await signupPortalAccount(env, { name: 'Mismatch', phone: '012 999 999', membershipId: 'LCMN-MISMATCH', password: 'secret123' })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.code, 'verification_failed')
  })

  await check('signup with an unknown membership id is rejected (no oracle — same reminder)', async () => {
    const res = await signupPortalAccount(env, { name: 'Ghost', phone: '078 555 111', membershipId: 'LCMN-NOSUCHID', password: 'secret123' })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.code, 'verification_failed')
  })

  await check('signup with a short password is a benign form error (not counted as abuse)', async () => {
    const res = await signupPortalAccount(env, { name: 'Shorty', phone: '070 111 222', password: '123' })
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.code, 'password_weak')
    assert.strictEqual(res.abuse, false)
  })

  await check('signin succeeds with name OR membership id + phone + password', async () => {
    // From the new-customer account created earlier: name 'Dara', phone 099888777.
    const byName = await signinPortalAccount(env, { identifier: 'dara', phone: '+855 99 888 777', password: 'secret123' })
    assert.strictEqual(byName.ok, true)
    const byId = await signinPortalAccount(env, { identifier: 'lcmn-oldbuyer', phone: '011 222 333', password: 'secret123' })
    assert.strictEqual(byId.ok, true)
  })

  await check('signin fails on wrong password, unknown phone, and identifier mismatch — all generic', async () => {
    const wrongPw = await signinPortalAccount(env, { identifier: 'dara', phone: '099 888 777', password: 'nope' })
    assert.strictEqual(wrongPw.ok, false)
    assert.strictEqual(wrongPw.code, 'invalid_credentials')
    const unknownPhone = await signinPortalAccount(env, { identifier: 'dara', phone: '060 000 001', password: 'secret123' })
    assert.strictEqual(unknownPhone.ok, false)
    assert.strictEqual(unknownPhone.code, 'invalid_credentials')
    const wrongId = await signinPortalAccount(env, { identifier: 'not-dara', phone: '099 888 777', password: 'secret123' })
    assert.strictEqual(wrongId.ok, false)
    assert.strictEqual(wrongId.code, 'invalid_credentials')
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
    const state = await getPortalLockoutState(env, 'signin', key)
    assert.strictEqual(state.locked, true)
    await clearPortalLockout(env, 'signin', key)
    const cleared = await getPortalLockoutState(env, 'signin', key)
    assert.strictEqual(cleared.locked, false)
    assert.strictEqual(cleared.failedCount, 0)
  })

  await check('each store keeps its membership ids internally unique (a linked account SHARES its contact id by design)', () => {
    // Existing-customer accounts deliberately reuse the contact's own
    // membership number (that is how they link), so the two stores overlap on
    // purpose. What must hold is that neither store has an internal duplicate,
    // and that an AUTO-issued id for a NEW customer collides with nothing.
    const customerNumbers = rawDb.prepare('SELECT lower(trim(membership_number)) AS m FROM customers WHERE membership_number IS NOT NULL').all().map((r) => r.m)
    const accountIds = rawDb.prepare('SELECT lower(trim(membership_id)) AS m FROM portal_accounts').all().map((r) => r.m)
    assert.strictEqual(new Set(customerNumbers).size, customerNumbers.length, 'customers.membership_number has no internal duplicate')
    assert.strictEqual(new Set(accountIds).size, accountIds.length, 'portal_accounts.membership_id has no internal duplicate')

    // A brand-new signup's auto id equals no pre-existing id in EITHER store.
    const existing = new Set([...customerNumbers, ...accountIds])
    return signupPortalAccount(env, { name: 'Fresh Auto', phone: '096 424 242', password: 'secret123' }).then((res) => {
      assert.strictEqual(res.ok, true)
      assert.ok(!existing.has(res.membershipId.toLowerCase()), 'the auto-issued id did not collide with any existing id')
    })
  })

  await check('two concurrent new-customer signups both succeed with distinct LC- ids (mint collision re-mints, not existingReject)', async () => {
    // Fresh DB: both signups mint the SAME first-free sequence (neither has
    // written yet when the other reads), so one INSERT wins the UNIQUE index
    // on membership_id and the other must re-mint + retry -- not bounce the
    // real customer into "verification_failed" for a collision that was
    // entirely this function's own doing.
    const signup2 = freshSignup()
    const [a, b] = await Promise.all([
      signup2(env, { name: 'Dara', phone: '099 111 222', password: 'secret123' }),
      signup2(env, { name: 'Sokha', phone: '099 333 444', password: 'secret123' }),
    ])
    assert.strictEqual(a.ok, true, `first signup should succeed: ${JSON.stringify(a)}`)
    assert.strictEqual(b.ok, true, `second signup should succeed: ${JSON.stringify(b)}`)
    assert.match(a.membershipId, /^LC-\d{5}$/, `first id must be house format, got ${a.membershipId}`)
    assert.match(b.membershipId, /^LC-\d{5}$/, `second id must be house format, got ${b.membershipId}`)
    assert.notStrictEqual(a.membershipId, b.membershipId, 'concurrent signups must not share a membership id')
  })

  await check('a USER-SUPPLIED membership id that collides on the race still rejects (never re-minted)', async () => {
    // One existing customer, reachable by the SAME supplied membership id
    // through either of two phones (primary + a Contact Option secondary),
    // so two concurrent existing-customer claims can each pass their own
    // phone-match check yet race the SAME literal membershipId string into
    // claimAccount with createContact left undefined. The two calls use
    // DIFFERENT phones so only the membership-id UNIQUE index collides on
    // the race (not the phone index) -- isolating exactly the branch the
    // createContact gate protects: isMembershipCollision(error) is true,
    // but this id was supplied by the caller, not minted here, so it must
    // never fall into the re-mint path.
    const { signup, rawDb: rawDb3 } = makeIsolatedPortal()
    rawDb3.prepare(
      'INSERT INTO customers (name, phone, phone_normalized, address, membership_number) VALUES (@name, @phone, @phone_normalized, @address, @membership_number)',
    ).run({
      name: 'Twin Customer',
      phone: '099 010 010',
      phone_normalized: '099010010',
      address: JSON.stringify([{ phone: '099 020 020' }]),
      membership_number: 'LC-00099',
    })

    const [a, b] = await Promise.all([
      signup(env, { name: 'Twin Customer', phone: '099 010 010', membershipId: 'LC-00099', password: 'secret123' }),
      signup(env, { name: 'Twin Customer', phone: '099 020 020', membershipId: 'LC-00099', password: 'secret123' }),
    ])
    const results = [a, b]
    const succeeded = results.filter((r) => r.ok === true)
    const rejected = results.filter((r) => r.ok === false)
    assert.strictEqual(succeeded.length, 1, `exactly one racing claim on the supplied id should win: ${JSON.stringify(results)}`)
    assert.strictEqual(rejected.length, 1, `the other must reject, not silently re-mint a different id: ${JSON.stringify(results)}`)
    assert.strictEqual(succeeded[0].membershipId, 'LC-00099', 'the winner keeps the supplied id verbatim')
    assert.strictEqual(rejected[0].code, 'verification_failed', 'a supplied-id collision returns the same no-oracle reminder, never a fresh mint')
    assert.strictEqual(rejected[0].status, 409)
  })
}

run().then(() => {
  console.log(`\n${passed} checks passed`)
}).catch((error) => {
  console.error('FAIL', error)
  process.exit(1)
})
