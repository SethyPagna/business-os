'use strict'

const {
  BUSINESS_OS_REQUIRE_SCALE_SERVICES,
  JOB_QUEUE_DRIVER,
  MEDIA_QUEUE_CONCURRENCY,
  REDIS_URL,
} = require('../config')
const { db } = require('../database')

const MEDIA_OPTIMIZE_QUEUE_NAME = process.env.MEDIA_OPTIMIZE_QUEUE_NAME || 'business-os-media-optimize'

let mediaConnection = null
let mediaQueue = null
let mediaWorker = null
let mediaStatus = { driver: 'sqlite', available: false, reason: 'not_checked', producerReady: false, workerActive: false }
const localMediaJobs = new Set()

function wait(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms || 0))))
}

function queueDriverRequired() {
  return BUSINESS_OS_REQUIRE_SCALE_SERVICES || JOB_QUEUE_DRIVER === 'bullmq'
}

function isImportJobCancelled(importJobId) {
  if (!importJobId) return false
  const row = db.prepare('SELECT cancel_requested, status FROM import_jobs WHERE id = ?').get(importJobId)
  return !!row?.cancel_requested || String(row?.status || '').toLowerCase() === 'cancelled'
}

async function getMediaConnection() {
  if (mediaConnection) return mediaConnection
  const IORedis = require('ioredis')
  mediaConnection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  })
  await mediaConnection.connect()
  await mediaConnection.ping()
  return mediaConnection
}

async function initializeMediaQueue() {
  if (mediaQueue) return mediaStatus
  if (JOB_QUEUE_DRIVER === 'sqlite') {
    mediaStatus = { driver: 'sqlite', available: false, reason: 'sqlite_configured', producerReady: false, workerActive: !!mediaWorker }
    return mediaStatus
  }
  try {
    const { Queue } = require('bullmq')
    const connection = await getMediaConnection()
    mediaQueue = new Queue(MEDIA_OPTIMIZE_QUEUE_NAME, { connection })
    mediaStatus = { driver: 'bullmq', available: true, reason: 'producer_ready', producerReady: true, workerActive: !!mediaWorker }
  } catch (error) {
    mediaConnection = null
    mediaQueue = null
    mediaStatus = { driver: 'sqlite', available: false, reason: error?.message || 'Redis unavailable', producerReady: false, workerActive: !!mediaWorker }
    if (JOB_QUEUE_DRIVER === 'bullmq') {
      console.warn(`[media-queue] BullMQ unavailable: ${mediaStatus.reason}`)
    }
  }
  return mediaStatus
}

async function processMediaOptimizationJob({ storedName, source = 'media_queue', importJobId = null, importFileId = null } = {}) {
  const safeStoredName = String(storedName || '').trim()
  if (!safeStoredName) throw new Error('Media optimization job missing storedName')
  if (isImportJobCancelled(importJobId)) {
    if (importFileId) {
      db.prepare("UPDATE import_job_files SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND status != 'processed'").run(importFileId)
    }
    return
  }
  const {
    getFileAssetByPublicPath,
    getMimeTypeFromName,
    registerStoredAsset,
  } = require('../fileAssets')
  const current = getFileAssetByPublicPath(`/uploads/${safeStoredName}`)
  try {
    await registerStoredAsset({
      storedName: safeStoredName,
      originalName: current?.original_name || safeStoredName,
      mimeType: current?.mime_type || getMimeTypeFromName(safeStoredName),
      createdById: current?.created_by_id || null,
      createdByName: current?.created_by_name || null,
      source: current?.source || source,
    })
    if (importFileId) {
      db.prepare("UPDATE import_job_files SET status = 'processed', updated_at = datetime('now') WHERE id = ?").run(importFileId)
    }
    if (importJobId) {
      db.prepare(`
        UPDATE import_jobs
        SET processed_images = processed_images + 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(importJobId)
    }
  } catch (error) {
    if (importFileId) {
      db.prepare("UPDATE import_job_files SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?")
        .run(error?.message || 'Media optimization failed', importFileId)
    }
    if (importJobId) {
      db.prepare(`
        UPDATE import_jobs
        SET failed_images = failed_images + 1, updated_at = datetime('now')
        WHERE id = ?
      `).run(importJobId)
      db.prepare(`
        INSERT INTO import_job_errors (job_id, batch_id, row_number, file_name, code, message, raw_json)
        VALUES (?, NULL, NULL, ?, 'media_failed', ?, '{}')
      `).run(importJobId, safeStoredName, error?.message || 'Media optimization failed')
    }
    throw error
  }
}

async function runLocalMediaJob(payload = {}) {
  const key = String(payload.storedName || '')
  if (!key || localMediaJobs.has(key)) return
  localMediaJobs.add(key)
  try {
    await wait(25)
    await processMediaOptimizationJob(payload)
  } finally {
    localMediaJobs.delete(key)
  }
}

async function enqueueMediaOptimization(payload = {}) {
  const storedName = String(payload?.storedName || '').trim()
  if (!storedName) return getMediaQueueStatus()
  const status = await initializeMediaQueue()
  if (status.available && mediaQueue) {
    await mediaQueue.add('media-optimize', {
      storedName,
      source: payload.source || 'media_queue',
      importJobId: payload.importJobId || null,
      importFileId: payload.importFileId || null,
    }, {
      jobId: `media:${payload.importFileId || storedName}:${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 200,
      removeOnFail: 500,
    })
    return getMediaQueueStatus()
  }
  if (queueDriverRequired()) {
    throw new Error(`Required media queue unavailable; ${storedName} cannot be optimized: ${status.reason || 'Redis/BullMQ unavailable'}`)
  }
  setImmediate(() => { runLocalMediaJob({ storedName, source: payload.source, importJobId: payload.importJobId, importFileId: payload.importFileId }).catch(() => {}) })
  return getMediaQueueStatus()
}

async function startMediaWorker({ concurrency = MEDIA_QUEUE_CONCURRENCY } = {}) {
  const status = await initializeMediaQueue()
  if (!status.available || !mediaQueue) {
    throw new Error(`Media queue is unavailable: ${status.reason || 'Redis/BullMQ unavailable'}`)
  }
  if (mediaWorker) return getMediaQueueStatus()
  const { Worker } = require('bullmq')
  const connection = await getMediaConnection()
  mediaWorker = new Worker(MEDIA_OPTIMIZE_QUEUE_NAME, async (job) => {
    await processMediaOptimizationJob(job.data || {})
  }, {
    connection,
    concurrency,
  })
  mediaWorker.on('failed', (job, error) => {
    console.warn(`[media-worker] ${job?.data?.storedName || 'media'} failed: ${error?.message || error}`)
  })
  mediaWorker.on('error', (error) => {
    console.warn(`[media-worker] worker error: ${error?.message || error}`)
  })
  mediaStatus = { driver: 'bullmq', available: true, reason: 'worker_ready', producerReady: true, workerActive: true }
  return getMediaQueueStatus()
}

function getMediaQueueStatus() {
  return {
    ...mediaStatus,
    configuredDriver: JOB_QUEUE_DRIVER,
    redisUrlConfigured: !!REDIS_URL,
    queue: MEDIA_OPTIMIZE_QUEUE_NAME,
    producerReady: !!mediaQueue,
    workerActive: !!mediaWorker,
    concurrency: MEDIA_QUEUE_CONCURRENCY,
  }
}

module.exports = {
  enqueueMediaOptimization,
  getMediaQueueStatus,
  initializeMediaQueue,
  processMediaOptimizationJob,
  startMediaWorker,
}
