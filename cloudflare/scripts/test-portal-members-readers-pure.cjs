// G38 S1: the readers of portal_accounts tolerate a member that has no LC number, no phone and no password,
// and a member that is not active; a W- code is minted lazily, once, as a compare-and-set.
//
// Runs the REAL lib/portalAccounts.ts and lib/portalSession.ts (transpiled) against in-memory SQLite with every
// real migration applied. Each new rule has a mutant (the same source with the rule removed) that this file
// loads the same way and must see fail.
//
// Run (from cloudflare/): node scripts/test-portal-members-readers-pure.cjs
'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')
const { loadRealPasswordHash, loadRealFailedSignInCost } = require('./harness/password_hash_stub.cjs')

const SRC = path.join(__dirname, '..', 'src')
const CONSENT_VERSION = 'portal-legal-2026-10-20'

function loadSource(text, relPath, overrides = {}) {
  const sourcePath = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(text, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in overrides) return overrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const moduleObj = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
    return moduleObj.exports
  } finally {
    Module._load = originalLoad
  }
}
const readSrc = (relPath) => fs.readFileSync(path.join(SRC, relPath), 'utf8').replace(/\r\n/g, '\n')
const loadReal = (relPath, overrides) => loadSource(readSrc(relPath), relPath, overrides)

function world() {
  const raw = openDb(loadAll())
  const writes = []
  const db = {
    prepare(sql) {
      const stmt = raw.prepare(sql)
      return {
        get: async (p) => stmt.get(p),
        all: async (p) => stmt.all(p) || [],
        run: async (p) => {
          if (/^\s*(UPDATE|INSERT|DELETE)/i.test(sql)) writes.push(sql.replace(/\s+/g, ' ').trim())
          const r = stmt.run(p)
          return { changes: r.meta?.changes ?? 0, lastInsertRowid: Number(r.meta?.last_row_id ?? 0) }
        },
      }
    },
    batch: (items) => raw.batch(items),
  }
  return { raw, db, writes }
}

const phone = loadReal('lib/phone.ts')
const anonymousCustomer = loadReal('lib/anonymousCustomer.ts')
const memberCode = loadReal('lib/memberCode.ts')
const passwordHash = loadRealPasswordHash()
const failedSignInCost = loadRealFailedSignInCost()

function accountsModule(db, source = readSrc('lib/portalAccounts.ts'), extra = {}) {
  return loadSource(source, 'lib/portalAccounts.ts', {
    './db': { getDb: () => db },
    './cache': { bumpVersions: async () => {} },
    './membershipNumber': {},
    './phone': phone,
    './passwordPolicy': {},
    './contactDuplicates': {},
    './anonymousCustomer': anonymousCustomer,
    './passwordHash': passwordHash,
    './failedSignInCost': failedSignInCost,
    './memberCode': memberCode,
    ...extra,
  })
}

const jar = { value: null }
const cookieStub = { getCookie: () => jar.value, setCookie: (_c, _n, value) => { jar.value = value }, deleteCookie: () => { jar.value = null } }
// G38 S3f: the session module now reads the plan limits and the ISO helpers (loader only; no assertion changed).
const planTier = loadReal('lib/planTier.ts')
const telegramToken = loadSource(readSrc('lib/portalTelegramToken.ts'), 'lib/portalTelegramToken.ts', { './phone': phone, './planTier': planTier })
function sessionModule(db, accounts, source = readSrc('lib/portalSession.ts')) {
  return loadSource(source, 'lib/portalSession.ts', {
    './db': { getDb: () => db },
    './portalAccounts': accounts,
    './anonymousCustomer': anonymousCustomer,
    './planTier': planTier,
    './portalTelegramToken': telegramToken,
    'hono/cookie': cookieStub,
  })
}
const ctx = () => ({ env: {}, executionCtx: { waitUntil: () => {} } })

let seq = 0
function seedMember(raw, fields = {}) {
  seq += 1
  const row = {
    membership_id: null, name: `Member ${seq}`, phone: null, password_hash: null, member_code: null, status: 'active',
    consent_version: CONSENT_VERSION, consent_at: '2026-11-01 08:00:00', age_confirmed_at: '2026-11-01 08:00:00', ...fields,
  }
  const result = raw.prepare(`INSERT INTO portal_accounts (membership_id, name, phone, password_hash, member_code, status, consent_version, consent_at, consent_locale, age_confirmed_at)
    VALUES (@membership_id, @name, @phone, @password_hash, @member_code, @status, @consent_version, @consent_at, 'en', @age_confirmed_at)`).run(row)
  return Number(result.meta?.last_row_id ?? 0)
}

