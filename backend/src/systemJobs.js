'use strict'

const crypto = require('crypto')

const MAX_COMPLETED_JOBS = 100
const jobs = new Map()
let tableReady = false

function nowIso() {
  return new Date().toISOString()
}

function makeJobId(prefix = 'sys') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`
}

function publicJob(job) {
  if (!job) return null
  const result = job.result || safeJsonParse(job.result_json, null)
  const metrics = job.metrics || safeJsonParse(job.metrics_json, {})
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    result,
    metrics,
    retry_count: Number(job.retry_count || 0) || 0,
    cancellable: !!job.cancellable && ['queued', 'running', 'cancelling'].includes(job.status),
    cancel_requested_at: job.cancel_requested_at || null,
    error: job.error || '',
    created_at: job.created_at,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
    updated_at: job.updated_at,
  }
}

function findActiveJob(dedupeKey) {
  const safeKey = String(dedupeKey || '').trim()
  if (!safeKey) return null
  for (const job of jobs.values()) {
    if (job?.dedupe_key === safeKey && ['queued', 'running'].includes(job.status)) {
      return job
    }
  }
  return null
}

function safeJsonParse(value, fallback = null) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch (_) {
    return fallback
  }
}

function getDb() {
  return require('./database').db
}

function ensureTable() {
  if (tableReady) return
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS system_jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      phase TEXT,
      progress INTEGER DEFAULT 0,
      message TEXT,
      result_json TEXT,
      metrics_json TEXT,
      retry_count INTEGER DEFAULT 0,
      cancellable INTEGER DEFAULT 0,
      cancel_requested_at TIMESTAMPTZ,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_system_jobs_created_pg ON system_jobs(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_system_jobs_status_pg ON system_jobs(status, updated_at DESC);
  `)
  ;[
    'ALTER TABLE system_jobs ADD COLUMN IF NOT EXISTS metrics_json TEXT',
    'ALTER TABLE system_jobs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0',
    'ALTER TABLE system_jobs ADD COLUMN IF NOT EXISTS cancellable INTEGER DEFAULT 0',
    'ALTER TABLE system_jobs ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ',
  ].forEach((statement) => {
    try { getDb().exec(statement) } catch (_) {}
  })
  tableReady = true
}

function persistJob(job) {
  ensureTable()
  getDb().prepare(`
    INSERT INTO system_jobs (
      id, type, status, phase, progress, message, result_json, error,
      metrics_json, retry_count, cancellable, cancel_requested_at,
      created_at, started_at, finished_at, updated_at
    ) VALUES (
      @id, @type, @status, @phase, @progress, @message, @result_json, @error,
      @metrics_json, @retry_count, @cancellable, @cancel_requested_at,
      @created_at, @started_at, @finished_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      status = excluded.status,
      phase = excluded.phase,
      progress = excluded.progress,
      message = excluded.message,
      result_json = excluded.result_json,
      metrics_json = excluded.metrics_json,
      retry_count = excluded.retry_count,
      cancellable = excluded.cancellable,
      cancel_requested_at = excluded.cancel_requested_at,
      error = excluded.error,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      updated_at = excluded.updated_at
  `).run({
    id: job.id,
    type: job.type,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    result_json: job.result ? JSON.stringify(job.result) : null,
    metrics_json: job.metrics ? JSON.stringify(job.metrics) : null,
    retry_count: Number(job.retry_count || 0) || 0,
    cancellable: job.cancellable ? 1 : 0,
    cancel_requested_at: job.cancel_requested_at || null,
    error: job.error,
    created_at: job.created_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    updated_at: job.updated_at,
  })
}

function cleanupJobs() {
  const finished = Array.from(jobs.values())
    .filter((job) => ['completed', 'failed', 'cancelled'].includes(job.status))
    .sort((a, b) => String(b.finished_at || b.updated_at).localeCompare(String(a.finished_at || a.updated_at)))
  finished.slice(MAX_COMPLETED_JOBS).forEach((job) => jobs.delete(job.id))
  try {
    ensureTable()
    getDb().prepare(`
      DELETE FROM system_jobs
      WHERE id IN (
        SELECT id
        FROM system_jobs
        WHERE status IN ('completed', 'failed', 'cancelled')
        ORDER BY finished_at DESC NULLS LAST, updated_at DESC
        OFFSET @maxCompleted
      )
    `).run({ maxCompleted: MAX_COMPLETED_JOBS })
  } catch (_) {}
}

function updateJob(job, patch = {}) {
  const nextPatch = { ...patch }
  if (patch.metrics && typeof patch.metrics === 'object') {
    nextPatch.metrics = {
      ...(job.metrics || {}),
      ...patch.metrics,
    }
  }
  Object.assign(job, nextPatch, { updated_at: nowIso() })
  try { persistJob(job) } catch (_) {}
  return job
}

