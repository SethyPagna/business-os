#!/usr/bin/env node
/* eslint-disable no-console */
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { readUtf8 } = require('../lib/fs-utils.ts')

const root = path.resolve(__dirname, '..', '..', '..')

function read(relativePath) {
  return readUtf8(path.join(root, relativePath))
}

function lineFor(text, needle) {
  const index = text.indexOf(needle)
  if (index < 0) return 0
  return text.slice(0, index).split(/\r?\n/).length
}

function requireText(failures, file, text, needle) {
  if (!text.includes(needle)) failures.push(`${file} is missing required text: ${needle}`)
}

function forbidText(failures, file, text, needle) {
  if (text.includes(needle)) failures.push(`${file}:${lineFor(text, needle)} contains forbidden blocking pattern: ${needle}`)
}

function checkNeedles(failures, sources, expectations, checker) {
  Object.entries(expectations).forEach(([key, needles]) => {
    const source = sources[key]
    needles.forEach((needle) => checker(failures, source.file, source.text, needle))
  })
}

function main() {
  const failures = []
  const sources = {
    backupPackages: { file: 'backend/src/services/backupPackages.js', text: read('backend/src/services/backupPackages.js') },
    driveSync: { file: 'backend/src/services/googleDriveSync/index.js', text: read('backend/src/services/googleDriveSync/index.js') },
    systemJobs: { file: 'backend/src/systemJobs.js', text: read('backend/src/systemJobs.js') },
    maintenanceLock: { file: 'backend/src/maintenanceLock.js', text: read('backend/src/maintenanceLock.js') },
    systemRoutes: { file: 'backend/src/routes/system/index.js', text: read('backend/src/routes/system/index.js') },
    backupUi: { file: 'frontend/src/components/utils-settings/Backup.tsx', text: read('frontend/src/components/utils-settings/Backup.tsx') },
    apiMethods: { file: 'frontend/src/api/methods.js', text: read('frontend/src/api/methods.js') },
    offlineApi: { file: 'frontend/src/web-api.ts', text: read('frontend/src/web-api.ts') },
    fullAutomation: { file: 'ops/scripts/powershell/full-automation.ps1', text: read('ops/scripts/powershell/full-automation.ps1') },
  }

  const backupUiTestIds = [
    'backup-job-cancel',
    'backup-job-progress',
    'backup-doctor-refresh',
    'backup-doctor-deep',
    'backup-export-create',
    'backup-restore-start',
    'backup-drive-save',
    'backup-drive-connect',
    'backup-drive-sync-now',
    'backup-drive-disconnect',
    'backup-drive-forget',
  ].map((testId) => `data-testid="${testId}"`)

  checkNeedles(failures, sources, {
    backupPackages: [
      'async function streamBackupDataFile',
      'LIMIT ? OFFSET ?',
      'buildBackupSummaryFromCounts',
      'async function copyPackageObjects',
      'writeJsonLinesFileWithChecksum',
      'async function validateLocalBackupPackage',
      'function sha256File',
      'OBJECT_COPY_CONCURRENCY = 2',
      'function startWorkerPromises',
      'startWorkerPromises(OBJECT_COPY_CONCURRENCY, worker)',
      'objects-errors.json',
      'fs.createReadStream',
      'throwIfCancelled',
    ],
    driveSync: [
      'uploadType=resumable',
      'hashFileMany',
      'DRIVE_RESUMABLE_CHUNK_BYTES',
      'upload_session_url',
      'content_sha256',
      'uploadedBytes',
      'retryCount',
      'isMaintenanceLocked',
    ],
    systemJobs: [
      'cancelSystemJob',
      'AbortController',
      'cancel_requested_at',
      'metrics_json',
      'SystemJobCancelledError',
    ],
    maintenanceLock: ['system_busy'],
    systemRoutes: ["router.post('/jobs/:id/cancel'", 'withMaintenanceLock'],
    apiMethods: ['cancelSystemJob'],
    backupUi: [
      ...backupUiTestIds,
      'DRIVE_SYNC_PRESET_HOURS = [3, 6, 9, 12, 24]',
      'data-testid={`backup-drive-preset-${hours}h`}',
      'window.setTimeout(tick',
      'cancelActiveBackupJob',
      'cancelActiveJob',
    ],
    offlineApi: ['system_busy', "status: 'retry'", "status: 'paused'"],
    fullAutomation: ['$BackupReliabilityVerify', 'Backup reliability verification'],
  }, requireText)

  checkNeedles(failures, sources, {
    backupPackages: [
      'JSON.stringify({ tables })',
      'const tables = {}',
      'fs.readFileSync(file.absolutePath)',
      'sha256(fs.readFileSync(filePath))',
      "objectManifest.map((item) => JSON.stringify(item)).join('\\n')",
    ],
    driveSync: [
      'fs.readFileSync(file.absolutePath)',
      'fs.copyFileSync',
      'fs.statSync',
      'Buffer.concat',
      'buildMultipartBody',
    ],
    backupUi: ['window.setInterval(tick', 'await window.api.pollSystemJob'],
  }, forbidText)

  if (failures.length) {
    console.error('Backup reliability verification failed:')
    failures.forEach((failure) => console.error(`- ${failure}`))
    process.exit(1)
  }

  console.log('Backup reliability verification passed: streaming backup, resumable Drive, cancellable jobs, UI buttons, and offline pause gates are wired.')
}

main()
