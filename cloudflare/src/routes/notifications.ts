import { Hono } from 'hono'
import type { Env } from '../index'
import { getDb } from '../lib/db'
import { chunkForBinding } from '../lib/sqlBinding'
import { requireAuth, type SessionUser } from '../lib/auth'
import { hasPermission, hasAnyPermission, isAdminControlUser } from '../lib/permissions'

// Ported from backend/src/routes/notifications.ts. Note what this actually
// is: there is no persisted "notifications" table with read/unread state --
// `/summary` computes a live signal each call (inventory low-stock/expiry,
// sales awaiting payment/delivery, loyalty threshold reached, pending portal
// submissions, system/drive-sync health) from real business data, gated by
// per-user permission and admin-configured on/off toggles. The Cloudflare
// version of this endpoint was previously a hardcoded stub
// (`{unread:0, items:[]}`), which is why notification badges/counts could
// look stale or just permanently "off" regardless of real inventory/sales
// state.
const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>()
app.use('*', requireAuth)

// D1 (SQLite) caps bound parameters per statement at 100 -- same limit
// documented in routes/contacts.ts's computeCustomerPointsMap. This
// endpoint's loyalty section builds its `customerIds` set from every
// customer who has ever made a sale (no LIMIT), then used to bind the
// whole set into one `id IN (...)` query -- fine for a small shop, but
// any shop with enough customers-with-sales history blew past the cap
// with `D1_ERROR: too many SQL variables ... : SQLITE_ERROR` and took
// the whole `/notifications/summary` request down with it. Chunk the id
// list into batches under the limit and merge, via lib/sqlBinding.ts's
// shared chunkForBinding (contacts.ts uses the same helper).
const NOTIFICATION_SETTING_KEYS = [
  'notifications_inventory_enabled',
  'notifications_sales_enabled',
  'notifications_loyalty_enabled',
  'notifications_portal_enabled',
  'notifications_system_enabled',
  'notifications_expiry_enabled',
  'notifications_expiry_days',
  'notifications_loyalty_threshold',
  'notifications_realert_minutes',
  'drive_sync_enabled',
]
const SUMMARY_SEPARATOR = ' - '