class SystemJobCancelledError extends Error {
  constructor(message = 'Job cancelled') {
    super(message)
    this.name = 'SystemJobCancelledError'
    this.code = 'job_cancelled'
  }
}

function startSystemJob(type, worker, options = {}) {
  if (typeof worker !== 'function') throw new Error('System job worker must be a function')
  const dedupeKey = String(options.dedupeKey || '').trim()
  const activeJob = findActiveJob(dedupeKey)
  if (activeJob) return publicJob(activeJob)

  const job = {
    id: makeJobId(options.prefix || 'job'),
    type: String(type || 'system'),
    dedupe_key: dedupeKey,
    status: 'queued',
    phase: 'queued',
    progress: 0,
    message: options.message || 'Queued',
    result: null,
    metrics: {},
    retry_count: 0,
    cancellable: options.cancellable !== false,
    cancel_requested_at: null,
    abort_controller: new AbortController(),
    error: '',
    created_at: nowIso(),
    started_at: null,
    finished_at: null,
    updated_at: nowIso(),
  }
  jobs.set(job.id, job)
  try { persistJob(job) } catch (_) {}

  const runWorker = async () => {
    if (job.cancel_requested_at) {
      updateJob(job, {
        status: 'cancelled',
        phase: 'cancelled',
        progress: Math.max(0, Math.min(99, Number(job.progress || 0))),
        message: 'Job cancelled before it started',
        finished_at: nowIso(),
      })
      cleanupJobs()
      return
    }
    updateJob(job, {
      status: 'running',
      phase: options.phase || 'running',
      progress: Math.max(0, Math.min(99, Number(options.initialProgress || 1))),
      message: options.runningMessage || 'Running',
      started_at: nowIso(),
    })
    const isCancelled = () => !!job.cancel_requested_at || job.abort_controller?.signal?.aborted
    const throwIfCancelled = () => {
      if (isCancelled()) throw new SystemJobCancelledError()
    }
    const progress = (patch = {}) => {
      throwIfCancelled()
      return updateJob(job, patch)
    }
    try {
      const result = await worker({
        job,
        progress,
        signal: job.abort_controller.signal,
        isCancelled,
        throwIfCancelled,
      })
      throwIfCancelled()
      updateJob(job, {
        status: 'completed',
        phase: 'completed',
        progress: 100,
        message: options.completedMessage || 'Completed',
        result: result || null,
        finished_at: nowIso(),
      })
    } catch (error) {
      if (error?.code === 'job_cancelled' || error?.name === 'AbortError' || isCancelled()) {
        updateJob(job, {
          status: 'cancelled',
          phase: 'cancelled',
          progress: Math.max(0, Math.min(99, Number(job.progress || 0))),
          message: 'Job cancelled',
          error: '',
          finished_at: nowIso(),
        })
        return
      }
      updateJob(job, {
        status: 'failed',
        phase: 'failed',
        progress: Math.max(0, Math.min(99, Number(job.progress || 0))),
        message: error?.message || 'Job failed',
        error: error?.message || String(error),
        finished_at: nowIso(),
      })
    } finally {
      cleanupJobs()
    }
  }

  setImmediate(() => {
    runWorker().catch(() => {})
  })

  return publicJob(job)
}

function cancelSystemJob(id, reason = 'Cancelled by user') {
  const safeId = String(id || '').trim()
  const job = jobs.get(safeId)
  if (!job) return null
  if (!['queued', 'running', 'cancelling'].includes(job.status)) return publicJob(job)
  const cancelledAt = nowIso()
  updateJob(job, {
    status: job.status === 'queued' ? 'cancelled' : 'cancelling',
    phase: job.status === 'queued' ? 'cancelled' : 'cancelling',
    message: reason || 'Cancellation requested',
    cancel_requested_at: job.cancel_requested_at || cancelledAt,
    finished_at: job.status === 'queued' ? cancelledAt : job.finished_at,
  })
  try { job.abort_controller?.abort?.() } catch (_) {}
  return publicJob(job)
}

function getSystemJob(id) {
  const safeId = String(id || '')
  const active = jobs.get(safeId)
  if (active) return publicJob(active)
  try {
    ensureTable()
    return publicJob(getDb().prepare('SELECT * FROM system_jobs WHERE id = ? LIMIT 1').get(safeId))
  } catch (_) {
    return null
  }
}

function listSystemJobs({ limit = 25 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 25)))
  try {
    ensureTable()
    return getDb().prepare(`
      SELECT *
      FROM system_jobs
      ORDER BY created_at DESC, id DESC
      LIMIT @limit
    `).all({ limit: safeLimit }).map(publicJob)
  } catch (_) {
    return Array.from(jobs.values())
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, safeLimit)
      .map(publicJob)
  }
}

module.exports = {
  cancelSystemJob,
  startSystemJob,
  getSystemJob,
  listSystemJobs,
  SystemJobCancelledError,
}
