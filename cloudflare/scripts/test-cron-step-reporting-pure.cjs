// SCAN2 RT-4: a failing scheduled step must reach Sentry and leave a durable
// per-step record, not only a console line that Workers Logs drops in days.
//
// Drives the REAL index.ts scheduled() handler (transpiled, every step stubbed)
// against a node:sqlite system_flags table built from migration 0089, with the
// real requestMetrics.runBackground and the real errorReporting scrubber.
//
// Run: node scripts/test-cron-step-reporting-pure.cjs
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { DatabaseSync } = require('node:sqlite')
const ts = require('typescript')
const { Hono } = require('hono')

const cloudflareRoot = path.join(__dirname, '..')
const srcRoot = path.join(cloudflareRoot, 'src')
const SENTRY_DSN = 'https://public@o1.ingest.sentry.io/1'

function transpileAndRun(relativePath, resolve) {
  const filePath = path.join(srcRoot, relativePath)
  const { outputText } = ts.transpileModule(fs.readFileSync(filePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filePath,
  })
  const loaded = { exports: {} }
  new Function('exports', 'require', 'module', '__filename', '__dirname', outputText)(
    loaded.exports, resolve, loaded, filePath, path.dirname(filePath),
  )
  return loaded.exports
}

function loadPure(relativePath, dependencies = {}) {
  return transpileAndRun(relativePath, (request) => {
    if (Object.prototype.hasOwnProperty.call(dependencies, request)) return dependencies[request]
    throw new Error(`${relativePath} required an unstubbed module: ${request}`)
  })
}

function rawD1(sqlite, { failWrites = false } = {}) {
  return {
    prepare(sql) {
      let args = []
      const statement = {
        bind(...values) { args = values; return statement },
        async run() {
          if (failWrites) throw new Error('D1_ERROR: database unavailable')
          const result = sqlite.prepare(sql).run(...args)
          return { success: true, meta: { changes: Number(result.changes) } }
        },
        async first() { return sqlite.prepare(sql).get(...args) ?? null },
        async all() { return { results: sqlite.prepare(sql).all(...args) } },
      }
      return statement
    },
  }
}

function systemFlagsDb() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(fs.readFileSync(path.join(cloudflareRoot, 'migrations', '0089_system_flags.sql'), 'utf8'))
  return sqlite
}

function stepFlags(sqlite) {
  const rows = sqlite.prepare(`SELECT key, value FROM system_flags WHERE key LIKE 'cron_step:%' ORDER BY key`).all()
  return Object.fromEntries(rows.map((row) => [row.key.slice('cron_step:'.length), JSON.parse(row.value)]))
}

function createWorker(behaviour) {
  const calls = []
  const reports = []
  const errorReporting = loadPure('lib/errorReporting.ts')
  const errorReportingSpy = {
    ...errorReporting,
    reportError: async (dsn, error, context) => { reports.push({ dsn, error, context }); return true },
  }
  const requestMetrics = loadPure('lib/requestMetrics.ts', {
    'node:async_hooks': require('node:async_hooks'),
    './analytics': loadPure('lib/analytics.ts'),
  })
  const cronStepStatusPath = path.join(srcRoot, 'lib', 'cronStepStatus.ts')
  const cronStepStatus = fs.existsSync(cronStepStatusPath)
    ? loadPure('lib/cronStepStatus.ts', { './errorReporting': errorReportingSpy, './requestMetrics': requestMetrics })
    : null

  const step = (name) => async () => {
    calls.push(name)
    const run = behaviour[name]
    return run ? run() : undefined
  }
  const recordingModule = (request) => new Proxy({ __esModule: true }, {
    get(target, property) {
      if (property in target) return target[property]
      if (property === 'default') return (target.default = new Hono())
      return (target[property] = step(String(property)))
    },
  })
  const fixed = {
    './lib/errorReporting': errorReportingSpy,
    './lib/requestMetrics': requestMetrics,
    './lib/adminDocumentIdentity': { APP_DOCUMENT_ROUTES: [], ADMIN_DOCUMENT_REWRITES: [], shouldRewriteAdminDocument: () => false },
    './routes/sync': { createSyncRoute: () => new Hono() },
    './lib/googleDrive': { driveSyncScheduleDue: async () => { calls.push('driveSyncScheduleDue'); return { due: false, reason: 'disabled' } }, recordDriveSyncError: step('recordDriveSyncError') },
    './lib/maintenance': { getMaintenance: step('getMaintenance'), isMaintenanceGatedRequest: () => false },
  }
  if (cronStepStatus) fixed['./lib/cronStepStatus'] = cronStepStatus
  const modules = new Map()
  const worker = transpileAndRun('index.ts', (request) => {
    if (request === 'hono') return require('hono')
    if (Object.prototype.hasOwnProperty.call(fixed, request)) return fixed[request]
    if (!modules.has(request)) modules.set(request, recordingModule(request))
    return modules.get(request)
  }).default
  return { worker, calls, reports }
}

