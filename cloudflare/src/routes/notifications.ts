import { Hono } from 'hono'
import type { Env } from '../index'
import { getDb } from '../lib/db'
import { stockVisibleProductSql } from '../lib/productStockGuard'
import { buildPortalConfig, createPointsAccumulator, accumulatePoints, summarizePointTotals, type PointsAccumulator, type PointsLedger } from './portal'
import { getPlanLimits } from '../lib/planTier'
import { requestMetricsOf } from '../lib/requestMetrics'
import { loadLowStockConfig, lowStockThresholdSql, type LowStockConfig } from '../lib/lowStockSettings'
import { cachedJsonResponse, getVersionWithFallback } from '../lib/cache'
import { requireAuth, type SessionUser } from '../lib/auth'
import { getActionTier, hasPermission, hasAnyPermission, isAdminControlUser } from '../lib/permissions'

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

// dd/mm/yyyy for user-facing date text -- the whole app shows this format
// by request (Aug 25 numeric-everywhere, day-first since Sep 4 2026). Pure
// string reorder, no Date parsing (a bare date parses as UTC midnight and
// can shift a day).
function formatDateDmy(value: unknown): string {
  const match = String(value ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value ?? '')
}

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
// Rows the summary carries per inventory section. The panel pages client-side
// and reaches the rest through GET /summary/items; the headline count is exact
// either way.
export const INVENTORY_PREVIEW_ITEMS = 50
// What the full list was capped at before the preview existed.
export const INVENTORY_FULL_ITEMS = 5000

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

function lowStockCacheInput(config: LowStockConfig): string {
  return `${config.enabled ? 1 : 0}:${config.mode}:${config.threshold}`
}

