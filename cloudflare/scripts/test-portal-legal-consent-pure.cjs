// Regression lock for storefront sign-up CONSENT (N45).
//
// The public storefront asks a visitor to agree to the Terms & Conditions and
// the Privacy Policy before an account is created. A checkbox alone is not
// enforcement -- POST /api/portal/auth/signup is a public, unauthenticated
// endpoint anyone can call directly -- so the rule lives in the REAL
// lib/portalAccounts.ts, transpiled and run here against in-memory SQLite with
// every real migration applied. Same harness as test-portal-accounts-pure.cjs.
//
// What this pins:
//   1. signup WITHOUT consent is refused (400 consent_required) and writes NO row
//   2. signup WITH consent stores consent_version + consent_at
//   3. the app still works BEFORE migration 0130 is applied (production runs
//      un-migrated code/database combinations during a deploy window)
//   4. the version string the Worker records matches the frontend's published
//      policy version -- the parity that ties the two halves of the rule together
//   5. the route actually forwards the client's consent to the rule
//   6. the new business-identity settings keys are declared on BOTH sides
//
// Run (from cloudflare/): node scripts/test-portal-legal-consent-pure.cjs

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')
const { openDb } = require('./harness/d1compat.cjs')

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')
const CONSENT_MIGRATION = '0130_portal_account_consent.sql'

function migrationSql(predicate) {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter(predicate)
    .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
}

