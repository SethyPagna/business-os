import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth } from '../lib/auth'
import type { Env } from '../index'
import { getSystemJob, listCloudflareBackups, listSystemJobs, storeSystemJob } from '../lib/backup'
import { buildDriveOauthStartUrl, completeDriveOauth, consumeDriveOauthState, disconnectDrive, driveSyncStatus, updateDrivePreferences } from '../lib/googleDrive'
import { enqueueDriveRestoreStageJob, enqueueDriveSyncJob } from '../lib/driveSyncQueue'
import { hasPermission, hasAnyPermission, isAdminControlUser, getPermissionTier } from '../lib/permissions'
import { audit } from '../lib/audit'
import { buildAuditLogFilters } from '../lib/auditLogQuery'
import { putObject, getObject, deleteObject } from '../lib/r2'
import { getGoogleLoginPublicConfig } from '../lib/googleOauth'
import { CUSTOMER_REFUND_JOIN, getSalesTotals, getSalesPeriodSeries, netSaleExpr, previousPeriodFilters, recognizedExpr } from '../lib/salesAnalytics'
import { getFamilyStockStats } from '../lib/familyStockStats'
import { businessToday, localDateAtOrAfter, localDateAtOrBefore, localDateRangeClause, localHourExpr, localTimeRangeClause } from '../lib/businessDateWindow'

const app = new Hono<{ Bindings: Env; Variables: { user: any } }>()

// Shared gate matching backend's requirePermission/requireAnyPermission for
// the system/backup/audit endpoints below -- previously these only checked
// `requireAuth` (any logged-in user), which let any authenticated account
// (e.g. a cashier role) view full audit logs, disconnect Google Drive, kick
// off backup jobs, etc. Ported to match legacy's actual permission map.
function denyUnless(c: any, ...perms: string[]) {
  const user = c.get('user')
  if (!user) return c.json({ error: 'Authentication required' }, 401)
  if (!hasAnyPermission(user, perms)) return c.json({ error: 'You do not have permission to perform this action' }, 403)
  return null
}

// NOTE: there is deliberately no `app.use('*', requireAuth)` here. That
// existed before and blanket-guarded every route in this file, including
// the ones below that are explicitly meant to be public (organizations
// bootstrap/search, auth capability probes, system bootstrap, etc.) -- it
// made them 401 unconditionally, not just around login/logout. Guard only
// the specific paths that actually need a session, matching what each
// handler further down actually does.
//
// These were written as `app.use('/dashboard*', ...)` -- a bare trailing
// `*`, which Hono does NOT treat as a wildcard. Verified directly against
// the bundled Hono: `/categories*` matches neither `/categories` nor
// `/categories/1`, so all thirteen of these guards were dead code matching
// nothing, and had been since they were written. Most of the paths below
// were protected anyway, by an accident of mount order (routes/lookups.ts,
// contacts.ts, system.ts, notifications.ts, importJobs.ts and friends are
// all mounted BEFORE this router in index.ts and carry their own gates) or
// by each handler's own denyUnless()/requireAuth argument -- but
// `/transfers` was neither, so `GET /api/transfers` returned live
// stock-transfer rows to a completely unauthenticated caller. Found by
// probing all 37 routes in this file with no session; it was the only one
// that answered 200.
//
// `/prefix/*` is the form Hono actually matches, and it covers the bare
// `/prefix` too (also verified). Kept as real guards rather than deleted:
// they are the defence-in-depth layer that should have caught /transfers
// on its own instead of relying on another router happening to be mounted
// first.
for (const prefix of [
  '/categories', '/units', '/dashboard', '/analytics', '/inventory',
  '/notifications', '/system', '/returns', '/customers', '/suppliers',
  '/delivery-contacts', '/import-jobs', '/transfers',
]) {
  app.use(`${prefix}/*`, requireAuth)
}

const WRITE_SKIP_KEYS = new Set([
  'id', 'expectedUpdatedAt', 'expected_updated_at', 'updatedAt', 'updated_at',
  'client_request_id', 'device_name', 'device_tz', 'client_time', 'currentPassword',
  'current_password', 'confirmPassword', 'confirm_password',
])

function isoNow() {
  return new Date().toISOString()
}

async function columnsFor(env: Env, table: string): Promise<Set<string>> {
  const rows = await env.DB.prepare(`PRAGMA table_info("${table}")`).all<{ name: string }>()
  return new Set((rows.results || []).map((row) => row.name))
}

function payloadForColumns(body: Record<string, unknown>, columns: Set<string>) {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body || {})) {
    if (WRITE_SKIP_KEYS.has(key) || !columns.has(key)) continue
    if (typeof value === 'boolean') {
      payload[key] = value ? 1 : 0
    } else if (value !== null && typeof value === 'object') {
      // D1's bind() only accepts null/number/string/ArrayBuffer -- binding a
      // raw object (e.g. undo_payload/redo_payload) throws a D1 type error,
      // which the global onError handler masks as a generic 500 ("Something
      // went wrong processing that request"). Serialize JSON-shaped values
      // instead of passing them through.
      payload[key] = JSON.stringify(value)
    } else {
      payload[key] = value
    }
  }
  return payload
}

