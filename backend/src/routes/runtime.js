'use strict'

const express = require('express')
const { ok, err } = require('../helpers')
const { authToken, hasPermission } = require('../middleware')
const { getQueueStatus, initializeBullQueue } = require('../services/importJobs')
const { getMediaQueueStatus, initializeMediaQueue } = require('../services/mediaQueue')
const { getRuntimeCacheStatus, pingRuntimeCache } = require('../runtimeCache.ts')
const { getRuntimeVersion } = require('../runtimeVersion.ts')
const { db } = require('../database.ts')
const { hasSuspiciousCatalogText } = require('../catalogTextIntegrity.ts')

const router = express.Router()
const PRODUCT_CATALOG_FIELDS = ['name', 'brand', 'category', 'unit', 'description', 'supplier']
const SUSPICIOUS_PRODUCT_SAMPLE_LIMIT = 25
const SUSPICIOUS_BRAND_OPTION_LIMIT = 100

function createProductFieldCounts() {
  const counts = {}
  for (const field of PRODUCT_CATALOG_FIELDS) {
    counts[field] = 0
  }
  return counts
}

function collectSuspiciousProductFields(row, fieldCounts) {
  const fields = []
  for (const field of PRODUCT_CATALOG_FIELDS) {
    if (!hasSuspiciousCatalogText(row?.[field])) continue
    fieldCounts[field] += 1
    fields.push(field)
  }
  return fields
}

function summarizeSuspiciousProducts(productRows) {
  const productFieldCounts = createProductFieldCounts()
  const suspiciousProducts = []
  let suspiciousProductCount = 0

  for (const row of productRows) {
    const fields = collectSuspiciousProductFields(row, productFieldCounts)
    if (!fields.length) continue

    suspiciousProductCount += 1
    if (suspiciousProducts.length >= SUSPICIOUS_PRODUCT_SAMPLE_LIMIT) continue

    suspiciousProducts.push({
      id: Number(row.id || 0) || null,
      name: String(row.name || '').trim(),
      fields,
    })
  }

  return {
    productFieldCounts,
    suspiciousProducts,
    suspiciousProductCount,
  }
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch (_) {
    return []
  }
}

function summarizeSuspiciousTextValues(values, limit) {
  const sample = []
  let count = 0

  for (const rawValue of values) {
    const value = String(rawValue || '').trim()
    if (!hasSuspiciousCatalogText(value)) continue
    count += 1
    if (sample.length < limit) {
      sample.push(value)
    }
  }

  return { count, sample }
}

router.get('/version', (_req, res) => {
  ok(res, getRuntimeVersion())
})

function requireRuntimePermission(req, res, next) {
  if (hasPermission(req.user, 'settings')) return next()
  return res.status(403).json({ success: false, error: 'No permission', code: 'forbidden', permission: 'settings' })
}

router.get('/queues/status', authToken, requireRuntimePermission, async (_req, res) => {
  try {
    const [importProbe, mediaProbe] = await Promise.allSettled([
      initializeBullQueue(),
      initializeMediaQueue(),
    ])
    const cacheReady = await pingRuntimeCache()
    ok(res, {
      queues: {
        import: {
          ...getQueueStatus(),
          probeError: importProbe.status === 'rejected' ? (importProbe.reason?.message || String(importProbe.reason)) : null,
        },
        media: {
          ...getMediaQueueStatus(),
          probeError: mediaProbe.status === 'rejected' ? (mediaProbe.reason?.message || String(mediaProbe.reason)) : null,
        },
      },
      cache: {
        ...getRuntimeCacheStatus(),
        ready: cacheReady,
      },
    })
  } catch (error) {
    err(res, error?.message || 'Failed to check queue status')
  }
})

router.get('/catalog-integrity', authToken, requireRuntimePermission, (_req, res) => {
  try {
    const productRows = db.prepare(`
      SELECT id, name, brand, category, unit, description, supplier
      FROM products
      WHERE is_active = 1
    `).all()
    const {
      productFieldCounts,
      suspiciousProducts,
      suspiciousProductCount,
    } = summarizeSuspiciousProducts(productRows)
    const brandOptionsRaw = db.prepare("SELECT value FROM settings WHERE key = 'product_brand_options'").get()?.value || '[]'
    const suspiciousBrandOptions = summarizeSuspiciousTextValues(
      parseJsonArray(brandOptionsRaw),
      SUSPICIOUS_BRAND_OPTION_LIMIT,
    )
    ok(res, {
      runtime: getRuntimeVersion(),
      summary: {
        suspicious_products: suspiciousProductCount,
        suspicious_brand_options: suspiciousBrandOptions.count,
        product_field_counts: productFieldCounts,
      },
      suspiciousProducts,
      suspiciousBrandOptions: suspiciousBrandOptions.sample,
    })
  } catch (error) {
    err(res, error?.message || 'Failed to inspect catalog integrity')
  }
})

module.exports = router
