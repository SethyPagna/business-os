// Google Drive backup safety regression: reuse the newest finalized R2
// snapshot, stream it through a trusted resumable session, keep seven, and
// never delete an untagged Drive file.

const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'googleDrive.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
}).outputText

const settings = new Map([
  ['drive_sync_refresh_token', 'refresh-enc'],
  ['drive_sync_access_token', 'access-enc'],
  ['drive_sync_access_token_expires_at', new Date(Date.now() + 60 * 60 * 1000).toISOString()],
  ['drive_sync_folder_name', 'Business OS Sync'],
  ['drive_sync_folder_id', 'root-folder'],
])
const db = {
  prepare(sql) {
    return {
      async all(keys) {
        assert.match(sql, /SELECT key, value FROM settings/)
        return keys.filter((key) => settings.has(key)).map((key) => ({ key, value: settings.get(key) }))
      },
      async run(params) {
        assert.match(sql, /INSERT OR REPLACE INTO settings/)
        settings.set(params.key, params.value)
        return { changes: 1 }
      },
    }
  },
}

let listedBackups = 0
let newerBackupExists = false
let sectionBackupNewest = false
const stubs = {
  './db': { getDb: () => db },
  './secretCrypto': {
    decryptSecret: async (value) => value === 'access-enc' ? 'access-token' : 'refresh-token',
    encryptSecret: async (value) => `enc:${value}`,
    upgradeLegacySecret: async () => null,
  },
  './backup': {
    listCloudflareBackups: async () => {
      listedBackups += 1
      return [
        ...(sectionBackupNewest ? [{ key: 'backups/cloudflare/section.json', name: 'section.json', finalized: true, scope: 'section' }] : []),
        ...(newerBackupExists ? [{ key: 'backups/cloudflare/newer.json', name: 'newer.json', finalized: true }] : []),
        { key: 'backups/cloudflare/pending.json', name: 'pending.json', finalized: false },
        { key: 'backups/cloudflare/final.json', name: 'final.json', finalized: true },
      ]
    },
    createCloudflareBackup: async () => { throw new Error('Drive sync must never create another R2 backup') },
  },
  '../index': {},
}

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

const {
  DRIVE_BACKUP_KEEP,
  DRIVE_OAUTH_STATE_TTL_SECONDS,
  buildDriveOauthStartUrl,
  consumeDriveOauthState,
  isTrustedDriveUploadSession,
  pushBackupToDrive,
  driveSyncHasNewBackup,
  driveSyncScheduleDue,
  disconnectDrive,
} = moduleObj.exports
assert.strictEqual(DRIVE_BACKUP_KEEP, 10, 'the user keeps 2 in R2 and 10 in Drive (Part 386)')
assert.strictEqual(isTrustedDriveUploadSession('https://www.googleapis.com/upload/drive/v3/files?upload_id=ok'), true)
assert.strictEqual(isTrustedDriveUploadSession('https://upload.googleapis.com/session/ok'), true)
assert.strictEqual(isTrustedDriveUploadSession('http://www.googleapis.com/session'), false)
assert.strictEqual(isTrustedDriveUploadSession('https://googleapis.com.evil.example/session'), false)

const bytes = new TextEncoder().encode('manifest')
let r2Reads = 0
const env = {
  DB: {},
  ASSETS: {
    async get(key) {
      r2Reads += 1
      assert.strictEqual(key, 'backups/cloudflare/final.json', 'newest unfinished backup must be skipped')
      return { body: new Blob([bytes]).stream(), size: bytes.byteLength }
    },
  },
  APP_ENCRYPTION_KEY: 'test',
  GOOGLE_DRIVE_CLIENT_ID: 'client',
  GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
  AUTH_SESSION_SECRET: 'oauth-state-secret',
  BUSINESS_OS_ADMIN_URL: 'https://admin.example.com',
  GOOGLE_DRIVE_REDIRECT_URI: 'https://admin.example.com/api/system/drive-sync/oauth/callback',
  CACHE: {
    values: new Map(),
    async put(key, value, options) {
      assert.strictEqual(options.expirationTtl, DRIVE_OAUTH_STATE_TTL_SECONDS)
      this.values.set(key, value)
    },
    async get(key) { return this.values.get(key) || null },
    async delete(key) { this.values.delete(key) },
  },
}