function normalizeBoolean(value: unknown, fallback = true): boolean {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function rowsToSettingMap(rows: Array<{ key: string; value: string }> = []): Record<string, string> {
  const map: Record<string, string> = {}
  for (const row of rows) map[row.key] = row.value
  return map
}

function joinSummary(parts: Array<string | null>): string {
  return parts.filter(Boolean).join(SUMMARY_SEPARATOR)
}

type NotificationItem = {
  id: string
  tone: 'danger' | 'warning' | 'info' | 'success'
  label: string
  meta: string
  kind: string
  pageId: string
  // Optional sub-page target within pageId, e.g. 'devices' for the Users
  // page's Devices tab. Frontend-only concern (NotificationCenter passes
  // it through to navigateTo) -- omit when the page has no sub-tabs.
  anchor?: string
}

type NotificationSection = {
  id: string
  label: string
  pageId: string
  count: number
  summary: string
  items: NotificationItem[]
  // Settings key this section's on/off switch reads and writes (see
  // Settings.tsx's Notifications block and NotificationCenter.tsx's
  // toggleSectionPreference). Sections that can't actually be muted --
  // 'portal' pending-submission approvals and 'security' device alerts,
  // both deliberately un-gated below -- omit this so the panel doesn't
  // render a switch that would silently do nothing when clicked.
  enabledKey?: string
}

async function loadPreferences(env: Env) {
  const db = getDb(env)
  const placeholders = NOTIFICATION_SETTING_KEYS.map(() => '?').join(',')
  const rows = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .all<{ key: string; value: string }>(NOTIFICATION_SETTING_KEYS)
  const map = rowsToSettingMap(rows)
  return {
    inventoryEnabled: normalizeBoolean(map.notifications_inventory_enabled, true),
    salesEnabled: normalizeBoolean(map.notifications_sales_enabled, true),
    loyaltyEnabled: normalizeBoolean(map.notifications_loyalty_enabled, true),
    portalEnabled: normalizeBoolean(map.notifications_portal_enabled, true),
    systemEnabled: normalizeBoolean(map.notifications_system_enabled, true),
    expiryEnabled: normalizeBoolean(map.notifications_expiry_enabled, true),
    supplierCreditEnabled: normalizeBoolean(map.notifications_supplier_credit_enabled, true),
    supplierCreditDays: Math.max(0, Math.min(365, Math.floor(toNumber(map.notifications_supplier_credit_days, 7)))),
    expiryDays: Math.max(0, Math.min(3650, Math.floor(toNumber(map.notifications_expiry_days, 30)))),
    loyaltyThreshold: Math.max(1, Math.floor(toNumber(map.notifications_loyalty_threshold, 100))),
    // Minutes an unresolved alert stays suppressed from the bell badge
    // after the panel is opened (Settings.tsx's "Unresolved alert repeat
    // interval"). Bounded 1-1440 (24h) -- this setting only controls the
    // client-side badge-suppression window (see NotificationCenter.tsx),
    // there is no server-side read/dismissed state to bound here.
    realertMinutes: Math.max(1, Math.min(1440, Math.floor(toNumber(map.notifications_realert_minutes, 10)))),
    driveSyncEnabled: normalizeBoolean(map.drive_sync_enabled, false),
  }
}

async function buildInventorySection(env: Env): Promise<NotificationSection | null> {
  const db = getDb(env)
  const rows = await db.prepare(`
    SELECT id, name, stock_quantity,
      COALESCE(out_of_stock_threshold, 0) AS out_threshold,
      COALESCE(low_stock_threshold, 10) AS low_threshold
    FROM products
    WHERE is_active = 1
      AND COALESCE(stock_quantity, 0) <= COALESCE(low_stock_threshold, 10)
    ORDER BY stock_quantity ASC
    LIMIT 5000
  `).all<{ id: number; name: string; stock_quantity: number; out_threshold: number; low_threshold: number }>()

  const outOfStock = rows.filter((row) => Number(row.stock_quantity || 0) <= Number(row.out_threshold || 0))
  const lowStock = rows.filter((row) => Number(row.stock_quantity || 0) > Number(row.out_threshold || 0))
  if (!rows.length) return null

  // anchor: 'product-<id>' -- lets Inventory.tsx scroll to and briefly
  // highlight this exact row once it lands on the page, instead of just
  // dropping the person on the page with a broad stock-state filter (see
  // Inventory.tsx's `#product-` hash handling). pageId stays 'inventory'
  // either way so a click still works even if the row can't be located
  // (e.g. it was restocked between the notification firing and the click).
  const items: NotificationItem[] = [
    ...outOfStock.slice(0, 5000).map((product) => ({
      id: `out-${product.id}`,
      tone: 'danger' as const,
      label: product.name,
      meta: 'Out of stock',
      kind: 'inventory_out_of_stock',
      pageId: 'inventory',
      anchor: `product-${product.id}`,
    })),
    ...lowStock.slice(0, 5000).map((product) => ({
      id: `low-${product.id}`,
      tone: 'warning' as const,
      label: product.name,
      meta: `Low stock (${Number(product.stock_quantity || 0)})`,
      kind: 'inventory_low_stock',
      pageId: 'inventory',
      anchor: `product-${product.id}`,
    })),
  ]

  return {
    id: 'inventory',
    label: 'Inventory',
    pageId: 'inventory',
    count: outOfStock.length + lowStock.length,
    summary: joinSummary([
      outOfStock.length ? `${outOfStock.length} out of stock` : null,
      lowStock.length ? `${lowStock.length} low stock` : null,
    ]),
    items,
    enabledKey: 'notifications_inventory_enabled',
  }
}

async function buildExpirySection(env: Env, days: number): Promise<NotificationSection | null> {
  const db = getDb(env)
  const rows = await db.prepare(`
    SELECT id, name, expiry_date,
      CAST(julianday(expiry_date) - julianday('now') AS INTEGER) AS days_until_expiry
    FROM products
    WHERE is_active = 1
      AND expiry_date IS NOT NULL
      AND trim(expiry_date) != ''
      AND julianday(expiry_date) - julianday('now') <= @days
    ORDER BY expiry_date ASC
    LIMIT 50
  `).all<{ id: number; name: string; expiry_date: string; days_until_expiry: number }>({ days })
  if (!rows.length) return null

  let expiredCount = 0
  const items: NotificationItem[] = rows.map((product) => {
    const daysLeft = Number(product.days_until_expiry || 0)
    if (daysLeft < 0) expiredCount += 1
    return {
      id: `expiry-${product.id}`,
      label: product.name,
      meta: daysLeft < 0
        ? `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago`
        : `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      kind: daysLeft < 0 ? 'product_expired' : 'product_expiring',
      tone: daysLeft < 0 ? 'danger' as const : 'warning' as const,
      pageId: 'products',
    }
  })
  const expiringCount = rows.length - expiredCount

  return {
    id: 'expiry',
    label: 'Product expiry',
    pageId: 'products',
    count: rows.length,
    summary: joinSummary([
      expiredCount ? `${expiredCount} expired` : null,
      expiringCount ? `${expiringCount} expiring within ${days} days` : null,
    ]),
    items,
    enabledKey: 'notifications_expiry_enabled',
  }
}

// Supplier credit reminders (migration 0065; user, Aug 28): a batch received
// ON CREDIT carries a due date exactly so the admin is reminded — overdue
// first, then anything due within the window. Marking the batch paid
// (PATCH /api/batches/:id payment_status='paid') clears it from here.
async function buildSupplierCreditSection(env: Env, days: number): Promise<NotificationSection | null> {
  const db = getDb(env)
  const rows = await db.prepare(`
    SELECT pb.id, pb.credit_due_date, pb.supplier_name, pb.lot_code, pb.unit_cost_usd,
      p.name AS product_name,
      CAST(julianday(pb.credit_due_date) - julianday('now') AS INTEGER) AS days_until_due
    FROM product_batches pb
    JOIN products p ON p.id = pb.variant_product_id
    WHERE pb.is_active = 1
      AND pb.payment_status = 'credit'
      AND pb.credit_due_date IS NOT NULL AND trim(pb.credit_due_date) != ''
      AND julianday(pb.credit_due_date) - julianday('now') <= @days
    ORDER BY pb.credit_due_date ASC
    LIMIT 50
  `).all<{ id: number; credit_due_date: string; supplier_name: string | null; lot_code: string | null; unit_cost_usd: number | null; product_name: string; days_until_due: number }>({ days })
  if (!rows.length) return null

  let overdueCount = 0
  const items: NotificationItem[] = rows.map((row) => {
    const daysLeft = Number(row.days_until_due || 0)
    if (daysLeft < 0) overdueCount += 1
    const who = row.supplier_name || 'supplier'
    return {
      id: `supplier-credit-${row.id}`,
      label: `${who} — ${row.product_name}${row.lot_code ? ` (${row.lot_code})` : ''}`,
      meta: daysLeft < 0
        ? `Overdue ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} — due ${row.credit_due_date}`
        : `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${row.credit_due_date})`,
      kind: daysLeft < 0 ? 'supplier_credit_overdue' : 'supplier_credit_due',
      tone: daysLeft < 0 ? 'danger' as const : 'warning' as const,
      pageId: 'inventory',
    }
  })
  const dueSoonCount = rows.length - overdueCount

  return {
    id: 'supplier_credit',
    label: 'Supplier credit',
    pageId: 'inventory',
    count: rows.length,
    summary: joinSummary([
      overdueCount ? `${overdueCount} overdue` : null,
      dueSoonCount ? `${dueSoonCount} due within ${days} days` : null,
    ]),
    items,
    enabledKey: 'notifications_supplier_credit_enabled',
  }
}

async function buildSalesSection(env: Env): Promise<NotificationSection | null> {
  const db = getDb(env)
  const [awaitingPayment, awaitingDelivery] = await Promise.all([
    db.prepare(`
      SELECT id, receipt_number, total_usd FROM sales
      WHERE COALESCE(sale_status, 'completed') = 'awaiting_payment'
      ORDER BY created_at DESC LIMIT 50
    `).all<{ id: number; receipt_number: string; total_usd: number }>(),
    db.prepare(`
      SELECT id, receipt_number, total_usd FROM sales
      WHERE COALESCE(sale_status, 'completed') = 'awaiting_delivery'
      ORDER BY created_at DESC LIMIT 50
    `).all<{ id: number; receipt_number: string; total_usd: number }>(),
  ])
  if (!awaitingPayment.length && !awaitingDelivery.length) return null

  const items: NotificationItem[] = [
    ...awaitingPayment.map((sale) => ({
      id: `pay-${sale.id}`,
      tone: 'warning' as const,
      label: sale.receipt_number || `Sale #${sale.id}`,
      meta: `Awaiting payment${SUMMARY_SEPARATOR}$${Number(sale.total_usd || 0).toFixed(2)}`,
      kind: 'sales_awaiting_payment',
      pageId: 'sales',
    })),
    ...awaitingDelivery.map((sale) => ({
      id: `delivery-${sale.id}`,
      tone: 'info' as const,
      label: sale.receipt_number || `Sale #${sale.id}`,
      meta: `Awaiting delivery${SUMMARY_SEPARATOR}$${Number(sale.total_usd || 0).toFixed(2)}`,
      kind: 'sales_awaiting_delivery',
      pageId: 'sales',
    })),
  ]

  return {
    id: 'sales',
    label: 'Sales',
    pageId: 'sales',
    count: awaitingPayment.length + awaitingDelivery.length,
    summary: joinSummary([
      awaitingPayment.length ? `${awaitingPayment.length} awaiting payment` : null,
      awaitingDelivery.length ? `${awaitingDelivery.length} awaiting delivery` : null,
    ]),
    items,
    enabledKey: 'notifications_sales_enabled',
  }
}

