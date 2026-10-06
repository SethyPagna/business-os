import { Hono } from 'hono'
import type { Env } from '../index'
import { getDb } from '../lib/db'
import { chunkForBinding } from '../lib/sqlBinding'
import { loadLowStockConfig, type LowStockConfig } from '../lib/lowStockSettings'
import { STOCK_ALERT_WINDOW_DAYS, stockAlertFeedSql, type StockAlertFeedRow } from '../lib/saleStockAlerts'
import { cachedJsonResponse, getVersionWithFallback } from '../lib/cache'
import { requireAuth, type SessionUser } from '../lib/auth'
import { getActionTier, hasPermission, hasAnyPermission, isAdminControlUser } from '../lib/permissions'

// Ported from backend/src/routes/notifications.ts. Note what this actually
// is: there is no persisted read/unread state -- `/summary` computes a live
// signal each call (stock alerts, expiry, sales awaiting payment/delivery,
// loyalty threshold reached, pending portal submissions, system/drive-sync
// health) from real business data, gated by per-user permission and
// admin-configured on/off toggles. The Cloudflare version of this endpoint
// was previously a hardcoded stub (`{unread:0, items:[]}`), which is why
// notification badges/counts could look stale or just permanently "off"
// regardless of real inventory/sales state.
//
// The one exception to "live signal" is STOCK (NOTIF-V2, owner 6 Oct 2026):
// those rows are SALE EVENTS read from `stock_alert_events` (migration 0239,
// written by lib/saleStockAlerts.ts inside the sale's own batch), not a
// standing list of every product under its threshold -- that list is the
// Dashboard's Low stock / Out of stock cards, which the bell links to.
//
// Every item is deliberately one short line: a `label` (the thing), a
// structured meta (`metaKey` + `metaParams`, rendered from the language
// packs by the panel; `meta` is only the English fallback for a client that
// has not reloaded) and an optional `at` timestamp the panel formats. The
// link target of each `kind` is resolved on the client
// (frontend/src/utils/notificationTargets.ts) from the ids carried here.
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
  // Part 386 fix: the two supplier-credit keys were read from the map but
  // never LOADED into it (missing from this list since Part 382), so the
  // Settings toggle/window wrote values nothing read back -- defaults
  // always applied.
  'notifications_supplier_credit_enabled',
  'notifications_supplier_credit_days',
  'drive_sync_enabled',
  // Read only to key the loyalty cache entry (buildLoyaltySection still reads the
  // switch itself); never returned to the client.
  'loyalty_points_enabled',
  // Presence-only read: loadPreferences reduces this to a boolean and the
  // token value never leaves that function.
  'drive_sync_refresh_token',
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
  // The panel renders `meta` from the language packs when `metaKey` names an
  // entry in NotificationCenter.tsx's ITEM_META_COPY, and falls back to the
  // English `meta` above when it does not (an older cached bundle, or a row
  // this route has no copy entry for). Keeping both is what lets the wording
  // change without breaking a client that has not reloaded.
  metaKey?: string
  metaParams?: Record<string, unknown>
  /** Raw DB timestamp (UTC) the panel shows as dd/mm/yyyy HH:mm. Omitted when the row has no moment of its own. */
  at?: string
  kind: string
  pageId: string
  // Optional sub-page target within pageId, e.g. 'devices' for the Users
  // page's Devices tab. Frontend-only concern (NotificationCenter passes
  // it through to navigateTo) -- omit when the page has no sub-tabs.
  anchor?: string
  /** Sale this row is about: the panel opens that sale's detail. */
  saleId?: number
  /** Finished import job this row is about: the panel opens its report. */
  importJobId?: string
  /** Text the destination list is searched for (a product, a supplier): lands on that record, not just the list. */
  search?: string
}

type NotificationSection = {
  id: string
  label: string
  pageId: string
  count: number
  summary: string
  /** As `metaKey`/`metaParams` above, against SECTION_SUMMARY_COPY. */
  summaryKey?: string
  summaryParams?: Record<string, unknown>
  items: NotificationItem[]
  // Set only when `items` is a preview: the section's true size and a flag the
  // panel uses to offer "show all" (GET /summary/items?section=<id>). `count`
  // is always the true size, so the bell badge and headline are unaffected.
  itemsTotal?: number
  truncated?: boolean
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
    driveSyncConnected: Boolean(String(map.drive_sync_refresh_token || '').trim()),
    loyaltyPointsEnabled: normalizeBoolean(map.loyalty_points_enabled, true),
  }
}

