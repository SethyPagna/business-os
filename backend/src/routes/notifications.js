'use strict'

const express = require('express')
const { db } = require('../database')
const { authToken, hasPermission } = require('../middleware')
const { getExpiringProducts, getStockAlertProducts } = require('../businessMetrics')
const { getDriveSyncConfig } = require('../services/googleDriveSync')

const router = express.Router()
const NOTIFICATION_SUMMARY_CACHE_TTL_MS = 15 * 1000
const notificationSummaryCache = new Map()

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
]
const NOTIFICATION_SUMMARY_SEPARATOR = ' • '

function normalizeBoolean(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return fallback
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function pruneNotificationSummaryCache(now = Date.now()) {
  notificationSummaryCache.forEach((entry, key) => {
    if (!entry || Number(entry.expiresAt || 0) <= now) {
      notificationSummaryCache.delete(key)
    }
  })
}

function getNotificationSummaryCacheKey(req, preferences) {
  return JSON.stringify({
    inventory: !!(preferences?.inventoryEnabled && hasPermission(req.user, 'inventory')),
    expiry: !!(preferences?.expiryEnabled && hasPermission(req.user, 'products')),
    sales: !!(preferences?.salesEnabled && hasPermission(req.user, 'sales')),
    loyalty: !!(preferences?.loyaltyEnabled && hasPermission(req.user, 'contacts')),
    portal: !!(preferences?.portalEnabled && hasPermission(req.user, 'customer_portal')),
    system: !!(preferences?.systemEnabled && hasPermission(req.user, 'backup')),
    expiryDays: Number(preferences?.expiryDays || 0),
    loyaltyThreshold: Number(preferences?.loyaltyThreshold || 0),
  })
}

function cloneNotificationSummaryPayload(payload = {}) {
  return JSON.parse(JSON.stringify(payload))
}

function getCachedNotificationSummary(key, now = Date.now()) {
  const entry = notificationSummaryCache.get(key)
  if (!entry || Number(entry.expiresAt || 0) <= now) {
    if (entry) notificationSummaryCache.delete(key)
    return null
  }
  return cloneNotificationSummaryPayload(entry.payload)
}

function setCachedNotificationSummary(key, payload, now = Date.now()) {
  notificationSummaryCache.set(key, {
    expiresAt: now + NOTIFICATION_SUMMARY_CACHE_TTL_MS,
    payload: cloneNotificationSummaryPayload(payload),
  })
}

function buildPlaceholders(count) {
  const placeholders = []
  for (let index = 0; index < count; index += 1) {
    placeholders.push('?')
  }
  return placeholders.join(',')
}

function rowsToSettingMap(rows = []) {
  const map = {}
  for (const row of rows) {
    map[row.key] = row.value
  }
  return map
}

function joinNotificationSummary(parts = []) {
  const summaryParts = []
  for (const part of parts) {
    if (part) summaryParts.push(part)
  }
  return summaryParts.join(NOTIFICATION_SUMMARY_SEPARATOR)
}

function loadNotificationPreferences() {
  const placeholders = buildPlaceholders(NOTIFICATION_SETTING_KEYS.length)
  const rows = db.prepare(`
    SELECT key, value
    FROM settings
    WHERE key IN (${placeholders})
  `).all(...NOTIFICATION_SETTING_KEYS)

  const map = rowsToSettingMap(rows)

  return {
    inventoryEnabled: normalizeBoolean(map.notifications_inventory_enabled, true),
    salesEnabled: normalizeBoolean(map.notifications_sales_enabled, true),
    loyaltyEnabled: normalizeBoolean(map.notifications_loyalty_enabled, true),
    portalEnabled: normalizeBoolean(map.notifications_portal_enabled, true),
    systemEnabled: normalizeBoolean(map.notifications_system_enabled, true),
    expiryEnabled: normalizeBoolean(map.notifications_expiry_enabled, true),
    expiryDays: Math.max(0, Math.min(3650, Math.floor(toNumber(map.notifications_expiry_days, 30)))),
    loyaltyThreshold: Math.max(1, Math.floor(toNumber(map.notifications_loyalty_threshold, 100))),
    realertMinutes: Math.max(5, Math.min(1440, Math.floor(toNumber(map.notifications_realert_minutes, 10)))),
  }
}

function loadPointPolicy() {
  const rows = db.prepare(`
    SELECT key, value
    FROM settings
    WHERE key IN (
      'customer_portal_points_basis',
      'customer_portal_points_per_usd',
      'customer_portal_points_per_khr',
      'exchange_rate'
    )
  `).all()

  const map = rowsToSettingMap(rows)

  const basis = String(map.customer_portal_points_basis || 'usd').trim().toLowerCase() === 'khr'
    ? 'khr'
    : 'usd'
  const exchangeRate = toNumber(map.exchange_rate, 4100)
  const pointsPerUsd = Math.max(0, toNumber(map.customer_portal_points_per_usd, 1))
  const derivedPointsPerKhr = pointsPerUsd > 0 && exchangeRate > 0 ? (pointsPerUsd / exchangeRate) : 0
  const pointsPerKhr = Math.max(0, toNumber(map.customer_portal_points_per_khr, derivedPointsPerKhr))

  return { basis, pointsPerUsd, pointsPerKhr }
}

function calculatePolicyPoints(amountUsd, amountKhr, policy) {
  if (policy.basis === 'khr') return toNumber(amountKhr, 0) * Math.max(0, policy.pointsPerKhr)
  return toNumber(amountUsd, 0) * Math.max(0, policy.pointsPerUsd)
}

function buildInventoryItems(outOfStock = [], lowStock = []) {
  const items = []
  for (const product of outOfStock) {
    items.push({
      id: `out-${product.id}`,
      tone: 'danger',
      label: product.name,
      meta: 'Out of stock',
      kind: 'inventory_out_of_stock',
      metaKey: 'notification_inventory_out_of_stock',
      metaParams: {},
      pageId: 'inventory',
    })
  }
  for (const product of lowStock) {
    items.push({
      id: `low-${product.id}`,
      tone: 'warning',
      label: product.name,
      meta: `Low stock (${Number(product.stock_quantity || 0)})`,
      kind: 'inventory_low_stock',
      metaKey: 'notification_inventory_low_stock',
      metaParams: { quantity: Number(product.stock_quantity || 0) },
      pageId: 'inventory',
    })
  }
  return items
}

function buildInventorySection() {
  const { lowStock, outOfStock, countLow, countOut } = getStockAlertProducts({ limit: 5000 })

  const items = buildInventoryItems(outOfStock, lowStock)

  if (!items.length && !countLow && !countOut) return null

  return {
    id: 'inventory',
    label: 'Inventory',
    pageId: 'inventory',
    enabledKey: 'notifications_inventory_enabled',
    count: Number(countLow || 0) + Number(countOut || 0),
    summaryKey: 'notification_inventory_summary',
    summaryParams: { outCount: Number(countOut || 0), lowCount: Number(countLow || 0) },
    summary: joinNotificationSummary([
      countOut ? `${countOut} out of stock` : null,
      countLow ? `${countLow} low stock` : null,
    ]),
    items,
  }
}

function buildExpiryItems(products = []) {
  const items = []
  let expiredCount = 0
  for (const product of products) {
    const daysLeft = Number(product.days_until_expiry || 0)
    if (daysLeft < 0) expiredCount += 1
    items.push({
      id: `expiry-${product.id}`,
      label: product.name,
      meta: daysLeft < 0 ? `Expired ${Math.abs(daysLeft)} day${Math.abs(daysLeft) === 1 ? '' : 's'} ago` : `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      kind: daysLeft < 0 ? 'product_expired' : 'product_expiring',
      tone: daysLeft < 0 ? 'danger' : 'warning',
      metaKey: daysLeft < 0 ? 'notification_product_expired' : 'notification_product_expiring',
      metaParams: { days: Math.abs(daysLeft), expiryDate: product.expiry_date || '' },
      pageId: 'products',
    })
  }
  return { items, expiredCount }
}

function buildExpirySection(days = 30) {
  const products = getExpiringProducts({ limit: 50, days })
  if (!products.length) return null
  const { items, expiredCount } = buildExpiryItems(products)
  const expiringCount = products.length - expiredCount
  return {
    id: 'expiry',
    title: 'Product expiry',
    titleKey: 'notification_expiry_title',
    pageId: 'products',
    enabledKey: 'notifications_expiry_enabled',
    count: products.length,
    summaryKey: 'notification_expiry_summary',
    summaryParams: { expiredCount, expiringCount, days },
    summary: joinNotificationSummary([
      expiredCount ? `${expiredCount} expired` : null,
      expiringCount ? `${expiringCount} expiring within ${days} days` : null,
    ]),
    items,
  }
}

function buildSalesItems(awaitingPayment = [], awaitingDelivery = []) {
  const items = []
  for (const sale of awaitingPayment) {
    items.push({
      id: `pay-${sale.id}`,
      tone: 'warning',
      label: sale.receipt_number || `Sale #${sale.id}`,
      meta: `Awaiting payment${NOTIFICATION_SUMMARY_SEPARATOR}$${Number(sale.total_usd || 0).toFixed(2)}`,
      kind: 'sales_awaiting_payment',
      metaKey: 'notification_sales_awaiting_payment',
      metaParams: { totalUsd: Number(sale.total_usd || 0).toFixed(2) },
      pageId: 'sales',
    })
  }
  for (const sale of awaitingDelivery) {
    items.push({
      id: `delivery-${sale.id}`,
      tone: 'info',
      label: sale.receipt_number || `Sale #${sale.id}`,
      meta: `Awaiting delivery${NOTIFICATION_SUMMARY_SEPARATOR}$${Number(sale.total_usd || 0).toFixed(2)}`,
      kind: 'sales_awaiting_delivery',
      metaKey: 'notification_sales_awaiting_delivery',
      metaParams: { totalUsd: Number(sale.total_usd || 0).toFixed(2) },
      pageId: 'sales',
    })
  }
  return items
}

function buildSalesSection() {
  const awaitingPayment = db.prepare(`
    SELECT id, receipt_number, total_usd
    FROM sales
    WHERE COALESCE(sale_status, 'completed') = 'awaiting_payment'
    ORDER BY created_at DESC
    LIMIT 50
  `).all()

  const awaitingDelivery = db.prepare(`
    SELECT id, receipt_number, total_usd
    FROM sales
    WHERE COALESCE(sale_status, 'completed') = 'awaiting_delivery'
    ORDER BY created_at DESC
    LIMIT 50
  `).all()

  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN COALESCE(sale_status, 'completed') = 'awaiting_payment' THEN 1 ELSE 0 END) AS awaiting_payment,
      SUM(CASE WHEN COALESCE(sale_status, 'completed') = 'awaiting_delivery' THEN 1 ELSE 0 END) AS awaiting_delivery
    FROM sales
  `).get() || {}

  const items = buildSalesItems(awaitingPayment, awaitingDelivery)

  const awaitingPaymentCount = Number(counts.awaiting_payment || 0)
  const awaitingDeliveryCount = Number(counts.awaiting_delivery || 0)
  if (!items.length && !awaitingPaymentCount && !awaitingDeliveryCount) return null

  return {
    id: 'sales',
    label: 'Sales',
    pageId: 'sales',
    enabledKey: 'notifications_sales_enabled',
    count: awaitingPaymentCount + awaitingDeliveryCount,
    summaryKey: 'notification_sales_summary',
    summaryParams: { awaitingPaymentCount, awaitingDeliveryCount },
    summary: joinNotificationSummary([
      awaitingPaymentCount ? `${awaitingPaymentCount} awaiting payment` : null,
      awaitingDeliveryCount ? `${awaitingDeliveryCount} awaiting delivery` : null,
    ]),
    items,
  }
}

function rowsByCustomerId(rows = []) {
  const map = new Map()
  for (const row of rows) {
    map.set(Number(row.customer_id), row)
  }
  return map
}

function buildLoyaltyMatches(customers = [], salesMap, returnsMap, rewardsMap, pointsPolicy, threshold) {
  const matches = []
  for (const customer of customers) {
    const customerId = Number(customer.id)
    const sales = salesMap.get(customerId) || {}
    const refunds = returnsMap.get(customerId) || {}
    const rewards = rewardsMap.get(customerId) || {}
    const earned = calculatePolicyPoints(sales.sales_usd, sales.sales_khr, pointsPolicy)
    const deducted = calculatePolicyPoints(refunds.refunds_usd, refunds.refunds_khr, pointsPolicy)
    const redeemed = toNumber(sales.redeemed, 0)
    const rewarded = toNumber(rewards.rewarded, 0)
    const balance = Math.max(0, earned - deducted - redeemed + rewarded)
    if (balance < threshold) continue
    matches.push({
      id: customerId,
      name: customer.name || `Customer #${customerId}`,
      balance: Number(balance.toFixed(2)),
    })
  }
  matches.sort((left, right) => right.balance - left.balance)
  return matches
}

