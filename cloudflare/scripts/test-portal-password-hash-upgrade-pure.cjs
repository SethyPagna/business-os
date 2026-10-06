// E6 (5 Oct 2026): storefront accounts hash with PBKDF2-SHA256 through
// WebCrypto (lib/passwordHash.ts) and a successful sign-in upgrades a legacy
// bcrypt row exactly once.
//
// Drives the REAL lib/portalAccounts.ts and lib/passwordHash.ts against an
// in-memory SQLite with every real migration applied (same wiring as
// test-portal-accounts-pure.cjs), with the real bcryptjs and the real
// WebCrypto behind counting wrappers. Pins:
//   - signup stores the current format (recomputed here with node:crypto);
//   - a right sign-in on a legacy bcrypt row succeeds and rewrites it; the
//     next sign-in spends one derivation and no bcrypt, and does not rewrite;
//   - a wrong password, and a right password with the wrong name or
//     membership id, fail and never rewrite (each failure is padded to the
//     failed-sign-in floor, which is work, not a rewrite);
//   - an unknown phone spends the failed-sign-in floor: one derivation at the
//     current count, plus one bcrypt-10 compare while a bcrypt row remains
//     (RELEASE-20261006-VERIFY Exception 3; test-failed-sign-in-cost-pure.cjs
//     covers every state);
//   - the staff "reset storefront password" action (routes/contacts.ts)
//     writes through hashPassword with the Worker env (the pepper);
//   - with PASSWORD_PEPPER set, a sign-in on an unpeppered row rewrites it
//     peppered exactly once; a wrong pepper cannot sign it in.
//
// Run: node scripts/test-portal-password-hash-upgrade-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const nodeCrypto = require('crypto')
const bcrypt = require('bcryptjs')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const CURRENT_ITERATIONS = 10000
const compared = []
const countingBcrypt = { ...bcrypt, compareSync: (plain, hash) => { compared.push(String(hash)); return bcrypt.compareSync(plain, hash) } }
countingBcrypt.default = countingBcrypt
const derived = []
const subtle = globalThis.crypto.subtle
const realDeriveBits = subtle.deriveBits.bind(subtle)
subtle.deriveBits = (algorithm, ...rest) => { derived.push(algorithm.iterations); return realDeriveBits(algorithm, ...rest) }
const resetCounts = () => { compared.length = 0; derived.length = 0 }

const rawDb = openDb(loadAll())
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