async function tick(worker, env) {
  const pending = []
  await worker.scheduled({ cron: '0 */6 * * *', scheduledTime: Date.now() }, env, { waitUntil: (promise) => pending.push(promise) })
  await Promise.all(pending)
}

const SCHEDULED_STEPS = [
  'drainDueTelegramShiftOverviews',
  'maybeRunScheduledBackup',
  'driveSyncScheduleDue',
  'maybeRunScheduledAuditLogRetention',
  'reapStalledImportJobs',
  'maybeRunScheduledImportRetention',
  'sweepStaleImportIncomingFiles',
  'cleanOrphanImportStaging',
  'maybeRunScheduledEphemeralRetention',
  'maybeRunScheduledImageAudit',
]

const tests = []
function check(name, fn) { tests.push({ name, fn }) }

check('a throwing step is reported to Sentry and persisted, and every later step still runs', async () => {
  const sqlite = systemFlagsDb()
  const { worker, calls, reports } = createWorker({
    getMaintenance: () => null,
    maybeRunScheduledBackup: () => { throw new Error('backup exploded') },
  })
  await tick(worker, { DB: rawD1(sqlite), SENTRY_DSN })

  assert.deepEqual(calls.filter((name) => SCHEDULED_STEPS.includes(name)), SCHEDULED_STEPS, 'the failing backup must not stop the steps behind it')
  assert.equal(reports.length, 1, 'exactly the one failing step reaches Sentry')
  assert.equal(reports[0].dsn, SENTRY_DSN)
  assert.equal(reports[0].error.message, 'backup exploded')
  assert.equal(reports[0].context.source, 'worker')
  assert.equal(reports[0].context.location, 'cron:backup')

  const flags = stepFlags(sqlite)
  assert.equal(flags.backup.lastError, 'backup exploded')
  assert.match(flags.backup.lastErrorAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  assert.equal(flags.backup.lastOkAt, undefined, 'a step that has never succeeded has no lastOkAt')
  for (const label of ['telegram-shift-overview', 'drive-sync', 'audit-log-retention', 'reap-stalled-imports', 'import-retention', 'import-incoming-sweep', 'orphan-staging-cleanup', 'ephemeral-retention', 'image-audit']) {
    assert.ok(flags[label]?.lastOkAt, `${label} records its successful run`)
    assert.equal(flags[label].lastError, undefined, `${label} never failed`)
  }
})

check('a recovered step keeps its last error beside the newer success, so the record shows it recovered', async () => {
  const sqlite = systemFlagsDb()
  let fail = true
  const { worker } = createWorker({
    getMaintenance: () => null,
    maybeRunScheduledBackup: () => { if (fail) throw new Error('R2 hiccup') },
  })
  const env = { DB: rawD1(sqlite), SENTRY_DSN }
  await tick(worker, env)
  const failed = stepFlags(sqlite).backup
  fail = false
  await tick(worker, env)
  const recovered = stepFlags(sqlite).backup
  assert.equal(recovered.lastError, 'R2 hiccup')
  assert.equal(recovered.lastErrorAt, failed.lastErrorAt)
  assert.ok(recovered.lastOkAt >= recovered.lastErrorAt, 'the success is newer than the failure')
})

check('a failing maintenance read is reported and skips the tick (it cannot tell whether a restore runs)', async () => {
  const sqlite = systemFlagsDb()
  const { worker, calls, reports } = createWorker({
    getMaintenance: () => { throw new Error('D1_ERROR: network connection lost') },
  })
  await tick(worker, { DB: rawD1(sqlite), SENTRY_DSN })
  assert.deepEqual(calls.filter((name) => SCHEDULED_STEPS.includes(name)), [], 'no sweep runs without a maintenance answer')
  assert.equal(reports.length, 1)
  assert.equal(reports[0].context.location, 'cron:maintenance-check')
  assert.equal(stepFlags(sqlite)['maintenance-check'].lastError, 'D1_ERROR: network connection lost')
})

check('restore maintenance still skips the whole tick silently', async () => {
  const sqlite = systemFlagsDb()
  const { worker, calls, reports } = createWorker({ getMaintenance: () => ({ mode: 'restore', phase: 'inserting' }) })
  await tick(worker, { DB: rawD1(sqlite), SENTRY_DSN })
  assert.deepEqual(calls.filter((name) => SCHEDULED_STEPS.includes(name)), [])
  assert.equal(reports.length, 0)
})

check('the stored message is scrubbed like a Sentry payload and bounded', async () => {
  const sqlite = systemFlagsDb()
  const { worker } = createWorker({
    getMaintenance: () => null,
    maybeRunScheduledImageAudit: () => { throw new Error(`owner@shop.example 012345678 ${'x'.repeat(2000)}`) },
  })
  await tick(worker, { DB: rawD1(sqlite), SENTRY_DSN })
  const stored = stepFlags(sqlite)['image-audit'].lastError
  assert.ok(stored.startsWith('[email] [number] x'), stored.slice(0, 40))
  assert.ok(stored.length <= 300, `stored error is ${stored.length} chars`)
})

check('an unavailable status table never aborts the tick', async () => {
  const sqlite = systemFlagsDb()
  const { worker, calls, reports } = createWorker({
    getMaintenance: () => null,
    maybeRunScheduledBackup: () => { throw new Error('backup exploded') },
  })
  await tick(worker, { DB: rawD1(sqlite, { failWrites: true }), SENTRY_DSN })
  assert.deepEqual(calls.filter((name) => SCHEDULED_STEPS.includes(name)), SCHEDULED_STEPS)
  assert.equal(reports.length, 1, 'the step failure is still reported when its record cannot be written')
})

check('import retention lets its failure reach the step runner instead of reporting success', async () => {
  const unavailable = { prepare() { throw new Error('D1_ERROR: database unavailable') } }
  const retention = loadPure('lib/importRetention.ts', {
    './db': { getDb: () => unavailable },
    './audit': { audit: async () => {} },
    './r2': loadPure('lib/r2.ts'),
    './planTier': loadPure('lib/planTier.ts'),
  })
  await assert.rejects(() => retention.maybeRunScheduledImportRetention({}), /database unavailable/)
})

function loadQueue(overrides) {
  const reports = []
  const failed = new Error('R2 unavailable')
  const noop = new Proxy({}, { get: () => async () => undefined })
  const queue = loadPure('queue.ts', {
    './index': {},
    './lib/errorReporting': { reportError: async (dsn, error, context) => { reports.push({ dsn, error, context }); return true } },
    './lib/importMaintenanceFence': { getImportFencedDb: async () => ({ prepare: () => ({ run: async () => ({}) }) }), isImportMaintenanceFenceError: () => false },
    './lib/importEngine': { runImportAnalyze: async () => {}, runImportApply: async () => {}, markJobFailed: async () => {}, isImportApplyAuthorizationError: () => false },
    './lib/bulkDeleteEngine': noop,
    './lib/backup': { continueCloudflareBackupAssetCopy: async () => { throw failed } },
    './lib/driveSyncQueue': noop,
    './lib/imageAudit': { normalizeStoredImage: async () => { throw failed } },
    './lib/queueDispatch': { registerInlineImportRunner: () => {} },
    './lib/importIncomingFiles': { purgeImportIncomingFiles: async () => ({ deleted: 0, errors: [] }) },
    ...overrides,
  })
  return { queue, reports, failed }
}

function queueMessage(body, outcome) {
  return { body, attempts: 1, timestamp: new Date(), ack() { outcome.acked++ }, retry() { outcome.retried++ } }
}

check('queue consumers report a failed media or backup message to Sentry and still retry it', async () => {
  const { queue, reports, failed } = loadQueue({})
  const env = { SENTRY_DSN }
  const media = { acked: 0, retried: 0 }
  await queue.handleMediaQueue({ messages: [queueMessage({ assetKey: 'uploads/a.jpg', kind: 'optimize-image' }, media)] }, env)
  const backup = { acked: 0, retried: 0 }
  await queue.handleBackupQueue({ messages: [queueMessage({ kind: 'backup-continue', backupName: 'b', nextIndex: 0 }, backup)] }, env)
  assert.deepEqual([media, backup], [{ acked: 0, retried: 1 }, { acked: 0, retried: 1 }])
  assert.deepEqual(reports.map((report) => [report.dsn, report.error, report.context.location]), [
    [SENTRY_DSN, failed, 'queue:business-os-media'],
    [SENTRY_DSN, failed, 'queue:business-os-backup-assets'],
  ])
})

check('an import message that exhausted its retries is reported once, without its job id', async () => {
  const { queue, reports } = loadQueue({})
  const outcome = { acked: 0, retried: 0 }
  await queue.handleImportDeadLetterQueue({ messages: [queueMessage({ jobId: 'job-9', kind: 'apply' }, outcome)] }, { SENTRY_DSN })
  assert.equal(outcome.acked, 1)
  assert.equal(reports.length, 1)
  assert.equal(reports[0].context.location, 'queue:business-os-import-dlq')
  assert.equal(reports[0].error.message, 'Import apply exhausted its queue retries')
})

async function main() {
  let failed = 0
  const originalError = console.error
  for (const test of tests) {
    console.error = () => {}
    try {
      await test.fn()
      console.error = originalError
      console.log(`PASS ${test.name}`)
    } catch (error) {
      console.error = originalError
      failed++
      console.error(`FAIL ${test.name}\n  ${error && error.stack || error}`)
    }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`)
  if (failed) process.exitCode = 1
}

main()
