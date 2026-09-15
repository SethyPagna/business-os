// Index-versus-query cross-reference (p6/efficiency-3 step 5).
//
// Loads every migration into an in-memory better-sqlite3 database (same
// harness as the other native/pure tests -- scripts/harness/load_migrations.cjs),
// then runs EXPLAIN QUERY PLAN against a curated set of the hot read-path
// queries from the routes/lib files this wave touched (and a few sibling
// list/summary endpoints on the same large tables), reporting any SCAN TABLE
// against a table on the "large" allowlist below as a missing-index finding.
//
// The query text for each entry is a literal, hand-verified copy of the
// production SQL (source file:line cited on each entry) -- NOT a live
// require of the TypeScript route/lib modules, which pull in Worker-only
// bindings (D1Database, R2Bucket, etc.) that do not exist in a plain Node
// process. This is the same "copy the real SQL as a constant, run it
// against the real migrated schema" idiom the rest of this suite already
// uses (see test-sales-analytics-daterange-pure.cjs's NEW_RANGE/OLD_BT,
// test-compat-dashboard-daterange-pure.cjs's NEW_RANGE/NEW_TODAY). A small
// pure helper library (localDateAtOrAfter/localDateAtOrBefore's SQL shape,
// customerIsProfileSql, etc.) is likewise mirrored inline with a comment
// naming the real source function, since those are pure one-line string
// builders with no D1 dependency of their own.
//
// Tables NOT on the large-table allowlist (settings, branches, categories,
// suppliers, users, file_assets, ...) are small reference tables (dozens to
// low hundreds of rows in production) where a full scan is not a real
// concern; a SCAN TABLE against one of those is not reported.
//
// Run (from cloudflare/): node scripts/index-query-crossref.cjs
// Programmatic use (for the pure test): const { runCrossref } = require('./index-query-crossref.cjs')

const path = require('node:path')
const Database = require('better-sqlite3')
const { loadAll } = require('./harness/load_migrations.cjs')

// Tables large enough in production that a full SCAN TABLE in a hot read
// path is a real cost, per the owner's task list.
const LARGE_TABLES = new Set([
  'products', 'sale_items', 'sales', 'inventory_movements',
  'product_batches', 'branch_stock', 'branch_batch_stock', 'customers',
])

/**
 * Hot query entries. Each `sql` is EXPLAIN QUERY PLAN-ready: every named
 * parameter (@foo) is bound to NULL for planning (SQLite's planner treats
 * bound values as opaque during planning, so NULL is sufficient -- it never
 * needs to evaluate the predicate, only decide which index/scan strategy
 * satisfies it).
 */
