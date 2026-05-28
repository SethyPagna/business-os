/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT_DIR = path.resolve(__dirname, '../../../..')

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    apply: false,
    allQa: false,
    failOnMatch: false,
    prefix: '',
    output: '',
    container: process.env.BUSINESS_OS_POSTGRES_CONTAINER || 'business-os-postgres-1',
    user: process.env.POSTGRES_USER || 'business_os',
    database: process.env.POSTGRES_DB || 'business_os',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--apply') args.apply = true
    else if (value === '--dry-run') args.apply = false
    else if (value === '--fail-on-match') args.failOnMatch = true
    else if (value === '--all-qa') args.allQa = true
    else if (value === '--prefix') args.prefix = argv[++index] || ''
    else if (value === '--output') args.output = argv[++index] || ''
    else if (value === '--container') args.container = argv[++index] || args.container
    else if (value === '--user') args.user = argv[++index] || args.user
    else if (value === '--database') args.database = argv[++index] || args.database
    else throw new Error(`Unknown argument: ${value}`)
  }
  args.prefix = String(args.prefix || '').trim()
  if (!args.allQa && !args.prefix) throw new Error('Refusing to scan without --all-qa or --prefix <test prefix>.')
  if (args.output) args.output = assertInsideWorkspace(path.resolve(ROOT_DIR, args.output))
  return args
}

function assertInsideWorkspace(target) {
  const relative = path.relative(ROOT_DIR, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`Refusing output outside workspace: ${target}`)
  return target
}

function sqlString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`
}

function likeEscape(value) {
  return String(value || '').replace(/[\\%_]/g, (match) => `\\${match}`)
}

function productSeedWhere(args) {
  if (args.allQa) {
    return [
      "p.name ILIKE 'QA Audit %'",
      "p.name ILIKE 'QA Smoke %'",
      "p.name ILIKE 'QA Deep Audit %'",
      "p.name ILIKE 'QA Action History %'",
      "p.category = 'QA Audit'",
      "p.brand = 'QA Audit'",
      "p.barcode ILIKE 'QA%'",
    ].join(' OR ')
  }
  const prefix = `${likeEscape(args.prefix)}%`
  return [
    `p.name ILIKE ${sqlString(prefix)} ESCAPE '\\'`,
    `p.category = ${sqlString(args.prefix)}`,
    `p.brand = ${sqlString(args.prefix)}`,
  ].join(' OR ')
}

function textQaWhere(column, args) {
  if (args.allQa) {
    return [
      `${column} ILIKE '%QA Audit%'`,
      `${column} ILIKE '%QA Smoke%'`,
      `${column} ILIKE '%QA Deep Audit%'`,
      `${column} ILIKE '%QA Action History%'`,
    ].join(' OR ')
  }
  return `${column} ILIKE ${sqlString(`%${likeEscape(args.prefix)}%`)} ESCAPE '\\'`
}

function lookupNameWhere(column, args) {
  if (args.allQa) {
    return [
      `${column} = 'QA Audit'`,
      `${column} ILIKE 'QA Smoke %'`,
      `${column} ILIKE 'QA Deep Audit %'`,
      `${column} ILIKE 'QA Action History %'`,
    ].join(' OR ')
  }
  return `${column} ILIKE ${sqlString(`${likeEscape(args.prefix)}%`)} ESCAPE '\\'`
}

function buildTempTablesSql(args) {
  const textMatch = (column) => textQaWhere(column, args)
  const lookupNameMatch = (column) => lookupNameWhere(column, args)
  const auditImportJobWhere = args.allQa
    ? [
      "f.original_name ILIKE '%business-os-full-audit%'",
      "f.stored_path ILIKE '%business-os-full-audit%'",
      "f.original_name ILIKE '%business-os-live-smoke%'",
      "f.stored_path ILIKE '%business-os-live-smoke%'",
      "ij.summary_json ILIKE '%QA Audit%'",
      "ij.policy_json ILIKE '%QA Audit%'",
      "ij.summary_json ILIKE '%QA Smoke%'",
      "ij.policy_json ILIKE '%QA Smoke%'",
      "ij.summary_json ILIKE '%QA Deep Audit%'",
      "ij.policy_json ILIKE '%QA Deep Audit%'",
      "ij.summary_json ILIKE '%QA Action History%'",
      "ij.policy_json ILIKE '%QA Action History%'",
    ].join(' OR ')
    : [
      `f.original_name ILIKE ${sqlString(`%${likeEscape(args.prefix)}%`)} ESCAPE '\\'`,
      `f.stored_path ILIKE ${sqlString(`%${likeEscape(args.prefix)}%`)} ESCAPE '\\'`,
      `ij.summary_json ILIKE ${sqlString(`%${likeEscape(args.prefix)}%`)} ESCAPE '\\'`,
      `ij.policy_json ILIKE ${sqlString(`%${likeEscape(args.prefix)}%`)} ESCAPE '\\'`,
    ].join(' OR ')

  return `
