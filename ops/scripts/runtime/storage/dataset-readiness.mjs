/* eslint-disable no-console */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..')

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    failIfEmpty: false,
    output: '',
    container: process.env.BUSINESS_OS_POSTGRES_CONTAINER || 'business-os-postgres-1',
    user: process.env.POSTGRES_USER || 'business_os',
    database: process.env.POSTGRES_DB || 'business_os',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--fail-if-empty') args.failIfEmpty = true
    else if (value === '--output') args.output = argv[++index] || ''
    else if (value === '--container') args.container = argv[++index] || args.container
    else if (value === '--user') args.user = argv[++index] || args.user
    else if (value === '--database') args.database = argv[++index] || args.database
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (args.output) args.output = assertInsideWorkspace(path.resolve(ROOT_DIR, args.output))
  return args
}

function assertInsideWorkspace(target) {
  const relative = path.relative(ROOT_DIR, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Refusing output outside workspace: ${target}`)
  return target
}

function runPsql(args, sql) {
  const result = spawnSync('docker', [
    'exec', '-i', args.container, 'psql', '-U', args.user, '-d', args.database,
    '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql,
  ], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 })
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `psql exited with ${result.status}`).trim())
  const line = String(result.stdout || '').split(/\r?\n/).map((entry) => entry.trim()).find((entry) => entry.startsWith('{'))
  if (!line) throw new Error(`Dataset readiness query did not return JSON. Output: ${result.stdout}`)
  return JSON.parse(line)
}

function buildCountsSql() {
  return `
SELECT json_build_object(
  'products', (SELECT COUNT(*)::integer FROM products),
  'product_batches', (SELECT COUNT(*)::integer FROM product_batches),
  'branch_stock', (SELECT COUNT(*)::integer FROM branch_stock),
  'sales', (SELECT COUNT(*)::integer FROM sales),
  'sale_items', (SELECT COUNT(*)::integer FROM sale_items),
  'returns', (SELECT COUNT(*)::integer FROM returns),
  'return_items', (SELECT COUNT(*)::integer FROM return_items),
  'inventory_movements', (SELECT COUNT(*)::integer FROM inventory_movements),
  'stock_transfers', (SELECT COUNT(*)::integer FROM stock_transfers),
  'action_history', (SELECT COUNT(*)::integer FROM action_history),
  'audit_logs', (SELECT COUNT(*)::integer FROM audit_logs)
)::text;
`
}

function summarizeDataset(counts) {
  const transactionalTables = [
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
  const loadedTables = transactionalTables.filter((name) => Number(counts[name] || 0) > 0)
  return {
    status: loadedTables.length ? 'loaded' : 'empty',
    loadedTables,
    counts,
    note: loadedTables.length
      ? 'Transactional business tables contain data.'
      : 'Transactional business tables are empty; restore or import verified business data before production use.',
  }
}

try {
  const args = parseArgs()
  const report = {
    generatedAt: new Date().toISOString(),
    database: { container: args.container, user: args.user, database: args.database },
    readiness: summarizeDataset(runPsql(args, buildCountsSql())),
  }
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true })
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`)
  }
  console.log(JSON.stringify(report, null, 2))
  if (args.failIfEmpty && report.readiness.status === 'empty') {
    console.error(report.readiness.note)
    process.exitCode = 2
  }
} catch (error) {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
}
