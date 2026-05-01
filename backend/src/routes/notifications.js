'use strict'

const express = require('express')
const { db } = require('../database')
const { authToken, hasPermission } = require('../middleware')
const { getDriveSyncConfig } = require('../services/googleDriveSync')

const router = express.Router()

const NOTIFICATION_SETTING_KEYS = [
  'notifications_inventory_enabled',
  'notifications_sales_enabled',
  'notifications_loyalty_enabled',
  'notifications_portal_enabled',
  'notifications_system_enabled',
  'notifications_loyalty_threshold',
  'notifications_realert_minutes',
]

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

function loadNotificationPreferences() {
  const placeholders = NOTIFICATION_SETTING_KEYS.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT key, value
    FROM settings
    WHERE key IN (${placeholders})
  `).all(...NOTIFICATION_SETTING_KEYS)

  const map = {}
  rows.forEach((row) => {
    map[row.key] = row.value
  })

  return {
    inventoryEnabled: normalizeBoolean(map.notifications_inventory_enabled, true),
    salesEnabled: normalizeBoolean(map.notifications_sales_enabled, true),
    loyaltyEnabled: normalizeBoolean(map.notifications_loyalty_enabled, true),
    portalEnabled: normalizeBoolean(map.notifications_portal_enabled, true),
    systemEnabled: normalizeBoolean(map.notifications_system_enabled, true),
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

  const map = {}
  rows.forEach((row) => { map[row.key] = row.value })

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

function buildInventorySection() {
  const lowStock = db.prepare(`
    SELECT id, name, stock_quantity, low_stock_threshold
    FROM products
    WHERE is_active = 1
      AND stock_quantity > COALESCE(out_of_stock_threshold, 0)
      AND stock_quantity <= COALESCE(low_stock_threshold, 10)
    ORDER BY stock_quantity ASC, name COLLATE NOCASE ASC
    LIMIT 50
  `).all()

  const outOfStock = db.prepare(`
    SELECT id, name, stock_quantity
    FROM products
    WHERE is_active = 1
      AND stock_quantity <= COALESCE(out_of_stock_threshold, 0)
    ORDER BY stock_quantity ASC, name COLLATE NOCASE ASC
    LIMIT 50
  `).all()

  const countLow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM products
    WHERE is_active = 1
      AND stock_quantity > COALESCE(out_of_stock_threshold, 0)
      AND stock_quantity <= COALESCE(low_stock_threshold, 10)
  `).get()?.count || 0

  const countOut = db.prepare(`
    SELECT COUNT(*) AS count
    FROM products
    WHERE is_active = 1
      AND stock_quantity <= COALESCE(out_of_stock_threshold, 0)
  `).get()?.count || 0

  const items = [
    ...outOfStock.map((product) => ({
      id: `out-${product.id}`,
      tone: 'danger',
      label: product.name,
      meta: 'Out of stock',
      kind: 'inventory_out_of_stock',
      metaKey: 'notification_inventory_out_of_stock',
      metaParams: {},
      pageId: 'inventory',
    })),
    ...lowStock.map((product) => ({
      id: `low-${product.id}`,
      tone: 'warning',
      label: product.name,
      meta: `Low stock (${Number(product.stock_quantity || 0)})`,
      kind: 'inventory_low_stock',
      metaKey: 'notification_inventory_low_stock',
      metaParams: { quantity: Number(product.stock_quantity || 0) },
      pageId: 'inventory',
    })),
  ]

  if (!items.length && !countLow && !countOut) return null

  return {
    id: 'inventory',
    label: 'Inventory',
    pageId: 'inventory',
    enabledKey: 'notifications_inventory_enabled',
    count: Number(countLow || 0) + Number(countOut || 0),
    summaryKey: 'notification_inventory_summary',
    summaryParams: { outCount: Number(countOut || 0), lowCount: Number(countLow || 0) },
    summary: [
      countOut ? `${countOut} out of stock` : null,
      countLow ? `${countLow} low stock` : null,
    ].filter(Boolean).join(' • '),
    items,
  }
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

  const items = [
    ...awaitingPayment.map((sale) => ({
      id: `pay-${sale.id}`,
      tone: 'warning',
      label: sale.receipt_number || `Sale #${sale.id}`,
      meta: `Awaiting payment • $${Number(sale.total_usd || 0).toFixed(2)}`,
      kind: 'sales_awaiting_payment',
      metaKey: 'notification_sales_awaiting_payment',
      metaParams: { totalUsd: Number(sale.total_usd || 0).toFixed(2) },
      pageId: 'sales',
    })),
    ...awaitingDelivery.map((sale) => ({
      id: `delivery-${sale.id}`,
      tone: 'info',
      label: sale.receipt_number || `Sale #${sale.id}`,
      meta: `Awaiting delivery • $${Number(sale.total_usd || 0).toFixed(2)}`,
      kind: 'sales_awaiting_delivery',
      metaKey: 'notification_sales_awaiting_delivery',
      metaParams: { totalUsd: Number(sale.total_usd || 0).toFixed(2) },
      pageId: 'sales',
    })),
  ]

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
    summary: [
      awaitingPaymentCount ? `${awaitingPaymentCount} awaiting payment` : null,
      awaitingDeliveryCount ? `${awaitingDeliveryCount} awaiting delivery` : null,
    ].filter(Boolean).join(' • '),
    items,
  }
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

  const salesMap = new Map(salesRows.map((row) => [Number(row.customer_id), row]))
  const returnsMap = new Map(returnRows.map((row) => [Number(row.customer_id), row]))
  const rewardsMap = new Map(rewardRows.map((row) => [Number(row.customer_id), row]))

  const matches = customers
    .map((customer) => {
      const customerId = Number(customer.id)
      const sales = salesMap.get(customerId) || {}
      const refunds = returnsMap.get(customerId) || {}
      const rewards = rewardsMap.get(customerId) || {}
      const earned = calculatePolicyPoints(sales.sales_usd, sales.sales_khr, pointsPolicy)
      const deducted = calculatePolicyPoints(refunds.refunds_usd, refunds.refunds_khr, pointsPolicy)
      const redeemed = toNumber(sales.redeemed, 0)
      const rewarded = toNumber(rewards.rewarded, 0)
      const balance = Math.max(0, earned - deducted - redeemed + rewarded)
      return {
        id: customerId,
        name: customer.name || `Customer #${customerId}`,
        balance: Number(balance.toFixed(2)),
      }
    })
    .filter((customer) => customer.balance >= threshold)
    .sort((left, right) => right.balance - left.balance)

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
    items: matches.slice(0, 50).map((customer) => ({
      id: `loyalty-${customer.id}`,
      tone: 'success',
      label: customer.name,
      meta: `${customer.balance} points`,
      kind: 'loyalty_points_balance',
      metaKey: 'notification_loyalty_points_balance',
      metaParams: { balance: customer.balance },
      pageId: 'loyalty_points',
    })),
  }
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
    items: pendingRows.map((entry) => ({
      id: `portal-${entry.id}`,
      tone: 'info',
      label: entry.customer_name || entry.membership_number || `Submission #${entry.id}`,
      meta: entry.platform ? `Pending review • ${entry.platform}` : 'Pending review',
      kind: 'portal_pending_review',
      metaKey: entry.platform ? 'notification_portal_pending_review_platform' : 'notification_portal_pending_review',
      metaParams: { platform: entry.platform || '' },
      pageId: 'catalog',
    })),
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

router.get('/summary', authToken, (req, res) => {
  const preferences = loadNotificationPreferences()
  const sections = []

  if (preferences.inventoryEnabled && hasPermission(req.user, 'inventory')) {
    const inventorySection = buildInventorySection()
    if (inventorySection) sections.push(inventorySection)
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

  const unreadCount = sections.reduce((sum, section) => sum + Number(section.count || 0), 0)

  res.json({
    unreadCount,
    generatedAt: new Date().toISOString(),
    preferences,
    sections,
  })
})

module.exports = router
