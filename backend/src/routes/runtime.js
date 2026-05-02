'use strict'

const express = require('express')
const { ok, err } = require('../helpers')
const { authToken, hasPermission } = require('../middleware')
const { getQueueStatus, initializeBullQueue } = require('../services/importJobs')
const { getMediaQueueStatus, initializeMediaQueue } = require('../services/mediaQueue')
const { getRuntimeCacheStatus, pingRuntimeCache } = require('../runtimeCache')
const { getRuntimeVersion } = require('../runtimeVersion')

const router = express.Router()

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

module.exports = router