function buildLoyaltyItems(matches = []) {
  const items = []
  const limit = Math.min(matches.length, 50)
  for (let index = 0; index < limit; index += 1) {
    const customer = matches[index]
    items.push({
      id: `loyalty-${customer.id}`,
      tone: 'success',
      label: customer.name,
      meta: `${customer.balance} points`,
      kind: 'loyalty_points_balance',
      metaKey: 'notification_loyalty_points_balance',
      metaParams: { balance: customer.balance },
      pageId: 'loyalty_points',
    })
  }
  return items
}

function buildLoyaltySection(threshold) {
  const customers = db.prepare('SELECT id, name FROM customers ORDER BY name COLLATE NOCASE ASC').all()
  if (!customers.length) return null

  const pointsPolicy = loadPointPolicy()
  const salesRows = db.prepare(`
    SELECT
      customer_id,
      COALESCE(SUM(COALESCE(total_usd, 0)), 0) AS sales_usd,
      COALESCE(SUM(COALESCE(total_khr, 0)), 0) AS sales_khr,
      COALESCE(SUM(COALESCE(membership_points_redeemed, 0)), 0) AS redeemed
    FROM sales
    WHERE customer_id IS NOT NULL
      AND COALESCE(sale_status, 'completed') NOT IN ('cancelled', 'awaiting_payment')
    GROUP BY customer_id
  `).all()

  const returnRows = db.prepare(`
    SELECT
      customer_id,
      COALESCE(SUM(COALESCE(total_refund_usd, 0)), 0) AS refunds_usd,
      COALESCE(SUM(COALESCE(total_refund_khr, 0)), 0) AS refunds_khr
    FROM returns
    WHERE customer_id IS NOT NULL
      AND COALESCE(status, 'completed') != 'cancelled'
      AND COALESCE(return_scope, 'customer') != 'supplier'
    GROUP BY customer_id
  `).all()

  const rewardRows = db.prepare(`
    SELECT
      customer_id,
      COALESCE(SUM(COALESCE(reward_points, 0)), 0) AS rewarded
    FROM customer_share_submissions
    WHERE customer_id IS NOT NULL
      AND status = 'approved'
    GROUP BY customer_id
  `).all()

  const salesMap = rowsByCustomerId(salesRows)
  const returnsMap = rowsByCustomerId(returnRows)
  const rewardsMap = rowsByCustomerId(rewardRows)
  const matches = buildLoyaltyMatches(customers, salesMap, returnsMap, rewardsMap, pointsPolicy, threshold)

  if (!matches.length) return null

  return {
    id: 'loyalty',
    label: 'Loyalty',
    pageId: 'loyalty_points',
    enabledKey: 'notifications_loyalty_enabled',
    count: matches.length,
    summaryKey: 'notification_loyalty_summary',
    summaryParams: { count: matches.length, threshold },
    summary: `${matches.length} customer${matches.length === 1 ? '' : 's'} reached ${threshold}+ points`,
    items: buildLoyaltyItems(matches),
  }
}