// The three sections that cost real reads on every call -- inventory and expiry
// each walk every active product, loyalty groups every sale ever made -- are
// answered from the Workers Cache API for a short while, keyed by the data
// versions their inputs live in. Every writer of those inputs already bumps
// the same versions the product/sales/contacts caches use: stock moves bump
// 'products' or 'stock', sales 'sales' (+ 'stock'), returns 'returns', customer
// edits and merges 'customers', settings 'settings'. A bump makes the old entry
// unreachable at once; the TTL is only the backstop for the inputs that have no
// bump (a portal Share & Reward review, the date rolling over for expiry).
// The per-user parts of the summary (which sections this person may see, the
// imports they can open, the security rows) are NOT cached, so nothing here can
// leak across users: the cached value is the same for everyone who is allowed
// to ask for it.
export const NOTIFICATION_SECTION_CACHE_TTL_SECONDS = 45
// Stock events the summary carries. The panel shows these and reaches the rest
// through GET /summary/items; the headline count is exact either way. Ten rows
// is what keeps the bell short after a busy afternoon of sales.
export const STOCK_ALERT_PREVIEW_ITEMS = 10
// What "load more" returns at most -- the whole window of a very busy shop.
export const STOCK_ALERT_FULL_ITEMS = 100

type NotificationContext = { env: Env; req: { url: string; raw: Request }; executionCtx: { waitUntil(promise: Promise<unknown>): void } }

type SectionCache = <T>(name: string, namespaces: string[], inputs: string, producer: () => Promise<T>) => Promise<T>

// One per request: each data version is read once however many sections key on it
// (products, settings and the rest are shared by two or three of them).
function sectionCacheFor(c: NotificationContext): SectionCache {
  const versionReads = new Map<string, Promise<string>>()
  const versionOf = (namespace: string) => {
    let read = versionReads.get(namespace)
    if (!read) {
      read = getVersionWithFallback(c.env, namespace)
      versionReads.set(namespace, read)
    }
    return read
  }
  return async (name, namespaces, inputs, producer) => {
    // No Cache API (a unit-test harness): behave exactly as the uncached route did.
    if (typeof caches === 'undefined') return producer()
    const versions = await Promise.all(namespaces.map(versionOf))
    const version = namespaces.map((namespace, index) => `${namespace}:${versions[index]}`).join('|')
    const request = new Request(`${new URL(c.req.url).origin}/api/notifications/_section/${name}?k=${encodeURIComponent(inputs)}`)
    return cachedJsonResponse(request, c.executionCtx, version, NOTIFICATION_SECTION_CACHE_TTL_SECONDS, producer)
  }
}

function lowStockCacheInput(config: LowStockConfig, includeSale: boolean): string {
  // includeSale is part of the key because the receipt number a stock row names
  // is sales data: the cached rows must never reach someone without sales:view.
  return `${config.enabled ? 1 : 0}:${config.mode}:${config.threshold}:${includeSale ? 1 : 0}:${STOCK_ALERT_WINDOW_DAYS}`
}

// Same instant the SQL window compares against: SQLite's CURRENT_TIMESTAMP text, UTC.
function sqliteUtcDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 19).replace('T', ' ')
}

