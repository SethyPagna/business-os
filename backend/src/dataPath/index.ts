'use strict'

const fs = require('fs')
const path = require('path')

const UPLOADS_FOLDER_NAME = 'uploads'
const BACKUPS_FOLDER_NAME = 'backups'

/**
 * @typedef {(absolutePath: string) => void} FileVisitor
 *
 * @typedef {{
 *   root: string,
 *   exists: boolean,
 *   hasData: boolean,
 *   uploadCount: number,
 *   uploadBytes: number,
 *   backupCount: number,
 *   backupBytes: number,
 *   totalFileCount: number,
 *   totalBytes: number,
 *   lastModifiedAt: string | null,
 * }} DataRootSummary
 *
 * @typedef {{
 *   sourceRoot?: string,
 *   targetRoot?: string,
 *   checkpointDatabase?: () => void,
 * }} RelocateDataRootOptions
 */

function normalizePathForCompare(value) {
  return path.resolve(String(value || ''))
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}

function isSamePath(a, b) {
  return normalizePathForCompare(a) === normalizePathForCompare(b)
}

function isSubPath(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function ensureDataRootLayout(root) {
  const folders = [UPLOADS_FOLDER_NAME, BACKUPS_FOLDER_NAME, 'imports', 'exports', 'logs', 'tmp', 'meta', 'snapshots']
  for (const folder of folders) {
    fs.mkdirSync(path.join(root, folder), { recursive: true })
  }
}

/**
 * @param {string} root
 * @param {FileVisitor} visitor
 */
function walkFiles(root, visitor) {
  if (!fs.existsSync(root)) return
  const stack = [path.resolve(root)]
  while (stack.length) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absolutePath)
        continue
      }
      if (!entry.isFile()) continue
      visitor(absolutePath)
    }
  }
}

/**
 * @param {string} root
 * @returns {DataRootSummary}
 */
function summarizeDataRoot(root) {
  const resolvedRoot = path.resolve(root)
  const uploadsPath = path.join(resolvedRoot, UPLOADS_FOLDER_NAME)
  const backupsPath = path.join(resolvedRoot, BACKUPS_FOLDER_NAME)

  let totalFileCount = 0
  let totalBytes = 0
  let uploadCount = 0
  let uploadBytes = 0
  let backupCount = 0
  let backupBytes = 0
  let lastModifiedMs = 0

  walkFiles(resolvedRoot, (filePath) => {
    const stats = fs.statSync(filePath)
    totalFileCount += 1
    totalBytes += stats.size
    if (stats.mtimeMs > lastModifiedMs) lastModifiedMs = stats.mtimeMs

    if (isSamePath(path.dirname(filePath), uploadsPath) || isSubPath(uploadsPath, filePath)) {
      uploadCount += 1
      uploadBytes += stats.size
    }
    if (isSamePath(path.dirname(filePath), backupsPath) || isSubPath(backupsPath, filePath)) {
      backupCount += 1
      backupBytes += stats.size
    }
  })

  return {
    root: resolvedRoot,
    exists: fs.existsSync(resolvedRoot),
    hasData: totalFileCount > 0,
    uploadCount,
    uploadBytes,
    backupCount,
    backupBytes,
    totalFileCount,
    totalBytes,
    lastModifiedAt: lastModifiedMs ? new Date(lastModifiedMs).toISOString() : null,
  }
}

function copyDirectoryContents(sourceRoot, targetRoot) {
  const source = path.resolve(sourceRoot)
  const target = path.resolve(targetRoot)
  ensureDataRootLayout(target)

  if (!fs.existsSync(source)) {
    return { copiedFileCount: 0, copiedBytes: 0 }
  }

  let copiedFileCount = 0
  let copiedBytes = 0
  const stack = [{ source, target }]

  while (stack.length) {
    const current = stack.pop()
    const entries = fs.readdirSync(current.source, { withFileTypes: true })
    for (const entry of entries) {
      const sourcePath = path.join(current.source, entry.name)
      const targetPath = path.join(current.target, entry.name)

      if (entry.isDirectory()) {
        fs.mkdirSync(targetPath, { recursive: true })
        stack.push({ source: sourcePath, target: targetPath })
        continue
      }

      if (!entry.isFile()) continue
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.copyFileSync(sourcePath, targetPath)
      copiedFileCount += 1
      copiedBytes += fs.statSync(sourcePath).size
    }
  }

  return { copiedFileCount, copiedBytes }
}

function buildArchivedTargetPath(targetRoot) {
  const target = path.resolve(targetRoot)
  const parentDir = path.dirname(target)
  const baseName = path.basename(target)
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  let attempt = 0

  while (attempt < 1000) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`
    const candidate = path.join(parentDir, `${baseName}-archive-${stamp}${suffix}`)
    if (!fs.existsSync(candidate)) return candidate
    attempt += 1
  }

  throw new Error('Failed to reserve an archive path for the existing Business OS data folder.')
}

function waitForFileSystemRetry(delayMs) {
  const buffer = new SharedArrayBuffer(4)
  const view = new Int32Array(buffer)
  Atomics.wait(view, 0, 0, delayMs)
}

function renameDirectoryWithRetry(sourcePath, targetPath, attempts = 8) {
  let lastError = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.renameSync(sourcePath, targetPath)
      return
    } catch (error) {
      lastError = error
      const retryable = ['EBUSY', 'EPERM', 'EACCES'].includes(String(error?.code || ''))
      if (!retryable || attempt === attempts - 1) break
      waitForFileSystemRetry(50 * (attempt + 1))
    }
  }
  throw lastError
}

/**
 * @param {RelocateDataRootOptions} [options]
 */
function relocateDataRoot({ sourceRoot, targetRoot, checkpointDatabase } = {}) {
  const source = path.resolve(String(sourceRoot || ''))
  const target = path.resolve(String(targetRoot || ''))

  if (!sourceRoot || !targetRoot) throw new Error('Source and target data roots are required')
  if (isSamePath(source, target)) {
    return {
      sourceSummary: summarizeDataRoot(source),
      targetSummaryBefore: summarizeDataRoot(target),
      targetSummaryAfter: summarizeDataRoot(target),
      copyStats: { copiedFileCount: 0, copiedBytes: 0 },
      skipped: true,
    }
  }
  if (isSubPath(source, target) || isSubPath(target, source)) {
    throw new Error('Choose a folder outside the current Business OS data path.')
  }

  const sourceSummary = summarizeDataRoot(source)
  const targetSummaryBefore = summarizeDataRoot(target)
  let archivedTargetPath = null

  if (targetSummaryBefore.hasData) {
    archivedTargetPath = buildArchivedTargetPath(target)
    renameDirectoryWithRetry(target, archivedTargetPath)
  }

  ensureDataRootLayout(target)
  if (typeof checkpointDatabase === 'function') checkpointDatabase()
  const copyStats = sourceSummary.hasData
    ? copyDirectoryContents(source, target)
    : { copiedFileCount: 0, copiedBytes: 0 }
  const targetSummaryAfter = summarizeDataRoot(target)

  return {
    sourceSummary,
    targetSummaryBefore,
    targetSummaryAfter,
    archivedTargetPath,
    copyStats,
    skipped: false,
  }
}

module.exports = {
  BACKUPS_FOLDER_NAME,
  UPLOADS_FOLDER_NAME,
  copyDirectoryContents,
  ensureDataRootLayout,
  isSamePath,
  isSubPath,
  relocateDataRoot,
  renameDirectoryWithRetry,
  summarizeDataRoot,
  walkFiles,
}
