'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_ALLOWED_RELATIVE_FILES = new Set([
  'backend/src/database.js',
  'backend/src/config/index.js',
  'backend/src/legacy/sqliteBackupReader.js',
  'backend/src/workers/migrationWorker.js',
  'backend/src/db/cutoverReadiness.js',
])

const FORBIDDEN_PATTERNS = [
  {
    code: 'better_sqlite3_import',
    description: 'Live source imports better-sqlite3',
    regex: /require\(\s*['"]better-sqlite3['"]\s*\)/,
  },
  {
    code: 'sqlite_connection',
    description: 'Live source opens a direct SQLite connection',
    regex: /\bnew\s+Database\s*\(/,
  },
]

function normalizeRelative(filePath) {
  return String(filePath || '').replace(/\\/g, '/')
}

function toRelative(root, filePath) {
  return normalizeRelative(path.relative(root, filePath))
}

function shouldSkipDir(name) {
  return name === 'node_modules'
    || name === 'frontend-dist'
    || name === 'dist'
    || name === 'coverage'
    || name === '.git'
}

function listJavaScriptFiles(dir) {
  const files = []
  if (!fs.existsSync(dir)) return files
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) files.push(...listJavaScriptFiles(fullPath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath)
  }
  return files
}

function analyzeFile({ repoRoot, filePath, allowedRelativeFiles }) {
  const relativePath = toRelative(repoRoot, filePath)
  if (allowedRelativeFiles.has(relativePath)) return []

  const source = fs.readFileSync(filePath, 'utf8')
  const lines = source.split(/\r?\n/)
  const blockers = []
  lines.forEach((line, index) => {
    FORBIDDEN_PATTERNS.forEach((pattern) => {
      if (!pattern.regex.test(line)) return
      blockers.push({
        file: relativePath,
        line: index + 1,
        code: pattern.code,
        description: pattern.description,
        snippet: line.trim().slice(0, 240),
      })
    })
  })
  return blockers
}

function summarizeBlockers(blockers) {
  const byFile = new Map()
  const byCode = new Map()
  blockers.forEach((blocker) => {
    byFile.set(blocker.file, (byFile.get(blocker.file) || 0) + 1)
    byCode.set(blocker.code, (byCode.get(blocker.code) || 0) + 1)
  })
  return {
    byFile: Array.from(byFile.entries())
      .map(([file, count]) => ({ file, count }))
      .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file)),
    byCode: Array.from(byCode.entries())
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
  }
}

function analyzePostgresCutoverReadiness(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..', '..', '..'))
  const srcRoot = path.resolve(options.srcRoot || path.join(repoRoot, 'backend', 'src'))
  const packagedRuntime = options.packagedRuntime === true || (options.packagedRuntime !== false && !!process.pkg)
  const allowedRelativeFiles = new Set([
    ...DEFAULT_ALLOWED_RELATIVE_FILES,
    ...(options.allowedRelativeFiles || []),
  ].map(normalizeRelative))

  const files = listJavaScriptFiles(srcRoot)
  let blockers = files.length === 0
    ? [{
        file: normalizeRelative(path.relative(repoRoot, srcRoot) || srcRoot),
        line: 0,
        code: 'cutover_source_unavailable',
        description: 'Postgres cutover readiness cannot prove live SQLite routes are gone because source files are not available on disk',
        snippet: 'Source scan found no JavaScript files. Treating cutover as locked.',
      }]
    : files
    .flatMap((filePath) => analyzeFile({ repoRoot, filePath, allowedRelativeFiles }))

  if (packagedRuntime && process.env.BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED !== '1') {
    blockers = [{
      file: 'runtime',
      line: 0,
      code: 'cutover_manifest_missing',
      description: 'Compiled Docker runtime has no verified Postgres/MinIO cutover manifest',
      snippet: 'Set BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED=1 only after all live routes use Postgres repositories and MinIO adapters.',
    }, ...blockers]
  }

  return {
    ready: blockers.length === 0,
    blockerCount: blockers.length,
    blockers,
    summary: summarizeBlockers(blockers),
    allowedLegacyFiles: Array.from(allowedRelativeFiles).sort(),
    scannedRoot: normalizeRelative(path.relative(repoRoot, srcRoot) || srcRoot),
  }
}

module.exports = {
  analyzePostgresCutoverReadiness,
  FORBIDDEN_PATTERNS,
}
