// APP_ENCRYPTION_KEY health readout (security lane S-secrets, Sep 26 2026).
//
// The owner needs to see whether the key is configured, because without it
// every secret write is refused. The readout rides on the existing
// integration doctor (GET /api/system/integration-doctor) -- no new public
// endpoint -- and:
//   - is present for an admin, as a boolean (`configured`), never the value;
//   - is absent for a backup-only account the doctor otherwise answers;
//   - reports an invalid (not 32-byte) key the same as a missing one.
// Real routes/compat.ts and real lib/secretCrypto.ts; unrelated probes are
// stubbed.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const tsCache = new Map()
function loadReal(relPath, overrides = {}) {
  return loadFile(path.join(__dirname, '..', 'src', relPath), overrides)
}
function loadFile(sourcePath, overrides) {
  const plain = !Object.keys(overrides).length
  if (plain && tsCache.has(sourcePath)) return tsCache.get(sourcePath)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText
  const nodeRequire = Module.createRequire(sourcePath)
  const localRequire = (request) => {
    if (request in overrides) return overrides[request]
    if (request.startsWith('.')) {
      const candidate = path.resolve(path.dirname(sourcePath), request) + '.ts'
      if (fs.existsSync(candidate)) return loadFile(candidate, {})
    }
    return nodeRequire(request)
  }
  const moduleObj = { exports: {} }
  if (plain) tsCache.set(sourcePath, moduleObj.exports)
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
    moduleObj.exports, localRequire, moduleObj, sourcePath, path.dirname(sourcePath),
  )
  if (plain) tsCache.set(sourcePath, moduleObj.exports)
  return moduleObj.exports
}

const KEY = 'd'.repeat(64)
const secretCrypto = loadReal('lib/secretCrypto.ts')

// ---- the pure readout ------------------------------------------------------
{
  const missing = secretCrypto.secretEncryptionStatus(undefined)
  assert.deepEqual(
    { ok: missing.ok, status: missing.status, configured: missing.configured },
    { ok: false, status: 'needs_attention', configured: false },
  )
  const invalid = secretCrypto.secretEncryptionStatus('short-key')
  assert.equal(invalid.configured, false, 'an unusable key reports as not configured')
  assert.ok(!invalid.message.includes('short-key'), 'message never echoes the key')
  const present = secretCrypto.secretEncryptionStatus(KEY)
  assert.deepEqual(
    { ok: present.ok, status: present.status, configured: present.configured },
    { ok: true, status: 'ok', configured: true },
  )
  assert.ok(!JSON.stringify(present).includes(KEY), 'readout never contains the key')
}

// ---- the doctor route ------------------------------------------------------
let currentUser = null
const compat = loadReal('routes/compat.ts', {
  '../lib/auth': { requireAuth: async (c, next) => { c.set('user', currentUser); await next() } },
  '../lib/backup': {
    listCloudflareBackups: async () => [],
    getSystemJob: async () => null, listSystemJobs: async () => [], storeSystemJob: async () => {},
  },
  '../lib/googleDrive': {
    driveSyncStatus: async () => ({ item: { connected: false, configured: false } }),
    buildDriveOauthStartUrl: async () => ({}), completeDriveOauth: async () => ({}),
    consumeDriveOauthState: async () => ({}), disconnectDrive: async () => ({}), updateDrivePreferences: async () => ({}),
  },
  '../lib/driveSyncQueue': { enqueueDriveRestoreStageJob: async () => ({}), enqueueDriveSyncJob: async () => ({}) },
  '../lib/quotaGuard': { readAllQuotas: async () => ({}) },
  './reports': { gateTotals: (x) => x },
  '../lib/secretCrypto': secretCrypto,
}).default

const ADMIN = { id: 1, username: 'owner', role_code: 'admin', permissions: '{}', role_permissions: '{}' }
const BACKUP_ONLY = { id: 2, username: 'clerk', role_code: 'staff', permissions: JSON.stringify({ backup: true }), role_permissions: '{}' }

function envWith(key) {
  const env = {
    DB: { prepare: () => ({ first: async () => ({ ok: 1 }) }) },
    IMPORT_QUEUE: {}, MEDIA_QUEUE: {}, ASSETS: {}, CACHE: {},
  }
  if (key !== undefined) env.APP_ENCRYPTION_KEY = key
  return env
}

async function doctor(user, key) {
  currentUser = user
  const res = await compat.request('/system/integration-doctor', { method: 'GET' }, envWith(key), { waitUntil() {} })
  const text = await res.text()
  return { status: res.status, text, json: JSON.parse(text) }
}

async function main() {
  const adminMissing = await doctor(ADMIN, undefined)
  assert.equal(adminMissing.status, 200, adminMissing.text)
  assert.ok(adminMissing.json.checks.secretEncryption, 'admin sees the encryption-key readout')
  assert.equal(adminMissing.json.checks.secretEncryption.configured, false)
  assert.equal(adminMissing.json.ok, false, 'a missing key counts against the overall verdict')

  const adminInvalid = await doctor(ADMIN, 'not-a-usable-key')
  assert.equal(adminInvalid.json.checks.secretEncryption.configured, false)
  assert.ok(!adminInvalid.text.includes('not-a-usable-key'), 'the doctor never echoes the key')

  const adminPresent = await doctor(ADMIN, KEY)
  assert.equal(adminPresent.json.checks.secretEncryption.configured, true)
  assert.equal(adminPresent.json.checks.secretEncryption.ok, true)
  assert.ok(!adminPresent.text.includes(KEY), 'the doctor never echoes the key')

  const clerk = await doctor(BACKUP_ONLY, undefined)
  assert.equal(clerk.status, 200, 'backup-only accounts still get the doctor')
  assert.equal(clerk.json.checks.secretEncryption, undefined, 'the readout is admin-only')

  console.log('secret encryption health readout: ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
