'use strict'

const fs = require('fs')
const path = require('path')

const EMBEDDED_DB_PACKAGE = ['better', 'sql' + 'ite3'].join('-')

const FORBIDDEN_PATTERNS = [
  {
    code: 'embedded_db_import',
    description: 'Live source imports the retired embedded database package',
    regex: new RegExp(`require\\(\\s*['"]${EMBEDDED_DB_PACKAGE.replace('-', '\\-')}['"]\\s*\\)`),
  },
  {
    code: 'direct_embedded_connection',
    description: 'Live source opens a direct embedded database connection',
    regex: /\bnew\s+Database\s*\(/,
  },
  {
    code: 'retired_sqlite_time_function',
    description: 'Live source uses retired SQLite time formatting instead of Postgres date functions',
    regex: /\bstrftime\s*\(/i,
  },
  {
    code: 'retired_sqlite_string_aggregate',
    description: 'Live source uses retired SQLite GROUP_CONCAT instead of Postgres STRING_AGG',
    regex: /\bGROUP_CONCAT\s*\(/i,
  },
  {
    code: 'retired_sqlite_json_aggregate',
    description: 'Live source uses retired SQLite JSON aggregate helpers instead of Postgres JSON functions',
    regex: /\bjson_group_array\s*\(|\bjson_object\s*\(/i,
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

function analyzeFile({ repoRoot, filePath }) {
  const relativePath = toRelative(repoRoot, filePath)
  const source = fs.readFileSync(filePath, 'utf8')
  const lines = source.split(/\r?\n/)
  const blockers = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (!pattern.regex.test(line)) continue
      blockers.push({
        file: relativePath,
        line: index + 1,
        code: pattern.code,
        description: pattern.description,
        snippet: line.trim().slice(0, 240),
      })
    }
  }
  return blockers
}

function incrementCount(map, key) {
  map.set(key, (map.get(key) || 0) + 1)
}

function mapCountsToRows(map, keyName) {
  const rows = []
  for (const [key, count] of map.entries()) {
    rows.push({ [keyName]: key, count })
  }
  return rows
}

function summarizeBlockers(blockers) {
  const byFile = new Map()
  const byCode = new Map()
  for (const blocker of blockers) {
    incrementCount(byFile, blocker.file)
    incrementCount(byCode, blocker.code)
  }
  const fileRows = mapCountsToRows(byFile, 'file')
  const codeRows = mapCountsToRows(byCode, 'code')
  fileRows.sort((a, b) => b.count - a.count || a.file.localeCompare(b.file))
  codeRows.sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
  return {
    byFile: fileRows,
    byCode: codeRows,
  }
}

function analyzeFiles({ repoRoot, files }) {
  const blockers = []
  for (const filePath of files) {
    const fileBlockers = analyzeFile({ repoRoot, filePath })
    for (const blocker of fileBlockers) blockers.push(blocker)
  }
  return blockers
}

function analyzePostgresCutoverReadiness(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || path.join(__dirname, '..', '..', '..'))
  const srcRoot = path.resolve(options.srcRoot || path.join(repoRoot, 'backend', 'src'))
  const packagedRuntime = options.packagedRuntime === true || (options.packagedRuntime !== false && !!process.pkg)
  const files = listJavaScriptFiles(srcRoot)
  let blockers = files.length === 0
    ? [{
        file: normalizeRelative(path.relative(repoRoot, srcRoot) || srcRoot),
        line: 0,
        code: 'source_unavailable',
        description: 'Final runtime readiness cannot prove retired live routes are gone because source files are not available on disk',
        snippet: 'Source scan found no JavaScript files. Treating runtime as locked.',
      }]
    : analyzeFiles({ repoRoot, files })

  if (packagedRuntime && process.env.BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED !== '1') {
    blockers = [{
      file: 'runtime',
      line: 0,
      code: 'cutover_manifest_missing',
      description: 'Compiled Docker runtime has no verified Postgres/object-storage cutover manifest',
      snippet: 'Set BUSINESS_OS_POSTGRES_CUTOVER_VERIFIED=1 only after all live routes use Postgres repositories and the shared object-storage adapter.',
    }, ...blockers]
  }

  return {
    ready: blockers.length === 0,
    blockerCount: blockers.length,
    blockers,
    summary: summarizeBlockers(blockers),
    allowedLegacyFiles: [],
    scannedRoot: normalizeRelative(path.relative(repoRoot, srcRoot) || srcRoot),
  }
}

module.exports = {
  analyzePostgresCutoverReadiness,
  FORBIDDEN_PATTERNS,
}
