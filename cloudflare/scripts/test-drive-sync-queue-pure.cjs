const fs = require('fs')
const path = require('path')
const ts = require('typescript')
const assert = require('assert')
const Module = require('module')

const sourcePath = path.join(__dirname, '..', 'src', 'lib', 'driveSyncQueue.ts')
const output = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  fileName: sourcePath,
}).outputText

const jobs = new Map()
let driveResult = { success: true, fileId: 'drive-1', fileName: 'backup.json' }
let stageResult = { success: true, backupKey: 'backups/cloudflare/drive-staged-file.json', manifestOnly: true }
let authorityResult = { allowed: true, userId: 1 }
let pushes = 0
const recordedErrors = []
const stubs = {
  './backup': {
    getSystemJob: async (_env, id) => jobs.get(id) || null,
    storeSystemJob: async (_env, job) => {
      const item = { ...job, id: String(job.id), updated_at: new Date().toISOString() }
      jobs.set(item.id, item)
      return item
    },
  },
  './googleDrive': {
    pushBackupToDrive: async () => { pushes += 1; return driveResult },
    stageLatestDriveBackupToR2: async () => stageResult,
    recordDriveSyncError: async (_env, message) => { recordedErrors.push(message) },
  },
  // P1-2: the worker re-checks the connector's authoriser before every push.
  './driveSyncAuthority': { checkDriveSyncAuthorizer: async () => authorityResult },
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

async function main() {
  const sent = []
  const cache = new Map()
  const env = {
    BACKUP_QUEUE: { send: async (message) => sent.push(message) },
    CACHE: {
      get: async (key) => cache.get(key) || null,
      put: async (key, value) => cache.set(key, value),
      delete: async (key) => cache.delete(key),
    },
  }
  const queued = await moduleObj.exports.enqueueDriveSyncJob(env, 'manual')
  assert.strictEqual(queued.status, 'queued')
  assert.strictEqual(queued.progress, 0)
  assert.deepStrictEqual(sent, [{ kind: 'drive-sync', jobId: queued.id }])
  const deduped = await moduleObj.exports.enqueueDriveSyncJob(env, 'scheduled')
  assert.strictEqual(deduped.id, queued.id, 'manual/scheduled overlap must reuse one active job')
  assert.strictEqual(sent.length, 1, 'dedupe must not enqueue a second upload')

  await moduleObj.exports.runQueuedDriveSync(env, queued.id)
  const completed = jobs.get(queued.id)
  assert.strictEqual(completed.status, 'completed')
  assert.strictEqual(completed.progress, 100)
  assert.strictEqual(completed.result.fileId, 'drive-1')
  assert.strictEqual(cache.has('system-active:google-drive-sync'), false, 'completion releases the small TTL lock')

  const staged = await moduleObj.exports.enqueueDriveRestoreStageJob(env)
  assert.deepStrictEqual(sent.at(-1), { kind: 'drive-restore-stage', jobId: staged.id })
  const stagedAgain = await moduleObj.exports.enqueueDriveRestoreStageJob(env)
  assert.strictEqual(stagedAgain.id, staged.id, 'restore staging must dedupe independently from outbound sync')
  await moduleObj.exports.runQueuedDriveRestoreStage(env, staged.id)
  const stagedComplete = jobs.get(staged.id)
  assert.strictEqual(stagedComplete.status, 'completed')
  assert.strictEqual(stagedComplete.result.backupKey, stageResult.backupKey)
  assert.match(stagedComplete.message, /No live data was restored/)
  assert.strictEqual(cache.has('system-active:google-drive-restore-stage'), false)

  const failedJob = await moduleObj.exports.enqueueDriveSyncJob(env, 'scheduled')
  driveResult = { success: false, error: 'temporary Drive outage' }
  await assert.rejects(
    () => moduleObj.exports.runQueuedDriveSync(env, failedJob.id),
    /temporary Drive outage/,
  )
  assert.strictEqual(jobs.get(failedJob.id).status, 'failed')
  assert.strictEqual(jobs.get(failedJob.id).error, 'temporary Drive outage')

  // An authoriser who lost the grants (or never was recorded) stops the
  // upload before any byte leaves: terminal failure, no retry, no push.
  driveResult = { success: true, fileId: 'drive-2', fileName: 'backup.json' }
  authorityResult = { allowed: false, reason: 'authorizer-lacks-grants', message: 'Google Drive sync is paused: reconnect.' }
  const refusedJob = await moduleObj.exports.enqueueDriveSyncJob(env, 'scheduled')
  const pushesBefore = pushes
  await moduleObj.exports.runQueuedDriveSync(env, refusedJob.id)
  assert.strictEqual(pushes, pushesBefore, 'a refused authoriser must not reach pushBackupToDrive')
  assert.strictEqual(jobs.get(refusedJob.id).status, 'failed')
  assert.strictEqual(jobs.get(refusedJob.id).error, 'Google Drive sync is paused: reconnect.')
  assert.deepStrictEqual(recordedErrors, ['Google Drive sync is paused: reconnect.'])
  assert.strictEqual(cache.has('system-active:google-drive-sync'), false, 'a refusal releases the lock too')
  authorityResult = { allowed: true, userId: 1 }

  await assert.rejects(
    () => moduleObj.exports.enqueueDriveSyncJob({ CACHE: env.CACHE }, 'manual'),
    /background queue is not configured/,
  )

  console.log('PASS Drive sync and non-destructive restore staging are persisted deduplicated queue jobs with truthful terminal states')
}

main().catch((error) => {
  console.error('FAIL', error)
  process.exitCode = 1
})
