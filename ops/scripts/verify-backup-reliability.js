#!/usr/bin/env node
/* eslint-disable no-console */
'use strict'

const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
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

function main() {
  const failures = []
  const backupPackages = read('backend/src/services/backupPackages.js')
  const driveSync = read('backend/src/services/googleDriveSync/index.js')
  const systemJobs = read('backend/src/systemJobs.js')
  const maintenanceLock = read('backend/src/maintenanceLock.js')
  const systemRoutes = read('backend/src/routes/system/index.js')
  const backupUi = read('frontend/src/components/utils-settings/Backup.jsx')
  const apiMethods = read('frontend/src/api/methods.js')
  const offlineApi = read('frontend/src/web-api.js')
  const fullAutomation = read('ops/scripts/powershell/full-automation.ps1')

  requireText(failures, 'backend/src/services/backupPackages.js', backupPackages, 'async function streamBackupDataFile')
  requireText(failures, 'backend/src/services/backupPackages.js', backupPackages, 'LIMIT ? OFFSET ?')
  requireText(failures, 'backend/src/services/backupPackages.js', backupPackages, 'buildBackupSummaryFromCounts')
  requireText(failures, 'backend/src/services/backupPackages.js', backupPackages, 'async function copyPackageObjects')
  requireText(failures, 'backend/src/services/backupPackages.js', backupPackages, 'await Promise.all([worker(), worker()])')
  requireText(failures, 'backend/src/services/backupPackages.js', backupPackages, 'objects-errors.json')
  requireText(failures, 'backend/src/services/backupPackages.js', backupPackages, 'fs.createReadStream')
  requireText(failures, 'backend/src/services/backupPackages.js', backupPackages, 'throwIfCancelled')
  forbidText(failures, 'backend/src/services/backupPackages.js', backupPackages, 'JSON.stringify({ tables })')
  forbidText(failures, 'backend/src/services/backupPackages.js', backupPackages, 'const tables = {}')
  forbidText(failures, 'backend/src/services/backupPackages.js', backupPackages, 'fs.readFileSync(file.absolutePath)')

  requireText(failures, 'backend/src/services/googleDriveSync/index.js', driveSync, 'uploadType=resumable')
  requireText(failures, 'backend/src/services/googleDriveSync/index.js', driveSync, 'DRIVE_RESUMABLE_CHUNK_BYTES')
  requireText(failures, 'backend/src/services/googleDriveSync/index.js', driveSync, 'upload_session_url')
  requireText(failures, 'backend/src/services/googleDriveSync/index.js', driveSync, 'content_sha256')
  requireText(failures, 'backend/src/services/googleDriveSync/index.js', driveSync, 'uploadedBytes')
  requireText(failures, 'backend/src/services/googleDriveSync/index.js', driveSync, 'retryCount')
  requireText(failures, 'backend/src/services/googleDriveSync/index.js', driveSync, 'isMaintenanceLocked')
  forbidText(failures, 'backend/src/services/googleDriveSync/index.js', driveSync, 'fs.readFileSync(file.absolutePath)')
  forbidText(failures, 'backend/src/services/googleDriveSync/index.js', driveSync, 'Buffer.concat')
  forbidText(failures, 'backend/src/services/googleDriveSync/index.js', driveSync, 'buildMultipartBody')

  requireText(failures, 'backend/src/systemJobs.js', systemJobs, 'cancelSystemJob')
  requireText(failures, 'backend/src/systemJobs.js', systemJobs, 'AbortController')
  requireText(failures, 'backend/src/systemJobs.js', systemJobs, 'cancel_requested_at')
  requireText(failures, 'backend/src/systemJobs.js', systemJobs, 'metrics_json')
  requireText(failures, 'backend/src/systemJobs.js', systemJobs, 'SystemJobCancelledError')
  requireText(failures, 'backend/src/maintenanceLock.js', maintenanceLock, 'system_busy')
  requireText(failures, 'backend/src/routes/system/index.js', systemRoutes, "router.post('/jobs/:id/cancel'")
  requireText(failures, 'backend/src/routes/system/index.js', systemRoutes, 'withMaintenanceLock')

  requireText(failures, 'frontend/src/api/methods.js', apiMethods, 'cancelSystemJob')
  ;[
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
  ].forEach((testId) => requireText(failures, 'frontend/src/components/utils-settings/Backup.jsx', backupUi, `data-testid="${testId}"`))
  requireText(failures, 'frontend/src/components/utils-settings/Backup.jsx', backupUi, 'DRIVE_SYNC_PRESET_HOURS = [3, 6, 9, 12, 24]')
  requireText(failures, 'frontend/src/components/utils-settings/Backup.jsx', backupUi, 'data-testid={`backup-drive-preset-${hours}h`}')
  requireText(failures, 'frontend/src/components/utils-settings/Backup.jsx', backupUi, 'window.setTimeout(tick')
  requireText(failures, 'frontend/src/components/utils-settings/Backup.jsx', backupUi, 'cancelActiveBackupJob')
  requireText(failures, 'frontend/src/components/utils-settings/Backup.jsx', backupUi, 'cancelActiveJob')
  forbidText(failures, 'frontend/src/components/utils-settings/Backup.jsx', backupUi, 'window.setInterval(tick')
  forbidText(failures, 'frontend/src/components/utils-settings/Backup.jsx', backupUi, 'await window.api.pollSystemJob')

  requireText(failures, 'frontend/src/web-api.js', offlineApi, 'system_busy')
  requireText(failures, 'frontend/src/web-api.js', offlineApi, "status: 'retry'")
  requireText(failures, 'frontend/src/web-api.js', offlineApi, "status: 'paused'")

  requireText(failures, 'ops/scripts/powershell/full-automation.ps1', fullAutomation, '$BackupReliabilityVerify')
  requireText(failures, 'ops/scripts/powershell/full-automation.ps1', fullAutomation, 'Backup reliability verification')

  if (failures.length) {
    console.error('Backup reliability verification failed:')
    failures.forEach((failure) => console.error(`- ${failure}`))
    process.exit(1)
  }

  console.log('Backup reliability verification passed: streaming backup, resumable Drive, cancellable jobs, UI buttons, and offline pause gates are wired.')
}

main()