async function insertTableRow(env: Env, table: string, body: Record<string, unknown>, required: Record<string, unknown> = {}) {
  const columns = await columnsFor(env, table)
  const payload = { ...payloadForColumns(body, columns), ...required }
  if (columns.has('created_at') && payload.created_at == null) payload.created_at = isoNow()
  if (columns.has('updated_at') && payload.updated_at == null) payload.updated_at = isoNow()
  const keys = Object.keys(payload).filter((key) => columns.has(key))
  // sql-bound-params: bounded by construction -- one parameter per COLUMN
  // of a single row, not per row, so this is capped by the table's schema
  // (the widest, `products`, is well under D1's 100-parameter limit).
  const result = await env.DB.prepare(`INSERT INTO "${table}" (${keys.map((key) => `"${key}"`).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
    .bind(...keys.map((key) => payload[key]))
    .run()
  return result.meta?.last_row_id
}

async function updateTableRow(env: Env, table: string, id: string | number, body: Record<string, unknown>) {
  const columns = await columnsFor(env, table)
  const payload = payloadForColumns(body, columns)
  if (columns.has('updated_at')) payload.updated_at = isoNow()
  const keys = Object.keys(payload).filter((key) => columns.has(key))
  if (!keys.length) return 0
  const result = await env.DB.prepare(`UPDATE "${table}" SET ${keys.map((key) => `"${key}" = ?`).join(', ')} WHERE id = ?`)
    .bind(...keys.map((key) => payload[key]), id)
    .run()
  return result.meta?.changes || 0
}

async function deleteTableRow(env: Env, table: string, id: string | number) {
  const columns = await columnsFor(env, table)
  if (columns.has('deleted_at')) {
    return updateTableRow(env, table, id, { deleted_at: isoNow() })
  }
  if (columns.has('is_active')) {
    return updateTableRow(env, table, id, { is_active: 0 })
  }
  const result = await env.DB.prepare(`DELETE FROM "${table}" WHERE id = ?`).bind(id).run()
  return result.meta?.changes || 0
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function saleItemCount(value: unknown): number {
  let rows: unknown = value
  if (typeof rows === 'string') {
    try { rows = JSON.parse(rows) } catch { return 0 }
  }
  if (!Array.isArray(rows)) return 0
  return rows.reduce((total, item) => {
    if (!item || typeof item !== 'object') return total
    const row = item as Record<string, unknown>
    const quantity = num(row.quantity ?? row.qty ?? 1)
    return total + Math.max(0, quantity)
  }, 0)
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// The dashboard's default window is TODAY -- the business day in
// Asia/Phnom_Penh, the same default every list page uses (user, 2026-09-03).
// The caller widens it freely; it governs only the flow figures (sales,
// returns, the charts, the recent-sales feed), never the stock/alert cards.
function dateRange(query: Record<string, string>) {
  const today = businessToday()
  return {
    startDate: String(query.startDate || today).slice(0, 10),
    endDate: String(query.endDate || today).slice(0, 10),
    granularity: ['week', 'month'].includes(String(query.granularity || 'day')) ? String(query.granularity) : 'day',
  }
}

function emptySummary() {
  return {
    today_count: 0,
    today_total: 0,
    today_total_khr: 0,
    today_return_count: 0,
    today_return_usd: 0,
    all_total: 0,
    all_total_khr: 0,
    cost_in: 0,
    cost_out: 0,
    cost_in_khr: 0,
    cost_out_khr: 0,
    product_count: 0,
    in_stock_count: 0,
    low_stock_count: 0,
    out_of_stock_count: 0,
    stock_value_usd: 0,
    stock_value_khr: 0,
    low_stock: [],
    out_of_stock: [],
    expiring_products: [],
    expiring_count: 0,
    recent_sales: [],
  }
}

function emptyAnalytics() {
  return {
    totals: {},
    prevTotals: {},
    periodReturns: {},
    periodSupplierReturns: {},
    periodData: [],
    byPayment: [],
    byBranch: [],
    topProducts: [],
    topProductsQty: [],
    topCustomers: [],
    hourlyDist: [],
  }
}

async function dashboardSummary(env: Env, query: Record<string, string>) {
  const db = getDb(env)
  const { startDate, endDate } = dateRange(query)
  const branchId = query.branchId || null
  const params = branchId ? { startDate, endDate, branchId } : { startDate, endDate }
  const saleBranchClause = (alias: string) => branchId ? ` AND ${alias}.branch_id = @branchId` : ''
  // The selected Start->End range scopes everything that is a MOVEMENT:
  // sales, returns and the recent-sales feed. It deliberately does NOT
  // scope the STOCK surfaces -- the product/in-stock/low/out counts, the
  // stock value, and the low-stock / out-of-stock / expiring alert lists and
  // their counts -- which report current on-hand state for the whole active
  // catalog. The stock/alert cards are the deliberate exception to the
  // one-range-scopes-list-and-stats convention (user, 2026-09-03): a period
  // figure may appear inside such a card as a secondary line, never as its
  // face value.
  //
  // An earlier revision restricted those to "products that had a recognized
  // sale in the range". That inverts the alert: a product which is out of
  // stock cannot sell, so anything out of stock for the whole window
  // dropped off the out-of-stock card exactly when it mattered most, and
  // the same trap applied more weakly to low stock and expiry. The
  // low-stock/out-of-stock badge counts come from getFamilyStockStats and
  // are rendered directly above those lists (Dashboard.tsx), so they are
  // scoped identically -- a range-scoped badge over a catalog-wide list
  // would disagree with itself.
  // Family-aware counts (see familyStockStats.ts) so this dashboard tile
  // agrees with the family-grouped pagination total on Products/Inventory
  // -- previously a flat COUNT(*)/SUM() here counted every variant row (and
  // group-header placeholder rows) individually, overcounting vs. those
  // listing pages whenever grouped products existed.
  const [todaySales, allSales, todayReturns, inventory, lowStock, outOfStock, expiring, expiringCount, recentSales] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS total_usd, COALESCE(SUM(total_khr), 0) AS total_khr
      FROM sales
      WHERE ${localDateRangeClause('created_at')} AND COALESCE(sale_status, 'completed') <> 'cancelled'${saleBranchClause('sales')}
    `).get(params),
    db.prepare(`
      SELECT COALESCE(SUM(total_usd), 0) AS total_usd, COALESCE(SUM(total_khr), 0) AS total_khr
      FROM sales
      WHERE ${localDateRangeClause('created_at')} AND COALESCE(sale_status, 'completed') <> 'cancelled'${saleBranchClause('sales')}
    `).get(params),
    db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total_refund_usd), 0) AS total_usd
      FROM returns
      WHERE ${localDateRangeClause('created_at')} AND COALESCE(status, 'completed') <> 'cancelled'${saleBranchClause('returns')}
    `).get(params),
    getFamilyStockStats({
      db,
      joinSql: '',
      whereSql: 'WHERE p.is_active = 1',
      params,
      qtyExpr: 'COALESCE(p.stock_quantity, 0)',
    }),
    db.prepare(`
      SELECT id, name, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold
      FROM products p
      WHERE p.is_active = 1 AND COALESCE(stock_quantity, 0) <= COALESCE(low_stock_threshold, 10) AND COALESCE(stock_quantity, 0) > COALESCE(out_of_stock_threshold, 0)
      ORDER BY stock_quantity ASC, lower(name) ASC
      LIMIT 10
    `).all(params),
    db.prepare(`
      SELECT id, name, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold
      FROM products p
      WHERE p.is_active = 1 AND COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0)
      ORDER BY stock_quantity ASC, lower(name) ASC
      LIMIT 10
    `).all(params),
    db.prepare(`
      SELECT id, name, category, unit, expiry_date, CAST(julianday(expiry_date) - julianday('now') AS INTEGER) AS days_until_expiry
      FROM products p
      WHERE p.is_active = 1 AND expiry_date IS NOT NULL AND date(expiry_date) <= date('now', '+' || COALESCE(expiry_alert_days, 30) || ' day')
      ORDER BY date(expiry_date) ASC
      LIMIT 10
    `).all(params),
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM products p
      WHERE p.is_active = 1 AND expiry_date IS NOT NULL AND date(expiry_date) <= date('now', '+' || COALESCE(expiry_alert_days, 30) || ' day')
    `).get(params),
    db.prepare(`
      SELECT id, receipt_number, created_at, sale_status, branch_name, customer_name, cashier_name, total_usd, total_khr, items
      FROM sales
      WHERE ${localDateRangeClause('created_at')}${saleBranchClause('sales')}
      ORDER BY created_at DESC, id DESC
      LIMIT 10
    `).all(params),
  ])

  return {
    ...emptySummary(),
    today_count: num((todaySales as Record<string, unknown>)?.count),
    today_total: num((todaySales as Record<string, unknown>)?.total_usd),
    today_total_khr: num((todaySales as Record<string, unknown>)?.total_khr),
    today_return_count: num((todayReturns as Record<string, unknown>)?.count),
    today_return_usd: num((todayReturns as Record<string, unknown>)?.total_usd),
    all_total: num((allSales as Record<string, unknown>)?.total_usd),
    all_total_khr: num((allSales as Record<string, unknown>)?.total_khr),
    product_count: inventory.total_products,
    in_stock_count: inventory.in_stock,
    low_stock_count: inventory.low_stock,
    out_of_stock_count: inventory.out_of_stock,
    stock_value_usd: inventory.stock_value_usd,
    stock_value_khr: inventory.stock_value_khr,
    low_stock: lowStock || [],
    out_of_stock: outOfStock || [],
    expiring_products: expiring || [],
    expiring_count: num((expiringCount as Record<string, unknown>)?.count),
    recent_sales: (recentSales || []).map((sale) => ({
      ...sale,
      item_count: saleItemCount((sale as Record<string, unknown>).items),
    })),
  }
}