// The stock section: one row per product family a SALE carried into low stock
// or out of stock lately (lib/saleStockAlerts.ts), newest crossing first with
// out-of-stock ahead of low. A family drops out as soon as it is no longer in
// the state its event announced (restocked, or since worse), so the bell never
// repeats the Dashboard's standing Low stock / Out of stock lists -- it points
// at them. `itemLimit` is how many rows come back; the counts are exact
// window aggregates over every row that passed the filter.
async function buildStockAlertSection(env: Env, config: LowStockConfig, itemLimit: number, includeSale: boolean): Promise<NotificationSection | null> {
  const db = getDb(env)
  const rows = await db.prepare(stockAlertFeedSql(config))
    .all<StockAlertFeedRow>({ since: sqliteUtcDaysAgo(STOCK_ALERT_WINDOW_DAYS), limit: itemLimit })
  if (!rows.length) return null

  const outCount = Number(rows[0].out_total || 0)
  const count = Number(rows[0].matched_total || 0)
  const lowCount = Math.max(0, count - outCount)

  // The link lands on the Dashboard's matching card (anchor 'out-of-stock' /
  // 'low-stock', consumed by Dashboard.tsx); the client falls back to the
  // Branches products list for someone who cannot open the Dashboard.
  const items: NotificationItem[] = rows.map((row) => {
    const out = row.alert_state === 'out'
    const quantity = Number(row.total_now ?? row.quantity_after ?? 0)
    const receipt = includeSale ? row.receipt_number : null
    return {
      id: `stock-${row.id}`,
      tone: out ? 'danger' as const : 'warning' as const,
      label: row.product_name || `#${row.product_id}`,
      meta: out ? 'Out of stock' : `Low stock (${quantity})`,
      metaKey: out ? 'notification_stock_out' : 'notification_stock_low',
      metaParams: { quantity, receipt: receipt || '', branch: row.branch_name || '' },
      at: row.created_at,
      kind: out ? 'inventory_out_of_stock' : 'inventory_low_stock',
      pageId: 'dashboard',
      anchor: out ? 'out-of-stock' : 'low-stock',
      ...(includeSale && row.sale_id ? { saleId: Number(row.sale_id) } : {}),
    }
  })

  return {
    id: 'inventory',
    label: 'Inventory',
    pageId: 'dashboard',
    count,
    summary: joinSummary([
      outCount ? `${outCount} out of stock` : null,
      lowCount ? `${lowCount} low stock` : null,
    ]),
    summaryKey: 'notification_inventory_summary',
    summaryParams: { outCount, lowCount },
    items,
    ...(items.length < count ? { itemsTotal: count, truncated: true } : {}),
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
    const days = Math.abs(daysLeft)
    return {
      id: `expiry-${product.id}`,
      label: product.name,
      meta: daysLeft < 0 ? `Expired ${days}d ago` : `Expires in ${days}d`,
      metaKey: daysLeft < 0 ? 'notification_product_expired' : 'notification_product_expiring',
      metaParams: { days, expiryDate: product.expiry_date || '' },
      kind: daysLeft < 0 ? 'product_expired' : 'product_expiring',
      tone: daysLeft < 0 ? 'danger' as const : 'warning' as const,
      pageId: 'products',
      search: product.name,
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
// (PATCH /api/batches/:id payment_status='paid') clears it from here. So does
// reverting every receipt on the lot: the row keeps 'credit' for a possible
// un-revert, but with nothing received and no money there is nothing owed
// (lib/productBatches.ts planUnreceiveBatchStock; untracked NULL lots stay).
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
      AND (pb.received_quantity IS NULL OR pb.received_quantity > 0 OR COALESCE(pb.received_cost_usd, 0) > 0)
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
    const days = Math.abs(daysLeft)
    return {
      id: `supplier-credit-${row.id}`,
      label: row.product_name,
      meta: daysLeft < 0 ? `Overdue ${days}d` : `Due in ${days}d`,
      metaKey: daysLeft < 0 ? 'notification_credit_overdue' : 'notification_credit_due',
      metaParams: { days, supplier: row.supplier_name || '', dueDate: row.credit_due_date || '' },
      kind: daysLeft < 0 ? 'supplier_credit_overdue' : 'supplier_credit_due',
      tone: daysLeft < 0 ? 'danger' as const : 'warning' as const,
      // Contacts > Suppliers (the retired 'inventory' page id had no route).
      pageId: 'contacts',
      anchor: 'hub:contacts:suppliers',
      ...(row.supplier_name ? { search: row.supplier_name } : {}),
    }
  })
  const dueSoonCount = rows.length - overdueCount

  return {
    id: 'supplier_credit',
    label: 'Supplier credit',
    pageId: 'contacts',
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
      SELECT id, receipt_number, total_usd, created_at FROM sales
      WHERE sale_status = 'awaiting_payment'
      ORDER BY created_at DESC LIMIT 50
    `).all<{ id: number; receipt_number: string; total_usd: number; created_at: string }>(),
    db.prepare(`
      SELECT id, receipt_number, total_usd, created_at FROM sales
      WHERE sale_status = 'awaiting_delivery'
      ORDER BY created_at DESC LIMIT 50
    `).all<{ id: number; receipt_number: string; total_usd: number; created_at: string }>(),
  ])
  if (!awaitingPayment.length && !awaitingDelivery.length) return null

  const items: NotificationItem[] = [
    ...awaitingPayment.map((sale) => ({
      id: `pay-${sale.id}`,
      tone: 'warning' as const,
      label: sale.receipt_number || `Sale #${sale.id}`,
      meta: `Awaiting payment${SUMMARY_SEPARATOR}$${Number(sale.total_usd || 0).toFixed(2)}`,
      metaKey: 'notification_sales_awaiting_payment',
      metaParams: { totalUsd: Number(sale.total_usd || 0).toFixed(2) },
      at: sale.created_at,
      kind: 'sales_awaiting_payment',
      pageId: 'sales',
      saleId: Number(sale.id),
    })),
    ...awaitingDelivery.map((sale) => ({
      id: `delivery-${sale.id}`,
      tone: 'info' as const,
      label: sale.receipt_number || `Sale #${sale.id}`,
      meta: `Awaiting delivery${SUMMARY_SEPARATOR}$${Number(sale.total_usd || 0).toFixed(2)}`,
      metaKey: 'notification_sales_awaiting_delivery',
      metaParams: { totalUsd: Number(sale.total_usd || 0).toFixed(2) },
      at: sale.created_at,
      kind: 'sales_awaiting_delivery',
      pageId: 'sales',
      saleId: Number(sale.id),
    })),
  ]

  return {
    id: 'sales',
    label: 'Sales',
    pageId: 'sales',
    count: awaitingPayment.length + awaitingDelivery.length,
    // Sep 23 2026. This line, and the item lines above, are what the shop
    // actually reads in the bell -- and they were still calling the status
    // "awaiting payment" months after the app renamed it to Not Paid /
    // ប្រាក់ជំពាក់, in English only, because the panel's language hook was
    // never connected to this route. The English strings stay as the
    // fallback for a client that has not reloaded; the keys below are what
    // a current panel renders, from the language packs.
    summary: joinSummary([
      awaitingPayment.length ? `${awaitingPayment.length} awaiting payment` : null,
      awaitingDelivery.length ? `${awaitingDelivery.length} awaiting delivery` : null,
    ]),
    summaryKey: 'notification_sales_summary',
    summaryParams: { awaitingPaymentCount: awaitingPayment.length, awaitingDeliveryCount: awaitingDelivery.length },
    items,
    enabledKey: 'notifications_sales_enabled',
  }
}