function buildHotQueries() {
  // ---- mirrored pure SQL fragments (source-cited, not required live) ----
  // lib/businessDateWindow.ts localDateAtOrAfter/localDateAtOrBefore -- the
  // exact shape test-compat-dashboard-daterange-pure.cjs's NEW_RANGE already
  // pins as index-using.
  const localDateRange = (col, startParam = '@startDate', endParam = '@endDate') =>
    `date(${col}, '+7 hours') >= ${startParam} AND ${col} >= date(${startParam}, '-1 day')` +
    ` AND date(${col}, '+7 hours') <= ${endParam} AND ${col} < date(${endParam}, '+1 day')`
  // lib/anonymousCustomer.ts customerIsProfileSql()
  const customerIsProfileSql = () => `NOT (COALESCE(is_anonymous, 0) = 1)`

  return [
    // -- routes/inventory.ts GET /movements (this wave's step 1) --
    {
      label: 'inventory.ts GET /movements (page SELECT)',
      source: 'src/routes/inventory.ts GET /movements',
      sql: `
        SELECT id FROM inventory_movements
        WHERE branch_id = @branchId AND product_id = @productId
        ORDER BY created_at DESC, id DESC
        LIMIT @pageSize OFFSET @offset
      `,
    },
    {
      label: 'inventory.ts GET /movements (COUNT)',
      source: 'src/routes/inventory.ts GET /movements',
      sql: `SELECT COUNT(*) AS count FROM inventory_movements WHERE branch_id = @branchId`,
    },
    // -- routes/inventory.ts searchProductsPayload / familyPagination.ts --
    {
      label: 'inventory.ts /products/search (active products base filter)',
      source: 'src/routes/inventory.ts appendInventoryProductFilters + familyPagination.ts',
      sql: `SELECT p.id FROM products p WHERE p.is_active = 1 ORDER BY lower(p.name) ASC`,
    },
    {
      label: 'inventory.ts GET /summary (branch-scoped branch_stock join)',
      source: 'src/routes/inventory.ts GET /summary',
      sql: `
        SELECT p.id, bs.quantity
        FROM products p
        LEFT JOIN branch_stock bs ON bs.product_id = p.id AND bs.branch_id = @branchId
        WHERE p.is_active = 1
      `,
    },
    // -- routes/products.ts GET /stock-in-sessions / /stock-in-session-lines
    //    (lib/stockInSessionsQuery.ts, this wave's step 2) --
    {
      label: 'stockInSessionsQuery.ts sessionLineRowsSql (received-line half)',
      source: 'src/lib/stockInSessionsQuery.ts sessionLineRowsSql, via GET /stock-in-sessions and /stock-in-session-lines',
      sql: `
        SELECT m.id, m.product_id, m.branch_id, m.reference_id, m.created_at, b.supplier_id
        FROM inventory_movements m
        JOIN product_batches b ON b.id = m.batch_id
        LEFT JOIN products p ON p.id = m.product_id
        WHERE m.movement_type IN ('add', 'stock_in') AND m.reference_id = @referenceId
      `,
    },
    {
      label: 'stockInSessionsQuery.ts sessionLineRowsSql (zero-quantity half)',
      source: 'src/lib/stockInSessionsQuery.ts sessionLineRowsSql, via GET /stock-in-sessions and /stock-in-session-lines',
      sql: `
        SELECT sm.line_id, sm.product_id, sm.branch_id, o.rowid
        FROM stock_session_members sm
        JOIN stock_session_operations o ON o.id = sm.operation_id
        LEFT JOIN products p ON p.id = sm.product_id
        WHERE sm.movement_id IS NULL AND COALESCE(sm.quantity, 0) = 0 AND o.rowid = @referenceId
      `,
    },
    {
      label: 'products.ts GET /stock-in-session-lines (revert-id lookup, per chunk)',
      source: 'src/routes/products.ts GET /stock-in-session-lines',
      sql: `SELECT reference_id FROM inventory_movements WHERE reference_id IN (@revert0, @revert1)`,
    },
    {
      label: 'products.ts GET /stock-in-session-lines (batch receipt-count lookup, per chunk)',
      source: 'src/routes/products.ts GET /stock-in-session-lines',
      sql: `
        SELECT m.batch_id, COUNT(*) AS n
        FROM inventory_movements m
        JOIN product_batches b ON b.id = m.batch_id
        WHERE m.movement_type IN ('add', 'stock_in') AND m.batch_id IN (@batch0, @batch1)
        GROUP BY m.batch_id
      `,
    },
    // -- lib/stockSession.ts commitStockSession (this wave's step 2) --
    {
      label: 'stockSession.ts commitStockSession (branch_stock lookup)',
      source: 'src/lib/stockSession.ts commitStockSession',
      sql: `SELECT * FROM branch_stock WHERE product_id IN (@p0, @p1) AND branch_id IN (@b0, @b1)`,
    },
    {
      label: 'stockSession.ts commitStockSession (branch_batch_stock lookup)',
      source: 'src/lib/stockSession.ts commitStockSession',
      sql: `SELECT * FROM branch_batch_stock WHERE batch_id IN (@bt0, @bt1) AND branch_id IN (@b0, @b1)`,
    },
    // -- routes/compat.ts dashboardSummary / dashboardAnalytics (this wave's step 3) --
    {
      label: 'compat.ts dashboardSummary (merged today/all sales totals)',
      source: 'src/routes/compat.ts dashboardSummary',
      sql: `
        SELECT COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS total_usd
        FROM sales
        WHERE ${localDateRange('created_at')} AND COALESCE(sale_status, 'completed') <> 'cancelled'
      `,
    },
    {
      label: 'compat.ts dashboardAnalytics topProducts (fixed id-only grouping)',
      source: 'src/routes/compat.ts dashboardAnalytics topProducts/topProductsQty',
      sql: `
        SELECT si.product_id, MAX(p.name) AS product_name, SUM(si.quantity) AS qty_sold
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        LEFT JOIN products p ON p.id = si.product_id
        WHERE ${localDateRange('s.created_at')}
        GROUP BY COALESCE(si.product_id, 0), CASE WHEN si.product_id IS NULL THEN lower(trim(COALESCE(si.product_name, ''))) ELSE '' END
        ORDER BY qty_sold DESC
        LIMIT 20
      `,
    },
    {
      label: 'compat.ts dashboardAnalytics byBranch',
      source: 'src/routes/compat.ts dashboardAnalytics byBranch',
      sql: `
        SELECT s.branch_id, COUNT(*) AS tx_count
        FROM sales s
        WHERE ${localDateRange('s.created_at')}
        GROUP BY s.branch_id
      `,
    },
    // -- routes/sales.ts export product breakdown (this wave's step 3) --
    {
      label: 'sales.ts export sale_product_lines (per-sale line aggregation)',
      source: 'src/routes/sales.ts GET /export sale_product_lines CTE',
      sql: `
        SELECT si.sale_id, si.product_id, SUM(si.quantity) AS qty_sold, SUM(si.total_usd) AS line_value_usd
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE ${localDateRange('s.created_at')}
        GROUP BY si.sale_id, si.product_id, si.product_name
      `,
    },
    {
      // Mirrors the REAL two-CTE chain (sale_product_lines -> product_totals),
      // not a flattened approximation: sale_product_lines is already scoped
      // by the sales join's date filter before product_totals aggregates it,
      // so this must NOT be simplified to an unscoped subquery over all of
      // sale_items (an earlier draft of this mirror did that and produced a
      // false SCAN finding that does not exist in the real query).
      label: 'sales.ts export product_totals (fixed id-only grouping)',
      source: 'src/routes/sales.ts GET /export sale_product_lines + product_totals CTEs',
      sql: `
        WITH sale_product_lines AS (
          SELECT si.sale_id, si.product_id, si.product_name, SUM(si.quantity) AS qty_sold, SUM(si.total_usd) AS line_value_usd
          FROM sale_items si
          JOIN sales s ON s.id = si.sale_id
          WHERE ${localDateRange('s.created_at')}
          GROUP BY si.sale_id, si.product_id, si.product_name
        )
        SELECT pl.product_id, COALESCE(MAX(p.name), MAX(pl.product_name)) AS product_name, SUM(pl.qty_sold) AS qty_sold
        FROM sales s
        JOIN sale_product_lines pl ON pl.sale_id = s.id
        LEFT JOIN products p ON p.id = pl.product_id
        WHERE ${localDateRange('s.created_at')}
        GROUP BY COALESCE(pl.product_id, 0), CASE WHEN pl.product_id IS NULL THEN lower(trim(COALESCE(pl.product_name, ''))) ELSE '' END
      `,
    },
    // -- routes/contacts.ts GET /customers/membership/:membershipNumber --
    {
      label: 'contacts.ts GET /customers/membership/:membershipNumber',
      source: 'src/routes/contacts.ts GET /customers/membership/:membershipNumber',
      sql: `
        SELECT id, name, membership_number FROM customers
          WHERE lower(trim(membership_number)) = lower(@number)
            AND ${customerIsProfileSql()}
          LIMIT 2
      `,
    },
  ]
}

