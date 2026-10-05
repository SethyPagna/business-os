// Storefront consent versions (owner, 30 Sep 2026). The policy text moved to
// portal-legal-2026-09-30; customers who agreed to portal-legal-2026-09-07 stay
// signed in and are not asked again, while an unknown version is refused.
//
// Runs the REAL lib/portalAccounts.ts and lib/portalSession.ts, transpiled,
// against in-memory SQLite with every migration applied.
//
// Run (from cloudflare/): node scripts/test-portal-consent-version-accepted-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const { loadRealPasswordHash } = require('./harness/password_hash_stub.cjs')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const CURRENT = 'portal-legal-2026-09-30'
const EARLIER = 'portal-legal-2026-09-07'

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
async function signedInWith(version, consentAt = 'CURRENT_TIMESTAMP') {
  seq += 1
  const inserted = rawDb.prepare(
    `INSERT INTO portal_accounts (membership_id, name, phone, password_hash, consent_version, consent_at, consent_locale)
     VALUES (@m, 'Consent Version', @p, 'x', @v, ${consentAt}, 'km')`,
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
  await check('the Worker records the 30 Sep 2026 policy version', () => {
    assert.strictEqual(accounts.PORTAL_CONSENT_VERSION, CURRENT)
  })

  await check('the current version and the 7 Sep 2026 version are accepted; anything else is refused', () => {
    assert.strictEqual(accounts.portalConsentVersionAccepted(CURRENT), true)
    assert.strictEqual(accounts.portalConsentVersionAccepted(EARLIER), true)
    for (const unknown of ['portal-legal-2026-01-01', 'portal-legal-older', ` ${EARLIER}`, EARLIER.toUpperCase(), '', null, undefined, 20260907]) {
      assert.strictEqual(accounts.portalConsentVersionAccepted(unknown), false, `${String(unknown)} must be refused`)
    }
  })

  await check('a customer who agreed to the 7 Sep 2026 text stays signed in without being asked again', async () => {
    const { accountId, state } = await signedInWith(EARLIER)
    assert.strictEqual(state.status, 'authenticated')
    assert.strictEqual(state.account.id, accountId)
    const row = rawDb.prepare('SELECT consent_version FROM portal_accounts WHERE id = ?').get([accountId])
    assert.strictEqual(row.consent_version, EARLIER, 'reading a session never rewrites the recorded consent')
  })

  await check('a customer who agreed to the 30 Sep 2026 text is signed in', async () => {
    const { state } = await signedInWith(CURRENT)
    assert.strictEqual(state.status, 'authenticated')
  })

  await check('an unknown consent version is refused and asked to agree again', async () => {
    for (const version of ['portal-legal-2026-01-01', 'portal-legal-older']) {
      const { state } = await signedInWith(version)
      assert.deepStrictEqual(state, { status: 'reconsent_required', account: null })
    }
  })

  await check('an accepted version without a consent time is still refused', async () => {
    const { state } = await signedInWith(EARLIER, 'NULL')
    assert.deepStrictEqual(state, { status: 'reconsent_required', account: null })
  })

  await check('a new sign-up records the current version', async () => {
    const result = await accounts.signupPortalAccount(ctx.env, { name: 'New Consent', phone: '012 777 888', password: 'sup3rsecret', consent: true })
    assert.strictEqual(result.ok, true, `signup failed: ${result.error || ''}`)
    const row = rawDb.prepare('SELECT consent_version FROM portal_accounts WHERE id = ?').get([result.accountId])
    assert.strictEqual(row.consent_version, CURRENT)
  })

  console.log(`\nALL ${passed} CHECKS PASSED`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
