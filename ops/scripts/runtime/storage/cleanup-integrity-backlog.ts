/* eslint-disable no-console */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT_DIR = path.resolve(__dirname, '../../../..')

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    apply: false,
    output: '',
    container: process.env.BUSINESS_OS_POSTGRES_CONTAINER || 'business-os-postgres-1',
    user: process.env.POSTGRES_USER || 'business_os',
    database: process.env.POSTGRES_DB || 'business_os',
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--apply') args.apply = true
    else if (value === '--dry-run') args.apply = false
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

function generatedTextMatch(columns) {
  return columns
    .map((column) => `COALESCE(${column}, '') ILIKE '%QA Audit%' OR COALESCE(${column}, '') ILIKE '%QA Smoke%' OR COALESCE(${column}, '') ILIKE '%QA Deep Audit%' OR COALESCE(${column}, '') ILIKE '%Smoke %'`)
    .map((part) => `(${part})`)
    .join(' OR ')
}

function buildTempTablesSql() {
  const overReturnedMarker = generatedTextMatch(['ri.product_name', 'r.reason'])
  const batchMarker = generatedTextMatch(['pb.batch_key', 'pb.lot_code', 'pb.notes'])
  const returnMarker = generatedTextMatch(['ri.product_name', 'r.reason'])
  const movementMarker = generatedTextMatch(['im.product_name', 'im.reason', 'im.lot_code'])
  const transferMarker = generatedTextMatch(['st.product_name', 'st.notes'])

  return `
CREATE TEMP TABLE _bos_integrity_over_return_items AS
WITH sold AS (
  SELECT sale_id, product_id, SUM(quantity) AS qty_sold
  FROM sale_items
  GROUP BY sale_id, product_id
),
returned AS (
  SELECT r.sale_id, ri.product_id, SUM(ri.quantity) AS qty_returned
  FROM return_items ri
  JOIN returns r ON r.id = ri.return_id
  WHERE COALESCE(r.status, 'completed') != 'cancelled'
  GROUP BY r.sale_id, ri.product_id
),
over_returned AS (
  SELECT r.sale_id, r.product_id
  FROM returned r
  LEFT JOIN sold s ON s.sale_id = r.sale_id AND s.product_id = r.product_id
  WHERE r.qty_returned - COALESCE(s.qty_sold, 0) > 0.001
)
SELECT DISTINCT ri.id
FROM return_items ri
JOIN returns r ON r.id = ri.return_id
JOIN over_returned o ON o.sale_id = r.sale_id AND o.product_id = ri.product_id
WHERE ${overReturnedMarker};

CREATE TEMP TABLE _bos_integrity_orphan_batches AS
SELECT DISTINCT pb.id
FROM product_batches pb
LEFT JOIN products p ON p.id = pb.variant_product_id
WHERE pb.variant_product_id IS NOT NULL
  AND p.id IS NULL
  AND (
    ${batchMarker}
    OR (
      pb.variant_product_id > (SELECT COALESCE(MAX(id), 0) FROM products)
      AND NOT EXISTS (SELECT 1 FROM sale_item_batch_allocations siba WHERE siba.batch_id = pb.id)
      AND NOT EXISTS (SELECT 1 FROM return_item_batch_allocations riba WHERE riba.batch_id = pb.id)
    )
  );

CREATE TEMP TABLE _bos_integrity_branch_batch_stock AS
SELECT DISTINCT bbs.id
FROM branch_batch_stock bbs
LEFT JOIN branches b ON b.id = bbs.branch_id
LEFT JOIN product_batches pb ON pb.id = bbs.batch_id
WHERE bbs.branch_id IS NOT NULL
  AND b.id IS NULL
  AND (${batchMarker});

CREATE TEMP TABLE _bos_integrity_orphan_return_items AS
SELECT DISTINCT ri.id
FROM return_items ri
LEFT JOIN products p ON p.id = ri.product_id
LEFT JOIN returns r ON r.id = ri.return_id
WHERE ri.product_id IS NOT NULL
  AND p.id IS NULL
  AND (${returnMarker});

CREATE TEMP TABLE _bos_integrity_return_items AS
SELECT DISTINCT id FROM _bos_integrity_over_return_items
UNION
SELECT DISTINCT id FROM _bos_integrity_orphan_return_items;

CREATE TEMP TABLE _bos_integrity_empty_returns AS
SELECT DISTINCT r.id
FROM returns r
WHERE ${generatedTextMatch(['r.reason'])}
  AND EXISTS (SELECT 1 FROM _bos_integrity_return_items ri JOIN return_items live_ri ON live_ri.id = ri.id WHERE live_ri.return_id = r.id)
  AND NOT EXISTS (
    SELECT 1
    FROM return_items keep
    WHERE keep.return_id = r.id
      AND keep.id NOT IN (SELECT id FROM _bos_integrity_return_items)
  );

CREATE TEMP TABLE _bos_integrity_inventory_movements AS
SELECT DISTINCT im.id
FROM inventory_movements im
LEFT JOIN branches b ON b.id = im.branch_id
WHERE im.branch_id IS NOT NULL
  AND b.id IS NULL
  AND (${movementMarker});

CREATE TEMP TABLE _bos_integrity_stock_transfers AS
SELECT DISTINCT st.id
FROM stock_transfers st
LEFT JOIN products p ON p.id = st.product_id
WHERE st.product_id IS NOT NULL
  AND p.id IS NULL
  AND (${transferMarker});
`
}

