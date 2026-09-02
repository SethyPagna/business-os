// Drive recovery safety: stage only the newest finalized app-owned manifest,
// stream it to R2 with Google's MD5, validate the parallel stream, and never
// touch D1 restore. Run: node scripts/test-google-drive-restore-stage-pure.cjs
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
  ['drive_sync_folder_id', 'app-folder'],
])
const db = {
  prepare() {
    return {
      async all(keys) { return keys.filter((key) => settings.has(key)).map((key) => ({ key, value: settings.get(key) })) },
      async run(params) { settings.set(params.key, params.value); return { changes: 1 } },
    }
  },
}

let inspected = 0
const stubs = {
  './db': { getDb: () => db },
  './secretCrypto': {
    decryptSecret: async (value) => value === 'access-enc' ? 'access-token' : 'refresh-token',
    encryptSecret: async (value) => `enc:${value}`,
  },
  './backup': {
    DRIVE_STAGED_BACKUP_PREFIX: 'backups/cloudflare/drive-staged-',
    listCloudflareBackups: async () => [],
    inspectCloudflareBackupStream: async (stream) => {
      inspected += 1
      const text = await new Response(stream).text()
      const payload = JSON.parse(text)
      if (payload.format !== 'business-os-cloudflare-backup' || payload.formatVersion !== 1) throw new Error('Unsupported backup format')
      return { tableCount: Object.keys(payload.tables).length, rowCount: 0, summary: payload.summary }
    },
    validateCloudflareBackup: async (_env, key) => ({ key, restorable: true, tables: 1 }),
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
  new Function('exports', 'require', 'module', '__filename', '__dirname', output)(moduleObj.exports, require, moduleObj, sourcePath, path.dirname(sourcePath))
} finally {
  Module._load = originalLoad
}

const manifest = JSON.stringify({
  format: 'business-os-cloudflare-backup', formatVersion: 1,
  createdAt: '2026-09-01T00:00:00.000Z', source: 'manual', runtime: 'cloudflare-workers',
  tables: { settings: { columns: ['key'], rows: [] } },
  r2: { assets: [], copiedKeys: [] },
  summary: { tableCount: 1, rowCount: 0, assetCount: 0, assetsBackedUp: 0, assetsSkipped: 0 },
})
const bytes = new TextEncoder().encode(manifest)
const md5 = '0123456789abcdef0123456789abcdef'
const stored = new Map()
const deleted = []
const env = {
  DB: {}, APP_ENCRYPTION_KEY: 'test', GOOGLE_DRIVE_CLIENT_ID: 'client', GOOGLE_DRIVE_CLIENT_SECRET: 'secret',
  ASSETS: {
    async head(key) { return stored.get(key) || null },
    async put(key, body, options) {
      assert.ok(body && typeof body.getReader === 'function', 'Drive body must remain streamed into R2')
      assert.strictEqual(options.md5, md5, 'Google blob checksum must be enforced by R2')
      const storedBytes = new Uint8Array(await new Response(body).arrayBuffer())
      const item = { key, size: storedBytes.byteLength, uploaded: new Date(), customMetadata: options.customMetadata }
      stored.set(key, item)
      return item
    },
    async list() { return { objects: [...stored.values()], truncated: false } },
    async delete(keys) {
      for (const key of Array.isArray(keys) ? keys : [keys]) { deleted.push(key); stored.delete(key) }
    },
  },
}

let downloads = 0
let corrupt = false
const originalFetch = global.fetch
global.fetch = async (url, init = {}) => {
  const value = String(url)
  if (value.startsWith('https://www.googleapis.com/drive/v3/files?')) {
    const parsed = new URL(value)
    assert.match(parsed.searchParams.get('q') || '', /businessOsBackup/)
    assert.match(parsed.searchParams.get('fields') || '', /md5Checksum/)
    return Response.json({ files: [
      { id: 'unfinished', name: 'unfinished.json', size: String(bytes.length), mimeType: 'application/json', md5Checksum: md5, appProperties: { businessOsBackup: 'true', status: 'copying', backupKey: 'backups/cloudflare/unfinished.json' } },
      { id: corrupt ? 'corrupt-file' : 'drive-file-1', name: 'backup.json', size: String(corrupt ? 7 : bytes.length), mimeType: 'application/json', md5Checksum: md5, appProperties: { businessOsBackup: 'true', status: 'finalized', backupKey: 'backups/cloudflare/final.json' } },
    ] })
  }
  if (value.includes('/drive/v3/files/drive-file-1?') || value.includes('/drive/v3/files/corrupt-file?')) {
    downloads += 1
    assert.strictEqual(init.redirect, 'error', 'Drive media download must not follow an untrusted redirect')
    const payload = corrupt ? 'notjson' : bytes
    return new Response(payload, { status: 200, headers: { 'content-length': String(corrupt ? 7 : bytes.length), 'content-type': 'application/json' } })
  }
  throw new Error(`Unexpected fetch ${value}`)
}

async function main() {
  try {
    const first = await moduleObj.exports.stageLatestDriveBackupToR2(env)
    assert.strictEqual(first.backupKey, 'backups/cloudflare/drive-staged-drive-file-1.json')
    assert.strictEqual(first.reused, false)
    assert.strictEqual(first.manifestOnly, true)
    assert.strictEqual(first.validation.restorable, true)
    assert.strictEqual(downloads, 1)
    const repeated = await moduleObj.exports.stageLatestDriveBackupToR2(env)
    assert.strictEqual(repeated.reused, true)
    assert.strictEqual(downloads, 1, 'same Drive revision must reuse the validated R2 stage')

    corrupt = true
    await assert.rejects(() => moduleObj.exports.stageLatestDriveBackupToR2(env), /Unexpected token|Unsupported backup format/)
    assert.ok(deleted.includes('backups/cloudflare/drive-staged-corrupt-file.json'), 'invalid staged content must be deleted after both streams settle')
    assert.ok(inspected >= 2)
    assert.doesNotMatch(source, /restoreCloudflareBackup/)
    const routeSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'compat.ts'), 'utf8')
    const routeStart = routeSource.indexOf("app.post('/system/drive-sync/restore-stage/jobs'")
    const routeEnd = routeSource.indexOf("app.get('/system/jobs'", routeStart)
    const routeBlock = routeSource.slice(routeStart, routeEnd)
    assert.ok(routeStart >= 0)
    assert.match(routeBlock, /hasPermission\(user, 'backup_restore'\)/)
    assert.match(routeBlock, /enqueueDriveRestoreStageJob/)
    assert.doesNotMatch(routeBlock, /restoreCloudflareBackup|restoreCloudflare/)
    console.log('PASS Drive restore staging is streamed, checksum-bound, app-owned, deduplicated, validated, and non-destructive')
  } finally {
    global.fetch = originalFetch
  }
}

main().catch((error) => { console.error('FAIL', error); process.exitCode = 1 })
