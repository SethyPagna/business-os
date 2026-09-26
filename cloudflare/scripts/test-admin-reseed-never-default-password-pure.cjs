// Security (compliance audit P1): the production Worker never seeds a known
// admin password.
//
// ensureCoreDataInvariants() used to seed the `admin` user with the literal
// fallback 'Admin123456!' whenever BUSINESS_OS_ADMIN_PASSWORD was unset and
// no admin row existed. The repository is public, so that password was too.
//
// Owner decision (26 Sep 2026):
//   - BUSINESS_OS_ADMIN_PASSWORD set          -> use it, exactly as given.
//   - unset, production                       -> never a known password. We
//     SKIP seeding and log one instruction line (no password). A random
//     password was rejected: nothing renders it (factory reset's response
//     field is not shown, the middleware discards the result), there is no
//     must-change column, and once an admin row exists seeding never runs
//     again -- so setting the secret later could not recover the account.
//   - unset, local dev                        -> the demo password admin123.
//     Local dev = BUSINESS_OS_LOCAL_DEV=1 (a .dev.vars opt-in, which only
//     `wrangler dev` reads) AND an unstamped build (scripts/deploy.cjs stamps
//     every production deploy). Either signal alone is not enough.
//
// Run: node scripts/test-admin-reseed-never-default-password-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const Module = require('node:module')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

const SRC = path.join(__dirname, '..', 'src')

function loadReal(relPath, overrides = {}) {
  const sourcePath = path.join(SRC, relPath)
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: sourcePath,
  })
  const originalLoad = Module._load
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request in overrides) return overrides[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  try {
    const module = { exports: {} }
    new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
      module.exports, require, module, sourcePath, path.dirname(sourcePath),
    )
    return module.exports
  } finally {
    Module._load = originalLoad
  }
}

function wrapDb(raw) {
  return {
    prepare(sql) {
      const statement = raw.prepare(sql)
      return {
        get: async (params) => statement.get(params),
        all: async (params) => statement.all(params) || [],
        run: async (params) => {
          const result = statement.run(params)
          return { changes: Number(result.meta?.changes || 0), lastInsertRowid: Number(result.meta?.last_row_id || 0) }
        },
      }
    },
  }
}

const hashed = []
let currentDb = null
let stamped = false
// The esbuild define scripts/deploy.cjs stamps onto every production build.
Object.defineProperty(globalThis, '__WORKER_BUILD_REVISION__', { configurable: true, get: () => (stamped ? 'abc1234' : undefined) })
const core = loadReal('lib/coreDataInvariants.ts', {
  './customTableName': loadReal('lib/customTableName.ts'),
  './db': { getDb: () => currentDb },
  './sqlBinding': loadReal('lib/sqlBinding.ts'),

  '../index': {},
  bcryptjs: { __esModule: true, default: { hashSync: (password) => { hashed.push(password); return `hash:${password.length}` } } },
})

const baseEnv = { BUSINESS_OS_ORGANIZATION_NAME: 'Test OS', BUSINESS_OS_ORGANIZATION_SLUG: 'test-os' }
const KNOWN = ['admin123', 'Admin123456!']

function fresh() {
  const raw = openDb(loadAll())
  currentDb = wrapDb(raw)
  hashed.length = 0
  stamped = false
  return raw
}

function adminRows(raw) {
  return raw.prepare("SELECT id, password FROM users WHERE lower(trim(username)) = 'admin'").all({})
}

async function withConsole(fn) {
  const lines = []
  const original = { warn: console.warn, log: console.log, error: console.error, info: console.info }
  for (const key of Object.keys(original)) console[key] = (...args) => lines.push(args.map(String).join(' '))
  try { await fn() } finally { Object.assign(console, original) }
  return lines
}

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log(`PASS ${name}`)
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
}