function buildCountsSql(applied) {
  return `
SELECT json_build_object(
  'applied', ${applied ? 'true' : 'false'},
  'matched', json_build_object(
    'over_returned_return_items', (SELECT COUNT(*) FROM _bos_integrity_over_return_items),
    'orphan_product_batches', (SELECT COUNT(*) FROM _bos_integrity_orphan_batches),
    'orphan_branch_batch_stock', (SELECT COUNT(*) FROM _bos_integrity_branch_batch_stock),
    'orphan_return_items', (SELECT COUNT(*) FROM _bos_integrity_orphan_return_items),
    'return_items_total', (SELECT COUNT(*) FROM _bos_integrity_return_items),
    'empty_generated_returns', (SELECT COUNT(*) FROM _bos_integrity_empty_returns),
    'orphan_inventory_movements', (SELECT COUNT(*) FROM _bos_integrity_inventory_movements),
    'orphan_stock_transfers', (SELECT COUNT(*) FROM _bos_integrity_stock_transfers)
  )
)::text AS cleanup_report;
`
}

function buildDeleteSql() {
  return `
WITH
  d_return_alloc AS (DELETE FROM return_item_batch_allocations WHERE return_item_id IN (SELECT id FROM _bos_integrity_return_items) RETURNING 1),
  d_return_items AS (DELETE FROM return_items WHERE id IN (SELECT id FROM _bos_integrity_return_items) RETURNING 1),
  d_returns AS (DELETE FROM returns WHERE id IN (SELECT id FROM _bos_integrity_empty_returns) RETURNING 1),
  d_branch_batch_orphans AS (DELETE FROM branch_batch_stock WHERE id IN (SELECT id FROM _bos_integrity_branch_batch_stock) RETURNING 1),
  d_branch_batch_by_batch AS (DELETE FROM branch_batch_stock WHERE batch_id IN (SELECT id FROM _bos_integrity_orphan_batches) RETURNING 1),
  d_sale_alloc_by_batch AS (DELETE FROM sale_item_batch_allocations WHERE batch_id IN (SELECT id FROM _bos_integrity_orphan_batches) RETURNING 1),
  d_return_alloc_by_batch AS (DELETE FROM return_item_batch_allocations WHERE batch_id IN (SELECT id FROM _bos_integrity_orphan_batches) RETURNING 1),
  d_batches AS (DELETE FROM product_batches WHERE id IN (SELECT id FROM _bos_integrity_orphan_batches) RETURNING 1),
  d_movements AS (DELETE FROM inventory_movements WHERE id IN (SELECT id FROM _bos_integrity_inventory_movements) RETURNING 1),
  d_transfers AS (DELETE FROM stock_transfers WHERE id IN (SELECT id FROM _bos_integrity_stock_transfers) RETURNING 1)
SELECT json_build_object(
  'applied', true,
  'deleted', json_build_object(
    'return_item_batch_allocations', (SELECT COUNT(*) FROM d_return_alloc) + (SELECT COUNT(*) FROM d_return_alloc_by_batch),
    'return_items', (SELECT COUNT(*) FROM d_return_items),
    'returns', (SELECT COUNT(*) FROM d_returns),
    'branch_batch_stock', (SELECT COUNT(*) FROM d_branch_batch_orphans) + (SELECT COUNT(*) FROM d_branch_batch_by_batch),
    'sale_item_batch_allocations', (SELECT COUNT(*) FROM d_sale_alloc_by_batch),
    'product_batches', (SELECT COUNT(*) FROM d_batches),
    'inventory_movements', (SELECT COUNT(*) FROM d_movements),
    'stock_transfers', (SELECT COUNT(*) FROM d_transfers)
  )
)::text AS cleanup_report;
`
}

function buildSql(args) {
  return [
    'BEGIN;',
    buildTempTablesSql(),
    args.apply ? buildDeleteSql() : buildCountsSql(false),
    args.apply ? 'COMMIT;' : 'ROLLBACK;',
  ].join('\n')
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

try {
  const args = parseArgs()
  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? 'apply' : 'dry-run',
    scope: 'generated-like-integrity-backlog',
    database: { container: args.container, user: args.user, database: args.database },
    result: runPsql(args, buildSql(args)),
  }
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true })
    fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`)
  }
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error(error?.stack || error?.message || String(error))
  process.exitCode = 1
}
