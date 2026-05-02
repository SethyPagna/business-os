'use strict'

const crypto = require('crypto')

const MAX_COMPLETED_JOBS = 100
const jobs = new Map()

function nowIso() {
  return new Date().toISOString()
}

function makeJobId(prefix = 'sys') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`
}

function publicJob(job) {
  if (!job) return null
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    message: job.message,
    result: job.result || null,
    error: job.error || '',
    created_at: job.created_at,
    started_at: job.started_at || null,
    finished_at: job.finished_at || null,
    updated_at: job.updated_at,
  }
}

function cleanupJobs() {
  const finished = Array.from(jobs.values())
    .filter((job) => ['completed', 'failed', 'cancelled'].includes(job.status))
    .sort((a, b) => String(b.finished_at || b.updated_at).localeCompare(String(a.finished_at || a.updated_at)))
  finished.slice(MAX_COMPLETED_JOBS).forEach((job) => jobs.delete(job.id))
}

function updateJob(job, patch = {}) {
  Object.assign(job, patch, { updated_at: nowIso() })
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
  return publicJob(jobs.get(String(id || '')))
}

function listSystemJobs({ limit = 25 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 25)))
  return Array.from(jobs.values())
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, safeLimit)
    .map(publicJob)
}

module.exports = {
  startSystemJob,
  getSystemJob,
  listSystemJobs,
}
