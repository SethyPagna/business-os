/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT_DIR = path.resolve(__dirname, '../../..')
const DEFAULT_OUTPUT = 'ops/runtime/reports/schema-primary-key-preflight-latest.json'

type PreflightArgs = {
  output: string
  failOnBlocker: boolean
  container: string
  user: string
  database: string
}

type PreflightTableResult = {
  targetColumn?: string
  rowCount?: number
  nullKeys?: number
  duplicateKeyGroups?: number
  duplicateSamples?: unknown[]
  hasPrimaryKey?: boolean
  uniqueIndexNames?: string[]
  readyForPrimaryKey?: boolean
}

type PreflightResult = Record<'import_jobs' | 'settings', PreflightTableResult>

function parseArgs(argv = process.argv.slice(2)): PreflightArgs {
  const args = {
    output: DEFAULT_OUTPUT,
    failOnBlocker: false,
    container: process.env.BUSINESS_OS_POSTGRES_CONTAINER || 'business-os-postgres-1',
    user: process.env.POSTGRES_USER || 'business_os',
    database: process.env.POSTGRES_DB || 'business_os',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--output') args.output = argv[++index] || args.output
    else if (value === '--fail-on-blocker') args.failOnBlocker = true
    else if (value === '--container') args.container = argv[++index] || args.container
    else if (value === '--user') args.user = argv[++index] || args.user
    else if (value === '--database') args.database = argv[++index] || args.database
    else throw new Error(`Unknown argument: ${value}`)
  }

  args.output = assertInsideWorkspace(path.resolve(ROOT_DIR, args.output))
  return args
}

