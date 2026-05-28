/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')

const ROOT_DIR = path.resolve(__dirname, '../../../..')
const DEFAULT_BACKUP_ROOTS = [
  path.join(ROOT_DIR, 'ops', 'runtime', 'docker-release', 'backups'),
  path.join(ROOT_DIR, 'business-os-data', 'backups'),
]
const REQUIRED_FILES = ['manifest.json', 'postgres.sql', 'objects-manifest.jsonl']
const BUSINESS_TABLES = [
  'products',
  'product_batches',
  'branch_stock',
  'sales',
  'sale_items',
  'returns',
  'return_items',
  'inventory_movements',
  'stock_transfers',
]

type RestoreCandidatesArgs = {
  output: string
  failIfNoLoaded: boolean
  roots: string[]
}

type BusinessCounts = Record<string, number>

type BackupPackage = {
  name: string
  path: string
  relativePath: string
  valid: boolean
  missingFiles: string[]
  format: string
  createdAt: string
  updatedAt: string
  readiness: {
    status: 'loaded' | 'empty'
    loadedTables: string[]
    businessRows: number
    counts: BusinessCounts
  }
}

function parseArgs(argv = process.argv.slice(2)): RestoreCandidatesArgs {
  const args = {
    output: '',
    failIfNoLoaded: false,
    roots: [],
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--output') args.output = argv[++index] || ''
    else if (value === '--backup-root') args.roots.push(argv[++index] || '')
    else if (value === '--fail-if-no-loaded') args.failIfNoLoaded = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (args.output) args.output = assertInsideWorkspace(path.resolve(ROOT_DIR, args.output))
  args.roots = (args.roots.length ? args.roots : DEFAULT_BACKUP_ROOTS)
    .map((entry) => assertInsideWorkspace(path.resolve(ROOT_DIR, entry)))
  return args
}

function assertInsideWorkspace(target: string): string {
  const relative = path.relative(ROOT_DIR, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Refusing path outside workspace: ${target}`)
  return target
}

function readJson(filePath: string): Record<string, unknown> | null {
  try {
    const buffer = fs.readFileSync(filePath)
    const text = buffer[0] === 0xff && buffer[1] === 0xfe
      ? buffer.toString('utf16le')
      : buffer.toString('utf8')
    return JSON.parse(text.replace(/^\uFEFF/, ''))
  } catch {
    return null
  }
}

function countSqlCopyRows(sqlPath: string, tables = BUSINESS_TABLES): BusinessCounts {
  const counts = Object.fromEntries(tables.map((table) => [table, 0]))
  if (!fs.existsSync(sqlPath)) return counts
  const tableSet = new Set(tables)
  const text = fs.readFileSync(sqlPath, 'utf8')
  let currentTable = ''
  for (const line of text.split(/\r?\n/)) {
    if (!currentTable) {
      const match = line.match(/^COPY public\.([a-zA-Z0-9_]+)\s+\(/)
      if (match && tableSet.has(match[1])) currentTable = match[1]
      continue
    }
    if (line === '\\.') {
      currentTable = ''
      continue
    }
    if (line.trim()) counts[currentTable] += 1
  }
  return counts
}

function summarizeCounts(counts: BusinessCounts): BackupPackage['readiness'] {
  const loadedTables = BUSINESS_TABLES.filter((table) => Number(counts[table] || 0) > 0)
  return {
    status: loadedTables.length ? 'loaded' : 'empty',
    loadedTables,
    businessRows: BUSINESS_TABLES.reduce((sum, table) => sum + Number(counts[table] || 0), 0),
    counts,
  }
}

function inspectBackupPackage(backupPath: string): BackupPackage {
  const manifestPath = path.join(backupPath, 'manifest.json')
  const manifest = readJson(manifestPath)
  const missingFiles = REQUIRED_FILES.filter((file) => !fs.existsSync(path.join(backupPath, file)))
  const stat = fs.statSync(backupPath)
  const counts = countSqlCopyRows(path.join(backupPath, 'postgres.sql'))
  const summary = summarizeCounts(counts)
  return {
    name: path.basename(backupPath),
    path: backupPath,
    relativePath: path.relative(ROOT_DIR, backupPath).replace(/\\/g, '/'),
    valid: missingFiles.length === 0 && String(manifest?.format || '').startsWith('business-os-backup-v'),
    missingFiles,
    format: manifest?.format || '',
    createdAt: manifest?.createdAt || manifest?.created_at || '',
    updatedAt: stat.mtime.toISOString(),
    readiness: summary,
  }
}

function findBackupPackages(roots: string[]): BackupPackage[] {
  const packages: BackupPackage[] = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const backupPath = path.join(root, entry.name)
      if (!REQUIRED_FILES.some((file) => fs.existsSync(path.join(backupPath, file)))) continue
      packages.push(inspectBackupPackage(backupPath))
    }
  }
  return packages.sort((a, b) => String(b.createdAt || b.name).localeCompare(String(a.createdAt || a.name)))
}

function chooseRecommendation(packages: BackupPackage[]) {
  const loaded = packages.filter((entry) => entry.valid && entry.readiness.status === 'loaded')
  const latestLoaded = loaded[0] || null
  const largestLoaded = [...loaded].sort((a, b) => {
    const rowDiff = Number(b.readiness.businessRows || 0) - Number(a.readiness.businessRows || 0)
    if (rowDiff) return rowDiff
    return String(b.createdAt || b.name).localeCompare(String(a.createdAt || a.name))
  })[0] || null
  const recommended = largestLoaded || latestLoaded
  return {
    status: recommended ? 'restore-candidate-found' : 'no-loaded-backup-candidate',
    latestLoaded: latestLoaded ? {
      name: latestLoaded.name,
      relativePath: latestLoaded.relativePath,
      createdAt: latestLoaded.createdAt,
      businessRows: latestLoaded.readiness.businessRows,
      counts: latestLoaded.readiness.counts,
    } : null,
    largestLoaded: largestLoaded ? {
      name: largestLoaded.name,
      relativePath: largestLoaded.relativePath,
      createdAt: largestLoaded.createdAt,
      businessRows: largestLoaded.readiness.businessRows,
      counts: largestLoaded.readiness.counts,
    } : null,
    recommended: recommended ? {
      basis: largestLoaded ? 'largest-valid-loaded-backup' : 'latest-valid-loaded-backup',
      name: recommended.name,
      relativePath: recommended.relativePath,
      createdAt: recommended.createdAt,
      businessRows: recommended.readiness.businessRows,
      counts: recommended.readiness.counts,
    } : null,
    note: recommended
      ? 'Review the recommended backup package, then restore with run/docker/restore.bat -BackupPath <path> if it is the intended business dataset.'
      : 'No valid backup with transactional business rows was found in scanned roots.',
  }
}

try {
  const args = parseArgs()
  const packages = findBackupPackages(args.roots)
  const recommendation = chooseRecommendation(packages)
  const report = {
    generatedAt: new Date().toISOString(),
    roots: args.roots.map((entry) => path.relative(ROOT_DIR, entry).replace(/\\/g, '/')),
    packageCount: packages.length,
    recommendation,
    packages,
  }
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true })
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`)
  }
  console.log(JSON.stringify(report, null, 2))
  if (args.failIfNoLoaded && !recommendation.recommended) {
    console.error(recommendation.note)
    process.exitCode = 2
  }
} catch (error) {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
}