function loadReal(relPath, requireOverrides = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
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
const contactOptions = loadReal('lib/contactOptions.ts')
const sqlBinding = loadReal('lib/sqlBinding.ts')
const passwordHash = loadReal('lib/passwordHash.ts', { bcryptjs: countingBcrypt })
const failedSignInCost = loadReal('lib/failedSignInCost.ts', { './planTier': loadReal('lib/planTier.ts') })
const { signupPortalAccount, signinPortalAccount } = loadReal('lib/portalAccounts.ts', {
  './db': { getDb: () => db },
  './membershipNumber': loadReal('lib/membershipNumber.ts'),
  './phone': phone,
  './passwordPolicy': loadReal('lib/passwordPolicy.ts'),
  './contactDuplicates': loadReal('lib/contactDuplicates.ts', { './contactOptions': contactOptions, './phone': phone, './sqlBinding': sqlBinding }),
  './anonymousCustomer': loadReal('lib/anonymousCustomer.ts'),
  './passwordHash': passwordHash,
  './failedSignInCost': failedSignInCost,
})

function isCurrentRowFor(row, password) {
  const m = /^\$pbkdf2-sha256\$i=(\d+)\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/.exec(String(row))
  if (!m || Number(m[1]) !== CURRENT_ITERATIONS) return false
  const key = nodeCrypto.pbkdf2Sync(Buffer.from(password, 'utf8'), Buffer.from(m[2], 'base64'), CURRENT_ITERATIONS, 32, 'sha256')
  return key.toString('base64').replace(/=+$/, '') === m[3]
}
const rowOf = (id) => rawDb.prepare('SELECT password_hash FROM portal_accounts WHERE id = ?').get([id]).password_hash
const signin = (identifier, phoneNumber, password, env = {}) => signinPortalAccount(env, { identifier, phone: phoneNumber, password, consent: true })
const PEPPER_ENV = { PASSWORD_PEPPER: '5eed'.repeat(16) }

let passed = 0
async function check(name, fn) { resetCounts(); await fn(); passed += 1; console.log(`PASS ${name}`) }

async function run() {
  let accountId
  let membershipId
  await check('signup stores the current format', async () => {
    const res = await signupPortalAccount({}, { name: 'Sophea', phone: '097 111 222', password: 'portal-pass-1', consent: true })
    assert.strictEqual(res.ok, true, JSON.stringify(res))
    accountId = res.accountId
    membershipId = res.membershipId
    assert.ok(isCurrentRowFor(rowOf(accountId), 'portal-pass-1'), rowOf(accountId))
    assert.strictEqual(compared.length, 0)
  })

  await check('a legacy bcrypt row signs in and is rewritten once', async () => {
    rawDb.prepare('UPDATE portal_accounts SET password_hash = ? WHERE id = ?').run([bcrypt.hashSync('portal-pass-1', 10), accountId])
    resetCounts()
    const first = await signin('Sophea', '097111222', 'portal-pass-1')
    assert.strictEqual(first.ok, true, JSON.stringify(first))
    assert.strictEqual(compared.length, 1, 'one bcrypt compare for the legacy row')
    assert.deepStrictEqual(derived, [CURRENT_ITERATIONS], 'one derivation: the rewrite')
    const upgraded = rowOf(accountId)
    assert.ok(isCurrentRowFor(upgraded, 'portal-pass-1'), upgraded)
    resetCounts()
    const second = await signin(membershipId, '+855 97 111 222', 'portal-pass-1')
    assert.strictEqual(second.ok, true)
    assert.strictEqual(compared.length, 0, 'no bcrypt once upgraded')
    assert.deepStrictEqual(derived, [CURRENT_ITERATIONS])
    assert.strictEqual(rowOf(accountId), upgraded, 'rewritten exactly once')
  })

  await check('failed sign-ins never rewrite a legacy row', async () => {
    const legacy = bcrypt.hashSync('portal-pass-1', 4)
    rawDb.prepare('UPDATE portal_accounts SET password_hash = ? WHERE id = ?').run([legacy, accountId])
    assert.strictEqual((await signin('Sophea', '097111222', 'wrong-pass-9')).ok, false)
    assert.strictEqual((await signin('Somebody Else', '097111222', 'portal-pass-1')).ok, false, 'right password, wrong identifier')
    assert.strictEqual(rowOf(accountId), legacy)
    assert.strictEqual(compared.length, 2, 'two real bcrypt checks; the row already spent the bcrypt half of the floor')
    assert.deepStrictEqual(derived, [CURRENT_ITERATIONS, CURRENT_ITERATIONS], 'each failure spends only the PBKDF2 half of the floor (the row is unchanged above)')
  })

  await check('an unknown phone spends the bcrypt floor while a bcrypt row remains, the PBKDF2 floor once none does', async () => {
    failedSignInCost.__resetFailedSignInCostForTests()
    const res = await signin('Nobody', '011 000 999', 'whatever-1')
    assert.strictEqual(res.ok, false)
    assert.strictEqual(res.code, 'invalid_credentials')
    assert.deepStrictEqual(derived, [CURRENT_ITERATIONS])
    assert.deepStrictEqual(compared, [passwordHash.DUMMY_BCRYPT_HASH], 'the dummy bcrypt-10 compare')
    const legacy = rowOf(accountId)
    assert.match(legacy, /^\$2[aby]\$/)
    assert.strictEqual((await signin('Sophea', '097111222', 'portal-pass-1')).ok, true, 'the last bcrypt row upgrades')
    resetCounts()
    const after = await signin('Nobody', '011 000 999', 'whatever-1')
    assert.strictEqual(after.ok, false)
    assert.deepStrictEqual(derived, [CURRENT_ITERATIONS])
    assert.strictEqual(compared.length, 0, 'no bcrypt once no bcrypt row remains')
  })

  await check('the staff storefront-password reset writes through hashPassword', async () => {
    const contacts = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'contacts.ts'), 'utf8')
    assert.ok(!/bcrypt/.test(contacts), 'routes/contacts.ts no longer touches bcrypt')
    assert.ok(contacts.includes(".run({ h: await hashPassword(tempPassword, c.env), aid: account.id, customerId: id })"))
    const portalAccounts = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'portalAccounts.ts'), 'utf8')
    assert.ok(!/bcrypt\./.test(portalAccounts), 'lib/portalAccounts.ts never calls bcrypt directly')
  })

  await check('with PASSWORD_PEPPER set, an unpeppered row is rewritten peppered exactly once', async () => {
    const unpeppered = await passwordHash.hashPassword('portal-pass-1', {})
    rawDb.prepare('UPDATE portal_accounts SET password_hash = ? WHERE id = ?').run([unpeppered, accountId])
    assert.strictEqual((await signin('Sophea', '097111222', 'portal-pass-1', PEPPER_ENV)).ok, true)
    const peppered = rowOf(accountId)
    assert.match(peppered, /^\$pbkdf2-sha256\$i=10000\$p=1\$/)
    resetCounts()
    assert.strictEqual((await signin('Sophea', '097111222', 'portal-pass-1', PEPPER_ENV)).ok, true)
    assert.strictEqual(rowOf(accountId), peppered, 'no second rewrite')
    assert.strictEqual((await signin('Sophea', '097111222', 'portal-pass-1', { PASSWORD_PEPPER: 'f00d'.repeat(16) })).ok, false, 'a wrong pepper cannot sign in')
    assert.strictEqual(rowOf(accountId), peppered)
  })

  console.log(`\n${passed} checks passed`)
}

run().catch((error) => { console.error(error); process.exit(1) })
