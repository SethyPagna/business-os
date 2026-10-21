// Storefront consent versions. Owner, 20 Oct 2026: the age-16 wording moved the
// version to portal-legal-2026-10-20 and nothing earlier is accepted, so every
// account agrees again; an account is current only with that exact version AND
// a stored age confirmation (age_confirmed_at, migration 0262).
//
// Runs the REAL lib/portalAccounts.ts and lib/portalSession.ts, transpiled,
// against in-memory SQLite with every migration applied.
//
// Run (from cloudflare/): node scripts/test-portal-consent-version-accepted-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { loadRealPasswordHash, loadRealFailedSignInCost } = require('./harness/password_hash_stub.cjs')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const CURRENT = 'portal-legal-2026-10-20'
const EARLIER = 'portal-legal-2026-09-30'
const OLDEST = 'portal-legal-2026-09-07'

function wrap(rawDb) {
  return {
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

const rawDb = openDb(fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')))
const db = wrap(rawDb)
const dbModule = { getDb: () => db }
const phone = loadReal('lib/phone.ts')
const contactOptions = loadReal('lib/contactOptions.ts')
const sqlBinding = loadReal('lib/sqlBinding.ts')
const anonymousCustomer = loadReal('lib/anonymousCustomer.ts')
const accounts = loadReal('lib/portalAccounts.ts', {
  './db': dbModule,
  './membershipNumber': loadReal('lib/membershipNumber.ts'),
  './phone': phone,
  './passwordPolicy': loadReal('lib/passwordPolicy.ts'),
  './contactDuplicates': loadReal('lib/contactDuplicates.ts', { './contactOptions': contactOptions, './phone': phone, './sqlBinding': sqlBinding }),
  './anonymousCustomer': anonymousCustomer,
  './passwordHash': loadRealPasswordHash(),
  './failedSignInCost': loadRealFailedSignInCost(),
})

const jar = { value: null }
const session = loadReal('lib/portalSession.ts', {
  './db': dbModule,
  './portalAccounts': accounts,
  './anonymousCustomer': anonymousCustomer,
  'hono/cookie': { getCookie: () => jar.value, setCookie: (_c, _n, value) => { jar.value = value }, deleteCookie: () => { jar.value = null } },
})
const pending = []
const ctx = { env: {}, executionCtx: { waitUntil: (p) => { pending.push(p) } } }
const settle = async () => { while (pending.length) await pending.shift() }

let seq = 0
async function signedInWith(version, consentAt = 'CURRENT_TIMESTAMP', ageAt = 'CURRENT_TIMESTAMP') {
  seq += 1
  const inserted = rawDb.prepare(
    `INSERT INTO portal_accounts (membership_id, name, phone, password_hash, consent_version, consent_at, consent_locale, age_confirmed_at)
     VALUES (@m, 'Consent Version', @p, 'x', @v, ${consentAt}, 'km', ${ageAt})`,
  ).run({ m: `LC-8${String(seq).padStart(4, '0')}`, p: `0708887${String(seq).padStart(2, '0')}`, v: version })
  const accountId = Number(inserted.meta?.last_row_id ?? 0)
  const { token } = await session.createPortalSession(ctx.env, accountId)
  jar.value = token
  const state = await session.getPortalAccountState(ctx)
  await settle()
  return { accountId, state }
}

let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function run() {
  await check('the Worker records the 20 Oct 2026 policy version', () => {
    assert.strictEqual(accounts.PORTAL_CONSENT_VERSION, CURRENT)
  })

  await check('only the current version is accepted; every earlier or unknown one is refused', () => {
    assert.strictEqual(accounts.portalConsentVersionAccepted(CURRENT), true)
    for (const unknown of [EARLIER, OLDEST, 'portal-legal-2026-01-01', 'portal-legal-older', ` ${CURRENT}`, CURRENT.toUpperCase(), '', null, undefined, 20261020]) {
      assert.strictEqual(accounts.portalConsentVersionAccepted(unknown), false, `${String(unknown)} must be refused`)
    }
  })

  await check('a customer who agreed to the current text with an age confirmation is signed in', async () => {
    const { accountId, state } = await signedInWith(CURRENT)
    assert.strictEqual(state.status, 'authenticated')
    assert.strictEqual(state.account.id, accountId)
  })

  await check('an account on any earlier or unknown version must agree again, and reading never rewrites the record', async () => {
    for (const version of [EARLIER, OLDEST, 'portal-legal-2026-01-01', 'portal-legal-older']) {
      const { accountId, state } = await signedInWith(version)
      assert.strictEqual(state.status, 'reconsent_required')
      assert.strictEqual(state.account, null)
      assert.strictEqual(state.accountId, accountId)
      assert.strictEqual(rawDb.prepare('SELECT consent_version FROM portal_accounts WHERE id = ?').get([accountId]).consent_version, version)
    }
  })

  await check('the current version without a consent time or without an age confirmation is still refused', async () => {
    assert.strictEqual((await signedInWith(CURRENT, 'NULL')).state.status, 'reconsent_required')
    assert.strictEqual((await signedInWith(CURRENT, 'CURRENT_TIMESTAMP', 'NULL')).state.status, 'reconsent_required')
  })

  await check('a new sign-up records the current version', async () => {
    const result = await accounts.signupPortalAccount(ctx.env, { name: 'New Consent', phone: '012 777 888', password: 'sup3rsecret', consent: true, ageConfirmed: true })
    assert.strictEqual(result.ok, true, `signup failed: ${result.error || ''}`)
    const row = rawDb.prepare('SELECT consent_version, age_confirmed_at FROM portal_accounts WHERE id = ?').get([result.accountId])
    assert.strictEqual(row.consent_version, CURRENT)
    assert.ok(row.age_confirmed_at, 'the age confirmation is stored with the consent')
  })

  console.log(`\nALL ${passed} CHECKS PASSED`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