CREATE TEMP TABLE _bos_test_products AS
WITH seed AS (
  SELECT DISTINCT p.id
  FROM products p
  WHERE ${productSeedWhere(args)}
),
expanded AS (
  SELECT id FROM seed
  UNION
  SELECT child.id FROM products child JOIN seed ON child.parent_id = seed.id
  UNION
  SELECT parent.id FROM products child JOIN products parent ON parent.id = child.parent_id JOIN seed ON seed.id = child.id
)
SELECT DISTINCT id FROM expanded;

CREATE TEMP TABLE _bos_test_batches AS
SELECT DISTINCT pb.id FROM product_batches pb WHERE pb.variant_product_id IN (SELECT id FROM _bos_test_products);

CREATE TEMP TABLE _bos_test_sale_items AS
SELECT DISTINCT si.id FROM sale_items si
WHERE si.product_id IN (SELECT id FROM _bos_test_products) OR ${textMatch('si.product_name')};

CREATE TEMP TABLE _bos_test_sales AS
SELECT DISTINCT s.id FROM sales s
LEFT JOIN sale_items si ON si.sale_id = s.id
WHERE si.id IN (SELECT id FROM _bos_test_sale_items) OR ${textMatch('s.receipt_number')};

INSERT INTO _bos_test_sale_items
SELECT DISTINCT si.id FROM sale_items si
WHERE si.sale_id IN (SELECT id FROM _bos_test_sales) AND si.id NOT IN (SELECT id FROM _bos_test_sale_items);

CREATE TEMP TABLE _bos_test_return_items AS
SELECT DISTINCT ri.id FROM return_items ri
WHERE ri.product_id IN (SELECT id FROM _bos_test_products)
   OR ${textMatch('ri.product_name')}
   OR ri.sale_item_id IN (SELECT id FROM _bos_test_sale_items);

CREATE TEMP TABLE _bos_test_returns AS
SELECT DISTINCT r.id FROM returns r
LEFT JOIN return_items ri ON ri.return_id = r.id
WHERE r.sale_id IN (SELECT id FROM _bos_test_sales)
   OR ri.id IN (SELECT id FROM _bos_test_return_items)
   OR ${textMatch('r.reason')};

INSERT INTO _bos_test_return_items
SELECT DISTINCT ri.id FROM return_items ri
WHERE ri.return_id IN (SELECT id FROM _bos_test_returns) AND ri.id NOT IN (SELECT id FROM _bos_test_return_items);

CREATE TEMP TABLE _bos_test_movements AS
SELECT DISTINCT im.id FROM inventory_movements im
WHERE im.product_id IN (SELECT id FROM _bos_test_products) OR ${textMatch('im.reason')};

CREATE TEMP TABLE _bos_test_transfers AS
SELECT DISTINCT st.id FROM stock_transfers st
WHERE st.product_id IN (SELECT id FROM _bos_test_products)
   OR ${textMatch('st.notes')}
   OR ${textMatch('st.product_name')};

CREATE TEMP TABLE _bos_test_row_moves AS
SELECT DISTINCT srm.id FROM stock_row_moves srm
WHERE srm.source_product_id IN (SELECT id FROM _bos_test_products)
   OR srm.destination_product_id IN (SELECT id FROM _bos_test_products)
   OR ${textMatch('srm.reason')}
   OR ${textMatch('srm.note')};

CREATE TEMP TABLE _bos_test_import_jobs AS
SELECT DISTINCT ij.id FROM import_jobs ij
LEFT JOIN import_job_files f ON f.job_id = ij.id
WHERE ${auditImportJobWhere};

