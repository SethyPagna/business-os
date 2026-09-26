// P1-2 (Release 1 auth audit). A Drive sync uploads the whole database
// backup, acquisition costs included, to whichever Google account connected
// the integration. Connecting (oauth/start) and enabling (preferences) only
// needed the `settings` grant, so a settings-only user could aim every
// scheduled full backup at their own Drive -- although the manual push
// already demanded cost-view.
//
// Now: connect and enable need `backup` + cost-view (lib/driveSyncAuthority
// canAuthorizeDriveSync); the OAuth callback records the authoriser; the cron
// path and the queue worker re-check that stored authoriser at run time.
//
// Drives the REAL routes/compat.ts and lib/driveSyncAuthority.ts against the
// migrated schema. Fails on a04da325.
//
// Run: node scripts/test-drive-sync-authority-pure.cjs

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { openDb } = require('./harness/d1compat.cjs')
const { loadAll } = require('./harness/load_migrations.cjs')

let passed = 0
const failures = []
async function check(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${name}`)
  } catch (error) {
    failures.push(name)
    console.log(`FAIL ${name}: ${String(error.message).split(/\r?\n/)[0]}`)
  }
}

const raw = openDb(loadAll())
// lib/db.ts's D1Compat answers run() with { changes }.
const db = {
  prepare(sql) {
    const stmt = raw.prepare(sql)
    return {
      get: async (p) => stmt.get(p),
      all: async (p) => stmt.all(p),
      run: async (p) => { const info = stmt.run(p); return { changes: info.meta?.changes ?? 0, lastInsertRowid: Number(info.meta?.last_row_id ?? 0) } },
    }
  },
  batch: (items) => raw.batch(items),
}

let sessionUser = null
const overrides = {
  '../lib/db': { getDb: () => db },
  './db': { getDb: () => db },
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', sessionUser); return next() } },
}
const cache = new Map()
function load(rel) {
  if (cache.has(rel)) return cache.get(rel).exports
  const sourcePath = path.join(__dirname, '..', 'src', rel)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: sourcePath,
  }).outputText
  const mod = { exports: {} }
  cache.set(rel, mod)
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(overrides, request)) return overrides[request]
    if (!request.startsWith('.')) return require(request)
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), request))
    return load(resolved.endsWith('.ts') ? resolved : `${resolved}.ts`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, mod, mod.exports)
  return mod.exports
}

const kv = new Map()
const env = {
  DB: raw,
  CACHE: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, String(v)) }, delete: async (k) => { kv.delete(k) } },
  GOOGLE_DRIVE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  AUTH_SESSION_SECRET: 'state-secret-for-tests-only-0123456789',
  APP_ENCRYPTION_KEY: '',
  BUSINESS_OS_ADMIN_URL: 'https://admin.example.test',
  BUSINESS_OS_API_URL: 'https://admin.example.test',
}

const USERS = {
  settingsOnly: { id: 901, username: 'settings-only', permissions: { settings: true } },
  settingsAndCost: { id: 902, username: 'settings-cost', permissions: { settings: true, product_cost_view: true } },
  backupNoCost: { id: 903, username: 'backup-no-cost', permissions: { settings: true, backup: true } },
  backupAndCost: { id: 904, username: 'backup-cost', permissions: { settings: true, backup: true, product_cost_view: true } },
  admin: { id: 905, username: 'owner', permissions: { all: true } },
  inactive: { id: 906, username: 'gone', permissions: { settings: true, backup: true, product_cost_view: true }, is_active: 0 },
}
for (const u of Object.values(USERS)) {
  raw.prepare(`INSERT INTO users (id, username, name, password, permissions, is_active) VALUES (@id, @username, @username, 'x', @permissions, @active)`)
    .run({ id: u.id, username: u.username, permissions: JSON.stringify(u.permissions), active: u.is_active ?? 1 })
}
const session = (u) => ({ id: u.id, username: u.username, permissions: JSON.stringify(u.permissions), role_code: null, role_permissions: null })

async function post(app, pathname, body, user) {
  sessionUser = session(user)
  const res = await app.request(pathname, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env, { waitUntil() {}, passThroughOnException() {} })
  let json = null
  try { json = await res.json() } catch (_) {}
  return { status: res.status, body: json }
}
const setting = (key) => raw.prepare('SELECT value FROM settings WHERE key = @key').get({ key })?.value ?? null
function setSetting(key, value) { raw.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)').run({ key, value }) }

async function main() {
  const app = load('routes/compat.ts').default

  await check('a settings-only user can no longer start a Drive connection', async () => {
    const res = await post(app, '/system/drive-sync/oauth/start', { returnOrigin: 'https://admin.example.test', returnPath: '/' }, USERS.settingsOnly)
    assert.equal(res.status, 403)
    const withCost = await post(app, '/system/drive-sync/oauth/start', { returnOrigin: 'https://admin.example.test', returnPath: '/' }, USERS.settingsAndCost)
    assert.equal(withCost.status, 403, 'settings does not stand in for backup')
    const noCost = await post(app, '/system/drive-sync/oauth/start', { returnOrigin: 'https://admin.example.test', returnPath: '/' }, USERS.backupNoCost)
    assert.equal(noCost.status, 403, 'backup without cost-view cannot choose where full backups go')
  })

  await check('backup + cost-view (and admin) can still start a Drive connection', async () => {
    for (const user of [USERS.backupAndCost, USERS.admin]) {
      const res = await post(app, '/system/drive-sync/oauth/start', { returnOrigin: 'https://admin.example.test', returnPath: '/' }, user)
      assert.equal(res.status, 200, `${user.username} must be able to connect`)
      assert.match(res.body.url, /^https:\/\/accounts\.google\.com\//)
    }
  })

  await check('enabling sync in preferences needs the same grants; disabling stays a settings action', async () => {
    setSetting('drive_sync_enabled', '0')
    const enable = await post(app, '/system/drive-sync/preferences', { enabled: true, folderName: 'Mine' }, USERS.settingsOnly)
    assert.equal(enable.status, 403)
    const implicit = await post(app, '/system/drive-sync/preferences', { folderName: 'Mine' }, USERS.settingsOnly)
    assert.equal(implicit.status, 403, 'omitting `enabled` enables, so it is gated too')
    assert.equal(setting('drive_sync_enabled'), '0', 'nothing was switched on')
    const disable = await post(app, '/system/drive-sync/preferences', { enabled: false }, USERS.settingsOnly)
    assert.equal(disable.status, 200, 'anyone who may manage settings can still stop the uploads')
    const entitled = await post(app, '/system/drive-sync/preferences', { enabled: true }, USERS.backupAndCost)
    assert.equal(entitled.status, 200)
    assert.equal(setting('drive_sync_enabled'), '1')
  })

  await check('the run-time check follows the RECORDED authoriser, not whoever is signed in', async () => {
    const { checkDriveSyncAuthorizer } = load('lib/driveSyncAuthority.ts')
    const { DRIVE_SYNC_AUTHORIZED_BY_KEY } = load('lib/googleDrive.ts')
    assert.equal(DRIVE_SYNC_AUTHORIZED_BY_KEY, 'drive_sync_authorized_by')
    setSetting(DRIVE_SYNC_AUTHORIZED_BY_KEY, '')
    assert.equal((await checkDriveSyncAuthorizer(env)).reason, 'authorizer-missing', 'a connection with no recorded authoriser fails closed')
    const expect = { [USERS.settingsOnly.id]: false, [USERS.settingsAndCost.id]: false, [USERS.backupNoCost.id]: false, [USERS.backupAndCost.id]: true, [USERS.admin.id]: true, [USERS.inactive.id]: false, 999: false }
    for (const [id, allowed] of Object.entries(expect)) {
      setSetting(DRIVE_SYNC_AUTHORIZED_BY_KEY, String(id))
      assert.equal((await checkDriveSyncAuthorizer(env)).allowed, allowed, `authoriser ${id}`)
    }
    // Demotion after connecting stops the uploads with no disconnect needed.
    setSetting(DRIVE_SYNC_AUTHORIZED_BY_KEY, String(USERS.backupAndCost.id))
    raw.prepare('UPDATE users SET permissions = @p WHERE id = @id').run({ id: USERS.backupAndCost.id, p: JSON.stringify({ settings: true, backup: true }) })
    assert.equal((await checkDriveSyncAuthorizer(env)).reason, 'authorizer-lacks-grants')
  })

  await check('source lock: the callback records the authoriser, disconnect clears it, cron and worker re-check it', () => {
    const src = (rel) => fs.readFileSync(path.join(__dirname, '..', 'src', rel), 'utf8')
    const compat = src('routes/compat.ts')
    assert.match(compat, /completeDriveOauth\(c\.env, code, stateResult\.payload\?\.codeVerifier \|\| '', Number\(stateResult\.payload\?\.userId \|\| 0\)\)/)
    const drive = src('lib/googleDrive.ts')
    const complete = drive.slice(drive.indexOf('export async function completeDriveOauth'), drive.indexOf('export async function disconnectDrive'))
    assert.match(complete, /\[DRIVE_SYNC_AUTHORIZED_BY_KEY, String\(authorizer\)\]/)
    const disconnect = drive.slice(drive.indexOf('export async function disconnectDrive'))
    assert.match(disconnect.slice(0, 600), /\[DRIVE_SYNC_AUTHORIZED_BY_KEY, ''\]/)
    const index = src('index.ts')
    const cronAt = index.indexOf("runStep('drive-sync'")
    const cron = index.slice(cronAt, cronAt + 900)
    assert.ok(cron.indexOf('checkDriveSyncAuthorizer(env)') > -1 && cron.indexOf('checkDriveSyncAuthorizer(env)') < cron.indexOf("enqueueDriveSyncJob(env, 'scheduled')"), 'cron re-checks before enqueueing')
    const queue = src('lib/driveSyncQueue.ts')
    const run = queue.slice(queue.indexOf('export async function runQueuedDriveSync'))
    assert.ok(run.indexOf('checkDriveSyncAuthorizer(env)') > -1 && run.indexOf('checkDriveSyncAuthorizer(env)') < run.indexOf('pushBackupToDrive(env)'), 'the worker re-checks before pushing')
  })

  if (failures.length) throw new Error(`${failures.length} check(s) failed`)
  console.log(`test-drive-sync-authority-pure.cjs: ${passed} checks passed`)
}

main().catch((error) => {
  console.error('test-drive-sync-authority-pure.cjs FAILED')
  console.error(error)
  process.exitCode = 1
})
