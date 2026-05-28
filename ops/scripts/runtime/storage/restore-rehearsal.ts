/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT_DIR = path.resolve(__dirname, '../../../..')
const DEFAULT_RESTORE_CANDIDATES_REPORT = path.join(ROOT_DIR, 'ops', 'runtime', 'reports', 'restore-candidates-latest.json')
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

type RestoreRehearsalArgs = {
  backupPath: string
  output: string
  keepDb: boolean
  container: string
  user: string
}

type BusinessCounts = Record<string, number>

type DockerRunOptions = {
  input?: string
  encoding?: BufferEncoding
  maxBuffer?: number
}

function parseArgs(argv = process.argv.slice(2)): RestoreRehearsalArgs {
  const args = {
    backupPath: '',
    output: '',
    keepDb: false,
    container: process.env.BUSINESS_OS_POSTGRES_CONTAINER || 'business-os-postgres-1',
    user: process.env.POSTGRES_USER || 'business_os',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--backup-path') args.backupPath = argv[++index] || ''
    else if (value === '--output') args.output = argv[++index] || ''
    else if (value === '--keep-db') args.keepDb = true
    else if (value === '--container') args.container = argv[++index] || args.container
    else if (value === '--user') args.user = argv[++index] || args.user
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (args.output) args.output = assertInsideWorkspace(path.resolve(ROOT_DIR, args.output))
  args.backupPath = args.backupPath
    ? assertInsideWorkspace(path.resolve(ROOT_DIR, args.backupPath))
    : resolveRecommendedBackupPath()
  return args
}

function assertInsideWorkspace(target: string): string {
  const relative = path.relative(ROOT_DIR, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Refusing path outside workspace: ${target}`)
  return target
}

function readJson(filePath: string): Record<string, unknown> {
  const buffer = fs.readFileSync(filePath)
  const text = buffer[0] === 0xff && buffer[1] === 0xfe
    ? buffer.toString('utf16le')
    : buffer.toString('utf8')
  return JSON.parse(text.replace(/^\uFEFF/, ''))
}

function resolveRecommendedBackupPath(): string {
  if (!fs.existsSync(DEFAULT_RESTORE_CANDIDATES_REPORT)) {
    throw new Error('No restore-candidates report found. Run npm.cmd --prefix ops run restore-candidates first, or pass --backup-path.')
  }
  const report = readJson(DEFAULT_RESTORE_CANDIDATES_REPORT)
  const relativePath = report?.recommendation?.recommended?.relativePath
  if (!relativePath) throw new Error('Restore-candidates report does not contain a recommended backup. Pass --backup-path.')
  return assertInsideWorkspace(path.resolve(ROOT_DIR, relativePath))
}

function countSqlCopyRows(sqlPath: string): BusinessCounts {
  const counts = Object.fromEntries(BUSINESS_TABLES.map((table) => [table, 0]))
  const tableSet = new Set(BUSINESS_TABLES)
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

function runDocker(args: RestoreRehearsalArgs, dockerArgs: string[], options: DockerRunOptions = {}): string {
  const result = spawnSync('docker', dockerArgs, {
    input: options.input,
    encoding: options.encoding || 'utf8',
    maxBuffer: options.maxBuffer || 1024 * 1024 * 50,
  })
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `docker exited with ${result.status}`).trim())
  }
  return String(result.stdout || '').trim()
}

function runPsql(args: RestoreRehearsalArgs, database: string, sql: string, options: DockerRunOptions = {}): string {
  return runDocker(args, [
    'exec', '-i', args.container, 'psql', '-U', args.user, '-d', database,
    '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql,
  ], options)
}

function createTempDatabaseName(): string {
  return `business_os_restore_rehearsal_${Date.now()}`
}

function quoteIdentifier(value: string): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

function createDatabase(args: RestoreRehearsalArgs, databaseName: string): void {
  runDocker(args, ['exec', args.container, 'createdb', '-U', args.user, databaseName])
}

function dropDatabase(args: RestoreRehearsalArgs, databaseName: string): void {
  runPsql(args, 'postgres', `
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '${databaseName.replace(/'/g, "''")}' AND pid <> pg_backend_pid();
  `)
  runDocker(args, ['exec', args.container, 'dropdb', '-U', args.user, '--if-exists', databaseName])
}

function restoreSql(args: RestoreRehearsalArgs, databaseName: string, sqlPath: string): void {
  const sql = fs.readFileSync(sqlPath, 'utf8')
  runDocker(args, [
    'exec', '-i', args.container, 'psql', '-U', args.user, '-d', databaseName,
    '-v', 'ON_ERROR_STOP=1',
  ], { input: sql, maxBuffer: 1024 * 1024 * 80 })
}

function countRestoredTables(args: RestoreRehearsalArgs, databaseName: string): BusinessCounts {
  const selectParts = BUSINESS_TABLES.map((table) => `'${table}', (SELECT COUNT(*)::integer FROM ${quoteIdentifier(table)})`)
  const output = runPsql(args, databaseName, `SELECT json_build_object(${selectParts.join(', ')})::text;`)
  const line = output.split(/\r?\n/).find((entry) => entry.trim().startsWith('{'))
  return JSON.parse(line) as BusinessCounts
}

function compareCounts(expected: BusinessCounts, actual: BusinessCounts) {
  return BUSINESS_TABLES.map((table) => ({
    table,
    expected: Number(expected[table] || 0),
    actual: Number(actual[table] || 0),
    match: Number(expected[table] || 0) === Number(actual[table] || 0),
  }))
}

try {
  const args = parseArgs()
  const sqlPath = path.join(args.backupPath, 'postgres.sql')
  const manifestPath = path.join(args.backupPath, 'manifest.json')
  if (!fs.existsSync(sqlPath)) throw new Error(`Backup does not contain postgres.sql: ${args.backupPath}`)
  if (!fs.existsSync(manifestPath)) throw new Error(`Backup does not contain manifest.json: ${args.backupPath}`)

  const manifest = readJson(manifestPath)
  const databaseName = createTempDatabaseName()
  const expectedCounts = countSqlCopyRows(sqlPath)
  let dropped = false
  let actualCounts = {}
  try {
    createDatabase(args, databaseName)
    restoreSql(args, databaseName, sqlPath)
    actualCounts = countRestoredTables(args, databaseName)
  } finally {
    if (!args.keepDb) {
      dropDatabase(args, databaseName)
      dropped = true
    }
  }

  const comparisons = compareCounts(expectedCounts, actualCounts)
  const mismatches = comparisons.filter((entry) => !entry.match)
  const report = {
    generatedAt: new Date().toISOString(),
    backup: {
      path: args.backupPath,
      relativePath: path.relative(ROOT_DIR, args.backupPath).replace(/\\/g, '/'),
      format: manifest?.format || '',
      createdAt: manifest?.createdAt || manifest?.created_at || '',
    },
    rehearsal: {
      database: databaseName,
      dropped,
      status: mismatches.length ? 'failed' : 'passed',
      mismatches,
      counts: comparisons,
    },
  }
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true })
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`)
  }
  console.log(JSON.stringify(report, null, 2))
  if (mismatches.length) process.exitCode = 2
} catch (error) {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
}