CREATE TEMP TABLE _bos_test_action_history AS
SELECT DISTINCT ah.id FROM action_history ah
WHERE ${textMatch('ah.label')} OR ${textMatch('ah.undo_payload')} OR ${textMatch('ah.redo_payload')};

CREATE TEMP TABLE _bos_test_audit_logs AS
SELECT DISTINCT al.id FROM audit_logs al
WHERE ${textMatch('al.details')} OR ${textMatch('al.old_value')} OR ${textMatch('al.new_value')};

CREATE TEMP TABLE _bos_test_categories AS
SELECT DISTINCT c.name FROM categories c
WHERE ${lookupNameMatch('c.name')}
  AND NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.category = c.name AND p.id NOT IN (SELECT id FROM _bos_test_products)
  );

CREATE TEMP TABLE _bos_test_units AS
SELECT DISTINCT u.name FROM units u
WHERE ${lookupNameMatch('u.name')}
  AND NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.unit = u.name AND p.id NOT IN (SELECT id FROM _bos_test_products)
  );
`
}

function buildCountsSelectSql(applied) {
  return `
SELECT json_build_object(
  'applied', ${applied ? 'true' : 'false'},
  'matched', json_build_object(
    'products', (SELECT COUNT(*) FROM _bos_test_products),
    'product_batches', (SELECT COUNT(*) FROM _bos_test_batches),
    'sales', (SELECT COUNT(*) FROM _bos_test_sales),
    'sale_items', (SELECT COUNT(*) FROM _bos_test_sale_items),
    'returns', (SELECT COUNT(*) FROM _bos_test_returns),
    'return_items', (SELECT COUNT(*) FROM _bos_test_return_items),
    'inventory_movements', (SELECT COUNT(*) FROM _bos_test_movements),
    'stock_transfers', (SELECT COUNT(*) FROM _bos_test_transfers),
    'stock_row_moves', (SELECT COUNT(*) FROM _bos_test_row_moves),
    'import_jobs', (SELECT COUNT(*) FROM _bos_test_import_jobs),
    'action_history', (SELECT COUNT(*) FROM _bos_test_action_history),
    'audit_logs', (SELECT COUNT(*) FROM _bos_test_audit_logs),
    'categories', (SELECT COUNT(*) FROM _bos_test_categories),
    'units', (SELECT COUNT(*) FROM _bos_test_units)
  )
)::text AS cleanup_report;
`
}

function buildDeleteSql() {
  return `