const calls = []
let uploadCount = 0
const originalFetch = global.fetch
global.fetch = async (url, init = {}) => {
  const value = String(url)
  calls.push({ url: value, method: init.method || 'GET', body: init.body })
  if (value.includes('uploadType=resumable')) {
    assert.strictEqual(init.method, 'POST')
    const metadata = JSON.parse(init.body)
    assert.strictEqual(metadata.appProperties.businessOsBackup, 'true')
    assert.strictEqual(metadata.appProperties.backupKey, 'backups/cloudflare/final.json')
    return new Response('', { status: 200, headers: { location: 'https://www.googleapis.com/upload/session-1' } })
  }
  if (value === 'https://www.googleapis.com/upload/session-1') {
    assert.strictEqual(init.method, 'PUT')
    assert.ok(init.body && typeof init.body.getReader === 'function', 'R2 body must be streamed, not arrayBuffer()ed')
    uploadCount += 1
    return Response.json({ id: 'drive-file', size: String(bytes.byteLength) })
  }
  if (value.startsWith('https://www.googleapis.com/drive/v3/files?')) {
    const parsedUrl = new URL(value)
    const query = parsedUrl.searchParams.get('q') || ''
    assert.match(query, /appProperties has \{ key='businessOsBackup' and value='true' \}/)
    const files = Array.from({ length: 12 }, (_, index) => ({
      id: `owned-${index}`,
      appProperties: { businessOsBackup: 'true', status: 'finalized' },
    }))
    if (uploadCount) files.unshift({
      id: 'drive-file',
      appProperties: { businessOsBackup: 'true', status: 'finalized', backupKey: 'backups/cloudflare/final.json' },
    })
    files.splice(2, 0, { id: 'unrelated', appProperties: {} })
    const secondPage = parsedUrl.searchParams.get('pageToken') === 'page-2'
    return Response.json(secondPage
      ? { files: files.slice(5) }
      : { files: files.slice(0, 5), nextPageToken: 'page-2' })
  }
  if (/\/drive\/v3\/files\/owned-(9|10|11)$/.test(value)) {
    assert.strictEqual(init.method, 'DELETE')
    return new Response(null, { status: 204 })
  }
  throw new Error(`Unexpected fetch: ${init.method || 'GET'} ${value}`)
}

