// SCAN2 RT-5: the Drive off-site copy must be pushed on every 6-hourly tick.
//
// The due check compared "now - last push" with exactly the 6 h interval, and
// the push stamped the time it FINISHED (queue delay + upload after the tick
// that queued it). The next tick's check runs after that tick's backup step,
// so whenever this backup step was quicker than the last one plus the push
// time, the elapsed time fell a little short of 6 h and the tick was skipped:
// about every other tick, leaving the Drive copy 6-18 h old.
//
// Replays 400 ticks through the REAL driveSyncScheduleDue and pushBackupToDrive
// (settings, R2, Drive and the clock faked) with seeded step and upload times.
//
// Run: node scripts/test-drive-sync-due-slack-pure.cjs
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000
const TICK_MS = 6 * HOUR

const RealDate = Date
let clock = RealDate.UTC(2026, 8, 1)
class FakeDate extends RealDate {
  constructor(...args) {
    if (args.length) super(...args)
    else super(clock)
  }
  static now() { return clock }
}

const settings = new Map()
const settingsDb = {
  prepare(sql) {
    return {
      async all(keys) { return keys.filter((key) => settings.has(key)).map((key) => ({ key, value: settings.get(key) })) },
      async run(params) {
        assert.match(sql, /INTO settings/)
        settings.set(params.key, params.value)
        return { changes: 1 }
      },
    }
  },
}

let finalizedBackupKey = 'backups/cloudflare/b-0.json'
let uploadMs = 0
const drive = { uploads: 0 }

function loadGoogleDrive() {
  const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'googleDrive.ts')
  const { outputText } = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: sourcePath,
  })
  const stubs = {
    './db': { getDb: () => settingsDb },
    './secretCrypto': { decryptSecret: async () => 'access-token', encryptSecret: async (value) => value, upgradeLegacySecret: async () => null },
    './backup': {
      listCloudflareBackups: async () => [{ key: finalizedBackupKey, name: path.basename(finalizedBackupKey), finalized: true }],
      DRIVE_STAGED_BACKUP_PREFIX: 'backups/drive-staged/',
      inspectCloudflareBackupStream: async () => { throw new Error('not used') },
      validateCloudflareBackup: async () => { throw new Error('not used') },
    },
  }
  const loaded = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    loaded.exports,
    (request) => {
      if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request]
      throw new Error(`googleDrive.ts required an unstubbed module: ${request}`)
    },
    loaded, sourcePath, path.dirname(sourcePath),
  )
  return loaded.exports
}

async function fakeFetch(url, init = {}) {
  const value = String(url)
  if (value.includes('uploadType=resumable')) return new Response('', { status: 200, headers: { location: 'https://www.googleapis.com/upload/session' } })
  if (value === 'https://www.googleapis.com/upload/session') {
    clock += uploadMs
    drive.uploads++
    return Response.json({ id: `drive-${drive.uploads}`, size: '8' })
  }
  if (value.startsWith('https://www.googleapis.com/drive/v3/files?')) return Response.json({ files: [] })
  if (init.method === 'DELETE') return new Response(null, { status: 204 })
  throw new Error(`Unexpected fetch: ${init.method || 'GET'} ${value}`)
}

const env = {
  DB: {},
  APP_ENCRYPTION_KEY: 'test',
  ASSETS: { async get() { return { body: new Blob([new Uint8Array(8)]).stream(), size: 8 } } },
}

function seededRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

function resetSettings() {
  settings.clear()
  settings.set('drive_sync_refresh_token', 'refresh-enc')
  settings.set('drive_sync_access_token', 'access-enc')
  settings.set('drive_sync_access_token_expires_at', new RealDate(RealDate.UTC(2100, 0, 1)).toISOString())
  settings.set('drive_sync_folder_id', 'folder')
  settings.set('drive_sync_interval_seconds', '21600')
}

const tests = []
function check(name, fn) { tests.push({ name, fn }) }

check('every 6-hourly tick pushes the newest finalized backup to Drive', async (googleDrive) => {
  resetSettings()
  const random = seededRandom(20260929)
  const ticks = 400
  const start = clock
  let pushes = 0
  let longestGapMs = 0
  let lastPushAt = null
  for (let tick = 0; tick < ticks; tick++) {
    const tickAt = start + tick * TICK_MS
    clock = tickAt + 5_000 + Math.floor(random() * 115_000)
    finalizedBackupKey = `backups/cloudflare/b-${tick}.json`
    const schedule = await googleDrive.driveSyncScheduleDue(env)
    if (!schedule.due) continue
    clock += 1_000 + Math.floor(random() * 89_000)
    uploadMs = 1_000 + Math.floor(random() * 89_000)
    const pushed = await googleDrive.pushBackupToDrive(env)
    assert.equal(pushed.success, true, pushed.error)
    if (lastPushAt !== null) longestGapMs = Math.max(longestGapMs, tickAt - lastPushAt)
    lastPushAt = tickAt
    pushes++
  }
  assert.equal(pushes, ticks, `only ${pushes} of ${ticks} ticks pushed to Drive`)
  assert.equal(longestGapMs, TICK_MS)
})

check('the push is stamped with the time it started, not when the upload finished', async (googleDrive) => {
  resetSettings()
  finalizedBackupKey = 'backups/cloudflare/stamp.json'
  const startedAt = clock
  uploadMs = 90_000
  const pushed = await googleDrive.pushBackupToDrive(env)
  assert.equal(pushed.success, true, pushed.error)
  assert.equal(clock, startedAt + 90_000)
  assert.equal(settings.get('drive_sync_last_synced_at'), new RealDate(startedAt).toISOString())
})

check('the slack only absorbs tick jitter: a push minutes or hours ago is not due again', async (googleDrive) => {
  resetSettings()
  const pushedAt = clock
  settings.set('drive_sync_last_synced_at', new RealDate(pushedAt).toISOString())
  for (const [elapsedMs, due] of [[10 * MINUTE, false], [5 * HOUR, false], [6 * HOUR - 20 * MINUTE, true], [6 * HOUR, true]]) {
    clock = pushedAt + elapsedMs
    assert.equal((await googleDrive.driveSyncScheduleDue(env)).due, due, `${elapsedMs / MINUTE} min after a push`)
  }
  settings.set('drive_sync_interval_seconds', String(24 * 60 * 60))
  clock = pushedAt + 18 * HOUR
  assert.equal((await googleDrive.driveSyncScheduleDue(env)).due, false, 'a daily interval still skips the 18 h tick')
  clock = pushedAt + 24 * HOUR - 3 * MINUTE
  assert.equal((await googleDrive.driveSyncScheduleDue(env)).due, true, 'and pushes on the tick that lands just short of 24 h')
})

async function main() {
  const originalFetch = global.fetch
  global.Date = FakeDate
  global.fetch = fakeFetch
  const googleDrive = loadGoogleDrive()
  let failed = 0
  try {
    for (const test of tests) {
      try {
        await test.fn(googleDrive)
        console.log(`PASS ${test.name}`)
      } catch (error) {
        failed++
        console.error(`FAIL ${test.name}\n  ${error && error.message}`)
      }
    }
  } finally {
    global.Date = RealDate
    global.fetch = originalFetch
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
}

main()