let passed = 0
let failed = 0
async function check(name, fn) {
  try { await fn(); passed += 1; console.log(`PASS ${name}`) } catch (error) { failed += 1; process.exitCode = 1; console.log(`FAIL ${name}\n  ${error.stack}`) }
}

async function run() {
  await check('the member view shows the LC number when there is one, else the W- code, else nothing', async () => {
    const { db } = world()
    const { portalMemberView } = accountsModule(db)
    assert.equal(portalMemberView({ membership_id: 'LC-00010', member_code: 'W-7KQ4-M9XD', name: 'A' }).membershipId, 'LC-00010')
    assert.equal(portalMemberView({ membership_id: null, member_code: 'W-7KQ4-M9XD', name: 'A' }).membershipId, 'W-7KQ4-M9XD')
    assert.equal(portalMemberView({ membership_id: '  ', member_code: 'W-7KQ4-M9XD', name: 'A' }).membershipId, 'W-7KQ4-M9XD')
    assert.equal(portalMemberView({ membership_id: null, member_code: null, name: 'A' }).membershipId, '')
    assert.deepEqual({ ...portalMemberView({ membership_id: 'LC-00010', member_code: 'W-7KQ4-M9XD', name: 'A', email: 'a@b.c' }) },
      { membershipId: 'LC-00010', memberCode: 'W-7KQ4-M9XD', name: 'A', email: 'a@b.c' })

    const code = readSrc('lib/portalAccounts.ts')
    const mutant = code.replace("String(row.membership_id ?? '').trim() || memberCode || ''", "memberCode || String(row.membership_id ?? '').trim() || ''")
    assert.notEqual(mutant, code, 'mutant applied')
    assert.equal(accountsModule(db, mutant).portalMemberView({ membership_id: 'LC-00010', member_code: 'W-7KQ4-M9XD', name: 'A' }).membershipId, 'W-7KQ4-M9XD', 'the mutant puts the code first')
  })

  await check('ensurePortalMemberCode mints one valid code, stores it, and never rewrites an existing one', async () => {
    const { raw, db, writes } = world()
    const { ensurePortalMemberCode } = accountsModule(db)
    const id = seedMember(raw)
    const other = seedMember(raw, { member_code: 'W-0000-0000' })
    const minted = await ensurePortalMemberCode({}, id)
    assert.ok(memberCode.isValidMemberCode(minted), minted)
    assert.equal(raw.prepare('SELECT member_code FROM portal_accounts WHERE id = ?').get([id]).member_code, minted)
    assert.equal(writes.length, 1, 'one write for the first mint')
    writes.length = 0
    assert.equal(await ensurePortalMemberCode({}, id), minted)
    assert.equal(await ensurePortalMemberCode({}, other), 'W-0000-0000')
    assert.equal(writes.length, 0, 'a second call, or an account that has a code, writes nothing')
    assert.equal(await ensurePortalMemberCode({}, 99999), null, 'no such account')
  })

  await check('calls racing on one account settle on one code (compare-and-set); the unconditional-write mutant ends with different answers', async () => {
    const { raw, db } = world()
    const { ensurePortalMemberCode } = accountsModule(db)
    const id = seedMember(raw)
    const results = await Promise.all([ensurePortalMemberCode({}, id), ensurePortalMemberCode({}, id), ensurePortalMemberCode({}, id)])
    assert.equal(new Set(results).size, 1, `all callers got ${[...new Set(results)].join(' / ')}`)
    assert.equal(raw.prepare('SELECT member_code FROM portal_accounts WHERE id = ?').get([id]).member_code, results[0])

    const code = readSrc('lib/portalAccounts.ts')
    const mutant = code.replace('WHERE id = @id AND member_code IS NULL', 'WHERE id = @id')
    assert.notEqual(mutant, code, 'mutant applied')
    const { raw: raw2, db: db2 } = world()
    const id2 = seedMember(raw2)
    const mutantResults = await Promise.all([1, 2, 3].map(() => accountsModule(db2, mutant).ensurePortalMemberCode({}, id2)))
    assert.ok(new Set(mutantResults).size > 1, 'the mutant hands different codes to callers of one account')
  })

  await check('a code that collides with another account is retried with a fresh one', async () => {
    const { raw, db } = world()
    const { ensurePortalMemberCode } = accountsModule(db)
    seedMember(raw, { member_code: 'W-0000-0000' })
    const id = seedMember(raw)
    const offered = []
    const minter = () => { offered.push(offered.length === 0 ? 'W-0000-0000' : 'W-1111-1111'); return offered[offered.length - 1] }
    assert.equal(await ensurePortalMemberCode({}, id, minter), 'W-1111-1111')
    assert.deepEqual(offered, ['W-0000-0000', 'W-1111-1111'])
  })

  await check('a minter that always collides gives up with null after a bounded number of tries, never an error or a loop', async () => {
    const { raw, db } = world()
    const { ensurePortalMemberCode } = accountsModule(db)
    seedMember(raw, { member_code: 'W-0000-0000' })
    const id = seedMember(raw)
    let tries = 0
    assert.equal(await ensurePortalMemberCode({}, id, () => { tries += 1; return 'W-0000-0000' }), null)
    assert.equal(tries, 5)
  })

  await check('a mint that fails for any reason but a duplicate code answers null and does not throw; the next call mints', async () => {
    const { raw, db } = world()
    const id = seedMember(raw)
    let refuse = 'D1_ERROR: write quota exceeded'
    const refusing = () => ({ get: async () => { throw new Error(refuse) }, all: async () => { throw new Error(refuse) }, run: async () => { throw new Error(refuse) } })
    const failingDb = { ...db, prepare: (sql) => (refuse && /SET member_code/.test(sql) ? refusing() : db.prepare(sql)) }
    const { ensurePortalMemberCode, loadPortalMemberView } = accountsModule(failingDb)
    let tries = 0
    assert.equal(await ensurePortalMemberCode({}, id, () => { tries += 1; return 'W-2222-2222' }), null, 'a quota error is not thrown')
    assert.equal(tries, 1, 'a non-duplicate failure is not retried')
    const view = await loadPortalMemberView({}, { id, membership_id: 'LC-00001', member_code: null, name: 'A' })
    assert.equal(view.memberCode, null)
    assert.equal(view.membershipId, 'LC-00001')
    refuse = null
    assert.equal(await ensurePortalMemberCode({}, id, () => 'W-2222-2222'), 'W-2222-2222', 'the next call tries again')

    const code = readSrc('lib/portalAccounts.ts')
    const mutant = code.replace('String(error))\n      return null', 'String(error))\n      throw error')
    assert.notEqual(mutant, code, 'mutant applied')
    const { raw: raw2, db: db2 } = world()
    const id2 = seedMember(raw2)
    refuse = 'boom'
    const failing2 = { ...db2, prepare: (sql) => (/SET member_code/.test(sql) ? refusing() : db2.prepare(sql)) }
    await assert.rejects(accountsModule(failing2, mutant).ensurePortalMemberCode({}, id2), /boom/, 'the rethrowing mutant throws')
  })

  await check('a stored code moves the customers cache version once; an existing code and a failure do not', async () => {
    const { raw, db } = world()
    const bumps = []
    const cache = { bumpVersions: async (_env, names) => { bumps.push(names.join(',')) } }
    const { ensurePortalMemberCode } = accountsModule(db, undefined, { './cache': cache })
    const id = seedMember(raw)
    assert.ok(await ensurePortalMemberCode({}, id))
    assert.deepEqual(bumps, ['customers'])
    await ensurePortalMemberCode({}, id)
    await ensurePortalMemberCode({}, seedMember(raw, { member_code: 'W-0000-0000' }))
    assert.equal(bumps.length, 1, 'no bump when no code was stored')
    const throwing = { bumpVersions: async () => { throw new Error('cache down') } }
    assert.ok(await accountsModule(db, undefined, { './cache': throwing }).ensurePortalMemberCode({}, seedMember(raw)), 'a failing cache bump does not lose the minted code')

    const code = readSrc('lib/portalAccounts.ts')
    const mutant = code.replace("        await bumpVersions(env, ['customers']).catch(() => {})\n", '')
    assert.notEqual(mutant, code, 'mutant applied')
    const { raw: raw2, db: db2 } = world()
    const bumps2 = []
    await accountsModule(db2, mutant, { './cache': { bumpVersions: async (_e, n) => { bumps2.push(n) } } }).ensurePortalMemberCode({}, seedMember(raw2))
    assert.equal(bumps2.length, 0, 'the mutant leaves the Contacts list cache stale')
  })

  await check('consent renewal refuses a suspended or closed account and writes nothing; the mutant without the status term renews it', async () => {
    const { raw, db } = world()
    const accounts = accountsModule(db)
    const input = { consent: true, ageConfirmed: true, consentLocale: 'en' }
    const stale = { consent_version: 'portal-legal-older', age_confirmed_at: null }
    const active = seedMember(raw, { ...stale })
    const suspended = seedMember(raw, { ...stale, status: 'suspended' })
    const closed = seedMember(raw, { ...stale, status: 'closed' })
    for (const id of [suspended, closed]) {
      const result = await accounts.renewPortalConsent({}, id, input)
      assert.equal(result.ok, false, `account ${id}`)
      assert.equal(result.code, 'portal_unauthenticated')
      assert.equal(raw.prepare('SELECT consent_version FROM portal_accounts WHERE id = ?').get([id]).consent_version, 'portal-legal-older', 'nothing renewed')
    }
    assert.deepEqual({ ...(await accounts.renewPortalConsent({}, active, input)) }, { ok: true, renewed: true })
    assert.deepEqual({ ...(await accounts.renewPortalConsent({}, active, input)) }, { ok: true, renewed: false })

    const code = readSrc('lib/portalAccounts.ts')
    const mutant = code.replace("      AND status = 'active'\n      AND NOT (consent_version", '      AND NOT (consent_version')
    assert.notEqual(mutant, code, 'mutant applied')
    const renewed = await accountsModule(db, mutant).renewPortalConsent({}, suspended, input)
    assert.equal(renewed.ok && renewed.renewed, true, 'without the term a suspended account renews')
  })

  await check('a non-active account is refused BEFORE any write, at the same hash cost and with the same answer as a wrong password; the mutant without only the read-side check writes', async () => {
    const { raw, db, writes } = world()
    let spent = 0
    const countingHash = { ...passwordHash, spendFailedSignInFloor: async (...args) => { spent += 1; return passwordHash.spendFailedSignInFloor(...args) } }
    const accounts = accountsModule(db, undefined, { './passwordHash': countingHash })
    const hash = await passwordHash.hashPassword('correct horse battery', {})
    seedMember(raw, { name: 'Active', phone: '012333333', password_hash: hash })
    seedMember(raw, { name: 'Suspended', phone: '012111111', password_hash: hash, status: 'suspended' })
    const input = (identifier, phoneNumber, password = 'correct horse battery') => ({ identifier, phone: phoneNumber, password, consent: true, consentLocale: 'en', ageConfirmed: true })
    writes.length = 0
    spent = 0
    const wrong = await accounts.signinPortalAccount({}, input('Active', '012333333', 'nope nope nope'))
    const wrongSpent = spent
    spent = 0
    const refused = await accounts.signinPortalAccount({}, input('Suspended', '012111111'))
    assert.deepEqual({ ...refused }, { ...wrong }, 'same answer as a wrong password')
    assert.equal(spent, wrongSpent, 'same failed-sign-in floor spent')
    assert.ok(spent > 0)
    assert.deepEqual(writes, [], 'no UPDATE or INSERT ran for either')

    const code = readSrc('lib/portalAccounts.ts')
    const mutant = code.replace("account.status !== 'active' || ", '')
    assert.notEqual(mutant, code, 'mutant applied')
    writes.length = 0
    spent = 0
    const mutantResult = await accountsModule(db, mutant, { './passwordHash': countingHash }).signinPortalAccount({}, input('Suspended', '012111111'))
    assert.equal(mutantResult.ok, false, 'the write-side status term still refuses it, so the answer alone cannot tell')
    assert.ok(writes.length > 0 && spent === 0, `but the mutant ran the sign-in UPDATE and skipped the floor: ${writes.length} writes, ${spent} spent`)
  })

  await check('sign-in works for an account with no LC number, and a missing password hash fails closed without an error', async () => {
    const { raw, db } = world()
    const accounts = accountsModule(db)
    const hash = await passwordHash.hashPassword('correct horse battery', {})
    seedMember(raw, { name: 'No Lc', phone: '012345678', password_hash: hash })
    seedMember(raw, { name: 'No Password', phone: '012345679', password_hash: null })
    const input = (identifier, phoneNumber, password) => ({ identifier, phone: phoneNumber, password, consent: true, consentLocale: 'en', ageConfirmed: true })
    const ok = await accounts.signinPortalAccount({}, input('No Lc', '012345678', 'correct horse battery'))
    assert.equal(ok.ok, true)
    const wrongName = await accounts.signinPortalAccount({}, input('Someone Else', '012345678', 'correct horse battery'))
    assert.equal(wrongName.ok, false, 'a wrong name is a failed sign-in, not an exception on the missing LC number')
    assert.equal(wrongName.code, 'invalid_credentials')
    const wrong = await accounts.signinPortalAccount({}, input('No Lc', '012345678', 'nope nope nope'))
    assert.equal(wrong.ok, false)
    assert.equal(wrong.code, 'invalid_credentials')
    const noPassword = await accounts.signinPortalAccount({}, input('No Password', '012345679', 'anything at all'))
    assert.equal(noPassword.ok, false)
    assert.equal(noPassword.code, 'invalid_credentials')
  })

  await check('a suspended or closed account cannot sign in, with the same answer as a wrong password; the mutant without the check lets it in', async () => {
    const { raw, db } = world()
    const accounts = accountsModule(db)
    const hash = await passwordHash.hashPassword('correct horse battery', {})
    const suspended = seedMember(raw, { name: 'Suspended', phone: '012111111', password_hash: hash, status: 'suspended' })
    seedMember(raw, { name: 'Closed', phone: '012222222', password_hash: hash, status: 'closed' })
    const input = (identifier, phoneNumber) => ({ identifier, phone: phoneNumber, password: 'correct horse battery', consent: true, consentLocale: 'en', ageConfirmed: true })
    for (const [name, number] of [['Suspended', '012111111'], ['Closed', '012222222']]) {
      const result = await accounts.signinPortalAccount({}, input(name, number))
      assert.equal(result.ok, false, name)
      assert.equal(result.code, 'invalid_credentials', name)
      assert.equal(result.status, 401, name)
    }
    const code = readSrc('lib/portalAccounts.ts')
    const mutant = code.replace("account.status !== 'active' || ", '').replace("AND status = 'active'", '')
    assert.notEqual(mutant, code, 'mutant applied')
    const mutantResult = await accountsModule(db, mutant).signinPortalAccount({}, input('Suspended', '012111111'))
    assert.equal(mutantResult.ok, true, 'without the rule a suspended account signs in')
    assert.equal(raw.prepare('SELECT status FROM portal_accounts WHERE id = ?').get([suspended]).status, 'suspended')
  })

  await check('the session reads a member with no LC, phone or password; a suspended or closed member has no session; the label falls back to the W- code', async () => {
    const { raw, db } = world()
    const accounts = accountsModule(db)
    const session = sessionModule(db, accounts)
    const id = seedMember(raw, { name: 'Telegram Only', member_code: 'W-7KQ4-M9XD' })
    const { token } = await session.createPortalSession({}, id)
    jar.value = token
    const state = await session.getPortalAccountState(ctx())
    assert.equal(state.status, 'authenticated')
    assert.equal(state.account.membership_id, null)
    assert.equal(state.account.member_code, 'W-7KQ4-M9XD')
    assert.equal(state.account.phone, null)
    assert.equal(session.portalActorLabel(state.account), 'W-7KQ4-M9XD')
    assert.equal(session.portalActorLabel({ id: 4, membership_id: 'LC-00004', member_code: 'W-7KQ4-M9XD' }), 'LC-00004')
    assert.equal(session.portalActorLabel({ id: 4, membership_id: null, member_code: null }), 'account-4')

    for (const status of ['suspended', 'closed']) {
      raw.prepare('UPDATE portal_accounts SET status = ? WHERE id = ?').run([status, id])
      assert.deepEqual({ ...(await session.getPortalAccountState(ctx())) }, { status: 'unauthenticated', account: null }, status)
    }
    raw.prepare("UPDATE portal_accounts SET status = 'active' WHERE id = ?").run([id])
    assert.equal((await session.getPortalAccountState(ctx())).status, 'authenticated')

    const source = readSrc('lib/portalSession.ts')
    const mutant = source.replace("      AND a.status = 'active'\n", '')
    assert.notEqual(mutant, source, 'mutant applied')
    raw.prepare("UPDATE portal_accounts SET status = 'suspended' WHERE id = ?").run([id])
    assert.equal((await sessionModule(db, accounts, mutant).getPortalAccountState(ctx())).status, 'authenticated', 'without the rule a suspended member keeps a session')
  })

  await check('a stale-consent session for a member with no LC reports the W- code as its label', async () => {
    const { raw, db } = world()
    const session = sessionModule(db, accountsModule(db))
    const id = seedMember(raw, { member_code: 'W-7KQ4-M9XD', consent_version: 'portal-legal-older' })
    jar.value = (await session.createPortalSession({}, id)).token
    const state = await session.getPortalAccountState(ctx())
    assert.equal(state.status, 'reconsent_required')
    assert.equal(state.accountId, id)
    assert.equal(state.membershipId, 'W-7KQ4-M9XD')
  })

  console.log(`\n${passed} passed${failed ? `, ${failed} FAILED` : ''}`)
}

run().catch((error) => { console.error(error); process.exitCode = 1 })