async function buildLoyaltySection(env: Env, threshold: number): Promise<NotificationSection | null> {
  const db = getDb(env)
  const [salesRows, returnRows, rewardRows] = await Promise.all([
    db.prepare(`
      SELECT customer_id,
        COALESCE(SUM(CASE WHEN COALESCE(loyalty_accrual, 1) = 1 THEN COALESCE(total_usd, 0) ELSE 0 END), 0) AS sales_usd,
        COALESCE(SUM(COALESCE(membership_points_redeemed, 0)), 0) AS redeemed
      FROM sales
      WHERE customer_id IS NOT NULL AND COALESCE(sale_status, 'completed') NOT IN ('cancelled', 'awaiting_payment')
      GROUP BY customer_id
    `).all<{ customer_id: number; sales_usd: number; redeemed: number }>(),
    db.prepare(`
      SELECT customer_id, COALESCE(SUM(COALESCE(total_refund_usd, 0)), 0) AS refunds_usd
      FROM returns
      WHERE customer_id IS NOT NULL AND COALESCE(status, 'completed') != 'cancelled'
        AND COALESCE(return_scope, 'customer') != 'supplier'
      GROUP BY customer_id
    `).all<{ customer_id: number; refunds_usd: number }>(),
    db.prepare(`
      SELECT customer_id, COALESCE(SUM(COALESCE(reward_points, 0)), 0) AS rewarded
      FROM customer_share_submissions
      WHERE customer_id IS NOT NULL AND status = 'approved'
      GROUP BY customer_id
    `).all<{ customer_id: number; rewarded: number }>(),
  ])
  if (!salesRows.length) return null

  const salesMap = new Map(salesRows.map((row) => [Number(row.customer_id), row]))
  const returnsMap = new Map(returnRows.map((row) => [Number(row.customer_id), row]))
  const rewardsMap = new Map(rewardRows.map((row) => [Number(row.customer_id), row]))
  const customerIds = new Set<number>([
    ...salesMap.keys(), ...returnsMap.keys(), ...rewardsMap.keys(),
  ])
  if (!customerIds.size) return null

  const idChunks = chunkForBinding([...customerIds])
  const customerRows: Array<{ id: number; name: string }> = []
  for (const idChunk of idChunks) {
    const placeholders = idChunk.map(() => '?').join(',')
    const chunkRows = await db.prepare(`SELECT id, name FROM customers WHERE id IN (${placeholders})`)
      .all<{ id: number; name: string }>(idChunk)
    customerRows.push(...chunkRows)
  }
  const nameMap = new Map(customerRows.map((row) => [Number(row.id), row.name]))

  const matches = [...customerIds].map((customerId) => {
    const earned = Number(salesMap.get(customerId)?.sales_usd || 0)
    const redeemed = Number(salesMap.get(customerId)?.redeemed || 0)
    const deducted = Number(returnsMap.get(customerId)?.refunds_usd || 0)
    const rewarded = Number(rewardsMap.get(customerId)?.rewarded || 0)
    const balance = Math.max(0, earned - deducted - redeemed + rewarded)
    return { id: customerId, name: nameMap.get(customerId) || `Customer #${customerId}`, balance: Number(balance.toFixed(2)) }
  }).filter((match) => match.balance >= threshold)
    .sort((left, right) => right.balance - left.balance)
  if (!matches.length) return null

  return {
    id: 'loyalty',
    label: 'Loyalty',
    pageId: 'loyalty_points',
    count: matches.length,
    summary: `${matches.length} customer${matches.length === 1 ? '' : 's'} reached ${threshold}+ points`,
    items: matches.slice(0, 50).map((customer) => ({
      id: `loyalty-${customer.id}`,
      tone: 'success' as const,
      label: customer.name,
      meta: `${customer.balance} points`,
      kind: 'loyalty_points_balance',
      pageId: 'loyalty_points',
    })),
    enabledKey: 'notifications_loyalty_enabled',
  }
}