WITH
  d_return_alloc AS (DELETE FROM return_item_batch_allocations WHERE return_item_id IN (SELECT id FROM _bos_test_return_items) RETURNING 1),
  d_sale_alloc AS (DELETE FROM sale_item_batch_allocations WHERE sale_item_id IN (SELECT id FROM _bos_test_sale_items) RETURNING 1),
  d_return_items AS (DELETE FROM return_items WHERE id IN (SELECT id FROM _bos_test_return_items) RETURNING 1),
  d_returns AS (DELETE FROM returns WHERE id IN (SELECT id FROM _bos_test_returns) RETURNING 1),
  d_sale_items AS (DELETE FROM sale_items WHERE id IN (SELECT id FROM _bos_test_sale_items) RETURNING 1),
  d_sales AS (DELETE FROM sales WHERE id IN (SELECT id FROM _bos_test_sales) RETURNING 1),
  d_movements AS (DELETE FROM inventory_movements WHERE id IN (SELECT id FROM _bos_test_movements) RETURNING 1),
  d_transfers AS (DELETE FROM stock_transfers WHERE id IN (SELECT id FROM _bos_test_transfers) RETURNING 1),
  d_row_moves AS (DELETE FROM stock_row_moves WHERE id IN (SELECT id FROM _bos_test_row_moves) RETURNING 1),
  d_branch_batch_stock AS (DELETE FROM branch_batch_stock WHERE batch_id IN (SELECT id FROM _bos_test_batches) RETURNING 1),
  d_product_batches AS (DELETE FROM product_batches WHERE id IN (SELECT id FROM _bos_test_batches) RETURNING 1),
  d_branch_stock AS (DELETE FROM branch_stock WHERE product_id IN (SELECT id FROM _bos_test_products) RETURNING 1),
  d_product_images AS (DELETE FROM product_images WHERE product_id IN (SELECT id FROM _bos_test_products) RETURNING 1),
  d_rfid_items AS (DELETE FROM rfid_session_items WHERE product_id IN (SELECT id FROM _bos_test_products) RETURNING 1),
  d_rfid_events AS (DELETE FROM rfid_events WHERE product_id IN (SELECT id FROM _bos_test_products) RETURNING 1),
  d_rfid_tags AS (DELETE FROM rfid_tags WHERE product_id IN (SELECT id FROM _bos_test_products) RETURNING 1),
  d_products AS (DELETE FROM products WHERE id IN (SELECT id FROM _bos_test_products) RETURNING 1),
  d_import_files AS (DELETE FROM import_job_files WHERE job_id IN (SELECT id FROM _bos_test_import_jobs) RETURNING 1),
  d_import_batches AS (DELETE FROM import_job_batches WHERE job_id IN (SELECT id FROM _bos_test_import_jobs) RETURNING 1),
  d_import_errors AS (DELETE FROM import_job_errors WHERE job_id IN (SELECT id FROM _bos_test_import_jobs) RETURNING 1),
  d_import_jobs AS (DELETE FROM import_jobs WHERE id IN (SELECT id FROM _bos_test_import_jobs) RETURNING 1),
  d_action_history AS (DELETE FROM action_history WHERE id IN (SELECT id FROM _bos_test_action_history) RETURNING 1),
  d_audit_logs AS (DELETE FROM audit_logs WHERE id IN (SELECT id FROM _bos_test_audit_logs) RETURNING 1),
  d_categories AS (DELETE FROM categories c WHERE c.name IN (SELECT name FROM _bos_test_categories) RETURNING 1),
  d_units AS (DELETE FROM units u WHERE u.name IN (SELECT name FROM _bos_test_units) RETURNING 1)