function assertInsideWorkspace(target: string): string {
  const relative = path.relative(ROOT_DIR, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Refusing output outside workspace: ${target}`)
  return target
}

function runPsql(args: PreflightArgs, sql: string): PreflightResult {
  const result = spawnSync('docker', [
    'exec', '-i', args.container, 'psql', '-U', args.user, '-d', args.database,
    '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 })
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `psql exited with ${result.status}`).trim())
  const line = String(result.stdout || '').split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry.startsWith('{'))
  if (!line) throw new Error(`Primary-key preflight query did not return JSON. Output: ${result.stdout}`)
  return JSON.parse(line) as PreflightResult
}

function buildPreflightSql(): string {
  return `
WITH
  import_jobs_duplicate_keys AS (
    SELECT id, COUNT(*)::integer AS count
    FROM import_jobs
    WHERE id IS NOT NULL
    GROUP BY id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, id
    LIMIT 10
  ),
  settings_duplicate_keys AS (
    SELECT key, COUNT(*)::integer AS count
    FROM settings
    WHERE key IS NOT NULL
    GROUP BY key
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, key
    LIMIT 10
  ),
  table_metrics AS (
    SELECT
      'import_jobs'::text AS table_name,
      COUNT(*)::integer AS row_count,
      COUNT(*) FILTER (WHERE id IS NULL)::integer AS null_keys
    FROM import_jobs
    UNION ALL
    SELECT
      'settings'::text AS table_name,
      COUNT(*)::integer AS row_count,
      COUNT(*) FILTER (WHERE key IS NULL)::integer AS null_keys
    FROM settings
  ),
  duplicate_counts AS (
    SELECT 'import_jobs'::text AS table_name, COUNT(*)::integer AS duplicate_key_groups
    FROM (
      SELECT id
      FROM import_jobs
      WHERE id IS NOT NULL
      GROUP BY id
      HAVING COUNT(*) > 1
    ) groups
    UNION ALL
    SELECT 'settings'::text AS table_name, COUNT(*)::integer AS duplicate_key_groups
    FROM (
      SELECT key
      FROM settings
      WHERE key IS NOT NULL
      GROUP BY key
      HAVING COUNT(*) > 1
    ) groups
  ),
  primary_keys AS (
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
      AND kcu.table_name = tc.table_name
    WHERE tc.table_schema = 'public'
      AND tc.constraint_type = 'PRIMARY KEY'
      AND tc.table_name IN ('import_jobs', 'settings')
  ),
  unique_indexes AS (
    SELECT
      table_class.relname AS table_name,
      json_agg(index_class.relname ORDER BY index_class.relname) AS names
    FROM pg_index index_meta
    JOIN pg_class table_class ON table_class.oid = index_meta.indrelid
    JOIN pg_namespace namespace ON namespace.oid = table_class.relnamespace
    JOIN pg_class index_class ON index_class.oid = index_meta.indexrelid
    WHERE namespace.nspname = 'public'
      AND table_class.relname IN ('import_jobs', 'settings')
      AND index_meta.indisunique
    GROUP BY table_class.relname
  )
SELECT json_build_object(
  'import_jobs', json_build_object(
    'targetColumn', 'id',
    'rowCount', (SELECT row_count FROM table_metrics WHERE table_name = 'import_jobs'),
    'nullKeys', (SELECT null_keys FROM table_metrics WHERE table_name = 'import_jobs'),
    'duplicateKeyGroups', (SELECT duplicate_key_groups FROM duplicate_counts WHERE table_name = 'import_jobs'),
    'duplicateSamples', COALESCE((SELECT json_agg(row_to_json(import_jobs_duplicate_keys)) FROM import_jobs_duplicate_keys), '[]'::json),
    'hasPrimaryKey', EXISTS (SELECT 1 FROM primary_keys WHERE table_name = 'import_jobs' AND column_name = 'id'),
    'uniqueIndexNames', COALESCE((SELECT names FROM unique_indexes WHERE table_name = 'import_jobs'), '[]'::json),
    'readyForPrimaryKey', (
      (SELECT null_keys FROM table_metrics WHERE table_name = 'import_jobs') = 0
      AND (SELECT duplicate_key_groups FROM duplicate_counts WHERE table_name = 'import_jobs') = 0
    )
  ),
  'settings', json_build_object(
    'targetColumn', 'key',
    'rowCount', (SELECT row_count FROM table_metrics WHERE table_name = 'settings'),
    'nullKeys', (SELECT null_keys FROM table_metrics WHERE table_name = 'settings'),
    'duplicateKeyGroups', (SELECT duplicate_key_groups FROM duplicate_counts WHERE table_name = 'settings'),
    'duplicateSamples', COALESCE((SELECT json_agg(row_to_json(settings_duplicate_keys)) FROM settings_duplicate_keys), '[]'::json),
    'hasPrimaryKey', EXISTS (SELECT 1 FROM primary_keys WHERE table_name = 'settings' AND column_name = 'key'),
    'uniqueIndexNames', COALESCE((SELECT names FROM unique_indexes WHERE table_name = 'settings'), '[]'::json),
    'readyForPrimaryKey', (
      (SELECT null_keys FROM table_metrics WHERE table_name = 'settings') = 0
      AND (SELECT duplicate_key_groups FROM duplicate_counts WHERE table_name = 'settings') = 0
    )
  )
)::text;
`
}

function summarize(result: PreflightResult): { ok: boolean, blockers: string[], readyTables: string[] } {
  const tables = ['import_jobs', 'settings'] as const
  const blockers = tables.flatMap((table) => {
    const row = result[table] || {}
    return [
      Number(row.nullKeys || 0) > 0 ? `${table}.${row.targetColumn} has ${row.nullKeys} null key(s)` : null,
      Number(row.duplicateKeyGroups || 0) > 0 ? `${table}.${row.targetColumn} has ${row.duplicateKeyGroups} duplicate key group(s)` : null,
    ].filter(Boolean)
  })

  return {
    ok: blockers.length === 0,
    blockers,
    readyTables: tables.filter((table) => result[table]?.readyForPrimaryKey),
  }
}

try {
  const args = parseArgs()
  const result = runPsql(args, buildPreflightSql())
  const report = {
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    database: { container: args.container, user: args.user, database: args.database },
    summary: summarize(result),
    tables: result,
    recommendedNextStep: 'Create a backup and rollback SQL before applying primary-key DDL.',
  }

  fs.mkdirSync(path.dirname(args.output), { recursive: true })
  fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))

  if (args.failOnBlocker && !report.summary.ok) process.exitCode = 2
} catch (error) {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
}