// Same type -> permission mapping as importJobs.ts's permissionForType
// (not exported from there, small enough to keep in sync locally) -- a
// user without 'sales' shouldn't see a notification about a sales import's
// warnings, etc.
function importPermissionForType(type: string): string {
  const normalized = String(type || 'products').trim().toLowerCase()
  if (['customers', 'suppliers', 'delivery_contacts'].includes(normalized)) return 'contacts'
  if (normalized === 'inventory') return 'inventory'
  if (normalized === 'sales') return 'sales'
  return 'products'
}

// Import completion used to be entirely invisible outside the moment the
// tracker widget happened to be on screen -- dismiss that pill (or just
// navigate away before it finishes) and there was no other trace that an
// import had warnings worth reviewing. This surfaces recently-finished
// imports with unresolved warnings here too, so it's discoverable the same
// way low stock or pending portal submissions are. Scoped to the last 2
// days (long enough to catch "I ran this yesterday and forgot", short
// enough that it doesn't turn into a permanent nag for an import someone
// already looked at via the Dashboard's own warnings card) and to the
// user's permitted import types.
async function buildImportsSection(env: Env, user: SessionUser): Promise<NotificationSection | null> {
  const db = getDb(env)
  const rows = await db.prepare(`
    SELECT id, type, status, warning_count, created_at, finished_at
    FROM import_jobs
    WHERE warning_count > 0
      AND status IN ('completed', 'completed_with_errors')
      AND COALESCE(finished_at, updated_at) > datetime('now', '-2 days')
    ORDER BY COALESCE(finished_at, updated_at) DESC
    LIMIT 50
  `).all<{ id: string; type: string; status: string; warning_count: number; created_at: string; finished_at: string | null }>()

  const visible = rows.filter((row) => hasPermission(user, importPermissionForType(row.type)))
  if (!visible.length) return null

  return {
    id: 'imports',
    label: 'Imports',
    pageId: 'dashboard',
    count: visible.length,
    summary: `${visible.length} recent import${visible.length === 1 ? '' : 's'} with warnings to review`,
    items: visible.slice(0, 20).map((job) => ({
      id: `import-${job.id}`,
      tone: job.status === 'completed_with_errors' ? 'danger' as const : 'warning' as const,
      label: `${String(job.type || 'products').replaceAll('_', ' ')} import`,
      meta: `${job.warning_count} warning${job.warning_count === 1 ? '' : 's'}${SUMMARY_SEPARATOR}review before trusting the result`,
      kind: 'import_warnings',
      pageId: 'dashboard',
    })),
  }
}