function buildPortalItems(pendingRows = []) {
  const items = []
  for (const entry of pendingRows) {
    items.push({
      id: `portal-${entry.id}`,
      tone: 'info',
      label: entry.customer_name || entry.membership_number || `Submission #${entry.id}`,
      meta: entry.platform ? `Pending review${NOTIFICATION_SUMMARY_SEPARATOR}${entry.platform}` : 'Pending review',
      kind: 'portal_pending_review',
      metaKey: entry.platform ? 'notification_portal_pending_review_platform' : 'notification_portal_pending_review',
      metaParams: { platform: entry.platform || '' },
      pageId: 'catalog',
    })
  }
  return items
}

function buildPortalSection() {
  const pendingRows = db.prepare(`
    SELECT id, customer_name, membership_number, platform
    FROM customer_share_submissions
    WHERE status = 'pending'
    ORDER BY created_at DESC
    LIMIT 50
  `).all()

  const pendingCount = Number(
    db.prepare(`SELECT COUNT(*) AS count FROM customer_share_submissions WHERE status = 'pending'`).get()?.count || 0
  )

  if (!pendingRows.length && !pendingCount) return null

  return {
    id: 'portal',
    label: 'Customer portal',
    pageId: 'catalog',
    enabledKey: 'notifications_portal_enabled',
    count: pendingCount,
    summaryKey: 'notification_portal_summary',
    summaryParams: { count: pendingCount },
    summary: `${pendingCount} pending customer submission${pendingCount === 1 ? '' : 's'}`,
    items: buildPortalItems(pendingRows),
  }
}

