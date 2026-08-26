import { Hono } from 'hono'
import { getDb } from '../lib/db'
import { requireAuth } from '../lib/auth'
import type { Env } from '../index'
import { getSystemJob, listCloudflareBackups, listSystemJobs, storeSystemJob } from '../lib/backup'
import { buildDriveOauthStartUrl, completeDriveOauth, disconnectDrive, driveSyncStatus, pushBackupToDrive, updateDrivePreferences } from '../lib/googleDrive'
import { hasPermission, hasAnyPermission, isAdminControlUser } from '../lib/permissions'
import { audit } from '../lib/audit'
import { putObject, getObject, deleteObject } from '../lib/r2'
import { getGoogleLoginPublicConfig } from '../lib/googleOauth'
import { getSalesTotals, getSalesPeriodSeries, previousPeriodFilters } from '../lib/salesAnalytics'
import { getFamilyStockStats } from '../lib/familyStockStats'

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

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function dateRange(query: Record<string, string>) {
  const today = new Date().toISOString().slice(0, 10)
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

async function dashboardSummary(env: Env) {
  const db = getDb(env)
  const today = new Date().toISOString().slice(0, 10)
  // Family-aware counts (see familyStockStats.ts) so this dashboard tile
  // agrees with the family-grouped pagination total on Products/Inventory
  // -- previously a flat COUNT(*)/SUM() here counted every variant row (and
  // group-header placeholder rows) individually, overcounting vs. those
  // listing pages whenever grouped products existed.
  const [todaySales, allSales, todayReturns, inventory, lowStock, outOfStock, expiring, recentSales] = await Promise.all([
    db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS total_usd, COALESCE(SUM(total_khr), 0) AS total_khr
      FROM sales
      WHERE date(created_at) = date(@today) AND COALESCE(sale_status, 'completed') <> 'cancelled'
    `).get({ today }),
    db.prepare(`
      SELECT COALESCE(SUM(total_usd), 0) AS total_usd, COALESCE(SUM(total_khr), 0) AS total_khr
      FROM sales
      WHERE COALESCE(sale_status, 'completed') <> 'cancelled'
    `).get({}),
    db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(total_refund_usd), 0) AS total_usd
      FROM returns
      WHERE date(created_at) = date(@today) AND COALESCE(status, 'completed') <> 'cancelled'
    `).get({ today }),
    getFamilyStockStats({
      db,
      joinSql: '',
      whereSql: 'WHERE p.is_active = 1',
      params: {},
      qtyExpr: 'COALESCE(p.stock_quantity, 0)',
    }),
    db.prepare(`
      SELECT id, name, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold
      FROM products
      WHERE is_active = 1 AND COALESCE(stock_quantity, 0) <= COALESCE(low_stock_threshold, 10) AND COALESCE(stock_quantity, 0) > COALESCE(out_of_stock_threshold, 0)
      ORDER BY stock_quantity ASC, lower(name) ASC
      LIMIT 10
    `).all({}),
    db.prepare(`
      SELECT id, name, category, unit, stock_quantity, low_stock_threshold, out_of_stock_threshold
      FROM products
      WHERE is_active = 1 AND COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0)
      ORDER BY stock_quantity ASC, lower(name) ASC
      LIMIT 10
    `).all({}),
    db.prepare(`
      SELECT id, name, category, unit, expiry_date, CAST(julianday(expiry_date) - julianday('now') AS INTEGER) AS days_until_expiry
      FROM products
      WHERE is_active = 1 AND expiry_date IS NOT NULL AND date(expiry_date) <= date('now', '+' || COALESCE(expiry_alert_days, 30) || ' day')
      ORDER BY date(expiry_date) ASC
      LIMIT 10
    `).all({}),
    db.prepare(`
      SELECT id, receipt_number, created_at, sale_status, branch_name, customer_name, total_usd, total_khr, items
      FROM sales
      ORDER BY created_at DESC, id DESC
      LIMIT 10
    `).all({}),
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
    expiring_count: (expiring || []).length,
    recent_sales: recentSales || [],
  }
}

async function dashboardAnalytics(env: Env, query: Record<string, string>) {
  const db = getDb(env)
  const { startDate, endDate, granularity } = dateRange(query)
  const params = { startDate, endDate }
  const filters = { startDate, endDate, branchId: query.branchId || null }
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
      SELECT COUNT(*) AS count, COALESCE(SUM(total_refund_usd), 0) AS refund_usd
      FROM returns
      WHERE date(created_at) BETWEEN date(@startDate) AND date(@endDate)
        AND COALESCE(status, 'completed') <> 'cancelled'
    `).get(params),
    db.prepare(`
      SELECT COUNT(*) AS count, COALESCE(SUM(supplier_compensation_usd), 0) AS supplier_compensation_usd,
             COALESCE(SUM(supplier_loss_usd), 0) AS supplier_loss_usd
      FROM returns
      WHERE date(created_at) BETWEEN date(@startDate) AND date(@endDate)
        AND COALESCE(return_scope, 'customer') = 'supplier'
        AND COALESCE(status, 'completed') <> 'cancelled'
    `).get(params),
    db.prepare(`
      SELECT COALESCE(payment_method, 'Unknown') AS method, COALESCE(payment_method, 'Unknown') AS payment_method,
             COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS revenue_usd
      FROM sales
      WHERE date(created_at) BETWEEN date(@startDate) AND date(@endDate)
        AND COALESCE(sale_status, 'completed') <> 'cancelled'
      GROUP BY COALESCE(payment_method, 'Unknown')
      ORDER BY revenue_usd DESC
    `).all(params),
    db.prepare(`
      SELECT branch_id, COALESCE(branch_name, 'Unassigned') AS branch_name,
             COUNT(*) AS tx_count, COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS revenue_usd
      FROM sales
      WHERE date(created_at) BETWEEN date(@startDate) AND date(@endDate)
        AND COALESCE(sale_status, 'completed') <> 'cancelled'
      GROUP BY branch_id, COALESCE(branch_name, 'Unassigned')
      ORDER BY revenue_usd DESC
    `).all(params),
    db.prepare(`
      SELECT si.product_id, si.product_name, SUM(si.quantity) AS qty_sold, SUM(si.total_usd) AS revenue_usd
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE date(s.created_at) BETWEEN date(@startDate) AND date(@endDate)
        AND COALESCE(s.sale_status, 'completed') <> 'cancelled'
      GROUP BY si.product_id, si.product_name
      ORDER BY revenue_usd DESC
      LIMIT 20
    `).all(params),
    db.prepare(`
      SELECT si.product_id, si.product_name, SUM(si.quantity) AS qty_sold, SUM(si.total_usd) AS revenue_usd
      FROM sale_items si
      JOIN sales s ON s.id = si.sale_id
      WHERE date(s.created_at) BETWEEN date(@startDate) AND date(@endDate)
        AND COALESCE(s.sale_status, 'completed') <> 'cancelled'
      GROUP BY si.product_id, si.product_name
      ORDER BY qty_sold DESC
      LIMIT 20
    `).all(params),
    db.prepare(`
      SELECT COALESCE(customer_name, 'Walk-in') AS customer_name, COUNT(*) AS sale_count,
             COALESCE(SUM(subtotal_usd), 0) AS gross_revenue_usd,
             COALESCE(SUM(discount_usd), 0) AS store_discount_usd,
             COALESCE(SUM(membership_discount_usd), 0) AS membership_discount_usd,
             COALESCE(SUM(subtotal_usd) - SUM(discount_usd) - SUM(membership_discount_usd), 0) AS net_revenue_usd
      FROM sales
      WHERE date(created_at) BETWEEN date(@startDate) AND date(@endDate)
        AND COALESCE(sale_status, 'completed') <> 'cancelled'
      GROUP BY COALESCE(customer_name, 'Walk-in')
      ORDER BY net_revenue_usd DESC
      LIMIT 20
    `).all(params),
    db.prepare(`
      SELECT CAST(strftime('%H', created_at) AS INTEGER) AS hour, COUNT(*) AS count, COALESCE(SUM(total_usd), 0) AS revenue_usd
      FROM sales
      WHERE date(created_at) BETWEEN date(@startDate) AND date(@endDate)
        AND COALESCE(sale_status, 'completed') <> 'cancelled'
      GROUP BY CAST(strftime('%H', created_at) AS INTEGER)
      ORDER BY hour ASC
    `).all(params),
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
  return c.json(await dashboardSummary(c.env))
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
    dashboardSummary(c.env),
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
  const denied = denyUnless(c, 'audit_log')
  if (denied) return denied
  const page = Math.max(1, Number.parseInt(c.req.query('page') || '1', 10) || 1)
  const pageSize = Math.min(200, Math.max(1, Number.parseInt(c.req.query('pageSize') || '50', 10) || 50))
  const offset = (page - 1) * pageSize
  try {
    const db = getDb(c.env)
    const totalRow = await db.prepare('SELECT COUNT(*) AS count FROM audit_logs').get<{ count: number }>()
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
      ORDER BY created_at DESC, id DESC
      LIMIT @pageSize OFFSET @offset
    `).all({ pageSize, offset })
    const users = await db.prepare(`
      SELECT DISTINCT user_id AS id, user_name AS name
      FROM audit_logs
      WHERE user_id IS NOT NULL OR COALESCE(user_name, '') <> ''
      ORDER BY user_name COLLATE NOCASE ASC
    `).all()
    return c.json({
      items: rows || [],
      total: totalRow?.count || 0,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil((totalRow?.count || 0) / pageSize)),
      filters: { users: users || [] },
    })
  } catch (_) {
    return c.json({ items: [], total: 0, page, pageSize, totalPages: 1, filters: { users: [] } })
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
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const db = getDb(c.env)
  const result = await db.prepare("DELETE FROM audit_logs WHERE date(created_at) < @cutoff").run({ cutoff })
  const deleted = (result as any)?.meta?.changes ?? (result as any)?.changes ?? 0
  await audit(c.env, user?.id ?? null, user?.name ?? user?.username ?? null, 'audit_log_retention_delete', 'audit_log', null, { olderThanDays, cutoffDate: cutoff, deleted })
  return c.json({ ok: true, deleted })
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
app.post('/system/drive-sync/oauth/start', requireAuth, (c) => {
  const denied = denyUnless(c, 'settings')
  if (denied) return denied
  const result = buildDriveOauthStartUrl(c.env)
  if (!result.success) return c.json({ error: result.error }, 400)
  return c.json({ url: result.url })
})
app.get('/system/drive-sync/oauth/callback', async (c) => {
  const code = c.req.query('code')
  const error = c.req.query('error')
  const adminUrl = c.env.BUSINESS_OS_ADMIN_URL.replace(/\/$/, '')
  const redirectTarget = `${adminUrl}/?settings=integrations&drive_sync=`
  if (error) {
    return c.html(`<!doctype html><html><body>Google Drive connection was cancelled or denied.<script>setTimeout(function(){location.replace(${JSON.stringify(redirectTarget)}+'error')},400)</script></body></html>`, 400)
  }
  if (!code) {
    return c.html('<!doctype html><html><body>Missing authorization code from Google.</body></html>', 400)
  }
  const result = await completeDriveOauth(c.env, code)
  const status = result.success ? 'connected' : 'error'
  const message = result.success ? 'Google Drive connected. You can close this window.' : (result.error || 'Failed to connect Google Drive.')
  return c.html(`<!doctype html><html><body>${message}<script>try{window.opener&&window.opener.postMessage({type:'business-os-drive-oauth',success:${result.success}},'*')}catch(e){}setTimeout(function(){ if(window.opener){window.close()} else {location.replace(${JSON.stringify(redirectTarget)}+${JSON.stringify(status)})} },400)</script></body></html>`, result.success ? 200 : 400)
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
  const result = await pushBackupToDrive(c.env)
  const job = await storeSystemJob(c.env, {
    id: crypto.randomUUID(),
    status: result.success ? 'completed' : 'failed',
    progress: 100,
    message: result.success ? `Uploaded ${result.fileName} to Google Drive.` : (result.error || 'Google Drive sync failed.'),
    error: result.success ? null : (result.error || 'Google Drive sync failed.'),
  })
  return c.json({ job_id: job.id, item: job }, result.success ? 200 : 400)
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
  const denied = denyUnless(c, 'inventory', 'branches')
  if (denied) return denied
  const rows = await getDb(c.env).prepare(`
    SELECT st.*, b1.name AS from_name, b2.name AS to_name
    FROM stock_transfers st
    LEFT JOIN branches b1 ON b1.id = st.from_branch_id
    LEFT JOIN branches b2 ON b2.id = st.to_branch_id
    ORDER BY st.created_at DESC, st.id DESC
    LIMIT 500
  `).all()
  return c.json(rows || [])
})

export default app