async function buildPortalSection(env: Env): Promise<NotificationSection | null> {
  const db = getDb(env)
  const rows = await db.prepare(`
    SELECT id, customer_name, membership_number, platform
    FROM customer_share_submissions
    WHERE status = 'pending'
    ORDER BY created_at DESC LIMIT 50
  `).all<{ id: number; customer_name: string; membership_number: string; platform: string }>()
  if (!rows.length) return null

  return {
    id: 'portal',
    label: 'Customer portal',
    pageId: 'catalog',
    count: rows.length,
    summary: `${rows.length} pending customer submission${rows.length === 1 ? '' : 's'}`,
    items: rows.map((entry) => ({
      id: `portal-${entry.id}`,
      tone: 'info' as const,
      label: entry.customer_name || entry.membership_number || `Submission #${entry.id}`,
      meta: entry.platform ? `Pending review${SUMMARY_SEPARATOR}${entry.platform}` : 'Pending review',
      kind: 'portal_pending_review',
      pageId: 'catalog',
    })),
  }
}

function buildSystemSection(driveSyncEnabled: boolean): NotificationSection | null {
  // Real Google Drive OAuth isn't implemented on Cloudflare yet (see
  // PORTING_STATUS.md), so a connection can never actually be "connected" --
  // only surface this if the admin has turned sync on, matching the legacy
  // "enabled but no refresh token" condition.
  if (!driveSyncEnabled) return null
  return {
    id: 'system',
    label: 'System',
    pageId: 'backup',
    count: 1,
    summary: 'Google Drive sync needs attention',
    items: [{
      id: 'system-drive-sync',
      tone: 'warning',
      label: 'Google Drive sync',
      meta: 'Reconnect Google Drive to resume sync',
      kind: 'system_drive_sync_reconnect',
      pageId: 'backup',
    }],
    enabledKey: 'notifications_system_enabled',
  }
}