async function dashboardAnalytics(env: Env, query: Record<string, string>) {
  const db = getDb(env)
  const { startDate, endDate, granularity } = dateRange(query)
  const params = { startDate, endDate }
  const filters = { startDate, endDate, branchId: query.branchId || null }
  const analyticsParams = filters.branchId ? { ...params, branchId: filters.branchId } : params
  const branchClause = (alias: string) => filters.branchId ? ` AND ${alias}.branch_id = @branchId` : ''
  const activeSalesClause = (alias: string) => `${localDateRangeClause(`${alias}.created_at`)} AND ${recognizedExpr(`${alias}.`)}${branchClause(alias)}`
  const attributedLineRevenue = `CASE
    WHEN COALESCE(s.subtotal_usd, 0) > 0
      THEN COALESCE(si.total_usd, 0) / s.subtotal_usd * (${netSaleExpr('s.')} - COALESCE(rf.refund_usd, 0))
    ELSE 0
  END`
  const [
    totals,
    prevTotals,
    periodData,
    periodReturns,
    periodSupplierReturns,
    byPayment,
    byBranch,
    topProducts,
    topProductsQty,
    topCustomers,
    hourlyDist,
  ] = await Promise.all([
    getSalesTotals(env, filters),
    getSalesTotals(env, previousPeriodFilters(filters)),
    getSalesPeriodSeries(env, filters, granularity as 'day' | 'week' | 'month'),
    db.prepare(`
      WITH matching_returns AS (
        SELECT r.id, r.total_refund_usd
        FROM returns r
        WHERE ${localDateRangeClause('r.created_at')}
          AND COALESCE(r.return_scope, 'customer') = 'customer'
          AND COALESCE(r.status, 'completed') <> 'cancelled'${branchClause('r')}
      )
      SELECT COUNT(*) AS return_count,
             COALESCE(SUM(total_refund_usd), 0) AS refund_usd,
             COALESCE((SELECT SUM(ri.quantity) FROM return_items ri JOIN matching_returns mr2 ON mr2.id = ri.return_id), 0) AS items_returned
      FROM matching_returns
    `).get(analyticsParams),
    db.prepare(`
      SELECT COUNT(*) AS return_count,
             COALESCE(SUM(r.supplier_compensation_usd), 0) AS supplier_compensation_usd,
             COALESCE(SUM(r.supplier_loss_usd), 0) AS loss_usd
      FROM returns r
      WHERE ${localDateRangeClause('r.created_at')}
        AND COALESCE(r.return_scope, 'customer') = 'supplier'
        AND COALESCE(r.status, 'completed') <> 'cancelled'${branchClause('r')}
    `).get(analyticsParams),
    db.prepare(`
      SELECT COALESCE(NULLIF(TRIM(s.payment_method), ''), 'Unknown') AS method,
             COALESCE(NULLIF(TRIM(s.payment_method), ''), 'Unknown') AS payment_method,
             COUNT(*) AS count,
             COALESCE(SUM(${netSaleExpr('s.')} - COALESCE(rf.refund_usd, 0)), 0) AS revenue_usd
      FROM sales s
      ${CUSTOMER_REFUND_JOIN}s.id
      WHERE ${activeSalesClause('s')}
      GROUP BY COALESCE(NULLIF(TRIM(s.payment_method), ''), 'Unknown')
      ORDER BY revenue_usd DESC
    `).all(analyticsParams),
    db.prepare(`
      SELECT s.branch_id, COALESCE(s.branch_name, 'Unassigned') AS branch_name,
             COUNT(*) AS tx_count, COUNT(*) AS count,
             COALESCE(SUM(${netSaleExpr('s.')} - COALESCE(rf.refund_usd, 0)), 0) AS revenue_usd
      FROM sales s
      ${CUSTOMER_REFUND_JOIN}s.id
      WHERE ${activeSalesClause('s')}
      GROUP BY s.branch_id, COALESCE(s.branch_name, 'Unassigned')
      ORDER BY revenue_usd DESC
    `).all(analyticsParams),
    db.prepare(`
      SELECT si.product_id, si.product_name, SUM(si.quantity) AS qty_sold,
             COALESCE(SUM(${attributedLineRevenue}), 0) AS revenue_usd
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      ${CUSTOMER_REFUND_JOIN}s.id
      WHERE ${activeSalesClause('s')}
      GROUP BY si.product_id, si.product_name
      ORDER BY revenue_usd DESC
      LIMIT 20
    `).all(analyticsParams),
    db.prepare(`
      SELECT si.product_id, si.product_name, SUM(si.quantity) AS qty_sold,
             COALESCE(SUM(${attributedLineRevenue}), 0) AS revenue_usd
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      ${CUSTOMER_REFUND_JOIN}s.id
      WHERE ${activeSalesClause('s')}
      GROUP BY si.product_id, si.product_name
      ORDER BY qty_sold DESC
      LIMIT 20
    `).all(analyticsParams),
    db.prepare(`
      SELECT COALESCE(NULLIF(TRIM(s.customer_name), ''), 'Walk-in') AS customer_name, COUNT(*) AS sale_count,
             COALESCE(SUM(s.subtotal_usd), 0) AS gross_revenue_usd,
             COALESCE(SUM(s.discount_usd), 0) AS store_discount_usd,
             COALESCE(SUM(s.membership_discount_usd), 0) AS membership_discount_usd,
             COALESCE(SUM(${netSaleExpr('s.')} - COALESCE(rf.refund_usd, 0)), 0) AS net_revenue_usd
      FROM sales s
      ${CUSTOMER_REFUND_JOIN}s.id
      WHERE ${activeSalesClause('s')}
      GROUP BY COALESCE(NULLIF(TRIM(s.customer_name), ''), 'Walk-in')
      ORDER BY net_revenue_usd DESC
      LIMIT 20
    `).all(analyticsParams),
    db.prepare(`
      SELECT CAST(${localHourExpr('s.created_at')} AS INTEGER) AS hour, COUNT(*) AS count,
             COALESCE(SUM(${netSaleExpr('s.')} - COALESCE(rf.refund_usd, 0)), 0) AS revenue_usd
      FROM sales s
      ${CUSTOMER_REFUND_JOIN}s.id
      WHERE ${activeSalesClause('s')}
      GROUP BY CAST(${localHourExpr('s.created_at')} AS INTEGER)
      ORDER BY hour ASC
    `).all(analyticsParams),
  ])
  return {
    totals: totals || {},
    prevTotals: prevTotals || {},
    periodReturns: periodReturns || {},
    periodSupplierReturns: periodSupplierReturns || {},
    periodData: periodData || [],
    byPayment: byPayment || [],
    byBranch: byBranch || [],
    topProducts: topProducts || [],
    topProductsQty: topProductsQty || [],
    topCustomers: topCustomers || [],
    hourlyDist: hourlyDist || [],
  }
}

