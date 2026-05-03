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
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    result,
    error: job.error || '',
    created_at: job.created_at,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
    updated_at: job.updated_at,
  }
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
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_system_jobs_created_pg ON system_jobs(created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_system_jobs_status_pg ON system_jobs(status, updated_at DESC);
  `)
  tableReady = true
}

function persistJob(job) {
  ensureTable()
  getDb().prepare(`
    INSERT INTO system_jobs (
      id, type, status, phase, progress, message, result_json, error,
      created_at, started_at, finished_at, updated_at
    ) VALUES (
      @id, @type, @status, @phase, @progress, @message, @result_json, @error,
      @created_at, @started_at, @finished_at, @updated_at
    )
    ON CONFLICT(id) DO UPDATE SET
      type = excluded.type,
      status = excluded.status,
      phase = excluded.phase,
      progress = excluded.progress,
      message = excluded.message,
      result_json = excluded.result_json,
      error = excluded.error,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      updated_at = excluded.updated_at
  `).run({
    ...job,
    result_json: job.result ? JSON.stringify(job.result) : null,
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
  Object.assign(job, patch, { updated_at: nowIso() })
  try { persistJob(job) } catch (_) {}
  return job
}

function startSystemJob(type, worker, options = {}) {
  if (typeof worker !== 'function') throw new Error('System job worker must be a function')
  const job = {
    id: makeJobId(options.prefix || 'job'),
    type: String(type || 'system'),
    status: 'queued',
    phase: 'queued',
    progress: 0,
    message: options.message || 'Queued',
    result: null,
    error: '',
    created_at: nowIso(),
    started_at: null,
    finished_at: null,
    updated_at: nowIso(),
  }
  jobs.set(job.id, job)
  try { persistJob(job) } catch (_) {}

  Promise.resolve().then(async () => {
    updateJob(job, {
      status: 'running',
      phase: options.phase || 'running',
      progress: Math.max(0, Math.min(99, Number(options.initialProgress || 1))),
      message: options.runningMessage || 'Running',
      started_at: nowIso(),
    })
    const progress = (patch = {}) => updateJob(job, patch)
    try {
      const result = await worker({ job, progress })
      updateJob(job, {
        status: 'completed',
        phase: 'completed',
        progress: 100,
        message: options.completedMessage || 'Completed',
        result: result || null,
        finished_at: nowIso(),
      })
    } catch (error) {
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
  }).catch(() => {})

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
  startSystemJob,
  getSystemJob,
  listSystemJobs,
}
