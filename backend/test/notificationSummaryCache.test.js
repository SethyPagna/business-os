'use strict'

const assert = require('assert')

const notificationsRoute = require('../src/routes/notifications')

const {
  NOTIFICATION_SUMMARY_CACHE_TTL_MS,
  getCachedNotificationSummary,
  getNotificationSummaryCacheKey,
  notificationSummaryCache,
  pruneNotificationSummaryCache,
  setCachedNotificationSummary,
} = notificationsRoute._test

function runTest(name, fn) {
  try {
    notificationSummaryCache.clear()
    fn()
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    console.error(error)
    process.exitCode = 1
  } finally {
    notificationSummaryCache.clear()
  }
}

runTest('notification summary cache key tracks effective section access', () => {
  const preferences = {
    inventoryEnabled: true,
    expiryEnabled: true,
    salesEnabled: true,
    loyaltyEnabled: true,
    portalEnabled: true,
    systemEnabled: true,
    expiryDays: 30,
    loyaltyThreshold: 100,
  }
  const req = {
    user: {
      permissions: {
        inventory: true,
        products: true,
        sales: true,
        contacts: false,
        customer_portal: true,
        backup: false,
      },
    },
  }
  const key = JSON.parse(getNotificationSummaryCacheKey(req, preferences))
  assert.equal(key.inventory, true)
  assert.equal(key.expiry, true)
  assert.equal(key.sales, true)
  assert.equal(key.loyalty, false)
  assert.equal(key.portal, true)
  assert.equal(key.system, false)
  assert.equal(key.expiryDays, 30)
  assert.equal(key.loyaltyThreshold, 100)
})

runTest('notification summary cache returns cloned payloads until expiry', () => {
  const now = 1000
  const payload = { unreadCount: 3, sections: [{ id: 'inventory' }] }
  setCachedNotificationSummary('cache-key', payload, now)

  const cached = getCachedNotificationSummary('cache-key', now + 50)
  assert.deepEqual(cached, payload)
  cached.sections[0].id = 'mutated'

  const cachedAgain = getCachedNotificationSummary('cache-key', now + 100)
  assert.equal(cachedAgain.sections[0].id, 'inventory')

  const expired = getCachedNotificationSummary('cache-key', now + NOTIFICATION_SUMMARY_CACHE_TTL_MS + 1)
  assert.equal(expired, null)
})

runTest('notification summary cache pruning removes stale entries only', () => {
  setCachedNotificationSummary('fresh', { unreadCount: 1 }, 2000)
  setCachedNotificationSummary('stale', { unreadCount: 2 }, 0)

  pruneNotificationSummaryCache(2000 + NOTIFICATION_SUMMARY_CACHE_TTL_MS + 1)

  assert.equal(notificationSummaryCache.has('fresh'), false)
  assert.equal(notificationSummaryCache.has('stale'), false)

  setCachedNotificationSummary('fresh-again', { unreadCount: 4 }, 5000)
  pruneNotificationSummaryCache(5000 + 10)
  assert.equal(notificationSummaryCache.has('fresh-again'), true)
})

if (process.exitCode) process.exit(process.exitCode)