async function main() {
  try {
    const oauth = await buildDriveOauthStartUrl(env, {
      userId: 42,
      returnOrigin: 'https://evil.example',
      returnPath: '//evil.example/escape',
    })
    assert.strictEqual(oauth.success, true, oauth.error)
    const oauthUrl = new URL(oauth.url)
    assert.ok(oauthUrl.searchParams.get('state'))
    assert.ok(oauthUrl.searchParams.get('code_challenge'))
    assert.strictEqual(oauthUrl.searchParams.get('code_challenge_method'), 'S256')
    const consumed = await consumeDriveOauthState(env, oauthUrl.searchParams.get('state'))
    assert.strictEqual(consumed.success, true, consumed.error)
    assert.strictEqual(consumed.payload.userId, 42)
    assert.strictEqual(consumed.payload.returnOrigin, 'https://admin.example.com')
    assert.strictEqual(consumed.payload.returnPath, '/?settings=integrations')
    const replay = await consumeDriveOauthState(env, oauthUrl.searchParams.get('state'))
    assert.strictEqual(replay.success, false, 'Drive OAuth state must be one-time')

    // Nothing mirrored yet: the newest finalized backup is new to Drive.
    assert.deepStrictEqual(await driveSyncHasNewBackup(env), { new: true, backupKey: 'backups/cloudflare/final.json' })
    listedBackups = 0
    const result = await pushBackupToDrive(env)
    assert.strictEqual(result.success, true, result.error)
    assert.strictEqual(result.fileId, 'drive-file')
    assert.strictEqual(listedBackups, 1)
    assert.strictEqual(settings.get('drive_sync_last_backup_key'), '|root-folder|backups/cloudflare/final.json', 'a successful sync records which backup Drive now holds, and where (account | folder id)')
    const deleted = calls.filter((call) => call.method === 'DELETE').map((call) => call.url)
    assert.strictEqual(deleted.length, 3, 'the new copy plus twelve finalized app backups must prune to exactly ten')
    assert.ok(deleted.every((url) => !url.includes('unrelated')))
    const repeated = await pushBackupToDrive(env)
    assert.strictEqual(repeated.success, true, repeated.error)
    assert.strictEqual(repeated.fileId, 'drive-file')
    assert.strictEqual(uploadCount, 1, 'the same R2 backup must not be uploaded twice')
    assert.strictEqual(r2Reads, 1, 'a duplicate Drive mirror must not even reopen the R2 body')
    assert.doesNotMatch(source, /object\.arrayBuffer\(\)/)
    assert.doesNotMatch(source, /await createCloudflareBackup\(/)
    // The 6 h Drive interval against a daily backup: the scheduled visit now skips an already-mirrored backup before any Drive call.
    const callsBefore = calls.length
    assert.deepStrictEqual(await driveSyncHasNewBackup(env), { new: false, reason: 'already-synced', backupKey: 'backups/cloudflare/final.json' })
    assert.strictEqual(calls.length, callsBefore, 'the already-synced check makes no Drive request')
    // F5: that skip is a check. Last upload was long ago, yet the interval now runs from the check, so the next rotation visits
    // (15 min, 30 min later) do not list the backup prefix again; once the interval has passed since the check it is due again.
    assert.ok(settings.get('drive_sync_last_checked_at'), 'a skip records the check time')
    settings.set('drive_sync_last_synced_at', new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString())
    assert.deepStrictEqual(await driveSyncScheduleDue(env), { due: false, reason: 'not-due' }, 'checked a moment ago: not due again')
    settings.set('drive_sync_last_checked_at', new Date(Date.now() - 7 * 3600 * 1000).toISOString())
    assert.deepStrictEqual(await driveSyncScheduleDue(env), { due: true }, 'the interval ran from the check and has passed')
    // F6: the marker belongs to the destination. A different folder, then a different account, is a destination that holds nothing yet.
    settings.set('drive_sync_folder_id', 'another-folder')
    assert.deepStrictEqual(await driveSyncHasNewBackup(env), { new: true, backupKey: 'backups/cloudflare/final.json' }, 'a new folder gets the newest backup')
    settings.set('drive_sync_folder_id', 'root-folder')
    assert.strictEqual((await driveSyncHasNewBackup(env)).new, false, 'back on the same destination: nothing new')
    settings.set('drive_sync_account_email', 'other@example.com')
    assert.strictEqual((await driveSyncHasNewBackup(env)).new, true, 'a different account gets the newest backup')
    settings.set('drive_sync_account_email', '')
    await disconnectDrive(env)
    assert.strictEqual(settings.get('drive_sync_last_backup_key'), '', 'disconnect forgets what Drive was given')
    assert.strictEqual(settings.get('drive_sync_folder_id'), '')
    settings.set('drive_sync_folder_id', 'root-folder')
    assert.strictEqual((await driveSyncHasNewBackup(env)).new, true, 'reconnecting to the same folder after a disconnect uploads again')
    settings.set('drive_sync_last_backup_key', '|root-folder|backups/cloudflare/final.json')
    // R2-A: a section pre-backup newer than the full set is never mirrored, by either selector.
    sectionBackupNewest = true
    assert.deepStrictEqual(await driveSyncHasNewBackup(env), { new: false, reason: 'already-synced', backupKey: 'backups/cloudflare/final.json' }, 'a newer section set does not count as new')
    const beforeUploads = uploadCount
    const pushed = await pushBackupToDrive(env)
    assert.strictEqual(pushed.success, true, pushed.error)
    assert.strictEqual(uploadCount, beforeUploads, 'the upload path also skips the section set (it finds the full set already in Drive)')
    assert.ok(!/find((item) => item.finalized)/.test(source), 'no selector picks a section set')
    sectionBackupNewest = false
    newerBackupExists = true
    assert.deepStrictEqual(await driveSyncHasNewBackup(env), { new: true, backupKey: 'backups/cloudflare/newer.json' }, 'the next daily backup is picked up')
    newerBackupExists = false
    // The step's order (interval, then new-backup check, then authority, then the queued job) is pinned by behaviour in
    // test-drive-sync-cron-step-pure.cjs.
    console.log('PASS Drive uses signed expiring one-time PKCE state, mirrors the newest finalized R2 manifest, and prunes only tagged app backups to ten')
  } finally {
    global.fetch = originalFetch
  }
}

main().catch((error) => {
  console.error('FAIL', error)
  process.exitCode = 1
})