function buildSystemSection() {
  const driveConfig = getDriveSyncConfig()
  const driveEnabled = !!driveConfig.enabled
  const refreshToken = String(driveConfig.refreshToken || '').trim()
  if (!driveEnabled || refreshToken) return null

  return {
    id: 'system',
    label: 'System',
    pageId: 'backup',
    enabledKey: 'notifications_system_enabled',
    count: 1,
    summaryKey: 'notification_system_drive_sync_summary',
    summaryParams: {},
    summary: 'Google Drive sync needs attention',
    items: [
      {
        id: 'system-drive-sync',
        tone: 'warning',
        label: 'Google Drive sync',
        meta: 'Reconnect Google Drive to resume sync',
        kind: 'system_drive_sync_reconnect',
        metaKey: 'notification_system_drive_sync_reconnect',
        metaParams: {},
        pageId: 'backup',
      },
    ],
  }
}

function sumSectionCounts(sections = []) {
  let total = 0
  for (const section of sections) {
    total += Number(section.count || 0)
  }
  return total
}

router.get('/summary', authToken, (req, res) => {
  const now = Date.now()
  pruneNotificationSummaryCache(now)
  const preferences = loadNotificationPreferences()
  const cacheKey = getNotificationSummaryCacheKey(req, preferences)
  const cached = getCachedNotificationSummary(cacheKey, now)
  if (cached) {
    res.json(cached)
    return
  }
  const sections = []

  if (preferences.inventoryEnabled && hasPermission(req.user, 'inventory')) {
    const inventorySection = buildInventorySection()
    if (inventorySection) sections.push(inventorySection)
  }

  if (preferences.expiryEnabled && hasPermission(req.user, 'products')) {
    const expirySection = buildExpirySection(preferences.expiryDays)
    if (expirySection) sections.push(expirySection)
  }

  if (preferences.salesEnabled && hasPermission(req.user, 'sales')) {
    const salesSection = buildSalesSection()
    if (salesSection) sections.push(salesSection)
  }

  if (preferences.loyaltyEnabled && hasPermission(req.user, 'contacts')) {
    const loyaltySection = buildLoyaltySection(preferences.loyaltyThreshold)
    if (loyaltySection) sections.push(loyaltySection)
  }

  if (preferences.portalEnabled && hasPermission(req.user, 'customer_portal')) {
    const portalSection = buildPortalSection()
    if (portalSection) sections.push(portalSection)
  }

  if (preferences.systemEnabled && hasPermission(req.user, 'backup')) {
    const systemSection = buildSystemSection()
    if (systemSection) sections.push(systemSection)
  }

  const unreadCount = sumSectionCounts(sections)

  const payload = {
    unreadCount,
    generatedAt: new Date().toISOString(),
    preferences,
    sections,
  }
  setCachedNotificationSummary(cacheKey, payload, now)
  res.json(payload)
})

module.exports = router
module.exports._test = {
  NOTIFICATION_SUMMARY_CACHE_TTL_MS,
  pruneNotificationSummaryCache,
  getNotificationSummaryCacheKey,
  getCachedNotificationSummary,
  setCachedNotificationSummary,
  notificationSummaryCache,
}