async function buildLoyaltySection(env: Env, threshold: number): Promise<NotificationSection | null> {
  const db = getDb(env)
  // Membership points can be switched off shop-wide (settings key `loyalty_points_enabled`).
  // This is the fourth and last site that computes a balance; without the gate the shop keeps
  // getting "N customers reached X+ points" alerts for a programme it has turned off.
  const loyaltySwitch = await db.prepare(`SELECT value FROM settings WHERE key = 'loyalty_points_enabled'`)
    .get<{ value: string }>()
  if (['0', 'false', 'no', 'off'].includes(String(loyaltySwitch?.value ?? '').trim().toLowerCase())) return null
  const [salesRows, returnRows, rewardRows] = await Promise.all([
    db.prepare(`
      SELECT customer_id,
        COALESCE(SUM(CASE WHEN COALESCE(sale_status, 'completed') <> 'awaiting_payment' AND COALESCE(loyalty_accrual, 1) = 1 THEN COALESCE(total_usd, 0) ELSE 0 END), 0) AS sales_usd,
        COALESCE(SUM(COALESCE(membership_points_redeemed, 0)), 0) AS redeemed
      FROM sales
      WHERE customer_id IS NOT NULL AND COALESCE(sale_status, 'completed') <> 'cancelled'
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
      WHERE customer_id IS NOT NULL AND status = 'approved' AND reward_points_voided_at IS NULL
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
    pageId: 'promotions',
    count: matches.length,
    summary: `${matches.length} customer${matches.length === 1 ? '' : 's'} reached ${threshold}+ points`,
    items: matches.slice(0, 50).map((customer) => ({
      id: `loyalty-${customer.id}`,
      tone: 'success' as const,
      label: customer.name,
      meta: `${customer.balance} points`,
      metaKey: 'notification_loyalty_points_balance',
      metaParams: { balance: customer.balance },
      kind: 'loyalty_points_balance',
      pageId: 'promotions',
      anchor: 'hub:promotions:loyalty',
      search: customer.name,
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
      meta: `${job.warning_count} warning${job.warning_count === 1 ? '' : 's'}`,
      metaKey: 'notification_import_warnings',
      metaParams: { count: Number(job.warning_count) || 0 },
      at: job.finished_at || job.created_at,
      kind: 'import_warnings',
      pageId: 'dashboard',
      importJobId: String(job.id),
    })),
  }
}

async function buildPortalSection(env: Env): Promise<NotificationSection | null> {
  const db = getDb(env)
  const rows = await db.prepare(`
    SELECT id, customer_name, membership_number, platform, created_at
    FROM customer_share_submissions
    WHERE status = 'pending'
    ORDER BY created_at DESC LIMIT 50
  `).all<{ id: number; customer_name: string; membership_number: string; platform: string; created_at: string }>()
  if (!rows.length) return null

  return {
    id: 'portal',
    label: 'Website Editor',
    pageId: 'catalog',
    count: rows.length,
    summary: `${rows.length} pending customer submission${rows.length === 1 ? '' : 's'}`,
    items: rows.map((entry) => ({
      id: `portal-${entry.id}`,
      tone: 'info' as const,
      label: entry.customer_name || entry.membership_number || `Submission #${entry.id}`,
      meta: entry.platform ? `Pending review${SUMMARY_SEPARATOR}${entry.platform}` : 'Pending review',
      metaKey: 'notification_portal_pending_review',
      metaParams: { platform: entry.platform || '' },
      at: entry.created_at,
      kind: 'portal_pending_review',
      pageId: 'catalog',
    })),
  }
}