/**
 * Runs EXPLAIN QUERY PLAN for every hot query against the fully-migrated
 * schema and classifies each as ok / finding (unindexed SCAN on a large
 * table) / skipped-small-table-scan.
 */
function runCrossref() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = MEMORY')
  for (const sql of loadAll()) db.exec(sql)

  const results = buildHotQueries().map((entry) => {
    const names = [...new Set((entry.sql.match(/@\w+/g) || []).map((s) => s.slice(1)))]
    const params = {}
    for (const n of names) params[n] = null
    let plan
    let error = null
    try {
      plan = db.prepare(`EXPLAIN QUERY PLAN ${entry.sql}`).all(params)
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      plan = []
    }
    const scanLines = plan.filter((row) => /^SCAN /.test(String(row.detail || '')))
    const findings = scanLines.filter((row) => {
      const match = /^SCAN (\S+)/.exec(String(row.detail || ''))
      const table = match ? match[1].replace(/^"|"$/g, '') : ''
      return LARGE_TABLES.has(table)
    })
    return {
      label: entry.label,
      source: entry.source,
      error,
      planDetail: plan.map((row) => String(row.detail || '')),
      findings: findings.map((row) => String(row.detail || '')),
      ok: !error && findings.length === 0,
    }
  })

  db.close()
  return results
}

function main() {
  const results = runCrossref()
  let failCount = 0
  for (const r of results) {
    if (r.error) {
      failCount += 1
      console.log(`ERROR ${r.label} (${r.source})`)
      console.log(`  ${r.error}`)
      continue
    }
    if (r.ok) {
      console.log(`OK    ${r.label}`)
    } else {
      failCount += 1
      console.log(`FOUND ${r.label} (${r.source})`)
      for (const line of r.findings) console.log(`  ${line}`)
    }
  }
  console.log(`\n${results.length - failCount}/${results.length} hot queries have no full scan on a large table`)
  if (failCount > 0) process.exitCode = 1
}

if (require.main === module) main()

module.exports = { runCrossref, LARGE_TABLES }