// The real lib/db.ts D1Compat flattens .run() to { changes, lastInsertRowid }
// and is async; the harness returns the raw D1 shape. Same wrapper the sibling
// account test uses.
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
  const source = fs.readFileSync(sourcePath, 'utf8')
  const { outputText } = ts.transpileModule(source, {
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

// Build one account module bound to a given database.
function buildAccounts(rawDb) {
  const db = wrap(rawDb)
  const dbModule = { getDb: () => db }
  const phone = loadReal('lib/phone.ts')
  const passwordPolicy = loadReal('lib/passwordPolicy.ts')
  const contactOptions = loadReal('lib/contactOptions.ts')
  const membershipNumber = loadReal('lib/membershipNumber.ts')
  const contactDuplicates = loadReal('lib/contactDuplicates.ts', { './contactOptions': contactOptions })
  return loadReal('lib/portalAccounts.ts', {
    './db': dbModule,
    './membershipNumber': membershipNumber,
    './phone': phone,
    './passwordPolicy': passwordPolicy,
    './contactDuplicates': contactDuplicates,
  })
}

const migratedDb = openDb(migrationSql(() => true))
const accounts = buildAccounts(migratedDb)

const env = {}
let passed = 0
async function check(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`) }

async function run() {
  await check('the consent migration exists and is additive, LF-only, with pre/post assertions', () => {
    const file = path.join(MIGRATIONS_DIR, CONSENT_MIGRATION)
    assert.ok(fs.existsSync(file), `${CONSENT_MIGRATION} is missing`)
    const raw = fs.readFileSync(file, 'utf8')
    assert.ok(!raw.includes('\r'), 'migration SQL must be LF-only')
    assert.match(raw, /PRE-ASSERTIONS:/, 'migration header must carry pre-assertions')
    assert.match(raw, /POST-ASSERTIONS:/, 'migration header must carry post-assertions')
    assert.match(raw, /RECOVERY:/, 'migration header must carry a recovery note')
    assert.match(raw, /ALTER TABLE portal_accounts ADD COLUMN consent_version/)
    assert.match(raw, /ALTER TABLE portal_accounts ADD COLUMN consent_at/)
    // Comments explain; only the executable SQL has to be additive.
    const sql = raw.split(/\r?\n/).filter((line) => !line.trim().startsWith('--')).join('\n')
    assert.doesNotMatch(sql, /\bDROP\b|\bDELETE\b|\bUPDATE\b/i, 'migration must be additive only')
  })

  await check('signup without consent is refused and writes no row', async () => {
    const before = migratedDb.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get().n
    for (const value of [undefined, false, 'false', 0, null, '']) {
      const result = await accounts.signupPortalAccount(env, {
        name: 'No Consent', phone: '012 000 111', password: 'sup3rsecret', consent: value,
      })
      assert.strictEqual(result.ok, false, `consent=${String(value)} must be refused`)
      assert.strictEqual(result.status, 400)
      assert.strictEqual(result.code, 'consent_required')
      // A missing checkbox is a form error, not phone/id probing: it must not
      // burn one of the ten attempts before a lockout.
      assert.strictEqual(result.abuse, false)
    }
    const after = migratedDb.prepare('SELECT COUNT(*) AS n FROM portal_accounts').get().n
    assert.strictEqual(after, before, 'a refused signup must not create an account')
  })

  await check('consent is checked before the phone is probed', async () => {
    // Ordering matters: if consent were checked last, a caller could use the
    // signup endpoint as a phone-existence oracle while never consenting.
    const result = await accounts.signupPortalAccount(env, {
      name: '', phone: '', password: '', consent: false,
    })
    assert.strictEqual(result.code, 'consent_required')
  })

  await check('signup with consent succeeds and records the version and time', async () => {
    const result = await accounts.signupPortalAccount(env, {
      name: 'Consented Customer', phone: '012 222 333', password: 'sup3rsecret', consent: true,
    })
    assert.strictEqual(result.ok, true, `signup failed: ${result.error || ''}`)
    const row = migratedDb.prepare('SELECT consent_version, consent_at, name FROM portal_accounts WHERE id = ?').get([result.accountId])
    assert.strictEqual(row.name, 'Consented Customer')
    assert.strictEqual(row.consent_version, accounts.PORTAL_CONSENT_VERSION)
    assert.ok(row.consent_at, 'consent_at must be stored')
    assert.match(String(row.consent_at), /^\d{4}-\d{2}-\d{2}/, `consent_at looks wrong: ${row.consent_at}`)
  })

  await check('"true" from a form post counts as consent', async () => {
    const result = await accounts.signupPortalAccount(env, {
      name: 'String Consent', phone: '012 444 555', password: 'sup3rsecret', consent: 'true',
    })
    assert.strictEqual(result.ok, true, `signup failed: ${result.error || ''}`)
  })

  await check('signup still works BEFORE migration 0130 is applied', async () => {
    // A deploy puts new code in front of an un-migrated database for a while.
    // The account must still be creatable; only the consent columns are lost.
    const preDb = openDb(migrationSql((f) => f !== CONSENT_MIGRATION))
    const columns = preDb.prepare('PRAGMA table_info("portal_accounts")').all().map((r) => r.name)
    assert.ok(!columns.includes('consent_version'), 'the pre-migration fixture already has the column')
    const preAccounts = buildAccounts(preDb)
    const refused = await preAccounts.signupPortalAccount(env, {
      name: 'Pre Migration', phone: '012 666 777', password: 'sup3rsecret',
    })
    assert.strictEqual(refused.code, 'consent_required', 'the rule must hold before the migration too')
    const result = await preAccounts.signupPortalAccount(env, {
      name: 'Pre Migration', phone: '012 666 777', password: 'sup3rsecret', consent: true,
    })
    assert.strictEqual(result.ok, true, `pre-migration signup failed: ${result.error || ''}`)
    const row = preDb.prepare('SELECT name FROM portal_accounts WHERE id = ?').get([result.accountId])
    assert.strictEqual(row.name, 'Pre Migration')
  })

  await check('the Worker and the storefront publish the SAME consent version', () => {
    const frontend = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'catalog', 'legal', 'legalContent.ts'),
      'utf8',
    )
    const iso = frontend.match(/PORTAL_LEGAL_LAST_UPDATED_ISO = '(\d{4}-\d{2}-\d{2})'/)
    assert.ok(iso, 'the storefront does not declare PORTAL_LEGAL_LAST_UPDATED_ISO')
    assert.match(frontend, /PORTAL_LEGAL_CONSENT_VERSION = `portal-legal-\$\{PORTAL_LEGAL_LAST_UPDATED_ISO\}`/)
    assert.strictEqual(
      accounts.PORTAL_CONSENT_VERSION,
      `portal-legal-${iso[1]}`,
      'the Worker records a different consent version than the policy the storefront shows',
    )
  })

  await check('the signup route forwards the visitor consent into the rule', () => {
    const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'portal.ts'), 'utf8')
    assert.match(route, /signupPortalAccount\(c\.env, \{[^}]*consent: body\.consent/s, 'POST /auth/signup drops body.consent')
  })

  await check('the new business-identity keys are declared on both sides', () => {
    const backend = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'settings.ts'), 'utf8')
    const frontend = fs.readFileSync(
      path.join(__dirname, '..', '..', 'frontend', 'src', 'utils', 'portalPermissions.ts'),
      'utf8',
    )
    for (const key of ['business_legal_name', 'business_registration_number']) {
      assert.ok(backend.includes(`'${key}'`), `settings.ts does not bucket ${key}`)
      assert.ok(frontend.includes(`'${key}'`), `portalPermissions.ts does not mirror ${key}`)
    }
    // ...and /config must actually publish them, or the footer renders blank.
    const portalRoute = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'portal.ts'), 'utf8')
    assert.match(portalRoute, /businessLegalName: settings\.business_legal_name/)
    assert.match(portalRoute, /businessRegistrationNumber: settings\.business_registration_number/)
  })

  console.log(`\nALL ${passed} CHECKS PASSED`)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