SELECT json_build_object(
  'applied', true,
  'deleted', json_build_object(
    'return_item_batch_allocations', (SELECT COUNT(*) FROM d_return_alloc),
    'sale_item_batch_allocations', (SELECT COUNT(*) FROM d_sale_alloc),
    'return_items', (SELECT COUNT(*) FROM d_return_items),
    'returns', (SELECT COUNT(*) FROM d_returns),
    'sale_items', (SELECT COUNT(*) FROM d_sale_items),
    'sales', (SELECT COUNT(*) FROM d_sales),
    'inventory_movements', (SELECT COUNT(*) FROM d_movements),
    'stock_transfers', (SELECT COUNT(*) FROM d_transfers),
    'stock_row_moves', (SELECT COUNT(*) FROM d_row_moves),
    'branch_batch_stock', (SELECT COUNT(*) FROM d_branch_batch_stock),
    'product_batches', (SELECT COUNT(*) FROM d_product_batches),
    'branch_stock', (SELECT COUNT(*) FROM d_branch_stock),
    'product_images', (SELECT COUNT(*) FROM d_product_images),
    'rfid_session_items', (SELECT COUNT(*) FROM d_rfid_items),
    'rfid_events', (SELECT COUNT(*) FROM d_rfid_events),
    'rfid_tags', (SELECT COUNT(*) FROM d_rfid_tags),
    'products', (SELECT COUNT(*) FROM d_products),
    'import_job_files', (SELECT COUNT(*) FROM d_import_files),
    'import_job_batches', (SELECT COUNT(*) FROM d_import_batches),
    'import_job_errors', (SELECT COUNT(*) FROM d_import_errors),
    'import_jobs', (SELECT COUNT(*) FROM d_import_jobs),
    'action_history', (SELECT COUNT(*) FROM d_action_history),
    'audit_logs', (SELECT COUNT(*) FROM d_audit_logs),
    'categories', (SELECT COUNT(*) FROM d_categories),
    'units', (SELECT COUNT(*) FROM d_units)
  )
)::text AS cleanup_report;
`
}

function buildSql(args) {
  return ['BEGIN;', buildTempTablesSql(args), args.apply ? buildDeleteSql() : buildCountsSelectSql(false), args.apply ? 'COMMIT;' : 'ROLLBACK;'].join('\n')
}

function runPsql(args, sql) {
  const result = spawnSync('docker', [
    'exec', '-i', args.container, 'psql', '-U', args.user, '-d', args.database,
    '-v', 'ON_ERROR_STOP=1', '-t', '-A',
  ], { input: sql, encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 })
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `psql exited with ${result.status}`).trim())
  const lines = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const jsonLine = [...lines].reverse().find((line) => line.startsWith('{') && line.endsWith('}'))
  if (!jsonLine) throw new Error(`Cleanup query did not return JSON. Output: ${result.stdout}`)
  return JSON.parse(jsonLine)
}

function pathIsInside(parent, child) {
  const relative = path.relative(parent, child)
  return !!relative && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function measurePathBytes(target) {
  if (!fs.existsSync(target)) return 0
  const stat = fs.statSync(target)
  if (!stat.isDirectory()) return stat.size
  let total = 0
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    total += measurePathBytes(path.join(target, entry.name))
  }
  return total
}

function walkFiles(dir, visitor) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(fullPath, visitor)
    else if (entry.isFile()) visitor(fullPath)
  }
}

function fileMatchesGeneratedImport(filePath, args) {
  const basename = path.basename(filePath)
  if (args.allQa) return /business-os-full-audit|business-os-live-smoke/i.test(basename)
  return basename.toLowerCase().includes(String(args.prefix || '').toLowerCase())
}

function findGeneratedImportDirectories(args) {
  const organizationsRoot = path.join(ROOT_DIR, 'business-os-data', 'organizations')
  if (!fs.existsSync(organizationsRoot)) return []
  const dirs = new Map()
  for (const organization of fs.readdirSync(organizationsRoot, { withFileTypes: true })) {
    if (!organization.isDirectory()) continue
    const importsRoot = path.join(organizationsRoot, organization.name, 'imports')
    if (!fs.existsSync(importsRoot)) continue
    walkFiles(importsRoot, (filePath) => {
      if (!fileMatchesGeneratedImport(filePath, args)) return
      let current = path.dirname(filePath)
      while (pathIsInside(importsRoot, current) && !/^imp_/i.test(path.basename(current))) {
        current = path.dirname(current)
      }
      if (!pathIsInside(importsRoot, current) || !/^imp_/i.test(path.basename(current))) return
      const resolved = path.resolve(current)
      if (!pathIsInside(ROOT_DIR, resolved)) return
      dirs.set(resolved, {
        path: resolved,
        relativePath: path.relative(ROOT_DIR, resolved).replace(/\\/g, '/'),
      })
    })
  }
  return [...dirs.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
}

function cleanupAuditImportFiles(args) {
  const directories = findGeneratedImportDirectories(args).map((entry) => ({
    ...entry,
    bytes: measurePathBytes(entry.path),
  }))
  const report = {
    skipped: false,
    applied: args.apply,
    directories: directories.length,
    bytes: directories.reduce((sum, entry) => sum + entry.bytes, 0),
    removed: [],
  }
  if (!args.apply) {
    report.candidates = directories.map(({ relativePath, bytes }) => ({ relativePath, bytes }))
    return report
  }
  for (const entry of directories) {
    fs.rmSync(entry.path, { recursive: true, force: true })
    report.removed.push({ relativePath: entry.relativePath, bytes: entry.bytes })
  }
  return report
}

function countMatchedRows(report) {
  const rows = report?.result?.matched || report?.result?.deleted || {}
  const rowCount = Object.values(rows).reduce((sum, value) => sum + Number(value || 0), 0)
  const fileCount = Number(report?.files?.directories || 0)
  return { rowCount, fileCount, total: rowCount + fileCount }
}

try {
  const args = parseArgs()
  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    selector: args.allQa ? { allQa: true } : { prefix: args.prefix },
    database: { container: args.container, user: args.user, database: args.database },
    result: runPsql(args, buildSql(args)),
    files: cleanupAuditImportFiles(args),
  }
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true })
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`)
  }
  console.log(JSON.stringify(report, null, 2))
  const matched = countMatchedRows(report)
  if (args.failOnMatch && !args.apply && matched.total > 0) {
    console.error(`Refusing clean postcheck: ${matched.rowCount} database row(s) and ${matched.fileCount} generated import directorie(s) still match.`)
    process.exitCode = 2
  }
} catch (error) {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
}