function buildSystemSection(driveSyncEnabled: boolean, driveSyncConnected: boolean): NotificationSection | null {
  // The Drive OAuth flow IS fully implemented (lib/googleDrive.ts +
  // compat.ts's /system/drive-sync/* routes) -- the comment that used to
  // live here claiming it wasn't was STALE, and it hid the exact failure
  // A3 measured in production: with no drive_sync_* settings rows at all
  // (never connected), this section returned null and NO ONE was ever
  // told the off-site mirror wasn't running. Backups are business-
  // critical, so "not connected" is now a standing warning until the
  // admin either connects Drive or has deliberately disabled sync AND
  // been told what that means once.
  if (driveSyncConnected && driveSyncEnabled) return null
  const item = !driveSyncConnected
    ? {
        id: 'system-drive-sync',
        tone: 'warning' as const,
        label: 'Google Drive backup',
        meta: 'Not connected',
        metaKey: 'notification_drive_not_connected',
        kind: 'system_drive_sync_connect',
        // The retired 'backup' page id had no route: Backup is a Settings section.
        pageId: 'settings',
        anchor: 'hub:settings:backup',
      }
    : {
        id: 'system-drive-sync',
        tone: 'warning' as const,
        label: 'Google Drive backup',
        meta: 'Sync is off',
        metaKey: 'notification_drive_sync_off',
        kind: 'system_drive_sync_disabled',
        pageId: 'settings',
        anchor: 'hub:settings:backup',
      }
  return {
    id: 'system',
    label: 'System',
    pageId: 'settings',
    count: 1,
    summary: 'Google Drive backup needs attention',
    items: [item],
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
      meta: `${parsed.previousCountry || '?'} -> ${parsed.newCountry || '?'}`,
      metaKey: 'notification_device_new_country',
      metaParams: { from: parsed.previousCountry || '?', to: parsed.newCountry || '?' },
      at: entry.created_at,
      kind: 'security_device_new_country',
      // Device history lives on the Users > Devices tab (DeviceApprovals.tsx),
      // a section of the Settings hub since E4 (the retired 'users' page id had
      // no route); the panel queues the Devices tab for Users.tsx.
      pageId: 'settings',
      anchor: 'hub:settings:users',
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
      // are on Users > Devices (DeviceApprovals.tsx).
      pageId: 'settings',
      anchor: 'hub:settings:users',
    })),
    ...countryItems,
  ]

  return {
    id: 'security',
    label: 'Security',
    // Section-level fallback pageId, used when an individual item doesn't
    // set its own -- keep this in sync with the items above.
    pageId: 'settings',
    count: items.length,
    summary: rows.length && countryItems.length
      ? `${rows.length} device${rows.length === 1 ? '' : 's'} waiting for approval, ${countryItems.length} new-country sign-in${countryItems.length === 1 ? '' : 's'}`
      : rows.length
        ? `${rows.length} device${rows.length === 1 ? '' : 's'} waiting for approval`
        : `${countryItems.length} sign-in${countryItems.length === 1 ? '' : 's'} from a new country`,
    items,
  }
}