async function buildDeviceApprovalSection(env: Env): Promise<NotificationSection | null> {
  const db = getDb(env)
  // Pending-device rows are no longer produced by anything: the login gate
  // that used to create them (requiresDeviceApproval in lib/deviceTrust.ts)
  // is permanently off, so `status = 'pending'` rows left in this table are
  // stale/legacy -- surfacing them as "awaiting admin approval" is
  // misleading (there is no login actually waiting on that decision, for
  // admin or anyone else). Intentionally not querying for them here.
  const rows: Array<{ id: number; device_name: string | null; user_agent: string | null; requested_at: string; username: string; user_name: string }> = []

  // Devices that are already approved don't need another approval decision,
  // but a login from a country that doesn't match this device's history is
  // still worth surfacing -- e.g. a stolen session cookie or SIM-swapped
  // OTP replayed from elsewhere would sail through the approval gate
  // (it's not a *new* device) and otherwise leave no visible trace short of
  // reading the raw audit log. lib/deviceTrust.ts writes a
  // 'device_login_new_country' audit row the moment this happens; surface
  // the last day of them here rather than requiring an admin to think to
  // go look for it.
  const countryAlerts = await db.prepare(`
    SELECT id, user_id, user_name, details, created_at
    FROM audit_logs
    WHERE action = 'device_login_new_country' AND created_at > datetime('now', '-1 day')
    ORDER BY created_at DESC LIMIT 20
  `).all<{ id: number; user_id: number | null; user_name: string | null; details: string | null; created_at: string }>()

  if (!rows.length && !countryAlerts.length) return null

  const countryItems = countryAlerts.map((entry) => {
    let parsed: { deviceName?: string | null; previousCountry?: string; newCountry?: string } = {}
    try { parsed = entry.details ? JSON.parse(entry.details) : {} } catch (_) { /* malformed details -- fall back to generic copy below */ }
    return {
      id: `device-country-${entry.id}`,
      tone: 'warning' as const,
      label: parsed.deviceName || `Device for user #${entry.user_id ?? '?'}`,
      meta: `Sign-in moved from ${parsed.previousCountry || 'an unknown country'} to ${parsed.newCountry || 'an unknown country'}${SUMMARY_SEPARATOR}already-approved device`,
      kind: 'security_device_new_country',
      // Device history lives on the Users > Devices tab (DeviceApprovals.tsx),
      // not Settings -- there is nothing about devices on the Settings page.
      pageId: 'users',
      anchor: 'devices',
    }
  })

  const items = [
    ...rows.map((entry) => ({
      id: `device-${entry.id}`,
      tone: 'warning' as const,
      label: entry.device_name || `New device for ${entry.user_name || entry.username}`,
      meta: `Sign-in for ${entry.username}${SUMMARY_SEPARATOR}awaiting admin approval`,
      kind: 'security_device_pending',
      // Same reasoning as countryItems above: the approve/decline controls
      // are on Users > Devices (DeviceApprovals.tsx), not Settings.
      pageId: 'users',
      anchor: 'devices',
    })),
    ...countryItems,
  ]

  return {
    id: 'security',
    label: 'Security',
    // Section-level fallback pageId, used when an individual item doesn't
    // set its own -- keep this in sync with the items above.
    pageId: 'users',
    count: items.length,
    summary: rows.length && countryItems.length
      ? `${rows.length} device${rows.length === 1 ? '' : 's'} waiting for approval, ${countryItems.length} new-country sign-in${countryItems.length === 1 ? '' : 's'}`
      : rows.length
        ? `${rows.length} device${rows.length === 1 ? '' : 's'} waiting for approval`
        : `${countryItems.length} sign-in${countryItems.length === 1 ? '' : 's'} from a new country`,
    items,
  }
}

