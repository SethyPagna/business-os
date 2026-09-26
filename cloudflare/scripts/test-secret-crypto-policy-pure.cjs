// Secret-at-rest policy (security lane S-secrets, Sep 26 2026).
//
// encryptSecret used to return the PLAINTEXT when APP_ENCRYPTION_KEY was
// missing, so Drive refresh tokens, TOTP secrets and AI provider keys landed
// in D1 in the clear. Now a write without a usable key refuses, while reads
// keep working (legacy plaintext as-is, encrypted values decrypt) and the
// Drive backup of a deployment connected before the key existed keeps
// running. Uses the REAL secretCrypto module, never a stub, so a regression
// to the old fallback fails here.

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

function loadTs(relPath, stubs = {}) {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', relPath)
  const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  }).outputText
  const originalLoad = Module._load
  Module._load = function(request, parent, isMain) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
    return originalLoad.call(this, request, parent, isMain)
  }
  const moduleObj = { exports: {} }
  try {
    new Function('exports', 'require', 'module', '__filename', '__dirname', output)(
      moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath),
    )
  } finally {
    Module._load = originalLoad
  }
  return moduleObj.exports
}

const crypto = loadTs('secretCrypto.ts')
const {
  encryptSecret, decryptSecret, upgradeLegacySecret, hasEncryptionKey, isEncryptedSecret,
  MissingEncryptionKeyError, MISSING_ENCRYPTION_KEY_MESSAGE,
} = crypto

const KEY = 'a'.repeat(64)
const OTHER_KEY = 'b'.repeat(64)