// Stock rows name products and quantities, so they keep the audience the bell has always had: inventory
// access. A Dashboard-only user is NOT widened into them (the Dashboard cards show counts, not this list); the
// panel's link for a person without the Dashboard falls back to the Branches products list.
function canSeeStockAlerts(user: SessionUser): boolean {
  return hasPermission(user, 'inventory')
}

// The sales READ rule (reports.ts, sales.ts canReadSales): a view-only user
// sees receipts, a full user whose sales:view was switched off does not.
function canReadSales(user: SessionUser): boolean {
  return getActionTier(user, 'sales', 'view') !== 'none'
}

app.get('/summary', async (c) => {
  const user = c.get('user')
  // The loyalty switch is a cache-key input only; it is not part of the public preferences object.
  const { loyaltyPointsEnabled, ...preferences } = await loadPreferences(c.env)
  const sections: NotificationSection[] = []
  const cachedSection = sectionCacheFor(c)

  const tasks: Array<Promise<NotificationSection | null>> = []
  if (preferences.inventoryEnabled && canSeeStockAlerts(user)) {
    const lowStockConfig = await loadLowStockConfig(c.env)
    const includeSale = canReadSales(user)
    tasks.push(cachedSection('inventory', ['products', 'stock', 'settings'], lowStockCacheInput(lowStockConfig, includeSale),
      () => buildStockAlertSection(c.env, lowStockConfig, STOCK_ALERT_PREVIEW_ITEMS, includeSale)))
  }
  if (preferences.expiryEnabled && hasPermission(user, 'products')) {
    tasks.push(cachedSection('expiry', ['products', 'settings'], String(preferences.expiryDays),
      () => buildExpirySection(c.env, preferences.expiryDays)))
  }
  // The section lists receipt numbers and totals, so it follows the sales READ rule (reports.ts, sales.ts canReadSales):
  // a view-only user sees it, a full user whose sales:view was switched off does not.
  if (preferences.salesEnabled && canReadSales(user)) tasks.push(buildSalesSection(c.env))
  if (preferences.loyaltyEnabled && hasPermission(user, 'contacts')) {
    tasks.push(cachedSection('loyalty', ['sales', 'returns', 'customers', 'settings'], `${preferences.loyaltyThreshold}:${loyaltyPointsEnabled ? 1 : 0}`,
      () => buildLoyaltySection(c.env, preferences.loyaltyThreshold)))
  }
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
  if (preferences.systemEnabled && hasPermission(user, 'backup')) tasks.push(Promise.resolve(buildSystemSection(preferences.driveSyncEnabled, preferences.driveSyncConnected)))
  // Supplier credit reminders (0065): money owed to suppliers is cost
  // data, and Part 383's supplier-privacy rule keeps that with the people
  // who can act on it — admin-control users only (was: anyone with
  // inventory access; the user asked for "reminder for admin" and for the
  // supplier section to be hidden from employees).
  if (preferences.supplierCreditEnabled && isAdminControlUser(user)) tasks.push(buildSupplierCreditSection(c.env, preferences.supplierCreditDays))
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

// The rest of the stock events behind the panel's "load more". Not part of
// /summary so the poll that runs on every sync broadcast and tab focus stays
// small; the panel asks for this once, on request, and keeps re-asking only
// while it stays expanded.
app.get('/summary/items', async (c) => {
  const user = c.get('user')
  if (String(c.req.query('section') || '') !== 'inventory') return c.json({ error: 'Unknown notification section' }, 404)
  if (!canSeeStockAlerts(user)) return c.json({ error: 'Forbidden' }, 403)
  const { inventoryEnabled } = await loadPreferences(c.env)
  if (!inventoryEnabled) return c.json({ id: 'inventory', count: 0, items: [] })
  const lowStockConfig = await loadLowStockConfig(c.env)
  const includeSale = canReadSales(user)
  const section = await sectionCacheFor(c)('inventory-full', ['products', 'stock', 'settings'], lowStockCacheInput(lowStockConfig, includeSale),
    () => buildStockAlertSection(c.env, lowStockConfig, STOCK_ALERT_FULL_ITEMS, includeSale))
  return c.json({ id: 'inventory', count: section?.count ?? 0, items: section?.items ?? [] })
})

export default app