// NOTE: /users and /roles routes moved to routes/users.ts (proper admin-
// control/self-service permission model, primary-admin guardrails, and
// duplicate-identity checks that this file's old generic
// insertTableRow/updateTableRow stub never had). See index.ts's mount
// order -- routes/users.ts is mounted before this file so it wins.
app.get('/dashboard', async (c) => {
  const denied = denyUnless(c, 'dashboard')
  if (denied) return denied
  return c.json(await dashboardSummary(c.env, c.req.query()))
})
app.get('/analytics', async (c) => {
  const denied = denyUnless(c, 'dashboard')
  if (denied) return denied
  return c.json(await dashboardAnalytics(c.env, c.req.query()))
})
app.get('/dashboard/startup', async (c) => {
  const denied = denyUnless(c, 'dashboard')
  if (denied) return denied
  const [summary, analytics] = await Promise.all([
    dashboardSummary(c.env, c.req.query()),
    dashboardAnalytics(c.env, c.req.query()),
  ])
  return c.json({ summary, analytics })
})

// notifications/summary is now a real route -- see ./notifications.ts


// auth.ts (mounted at /api/auth) now owns /auth/verification-capabilities
// and /auth/otp/status/:id for real -- registered before this router in
// index.ts, so these definitions here would have been unreachable dead
// code even before this comment. Removed to avoid the two drifting.

app.get('/system/config', (c) => c.json({
  publicUrl: c.env.BUSINESS_OS_PUBLIC_URL,
  adminUrl: c.env.BUSINESS_OS_ADMIN_URL,
  runtime: 'cloudflare-workers',
}))

app.get('/system/bootstrap', (c) => c.json({
  config: {
    publicUrl: c.env.BUSINESS_OS_PUBLIC_URL,
    adminUrl: c.env.BUSINESS_OS_ADMIN_URL,
    runtime: 'cloudflare-workers',
  },
  debugLog: { entries: [] },
}))