app.get('/summary', async (c) => {
  const user = c.get('user')
  const preferences = await loadPreferences(c.env)
  const sections: NotificationSection[] = []

  const tasks: Array<Promise<NotificationSection | null>> = []
  if (preferences.inventoryEnabled && hasPermission(user, 'inventory')) tasks.push(buildInventorySection(c.env))
  if (preferences.expiryEnabled && hasPermission(user, 'products')) tasks.push(buildExpirySection(c.env, preferences.expiryDays))
  if (preferences.salesEnabled && hasPermission(user, 'sales')) tasks.push(buildSalesSection(c.env))
  if (preferences.loyaltyEnabled && hasPermission(user, 'contacts')) tasks.push(buildLoyaltySection(c.env, preferences.loyaltyThreshold))
  // Pending Share & Reward submissions are an approve/reject queue (an
  // admin decision awards or denies real loyalty points), not an
  // informational notice -- so, like the security/device section below,
  // this is deliberately NOT gated behind `preferences.portalEnabled`.
  // Muting "customer portal" notifications used to also hide these,
  // meaning submissions could sit unreviewed indefinitely with no other
  // surface showing them and no way for the admin to know they'd been
  // silently suppressed by their own earlier mute choice.
  if (hasPermission(user, 'customer_portal')) tasks.push(buildPortalSection(c.env))
  if (hasAnyPermission(user, ['products', 'contacts', 'inventory', 'sales'])) tasks.push(buildImportsSection(c.env, user))
  if (preferences.systemEnabled && hasPermission(user, 'backup')) tasks.push(Promise.resolve(buildSystemSection(preferences.driveSyncEnabled)))
  // Supplier credit reminders (0065): admin-facing money obligations —
  // gated on inventory access like the other stock sections.
  if (preferences.supplierCreditEnabled && hasPermission(user, 'inventory')) tasks.push(buildSupplierCreditSection(c.env, preferences.supplierCreditDays))
  // Device approvals: RE-REGISTERED (Part 382). The comment that used to
  // live here said the login gate was "fully disabled" and this section was
  // deliberately unused — that record was STALE: requiresDeviceApproval is
  // live for every non-admin account (auth.ts calls it at login, and the
  // Aug-28 3-device cap builds on it), and the Aug-28 clean-slate wiped all
  // trusted devices, so every employee's next login sits PENDING until an
  // admin approves it. Without this section, nothing surfaced those pending
  // devices and people were silently locked out. Admin-control users only —
  // they are the ones who can act on it.
  if (isAdminControlUser(user)) tasks.push(buildDeviceApprovalSection(c.env))

  const results = await Promise.all(tasks)
  for (const section of results) if (section) sections.push(section)
  // Device approve/reject/revoke requests are the highest-priority queue --
  // an admin missing a pending device means someone is locked out (or worse,
  // an unapproved device sits unreviewed). Always surface the 'security'
  // section first regardless of task-array order above, so it's the first
  // thing an admin sees when they open the panel.
  sections.sort((a, b) => (a.id === 'security' ? -1 : b.id === 'security' ? 1 : 0))

  const unreadCount = sections.reduce((total, section) => total + Number(section.count || 0), 0)

  return c.json({
    unreadCount,
    unread: unreadCount,
    generatedAt: new Date().toISOString(),
    preferences,
    sections,
  })
})

export default app