async function main() {
  // ---- write without a key refuses ---------------------------------------
  for (const missing of [undefined, '', '   ', 'too-short-to-be-a-key']) {
    await assert.rejects(
      () => encryptSecret('refresh-token-value', missing),
      (error) => error instanceof MissingEncryptionKeyError
        && error.code === 'APP_ENCRYPTION_KEY_MISSING'
        && /^APP_ENCRYPTION_KEY is not set; set it before connecting/.test(error.message),
      `encryptSecret must refuse with key ${JSON.stringify(missing)} instead of returning plaintext`,
    )
    assert.strictEqual(hasEncryptionKey(missing), false)
  }
  assert.match(MISSING_ENCRYPTION_KEY_MESSAGE, /APP_ENCRYPTION_KEY is not set/)
  // Clearing a secret needs no key (disconnect/reset on a keyless deployment).
  assert.strictEqual(await encryptSecret('', undefined), '')
  assert.strictEqual(await encryptSecret(null, undefined), '')

  // ---- write with a key encrypts and round-trips -------------------------
  assert.strictEqual(hasEncryptionKey(KEY), true)
  const enc = await encryptSecret('refresh-token-value', KEY)
  assert.ok(isEncryptedSecret(enc), 'encrypted value carries the enc:v1 envelope')
  assert.ok(!enc.includes('refresh-token-value'), 'ciphertext must not contain the plaintext')
  assert.strictEqual(enc.split(':').length, 5)
  assert.strictEqual(await decryptSecret(enc, KEY), 'refresh-token-value', 'encrypted data still reads')
  assert.strictEqual(await decryptSecret(enc, OTHER_KEY), '', 'wrong key reads as empty, never as ciphertext')
  assert.strictEqual(await decryptSecret(enc, undefined), '', 'encrypted value without a key reads as empty (unchanged)')

  // ---- legacy plaintext still reads, with or without a key ---------------
  assert.strictEqual(await decryptSecret('legacy-plain-token', undefined), 'legacy-plain-token')
  assert.strictEqual(await decryptSecret('legacy-plain-token', KEY), 'legacy-plain-token')
  assert.strictEqual(await decryptSecret('', KEY), '')

  // ---- upgrade helper: idempotent, never throws --------------------------
  assert.strictEqual(await upgradeLegacySecret('legacy-plain-token', undefined), null, 'no key: nothing to do, no throw')
  assert.strictEqual(await upgradeLegacySecret(enc, KEY), null, 'already encrypted: untouched')
  assert.strictEqual(await upgradeLegacySecret('', KEY), null)
  const upgraded = await upgradeLegacySecret('legacy-plain-token', KEY)
  assert.ok(isEncryptedSecret(upgraded))
  assert.strictEqual(await decryptSecret(upgraded, KEY), 'legacy-plain-token')

  // ---- Google Drive flows, with the real crypto module -------------------
  function makeDrive(initialSettings) {
    const settings = new Map(Object.entries(initialSettings))
    const writes = []
    const db = {
      prepare(sql) {
        return {
          async all(keys) {
            return keys.filter((k) => settings.has(k)).map((key) => ({ key, value: settings.get(key) }))
          },
          async run(params) {
            assert.match(sql, /INSERT OR REPLACE INTO settings/)
            writes.push([params.key, params.value])
            settings.set(params.key, params.value)
            return { changes: 1 }
          },
        }
      },
    }
    const drive = loadTs('googleDrive.ts', {
      './db': { getDb: () => db },
      './secretCrypto': crypto,
      './backup': {
        DRIVE_STAGED_BACKUP_PREFIX: 'backups/cloudflare/drive-staged-',
        listCloudflareBackups: async () => [],
        inspectCloudflareBackupStream: async () => { throw new Error('unused') },
        validateCloudflareBackup: async () => { throw new Error('unused') },
      },
      '../index': {},
    })
    return { drive, settings, writes }
  }
  const baseEnv = {
    DB: {},
    GOOGLE_DRIVE_CLIENT_ID: 'client',
    GOOGLE_DRIVE_CLIENT_SECRET: 'client-secret',
    BUSINESS_OS_ADMIN_URL: 'https://admin.example.com',
  }
  const originalFetch = global.fetch
  const fetchLog = []
  global.fetch = async (url, init = {}) => {
    const value = String(url)
    fetchLog.push({ url: value, init })
    if (value === 'https://oauth2.googleapis.com/token') {
      return Response.json({ access_token: 'fresh-access-token', refresh_token: 'fresh-refresh-token', expires_in: 3600 })
    }
    if (value.startsWith('https://openidconnect.googleapis.com/')) return Response.json({ email: 'owner@example.com' })
    // First Drive API call after a token was obtained: stop the run here.
    throw new Error('STOP_AFTER_TOKEN')
  }
  try {
    // Connect without a key: clear error, NOTHING stored.
    {
      const { drive, writes } = makeDrive({})
      const result = await drive.completeDriveOauth({ ...baseEnv }, 'auth-code', 'verifier')
      assert.strictEqual(result.success, false)
      assert.match(result.error, /^APP_ENCRYPTION_KEY is not set/)
      assert.deepStrictEqual(writes, [], 'a refused connect must not store any token')
    }
    // Connect with a key: both tokens stored encrypted.
    {
      const { drive, settings } = makeDrive({})
      const result = await drive.completeDriveOauth({ ...baseEnv, APP_ENCRYPTION_KEY: KEY }, 'auth-code', 'verifier')
      assert.strictEqual(result.success, true)
      assert.ok(isEncryptedSecret(settings.get('drive_sync_refresh_token')))
      assert.ok(isEncryptedSecret(settings.get('drive_sync_access_token')))
      assert.strictEqual(await decryptSecret(settings.get('drive_sync_refresh_token'), KEY), 'fresh-refresh-token')
    }
    // Backup on a keyless deployment connected earlier (legacy plaintext
    // refresh token, expired access token): must still get a token and
    // proceed to Drive, caching nothing in plaintext.
    {
      const { drive, settings, writes } = makeDrive({
        drive_sync_refresh_token: 'legacy-plain-refresh',
        drive_sync_access_token: '',
        drive_sync_access_token_expires_at: '',
      })
      fetchLog.length = 0
      await drive.pushBackupToDrive({ ...baseEnv }).catch(() => null)
      const tokenCall = fetchLog.find((c) => c.url === 'https://oauth2.googleapis.com/token')
      assert.ok(tokenCall, 'refresh must still run without a key')
      assert.strictEqual(new URLSearchParams(String(tokenCall.init.body)).get('refresh_token'), 'legacy-plain-refresh')
      const driveCall = fetchLog.find((c) => c.url.startsWith('https://www.googleapis.com/drive/'))
      assert.ok(driveCall, 'the backup must proceed to Drive -- a refused cache write must not brick it')
      assert.strictEqual(driveCall.init.headers.Authorization, 'Bearer fresh-access-token')
      assert.ok(!writes.some(([k]) => k === 'drive_sync_access_token'), 'no plaintext access token cached')
      assert.strictEqual(settings.get('drive_sync_refresh_token'), 'legacy-plain-refresh', 'refresh token untouched without a key')
    }
    // Same deployment after the key is set: legacy refresh token re-encrypted.
    {
      const { drive, settings } = makeDrive({
        drive_sync_refresh_token: 'legacy-plain-refresh',
        drive_sync_access_token: '',
        drive_sync_access_token_expires_at: '',
      })
      await drive.pushBackupToDrive({ ...baseEnv, APP_ENCRYPTION_KEY: KEY }).catch(() => null)
      const stored = settings.get('drive_sync_refresh_token')
      assert.ok(isEncryptedSecret(stored), 'legacy plaintext refresh token is re-encrypted on the next refresh')
      assert.strictEqual(await decryptSecret(stored, KEY), 'legacy-plain-refresh')
      assert.ok(isEncryptedSecret(settings.get('drive_sync_access_token')))
    }
  } finally {
    global.fetch = originalFetch
  }

  console.log('secret crypto policy: ok')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