// `itemLimit` is how many rows come back (the section's `count` is always the
// exact size). The totals ride on the same single pass as window aggregates, so
// asking for 50 rows reads the catalog once, exactly as asking for 5,000 did --
// it just stops shipping 4,950 rows nobody scrolled to.
async function buildInventorySection(env: Env, config: LowStockConfig, itemLimit: number): Promise<NotificationSection | null> {
  const db = getDb(env)
  const lowThresholdSql = lowStockThresholdSql(config, 'low_stock_threshold')
  // The OR is what keeps OUT-OF-STOCK alive when the owner switches the
  // low-quantity alert off. With the alert off the low fragment is -1, and
  // this one query fetches BOTH tiers -- so a single `qty <= low` filter
  // would have silently taken the out-of-stock rows down with the low ones,
  // which is not what a low-QUANTITY switch means.
  // Out-of-stock rows list first (then fewest-in-stock first), the same order
  // the two-array split of the old ORDER BY stock_quantity produced.
  const rows = await db.prepare(`
    SELECT id, name, stock_quantity,
      CASE WHEN COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0) THEN 1 ELSE 0 END AS is_out,
      SUM(CASE WHEN COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0) THEN 1 ELSE 0 END) OVER () AS out_total,
      COUNT(*) OVER () AS flagged_total
    FROM products p
    WHERE ${stockVisibleProductSql()}
      AND (COALESCE(stock_quantity, 0) <= ${lowThresholdSql}
           OR COALESCE(stock_quantity, 0) <= COALESCE(out_of_stock_threshold, 0))
    ORDER BY is_out DESC, stock_quantity ASC, name ASC, id ASC
    LIMIT @itemLimit
  `).all<{ id: number; name: string; stock_quantity: number; is_out: number; out_total: number; flagged_total: number }>({ itemLimit })
  if (!rows.length) return null

  const outCount = Number(rows[0].out_total || 0)
  const lowCount = Math.max(0, Number(rows[0].flagged_total || 0) - outCount)
  const count = outCount + lowCount

  // anchor: 'product-<id>' -- lets Inventory.tsx scroll to and briefly
  // highlight this exact row once it lands on the page, instead of just
  // dropping the person on the page with a broad stock-state filter (see
  // Inventory.tsx's `#product-` hash handling). pageId stays 'inventory'
  // either way so a click still works even if the row can't be located
  // (e.g. it was restocked between the notification firing and the click).
  const items: NotificationItem[] = rows.map((product) => (Number(product.is_out) === 1
    ? {
        id: `out-${product.id}`,
        tone: 'danger' as const,
        label: product.name,
        meta: 'Out of stock',
        kind: 'inventory_out_of_stock',
        pageId: 'inventory',
        anchor: `product-${product.id}`,
      }
    : {
        id: `low-${product.id}`,
        tone: 'warning' as const,
        label: product.name,
        meta: `Low stock (${Number(product.stock_quantity || 0)})`,
        kind: 'inventory_low_stock',
        pageId: 'inventory',
        anchor: `product-${product.id}`,
      }))

  return {
    id: 'inventory',
    label: 'Inventory',
    pageId: 'inventory',
    count,
    summary: joinSummary([
      outCount ? `${outCount} out of stock` : null,
      lowCount ? `${lowCount} low stock` : null,
    ]),
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
    FROM products p
    WHERE ${stockVisibleProductSql()}
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
    const who = row.supplier_name || 'supplier'
    return {
      id: `supplier-credit-${row.id}`,
      label: `${who} — ${row.product_name}${row.lot_code ? ` (${row.lot_code})` : ''}`,
      meta: daysLeft < 0
        ? `Overdue ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} — due ${formatDateDmy(row.credit_due_date)}`
        : `Due in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${formatDateDmy(row.credit_due_date)})`,
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
      WHERE sale_status = 'awaiting_payment'
      ORDER BY created_at DESC LIMIT 50
    `).all<{ id: number; receipt_number: string; total_usd: number }>(),
    db.prepare(`
      SELECT id, receipt_number, total_usd FROM sales
      WHERE sale_status = 'awaiting_delivery'
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
      metaKey: 'notification_sales_awaiting_payment',
      metaParams: { totalUsd: Number(sale.total_usd || 0).toFixed(2) },
      kind: 'sales_awaiting_payment',
      pageId: 'sales',
    })),
    ...awaitingDelivery.map((sale) => ({
      id: `delivery-${sale.id}`,
      tone: 'info' as const,
      label: sale.receipt_number || `Sale #${sale.id}`,
      meta: `Awaiting delivery${SUMMARY_SEPARATOR}$${Number(sale.total_usd || 0).toFixed(2)}`,
      metaKey: 'notification_sales_awaiting_delivery',
      metaParams: { totalUsd: Number(sale.total_usd || 0).toFixed(2) },
      kind: 'sales_awaiting_delivery',
      pageId: 'sales',
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

class LoyaltyReadBudgetError extends Error {}

async function buildLoyaltySection(env: Env, threshold: number, statementsUsed: () => number): Promise<NotificationSection | null> {
  const db = getDb(env)
  const settings = await db.prepare(`SELECT key, value FROM settings WHERE key IN (
    'loyalty_points_enabled', 'customer_portal_points_basis', 'customer_portal_points_per_usd',
    'customer_portal_points_per_khr', 'exchange_rate'
  )`).all<{ key: string; value: string }>()
  const config = buildPortalConfig(rowsToSettingMap(settings), env)
  if (!config.loyaltyPointsEnabled) return null
  const pageSize = 500
  const limits = getPlanLimits(env)
  const rowLimit = limits.tier === 'free' ? 10_000 : 100_000
  const reserve = 2
  const initial = statementsUsed()
  let localReads = 0
  const used = () => Math.max(initial + localReads, statementsUsed())
  const refuse = (): never => {
    throw new LoyaltyReadBudgetError('The complete loyalty notification read exceeds this request budget.')
  }
  async function readRows<T>(sql: string, params?: Record<string, unknown> | unknown[]): Promise<T[]> {
    if (used() + 1 + reserve > limits.d1QueriesPerInvocation) refuse()
    localReads++
    const statement = db.prepare(sql)
    return statement.allOnce ? statement.allOnce<T>(params) : statement.all<T>(params)
  }
  const ledgers: Array<{ kind: PointsLedger; table: string; columns: string; predicate: string }> = [
    { kind: 'sales', table: 'sales', columns: 'sale_status,total_usd,total_khr,membership_points_redeemed,loyalty_accrual', predicate: "COALESCE(sale_status,'completed') <> 'cancelled'" },
    { kind: 'returns', table: 'returns', columns: 'status,total_refund_usd,total_refund_khr', predicate: "COALESCE(status,'completed') <> 'cancelled' AND COALESCE(return_scope,'customer') <> 'supplier'" },
    { kind: 'submissions', table: 'customer_share_submissions', columns: 'status,reward_points', predicate: "status = 'approved' AND reward_points_voided_at IS NULL" },
    { kind: 'adjustments', table: 'loyalty_point_adjustments', columns: 'points', predicate: 'voided_at IS NULL' },
  ]
  const counts = await readRows<{ kind: PointsLedger; count: number }>(ledgers.map(ledger =>
    `SELECT /* loyalty-ledger */ '${ledger.kind}' kind,COUNT(*) count FROM ${ledger.table} WHERE customer_id IS NOT NULL AND ${ledger.predicate}`).join(' UNION ALL '))
  const countMap = new Map(counts.map(row => [row.kind, Number(row.count)]))
  const totalRows = counts.reduce((total, row) => total + Number(row.count), 0)
  if (!totalRows) return null
  const plannedReads = counts.reduce((total, row) => total + (Number(row.count) ? Math.floor(Number(row.count) / pageSize) + 1 : 0), 1)
  if (totalRows > rowLimit || used() + plannedReads + reserve > limits.d1QueriesPerInvocation) refuse()
  const totalsByCustomer = new Map<number, PointsAccumulator>()
  let walked = 0
  for (const ledger of ledgers) {
    if (!countMap.get(ledger.kind)) continue
    let cursor = 0
    for (;;) {
      const rows = await readRows<Record<string, unknown>>(`SELECT /* loyalty-ledger */ id,customer_id,${ledger.columns}
        FROM ${ledger.table} WHERE id > @cursor AND customer_id IS NOT NULL AND ${ledger.predicate}
        ORDER BY id ASC LIMIT @pageSize`, { cursor, pageSize })
      walked += rows.length
      if (walked > rowLimit) refuse()
      for (const row of rows) {
        const id = Number(row.customer_id)
        let totals = totalsByCustomer.get(id)
        if (!totals) { totals = createPointsAccumulator(); totalsByCustomer.set(id, totals) }
        accumulatePoints(totals, ledger.kind, row, config)
      }
      if (rows.length < pageSize) break
      cursor = Number(rows[rows.length - 1].id)
    }
  }
  const matches = [...totalsByCustomer].map(([id, totals]) => ({ id, balance: summarizePointTotals(totals, config).balance }))
    .filter(match => match.balance >= threshold)
    .sort((left, right) => right.balance - left.balance || left.id - right.id)
  if (!matches.length) return null
  const preview = matches.slice(0, 50)
  const placeholders = preview.map(() => '?').join(',')
  const customerRows = await readRows<{ id: number; name: string }>(`SELECT id, name FROM customers WHERE id IN (${placeholders})`, preview.map(customer => customer.id))
  const nameMap = new Map(customerRows.map(row => [Number(row.id), row.name]))

  return {
    id: 'loyalty',
    label: 'Loyalty',
    pageId: 'loyalty_points',
    count: matches.length,
    summary: `${matches.length} customer${matches.length === 1 ? '' : 's'} reached ${threshold}+ points`,
    items: preview.map((customer) => ({
      id: `loyalty-${customer.id}`,
      tone: 'success' as const,
      label: nameMap.get(customer.id) || `Customer #${customer.id}`,
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
    label: 'Website Editor',
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
        label: 'Google Drive backup is NOT connected',
        meta: 'Only the R2 copies exist. Open Backup settings and connect Google Drive to start the off-site mirror (keeps the last 10).',
        kind: 'system_drive_sync_connect',
        pageId: 'backup',
      }
    : {
        id: 'system-drive-sync',
        tone: 'warning' as const,
        label: 'Google Drive sync is turned off',
        meta: 'Drive is connected but sync is disabled -- no new backups are mirrored off-site.',
        kind: 'system_drive_sync_disabled',
        pageId: 'backup',
      }
  return {
    id: 'system',
    label: 'System',
    pageId: 'backup',
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
  // The loyalty switch is a cache-key input only; it is not part of the public preferences object.
  const { loyaltyPointsEnabled, ...preferences } = await loadPreferences(c.env)
  const sections: NotificationSection[] = []
  const cachedSection = sectionCacheFor(c)

  const tasks: Array<Promise<NotificationSection | null>> = []
  let loyaltyTask: (() => Promise<NotificationSection | null>) | undefined
  if (preferences.inventoryEnabled && hasPermission(user, 'inventory')) {
    const lowStockConfig = await loadLowStockConfig(c.env)
    tasks.push(cachedSection('inventory', ['products', 'stock', 'settings'], lowStockCacheInput(lowStockConfig),
      () => buildInventorySection(c.env, lowStockConfig, INVENTORY_PREVIEW_ITEMS)))
  }
  if (preferences.expiryEnabled && hasPermission(user, 'products')) {
    tasks.push(cachedSection('expiry', ['products', 'settings'], String(preferences.expiryDays),
      () => buildExpirySection(c.env, preferences.expiryDays)))
  }
  // The section lists receipt numbers and totals, so it follows the sales READ rule (reports.ts, sales.ts canReadSales):
  // a view-only user sees it, a full user whose sales:view was switched off does not.
  if (preferences.salesEnabled && getActionTier(user, 'sales', 'view') !== 'none') tasks.push(buildSalesSection(c.env))
  if (preferences.loyaltyEnabled && getActionTier(user, 'contacts', 'view') !== 'none') {
    loyaltyTask = () => cachedSection('loyalty', ['sales', 'returns', 'customers', 'settings'], `${preferences.loyaltyThreshold}:${loyaltyPointsEnabled ? 1 : 0}`,
      () => buildLoyaltySection(c.env, preferences.loyaltyThreshold, () => requestMetricsOf(c)?.invocation.attemptedStatements || 0))
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

  let results: Array<NotificationSection | null>
  try {
    results = await Promise.all(tasks)
    if (loyaltyTask) results.push(await loyaltyTask())
  } catch (error) {
    if (error instanceof LoyaltyReadBudgetError) return c.json({ error: error.message, code: 'loyalty_read_budget_exceeded' }, 503)
    throw error
  }
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

// The full inventory list behind the panel's "show all". Not part of /summary so
// the poll that runs on every sync broadcast and tab focus stays small; the panel
// asks for this once, on request, and keeps re-asking only while it stays expanded.
app.get('/summary/items', async (c) => {
  const user = c.get('user')
  if (String(c.req.query('section') || '') !== 'inventory') return c.json({ error: 'Unknown notification section' }, 404)
  if (!hasPermission(user, 'inventory')) return c.json({ error: 'Forbidden' }, 403)
  const { inventoryEnabled } = await loadPreferences(c.env)
  if (!inventoryEnabled) return c.json({ id: 'inventory', count: 0, items: [] })
  const lowStockConfig = await loadLowStockConfig(c.env)
  const section = await sectionCacheFor(c)('inventory-full', ['products', 'stock', 'settings'], lowStockCacheInput(lowStockConfig),
    () => buildInventorySection(c.env, lowStockConfig, INVENTORY_FULL_ITEMS))
  return c.json({ id: 'inventory', count: section?.count ?? 0, items: section?.items ?? [] })
})

export default app