async function main() {
  await check("the literal 'Admin123456!' appears nowhere in cloudflare/src or ops/", async () => {
    const roots = [SRC, path.join(__dirname, '..', '..', 'ops')].filter((dir) => fs.existsSync(dir))
    const hits = roots.flatMap(walk).filter((file) => fs.readFileSync(file, 'utf8').includes('Admin123456!'))
    assert.deepEqual(hits, [])
  })

  // Every way the production Worker can run without the secret. None may
  // produce a known password -- or any admin row at all.
  const productionCases = [
    ['unset', {}, false],
    ['blank', { BUSINESS_OS_ADMIN_PASSWORD: '   ' }, false],
    ['stamped deploy even with the local flag set', { BUSINESS_OS_LOCAL_DEV: '1' }, true],
    ['unstamped build without the local flag (bare wrangler deploy)', {}, false],
    ['local flag with a non-opt-in value', { BUSINESS_OS_LOCAL_DEV: 'false' }, false],
  ]
  for (const [label, extra, isStamped] of productionCases) {
    await check(`production, env password ${label}: no known password, no admin, one instruction line`, async () => {
      const raw = fresh()
      stamped = isStamped
      let result
      const lines = await withConsole(async () => { result = await core.ensureCoreDataInvariants({ ...baseEnv, ...extra }) })
      assert.equal(adminRows(raw).length, 0, 'no admin row without a configured password')
      assert.deepEqual(hashed, [], 'nothing was hashed, so no password was chosen')
      assert.equal(result.adminUserCreated, false)
      assert.equal(result.adminPassword, null)
      assert.equal(result.adminUserId, null)
      // The rest of first-run seeding still happens.
      assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM roles WHERE code IN ('admin','manager','employee')").get({}).n, 3)
      assert.equal(raw.prepare('SELECT COUNT(*) AS n FROM branches').get({}).n, 2)
      const relevant = lines.filter((line) => /BUSINESS_OS_ADMIN_PASSWORD/.test(line))
      assert.equal(relevant.length, 1, `exactly one instruction line, saw: ${JSON.stringify(lines)}`)
      for (const known of KNOWN) assert.equal(lines.join('\n').includes(known), false, `log must not carry ${known}`)
    })
  }

  await check('local dev (BUSINESS_OS_LOCAL_DEV=1, unstamped build): seeds admin with admin123', async () => {
    const raw = fresh()
    const result = await withConsole(() => core.ensureCoreDataInvariants({ ...baseEnv, BUSINESS_OS_LOCAL_DEV: '1' }))
      .then(() => null)
    void result
    assert.equal(adminRows(raw).length, 1)
    assert.deepEqual(hashed, ['admin123'])
  })

  await check('local dev returns the demo password so factory reset can show it', async () => {
    fresh()
    let result
    await withConsole(async () => { result = await core.ensureCoreDataInvariants({ ...baseEnv, BUSINESS_OS_LOCAL_DEV: 'true' }) })
    assert.equal(result.adminUserCreated, true)
    assert.equal(result.adminPassword, 'admin123')
  })

  await check('a configured password always wins, in production and in local dev, exactly as given', async () => {
    fresh()
    stamped = true
    await core.ensureCoreDataInvariants({ ...baseEnv, BUSINESS_OS_ADMIN_PASSWORD: ' pad-Secret-2 ' })
    assert.deepEqual(hashed, [' pad-Secret-2 '])
    fresh()
    await core.ensureCoreDataInvariants({ ...baseEnv, BUSINESS_OS_LOCAL_DEV: '1', BUSINESS_OS_ADMIN_PASSWORD: 'Configured-Secret-4' })
    assert.deepEqual(hashed, ['Configured-Secret-4'])
  })

  await check('production recovery: set the secret and the next run seeds the admin with it', async () => {
    const raw = fresh()
    stamped = true
    await withConsole(() => core.ensureCoreDataInvariants({ ...baseEnv }))
    assert.equal(adminRows(raw).length, 0)
    const result = await core.ensureCoreDataInvariants({ ...baseEnv, BUSINESS_OS_ADMIN_PASSWORD: 'Configured-Secret-1' })
    assert.equal(adminRows(raw).length, 1)
    assert.deepEqual(hashed, ['Configured-Secret-1'])
    assert.equal(result.adminUserCreated, true)
    assert.equal(result.adminPassword, 'Configured-Secret-1')
  })

  // --- P0 takeover: seeding is keyed on "no active admin-role user", never on
  // the literal username 'admin'. -----------------------------------------
  async function ownerOnly(extra = {}) {
    const raw = fresh()
    await withConsole(() => core.ensureCoreDataInvariants({ ...baseEnv, BUSINESS_OS_ADMIN_PASSWORD: 'Initial-Secret' }))
    // The owner renames the seeded admin account.
    raw.prepare("UPDATE users SET username = 'owner', name = 'Owner' WHERE lower(trim(username)) = 'admin'").run({})
    hashed.length = 0
    return raw
  }
  const adminRoleUsers = (raw) => raw.prepare(`SELECT u.username FROM users u JOIN roles r ON r.id = u.role_id
    WHERE r.code = 'admin' ORDER BY u.id`).all({}).map((row) => row.username)

  for (const [label, env, isStamped] of [
    ['production, no secret', {}, true],
    ['production, secret set', { BUSINESS_OS_ADMIN_PASSWORD: 'Configured-Secret-5' }, true],
    ['local dev', { BUSINESS_OS_LOCAL_DEV: '1' }, false],
  ]) {
    await check(`renamed admin ('owner' holds the admin role), ${label}: no 'admin' row is created`, async () => {
      const raw = await ownerOnly()
      stamped = isStamped
      for (let isolate = 0; isolate < 3; isolate += 1) {
        await withConsole(() => core.ensureCoreDataInvariants({ ...baseEnv, ...env }))
      }
      assert.equal(adminRows(raw).length, 0, 'the admin account must never be re-created while an admin exists')
      assert.deepEqual(adminRoleUsers(raw), ['owner'])
      assert.deepEqual(hashed, [], 'no password was chosen')
    })
  }

  await check("soft-deleted 'admin' while 'owner' is an active admin: nothing re-created", async () => {
    const raw = await ownerOnly()
    raw.prepare(`INSERT INTO users (username, name, password, role_id, permissions, is_active, deleted_at)
      SELECT 'admin', 'Old', 'x', id, '{}', 1, CURRENT_TIMESTAMP FROM roles WHERE code = 'admin' LIMIT 1`).run({})
    stamped = true
    await withConsole(() => core.ensureCoreDataInvariants({ ...baseEnv, BUSINESS_OS_LOCAL_DEV: '1' }))
    assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM users WHERE lower(trim(username)) = 'admin' AND deleted_at IS NULL").get({}).n, 0)
    assert.deepEqual(hashed, [])
  })

  await check("an inactive 'admin' row and no active admin: warned, never duplicated or re-passworded", async () => {
    const raw = fresh()
    await withConsole(() => core.ensureCoreDataInvariants({ ...baseEnv, BUSINESS_OS_ADMIN_PASSWORD: 'Initial-Secret' }))
    raw.prepare("UPDATE users SET is_active = 0 WHERE lower(trim(username)) = 'admin'").run({})
    // Drift the admin role so the fast path hands over to the write path,
    // which is where seeding is decided.
    raw.prepare(`UPDATE roles SET permissions = '{"all":false}' WHERE code = 'admin'`).run({})
    const before = adminRows(raw)
    hashed.length = 0
    const lines = await withConsole(() => core.ensureCoreDataInvariants({ ...baseEnv, BUSINESS_OS_ADMIN_PASSWORD: 'Other-Secret' }))
    assert.deepEqual(adminRows(raw), before)
    assert.deepEqual(hashed, [])
    assert.equal(lines.filter((line) => /No active admin-role user/.test(line)).length, 1)
  })

  await check('negative control, empty users table: local dev seeds admin123, production seeds nothing', async () => {
    const dev = fresh()
    stamped = false
    await withConsole(() => core.ensureCoreDataInvariants({ ...baseEnv, BUSINESS_OS_LOCAL_DEV: '1' }))
    assert.equal(adminRows(dev).length, 1)
    assert.deepEqual(hashed, ['admin123'])
    const prod = fresh()
    stamped = true
    await withConsole(() => core.ensureCoreDataInvariants({ ...baseEnv }))
    assert.equal(prod.prepare('SELECT COUNT(*) AS n FROM users').get({}).n, 0)
    assert.deepEqual(hashed, [])
  })

  await check('an existing admin with the env unset: untouched, and nothing is logged', async () => {
    const raw = fresh()
    await core.ensureCoreDataInvariants({ ...baseEnv, BUSINESS_OS_ADMIN_PASSWORD: 'Configured-Secret-3' })
    const before = adminRows(raw)
    stamped = true
    const lines = await withConsole(() => core.ensureCoreDataInvariants({ ...baseEnv }))
    assert.deepEqual(adminRows(raw), before)
    assert.equal(lines.filter((line) => /BUSINESS_OS_ADMIN_PASSWORD/.test(line)).length, 0)
  })

  console.log(`\n${passed} admin seed password checks passed.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