app.get('/system/debug/log', (c) => c.json({ entries: [] }))
app.get('/system/audit-logs', requireAuth, async (c) => {
  // audit_log view tier (Part 557 slice 7): 'view' sees ONLY the caller's own
  // entries (own-scoped, matching "audit log shows only for the user"); 'full'
  // (or an admin-control user) sees everyone's and may filter by user. A 'view'
  // value fails the old strict denyUnless('audit_log'), so gate on the tier.
  const user = c.get('user')
  const tier = getPermissionTier(user, 'audit_log')
  if (tier === 'none') return c.json({ error: 'You do not have permission to perform this action' }, 403)
  const ownOnly = tier === 'view'
  const page = Math.max(1, Number.parseInt(c.req.query('page') || '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(c.req.query('pageSize') || '50', 10) || 50))
  const offset = (page - 1) * pageSize
  // I2: honor the filters AuditLog.tsx has been sending all along (they were
  // silently ignored -- every filter control on the page was dead). The
  // clause builder lives in lib/auditLogQuery.ts so the pure test can run
  // the exact production SQL. COUNT applies the SAME clause, so pagination
  // agrees with the filtered set, not the whole table.
  //
  // Own-scoping is enforced HERE by overriding userId with the caller's id
  // (never trusting the client's userId param for a view user), so it applies
  // to the COUNT and rows identically.
  const { where, params: filterParams } = buildAuditLogFilters({
    search: c.req.query('search'),
    action: c.req.query('action'),
    entity: c.req.query('entity'),
    userId: ownOnly ? String(user?.id ?? '') : c.req.query('userId'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
  })
  try {
    const db = getDb(c.env)
    const totalRow = await db.prepare(`SELECT COUNT(*) AS count FROM audit_logs ${where}`).get<{ count: number }>(filterParams)
    const rows = await db.prepare(`
      SELECT
        id,
        user_id,
        user_name,
        user_name AS username,
        action,
        entity,
        entity_id,
        table_name,
        record_id,
        details,
        old_value,
        new_value,
        device_name,
        device_tz,
        client_time,
        created_at
      FROM audit_logs
      ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT @pageSize OFFSET @offset
    `).all({ ...filterParams, pageSize, offset })
    // Filter vocabularies come from the WHOLE table, not the current page --
    // previously the action dropdown could only offer whatever happened to
    // be on the visible page.
    const users = await db.prepare(`
      SELECT DISTINCT user_id AS id, user_name AS name
      FROM audit_logs
      WHERE user_id IS NOT NULL OR COALESCE(user_name, '') <> ''
      ORDER BY user_name COLLATE NOCASE ASC
    `).all()
    const actionRows = await db.prepare(`
      SELECT DISTINCT LOWER(action) AS action
      FROM audit_logs
      WHERE COALESCE(action, '') <> ''
      ORDER BY action ASC
    `).all<{ action: string }>()
    const entityRows = await db.prepare(`
      SELECT DISTINCT LOWER(COALESCE(entity, table_name)) AS entity
      FROM audit_logs
      WHERE COALESCE(entity, table_name, '') <> ''
      ORDER BY entity ASC
    `).all<{ entity: string }>()
    return c.json({
      items: rows || [],
      total: totalRow?.count || 0,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil((totalRow?.count || 0) / pageSize)),
      filters: {
        // An own-scoped (view) user can only ever see themselves, so never
        // hand back the full roster of user names as a filter vocabulary.
        users: ownOnly ? [] : (users || []),
        actions: (actionRows || []).map((row) => row.action),
        entities: (entityRows || []).map((row) => row.entity),
      },
    })
  } catch (error) {
    // Was `return empty 200` -- the same silent-empty failure class as the
    // POS lot-lookup bug: a db error rendered as "no logs" with real-looking
    // pagination. A 500 lets the client fall back to its local mirror (and
    // say so) instead of presenting an error as an empty trail.
    const message = error instanceof Error ? error.message : 'Failed to load audit logs'
    return c.json({ error: message }, 500)
  }
})
app.delete('/system/audit-logs/retention', requireAuth, async (c) => {
  const denied = denyUnless(c, 'audit_log')
  if (denied) return denied
  const user = c.get('user')
  if (!isAdminControlUser(user)) return c.json({ error: 'Administrator access required.' }, 403)
  const olderThanDays = Math.max(1, Number.parseInt(c.req.query('olderThanDays') || '30', 10) || 30)
  const confirmedQuery = String(c.req.query('confirm') || '').toLowerCase()
  let confirmedBody = false
  try {
    const body = await c.req.json<{ confirm?: boolean }>()
    confirmedBody = body?.confirm === true
  } catch (_) { /* no body sent, fall through to query param */ }
  if (!confirmedBody && confirmedQuery !== 'true' && confirmedQuery !== '1') {
    return c.json({ error: 'Confirmation is required to clear old audit logs.' }, 400)
  }
  // Raw column against a full 'YYYY-MM-DD HH:MM:SS' cutoff (matches audit_logs'
  // own CURRENT_TIMESTAMP shape), batched by id -- same fix as the scheduled
  // retention in lib/audit.ts:140-147: the old `date(created_at) < @cutoff`
  // wrapped the column, defeating any index and forcing a full-table scan, and
  // deleted in ONE unbounded statement that could exceed D1's per-statement
  // budget on a large backlog.
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
  const db = getDb(c.env)
  let deleted = 0
  for (;;) {
    const result = await db.prepare('DELETE FROM audit_logs WHERE id IN (SELECT id FROM audit_logs WHERE created_at < @cutoff LIMIT 5000)').run({ cutoff })
    const n = (result as any)?.meta?.changes ?? (result as any)?.changes ?? 0
    deleted += n
    if (n < 5000) break
  }
  await audit(c.env, user?.id ?? null, user?.name ?? user?.username ?? null, 'audit_log_retention_delete', 'audit_log', null, { olderThanDays, cutoffDate: cutoff, deleted })
  return c.json({ ok: true, deleted })
})
// The legacy deleted-sale audit ledger (migration 0088): every line the old
// system's cashiers deleted from a cart or bill, preserved verbatim as
// evidence -- these rows never touched sales or stock. Read-only, gated by
// audit_log like the audit trail it sits beside on Review & Logs. Timestamps
// are stored UTC; date filters compare the Bangkok calendar day (+7h).
app.get('/system/legacy-deleted-sales', requireAuth, async (c) => {
  const denied = denyUnless(c, 'audit_log')
  if (denied) return denied
  const query = c.req.query()
  const page = Math.max(1, Number.parseInt(query.page || '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(query.page_size || '50', 10) || 50))

  const conditions: string[] = []
  const params: Record<string, unknown> = {}
  const cashier = String(query.cashier || '').trim()
  if (cashier && cashier !== 'all') {
    conditions.push("lower(trim(COALESCE(d.cashier_name, d.deleted_by, ''))) = lower(trim(@cashier))")
    params.cashier = cashier
  }
  const search = String(query.search || '').trim().toLowerCase()
  if (search) {
    conditions.push(`(
      lower(COALESCE(d.product_name, '')) LIKE @search
      OR lower(COALESCE(d.source_product_name, '')) LIKE @search
      OR lower(COALESCE(d.source_code, '')) LIKE @search
      OR lower(COALESCE(d.invoice_no, '')) LIKE @search
      OR lower(COALESCE(d.reference_no, '')) LIKE @search
      OR lower(COALESCE(d.deletion_reason, '')) LIKE @search
      OR lower(COALESCE(d.bill_delete_reason, '')) LIKE @search
    )`)
    params.search = `%${search}%`
  }
  // A date bound requires a recorded deletion time (a range filter that
  // quietly matched undated rows would misreport; they stay reachable with
  // no date filter set).
  const from = String(query.from || '').slice(0, 10)
  const to = String(query.to || '').slice(0, 10)
  if (from) { conditions.push(`d.deleted_at IS NOT NULL AND ${localDateAtOrAfter('d.deleted_at', '@from')}`); params.from = from }
  if (to) { conditions.push(`d.deleted_at IS NOT NULL AND ${localDateAtOrBefore('d.deleted_at', '@to')}`); params.to = to }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    const db = getDb(c.env)
    type DeletedRow = {
      id: number; event_key: string; event_started_at: string | null; event_ended_at: string | null
      invoice_no: string | null; reference_no: string | null; cashier_name: string | null
      bill_delete_reason: string | null; deleted_at: string | null; deleted_by: string | null
      deletion_reason: string | null; product_id: number | null; source_product_name: string
      product_name: string | null; source_code: string | null; quantity: number
      unit_price_usd: number; discount_raw: string | null; total_usd: number
    }
    type DeletedTotals = { events: number; lines: number; units: number; value_usd: number }
    const [rows, totals, cashiers] = await Promise.all([
      db.prepare(`
        SELECT d.id, d.event_key, d.event_started_at, d.event_ended_at, d.invoice_no, d.reference_no,
               d.cashier_name, d.bill_delete_reason, d.deleted_at, d.deleted_by, d.deletion_reason,
               d.product_id, d.source_product_name, d.product_name, d.source_code,
               d.quantity, d.unit_price_usd, d.discount_raw, d.total_usd
        FROM legacy_deleted_sale_items d
        ${where}
        ORDER BY d.deleted_at DESC, d.id DESC
        LIMIT @limit OFFSET @offset
      `).all<DeletedRow>({ ...params, limit: pageSize, offset: (page - 1) * pageSize }),
      db.prepare(`
        SELECT COUNT(DISTINCT d.event_key) AS events, COUNT(*) AS lines,
               COALESCE(SUM(d.quantity), 0) AS units, COALESCE(SUM(d.total_usd), 0) AS value_usd
        FROM legacy_deleted_sale_items d ${where}
      `).get<DeletedTotals>(params),
      db.prepare(`
        SELECT lower(trim(COALESCE(cashier_name, deleted_by, ''))) AS key,
               MAX(trim(COALESCE(cashier_name, deleted_by, ''))) AS name, COUNT(*) AS line_count
        FROM legacy_deleted_sale_items
        WHERE trim(COALESCE(cashier_name, deleted_by, '')) <> ''
        GROUP BY lower(trim(COALESCE(cashier_name, deleted_by, '')))
        ORDER BY name COLLATE NOCASE ASC
      `).all<{ key: string; name: string; line_count: number }>(),
    ])
    const round2 = (value: unknown): number => Math.round((Number(value) || 0) * 100) / 100
    return c.json({
      items: rows || [],
      totals: {
        events: Number(totals?.events) || 0,
        lines: Number(totals?.lines) || 0,
        units: Math.round((Number(totals?.units) || 0) * 1000) / 1000,
        value_usd: round2(totals?.value_usd),
      },
      page,
      page_size: pageSize,
      total_lines: Number(totals?.lines) || 0,
      meta: { cashiers },
    })
  } catch (error) {
    // Same fail-loud rule as /system/audit-logs above: a db error must not
    // render as an empty ledger.
    const message = error instanceof Error ? error.message : 'Failed to load the deleted-sale ledger'
    return c.json({ error: message }, 500)
  }
})

app.get('/system/integration-doctor', requireAuth, async (c) => {
  const denied = denyUnless(c, 'backup', 'settings')
  if (denied) return denied
  let ok = true

  const database: Record<string, unknown> = { ok: true, status: 'ok', message: 'Cloudflare D1 is reachable.' }
  try {
    await c.env.DB.prepare('SELECT 1 AS ok').first()
  } catch (error) {
    ok = false
    database.ok = false
    database.status = 'needs_attention'
    database.message = error instanceof Error ? error.message : 'D1 query failed'
  }

  const objectStorage: Record<string, unknown> = { driver: 'r2', ok: true, status: 'ok', message: 'R2 (ASSETS) bucket is bound.' }
  if (c.req.query('deep')) {
    try {
      const key = `system/doctor-${crypto.randomUUID()}.txt`
      await c.env.ASSETS.put(key, 'ok')
      await c.env.ASSETS.delete(key)
      objectStorage.writeReadDelete = { ok: true }
    } catch (error) {
      ok = false
      objectStorage.ok = false
      objectStorage.status = 'needs_attention'
      objectStorage.message = error instanceof Error ? error.message : 'R2 write/delete failed'
      objectStorage.writeReadDelete = { ok: false }
    }
  }

  let backupCheck: Record<string, unknown> = { ok: true, status: 'ok', message: 'R2 backups are reachable.' }
  try {
    const backups = await listCloudflareBackups(c.env)
    backupCheck = { ok: true, status: 'ok', message: `${backups.length} backup(s) stored in R2.`, count: backups.length, keep: 2, intervalHours: 6 }
  } catch (error) {
    ok = false
    backupCheck = { ok: false, status: 'needs_attention', message: error instanceof Error ? error.message : 'R2 backup listing failed' }
  }

  const queue = { ok: true, status: 'configured', message: 'Cloudflare Queues configured.', queues: ['business-os-import', 'business-os-media'] }

  // DuckDB/Parquet has no equivalent in a Workers isolate (no native modules,
  // no filesystem) -- this deployment never uses it, so report that plainly
  // instead of the old Postgres-era pass/fail semantics.
  const analytics = { ok: true, status: 'not_applicable', message: 'Not used on Cloudflare Workers; queries run directly against D1.' }

  let googleDrive: Record<string, unknown>
  try {
    const drive = (await driveSyncStatus(c.env)).item
    googleDrive = {
      ok: true,
      status: drive.connected ? 'ok' : 'optional',
      message: drive.connected
        ? `Connected${drive.accountEmail ? ` as ${drive.accountEmail}` : ''}. Optional off-Cloudflare backup mirror.`
        : (drive.configured ? 'Configured but not connected yet.' : 'Optional mirror; configure OAuth before sync.'),
      connected: !!drive.connected,
    }
  } catch (_) {
    googleDrive = { ok: true, status: 'optional', message: 'Optional mirror; configure OAuth before sync.' }
  }

  const googleLoginConfig = getGoogleLoginPublicConfig(c.env)
  const googleLogin = {
    ok: true,
    status: googleLoginConfig.enabled ? 'ok' : 'optional',
    message: googleLoginConfig.enabled ? 'Google login is configured.' : 'Google login needs a client ID and client secret.',
    enabled: !!googleLoginConfig.enabled,
  }

  const checks = { database, objectStorage, queue, analytics, googleDrive, googleLogin, backup: backupCheck }
  return c.json({ item: { checks, runtime: { objectStorageDriver: 'r2' } }, checks, ok })
})

// Ported from backend's testObjectStore(): write, read-back, delete a probe
// key against the same bucket production uploads go to (R2's ASSETS
// binding), confirming credentials/bucket config actually work end-to-end
// rather than just "the binding exists". Both legacy routes hit the same
// underlying check; kept as two routes to match existing frontend call
// sites (`GET .../doctor` for passive display, `POST .../test-write` for
// an explicit user-triggered "Test connection" button).
async function testObjectStore(env: Env) {
  const key = `system/doctor/object-store-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
  const probeBody = new Uint8Array(new TextEncoder().encode('business-os-object-store-test')).buffer as ArrayBuffer
  await putObject(env.ASSETS, key, probeBody, 'text/plain; charset=utf-8')
  const object = await getObject(env.ASSETS, key)
  if (!object) throw new Error('Object store test read returned no body')
  await deleteObject(env.ASSETS, key)
  return { ok: true, driver: 'cloudflare-r2', bucket: 'ASSETS' }
}
app.get('/system/object-storage/doctor', requireAuth, async (c) => {
  const denied = denyUnless(c, 'backup', 'settings')
  if (denied) return denied
  try {
    return c.json({ item: await testObjectStore(c.env) })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Object storage doctor failed' }, 503)
  }
})
app.post('/system/object-storage/test-write', requireAuth, async (c) => {
  const denied = denyUnless(c, 'backup', 'settings')
  if (denied) return denied
  try {
    return c.json({ item: await testObjectStore(c.env) })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Object storage test failed' }, 503)
  }
})

// Ported from backend's `/backups/versions`(+`/list` alias)/`/backups/:id` --
// these were missing entirely on Cloudflare even though `routes/backups.ts`
// (mounted at /api/backups) covers create/list/restore; this compat.ts
// `/system/backups/*` path is the one the Settings > Backups panel's
// version-history view and per-job status poll actually call.
async function sendBackupVersions(c: any) {
  const limit = Math.min(200, Math.max(1, Number.parseInt(c.req.query('limit') || '50', 10) || 50))
  const denied = denyUnless(c, 'backup')
  if (denied) return denied
  try {
    const items = (await listCloudflareBackups(c.env)).slice(0, limit)
    return c.json({ items })
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to list backup versions' }, 500)
  }
}
app.get('/system/backups/versions', requireAuth, sendBackupVersions)
app.get('/system/backups/versions/list', requireAuth, sendBackupVersions)
app.get('/system/backups/:id', requireAuth, async (c) => {
  const denied = denyUnless(c, 'backup')
  if (denied) return denied
  const item = await getSystemJob(c.env, c.req.param('id') || '')
  if (!item) return c.json({ error: 'Backup job not found' }, 404)
  return c.json({ item })
})

// -----------------------------------------------------------------------
// Filesystem / Postgres-only diagnostics from the Docker-era backend.
// These have no meaningful Cloudflare equivalent: Workers have no local
// disk to browse/pick a folder on, and this deployment is D1 (SQLite),
// not Postgres, so there is no "scale migration" to prepare/run. Rather
// than leaving these to silently 404 (which the frontend could mistake
// for a network error), they respond honestly so Settings can show
// "Not applicable in Cloudflare mode" instead of a spinner or blank error.
// See frontend/src/components/settings/DataStorageSettings.tsx, which now
// hides the corresponding buttons entirely in Workers mode.
// -----------------------------------------------------------------------
const NOT_APPLICABLE_CLOUD = { error: 'Not applicable when running fully on Cloudflare -- there is no local filesystem or Postgres instance to manage.', code: 'not_applicable_cloud_mode' }
app.post('/system/data-path', requireAuth, (c) => c.json(NOT_APPLICABLE_CLOUD, 410))
app.delete('/system/data-path', requireAuth, (c) => c.json(NOT_APPLICABLE_CLOUD, 410))
app.get('/system/storage-mode', requireAuth, (c) => c.json({ mode: 'cloudflare', driver: 'd1+r2', migratable: false }))
app.post('/system/scale-migration/prepare', requireAuth, (c) => c.json(NOT_APPLICABLE_CLOUD, 410))
app.post('/system/scale-migration/run', requireAuth, (c) => c.json(NOT_APPLICABLE_CLOUD, 410))
app.post('/system/browse-dir', requireAuth, (c) => c.json(NOT_APPLICABLE_CLOUD, 410))
app.post('/system/open-path', requireAuth, (c) => c.json(NOT_APPLICABLE_CLOUD, 410))
app.post('/system/pick-folder', requireAuth, (c) => c.json(NOT_APPLICABLE_CLOUD, 410))

app.get('/system/data-path', (c) => c.json({ runtime: 'cloudflare-workers', dataPath: 'Cloudflare D1/R2' }))
app.get('/system/scale-migration/status', (c) => c.json({ item: null }))
// Real Google Drive OAuth + one-way backup push -- see lib/googleDrive.ts
// for exactly what's implemented (connect/disconnect/status + pushing the
// existing R2 backup snapshot into Drive) vs. what's explicitly still out
// of scope (a continuous bi-directional per-file mirror).
app.get('/system/drive-sync/status', requireAuth, async (c) => {
  const denied = denyUnless(c, 'backup', 'settings')
  if (denied) return denied
  return c.json(await driveSyncStatus(c.env))
})
app.post('/system/drive-sync/preferences', requireAuth, async (c) => {
  const denied = denyUnless(c, 'settings')
  if (denied) return denied
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  return c.json(await updateDrivePreferences(c.env, body))
})
app.post('/system/drive-sync/oauth/start', requireAuth, async (c) => {
  const denied = denyUnless(c, 'settings')
  if (denied) return denied
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({} as Record<string, unknown>))
  const result = await buildDriveOauthStartUrl(c.env, {
    userId: Number(c.get('user')?.id || 0),
    returnOrigin: body.returnOrigin,
    returnPath: body.returnPath,
  })
  if (!result.success) return c.json({ error: result.error }, 400)
  return c.json({ url: result.url })
})

function driveOauthCallbackHtml({ targetUrl, message, status }: { targetUrl: string; message: string; status: 'connected' | 'error' }): string {
  const parsedTarget = new URL(targetUrl)
  parsedTarget.searchParams.set('drive_sync', status)
  const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')
  const payload = safeJson({ type: 'business-os-drive-sync', status, message })
  const targetOrigin = safeJson(parsedTarget.origin)
  const fallbackUrl = safeJson(parsedTarget.toString())
  // The popup is opened by Backup.tsx without `noopener` so it can report
  // completion to that exact opener. targetOrigin is never `*`; the opener
  // validates both origin and source before accepting this message. A
  // same-tab (popup-blocked) OAuth flow has no opener and safely redirects.
  return `<!doctype html><html><body><p id="message"></p><script>(function(){const payload=${payload};const targetOrigin=${targetOrigin};document.getElementById('message').textContent=payload.message;try{if(window.opener&&!window.opener.closed){window.opener.postMessage(payload,targetOrigin);window.close();return}}catch(_){ }setTimeout(function(){location.replace(${fallbackUrl})},400)})()</script></body></html>`
}

app.get('/system/drive-sync/oauth/callback', async (c) => {
  const code = c.req.query('code')
  const error = c.req.query('error')
  const stateResult = await consumeDriveOauthState(c.env, c.req.query('state'))
  const adminUrl = c.env.BUSINESS_OS_ADMIN_URL.replace(/\/$/, '')
  const stateTargetUrl = stateResult.success && stateResult.payload
    ? `${stateResult.payload.returnOrigin}${stateResult.payload.returnPath}`
    : `${adminUrl}/?settings=integrations`
  if (!stateResult.success) {
    return c.html(driveOauthCallbackHtml({ targetUrl: stateTargetUrl, message: stateResult.error || 'Google Drive connection expired. Please try again.', status: 'error' }), 400)
  }
  if (error) {
    return c.html(driveOauthCallbackHtml({ targetUrl: stateTargetUrl, message: 'Google Drive connection was cancelled or denied.', status: 'error' }), 400)
  }
  if (!code) {
    return c.html(driveOauthCallbackHtml({ targetUrl: stateTargetUrl, message: 'Missing authorization code from Google.', status: 'error' }), 400)
  }
  const result = await completeDriveOauth(c.env, code, stateResult.payload?.codeVerifier || '')
  const status = result.success ? 'connected' : 'error'
  const message = result.success ? 'Google Drive connected. You can close this window.' : (result.error || 'Failed to connect Google Drive.')
  return c.html(driveOauthCallbackHtml({ targetUrl: stateTargetUrl, message, status }), result.success ? 200 : 400)
})
app.post('/system/drive-sync/disconnect', requireAuth, async (c) => {
  const denied = denyUnless(c, 'settings')
  if (denied) return denied
  await disconnectDrive(c.env)
  return c.json(await driveSyncStatus(c.env))
})
app.post('/system/drive-sync/forget-credentials', requireAuth, async (c) => {
  const denied = denyUnless(c, 'settings')
  if (denied) return denied
  await disconnectDrive(c.env)
  return c.json(await driveSyncStatus(c.env))
})
app.post('/system/drive-sync/jobs', requireAuth, async (c) => {
  const denied = denyUnless(c, 'backup', 'settings')
  if (denied) return denied
  try {
    const job = await enqueueDriveSyncJob(c.env, 'manual')
    return c.json({ job_id: job.id, item: job }, 202)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not queue Google Drive sync.'
    return c.json({ error: message }, 503)
  }
})
// Recovery is deliberately two-step. This endpoint only stages and validates
// a Drive manifest in R2; it never calls the destructive D1 restore. The
// returned backupKey can then be reviewed through the existing backup flow.
app.post('/system/drive-sync/restore-stage/jobs', requireAuth, async (c) => {
  const user = c.get('user')
  if (!hasPermission(user, 'backup_restore')) {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }
  try {
    const job = await enqueueDriveRestoreStageJob(c.env)
    await audit(c.env, Number(user?.id || 0), user?.username || null, 'create', 'backup', 'google-drive-restore-stage', {
      job_id: job.id,
      destructive_restore: false,
    })
    return c.json({ job_id: job.id, item: job }, 202)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not queue Google Drive restore staging.'
    return c.json({ error: message }, 503)
  }
})
app.get('/system/jobs', requireAuth, async (c) => {
  const denied = denyUnless(c, 'backup', 'settings')
  if (denied) return denied
  const limit = c.req.query('limit')
  return c.json({ items: await listSystemJobs(c.env, limit ? Number(limit) : 25) })
})
app.get('/system/jobs/:id', requireAuth, async (c) => {
  const denied = denyUnless(c, 'backup', 'settings')
  if (denied) return denied
  const jobId = c.req.param('id') || ''
  const job = await getSystemJob(c.env, jobId)
  return c.json({ item: job || { id: jobId, status: 'unknown', progress: 0 } })
})
app.post('/system/jobs/:id/cancel', requireAuth, async (c) => {
  const denied = denyUnless(c, 'backup', 'settings')
  if (denied) return denied
  const jobId = c.req.param('id') || ''
  const existing = await getSystemJob(c.env, jobId)
  if (existing?.status === 'completed' || existing?.status === 'failed') return c.json({ item: existing })
  // Frontend's cancelSystemJob() always sends a `reason` string (defaulting
  // to 'Cancelled by user'), but this handler never parsed the body at all,
  // so every cancellation showed the same generic 'Cancelled' message
  // regardless of what was passed. Found via a frontend<->backend request-
  // body contract diff, not a live bug report.
  const body = (await c.req.json<Record<string, unknown>>().catch(() => ({}))) as Record<string, unknown>
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Cancelled'
  const job = await storeSystemJob(c.env, { ...(existing || {}), id: jobId, status: 'cancelled', progress: 100, message: reason })
  return c.json({ item: job })
})

app.get('/import-jobs', async (c) => {
  const page = clampInt(c.req.query('page'), 1, 1, 100000)
  const pageSize = clampInt(c.req.query('pageSize'), 20, 1, 100)
  const offset = (page - 1) * pageSize
  const db = getDb(c.env)
  const total = await db.prepare('SELECT COUNT(*) AS count FROM import_jobs').get<{ count: number }>({})
  const items = await db.prepare('SELECT * FROM import_jobs ORDER BY created_at DESC LIMIT @pageSize OFFSET @offset').all({ pageSize, offset })
  return c.json({ items, total: total?.count || 0, page, pageSize, totalPages: Math.max(1, Math.ceil((total?.count || 0) / pageSize)) })
})
app.get('/import-jobs/queue/status', (c) => c.json({ import: { waiting: 0, active: 0 }, media: { waiting: 0, active: 0 } }))
app.get('/import-jobs/:id', async (c) => {
  const item = await getDb(c.env).prepare('SELECT * FROM import_jobs WHERE id = @id LIMIT 1').get({ id: c.req.param('id') })
  return item ? c.json({ item }) : c.json({ error: 'Import job not found' }, 404)
})
app.get('/import-jobs/:id/review', async (c) => {
  const db = getDb(c.env)
  const errors = await db.prepare('SELECT * FROM import_job_errors WHERE job_id = @id ORDER BY row_number ASC, id ASC LIMIT 500').all({ id: c.req.param('id') })
  const files = await db.prepare('SELECT * FROM import_job_files WHERE job_id = @id ORDER BY created_at ASC').all({ id: c.req.param('id') })
  return c.json({ items: files || [], conflicts: [], errors: errors || [], warnings: [] })
})

// Permission gate on top of the requireAuth middleware above: this returns
// stock-transfer history, the same data routes/inventory.ts and
// routes/branches.ts gate behind those permissions, so a merely
// authenticated account (e.g. a cashier-only role) should not read it
// either. Matches this file's own denyUnless() pattern used by /dashboard.
app.get('/transfers', async (c) => {
  const user = c.get('user')
  // Transfer history is a read surface shared by Inventory and Branches.
  // Review-tier users may read both parent pages, so requiring a strict Full
  // grant here made the history panel fail with 403 after the page opened.
  if (getPermissionTier(user, 'inventory') === 'none' && getPermissionTier(user, 'branches') === 'none') {
    return c.json({ error: 'You do not have permission to perform this action' }, 403)
  }

  const query = c.req.query()
  const startDate = String(query.startDate || '').trim()
  const endDate = String(query.endDate || '').trim()
  const fromBranchId = String(query.fromBranchId || query.from_branch_id || '').trim()
  const toBranchId = String(query.toBranchId || query.to_branch_id || '').trim()
  const clauses: string[] = ['1=1']
  const bindings: Record<string, unknown> = {}

  // Transfer timestamps are stored in UTC. Every other business-day report
  // uses the fixed Cambodia UTC+7 helpers; using raw date(created_at) here
  // misclassified transfers made between 00:00 and 06:59 local time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    clauses.push(localDateAtOrAfter('st.created_at'))
    bindings.startDate = startDate
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    clauses.push(localDateAtOrBefore('st.created_at'))
    bindings.endDate = endDate
  }
  // Optional local (UTC+7) wall-clock bound, ADDITIONAL to the calendar-day
  // bound above -- same "date and time range" picker/route pattern
  // sales.ts's appendLocalTimeRange already uses. Both start/end must be
  // present and valid to take effect.
  const LOCAL_TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/
  const startTime = String(query.startTime || '').trim()
  const endTime = String(query.endTime || '').trim()
  if (LOCAL_TIME_RE.test(startTime) && LOCAL_TIME_RE.test(endTime)) {
    clauses.push(localTimeRangeClause('st.created_at'))
    bindings.startTime = startTime
    bindings.endTime = endTime
  }
  if (fromBranchId && /^\d+$/.test(fromBranchId)) {
    clauses.push('st.from_branch_id = @fromBranchId')
    bindings.fromBranchId = Number(fromBranchId)
  }
  if (toBranchId && /^\d+$/.test(toBranchId)) {
    clauses.push('st.to_branch_id = @toBranchId')
    bindings.toBranchId = Number(toBranchId)
  }

  const where = `WHERE ${clauses.join(' AND ')}`
  const db = getDb(c.env)
  const hasPaging = Object.prototype.hasOwnProperty.call(query, 'page') || Object.prototype.hasOwnProperty.call(query, 'pageSize')

  if (!hasPaging) {
    // Compatibility shape for any older client that still expects a bare
    // array. The current Branches page always requests paging, so no UI data
    // is hidden behind this legacy safety cap.
    const rows = await db.prepare(`
      SELECT st.*, st.notes AS note, b1.name AS from_name, b2.name AS to_name
      FROM stock_transfers st
      LEFT JOIN branches b1 ON b1.id = st.from_branch_id
      LEFT JOIN branches b2 ON b2.id = st.to_branch_id
      ${where}
      ORDER BY st.created_at DESC, st.id DESC
      LIMIT 500
    `).all(bindings)
    return c.json(rows || [])
  }

  const page = clampInt(query.page, 1, 1, 100000)
  const pageSize = clampInt(query.pageSize, 20, 1, 200)
  const offset = (page - 1) * pageSize
  const countRow = await db.prepare(`SELECT COUNT(*) AS count FROM stock_transfers st ${where}`).get<{ count: number }>(bindings)
  const total = Number(countRow?.count || 0)
  const items = await db.prepare(`
    SELECT st.*, st.notes AS note, b1.name AS from_name, b2.name AS to_name
    FROM stock_transfers st
    LEFT JOIN branches b1 ON b1.id = st.from_branch_id
    LEFT JOIN branches b2 ON b2.id = st.to_branch_id
    ${where}
    ORDER BY st.created_at DESC, st.id DESC
    LIMIT @pageSize OFFSET @offset
  `).all({ ...bindings, pageSize, offset })

  return c.json({
    items: items || [],
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  })
})

export default app
