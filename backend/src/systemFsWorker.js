'use strict'

/**
 * systemFsWorker.js
 *
 * Runs heavy filesystem-only system tasks in a child process so the main
 * Express server can continue serving pages while backups/data relocation run.
 */

const fs = require('fs')
const path = require('path')

const { copyDirectoryContents, relocateDataRoot, summarizeDataRoot, isSamePath, isSubPath } = require('./dataPath')

function formatBackupStamp() {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function respond(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function fail(message) {
  respond({ ok: false, error: String(message || 'Worker failed') })
  process.exit(1)
}

function runExportFolder(payload = {}) {
  const sourceRoot = path.resolve(String(payload.sourceRoot || ''))
  const destinationDir = path.resolve(String(payload.destinationDir || ''))
  const dataFolderName = String(payload.dataFolderName || 'business-os-data')
  const backupVersion = Number(payload.backupVersion || 0) || null

  if (!sourceRoot) throw new Error('sourceRoot is required')
  if (!destinationDir) throw new Error('destinationDir is required')
  if (isSamePath(destinationDir, sourceRoot) || isSubPath(sourceRoot, destinationDir)) {
    throw new Error('Choose a backup destination outside the current live data folder.')
  }

  fs.mkdirSync(destinationDir, { recursive: true })
  const stamp = formatBackupStamp()
  const backupRoot = path.join(destinationDir, `business-os-backup-${stamp}`)
  const backupDataRoot = path.join(backupRoot, dataFolderName)
  fs.mkdirSync(backupRoot, { recursive: true })

  const copyStats = copyDirectoryContents(sourceRoot, backupDataRoot)
  const summary = summarizeDataRoot(backupDataRoot)
  const infoPath = path.join(backupRoot, 'business-os-backup-info.json')

  fs.writeFileSync(infoPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    sourceRoot,
    dataRoot: backupDataRoot,
    summary,
    copyStats,
    version: backupVersion,
  }, null, 2))

  return {
    backupRoot,
    dataRoot: backupDataRoot,
    infoPath,
    summary,
    copyStats,
  }
}

function runRelocateDataRoot(payload = {}) {
  const sourceRoot = String(payload.sourceRoot || '')
  const targetRoot = String(payload.targetRoot || '')
  if (!sourceRoot || !targetRoot) throw new Error('sourceRoot and targetRoot are required')
  return relocateDataRoot({ sourceRoot, targetRoot })
}

function main() {
  const action = String(process.argv[2] || '').trim()
  const payloadRaw = String(process.argv[3] || '{}')
  const payload = JSON.parse(payloadRaw)

  let result
  if (action === 'export-folder') result = runExportFolder(payload)
  else if (action === 'relocate-data-root') result = runRelocateDataRoot(payload)
  else throw new Error(`Unsupported worker action: ${action || '(missing)'}`)

  respond({ ok: true, result })
}

try {
  main()
} catch (error) {
  fail(error?.message || error)
}
